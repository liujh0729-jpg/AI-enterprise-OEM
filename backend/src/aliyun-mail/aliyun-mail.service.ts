import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import { pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { runInRequestContext } from '../common/request-context';
import { DataTableService } from '../data-table/data-table.service';
import { IdentityService } from '../identity/identity.service';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { TransportError } from '../http/transport';
import {
  DIRECTMAIL_REGIONS,
  DirectMailClient,
  DirectMailError,
  RECEIVER_CAPACITY,
  SAVE_BATCH_LIMIT,
  type DmSaveItem,
} from './directmail.client';
import { AliyunMailCrypto } from './aliyun-mail-crypto';

/**
 * 阿里云邮件推送（营销工具）：
 * - 名单来源＝本系统多维表格（含飞书同步进来的本地行）；
 * - 每条登录账号用自己的阿里云 RAM 子账号 AK（加密落库），不读平台级 Key；
 * - 只做「收件人列表」这一段：新建列表或追加联系人，模板 / 域名 / 发送都在阿里云控制台；
 * - 没有清空接口，所以不覆盖：重复邮箱由阿里云报错，本地台账保证追加幂等；
 * - 邮箱只落打码值与 SHA-256，重试时按 source_row_id 回原表取值。
 */

export const ALIYUN_MAIL_MAX_ROWS = 10000;
const BATCH_SIZE = SAVE_BATCH_LIMIT;
/** 单次请求体兜底（500 × 6k 变量可能超过阿里云表单上限，按字节再切小批）。 */
const BATCH_MAX_BYTES = 400_000;
const EMAIL_HASH_KEY = 'aiworkin-aliyun-mail-email';
const VARIABLE_KEY_PATTERN = /^[A-Za-z]+$/;
const MAX_VARIABLES = 50;
const CUSTOM_DATA_MAX_BYTES = 6000;
const RECEIVER_LIST_LIMIT = 10;
const WRITE_BACK_FIELDS = [
  { fieldKey: 'aliyun_mail_import_id', name: '邮件批次', fieldType: 'text' },
  { fieldKey: 'aliyun_mail_list', name: '邮件收件人列表', fieldType: 'text' },
  { fieldKey: 'aliyun_mail_status', name: '邮件同步状态', fieldType: 'text' },
  { fieldKey: 'aliyun_mail_error', name: '邮件失败原因', fieldType: 'text' },
] as const;
/** 阿里云对标准变量的长度限制；超长不截断，由用户决定改数据或跳过。 */
const STANDARD_VARIABLE_LIMITS: Record<string, number> = {
  UserName: 75,
  NickName: 25,
  Gender: 25,
  Birthday: 25,
  Mobile: 25,
};

type FieldMeta = { fieldKey: string; name: string; fieldType: string };

type SettingRow = {
  accessKeyId: string;
  accessKeySecretCipher: string;
  region: string;
  defaultReceiverId: string;
  defaultReceiverName: string;
  updatedAt: Date;
};

type Mapping = {
  emailFieldKey: string;
  variables: { key: string; fieldKey: string }[];
  writeBack: boolean;
};

type PreparedRow = {
  sourceRowId: number;
  email: string;
  emailMasked: string;
  emailHash: string;
  variables: { key: string; value: string }[];
  /** pending 才会提交；其余在预览里展示原因 */
  status: 'pending' | 'invalid' | 'duplicate' | 'existing' | 'overflow';
  message: string;
};

type SourceRow = {
  id: number;
  data: Record<string, unknown>;
};

type PrepareOptions = {
  mode: 'new' | 'append';
  receiverId: string;
  /** 追加时目标列表当前人数；新建传 0。 */
  currentCount: number;
};

const logger = new Logger('AliyunMailService');

export class AliyunMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: AliyunMailCrypto,
    private readonly dataTable: DataTableService,
  ) {}

  // ---------- 设置 ----------

  async getSettings(user: CurrentUser) {
    const row = await this.prisma.aliyunMailSetting.findUnique({
      where: { userId: user.userId },
    });
    return this.settingsView(row);
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const current = await this.prisma.aliyunMailSetting.findUnique({
      where: { userId: user.userId },
    });
    const accessKeyId =
      text(body.accessKeyId).trim() || current?.accessKeyId || '';
    if (!accessKeyId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写 AccessKeyId');
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(accessKeyId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'AccessKeyId 格式不正确（应为一串字母数字，如 LTAI5t…）',
      );
    }
    const secretInput = text(body.accessKeySecret).trim();
    if (secretInput && (secretInput.length < 16 || secretInput.length > 128)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'AccessKeySecret 长度不正确，请原样复制控制台上的密钥',
      );
    }
    const secretCipher = secretInput
      ? this.crypto.encrypt(secretInput)
      : current?.accessKeySecretCipher || '';
    if (!secretCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 AccessKeySecret（已保存过可留空表示不修改）',
      );
    }
    const region = text(body.region).trim() || current?.region || 'cn-hangzhou';
    if (!DIRECTMAIL_REGIONS.some((item) => item.code === region)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '不支持该邮件推送地域，请选择与控制台一致的区域',
      );
    }
    const defaultReceiverId =
      body.defaultReceiverId === undefined
        ? current?.defaultReceiverId || ''
        : text(body.defaultReceiverId).trim();
    const defaultReceiverName =
      body.defaultReceiverName === undefined
        ? current?.defaultReceiverName || ''
        : text(body.defaultReceiverName).trim();
    const row = await this.prisma.aliyunMailSetting.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        accessKeyId,
        accessKeySecretCipher: secretCipher,
        region,
        defaultReceiverId,
        defaultReceiverName,
      },
      update: {
        accessKeyId,
        accessKeySecretCipher: secretCipher,
        region,
        defaultReceiverId,
        defaultReceiverName,
      },
    });
    await this.identity.audit(
      user.userId,
      '阿里云邮件推送设置',
      `保存 AccessKey ${maskAk(accessKeyId)} · ${region}${
        defaultReceiverName ? ` · 默认列表 ${defaultReceiverName}` : ''
      }`,
    );
    return this.settingsView(row);
  }

  private settingsView(row: SettingRow | null) {
    return {
      configured: !!row?.accessKeyId && !!row?.accessKeySecretCipher,
      accessKeyIdMasked: row ? maskAk(row.accessKeyId) : '',
      hasAccessKeySecret: !!row?.accessKeySecretCipher,
      region: row?.region || 'cn-hangzhou',
      defaultReceiverId: row?.defaultReceiverId || '',
      defaultReceiverName: row?.defaultReceiverName || '',
      updatedAt: row?.updatedAt.toISOString() || '',
    };
  }

  private async client(user: CurrentUser) {
    const row = await this.prisma.aliyunMailSetting.findUnique({
      where: { userId: user.userId },
    });
    if (!row?.accessKeyId || !row.accessKeySecretCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置阿里云 AccessKey，请先到「邮件设置」完成配置',
      );
    }
    return {
      client: new DirectMailClient({
        accessKeyId: row.accessKeyId,
        accessKeySecret: this.crypto.decrypt(row.accessKeySecretCipher),
        region: row.region,
      }),
      settings: row,
    };
  }

  // ---------- 上游只读目录 ----------

  async test(user: CurrentUser) {
    const { client } = await this.client(user);
    try {
      const receivers = await client.listReceivers();
      return {
        ok: true,
        receiverCount: receivers.length,
        messages: receivers.length
          ? []
          : ['当前账号下还没有收件人列表，可在「同步名单」里新建'],
      };
    } catch (error) {
      this.logUpstream('test', error);
      return {
        ok: false,
        receiverCount: 0,
        messages: [this.mapError(error)],
      };
    }
  }

  async senderAddresses(user: CurrentUser) {
    const { client } = await this.client(user);
    return this.guard(() => client.listSenderAddresses(), 'sender-addresses');
  }

  async receiverLists(user: CurrentUser, keyWord: string) {
    const { client } = await this.client(user);
    return this.guard(() => client.listReceivers(keyWord), 'receiver-lists');
  }

  async createReceiverList(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.receiverName).trim();
    const alias = text(body.receiverAlias).trim();
    const description = text(body.description).trim();
    if (!name || name.length > 30) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写收件人列表名称（1–30 个字符）',
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias) || alias.length >= 30) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '列表别称必须是邮箱地址且不超过 30 个字符',
      );
    }
    const { client } = await this.client(user);
    const lists = await this.guard(
      () => client.listReceivers(),
      'receiver-lists',
    );
    if (lists.length >= RECEIVER_LIST_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `账号下收件人列表已达 ${RECEIVER_LIST_LIMIT} 个上限，请先在阿里云控制台删除不用的列表`,
      );
    }
    const created = await this.guard(
      () => client.createReceiver({ name, alias, description }),
      'create-receiver',
    );
    await this.identity.audit(
      user.userId,
      '阿里云邮件推送列表',
      `新建收件人列表「${name}」(${created.receiverId})`,
    );
    return {
      receiverId: created.receiverId,
      receiverName: name,
      receiverAlias: alias,
      count: 0,
      createTime: new Date().toISOString(),
    };
  }

  // ---------- 预览 ----------

  async preview(user: CurrentUser, body: Record<string, unknown>) {
    const mode = text(body.mode) === 'append' ? 'append' : 'new';
    const tableId = requirePositiveId(body.tableId, '请选择多维表格');
    const table = await this.dataTable.get(user, tableId);
    const fields = this.fieldsOf(table.fields);
    const mapping = normalizeMapping(body.mapping, fields);
    const target = await this.resolveTarget(user, mode, body);
    const prepared = await this.prepareRows(
      user,
      tableId,
      table.rowCount,
      fields,
      mapping,
      {
        mode,
        receiverId: target.receiverId,
        currentCount: target.count,
      },
    );
    return prepared.preview;
  }

  // ---------- 同步 ----------

  async createImport(user: CurrentUser, body: Record<string, unknown>) {
    const mode = text(body.mode) === 'append' ? 'append' : 'new';
    const tableId = requirePositiveId(body.tableId, '请选择多维表格');
    const table = await this.dataTable.get(user, tableId);
    const fields = this.fieldsOf(table.fields);
    const mapping = normalizeMapping(body.mapping, fields);
    const target = await this.resolveTarget(user, mode, body);
    const prepared = await this.prepareRows(
      user,
      tableId,
      table.rowCount,
      fields,
      mapping,
      {
        mode,
        receiverId: target.receiverId,
        currentCount: target.count,
      },
    );
    if (prepared.preview.errors.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        prepared.preview.errors[0],
      );
    }
    const submittable = prepared.rows.filter((row) => row.status === 'pending');
    if (!submittable.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有可同步的邮箱（全部为空、重复或已推送过）',
      );
    }

    const importRow = await this.prisma.aliyunMailImport.create({
      data: {
        userId: user.userId,
        mode,
        tableId,
        tableName: table.name,
        mappingJson: {
          ...mapping,
          receiverAlias: target.receiverAlias,
          receiverDescription: target.description,
        },
        receiverId: mode === 'append' ? target.receiverId : '',
        receiverName: target.receiverName,
        status: 'queued',
        totalRows: prepared.rows.length,
        skippedRows: prepared.rows.filter((row) => row.status !== 'pending')
          .length,
      },
    });
    const rows = prepared.rows.map((row) => ({
      importId: importRow.id,
      sourceRowId: row.sourceRowId,
      emailMasked: row.emailMasked,
      emailHash: row.emailHash,
      status: row.status === 'pending' ? 'pending' : 'skipped',
      errorCode: row.status === 'pending' ? '' : 'SKIPPED',
      errorMessage: row.status === 'pending' ? '' : row.message,
    }));
    for (let index = 0; index < rows.length; index += 500) {
      await this.prisma.aliyunMailImportRow.createMany({
        data: rows.slice(index, index + 500),
      });
    }
    await this.identity.audit(
      user.userId,
      '阿里云邮件推送同步',
      `#${importRow.id} ${mode === 'new' ? '新建列表' : '追加'} · ${table.name} · ${submittable.length} 个邮箱`,
    );
    this.launch(importRow.id);
    return this.importView(importRow);
  }

  async listImports(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      query.page as number | string | undefined,
      query.pageSize as number | string | undefined,
      20,
    );
    const where = { userId: user.userId };
    const [list, total] = await Promise.all([
      this.prisma.aliyunMailImport.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.aliyunMailImport.count({ where }),
    ]);
    return {
      list: list.map((row) => this.importView(row)),
      total,
      page,
      pageSize,
    };
  }

  async importDetail(
    user: CurrentUser,
    id: number,
    query: Record<string, unknown>,
  ) {
    const row = await this.prisma.aliyunMailImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步批次不存在');
    }
    await this.recoverStale(row.id);
    const { page, pageSize, offset } = pageParam(
      query.page as number | string | undefined,
      query.pageSize as number | string | undefined,
      50,
    );
    const [rows, rowTotal] = await Promise.all([
      this.prisma.aliyunMailImportRow.findMany({
        where: { importId: row.id },
        orderBy: [{ id: 'asc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.aliyunMailImportRow.count({ where: { importId: row.id } }),
    ]);
    const fresh = await this.prisma.aliyunMailImport.findUnique({
      where: { id: row.id },
    });
    return {
      ...this.importView(fresh || row),
      mapping: recordJson(row.mappingJson),
      rows: rows.map((item) => ({
        id: item.id,
        sourceRowId: item.sourceRowId,
        emailMasked: item.emailMasked,
        status: item.status,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
      })),
      rowTotal,
      rowPage: page,
      rowPageSize: pageSize,
    };
  }

  async retryImport(user: CurrentUser, id: number) {
    const row = await this.prisma.aliyunMailImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步批次不存在');
    }
    if (row.status === 'running' || row.status === 'queued') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该批次正在同步，请等待当前进度结束',
      );
    }
    if (!row.receiverId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次还没有可用的收件人列表，无法重试',
      );
    }
    const failed = await this.prisma.aliyunMailImportRow.count({
      where: { importId: id, status: 'failed' },
    });
    if (!failed) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次没有失败行，无需重试',
      );
    }
    const claimed = await this.prisma.aliyunMailImport.updateMany({
      where: {
        id,
        userId: user.userId,
        status: { in: ['failed', 'partial'] },
      },
      data: {
        status: 'running',
        failedRows: 0,
        errorCode: '',
        errorMessage: '',
        startedAt: new Date(),
        finishedAt: null,
      },
    });
    if (!claimed.count) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该批次状态已变化，请刷新后重试',
      );
    }
    await this.prisma.aliyunMailImportRow.updateMany({
      where: { importId: id, status: 'failed' },
      data: { status: 'pending', errorCode: '', errorMessage: '' },
    });
    this.launch(id);
    const fresh = await this.prisma.aliyunMailImport.findUnique({
      where: { id },
    });
    return this.importView(fresh || row);
  }

  async refreshImport(user: CurrentUser, id: number) {
    const row = await this.prisma.aliyunMailImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步批次不存在');
    }
    if (!row.receiverId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次还没有创建收件人列表，无法回读人数',
      );
    }
    const { client } = await this.client(user);
    const lists = await this.guard(
      () => client.listReceivers(),
      'refresh-receiver',
    );
    const target = lists.find((item) => item.receiverId === row.receiverId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '收件人列表已不存在（可能已在控制台删除）',
      );
    }
    const fresh = await this.prisma.aliyunMailImport.update({
      where: { id },
      data: { listCount: target.count, receiverName: target.receiverName },
    });
    return this.importView(fresh);
  }

  // ---------- 执行 ----------

  /** 脱离请求上下文跑后台：请求结束后不继承 AbortSignal。 */
  private launch(importId: number) {
    runInRequestContext(() => {
      void this.executeImport(importId).catch((error) => {
        logger.error({
          importId,
          kind: 'execute-failed',
          error: this.errorInfo(error),
        });
        void this.prisma.aliyunMailImport
          .updateMany({
            where: { id: importId, status: 'running' },
            data: {
              status: 'failed',
              errorCode: 'INTERNAL',
              errorMessage: '同步执行中断，请稍后重试',
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      });
    });
  }

  private async executeImport(importId: number) {
    const row = await this.prisma.aliyunMailImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    if (row.status === 'queued') {
      const claimed = await this.prisma.aliyunMailImport.updateMany({
        where: { id: importId, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      if (!claimed.count) return;
    } else if (row.status !== 'running') {
      return;
    }
    const user = new CurrentUser(row.userId, '', '');
    try {
      if (row.mode === 'new' && !row.receiverId) {
        const mapping = recordJson(row.mappingJson);
        const { client } = await this.client(user);
        const created = await client.createReceiver({
          name: row.receiverName,
          alias: text(mapping.receiverAlias),
          description: text(mapping.receiverDescription) || undefined,
        });
        await this.prisma.aliyunMailImport.update({
          where: { id: importId },
          data: { receiverId: created.receiverId },
        });
        await this.identity.audit(
          row.userId,
          '阿里云邮件推送列表',
          `批次 #${importId} 新建收件人列表「${row.receiverName}」(${created.receiverId})`,
        );
      }
      await this.submitPendingRows(importId);
    } catch (error) {
      const message = this.mapError(error);
      this.logUpstream('execute', error);
      await this.prisma.aliyunMailImport.update({
        where: { id: importId },
        data: {
          status: 'failed',
          errorCode: errorCodeOf(error),
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      return;
    }
    await this.finish(importId);
  }

  private async submitPendingRows(importId: number) {
    const row = await this.prisma.aliyunMailImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    if (!row.receiverId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次没有收件人列表，无法写入联系人',
      );
    }
    const user = new CurrentUser(row.userId, '', '');
    const { client } = await this.client(user);
    const pending = await this.prisma.aliyunMailImportRow.findMany({
      where: { importId, status: 'pending' },
      orderBy: { id: 'asc' },
    });
    if (!pending.length) return;
    const source = await this.readSourceRows(user, row.tableId);
    const byId = new Map(source.map((item) => [item.id, item]));
    const fields = this.fieldsOf(
      (await this.dataTable.get(user, row.tableId)).fields,
    );
    const mapping = parseMapping(row.mappingJson);
    const fieldTypes = new Map(
      fields.map((field) => [field.fieldKey, field.fieldType]),
    );

    for (const batch of chunkRows(pending)) {
      const items: DmSaveItem[] = [];
      const usable: { id: number; email: string; hash: string }[] = [];
      for (const item of batch) {
        const sourceRow = byId.get(item.sourceRowId);
        if (!sourceRow) {
          await this.markRowFailed(
            item.id,
            'SOURCE_MISSING',
            '源表行已删除，无法重试',
          );
          continue;
        }
        const email = emailOf(sourceRow.data[mapping.emailFieldKey]).email;
        if (!email || hashEmail(email) !== item.emailHash) {
          await this.markRowFailed(
            item.id,
            'SOURCE_CHANGED',
            '源表邮箱已修改，请重新预览并同步',
          );
          continue;
        }
        const variables = buildVariables(sourceRow.data, mapping, fieldTypes);
        items.push({ email, data: toCustomData(variables) });
        usable.push({ id: item.id, email, hash: item.emailHash });
      }
      if (!items.length) continue;
      try {
        const result = await client.saveReceiverDetail({
          receiverId: row.receiverId,
          items,
        });
        await this.settleBatch(importId, usable, result, row.receiverId);
      } catch (error) {
        const message = this.mapError(error);
        this.logUpstream('save-receiver-detail', error);
        await this.prisma.aliyunMailImportRow.updateMany({
          where: { id: { in: usable.map((item) => item.id) } },
          data: {
            status: 'failed',
            errorCode: errorCodeOf(error),
            errorMessage: message,
          },
        });
        await this.prisma.aliyunMailImport.update({
          where: { id: importId },
          data: { failedRows: { increment: usable.length } },
        });
      }
    }
  }

  /** 按阿里云返回逐个落状态：成功 / 重复（阿里云已存在）/ 失败。 */
  private async settleBatch(
    importId: number,
    usable: { id: number; email: string; hash: string }[],
    result: {
      successCount: number;
      errorCount: number;
      failures: { email: string; message: string }[];
    },
    receiverId: string,
  ) {
    const failures = new Map(
      result.failures.map((item) => [item.email.trim().toLowerCase(), item]),
    );
    let unexplained = Math.max(result.errorCount - result.failures.length, 0);
    const groups = new Map<
      string,
      { status: 'success' | 'duplicate' | 'failed'; ids: number[] }
    >();
    const successful: string[] = [];
    for (const item of usable) {
      const failure = failures.get(item.email);
      let status: 'success' | 'duplicate' | 'failed';
      if (failure) {
        status = isDuplicateMessage(failure.message) ? 'duplicate' : 'failed';
      } else if (unexplained > 0) {
        unexplained -= 1;
        status = 'failed';
      } else {
        status = 'success';
      }
      const message = failure
        ? failure.message
        : status === 'failed'
          ? `阿里云返回 ${result.errorCount} 条失败但没有对应邮箱，请在控制台核对列表人数后重试`
          : status === 'duplicate'
            ? '该邮箱已在阿里云列表中，已跳过'
            : '';
      const key = `${status}|${message}`;
      const group = groups.get(key) || { status, ids: [] };
      group.ids.push(item.id);
      groups.set(key, group);
      if (status === 'success') successful.push(item.hash);
    }
    const successCount = groups.get(`success|`)?.ids.length || 0;
    const duplicateCount =
      [...groups.values()]
        .filter((group) => group.status === 'duplicate')
        .reduce((total, group) => total + group.ids.length, 0) || 0;
    const failedCount = usable.length - successCount - duplicateCount;

    const operations: Prisma.PrismaPromise<unknown>[] = [
      ...groups.entries(),
    ].map(([key, group]) => {
      const [status, message] = splitGroupKey(key);
      return this.prisma.aliyunMailImportRow.updateMany({
        where: { id: { in: group.ids } },
        data: {
          status,
          errorCode:
            status === 'success'
              ? ''
              : status === 'duplicate'
                ? 'EXISTS'
                : 'REJECTED',
          errorMessage: status === 'success' ? '' : message,
        },
      });
    });
    if (successCount || duplicateCount || failedCount) {
      operations.push(
        this.prisma.aliyunMailImport.update({
          where: { id: importId },
          data: {
            sentRows: { increment: successCount },
            skippedRows: { increment: duplicateCount },
            failedRows: { increment: failedCount },
          },
        }),
      );
    }
    await this.prisma.$transaction(operations);

    if (successful.length) {
      const userId = (
        await this.prisma.aliyunMailImport.findUnique({
          where: { id: importId },
          select: { userId: true },
        })
      )?.userId;
      if (userId) {
        await this.prisma.aliyunMailContact.createMany({
          data: successful.map((emailHash) => ({
            userId,
            receiverId,
            emailHash,
            lastImportId: importId,
          })),
          skipDuplicates: true,
        });
        await this.prisma.aliyunMailContact.updateMany({
          where: { userId, receiverId, emailHash: { in: successful } },
          data: { lastImportId: importId },
        });
      }
    }
  }

  private async markRowFailed(id: number, code: string, message: string) {
    const row = await this.prisma.aliyunMailImportRow.update({
      where: { id },
      data: { status: 'failed', errorCode: code, errorMessage: message },
    });
    await this.prisma.aliyunMailImport.update({
      where: { id: row.importId },
      data: { failedRows: { increment: 1 } },
    });
  }

  private async finish(importId: number) {
    const row = await this.prisma.aliyunMailImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    const counts = await this.prisma.aliyunMailImportRow.groupBy({
      by: ['status'],
      where: { importId },
      _count: { _all: true },
    });
    const count = (status: string) =>
      counts.find((item) => item.status === status)?._count._all || 0;
    const success = count('success');
    const failed = count('failed');
    const duplicate = count('duplicate');
    const skipped = count('skipped') + duplicate;
    const status =
      failed > 0
        ? success > 0
          ? 'partial'
          : 'failed'
        : success > 0 || duplicate > 0
          ? 'succeeded'
          : 'failed';
    let listCount = row.listCount;
    if (row.receiverId) {
      try {
        const { client } = await this.client(
          new CurrentUser(row.userId, '', ''),
        );
        const lists = await client.listReceivers(row.receiverName);
        listCount =
          lists.find((item) => item.receiverId === row.receiverId)?.count || 0;
      } catch (error) {
        logger.warn({
          importId,
          kind: 'list-count-failed',
          error: this.errorInfo(error),
        });
      }
    }
    await this.prisma.aliyunMailImport.update({
      where: { id: importId },
      data: {
        status,
        sentRows: success,
        failedRows: failed,
        skippedRows: skipped,
        listCount,
        finishedAt: new Date(),
      },
    });
    if (recordJson(row.mappingJson).writeBack === true) {
      await this.writeBack(row.id).catch((error) =>
        logger.warn({
          importId,
          kind: 'write-back-failed',
          error: this.errorInfo(error),
        }),
      );
    }
  }

  /** 结果回写原表：只对表归属账号生效（别人授权的表没有建列权）。 */
  private async writeBack(importId: number) {
    const row = await this.prisma.aliyunMailImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    const user = new CurrentUser(row.userId, '', '');
    const table = await this.dataTable.get(user, row.tableId);
    if (!table.owner) return;
    const existingKeys = new Set(table.fields.map((field) => field.fieldKey));
    const missing = WRITE_BACK_FIELDS.filter(
      (field) => !existingKeys.has(field.fieldKey),
    );
    if (missing.length) {
      await this.dataTable.addFields(
        user,
        row.tableId,
        missing.map((field) => ({ ...field })),
      );
    }
    const [rows, source] = await Promise.all([
      this.prisma.aliyunMailImportRow.findMany({ where: { importId } }),
      this.readSourceRows(user, row.tableId),
    ]);
    const byId = new Map(source.map((item) => [item.id, item.data]));
    const statusLabel: Record<string, string> = {
      success: '已同步',
      duplicate: '已存在',
      invalid: '邮箱无效',
      failed: '同步失败',
      skipped: '已跳过',
      pending: '未提交',
    };
    const queue = [...rows];
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        const current = byId.get(item.sourceRowId);
        if (!current) continue;
        try {
          await this.dataTable.updateRow(user, row.tableId, item.sourceRowId, {
            ...current,
            aliyun_mail_import_id: String(importId),
            aliyun_mail_list: row.receiverName,
            aliyun_mail_status: statusLabel[item.status] || item.status,
            aliyun_mail_error: item.errorMessage,
          });
        } catch (error) {
          logger.warn({
            importId,
            rowId: item.sourceRowId,
            kind: 'write-back-row-failed',
            error: this.errorInfo(error),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, () => worker()));
  }

  // ---------- 名单准备 ----------

  private async prepareRows(
    user: CurrentUser,
    tableId: number,
    rowCount: number,
    fields: FieldMeta[],
    mapping: Mapping,
    options: PrepareOptions,
  ) {
    const errors: string[] = [];
    const source = await this.readSourceRows(user, tableId);
    const existingHashes = new Set<string>();
    if (options.mode === 'append' && options.receiverId) {
      const hashes = [
        ...new Set(
          source
            .map((item) => emailOf(item.data[mapping.emailFieldKey]).email)
            .filter(Boolean)
            .map(hashEmail),
        ),
      ];
      for (let index = 0; index < hashes.length; index += 1000) {
        const found = await this.prisma.aliyunMailContact.findMany({
          where: {
            userId: user.userId,
            receiverId: options.receiverId,
            emailHash: { in: hashes.slice(index, index + 1000) },
          },
          select: { emailHash: true },
        });
        for (const item of found) existingHashes.add(item.emailHash);
      }
    }

    const fieldTypes = new Map(
      fields.map((field) => [field.fieldKey, field.fieldType]),
    );
    const remaining = Math.max(
      RECEIVER_CAPACITY - Math.max(options.currentCount, 0),
      0,
    );
    const seen = new Set<string>();
    const rows: PreparedRow[] = [];
    let accepted = 0;
    for (const item of source) {
      const parsed = emailOf(item.data[mapping.emailFieldKey]);
      const variables = buildVariables(item.data, mapping, fieldTypes);
      const base = {
        sourceRowId: item.id,
        email: parsed.email,
        emailMasked: parsed.email ? maskEmail(parsed.email) : '',
        emailHash: parsed.email ? hashEmail(parsed.email) : '',
        variables,
      };
      if (!parsed.email) {
        rows.push({
          ...base,
          status: 'invalid',
          message: parsed.message || '邮箱为空',
        });
        continue;
      }
      const problem = variableProblem(variables);
      if (problem) {
        rows.push({ ...base, status: 'invalid', message: problem });
        continue;
      }
      if (seen.has(parsed.email)) {
        rows.push({
          ...base,
          status: 'duplicate',
          message: '表内重复邮箱，已跳过',
        });
        continue;
      }
      seen.add(parsed.email);
      if (existingHashes.has(base.emailHash)) {
        rows.push({
          ...base,
          status: 'existing',
          message: '该列表已推送过该邮箱，已跳过',
        });
        continue;
      }
      if (accepted >= remaining) {
        rows.push({
          ...base,
          status: 'overflow',
          message: `超出列表剩余容量（最多还能加 ${remaining} 个）`,
        });
        continue;
      }
      accepted += 1;
      rows.push({ ...base, status: 'pending', message: '' });
    }

    const totalRows = Math.max(rowCount, source.length);
    if (totalRows > ALIYUN_MAIL_MAX_ROWS) {
      errors.push(
        `名单共 ${totalRows} 行，超过单次 ${ALIYUN_MAIL_MAX_ROWS} 行上限，请先在多维表格里筛选或拆分后再同步`,
      );
    }
    if (!totalRows) errors.push('该多维表格没有数据行');
    if (options.mode === 'append' && remaining === 0) {
      errors.push(
        `该列表已有 ${options.currentCount} 人，达到 ${RECEIVER_CAPACITY} 上限，请新建一个收件人列表`,
      );
    }
    if (!errors.length && !rows.some((row) => row.status === 'pending')) {
      const overflow = rows.filter((row) => row.status === 'overflow').length;
      errors.push(
        overflow
          ? '可同步的行超出列表剩余容量，请新建列表或减少名单'
          : '没有可同步的邮箱（全部为空、重复或已推送过）',
      );
    }

    const count = (status: PreparedRow['status']) =>
      rows.filter((row) => row.status === status).length;
    return {
      rows,
      preview: {
        fields,
        totalRows,
        validRows: count('pending'),
        invalidRows: count('invalid'),
        duplicateRows: count('duplicate'),
        existingRows: count('existing'),
        overflowRows: count('overflow'),
        currentCount: options.currentCount,
        capacity: RECEIVER_CAPACITY,
        sample: rows.slice(0, 20).map((row) => ({
          sourceRowId: row.sourceRowId,
          emailMasked: row.emailMasked,
          variables: row.variables,
          status: row.status === 'pending' ? 'ok' : row.status,
          message: row.message,
        })),
        errors,
      },
    };
  }

  private async readSourceRows(
    user: CurrentUser,
    tableId: number,
  ): Promise<SourceRow[]> {
    const rows: SourceRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await this.dataTable.listRowsByOffset(
        user,
        tableId,
        500,
        offset,
      );
      for (const item of batch) {
        rows.push({
          id: item.id,
          data:
            item.data &&
            typeof item.data === 'object' &&
            !Array.isArray(item.data)
              ? item.data
              : {},
        });
      }
      if (batch.length < 500) break;
      if (rows.length > ALIYUN_MAIL_MAX_ROWS) break;
    }
    // 列表接口按 id 倒序；同步按下标稳定排序，保证预览与提交顺序一致。
    return rows.sort((a, b) => a.id - b.id);
  }

  private async recoverStale(importId: number) {
    const stale = new Date(Date.now() - 15 * 60_000);
    await this.prisma.aliyunMailImport.updateMany({
      where: {
        id: importId,
        status: 'running',
        updatedAt: { lt: stale },
      },
      data: {
        status: 'failed',
        errorCode: 'INTERRUPTED',
        errorMessage: '执行中断（服务重启或超时），可对有失败行重试',
        finishedAt: new Date(),
      },
    });
  }

  // ---------- 目标列表 ----------

  /** 解析目标列表：新建返回 alias 供后续建表；追加回读当前人数与剩余容量。 */
  private async resolveTarget(
    user: CurrentUser,
    mode: 'new' | 'append',
    body: Record<string, unknown>,
  ) {
    if (mode === 'new') {
      const receiverName = text(body.receiverName).trim();
      const receiverAlias = text(body.receiverAlias).trim();
      const description = text(body.description).trim();
      if (!receiverName || receiverName.length > 30) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请填写收件人列表名称（1–30 个字符）',
        );
      }
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverAlias) ||
        receiverAlias.length >= 30
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '列表别称必须是邮箱地址且不超过 30 个字符',
        );
      }
      const { client } = await this.client(user);
      const lists = await this.guard(
        () => client.listReceivers(),
        'receiver-lists',
      );
      if (lists.length >= RECEIVER_LIST_LIMIT) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `账号下收件人列表已达 ${RECEIVER_LIST_LIMIT} 个上限，请先在阿里云控制台删除不用的列表`,
        );
      }
      return {
        receiverId: '',
        receiverName,
        receiverAlias,
        description,
        count: 0,
      };
    }
    const receiverId = text(body.receiverId).trim();
    if (!receiverId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择收件人列表');
    }
    const { client } = await this.client(user);
    const lists = await this.guard(
      () => client.listReceivers(),
      'receiver-lists',
    );
    const target = lists.find((item) => item.receiverId === receiverId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '收件人列表不存在（可能已在控制台删除），请刷新列表后重选',
      );
    }
    return {
      receiverId,
      receiverName: target.receiverName,
      receiverAlias: target.receiverAlias,
      description: '',
      count: target.count,
    };
  }

  private fieldsOf(
    fields: { fieldKey: string; name: string; fieldType: string }[],
  ): FieldMeta[] {
    return fields.map((field) => ({
      fieldKey: field.fieldKey,
      name: field.name,
      fieldType: field.fieldType,
    }));
  }

  // ---------- 视图与错误 ----------

  private importView(row: {
    id: number;
    mode: string;
    tableId: number;
    tableName: string;
    receiverId: string;
    receiverName: string;
    status: string;
    totalRows: number;
    sentRows: number;
    failedRows: number;
    skippedRows: number;
    errorCode: string;
    errorMessage: string;
    listCount: number;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      mode: row.mode,
      tableId: row.tableId,
      tableName: row.tableName,
      receiverId: row.receiverId,
      receiverName: row.receiverName,
      status: row.status,
      totalRows: row.totalRows,
      sentRows: row.sentRows,
      failedRows: row.failedRows,
      skippedRows: row.skippedRows,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      listCount: row.listCount,
      startedAt: row.startedAt?.toISOString() || '',
      finishedAt: row.finishedAt?.toISOString() || '',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async guard<T>(
    work: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logUpstream(operation, error);
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        this.mapError(error),
      );
    }
  }

  /** 上游错误翻成可操作中文；原始报文只进日志，不进界面。 */
  private mapError(error: unknown): string {
    if (error instanceof BusinessException) return error.message;
    if (error instanceof TransportError) {
      return error.kind === 'timeout'
        ? '连接阿里云超时，请稍后重试'
        : '连接阿里云失败，请检查网络后重试';
    }
    if (error instanceof DirectMailError) {
      const messages: Record<string, string> = {
        InvalidAccessKeyId:
          '阿里云 AccessKey 不正确或已失效，请到「邮件设置」重新保存',
        'InvalidAccessKeyId.NotFound':
          '阿里云 AccessKey 不正确或已失效，请到「邮件设置」重新保存',
        'InvalidAccessKeyId.Inactive':
          '阿里云 AccessKey 已被禁用，请到「邮件设置」换一个可用的子账号密钥',
        SignatureDoesNotMatch:
          'AccessKeySecret 与 AccessKeyId 不匹配，请重新填写密钥',
        InvalidAccessKeySecret:
          '阿里云 AccessKeySecret 不正确，请到「邮件设置」重新保存',
        NoPermission:
          '当前 RAM 子账号没有邮件推送权限，请授予 dm:CreateReceiver、dm:SaveReceiverDetail、dm:QueryReceiver* 权限',
        'Forbidden.RAM':
          '当前 RAM 子账号没有邮件推送权限，请授予 dm:CreateReceiver、dm:SaveReceiverDetail、dm:QueryReceiver* 权限',
        Forbidden: '当前 RAM 子账号没有邮件推送权限，请检查阿里云 RAM 授权',
        'InvalidReceiverName.Duplicate': '收件人列表名称已存在，请换一个名称',
        'InvalidReceiverName.Malformed': '收件人列表名称不合法（1–30 个字符）',
        'InvalidReceiverAlias.Malformed':
          '列表别称必须是邮箱地址且不超过 30 个字符',
        'InvalidReceiverAlias.Duplicate': '列表别称已被占用，请换一个邮箱',
        'InvalidReceiverNumber.Malformed':
          '账号下收件人列表已达 10 个上限，请先在阿里云控制台删除不用的列表',
        'InvalidReceiver.NotFound':
          '收件人列表不存在（可能已在控制台删除），请刷新列表后重选',
        'InvalidReceiverId.Malformed': '收件人列表 ID 不合法，请重新选择',
        'InvalidReceiverDetailMax.Malformed':
          '单批最多写入 500 个收件人，请减少单次导入量',
        'InvalidReceiverDetail.Malformed':
          '收件人内容不符合阿里云要求，请检查变量名与取值',
        'InvalidReceiverEmail.Malformed': '存在格式不正确的邮箱地址',
        InvalidQuota: '阿里云账号配额不足，请到邮件推送控制台查看额度',
        RecordLimit: '已达到阿里云的数量上限，请稍后再试或联系阿里云',
        'InvalidIP.NotFound':
          '账号开启了 IP 保护，请到邮件推送控制台把本系统出口 IP 加入白名单',
        Throttling: '阿里云接口繁忙，已自动重试一次，请稍后再试',
        InternalError: '阿里云服务暂时不可用，请稍后重试',
        ServiceUnavailable: '阿里云服务暂时不可用，请稍后重试',
      };
      return (
        messages[error.code] ||
        `阿里云邮件推送接口调用失败（${error.code || '未知错误'}）`
      );
    }
    return '阿里云邮件推送接口调用失败，请稍后重试';
  }

  private logUpstream(operation: string, error: unknown) {
    logger.warn({ operation, error: this.errorInfo(error) });
  }

  private errorInfo(error: unknown) {
    if (error instanceof DirectMailError) {
      return {
        name: error.name,
        code: error.code,
        requestId: error.requestId,
      };
    }
    if (error instanceof BusinessException) {
      return { name: error.name, code: error.errorCode.code };
    }
    if (error instanceof TransportError) {
      return { name: error.name, kind: error.kind };
    }
    return { name: (error as { name?: string })?.name || 'Error' };
  }
}

// ---------- 纯函数 ----------

export function requirePositiveId(value: unknown, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, message);
  }
  return parsed;
}

function recordJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function maskAk(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(`${EMAIL_HASH_KEY}|${email}`)
    .digest('hex');
}

/** 邮箱归一：全角转半角、trim、转小写；保守格式校验（不做 DNS 校验）。 */
export function emailOf(value: unknown): { email: string; message: string } {
  const raw = text(value).normalize('NFKC').trim().toLowerCase();
  if (!raw) return { email: '', message: '邮箱为空' };
  if (raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { email: '', message: '邮箱格式不正确' };
  }
  return { email: raw, message: '' };
}

export function maskEmail(email: string): string {
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!domain) return `${email.slice(0, 2)}****`;
  return `${name.slice(0, 2) || '*'}****@${domain}`;
}

function normalizeMapping(raw: unknown, fields: FieldMeta[]): Mapping {
  const input = recordJson(raw);
  const keys = new Set(fields.map((field) => field.fieldKey));
  const emailFieldKey = text(input.emailFieldKey).trim();
  if (!emailFieldKey) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择邮箱列');
  }
  if (!keys.has(emailFieldKey)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '邮箱列不属于这张表，请刷新后重选',
    );
  }
  const variablesRaw = Array.isArray(input.variables) ? input.variables : [];
  if (variablesRaw.length > MAX_VARIABLES) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `模板变量最多 ${MAX_VARIABLES} 个`,
    );
  }
  const variables: Mapping['variables'] = [];
  const seenKeys = new Set<string>();
  for (const item of variablesRaw) {
    const entry = recordJson(item);
    const key = text(entry.key).trim();
    const fieldKey = text(entry.fieldKey).trim();
    if (!key && !fieldKey) continue;
    if (!VARIABLE_KEY_PATTERN.test(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `模板变量名「${key || '(空)'}」不合法（只能用英文字母，如 UserName）`,
      );
    }
    if (seenKeys.has(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `模板变量名「${key}」重复`,
      );
    }
    if (!fieldKey || !keys.has(fieldKey)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `变量 ${key} 的来源列不属于这张表，请刷新后重选`,
      );
    }
    seenKeys.add(key);
    variables.push({ key, fieldKey });
  }
  return {
    emailFieldKey,
    variables,
    writeBack: input.writeBack !== false,
  };
}

function parseMapping(value: unknown): Mapping {
  const raw = recordJson(value);
  return {
    emailFieldKey: text(raw.emailFieldKey),
    variables: Array.isArray(raw.variables)
      ? raw.variables.map((item) => {
          const entry = recordJson(item);
          return {
            key: text(entry.key),
            fieldKey: text(entry.fieldKey),
          };
        })
      : [],
    writeBack: raw.writeBack !== false,
  };
}

/** 单元格取值：日期统一 YYYY-MM-DD，数组用逗号连接，其余转字符串。 */
function cellText(value: unknown, fieldType: string): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => cellText(item, ''))
      .filter(Boolean)
      .join(',');
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  const raw = (
    typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  ).trim();
  if (!raw) return '';
  if (fieldType === 'date' || fieldType === 'datetime') {
    const matched = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (matched) return matched[1];
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return raw;
}

function buildVariables(
  data: Record<string, unknown>,
  mapping: Mapping,
  fieldTypes: Map<string, string>,
): { key: string; value: string }[] {
  const variables: { key: string; value: string }[] = [];
  for (const variable of mapping.variables) {
    const value = cellText(
      data[variable.fieldKey],
      fieldTypes.get(variable.fieldKey) || '',
    );
    if (value !== '') variables.push({ key: variable.key, value });
  }
  return variables;
}

/** 变量级问题（超长 / JSON 超 6k）返回中文原因；不静默截断。 */
function variableProblem(variables: { key: string; value: string }[]): string {
  for (const variable of variables) {
    const limit = STANDARD_VARIABLE_LIMITS[variable.key];
    if (limit && variable.value.length > limit) {
      return `变量 ${variable.key} 超过 ${limit} 个字符`;
    }
  }
  const customData = toCustomData(variables);
  if (
    Buffer.byteLength(JSON.stringify(customData), 'utf8') >
    CUSTOM_DATA_MAX_BYTES
  ) {
    return `模板变量内容超过 ${CUSTOM_DATA_MAX_BYTES} 字节`;
  }
  return '';
}

function toCustomData(
  variables: { key: string; value: string }[],
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const variable of variables) data[variable.key] = variable.value;
  return data;
}

/** 按 500 条与请求体字节双上限切批（500 × 长变量可能超过表单上限）。 */
export function chunkRows<T extends { id: number }>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8') + 16;
    if (
      current.length >= BATCH_SIZE ||
      (current.length && bytes + size > BATCH_MAX_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function splitGroupKey(key: string): [string, string] {
  const index = key.indexOf('|');
  return [key.slice(0, index), key.slice(index + 1)];
}

function isDuplicateMessage(message: string): boolean {
  return /exist|duplicate|重复|已存在/i.test(message);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof DirectMailError) return error.code || 'UPSTREAM';
  if (error instanceof TransportError) return 'NETWORK';
  if (error instanceof BusinessException) return 'BAD_REQUEST';
  return 'INTERNAL';
}
