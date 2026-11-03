import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FeishuBitableClient,
  type FeishuField,
  type FeishuRecord,
} from './feishu-bitable.client';
import { FeishuSyncCrypto } from './feishu-crypto';

/**
 * 多维表格 ↔ 飞书多维表格同步。
 *
 * - 绑定归表归属账号：App ID / App Secret、app_token、飞书数据表、方向与字段映射都存在绑定上；
 * - 方向：pull（飞书→本地）/ push（本地→飞书）/ both（双向，按两侧最后修改时间取较新的一方）；
 * - 实时性：飞书侧靠应用事件的 bitable.record.changed 回调（每个绑定一条随机回调路径），
 *   本地侧靠 DataTableService 的行变更监听；没有事件也能用「立即同步」做全量比对；
 * - 凭据：App Secret / Encrypt Key 走 AES-256-GCM 密文落库，接口只回「是否已保存」。
 *
 * 首次绑定不猜同一行：两侧各自已有的数据会被当作两条记录（飞书已有记录拉成本地行、
 * 本地已有行推成飞书记录）。要「合并」请先把一侧清空或新建一张飞书表再绑定。
 */
const DIRECTIONS = ['pull', 'push', 'both'] as const;
type Direction = (typeof DIRECTIONS)[number];

const DIRECTION_LABEL: Record<Direction, string> = {
  pull: '飞书 → 本系统',
  push: '本系统 → 飞书',
  both: '双向同步',
};

/** 每次全量同步最多处理的记录数：与客户端单次读取上限 1 万行对齐。 */
const MAX_SYNC_ROWS = 10_000;
/** 每个绑定保留的同步记录条数。 */
const LOG_KEEP = 50;

type Mapping = { localKey: string; feishuName: string };

type SyncRow = {
  id: number;
  tableId: number;
  direction: string;
  appId: string;
  appSecretCipher: string;
  appToken: string;
  feishuTableId: string;
  verificationToken: string;
  encryptKeyCipher: string;
  fieldMapping: Prisma.JsonValue;
  status: string;
  webhookToken: string;
  lastSyncAt: Date | null;
  lastError: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type FieldRow = {
  fieldKey: string;
  name: string;
  fieldType: string;
};

type Stats = {
  pulled: number;
  pushed: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

function emptyStats(): Stats {
  return {
    pulled: 0,
    pushed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  };
}

export class DataTableFeishuService {
  /** 正在跑的绑定（防止手动连点与事件回调同时改同一张表）。 */
  private readonly running = new Set<number>();
  /** 本地行变更推送队列：同一绑定的外呼串行，避免批量写行打出并发限流。 */
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly client: FeishuBitableClient,
    private readonly crypto: FeishuSyncCrypto,
  ) {}

  // ---------- 绑定管理 ----------

  async list(user: CurrentUser, tableId: number) {
    await this.ownerTable(user, tableId);
    const rows = await this.prisma.dataTableFeishuSync.findMany({
      where: { tableId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.view(row));
  }

  /** 新建（无 syncId）或更新（有 syncId）绑定；保存前真实连一次飞书核对凭据与字段。 */
  async save(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
    syncId?: number,
  ) {
    await this.ownerTable(user, tableId);
    const existing = syncId ? await this.binding(tableId, syncId) : null;
    // 只改启停：不动凭据与映射（界面上的「暂停 / 启用」走这一条）。
    const configKeys = [
      'direction',
      'app_id',
      'appId',
      'app_secret',
      'appSecret',
      'app_token',
      'appToken',
      'feishu_table_id',
      'feishuTableId',
      'field_mapping',
      'fieldMapping',
      'verification_token',
      'verificationToken',
      'encrypt_key',
      'encryptKey',
    ];
    if (existing && !configKeys.some((key) => key in body)) {
      const status = text(body.status || existing.status).trim();
      if (!['active', 'paused'].includes(status)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '绑定状态只能是启用或暂停',
        );
      }
      const updated = await this.prisma.dataTableFeishuSync.update({
        where: { id: existing.id },
        data: { status },
      });
      await this.identity.audit(
        user.userId,
        status === 'active' ? '飞书同步启用' : '飞书同步暂停',
        `#${updated.id} 表格#${tableId}`,
      );
      return {
        ...this.view(updated),
        mappingPreview: this.readMapping(updated.fieldMapping),
      };
    }
    const direction = text(body.direction || 'both').trim() as Direction;
    if (!DIRECTIONS.includes(direction)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '同步方向只能是飞书→本系统、本系统→飞书或双向',
      );
    }
    const appId = text(body.app_id ?? body.appId).trim();
    const appToken = text(body.app_token ?? body.appToken).trim();
    const feishuTableId = text(
      body.feishu_table_id ?? body.feishuTableId,
    ).trim();
    if (!appId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写飞书应用 App ID',
      );
    }
    if (!appToken) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写飞书多维表格 app_token（表格链接 /base/ 后的那串）',
      );
    }
    if (!feishuTableId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择飞书多维表格里的数据表（table_id）',
      );
    }
    const appSecret =
      text(body.app_secret ?? body.appSecret).trim() ||
      (existing ? this.crypto.decrypt(existing.appSecretCipher) : '');
    if (!appSecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写飞书应用 App Secret',
      );
    }
    const encryptKeyInput = text(body.encrypt_key ?? body.encryptKey);
    const encryptKeyCipher =
      encryptKeyInput.trim() !== ''
        ? this.crypto.encrypt(encryptKeyInput.trim())
        : (existing?.encryptKeyCipher ?? '');
    const status = text(body.status || existing?.status || 'active').trim();
    if (!['active', 'paused'].includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '绑定状态只能是启用或暂停',
      );
    }
    const verificationToken = text(
      body.verification_token ?? body.verificationToken,
    )
      .trim()
      .slice(0, 191);

    const [fields, feishuFields] = await Promise.all([
      this.localFields(tableId),
      this.client.listFields(appId, appSecret, appToken, feishuTableId),
    ]);
    if (!fields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该表还没有列，请先添加列再配置飞书同步',
      );
    }
    if (!feishuFields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '飞书数据表还没有列，请先在飞书侧建好列',
      );
    }
    const mapping = this.normalizeMapping(
      body.field_mapping ?? body.fieldMapping,
      fields,
      feishuFields,
    );
    if (!mapping.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少为一列配置飞书字段映射',
      );
    }

    const conflict = await this.prisma.dataTableFeishuSync.findFirst({
      where: {
        tableId,
        appToken,
        feishuTableId,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '这张飞书数据表已经绑定过了，请直接编辑原绑定',
      );
    }

    const data = {
      direction,
      appId,
      appSecretCipher: this.crypto.encrypt(appSecret),
      appToken,
      feishuTableId,
      verificationToken,
      encryptKeyCipher,
      fieldMapping: mapping as unknown as Prisma.InputJsonValue,
      status,
    };
    const row = existing
      ? await this.prisma.dataTableFeishuSync.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.dataTableFeishuSync.create({
          data: {
            ...data,
            tableId,
            createdBy: user.userId,
            webhookToken: randomBytes(16).toString('hex'),
          },
        });
    await this.identity.audit(
      user.userId,
      existing ? '飞书同步改绑定' : '飞书同步建绑定',
      `#${row.id} 表格#${tableId} ${DIRECTION_LABEL[direction]}`,
    );
    const view = this.view(row);
    return { ...view, mappingPreview: mapping };
  }

  async remove(user: CurrentUser, tableId: number, syncId: number) {
    await this.ownerTable(user, tableId);
    const row = await this.binding(tableId, syncId);
    await this.prisma.$transaction([
      this.prisma.dataTableFeishuRowLink.deleteMany({
        where: { syncId: row.id },
      }),
      this.prisma.dataTableFeishuSyncLog.deleteMany({
        where: { syncId: row.id },
      }),
      this.prisma.dataTableFeishuSync.delete({ where: { id: row.id } }),
    ]);
    await this.identity.audit(
      user.userId,
      '飞书同步删绑定',
      `#${row.id} 表格#${tableId}`,
    );
    return { id: row.id, deleted: true };
  }

  /**
   * 读取飞书侧可选的数据表与列（表单里的下拉）。
   * 新建时用表单里现填的凭据；编辑时允许只给 syncId，App Secret 从已存密文取。
   */
  async preview(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
  ) {
    await this.ownerTable(user, tableId);
    const syncId = Number(body.sync_id ?? body.syncId ?? 0);
    const existing =
      Number.isInteger(syncId) && syncId > 0
        ? await this.binding(tableId, syncId)
        : null;
    const appId =
      text(body.app_id ?? body.appId).trim() || existing?.appId || '';
    const appSecret =
      text(body.app_secret ?? body.appSecret).trim() ||
      (existing ? this.crypto.decrypt(existing.appSecretCipher) : '');
    const appToken =
      text(body.app_token ?? body.appToken).trim() || existing?.appToken || '';
    const feishuTableId =
      text(body.feishu_table_id ?? body.feishuTableId).trim() ||
      existing?.feishuTableId ||
      '';
    if (!appId || !appSecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先填写飞书应用 App ID 与 App Secret',
      );
    }
    if (!appToken) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先填写飞书多维表格 app_token',
      );
    }
    const tables = await this.client.listTables(appId, appSecret, appToken);
    const fields = feishuTableId
      ? await this.client.listFields(appId, appSecret, appToken, feishuTableId)
      : [];
    return { tables, fields };
  }

  async test(user: CurrentUser, tableId: number, syncId: number) {
    await this.ownerTable(user, tableId);
    const sync = await this.binding(tableId, syncId);
    const secret = this.crypto.decrypt(sync.appSecretCipher);
    const fields = await this.client.listFields(
      sync.appId,
      secret,
      sync.appToken,
      sync.feishuTableId,
    );
    return { ok: true, fieldCount: fields.length, fields };
  }

  // ---------- 同步执行 ----------

  /** 「立即同步」：按方向先拉后推（双向时先拉，保证较新的一方胜出）。 */
  async run(user: CurrentUser, tableId: number, syncId: number) {
    await this.ownerTable(user, tableId);
    const sync = await this.binding(tableId, syncId);
    return this.runBinding(sync, 'manual');
  }

  async logs(user: CurrentUser, tableId: number, syncId: number) {
    await this.ownerTable(user, tableId);
    await this.binding(tableId, syncId);
    const rows = await this.prisma.dataTableFeishuSyncLog.findMany({
      where: { syncId },
      orderBy: { id: 'desc' },
      take: LOG_KEEP,
    });
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      stats: row.stats,
      message: row.message,
      createdAt: row.createdAt,
    }));
  }

  private async runBinding(sync: SyncRow, trigger: string) {
    if (this.running.has(sync.id)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该绑定正在同步中，请稍后再试',
      );
    }
    if (sync.status !== 'active') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该绑定已暂停，请先启用再同步',
      );
    }
    this.running.add(sync.id);
    const stats = emptyStats();
    try {
      if (sync.direction === 'pull' || sync.direction === 'both') {
        await this.pull(sync, stats);
      }
      if (sync.direction === 'push' || sync.direction === 'both') {
        await this.push(sync, stats);
      }
      await this.prisma.dataTableFeishuSync.update({
        where: { id: sync.id },
        data: { lastSyncAt: new Date(), lastError: '' },
      });
      await this.writeLog(sync.id, trigger, 'success', stats, '');
      return { ...stats, trigger };
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : '同步失败，请查看服务端日志';
      if (!(error instanceof BusinessException)) {
        console.error(
          JSON.stringify({
            event: 'feishu_sync_error',
            syncId: sync.id,
            type: (error as Error)?.name,
          }),
        );
      }
      await this.prisma.dataTableFeishuSync.update({
        where: { id: sync.id },
        data: { lastError: message },
      });
      await this.writeLog(sync.id, trigger, 'failed', stats, message);
      throw error instanceof BusinessException
        ? error
        : new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, message);
    } finally {
      this.running.delete(sync.id);
    }
  }

  /** 飞书 → 本地：新增/更新/删除本地行，并维护行对应关系。 */
  private async pull(sync: SyncRow, stats: Stats) {
    const { fields, mapping, records } = await this.syncContext(sync);
    const links = await this.prisma.dataTableFeishuRowLink.findMany({
      where: { syncId: sync.id },
    });
    const linkByRecord = new Map(
      links.map((item) => [item.feishuRecordId, item]),
    );
    const recordIds = new Set(records.map((record) => record.recordId));
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId: sync.tableId },
      take: MAX_SYNC_ROWS,
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));

    // 飞书已删除的记录 → 连带删除本地行
    for (const link of links) {
      if (recordIds.has(link.feishuRecordId)) continue;
      if (rowById.has(link.localRowId)) {
        await this.prisma.dataTableRow.delete({
          where: { id: link.localRowId },
        });
        rowById.delete(link.localRowId);
        stats.deleted += 1;
        stats.pulled += 1;
      }
      await this.prisma.dataTableFeishuRowLink.delete({
        where: { id: link.id },
      });
    }

    for (const record of records) {
      const feishuUpdated = record.lastModifiedTime
        ? new Date(record.lastModifiedTime)
        : null;
      const values = this.fromFeishu(fieldsByKey, mapping, record.fields);
      const link = linkByRecord.get(record.recordId);
      if (!link) {
        const created = await this.prisma.dataTableRow.create({
          data: {
            tableId: sync.tableId,
            createdBy: sync.createdBy,
            data: values as Prisma.InputJsonObject,
          },
        });
        await this.prisma.dataTableFeishuRowLink.create({
          data: {
            syncId: sync.id,
            localRowId: created.id,
            feishuRecordId: record.recordId,
            localUpdatedAt: created.updatedAt,
            feishuUpdatedAt: feishuUpdated,
          },
        });
        rowById.set(created.id, created);
        linkByRecord.set(record.recordId, {
          id: 0,
          syncId: sync.id,
          localRowId: created.id,
          feishuRecordId: record.recordId,
          localUpdatedAt: created.updatedAt,
          feishuUpdatedAt: feishuUpdated,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        });
        stats.created += 1;
        stats.pulled += 1;
        continue;
      }
      const row = rowById.get(link.localRowId);
      if (!row) continue; // 本地已删：留给 push 删飞书记录
      const localChanged =
        !link.localUpdatedAt || row.updatedAt > link.localUpdatedAt;
      const feishuChanged =
        !link.feishuUpdatedAt ||
        (!!feishuUpdated && feishuUpdated > link.feishuUpdatedAt);
      let take = sync.direction === 'pull' || feishuChanged;
      if (sync.direction === 'both' && localChanged) {
        // 两侧都改过：比最后修改时间，较新的一方胜出；相同则飞书优先。
        take =
          !!feishuUpdated && feishuUpdated.getTime() >= row.updatedAt.getTime();
      }
      if (!take) {
        stats.skipped += 1;
        continue;
      }
      const merged = {
        ...(row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {}),
        ...values,
      };
      const updated = await this.prisma.dataTableRow.update({
        where: { id: row.id },
        data: { data: merged as Prisma.InputJsonObject },
      });
      await this.prisma.dataTableFeishuRowLink.update({
        where: { id: link.id },
        data: {
          localUpdatedAt: updated.updatedAt,
          feishuUpdatedAt: feishuUpdated ?? link.feishuUpdatedAt,
        },
      });
      rowById.set(updated.id, updated);
      stats.updated += 1;
      stats.pulled += 1;
    }
  }

  /** 本地 → 飞书：新增/更新/删除飞书记录，按上次同步时间只推改动过的行。 */
  private async push(sync: SyncRow, stats: Stats) {
    const { fields, mapping, feishuFields } = await this.syncContext(
      sync,
      false,
    );
    const feishuNames = new Set(feishuFields.map((field) => field.fieldName));
    const usable = mapping.filter((item) => feishuNames.has(item.feishuName));
    if (!usable.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '字段映射里的飞书列都不存在了，请重新读取列清单并保存映射',
      );
    }
    const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
    const links = await this.prisma.dataTableFeishuRowLink.findMany({
      where: { syncId: sync.id },
    });
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId: sync.tableId },
      take: MAX_SYNC_ROWS,
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const linkByLocal = new Map(links.map((link) => [link.localRowId, link]));

    // 本地已删除的行 → 连带删飞书记录
    for (const link of links) {
      if (rowById.has(link.localRowId)) continue;
      try {
        await this.client.deleteRecord(
          sync.appId,
          this.crypto.decrypt(sync.appSecretCipher),
          sync.appToken,
          sync.feishuTableId,
          link.feishuRecordId,
        );
      } catch (error) {
        if (
          !(error instanceof BusinessException) ||
          !error.message.includes('记录不存在')
        ) {
          throw error;
        }
      }
      await this.prisma.dataTableFeishuRowLink.delete({
        where: { id: link.id },
      });
      stats.deleted += 1;
      stats.pushed += 1;
    }

    for (const row of rows) {
      const values = this.toFeishu(fieldsByKey, usable, row.data);
      const link = linkByLocal.get(row.id);
      if (!link) {
        const record = await this.client.createRecord(
          sync.appId,
          this.crypto.decrypt(sync.appSecretCipher),
          sync.appToken,
          sync.feishuTableId,
          values,
        );
        await this.prisma.dataTableFeishuRowLink.create({
          data: {
            syncId: sync.id,
            localRowId: row.id,
            feishuRecordId: record.recordId,
            localUpdatedAt: row.updatedAt,
            feishuUpdatedAt: new Date(record.lastModifiedTime || Date.now()),
          },
        });
        stats.created += 1;
        stats.pushed += 1;
        continue;
      }
      if (link.localUpdatedAt && row.updatedAt <= link.localUpdatedAt) {
        stats.skipped += 1;
        continue;
      }
      const record = await this.updateOrRecreate(
        sync,
        link.feishuRecordId,
        values,
      );
      await this.prisma.dataTableFeishuRowLink.update({
        where: { id: link.id },
        data: {
          feishuRecordId: record.recordId,
          localUpdatedAt: row.updatedAt,
          feishuUpdatedAt: new Date(record.lastModifiedTime || Date.now()),
        },
      });
      stats.updated += 1;
      stats.pushed += 1;
    }
  }

  /** 记录在飞书侧被删掉时（push-only 模式看不到拉取结果）自动重建，避免绑定永久报错。 */
  private async updateOrRecreate(
    sync: SyncRow,
    recordId: string,
    values: Record<string, unknown>,
  ) {
    const secret = this.crypto.decrypt(sync.appSecretCipher);
    try {
      return await this.client.updateRecord(
        sync.appId,
        secret,
        sync.appToken,
        sync.feishuTableId,
        recordId,
        values,
      );
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.message.includes('记录不存在')
      ) {
        return this.client.createRecord(
          sync.appId,
          secret,
          sync.appToken,
          sync.feishuTableId,
          values,
        );
      }
      throw error;
    }
  }

  // ---------- 本地行变更实时推送 ----------

  /** DataTableService 的行变更监听：只对 push / both 绑定生效，失败只记日志不回抛。 */
  onRowChange(
    tableId: number,
    action: 'create' | 'update' | 'delete',
    rowId: number,
  ) {
    void (async () => {
      const syncs = await this.prisma.dataTableFeishuSync.findMany({
        where: {
          tableId,
          status: 'active',
          direction: { in: ['push', 'both'] },
        },
      });
      for (const sync of syncs) {
        this.enqueue(sync.id, () => this.pushRowChange(sync, action, rowId));
      }
    })().catch((error) => {
      console.error(
        JSON.stringify({
          event: 'feishu_push_enqueue_error',
          tableId,
          type: (error as Error)?.name,
        }),
      );
    });
  }

  private enqueue(syncId: number, work: () => Promise<void>) {
    const previous = this.queues.get(syncId) ?? Promise.resolve();
    const next = previous.then(work, work).catch(() => undefined);
    this.queues.set(syncId, next);
    void next.finally(() => {
      if (this.queues.get(syncId) === next) this.queues.delete(syncId);
    });
  }

  private async pushRowChange(
    sync: SyncRow,
    action: 'create' | 'update' | 'delete',
    rowId: number,
  ) {
    if (this.running.has(sync.id)) return;
    const stats = emptyStats();
    try {
      const link = await this.prisma.dataTableFeishuRowLink.findUnique({
        where: {
          syncId_localRowId: { syncId: sync.id, localRowId: rowId },
        },
      });
      if (action === 'delete') {
        if (!link) return;
        await this.client.deleteRecord(
          sync.appId,
          this.crypto.decrypt(sync.appSecretCipher),
          sync.appToken,
          sync.feishuTableId,
          link.feishuRecordId,
        );
        await this.prisma.dataTableFeishuRowLink.delete({
          where: { id: link.id },
        });
        stats.deleted = 1;
        stats.pushed = 1;
        await this.touch(sync.id);
        await this.writeLog(sync.id, 'push', 'success', stats, '');
        return;
      }

      const row = await this.prisma.dataTableRow.findUnique({
        where: { id: rowId },
      });
      if (!row) return;
      const { fields, mapping } = await this.syncContext(sync, false).then(
        (context) => {
          const feishuFields = context.feishuFields;
          const names = new Set(feishuFields.map((field) => field.fieldName));
          return {
            fields: context.fields,
            mapping: context.mapping.filter((item) =>
              names.has(item.feishuName),
            ),
          };
        },
      );
      if (!mapping.length) return;
      const values = this.toFeishu(
        new Map(fields.map((field) => [field.fieldKey, field])),
        mapping,
        row.data,
      );
      const secret = this.crypto.decrypt(sync.appSecretCipher);
      let record: FeishuRecord;
      if (link) {
        record = await this.updateOrRecreate(sync, link.feishuRecordId, values);
        await this.prisma.dataTableFeishuRowLink.update({
          where: { id: link.id },
          data: {
            feishuRecordId: record.recordId,
            localUpdatedAt: row.updatedAt,
            feishuUpdatedAt: new Date(record.lastModifiedTime || Date.now()),
          },
        });
        stats.updated = 1;
      } else {
        record = await this.client.createRecord(
          sync.appId,
          secret,
          sync.appToken,
          sync.feishuTableId,
          values,
        );
        await this.prisma.dataTableFeishuRowLink.create({
          data: {
            syncId: sync.id,
            localRowId: row.id,
            feishuRecordId: record.recordId,
            localUpdatedAt: row.updatedAt,
            feishuUpdatedAt: new Date(record.lastModifiedTime || Date.now()),
          },
        });
        stats.created = 1;
      }
      stats.pushed = 1;
      await this.touch(sync.id);
      await this.writeLog(sync.id, 'push', 'success', stats, '');
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : '推送失败，请查看服务端日志';
      await this.prisma.dataTableFeishuSync
        .update({ where: { id: sync.id }, data: { lastError: message } })
        .catch(() => undefined);
      await this.writeLog(sync.id, 'push', 'failed', stats, message).catch(
        () => undefined,
      );
    }
  }

  // ---------- 飞书事件回调 ----------

  /**
   * 处理飞书事件订阅回调。
   * 域名校验（url_verification）直接回 challenge；事件报文支持 Encrypt Key 加密；
   * 只处理 bitable.record.changed，且 app_token / table_id 必须与绑定一致。
   */
  async handleEvent(webhookToken: string, rawBody: unknown) {
    const sync = await this.prisma.dataTableFeishuSync.findUnique({
      where: { webhookToken },
    });
    if (!sync) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '回调地址无效');
    }
    const body = this.decodeEvent(sync, rawBody);
    const tokenInBody = text(
      body.token ??
        (body.header as Record<string, unknown> | undefined)?.token ??
        '',
    );
    if (sync.verificationToken && tokenInBody !== sync.verificationToken) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '回调校验失败');
    }
    const challenge = text(body.challenge);
    if (body.type === 'url_verification' || challenge) {
      return { challenge };
    }
    const header = (body.header ?? {}) as Record<string, unknown>;
    const event = (body.event ?? {}) as Record<string, unknown>;
    const eventType = text(header.event_type ?? event.type);
    if (eventType !== 'bitable.record.changed') return { ignored: true };
    const appToken = text(event.app_token ?? event.appToken);
    const tableId = text(event.table_id ?? event.tableId);
    if (appToken && appToken !== sync.appToken) return { ignored: true };
    if (tableId && tableId !== sync.feishuTableId) return { ignored: true };
    if (
      sync.status !== 'active' ||
      !['pull', 'both'].includes(sync.direction)
    ) {
      return { ignored: true };
    }
    if (this.running.has(sync.id)) {
      // 全量同步正在跑：事件里的改动下一轮会一并读到，这里不排队。
      return { queued: false };
    }
    const action = text(event.action ?? event.action_type);
    const recordId = text(event.record_id ?? event.recordId);
    void this.applyEvent(sync, action, recordId).catch((error) => {
      console.error(
        JSON.stringify({
          event: 'feishu_webhook_error',
          syncId: sync.id,
          type: (error as Error)?.name,
        }),
      );
    });
    return { ok: true };
  }

  private async applyEvent(sync: SyncRow, action: string, recordId: string) {
    const stats = emptyStats();
    try {
      if (!recordId) {
        await this.pull(sync, stats);
        await this.touch(sync.id);
        await this.writeLog(sync.id, 'webhook', 'success', stats, '');
        return;
      }
      const link = await this.prisma.dataTableFeishuRowLink.findUnique({
        where: {
          syncId_feishuRecordId: {
            syncId: sync.id,
            feishuRecordId: recordId,
          },
        },
      });
      if (action.includes('delete')) {
        if (link) {
          await this.prisma.dataTableRow
            .delete({ where: { id: link.localRowId } })
            .catch(() => undefined);
          await this.prisma.dataTableFeishuRowLink.delete({
            where: { id: link.id },
          });
          stats.deleted = 1;
          stats.pulled = 1;
        } else {
          stats.skipped = 1;
        }
        await this.touch(sync.id);
        await this.writeLog(sync.id, 'webhook', 'success', stats, '');
        return;
      }

      const secret = this.crypto.decrypt(sync.appSecretCipher);
      const record = await this.client.getRecord(
        sync.appId,
        secret,
        sync.appToken,
        sync.feishuTableId,
        recordId,
      );
      if (!record) {
        stats.skipped = 1;
        await this.writeLog(
          sync.id,
          'webhook',
          'success',
          stats,
          '记录已不存在',
        );
        return;
      }
      const { fields, mapping } = await this.syncContext(sync);
      const values = this.fromFeishu(
        new Map(fields.map((field) => [field.fieldKey, field])),
        mapping,
        record.fields,
      );
      const feishuUpdated = record.lastModifiedTime
        ? new Date(record.lastModifiedTime)
        : new Date();
      if (!link) {
        const created = await this.prisma.dataTableRow.create({
          data: {
            tableId: sync.tableId,
            createdBy: sync.createdBy,
            data: values as Prisma.InputJsonObject,
          },
        });
        await this.prisma.dataTableFeishuRowLink.create({
          data: {
            syncId: sync.id,
            localRowId: created.id,
            feishuRecordId: record.recordId,
            localUpdatedAt: created.updatedAt,
            feishuUpdatedAt: feishuUpdated,
          },
        });
        stats.created = 1;
        stats.pulled = 1;
      } else {
        const row = await this.prisma.dataTableRow.findUnique({
          where: { id: link.localRowId },
        });
        if (!row) {
          stats.skipped = 1;
        } else {
          const localChanged =
            !!link.localUpdatedAt && row.updatedAt > link.localUpdatedAt;
          if (
            sync.direction === 'both' &&
            localChanged &&
            row.updatedAt.getTime() > feishuUpdated.getTime()
          ) {
            // 本地更新更晚：留给本地变更推送去覆盖飞书，避免回调把新值冲掉。
            stats.skipped = 1;
          } else {
            const merged = {
              ...(row.data &&
              typeof row.data === 'object' &&
              !Array.isArray(row.data)
                ? (row.data as Record<string, unknown>)
                : {}),
              ...values,
            };
            const updated = await this.prisma.dataTableRow.update({
              where: { id: row.id },
              data: { data: merged as Prisma.InputJsonObject },
            });
            await this.prisma.dataTableFeishuRowLink.update({
              where: { id: link.id },
              data: {
                localUpdatedAt: updated.updatedAt,
                feishuUpdatedAt: feishuUpdated,
              },
            });
            stats.updated = 1;
            stats.pulled = 1;
          }
        }
      }
      await this.touch(sync.id);
      await this.writeLog(sync.id, 'webhook', 'success', stats, '');
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : '事件同步失败，请查看服务端日志';
      await this.prisma.dataTableFeishuSync
        .update({ where: { id: sync.id }, data: { lastError: message } })
        .catch(() => undefined);
      await this.writeLog(sync.id, 'webhook', 'failed', stats, message).catch(
        () => undefined,
      );
    }
  }

  // ---------- 内部 ----------

  private async ownerTable(user: CurrentUser, tableId: number) {
    const table = await this.prisma.dataTable.findUnique({
      where: { id: tableId },
    });
    if (!table) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '多维表格不存在');
    }
    if (table.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有表归属账号可以配置飞书同步',
      );
    }
    return table;
  }

  private async binding(tableId: number, syncId: number): Promise<SyncRow> {
    const row = await this.prisma.dataTableFeishuSync.findFirst({
      where: { id: syncId, tableId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该同步绑定不存在');
    }
    return row;
  }

  private async localFields(tableId: number): Promise<FieldRow[]> {
    return this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
      select: { fieldKey: true, name: true, fieldType: true },
    });
  }

  private async syncContext(sync: SyncRow, needRecords = true) {
    const fields = await this.localFields(sync.tableId);
    if (!fields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该表还没有列，请先添加列',
      );
    }
    const mapping = this.readMapping(sync.fieldMapping).filter((item) =>
      fields.some((field) => field.fieldKey === item.localKey),
    );
    if (!mapping.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该绑定的字段映射为空，请重新配置',
      );
    }
    const secret = this.crypto.decrypt(sync.appSecretCipher);
    const feishuFields = await this.client.listFields(
      sync.appId,
      secret,
      sync.appToken,
      sync.feishuTableId,
    );
    const names = new Set(feishuFields.map((field) => field.fieldName));
    const invalid = mapping.filter((item) => !names.has(item.feishuName));
    if (invalid.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书列已不存在：${invalid
          .slice(0, 5)
          .map((item) => item.feishuName)
          .join('、')}，请重新配置字段映射`,
      );
    }
    const records = needRecords
      ? await this.client.listRecords(
          sync.appId,
          secret,
          sync.appToken,
          sync.feishuTableId,
        )
      : [];
    if (records.length > MAX_SYNC_ROWS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书数据表超过 ${MAX_SYNC_ROWS} 行，请拆分后再同步`,
      );
    }
    return { fields, mapping, feishuFields, records };
  }

  private readMapping(value: Prisma.JsonValue): Mapping[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          return null;
        const record = item as Record<string, unknown>;
        const localKey = text(record.localKey ?? record.local_key).trim();
        const feishuName = text(record.feishuName ?? record.feishu_name).trim();
        if (!localKey || !feishuName) return null;
        return { localKey, feishuName };
      })
      .filter((item): item is Mapping => item !== null);
  }

  private normalizeMapping(
    raw: unknown,
    fields: FieldRow[],
    feishuFields: FeishuField[],
  ) {
    const keys = new Set(fields.map((field) => field.fieldKey));
    const names = new Set(feishuFields.map((field) => field.fieldName));
    let mapping = this.readMapping(raw as Prisma.JsonValue);
    if (!mapping.length) {
      // 没给映射时按列名自动配对（同名 → 配对）；一个都没配上则报错让用户手动选。
      mapping = fields
        .filter((field) => names.has(field.name))
        .map((field) => ({ localKey: field.fieldKey, feishuName: field.name }));
    }
    const seen = new Set<string>();
    const result: Mapping[] = [];
    for (const item of mapping) {
      if (!keys.has(item.localKey)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `本系统列键「${item.localKey}」不属于该表`,
        );
      }
      if (!names.has(item.feishuName)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `飞书列「${item.feishuName}」不存在，请重新读取列清单`,
        );
      }
      if (seen.has(item.localKey)) continue;
      seen.add(item.localKey);
      result.push(item);
    }
    return result;
  }

  /** 本地行 → 飞书记录字段（只带映射过的列；空值写 null 以便在飞书侧清空）。 */
  private toFeishu(
    fieldsByKey: Map<string, FieldRow>,
    mapping: Mapping[],
    data: Prisma.JsonValue,
  ) {
    const source =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const values: Record<string, unknown> = {};
    for (const item of mapping) {
      const field = fieldsByKey.get(item.localKey);
      if (!field) continue;
      const value = source[item.localKey];
      values[item.feishuName] = this.toFeishuValue(field.fieldType, value);
    }
    return values;
  }

  private toFeishuValue(fieldType: string, value: unknown): unknown {
    if (value === undefined || value === null || value === '') return null;
    switch (fieldType) {
      case 'number': {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      }
      case 'boolean':
        return value === true;
      case 'date': {
        const date = new Date(text(value));
        return Number.isNaN(date.getTime()) ? null : date.getTime();
      }
      case 'url':
        return { link: text(value), text: text(value) };
      case 'json':
        return typeof value === 'string' ? value : JSON.stringify(value);
      case 'select':
        return text(value);
      default:
        return text(value);
    }
  }

  /** 飞书记录字段 → 本地行数据（按本地列类型归一）。 */
  private fromFeishu(
    fieldsByKey: Map<string, FieldRow>,
    mapping: Mapping[],
    recordFields: Record<string, unknown>,
  ) {
    const values: Record<string, unknown> = {};
    for (const item of mapping) {
      const field = fieldsByKey.get(item.localKey);
      if (!field) continue;
      values[item.localKey] = this.fromFeishuValue(
        field.fieldType,
        recordFields[item.feishuName],
      );
    }
    return values;
  }

  private fromFeishuValue(fieldType: string, value: unknown): unknown {
    if (value === undefined || value === null || value === '') return null;
    switch (fieldType) {
      case 'number': {
        const num = Number(this.flattenText(value));
        return Number.isFinite(num) ? num : null;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        const raw = this.flattenText(value).trim().toLowerCase();
        return ['true', '1', 'yes', '是', 'checked'].includes(raw);
      }
      case 'date': {
        const raw = typeof value === 'number' ? value : text(value);
        const date =
          typeof raw === 'number' ? new Date(raw) : new Date(text(raw));
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
      case 'url': {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          return text(record.link ?? record.text ?? '');
        }
        return this.flattenText(value);
      }
      case 'json':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        return value;
      case 'select':
        return this.flattenText(value);
      default:
        return this.flattenText(value);
    }
  }

  /** 飞书文本类字段可能是字符串、富文本段数组或选项对象，统一压成纯文本。 */
  private flattenText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    if (Array.isArray(value)) {
      return value
        .map((item) => this.flattenText(item))
        .filter(Boolean)
        .join('');
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('text' in record) return text(record.text);
      if ('name' in record) return text(record.name);
      if ('link' in record) return text(record.link);
      return '';
    }
    return '';
  }

  /** Encrypt Key 加密的事件报文：AES-256-CBC，key = sha256(encrypt_key)，IV 为密文前 16 字节。 */
  private decodeEvent(sync: SyncRow, rawBody: unknown) {
    const body =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const encrypted = text(body.encrypt);
    if (!encrypted) return body;
    if (!sync.encryptKeyCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '事件报文已加密，但该绑定没有配置 Encrypt Key',
      );
    }
    const key = createHash('sha256')
      .update(this.crypto.decrypt(sync.encryptKeyCipher))
      .digest();
    try {
      const payload = Buffer.from(encrypted, 'base64');
      const iv = payload.subarray(0, 16);
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      const plain = Buffer.concat([
        decipher.update(payload.subarray(16)),
        decipher.final(),
      ]).toString('utf8');
      const decoded = JSON.parse(plain) as unknown;
      return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>)
        : {};
    } catch {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '事件报文解密失败');
    }
  }

  private async touch(syncId: number) {
    await this.prisma.dataTableFeishuSync.update({
      where: { id: syncId },
      data: { lastSyncAt: new Date(), lastError: '' },
    });
  }

  private async writeLog(
    syncId: number,
    trigger: string,
    status: 'success' | 'failed',
    stats: Stats,
    message: string,
  ) {
    await this.prisma.dataTableFeishuSyncLog.create({
      data: {
        syncId,
        trigger,
        status,
        stats,
        message: message.slice(0, 500),
      },
    });
    const keep = await this.prisma.dataTableFeishuSyncLog.findMany({
      where: { syncId },
      orderBy: { id: 'desc' },
      take: LOG_KEEP,
      select: { id: true },
    });
    if (keep.length >= LOG_KEEP) {
      await this.prisma.dataTableFeishuSyncLog.deleteMany({
        where: { syncId, id: { notIn: keep.map((item) => item.id) } },
      });
    }
  }

  private view(row: SyncRow) {
    const direction = (DIRECTIONS as readonly string[]).includes(row.direction)
      ? (row.direction as Direction)
      : 'both';
    return {
      id: row.id,
      tableId: row.tableId,
      direction,
      directionLabel: DIRECTION_LABEL[direction],
      appId: row.appId,
      appToken: row.appToken,
      feishuTableId: row.feishuTableId,
      verificationToken: row.verificationToken,
      hasAppSecret: !!row.appSecretCipher,
      hasEncryptKey: !!row.encryptKeyCipher,
      fieldMapping: this.readMapping(row.fieldMapping),
      status: row.status,
      webhookPath: `/api/backend/enterprise/feishu/events/${row.webhookToken}`,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
