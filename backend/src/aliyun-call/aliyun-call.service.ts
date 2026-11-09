import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import { pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { runInRequestContext } from '../common/request-context';
import { DataTableService } from '../data-table/data-table.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonInput } from '../common/json-input';
import { TransportError } from '../http/transport';
import { AliyunCallCrypto } from './aliyun-call-crypto';
import {
  APPENDABLE_STATUSES,
  OUTBOUNDBOT_REGIONS,
  OutboundBotClient,
  OutboundBotError,
  type ObAssignJob,
} from './outboundbot.client';

/**
 * 阿里云智能外呼（营销工具）：
 * - 名单来源＝本系统多维表格（含飞书同步进来的本地行）；
 * - 每条登录账号用自己的阿里云 RAM 子账号 AK（加密落库）；
 * - 新建任务组走 CreateJobGroup，追加走同一 JobGroup 的 AssignJobs，不改原策略；
 * - 本地按「账号 + 任务组 + 号码哈希」幂等，失败行可单独重试；
 * - 号码只落打码值与 SHA-256，重试时按 source_row_id 回原表取号。
 */

export const ALIYUN_CALL_MAX_ROWS = 2000;
const BATCH_SIZE = 25;
const PHONE_HASH_KEY = 'aiworkin-aliyun-call-phone';
const WRITE_BACK_FIELDS = [
  { fieldKey: 'aliyun_import_id', name: '外呼批次', fieldType: 'text' },
  { fieldKey: 'aliyun_job_group_id', name: '外呼任务组 ID', fieldType: 'text' },
  { fieldKey: 'aliyun_submit_status', name: '外呼提交状态', fieldType: 'text' },
  { fieldKey: 'aliyun_error', name: '外呼失败原因', fieldType: 'text' },
] as const;
const EXTRA_KEY_PATTERN = /^[A-Za-z0-9_]+$/;

type FieldMeta = { fieldKey: string; name: string; fieldType: string };

type SettingRow = {
  accessKeyId: string;
  accessKeySecretCipher: string;
  region: string;
  instanceId: string;
  updatedAt: Date;
};

type Mapping = {
  phoneFieldKey: string;
  nameFieldKey: string;
  honorificMode: 'none' | 'field' | 'gender' | 'fixed';
  honorificFieldKey: string;
  honorificValue: string;
  genderFieldKey: string;
  roleFieldKey: string;
  extras: {
    key: string;
    sourceType: 'field' | 'fixed';
    fieldKey: string;
    value: string;
  }[];
};

type PreparedRow = {
  sourceRowId: number;
  referenceId: string;
  name: string;
  phone: string;
  phoneMasked: string;
  phoneHash: string;
  honorific: string;
  role: string;
  extras: { key: string; value: string }[];
  /** pending 才会提交；其余在预览里展示原因 */
  status: 'pending' | 'invalid' | 'duplicate' | 'existing';
  message: string;
};

type SourceRow = {
  id: number;
  data: Record<string, unknown>;
};

type ImportOptions = {
  mode: 'new' | 'append';
  jobGroupId: string;
  skipExisting: boolean;
};

const logger = new Logger('AliyunCallService');

export class AliyunCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: AliyunCallCrypto,
    private readonly dataTable: DataTableService,
  ) {}

  // ---------- 设置 ----------

  async getSettings(user: CurrentUser) {
    const row = await this.prisma.aliyunCallSetting.findUnique({
      where: { userId: user.userId },
    });
    return this.settingsView(row);
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const current = await this.prisma.aliyunCallSetting.findUnique({
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
    const region = text(body.region).trim() || current?.region || 'cn-shanghai';
    if (!OUTBOUNDBOT_REGIONS.some((item) => item.code === region)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '阿里云智能外呼仅支持华东 2（上海）',
      );
    }
    const instanceId =
      body.instanceId === undefined
        ? current?.instanceId || ''
        : text(body.instanceId).trim();
    const row = await this.prisma.aliyunCallSetting.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        accessKeyId,
        accessKeySecretCipher: secretCipher,
        region,
        instanceId,
      },
      update: {
        accessKeyId,
        accessKeySecretCipher: secretCipher,
        region,
        instanceId,
      },
    });
    await this.identity.audit(
      user.userId,
      '阿里云外呼设置',
      `保存 AccessKey ${maskAk(accessKeyId)} · ${region}${
        instanceId ? ` · 实例 ${instanceId}` : ''
      }`,
    );
    return this.settingsView(row);
  }

  private settingsView(row: SettingRow | null) {
    return {
      configured: !!row?.accessKeyId && !!row?.accessKeySecretCipher,
      accessKeyIdMasked: row ? maskAk(row.accessKeyId) : '',
      hasSecret: !!row?.accessKeySecretCipher,
      region: row?.region || 'cn-shanghai',
      instanceId: row?.instanceId || '',
      updatedAt: row?.updatedAt.toISOString() || '',
    };
  }

  private async client(user: CurrentUser) {
    const row = await this.prisma.aliyunCallSetting.findUnique({
      where: { userId: user.userId },
    });
    if (!row?.accessKeyId || !row.accessKeySecretCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置阿里云 AccessKey，请先到「外呼设置」完成配置',
      );
    }
    return {
      client: new OutboundBotClient({
        accessKeyId: row.accessKeyId,
        accessKeySecret: this.crypto.decrypt(row.accessKeySecretCipher),
        region: row.region,
      }),
      settings: row,
    };
  }

  // ---------- 上游只读目录 ----------

  async test(user: CurrentUser) {
    const { client, settings } = await this.client(user);
    const messages: string[] = [];
    let instances: Awaited<ReturnType<OutboundBotClient['listInstances']>> = [];
    try {
      instances = await client.listInstances();
    } catch (error) {
      messages.push(`读取业务实例失败：${this.mapError(error)}`);
      this.logUpstream('test:instances', error);
      return { ok: false, instances: [], scripts: [], numbers: [], messages };
    }
    const instanceId = settings.instanceId || instances[0]?.instanceId || '';
    if (!instanceId) {
      messages.push('该账号下没有可用的业务实例，请先在阿里云控制台创建');
      return { ok: false, instances, scripts: [], numbers: [], messages };
    }
    let scripts: Awaited<
      ReturnType<OutboundBotClient['listPublishedScripts']>
    > = [];
    try {
      scripts = await client.listPublishedScripts(instanceId);
      if (!scripts.length) {
        messages.push('该实例下没有已发布的话术，请先在阿里云控制台发布话术');
      }
    } catch (error) {
      messages.push(`读取已发布话术失败：${this.mapError(error)}`);
      this.logUpstream('test:scripts', error);
    }
    let numbers: Awaited<ReturnType<OutboundBotClient['listCallingNumbers']>> =
      [];
    try {
      numbers = await client.listCallingNumbers(instanceId);
      if (!numbers.length) {
        messages.push('该实例下没有已绑定的主叫号码，任务不会被拨出');
      }
    } catch (error) {
      messages.push(`读取主叫号码失败：${this.mapError(error)}`);
      this.logUpstream('test:numbers', error);
    }
    return {
      ok: messages.length === 0,
      instances,
      scripts,
      numbers,
      messages,
    };
  }

  async instances(user: CurrentUser) {
    const { client } = await this.client(user);
    return this.guard(() => client.listInstances(), 'instances');
  }

  async scripts(user: CurrentUser, instanceId: string) {
    const { client, settings } = await this.client(user);
    const target = instanceId.trim() || settings.instanceId;
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    return this.guard(() => client.listPublishedScripts(target), 'scripts');
  }

  async callingNumbers(user: CurrentUser, instanceId: string) {
    const { client, settings } = await this.client(user);
    const target = instanceId.trim() || settings.instanceId;
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    return this.guard(() => client.listCallingNumbers(target), 'numbers');
  }

  async jobGroups(
    user: CurrentUser,
    input: {
      instanceId: string;
      search: string;
      page: number;
      pageSize: number;
    },
  ) {
    const { client, settings } = await this.client(user);
    const target = input.instanceId.trim() || settings.instanceId;
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    const result = await this.guard(
      () =>
        client.listJobGroups({
          instanceId: target,
          search: input.search.trim(),
          page: input.page,
          pageSize: input.pageSize,
        }),
      'job-groups',
    );
    return {
      list: result.list,
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async jobGroupStatus(
    user: CurrentUser,
    jobGroupId: string,
    instanceId: string,
  ) {
    const { client, settings } = await this.client(user);
    const target = instanceId.trim() || settings.instanceId;
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    return this.guard(
      () => client.describeJobGroup(target, jobGroupId.trim()),
      'job-group-status',
    );
  }

  // ---------- 预览 ----------

  async preview(user: CurrentUser, body: Record<string, unknown>) {
    const tableId = requirePositiveId(body.tableId, '请选择多维表格');
    const table = await this.dataTable.get(user, tableId);
    const fields = table.fields.map((field) => ({
      fieldKey: field.fieldKey,
      name: field.name,
      fieldType: field.fieldType,
    }));
    const mapping = normalizeMapping(body.mapping, fields);
    const prepared = await this.prepareRows(
      user,
      tableId,
      table.rowCount,
      fields,
      mapping,
      {
        mode: text(body.mode) === 'append' ? 'append' : 'new',
        jobGroupId: text(body.jobGroupId).trim(),
        skipExisting: body.skipExisting !== false,
      },
    );
    return prepared.preview;
  }

  // ---------- 导入 ----------

  async createImport(user: CurrentUser, body: Record<string, unknown>) {
    if (body.confirmCost !== true) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先确认「导入后会产生真实通话费用」',
      );
    }
    const mode = text(body.mode) === 'append' ? 'append' : 'new';
    const tableId = requirePositiveId(body.tableId, '请选择多维表格');
    const instanceId = text(body.instanceId).trim();
    if (!instanceId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择阿里云业务实例',
      );
    }
    const table = await this.dataTable.get(user, tableId);
    const fields = table.fields.map((field) => ({
      fieldKey: field.fieldKey,
      name: field.name,
      fieldType: field.fieldType,
    }));
    const mapping = normalizeMapping(body.mapping, fields);
    const jobGroupId = text(body.jobGroupId).trim();
    const jobGroupName = text(body.jobGroupName).trim();
    const scriptId = text(body.scriptId).trim();
    const skipExisting = body.skipExisting !== false;
    const writeBack = body.writeBack === true;
    const callingNumbers = Array.isArray(body.callingNumbers)
      ? body.callingNumbers
          .map((item) => text(item).replace(/\D/g, ''))
          .filter(Boolean)
          .slice(0, 20)
      : [];

    if (mode === 'new') {
      if (!scriptId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择已发布的话术（草稿话术不能发起外呼）',
        );
      }
      if (!jobGroupName) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务组名称');
      }
    } else if (!jobGroupId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要追加号码的任务组',
      );
    }

    const { client } = await this.client(user);
    if (mode === 'append') {
      const status = await this.guard(
        () => client.describeJobGroup(instanceId, jobGroupId),
        'append-status',
      );
      if (
        !APPENDABLE_STATUSES.includes(
          status.jobGroupStatus as (typeof APPENDABLE_STATUSES)[number],
        )
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '该任务组已结束（已完成 / 失败 / 已取消），不能再追加号码，请新建任务组',
        );
      }
    }

    const prepared = await this.prepareRows(
      user,
      tableId,
      table.rowCount,
      fields,
      mapping,
      { mode, jobGroupId, skipExisting },
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
        '没有可提交的号码（全部为空、重复或已导入）',
      );
    }

    const strategy = mode === 'new' ? buildStrategy(body.strategy) : null;
    const importRow = await this.prisma.aliyunCallImport.create({
      data: {
        userId: user.userId,
        mode,
        tableId,
        tableName: table.name,
        mappingJson: { ...mapping, skipExisting, writeBack },
        instanceId,
        scriptId,
        jobGroupId: mode === 'append' ? jobGroupId : '',
        jobGroupName:
          jobGroupName ||
          (mode === 'append' ? jobGroupId : buildDefaultName(table.name)),
        strategyJson: strategy === null ? undefined : toJsonInput(strategy),
        callingNumbers: callingNumbers.length ? callingNumbers : undefined,
        status: 'queued',
        totalRows: prepared.rows.length,
        skippedRows: prepared.rows.filter((row) => row.status !== 'pending')
          .length,
      },
    });
    const rows = prepared.rows.map((row) => ({
      importId: importRow.id,
      sourceRowId: row.sourceRowId,
      referenceId: row.referenceId,
      name: row.name,
      phoneMasked: row.phoneMasked,
      phoneHash: row.phoneHash,
      status: row.status === 'pending' ? 'pending' : 'skipped',
      errorCode: row.status === 'pending' ? '' : 'SKIPPED',
      errorMessage:
        row.status === 'pending'
          ? ''
          : row.message ||
            (row.status === 'duplicate'
              ? '表内重复号码'
              : row.status === 'existing'
                ? '该任务组已导入过该号码'
                : '号码无效'),
    }));
    for (let index = 0; index < rows.length; index += 500) {
      await this.prisma.aliyunCallImportRow.createMany({
        data: rows.slice(index, index + 500),
      });
    }
    await this.identity.audit(
      user.userId,
      '阿里云外呼导入',
      `#${importRow.id} ${mode === 'new' ? '新建' : '追加'} · ${table.name} · ${submittable.length} 个号码`,
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
      this.prisma.aliyunCallImport.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.aliyunCallImport.count({ where }),
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
    const row = await this.prisma.aliyunCallImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '导入批次不存在');
    await this.recoverStale(row.id);
    const { page, pageSize, offset } = pageParam(
      query.page as number | string | undefined,
      query.pageSize as number | string | undefined,
      50,
    );
    const [rows, rowTotal] = await Promise.all([
      this.prisma.aliyunCallImportRow.findMany({
        where: { importId: row.id },
        orderBy: [{ id: 'asc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.aliyunCallImportRow.count({ where: { importId: row.id } }),
    ]);
    const fresh = await this.prisma.aliyunCallImport.findUnique({
      where: { id: row.id },
    });
    return {
      ...this.importView(fresh || row),
      mapping: recordJson(row.mappingJson),
      rows: rows.map((item) => ({
        id: item.id,
        sourceRowId: item.sourceRowId,
        referenceId: item.referenceId,
        name: item.name,
        phoneMasked: item.phoneMasked,
        status: item.status,
        jobId: item.jobId,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
      })),
      rowTotal,
      rowPage: page,
      rowPageSize: pageSize,
    };
  }

  async retryImport(user: CurrentUser, id: number) {
    const row = await this.prisma.aliyunCallImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '导入批次不存在');
    if (row.status === 'running' || row.status === 'queued') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该批次正在提交，请等待当前进度结束',
      );
    }
    const failed = await this.prisma.aliyunCallImportRow.count({
      where: { importId: id, status: 'failed' },
    });
    if (!failed) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次没有失败行，无需重试',
      );
    }
    const claimed = await this.prisma.aliyunCallImport.updateMany({
      where: { id, userId: user.userId, status: { in: ['failed', 'partial'] } },
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
    await this.prisma.aliyunCallImportRow.updateMany({
      where: { importId: id, status: 'failed' },
      data: { status: 'pending', errorCode: '', errorMessage: '' },
    });
    this.launch(id);
    const fresh = await this.prisma.aliyunCallImport.findUnique({
      where: { id },
    });
    return this.importView(fresh || row);
  }

  async refreshImport(user: CurrentUser, id: number) {
    const row = await this.prisma.aliyunCallImport.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '导入批次不存在');
    if (!row.jobGroupId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该批次还没有创建任务组，无法刷新进度',
      );
    }
    if (row.syncedAt && Date.now() - row.syncedAt.getTime() < 60_000) {
      return this.importView(row);
    }
    const { client, settings } = await this.client(user);
    const status = await this.guard(
      () =>
        client.describeJobGroup(
          row.instanceId || settings.instanceId,
          row.jobGroupId,
        ),
      'refresh-status',
    );
    const fresh = await this.prisma.aliyunCallImport.update({
      where: { id },
      data: { jobGroupStatus: status.jobGroupStatus, syncedAt: new Date() },
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
        void this.prisma.aliyunCallImport
          .updateMany({
            where: { id: importId, status: 'running' },
            data: {
              status: 'failed',
              errorCode: 'INTERNAL',
              errorMessage: '导入执行中断，请稍后重试',
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      });
    });
  }

  private async executeImport(importId: number) {
    const row = await this.prisma.aliyunCallImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    if (row.status === 'queued') {
      const claimed = await this.prisma.aliyunCallImport.updateMany({
        where: { id: importId, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      if (!claimed.count) return;
    } else if (row.status !== 'running') {
      return;
    }
    const user = new CurrentUser(row.userId, '', '');
    try {
      if (row.mode === 'new' && !row.jobGroupId) {
        const { client } = await this.client(user);
        const created = await client.createJobGroup({
          instanceId: row.instanceId,
          name: row.jobGroupName,
          scriptId: row.scriptId,
          strategyJson: row.strategyJson
            ? JSON.stringify(row.strategyJson)
            : undefined,
          callingNumbers: stringArray(row.callingNumbers),
        });
        await this.prisma.aliyunCallImport.update({
          where: { id: importId },
          data: {
            jobGroupId: created.jobGroupId,
            jobGroupStatus: created.status,
          },
        });
      }
      await this.submitPendingRows(importId);
    } catch (error) {
      const message = this.mapError(error);
      this.logUpstream('execute', error);
      await this.prisma.aliyunCallImport.update({
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
    const row = await this.prisma.aliyunCallImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    const user = new CurrentUser(row.userId, '', '');
    const { client } = await this.client(user);
    const pending = await this.prisma.aliyunCallImportRow.findMany({
      where: { importId, status: 'pending' },
      orderBy: { id: 'asc' },
    });
    if (!pending.length) return;
    const source = await this.readSourceRows(user, row.tableId);
    const byId = new Map(source.map((item) => [item.id, item]));
    const mapping = parseMapping(row.mappingJson);
    const callingNumbers = stringArray(row.callingNumbers);

    for (let index = 0; index < pending.length; index += BATCH_SIZE) {
      const batch = pending.slice(index, index + BATCH_SIZE);
      const jobs: ObAssignJob[] = [];
      const usable: typeof batch = [];
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
        const phone = phoneOf(sourceRow.data[mapping.phoneFieldKey]);
        if (!phone.phone || hashPhone(phone.phone) !== item.phoneHash) {
          await this.markRowFailed(
            item.id,
            'SOURCE_CHANGED',
            '源表号码已修改，请重新预览并导入',
          );
          continue;
        }
        jobs.push(
          buildJob(item.referenceId, phone.phone, sourceRow.data, mapping),
        );
        usable.push(item);
      }
      if (!jobs.length) continue;
      try {
        // 策略只属于任务组（CreateJobGroup 已写入）；追加时必须沿用原策略，不能再传。
        const result = await client.assignJobs({
          instanceId: row.instanceId,
          jobGroupId: row.jobGroupId,
          jobs,
          callingNumbers,
        });
        await this.markRowsSent(row.id, usable, result.jobsId);
      } catch (error) {
        const message = this.mapError(error);
        this.logUpstream('assign-jobs', error);
        await this.prisma.aliyunCallImportRow.updateMany({
          where: { id: { in: usable.map((item) => item.id) } },
          data: {
            status: 'failed',
            errorCode: errorCodeOf(error),
            errorMessage: message,
          },
        });
        await this.prisma.aliyunCallImport.update({
          where: { id: importId },
          data: { failedRows: { increment: usable.length } },
        });
      }
    }
  }

  private async markRowsSent(
    importId: number,
    rows: { id: number }[],
    jobsId: string[],
  ) {
    if (!rows.length) return;
    await this.prisma.$transaction([
      ...rows.map((row, index) =>
        this.prisma.aliyunCallImportRow.update({
          where: { id: row.id },
          data: {
            status: 'sent',
            jobId: jobsId[index] || '',
            errorCode: '',
            errorMessage: '',
          },
        }),
      ),
      this.prisma.aliyunCallImport.update({
        where: { id: importId },
        data: { sentRows: { increment: rows.length } },
      }),
    ]);
  }

  private async markRowFailed(id: number, code: string, message: string) {
    const row = await this.prisma.aliyunCallImportRow.update({
      where: { id },
      data: { status: 'failed', errorCode: code, errorMessage: message },
    });
    await this.prisma.aliyunCallImport.update({
      where: { id: row.importId },
      data: { failedRows: { increment: 1 } },
    });
  }

  private async finish(importId: number) {
    const row = await this.prisma.aliyunCallImport.findUnique({
      where: { id: importId },
    });
    if (!row) return;
    const counts = await this.prisma.aliyunCallImportRow.groupBy({
      by: ['status'],
      where: { importId },
      _count: { _all: true },
    });
    const count = (status: string) =>
      counts.find((item) => item.status === status)?._count._all || 0;
    const sent = count('sent');
    const failed = count('failed');
    const skipped = count('skipped');
    const status =
      sent > 0 && failed === 0
        ? 'succeeded'
        : sent > 0 && failed > 0
          ? 'partial'
          : 'failed';
    await this.prisma.aliyunCallImport.update({
      where: { id: importId },
      data: {
        status,
        sentRows: sent,
        failedRows: failed,
        skippedRows: skipped,
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
    const row = await this.prisma.aliyunCallImport.findUnique({
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
      this.prisma.aliyunCallImportRow.findMany({ where: { importId } }),
      this.readSourceRows(user, row.tableId),
    ]);
    const byId = new Map(source.map((item) => [item.id, item.data]));
    const statusLabel: Record<string, string> = {
      sent: '已提交',
      failed: '提交失败',
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
            aliyun_import_id: String(importId),
            aliyun_job_group_id: row.jobGroupId,
            aliyun_submit_status: statusLabel[item.status] || item.status,
            aliyun_error: item.errorMessage,
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
    options: ImportOptions,
  ) {
    const errors: string[] = [];
    const source = await this.readSourceRows(user, tableId);
    const existingHashes = new Set<string>();
    if (
      options.mode === 'append' &&
      options.jobGroupId &&
      options.skipExisting
    ) {
      const hashes = [
        ...new Set(
          source
            .map((item) => phoneOf(item.data[mapping.phoneFieldKey]).phone)
            .filter(Boolean)
            .map(hashPhone),
        ),
      ];
      if (hashes.length) {
        const existing = await this.prisma.aliyunCallImportRow.findMany({
          where: {
            phoneHash: { in: hashes },
            status: 'sent',
            import: {
              is: { userId: user.userId, jobGroupId: options.jobGroupId },
            },
          },
          select: { phoneHash: true },
          take: hashes.length,
        });
        for (const item of existing) existingHashes.add(item.phoneHash);
      }
    }

    const seen = new Set<string>();
    const rows: PreparedRow[] = [];
    for (const item of source) {
      const parsed = phoneOf(item.data[mapping.phoneFieldKey]);
      const name = text(item.data[mapping.nameFieldKey]).trim() || '客户';
      // 阿里云 FAQ：honorific 实际必传（不校验内容），空值统一补「客户」。
      const honorific = resolveHonorific(item.data, mapping) || '客户';
      const role = text(item.data[mapping.roleFieldKey]).trim();
      const extras = mapping.extras
        .map((extra) => ({
          key: extra.key,
          value:
            extra.sourceType === 'field'
              ? text(item.data[extra.fieldKey]).trim()
              : extra.value.trim(),
        }))
        .filter((extra) => extra.value !== '');
      const referenceId = `dt${tableId}r${item.id}`;
      const base = {
        sourceRowId: item.id,
        referenceId,
        name,
        phone: parsed.phone,
        phoneMasked: maskPhone(parsed.phone),
        phoneHash: parsed.phone ? hashPhone(parsed.phone) : '',
        honorific,
        role,
        extras,
      };
      if (!parsed.phone) {
        rows.push({
          ...base,
          status: 'invalid',
          message: parsed.message || '被叫号码为空',
        });
        continue;
      }
      if (seen.has(parsed.phone)) {
        rows.push({
          ...base,
          status: 'duplicate',
          message: '表内重复号码，已跳过',
        });
        continue;
      }
      seen.add(parsed.phone);
      if (existingHashes.has(base.phoneHash)) {
        rows.push({
          ...base,
          status: 'existing',
          message: '该任务组已导入过该号码，已跳过',
        });
        continue;
      }
      rows.push({
        ...base,
        status: 'pending',
        message: parsed.warning,
      });
    }

    const totalRows = Math.max(rowCount, source.length);
    if (totalRows > ALIYUN_CALL_MAX_ROWS) {
      errors.push(
        `名单共 ${totalRows} 行，超过单次 ${ALIYUN_CALL_MAX_ROWS} 行上限，请先在多维表格里筛选或拆分后再导入`,
      );
    }
    if (!totalRows) errors.push('该多维表格没有数据行');
    if (!errors.length && !rows.some((row) => row.status === 'pending')) {
      errors.push('没有可提交的号码（全部为空、重复或已导入）');
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
        sample: rows.slice(0, 20).map((row) => ({
          sourceRowId: row.sourceRowId,
          name: row.name,
          phoneMasked: row.phoneMasked,
          honorific: row.honorific,
          role: row.role,
          extras: row.extras,
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
      if (rows.length > ALIYUN_CALL_MAX_ROWS) break;
    }
    // 列表接口按 id 倒序；导入按下标稳定排序，保证预览与提交顺序一致。
    return rows.sort((a, b) => a.id - b.id);
  }

  private async recoverStale(importId: number) {
    const stale = new Date(Date.now() - 15 * 60_000);
    await this.prisma.aliyunCallImport.updateMany({
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

  // ---------- 视图与错误 ----------

  private importView(row: {
    id: number;
    mode: string;
    tableId: number;
    tableName: string;
    instanceId: string;
    scriptId: string;
    jobGroupId: string;
    jobGroupName: string;
    status: string;
    totalRows: number;
    sentRows: number;
    failedRows: number;
    skippedRows: number;
    errorCode: string;
    errorMessage: string;
    jobGroupStatus: string;
    syncedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      mode: row.mode,
      tableId: row.tableId,
      tableName: row.tableName,
      instanceId: row.instanceId,
      scriptId: row.scriptId,
      jobGroupId: row.jobGroupId,
      jobGroupName: row.jobGroupName,
      status: row.status,
      totalRows: row.totalRows,
      sentRows: row.sentRows,
      failedRows: row.failedRows,
      skippedRows: row.skippedRows,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      jobGroupStatus: row.jobGroupStatus,
      syncedAt: row.syncedAt?.toISOString() || '',
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
    if (error instanceof OutboundBotError) {
      const messages: Record<string, string> = {
        InvalidAccessKeyId:
          'AccessKeyId 不存在或已被禁用，请到「外呼设置」重新填写',
        'InvalidAccessKeyId.NotFound':
          'AccessKeyId 不存在或已被禁用，请到「外呼设置」重新填写',
        SignatureDoesNotMatch:
          'AccessKeySecret 与 AccessKeyId 不匹配，请重新填写密钥',
        InvalidAccessKeySecret: 'AccessKeySecret 不正确，请重新填写',
        NoPermission: '该子账号没有智能外呼的操作权限，请检查 RAM 授权',
        'Forbidden.RAM': '该子账号没有智能外呼的操作权限，请检查 RAM 授权',
        'Forbidden.Instance': '该子账号没有这个业务实例的权限',
        'NotExist.Instance': '业务实例不存在，请核对实例 ID 与地域',
        'NotExist.Script': '话术不存在或已删除，请重新选择',
        InvalidParameter: '提交参数不符合阿里云要求，请检查任务组与话术配置',
        Throttling: '阿里云接口限流，请稍后重试',
        InternalError: '阿里云服务暂时不可用，请稍后重试',
        ServiceUnavailable: '阿里云服务暂时不可用，请稍后重试',
      };
      return (
        messages[error.code] ||
        `阿里云接口调用失败（${error.code || '未知错误'}）`
      );
    }
    return '阿里云接口调用失败，请稍后重试';
  }

  private logUpstream(operation: string, error: unknown) {
    logger.warn({ operation, error: this.errorInfo(error) });
  }

  private errorInfo(error: unknown) {
    if (error instanceof OutboundBotError) {
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

function requirePositiveId(value: unknown, message: string): number {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function maskAk(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function hashPhone(phone: string): string {
  return createHash('sha256')
    .update(`${PHONE_HASH_KEY}|${phone}`)
    .digest('hex');
}

/** 号码归一：全角转半角、去掉分隔符与 +86 / 0086，只留 6–20 位数字。 */
export function phoneOf(value: unknown): {
  phone: string;
  warning: string;
  message: string;
} {
  let raw = text(value).normalize('NFKC').trim();
  if (!raw) return { phone: '', warning: '', message: '被叫号码为空' };
  raw = raw.replace(/[\s\-()（）.]/g, '').replace(/^\+/, '');
  if (raw.startsWith('0086')) raw = raw.slice(4);
  else if (raw.startsWith('86') && raw.length === 13) raw = raw.slice(2);
  if (!/^\d{6,20}$/.test(raw)) {
    return { phone: '', warning: '', message: '号码格式不正确' };
  }
  const warning = /^1[3-9]\d{9}$/.test(raw)
    ? ''
    : '疑似非手机号，请确认后再导入';
  return { phone: raw, warning, message: '' };
}

export function maskPhone(phone: string): string {
  if (!phone) return '';
  if (phone.length < 7) return `${phone.slice(0, 2)}****`;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function normalizeMapping(raw: unknown, fields: FieldMeta[]): Mapping {
  const input = recordJson(raw);
  const keys = new Set(fields.map((field) => field.fieldKey));
  const pick = (value: unknown, label: string, required = false) => {
    const key = text(value).trim();
    if (!key) {
      if (required) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, `请选择${label}列`);
      }
      return '';
    }
    if (!keys.has(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${label}列不属于这张表，请刷新后重选`,
      );
    }
    return key;
  };
  const phoneFieldKey = pick(input.phoneFieldKey, '被叫号码', true);
  const nameFieldKey = pick(input.nameFieldKey, '姓名');
  const roleFieldKey = pick(input.roleFieldKey, '角色');
  const honorificModeRaw = text(input.honorificMode) || 'none';
  if (!['none', 'field', 'gender', 'fixed'].includes(honorificModeRaw)) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '称谓规则不合法');
  }
  const honorificMode = honorificModeRaw as Mapping['honorificMode'];
  const honorificFieldKey =
    honorificMode === 'field'
      ? pick(input.honorificFieldKey, '称谓', true)
      : '';
  const genderFieldKey =
    honorificMode === 'gender' ? pick(input.genderFieldKey, '性别', true) : '';
  const honorificValue =
    honorificMode === 'fixed' ? text(input.honorificValue).trim() : '';
  if (honorificMode === 'fixed' && !honorificValue) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '选择了固定称谓，请填写称谓内容',
    );
  }
  const extrasRaw = Array.isArray(input.extras) ? input.extras : [];
  const extras: Mapping['extras'] = [];
  const seenKeys = new Set<string>();
  for (const item of extrasRaw) {
    const extra = recordJson(item);
    const key = text(extra.key).trim();
    if (!key) continue;
    if (!EXTRA_KEY_PATTERN.test(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `自定义变量名「${key}」不合法（只能用英文、数字、下划线）`,
      );
    }
    if (seenKeys.has(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `自定义变量名「${key}」重复`,
      );
    }
    seenKeys.add(key);
    const sourceType = text(extra.sourceType) === 'fixed' ? 'fixed' : 'field';
    const fieldKey =
      sourceType === 'field'
        ? pick(extra.fieldKey, `变量 ${key} 的来源`, true)
        : '';
    extras.push({
      key,
      sourceType,
      fieldKey,
      value: sourceType === 'fixed' ? text(extra.value).trim() : '',
    });
  }
  return {
    phoneFieldKey,
    nameFieldKey,
    honorificMode,
    honorificFieldKey,
    honorificValue,
    genderFieldKey,
    roleFieldKey,
    extras,
  };
}

function parseMapping(value: unknown): Mapping {
  const raw = recordJson(value);
  return {
    phoneFieldKey: text(raw.phoneFieldKey),
    nameFieldKey: text(raw.nameFieldKey),
    honorificMode:
      (text(raw.honorificMode) as Mapping['honorificMode']) || 'none',
    honorificFieldKey: text(raw.honorificFieldKey),
    honorificValue: text(raw.honorificValue),
    genderFieldKey: text(raw.genderFieldKey),
    roleFieldKey: text(raw.roleFieldKey),
    extras: Array.isArray(raw.extras)
      ? raw.extras.map((item) => {
          const extra = recordJson(item);
          return {
            key: text(extra.key),
            sourceType: text(extra.sourceType) === 'fixed' ? 'fixed' : 'field',
            fieldKey: text(extra.fieldKey),
            value: text(extra.value),
          };
        })
      : [],
  };
}

function resolveHonorific(
  data: Record<string, unknown>,
  mapping: Mapping,
): string {
  switch (mapping.honorificMode) {
    case 'field':
      return text(data[mapping.honorificFieldKey]).trim();
    case 'fixed':
      return mapping.honorificValue.trim();
    case 'gender': {
      const gender = text(data[mapping.genderFieldKey]).trim();
      if (/^(男|male|m)$/i.test(gender)) return '先生';
      if (/^(女|female|f)$/i.test(gender)) return '女士';
      return '客户';
    }
    default:
      return '';
  }
}

function buildJob(
  referenceId: string,
  phone: string,
  data: Record<string, unknown>,
  mapping: Mapping,
): ObAssignJob {
  const name = text(data[mapping.nameFieldKey]).trim() || '客户';
  const role = text(data[mapping.roleFieldKey]).trim();
  const honorific = resolveHonorific(data, mapping) || '客户';
  const extras = mapping.extras
    .map((extra) => ({
      key: extra.key,
      value:
        extra.sourceType === 'field'
          ? text(data[extra.fieldKey]).trim()
          : extra.value.trim(),
    }))
    .filter((extra) => extra.value !== '');
  return {
    referenceId,
    phoneNumber: phone,
    name,
    ...(role ? { role } : {}),
    honorific,
    extras,
  };
}

function buildDefaultName(tableName: string): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `营销-${tableName}-${stamp}`;
}

/** 只把界面允许的字段写进 StrategyJson；数组参数用阿里云要求的字符串形式。 */
export function buildStrategy(raw: unknown): Record<string, unknown> | null {
  const input = recordJson(raw);
  const startMode = text(input.startMode) === 'scheduled' ? 'scheduled' : 'now';
  const startTimeRaw = text(input.startTime).trim();
  let startTime: number | undefined;
  if (startMode === 'scheduled') {
    const parsed = startTimeRaw
      ? new Date(startTimeRaw.replace(' ', 'T'))
      : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写有效的开始时间（不能早于现在）',
      );
    }
    if (parsed.getTime() < Date.now() - 60_000) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '开始时间不能早于现在',
      );
    }
    startTime = parsed.getTime();
  }
  const workingRaw = Array.isArray(input.workingTimes)
    ? input.workingTimes
    : [];
  const workingTime = (
    workingRaw.length
      ? workingRaw
      : [
          { beginTime: '09:00', endTime: '12:00' },
          { beginTime: '14:00', endTime: '20:00' },
        ]
  ).map((item) => {
    const window = recordJson(item);
    const beginTime = normalizeClock(window.beginTime);
    const endTime = normalizeClock(window.endTime);
    if (!beginTime || !endTime || beginTime >= endTime) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '外呼时段不合法：开始时间要早于结束时间',
      );
    }
    return { beginTime, endTime };
  });
  const maxAttempts = clampNumber(input.maxAttemptsPerDay, 1, 5, 1);
  const interval = clampNumber(input.minAttemptInterval, 1, 1440, 60);
  return {
    repeatBy: 'Once',
    repeatable: false,
    routingStrategy: 'LocalProvinceFirst',
    workingTime,
    maxAttemptsPerDay: String(maxAttempts),
    minAttemptInterval: String(interval),
    ...(startTime ? { startTime } : {}),
  };
}

function normalizeClock(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text(value).trim());
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return '';
  return [hour, minute, second]
    .map((item) => String(item).padStart(2, '0'))
    .join(':');
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof OutboundBotError) return error.code || 'UPSTREAM';
  if (error instanceof TransportError) return 'NETWORK';
  if (error instanceof BusinessException) return 'BAD_REQUEST';
  return 'INTERNAL';
}
