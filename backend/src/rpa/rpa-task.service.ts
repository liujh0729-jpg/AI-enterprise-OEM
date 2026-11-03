import { Prisma } from '../../generated/prisma';
import { pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  computeNextOccurrence,
  readScheduleFields,
  scheduleConfigOf,
} from '../common/schedule';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonObject, toJsonArray } from '../shared/json-value';
import {
  RpaAccountService,
  accountIdList,
  type RpaAccountRow,
} from './rpa-account.service';
import { RpaScriptService, type RpaScriptRow } from './rpa-script.service';
import { RpaSettingService } from './rpa-setting.service';
import {
  ENV_TYPE_LABELS,
  REPORT_STATUSES,
  TASK_STATUSES,
  deviceLabel,
  isPhoneDevice,
  normalizeChoice,
  normalizeDeviceType,
  normalizePhoneFinishAction,
  parseIdList,
  resolveParams,
} from './rpa-shared';

/** 一次认领最多翻多少个待办任务去抢：抢不到就返回「暂无可执行任务」。 */
const CLAIM_SCAN_LIMIT = 20;
/** 超时判定单次要扫的执行记录上限。 */
const SWEEP_LIMIT = 50;

/**
 * 过滤错误信息里的敏感片段（key/token/secret/password/URL）+ 截断到 500 字。
 * 界面只展示分类文案，原文进日志；这里做最后一道防线，防止上游报文夹带凭据进库。
 */
function sanitizeErrorMessage(raw: string): string {
  const cleaned = raw
    .replace(
      /(?:key|token|secret|password|apikey|api_key)[=:]\s*[^\s,;"'<>]+/gi,
      '[$1]=***',
    )
    .replace(/https?:\/\/[^\s,;"'<>]+/g, '[url]')
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
  return cleaned.trim().slice(0, 500);
}

type TaskRow = {
  id: number;
  createdBy: string;
  name: string;
  scriptId: number;
  deviceType: string;
  accountIds: number[];
  params: Record<string, unknown>;
  status: string;
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
  phoneFinishAction: string;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastRunAt: Date | null;
  lastError: string;
  maxRetries: number;
  timeoutSeconds: number;
  createdAt: Date;
  updatedAt: Date;
};

/** 任务列表 / 详情里带出的脚本摘要：设备与流程 ID 决定执行端怎么跑。 */
type ScriptBrief = {
  id: number;
  name: string;
  deviceType: string;
  fileType: string;
  vendorFlowId?: string;
  status: string;
};

/** 任务绑定的账号摘要（界面只展示这些，环境标识按需带出）。 */
type AccountBrief = {
  id: number;
  platform: string;
  username: string;
  envType?: number;
};

/**
 * RPA 任务：云端创建时就绑定「脚本 + 账号 + 运行参数」，本地比特浏览器凭 API Key 认领执行。
 *
 * 认领用 `updateMany(status: pending → running)` 做原子抢单：count 不为 1 说明这个任务
 * 已被别的执行端抢走，直接换下一个，不会把同一个任务派给两台机器。
 * 回传结果时按「失败且还有重试次数」决定退回 pending 还是收口为 failed。
 */
export class RpaTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly scripts: RpaScriptService,
    private readonly accounts: RpaAccountService,
    private readonly settings: RpaSettingService,
  ) {}

  // ---------- 界面侧 CRUD ----------

  async list(
    user: CurrentUser,
    query: {
      status?: string;
      deviceType?: string;
      keyword?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const status = query.status
      ? normalizeChoice(query.status, TASK_STATUSES, '任务状态', 'pending')
      : undefined;
    const deviceType = query.deviceType
      ? normalizeDeviceType(query.deviceType)
      : undefined;
    const keyword = text(query.keyword).trim();
    const where = {
      ...(this.identity.isPlatformAdmin(user)
        ? {}
        : { createdBy: user.userId }),
      ...(status ? { status } : {}),
      ...(deviceType ? { deviceType } : {}),
      ...(keyword ? { name: { contains: keyword } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.rpaTask.count({ where }),
      this.prisma.rpaTask.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const scriptIds = [...new Set(rows.map((row) => row.scriptId))];
    const scripts = scriptIds.length
      ? await this.prisma.rpaScript.findMany({
          where: { id: { in: scriptIds } },
          select: {
            id: true,
            name: true,
            deviceType: true,
            fileType: true,
            status: true,
          },
        })
      : [];
    const scriptMap = new Map(scripts.map((item) => [item.id, item]));
    const accountIds = [
      ...new Set(rows.flatMap((row) => accountIdList(row.accountIds))),
    ];
    const accountRows = accountIds.length
      ? await this.prisma.rpaAccount.findMany({
          where: { id: { in: accountIds } },
          select: {
            id: true,
            platform: true,
            username: true,
          },
        })
      : [];
    const accountMap = new Map(accountRows.map((item) => [item.id, item]));
    return {
      total,
      page,
      pageSize,
      list: rows.map((row) =>
        decorateTask(plainTask(row), scriptMap.get(row.scriptId), accountMap),
      ),
    };
  }

  async get(user: CurrentUser, id: number) {
    const row = await this.loadVisible(user, id);
    const [script, accountRows] = await Promise.all([
      this.prisma.rpaScript.findUnique({
        where: { id: row.scriptId },
        select: {
          id: true,
          name: true,
          deviceType: true,
          fileType: true,
          vendorFlowId: true,
          status: true,
        },
      }),
      this.prisma.rpaAccount.findMany({
        where: { id: { in: accountIdList(row.accountIds) } },
        select: {
          id: true,
          platform: true,
          username: true,
          envType: true,
        },
      }),
    ]);
    return decorateTask(
      row,
      script,
      new Map(accountRows.map((item) => [item.id, item])),
    );
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务名称');
    }
    const scriptId = Number(text(body.scriptId) || 0);
    if (!Number.isInteger(scriptId) || scriptId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要执行的 RPA 脚本',
      );
    }
    const script = await this.scripts.loadOwned(user, scriptId);
    // 设备由绑定脚本决定：任务不能声称跑安卓而脚本是 PC 流程，执行端会拿到对不上的正文
    if (body.deviceType !== undefined) {
      const declared = normalizeDeviceType(body.deviceType);
      if (declared !== script.deviceType) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `任务设备跟随绑定脚本：脚本「${script.name}」是${deviceLabel(script.deviceType)}，不能声明成${deviceLabel(declared)}`,
        );
      }
    }
    const accountIds = parseIdList(body.accountIds, 'RPA 账号');
    if (!accountIds.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少绑定一个 RPA 账号（任务在本地要用它登录平台执行）',
      );
    }
    await this.bindAccounts(user, script.deviceType, accountIds);
    const data = {
      createdBy: user.userId,
      name: name.slice(0, 200),
      scriptId,
      deviceType: script.deviceType,
      accountIds: toJsonArray(accountIds),
      params: toJsonObject(resolveParams(script.paramsSchema, body.params)),
      status: 'pending',
      ...readScheduleFields(body),
      phoneFinishAction: this.finishAction(body, script.deviceType, 'keep'),
      maxRetries: nonNegativeInt(body.maxRetries, 0, '重试次数'),
      timeoutSeconds: positiveInt(body.timeoutSeconds, 3600, '超时秒数'),
    };
    const row = await this.prisma.rpaTask.create({ data });
    await this.identity.audit(
      user.userId,
      'RPA创建任务',
      `#${row.id} ${row.name}`,
    );
    return this.get(user, row.id);
  }

  /**
   * 批量建任务：每个账号一个独立任务（与 create 的「多账号共用一个任务」互补）。
   * 脚本 / 参数 / 排期 / 超时等配置全部共用，只有账号拆开。
   * 任务名自动加后缀 `（账号名）` 区分，用户也可以给一个基础名。
   */
  async createBatch(user: CurrentUser, body: Record<string, unknown>) {
    const baseName = text(body.name).trim();
    const scriptId = Number(text(body.scriptId) || 0);
    if (!Number.isInteger(scriptId) || scriptId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要执行的 RPA 脚本',
      );
    }
    const script = await this.scripts.loadOwned(user, scriptId);
    if (body.deviceType !== undefined) {
      const declared = normalizeDeviceType(body.deviceType);
      if (declared !== script.deviceType) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `任务设备跟随绑定脚本：脚本「${script.name}」是${deviceLabel(script.deviceType)}，不能声明成${deviceLabel(declared)}`,
        );
      }
    }
    const accountIds = parseIdList(body.accountIds, 'RPA 账号');
    if (!accountIds.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少绑定一个 RPA 账号',
      );
    }
    if (accountIds.length > 50) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单次最多选 50 个账号批量建任务，请分批操作',
      );
    }
    if (accountIds.length === 1) {
      return [await this.create(user, body)];
    }
    await this.bindAccounts(user, script.deviceType, accountIds);
    const accounts = await this.prisma.rpaAccount.findMany({
      where: { id: { in: accountIds }, createdBy: user.userId },
      select: { id: true, platform: true, username: true },
    });
    const byId = new Map(accounts.map((item) => [item.id, item]));
    const resolvedParams = toJsonObject(
      resolveParams(script.paramsSchema, body.params),
    );
    const schedule = readScheduleFields(body);
    const phoneFinishAction = this.finishAction(
      body,
      script.deviceType,
      'keep',
    );
    const maxRetries = nonNegativeInt(body.maxRetries, 0, '重试次数');
    const timeoutSeconds = positiveInt(body.timeoutSeconds, 3600, '超时秒数');
    const created: Awaited<ReturnType<typeof this.get>>[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const accountId of accountIds) {
        const account = byId.get(accountId);
        const suffix = account
          ? `${account.platform}/${account.username}`
          : `#${accountId}`;
        const taskName = baseName
          ? `${baseName.slice(0, 160)}（${suffix}）`.slice(0, 200)
          : `${script.name} · ${suffix}`.slice(0, 200);
        const row = await tx.rpaTask.create({
          data: {
            createdBy: user.userId,
            name: taskName,
            scriptId,
            deviceType: script.deviceType,
            accountIds: toJsonArray([accountId]),
            params: resolvedParams,
            status: 'pending',
            ...schedule,
            phoneFinishAction,
            maxRetries,
            timeoutSeconds,
          },
        });
        await this.identity.audit(
          user.userId,
          'RPA批量建任务',
          `#${row.id} ${row.name}`,
        );
        created.push(await this.get(user, row.id));
      }
    });
    return created;
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.loadOwned(user, id);
    const data: Prisma.RpaTaskUpdateInput = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim();
      if (!name) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '任务名称不能为空');
      }
      data.name = name.slice(0, 200);
    }
    let scriptId = row.scriptId;
    let script: RpaScriptRow | null = null;
    if (body.scriptId !== undefined) {
      const next = Number(text(body.scriptId) || 0);
      if (!Number.isInteger(next) || next <= 0) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要执行的 RPA 脚本',
        );
      }
      scriptId = next;
      script = await this.scripts.loadOwned(user, next);
      data.scriptId = next;
      // 换脚本＝换设备：任务设备永远跟着绑定脚本
      data.deviceType = script.deviceType;
    }
    const deviceType = script ? script.deviceType : row.deviceType;
    let accountIds = row.accountIds;
    let accountsChanged = false;
    if (body.accountIds !== undefined) {
      const ids = parseIdList(body.accountIds, 'RPA 账号');
      if (!ids.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '任务至少要绑定一个 RPA 账号',
        );
      }
      accountIds = ids;
      accountsChanged = true;
      data.accountIds = toJsonArray(ids);
    }
    // 换账号或换设备都要重过一遍绑定规则：设备一致、环境标识齐全、云手机计费模式统一
    if (accountsChanged || (script && script.deviceType !== row.deviceType)) {
      await this.bindAccounts(user, deviceType, accountIds);
    }
    if (body.params !== undefined || script) {
      const target = script || (await this.scripts.loadOwned(user, scriptId));
      data.params = toJsonObject(
        resolveParams(target.paramsSchema, body.params ?? row.params),
      );
    }
    const finishAction = this.finishAction(
      body,
      deviceType,
      row.phoneFinishAction,
    );
    if (finishAction !== row.phoneFinishAction) {
      data.phoneFinishAction = finishAction;
    }
    Object.assign(data, readScheduleFields(body, true));
    if (body.maxRetries !== undefined) {
      data.maxRetries = nonNegativeInt(
        body.maxRetries,
        row.maxRetries,
        '重试次数',
      );
    }
    if (body.timeoutSeconds !== undefined) {
      data.timeoutSeconds = positiveInt(
        body.timeoutSeconds,
        row.timeoutSeconds,
        '超时秒数',
      );
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.rpaTask.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      'RPA修改任务',
      `#${id} ${saved.name}`,
    );
    return this.get(user, id);
  }

  /** 删除任务连同它的执行记录（执行记录只在本任务下有意义）。 */
  async remove(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    await this.prisma.$transaction([
      this.prisma.rpaTaskExecution.deleteMany({ where: { taskId: id } }),
      this.prisma.rpaTask.delete({ where: { id } }),
    ]);
    await this.identity.audit(user.userId, 'RPA删除任务', `#${id} ${row.name}`);
    return { id };
  }

  /** 取消：只把还没跑完的任务收口为 cancelled，执行记录不动。 */
  async cancel(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    if (!['pending', 'running'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `任务已是「${statusLabel(row.status)}」，无需取消`,
      );
    }
    const saved = await this.prisma.rpaTask.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    await this.identity.audit(
      user.userId,
      'RPA取消任务',
      `#${id} ${saved.name}`,
    );
    return this.get(user, id);
  }

  /**
   * 调度器调用：扫描所有到期的周期任务，计算下一次执行时刻并更新 scheduledAt。
   * 时区 Asia/Shanghai，错过周期不补跑（直接推到下一个未来时刻）。
   */
  async advanceRecurringTasks() {
    const now = new Date();
    const dueTasks = await this.prisma.rpaTask.findMany({
      where: {
        scheduleType: 'recurring',
        status: { not: 'cancelled' },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      select: {
        id: true,
        scheduleConfig: true,
        scheduledAt: true,
      },
    });
    for (const task of dueTasks) {
      const config = scheduleConfigOf(task.scheduleConfig);
      const nextAt = computeNextOccurrence(config, task.scheduledAt ?? now);
      if (nextAt) {
        await this.prisma.rpaTask.update({
          where: { id: task.id },
          data: { scheduledAt: nextAt },
        });
      }
    }
  }

  /** 重新排队：把终态任务退回 pending，等本地执行器再来认领。 */
  async requeue(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    if (row.status === 'running') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '任务正在执行中，请等执行端回传结果',
      );
    }
    const saved = await this.prisma.rpaTask.update({
      where: { id },
      data: {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        lastError: '',
      },
    });
    await this.identity.audit(
      user.userId,
      'RPA任务重新排队',
      `#${id} ${saved.name}`,
    );
    return this.get(user, id);
  }

  async listExecutions(user: CurrentUser, taskId?: number, limit = 50) {
    const rows = await this.prisma.rpaTaskExecution.findMany({
      where: {
        ...(this.identity.isPlatformAdmin(user)
          ? {}
          : { createdBy: user.userId }),
        ...(taskId ? { taskId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map(decorateExecution);
  }

  // ---------- 机器通道：本地比特浏览器执行端 ----------

  /**
   * 认领一个可执行任务。返回里带上脚本正文和绑定账号的明文口令：
   * 执行端要真的打开比特浏览器窗口 / 云手机环境登录平台，这是它唯一需要明文的时刻。
   *
   * `deviceType` 是执行端的自我声明（本机只装了比特浏览器 PC，或只开了安卓云手机）：
   * 声明了就只派同设备的任务，定向认领跨设备任务会被拒。
   */
  async claim(
    user: CurrentUser,
    body: { executor?: unknown; taskId?: unknown; deviceType?: unknown },
  ) {
    const deviceType =
      body.deviceType === undefined || text(body.deviceType).trim() === ''
        ? ''
        : normalizeDeviceType(body.deviceType);
    await this.sweepTimeouts(user.userId);
    const now = new Date();
    const targetId =
      body.taskId === undefined ? 0 : Number(text(body.taskId) || 0);
    if (targetId) {
      const row = await this.loadOwned(user, targetId);
      if (deviceType && row.deviceType !== deviceType) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `任务 #${targetId} 是${deviceLabel(row.deviceType)}任务，执行端声明的是${deviceLabel(deviceType)}`,
        );
      }
      if (row.status !== 'pending') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `任务 #${targetId} 当前是「${statusLabel(row.status)}」，不能认领`,
        );
      }
      if (!(await this.tryGrab(row.id))) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `任务 #${targetId} 刚被其他执行端认领`,
        );
      }
      return this.dispatch(
        user,
        await this.loadOwned(user, targetId),
        text(body.executor),
      );
    }
    const candidates = await this.prisma.rpaTask.findMany({
      where: {
        createdBy: user.userId,
        status: 'pending',
        ...(deviceType ? { deviceType } : {}),
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_SCAN_LIMIT,
    });
    if (!candidates.length) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        deviceType
          ? `暂无可执行的${deviceLabel(deviceType)} RPA 任务`
          : '暂无可执行的 RPA 任务',
      );
    }
    for (const candidate of candidates) {
      const grabbed = await this.tryGrab(candidate.id);
      if (!grabbed) continue;
      const row = await this.loadOwned(user, candidate.id);
      return this.dispatch(user, row, text(body.executor));
    }
    throw new BusinessException(
      ErrorCode.CONFLICT,
      '待办任务已被其他执行端认领，请稍后重试',
    );
  }

  /** 执行端回传结果：写终态 + 同步任务状态（失败且有重试次数则退回 pending）。 */
  async finish(
    user: CurrentUser,
    executionId: number,
    body: Record<string, unknown>,
  ) {
    const run = await this.prisma.rpaTaskExecution.findUnique({
      where: { id: executionId },
    });
    if (!run) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '执行记录不存在');
    }
    if (run.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该执行记录属于其他账号的执行端',
      );
    }
    if (run.finishedAt) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `执行 #${executionId} 已回传过结果（${statusLabel(run.status)}）`,
      );
    }
    const status = normalizeChoice(
      body.status,
      REPORT_STATUSES,
      '执行结果状态',
      '',
    );
    const now = new Date();
    const errorMessage = sanitizeErrorMessage(text(body.errorMessage));
    const saved = await this.prisma.$transaction(async (tx) => {
      // CAS：执行端重发同一份结果时，只有一次能把这条记录从「未结束」改成终态
      const sealed = await tx.rpaTaskExecution.updateMany({
        where: { id: executionId, finishedAt: null },
        data: {
          status,
          finishedAt: now,
          durationMs: Math.max(now.getTime() - run.startedAt.getTime(), 0),
          output:
            body.output && typeof body.output === 'object' ? body.output : {},
          errorMessage: status === 'success' ? '' : errorMessage,
          logText: text(body.logText).slice(0, 200_000),
        },
      });
      if (sealed.count !== 1) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `执行 #${executionId} 已回传过结果`,
        );
      }
      const execution = await tx.rpaTaskExecution.findUniqueOrThrow({
        where: { id: executionId },
      });
      const task = await tx.rpaTask.findUnique({ where: { id: run.taskId } });
      if (task && task.status !== 'cancelled') {
        const retryable =
          status === 'failed' && task.maxRetries >= execution.attempt;
        await tx.rpaTask.update({
          where: { id: task.id },
          data: {
            status:
              status === 'success'
                ? 'completed'
                : retryable
                  ? 'pending'
                  : status,
            lastRunAt: now,
            lastError: status === 'success' ? '' : errorMessage || '执行失败',
            // 只有「退回待执行重试」不写完成时间，其余收口（成功/失败/取消）都算结束
            ...(retryable ? {} : { completedAt: now }),
            ...(retryable ? { startedAt: null } : {}),
          },
        });
      }
      return execution;
    });
    await this.identity.audit(
      user.userId,
      'RPA回传执行结果',
      `执行#${executionId} 任务#${run.taskId} ${status}`,
    );
    return decorateExecution(saved);
  }

  /** 执行端一次取多条待办时用的清单（不含口令）。 */
  async openTasks(
    user: CurrentUser,
    query: { status?: string; deviceType?: string; limit?: string },
  ) {
    const status = query.status
      ? normalizeChoice(query.status, TASK_STATUSES, '任务状态', 'pending')
      : undefined;
    const deviceType = query.deviceType
      ? normalizeDeviceType(query.deviceType)
      : undefined;
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const rows = await this.prisma.rpaTask.findMany({
      where: {
        createdBy: user.userId,
        ...(status ? { status } : {}),
        ...(deviceType ? { deviceType } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const scriptIds = [...new Set(rows.map((row) => row.scriptId))];
    const scripts = scriptIds.length
      ? await this.prisma.rpaScript.findMany({
          where: { id: { in: scriptIds } },
          select: {
            id: true,
            name: true,
            deviceType: true,
            fileType: true,
            vendorFlowId: true,
            status: true,
          },
        })
      : [];
    const scriptMap = new Map(scripts.map((item) => [item.id, item]));
    return rows.map((row) =>
      decorateTask(plainTask(row), scriptMap.get(row.scriptId), new Map()),
    );
  }

  // ---------- 内部 ----------

  /**
   * 绑定校验：账号必须与任务同设备，且一批云手机的计费模式统一。
   * 「统一按时计费或套餐计费」是比特浏览器云手机 RPA 的硬要求，混用会让整批任务起不来。
   */
  private async bindAccounts(
    user: CurrentUser,
    deviceType: string,
    accountIds: number[],
  ) {
    const rows: RpaAccountRow[] = [];
    for (const accountId of accountIds) {
      rows.push(await this.accounts.loadOwned(user, accountId));
    }
    if (!isPhoneDevice(deviceType)) return;
    const billings = [...new Set(rows.map((row) => row.envType))];
    if (billings.length > 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `绑定的云手机计费模式不一致（${billings.map((item) => ENV_TYPE_LABELS[item] || '未填写').join(' / ')}），同一个任务的云手机要统一按时计费或套餐计费`,
      );
    }
  }

  /** 收尾动作只在云手机任务上有意义：PC 任务一律保持「keep」，界面上也不出这个控件。 */
  private finishAction(
    body: Record<string, unknown>,
    deviceType: string,
    fallback: string,
  ) {
    if (!isPhoneDevice(deviceType)) {
      if (
        body.phoneFinishAction !== undefined &&
        normalizePhoneFinishAction(body.phoneFinishAction) !== 'keep'
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `${deviceLabel(deviceType)}任务没有云手机收尾动作`,
        );
      }
      return 'keep';
    }
    return normalizePhoneFinishAction(body.phoneFinishAction, fallback);
  }

  /** 原子抢单：只有把 pending 改成 running 的那一次返回 true。 */
  private async tryGrab(taskId: number) {
    const result = await this.prisma.rpaTask.updateMany({
      where: { id: taskId, status: 'pending' },
      data: { status: 'running', startedAt: new Date(), lastError: '' },
    });
    return result.count === 1;
  }

  /**
   * 派发给本地执行端。调用方已把任务原子抢成 running，所以这里任何一步失败都必须退回
   * pending：失败的派发不会留下执行记录，而超时自愈只扫执行记录，扫不到就永久卡住。
   */
  private async dispatch(user: CurrentUser, row: TaskRow, executor: string) {
    try {
      return await this.buildDispatch(user, row, executor);
    } catch (error) {
      await this.prisma.rpaTask.updateMany({
        where: { id: row.id, status: 'running' },
        data: {
          status: 'pending',
          startedAt: null,
          lastError: (error instanceof Error
            ? error.message
            : '派发失败'
          ).slice(0, 500),
        },
      });
      throw error;
    }
  }

  private async buildDispatch(
    user: CurrentUser,
    row: TaskRow,
    executor: string,
  ) {
    const [script, setting] = await Promise.all([
      this.prisma.rpaScript.findUnique({ where: { id: row.scriptId } }),
      this.settings.get(user),
    ]);
    if (!script) {
      await this.prisma.rpaTask.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          lastError: '绑定的脚本已不存在',
          completedAt: new Date(),
        },
      });
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `任务 #${row.id} 绑定的脚本已不存在，无法派发`,
      );
    }
    // 只取本人账号：accountIds 是任务创建时留存的快照，账号此后可能被删除或被别人重建，
    // 而这里是全系统唯一回传明文口令的地方，不能把不属于自己的凭据推给执行端。
    const boundIds = [...new Set(row.accountIds)];
    const accountRows = await this.prisma.rpaAccount.findMany({
      where: { id: { in: boundIds }, createdBy: user.userId },
    });
    if (accountRows.length !== boundIds.length) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `任务 #${row.id} 绑定的 RPA 账号已不存在或不归本人，无法派发`,
      );
    }
    // 只有这里回传明文口令：执行端要在比特浏览器窗口 / 云手机里登录目标平台
    const accounts = accountRows.map((account) => ({
      id: account.id,
      platform: account.platform,
      username: account.username,
      nickname: account.nickname,
      password: this.accounts.decryptPassword(account),
      loginUrl: account.loginUrl,
      envType: account.envType,
      // 代理配置：执行端按比特浏览器 /browser/add 的字段结构直接透传
      proxyMethod: account.proxyMethod,
      proxyType: account.proxyType,
      proxyHost: account.proxyHost,
      proxyPort: account.proxyPort,
      proxyUserName: account.proxyUserName,
      proxyPassword: account.proxyPasswordCipher
        ? this.accounts.decryptProxyPassword(account)
        : '',
    }));
    const attempt =
      (await this.prisma.rpaTaskExecution.count({
        where: { taskId: row.id },
      })) + 1;
    // 报文拼完（含口令解密）才落执行记录：拼装失败不该留下一条永远 running 的记录
    const run = await this.prisma.rpaTaskExecution.create({
      data: {
        taskId: row.id,
        createdBy: user.userId,
        deviceType: row.deviceType,
        status: 'running',
        attempt,
        executor: executor.slice(0, 64),
      },
    });
    const lastLoginAt = new Date();
    await this.prisma.rpaAccount.updateMany({
      where: { id: { in: accountRows.map((item) => item.id) } },
      data: { lastLoginAt },
    });
    return {
      executionId: run.id,
      attempt,
      claimedAt: run.startedAt,
      timeoutSeconds: row.timeoutSeconds,
      // 租户的比特浏览器实例配置：执行端按它调本地 API
      settings: {
        bitbrowserApiEndpoint: setting.bitbrowserApiEndpoint,
        bitbrowserGroupId: setting.bitbrowserGroupId,
        bitphoneRegionId: setting.bitphoneRegionId,
        bitphoneComputeType: setting.bitphoneComputeType,
      },
      device: {
        deviceType: row.deviceType,
        deviceLabel: deviceLabel(row.deviceType),
        // 手机任务跑完后执行端按它决定关不关机；pc 恒为 keep
        phoneFinishAction: row.phoneFinishAction,
        // 一批账号的计费模式在绑定校验时已收口成一种，执行端可直接据此开机 / 挂起
        envType: accountRows[0]?.envType ?? 1,
      },
      task: {
        id: row.id,
        name: row.name,
        params: row.params,
        scheduleType: row.scheduleType,
        accountIds: row.accountIds,
      },
      script: {
        id: script.id,
        name: script.name,
        deviceType: script.deviceType,
        fileType: script.fileType,
        // 比特浏览器 RPA 流程靠它调 POST /rpa/run（body.id 就是这个任务 ID）
        vendorFlowId: script.vendorFlowId,
        status: script.status,
        content: script.content,
        paramsSchema: script.paramsSchema,
      },
      accounts,
    };
  }

  /**
   * 超时自愈：认领前先把「跑着但早就超过 timeoutSeconds 还没回传」的执行判为 timeout，
   * 并把所属任务退回 pending，否则执行端中途掉线会把任务永久卡住。
   */
  private async sweepTimeouts(userId: string) {
    const running = await this.prisma.rpaTaskExecution.findMany({
      where: { createdBy: userId, status: 'running' },
      orderBy: { startedAt: 'asc' },
      take: SWEEP_LIMIT,
    });
    if (!running.length) return;
    const tasks = await this.prisma.rpaTask.findMany({
      where: { id: { in: [...new Set(running.map((run) => run.taskId))] } },
    });
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const now = Date.now();
    for (const run of running) {
      const task = taskMap.get(run.taskId);
      const limitMs = (task?.timeoutSeconds || 3600) * 1000;
      if (now - run.startedAt.getTime() < limitMs) continue;
      const message = `超过 ${task?.timeoutSeconds || 3600} 秒未回传结果`;
      await this.prisma.rpaTaskExecution.update({
        where: { id: run.id },
        data: {
          status: 'timeout',
          errorMessage: message,
          finishedAt: new Date(),
          durationMs: now - run.startedAt.getTime(),
        },
      });
      if (task && task.status === 'running') {
        await this.prisma.rpaTask.update({
          where: { id: task.id },
          data: { status: 'pending', startedAt: null, lastError: message },
        });
      }
    }
  }

  private async loadOwned(user: CurrentUser, id: number): Promise<TaskRow> {
    const row = await this.prisma.rpaTask.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'RPA 任务不存在');
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 RPA 任务归他人所有',
      );
    }
    return plainTask(row);
  }

  private async loadVisible(user: CurrentUser, id: number): Promise<TaskRow> {
    const row = await this.prisma.rpaTask.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'RPA 任务不存在');
    if (row.createdBy !== user.userId && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 RPA 任务归他人所有',
      );
    }
    return plainTask(row);
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时',
  success: '成功',
};

export function statusLabel(status: string) {
  return STATUS_LABEL[status] || status;
}

function plainTask(row: {
  id: number;
  createdBy: string;
  name: string;
  scriptId: number;
  deviceType: string;
  accountIds: Prisma.JsonValue;
  params: Prisma.JsonValue;
  status: string;
  scheduleType: string;
  scheduleConfig: Prisma.JsonValue;
  phoneFinishAction: string;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastRunAt: Date | null;
  lastError: string;
  maxRetries: number;
  timeoutSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}): TaskRow {
  return {
    ...row,
    accountIds: accountIdList(row.accountIds),
    params: isObject(row.params) ? (row.params as Record<string, unknown>) : {},
    scheduleConfig: scheduleConfigOf(row.scheduleConfig),
  };
}

function decorateTask(
  row: TaskRow,
  script: ScriptBrief | null | undefined,
  accountMap: Map<number, AccountBrief>,
) {
  return {
    ...row,
    script: script || null,
    deviceLabel: deviceLabel(row.deviceType),
    accounts: row.accountIds
      .map((id) => accountMap.get(id))
      .filter((item): item is AccountBrief => Boolean(item)),
  };
}

function decorateExecution(row: {
  id: number;
  taskId: number;
  createdBy: string;
  deviceType: string;
  status: string;
  attempt: number;
  executor: string;
  output: Prisma.JsonValue;
  errorMessage: string;
  logText: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}) {
  return {
    ...row,
    output: isObject(row.output) ? (row.output as Record<string, unknown>) : {},
    deviceLabel: deviceLabel(row.deviceType),
    statusLabel: statusLabel(row.status),
  };
}

function isObject(value: unknown) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInt(raw: unknown, fallback: number, label: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(text(raw).trim());
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}只能是 0-20 的整数`,
    );
  }
  return value;
}

function positiveInt(raw: unknown, fallback: number, label: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(text(raw).trim());
  if (!Number.isInteger(value) || value < 60 || value > 86400) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}只能是 60-86400 的整数（秒）`,
    );
  }
  return value;
}
