import { randomUUID } from 'node:crypto';
import {
  BROWSER_TASK_LIFECYCLE_LABELS,
  browserReceipt,
  browserTaskTerminal,
  isBrowserCapabilityAction,
  receiptStatusToTaskStatus,
  validateBrowserActionPayload,
  type BrowserEvidence,
  type BrowserReceipt,
  type BrowserReceiptStatus,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { fromJson, toJsonInput } from '../common/json-input';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { BrowserTask } from '../../generated/prisma';
import type { ExtensionCatalogService } from './extension-catalog.service';

/** 建任务输入：业务侧只出「能力 + 动作 + 参数」，服务端负责落队列与租约。 */
export type BrowserTaskDispatch = {
  capability: string;
  action: string;
  platforms?: string[];
  /** 业务来源（如 distribution:#<内容 id>）：同来源同时只保留一个未终结任务。 */
  source?: string;
  orgType?: string;
  orgUserId?: string;
  payload?: Record<string, unknown>;
  /** 页面检测到的插件版本（可选）：低于能力最低版本时拒绝派发。 */
  pluginVersion?: string;
  /** 认领租约时长（秒）；缺省用 BROWSER_TASK_DEFAULT_LEASE_SECONDS。 */
  leaseSeconds?: number;
};

/** 回执写入（业务侧回写结果）：状态缺省由逐条结果汇总得出。 */
export type BrowserTaskReportInput = {
  results?: Record<string, unknown>[];
  evidence?: BrowserEvidence[];
  status?: BrowserReceiptStatus;
  code?: string;
  message?: string;
  /** 能力回执数据（如获客 runId / 新增线索数）：原样落 receiptData，供业务侧对账。 */
  data?: Record<string, unknown>;
  pluginVersion?: string;
};

/** 未终结的任务状态：仍在队列里、可被回执终结。 */
const OPEN_STATUSES = ['QUEUED', 'CLAIMED', 'RUNNING'] as const;

/** 默认认领租约：15 分钟——够插件逐个打开平台页填充/发布；超时后任务可被重新认领。 */
export const BROWSER_TASK_DEFAULT_LEASE_SECONDS = 15 * 60;
/** 待认领队列 TTL：24 小时后仍未被认领记为过期，避免僵尸任务长期占位。 */
export const BROWSER_TASK_QUEUE_TTL_SECONDS = 24 * 60 * 60;

/**
 * 平台统一浏览器任务服务（设计 §10.3 / §10.7）：业务侧「服务器创建任务 → 插件认领」的
 * 持久队列 + 认领租约 + 结果回执。派发前统一过能力门槛（下线/灰度/最低版本），
 * 回执口径与页面/插件统一信封（browser-task 契约）同源。
 *
 * 当前接入：多平台内容分发（内容分发时落一条持久任务，逐平台结果回写时终结，
 * 内容删除时取消）；获客链路沿用既有令牌桥（AcquisitionPluginBridgeService），
 * 后续新业务按同一份服务接入，不再各写一套队列。
 */
export class BrowserTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ExtensionCatalogService,
  ) {}

  /**
   * 派发一条浏览器任务（服务器创建 + 立即认领）：
   * 1. 校验「能力 + 动作」已在能力目录登记，拒绝未知能力/动作；
   * 2. 版本门槛（下线/停止派发/灰度/最低版本）；
   * 3. 同来源收口——已有未终结任务先按 EXPIRED 收尾，保证同一来源同时只有一条在办；
   * 4. 新建并以租约认领，供页面把任务交给插件执行。
   */
  async dispatch(user: CurrentUser, input: BrowserTaskDispatch) {
    const capability = text(input.capability).trim();
    const action = text(input.action).trim();
    if (!isBrowserCapabilityAction(capability, action)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未登记的插件能力动作，拒绝派发',
      );
    }
    const invalid = validateBrowserActionPayload(
      capability,
      action,
      input.payload ?? {},
    );
    if (invalid) throw new BusinessException(ErrorCode.BAD_REQUEST, invalid);
    await this.catalog.assertDispatchable(capability, {
      pluginVersion: text(input.pluginVersion),
      orgUserId: text(input.orgUserId),
    });

    const now = new Date();
    await this.sweep(now);

    const source = text(input.source).trim().slice(0, 120);
    if (source) {
      // 同来源未终结任务先收尾：避免旧任务长期占位，也让「重新分发」始终可用。
      await this.prisma.browserTask.updateMany({
        where: {
          userId: user.userId,
          capability,
          source,
          status: { in: [...OPEN_STATUSES] },
        },
        data: {
          status: 'EXPIRED',
          finishedAt: now,
          leaseOwner: '',
          leaseExpiresAt: null,
        },
      });
    }

    const leaseSeconds =
      input.leaseSeconds && input.leaseSeconds > 0
        ? Math.floor(input.leaseSeconds)
        : BROWSER_TASK_DEFAULT_LEASE_SECONDS;
    const row = await this.prisma.browserTask.create({
      data: {
        capability,
        action,
        jobId: jobIdOf(capability),
        userId: user.userId,
        orgType: text(input.orgType) || 'ENTERPRISE',
        orgUserId: text(input.orgUserId).slice(0, 64),
        platforms: toJsonInput(input.platforms ?? []),
        source,
        payload: toJsonInput(input.payload ?? {}),
        status: 'CLAIMED',
        leaseOwner: user.userId,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
        attempts: 1,
        claimedAt: now,
        expiresAt: new Date(
          now.getTime() + BROWSER_TASK_QUEUE_TTL_SECONDS * 1000,
        ),
      },
    });
    return this.viewOf(row);
  }

  /** 当前未终结的任务（业务侧据此把插件回执挂到队列上）：没有则返回 null。 */
  async openForSource(
    userId: string,
    capability: string,
    source: string,
  ): Promise<BrowserTask | null> {
    if (!source) return null;
    return this.prisma.browserTask.findFirst({
      where: {
        userId,
        capability,
        source,
        status: { in: [...OPEN_STATUSES] },
      },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 回执终结任务：按「任务 + 回执」落结果、证据与错误码，并释放租约。
   * 已终结的任务重复回执按幂等处理（直接返回现状，不覆盖）。
   */
  async report(
    user: CurrentUser,
    taskId: number,
    input: BrowserTaskReportInput,
  ) {
    const row = await this.prisma.browserTask.findFirst({
      where: { id: taskId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '浏览器任务不存在');
    }
    if (browserTaskTerminal(row.status)) return this.viewOf(row);

    const receipt = browserReceipt({
      capability: row.capability,
      action: row.action,
      jobId: row.jobId,
      status: input.status,
      code: input.code ?? '',
      message: input.message ?? '',
      results: input.results ?? [],
      evidence: input.evidence ?? [],
      data: input.data ?? {},
      pluginVersion: input.pluginVersion ?? '',
    });
    return this.advance(row, receipt);
  }

  /** 业务侧取消某来源的在办任务（如内容删除/改派）：返回被取消的条数。 */
  async cancelBySource(
    userId: string,
    capability: string,
    source: string,
  ): Promise<number> {
    if (!source) return 0;
    const result = await this.prisma.browserTask.updateMany({
      where: {
        userId,
        capability,
        source,
        status: { in: [...OPEN_STATUSES] },
      },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        leaseOwner: '',
        leaseExpiresAt: null,
      },
    });
    return result.count;
  }

  /**
   * 页面回传的插件终态回执：按「能力 + 最近一条未终结任务」挂到队列上。
   * 插件回执里只有自己的 jobId，页面回执可能先于 dispatch 落库到达（页面先发任务后记台账），
   * 因此按能力取最近未终结任务；找不到就按幂等忽略，不抛错打断页面流程。
   */
  async recordReceipt(user: CurrentUser, body: Record<string, unknown>) {
    const capability = text(body.capability).trim();
    if (!capability) return { recorded: false };
    const row = await this.prisma.browserTask.findFirst({
      where: {
        userId: user.userId,
        capability,
        status: { in: [...OPEN_STATUSES] },
      },
      orderBy: { id: 'desc' },
    });
    if (!row) return { recorded: false };
    const results = Array.isArray(body.results)
      ? (body.results as Record<string, unknown>[])
      : [];
    const evidence = Array.isArray(body.evidence)
      ? (body.evidence as { kind?: string; value?: string; note?: string }[])
          .filter((item) => item && typeof item.value === 'string')
          .map((item) => ({
            kind: (item.kind ?? 'TEXT') as BrowserEvidence['kind'],
            value: String(item.value ?? ''),
            note: String(item.note ?? ''),
          }))
      : [];
    await this.report(user, row.id, {
      status: body.status as BrowserReceiptStatus | undefined,
      code: text(body.code),
      message: text(body.message),
      results,
      evidence,
      data:
        body.data && typeof body.data === 'object' && !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : {},
      pluginVersion: text(body.pluginVersion),
    });
    return { recorded: true };
  }

  /**
   * 队列清理（惰性调用，无需定时器）：
   * 1. 租约过期仍未回执的任务记为 EXPIRED（页面关闭 / 插件失联）；
   * 2. 队列 TTL 到期仍未被认领的 QUEUED 任务记为 EXPIRED。
   */
  async sweep(now = new Date()) {
    const stale = await this.prisma.browserTask.updateMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'EXPIRED',
        finishedAt: now,
        leaseOwner: '',
        leaseExpiresAt: null,
      },
    });
    const ttl = await this.prisma.browserTask.updateMany({
      where: { status: 'QUEUED', expiresAt: { lt: now } },
      data: { status: 'EXPIRED', finishedAt: now },
    });
    return { reclaimed: stale.count, expired: ttl.count };
  }

  /** 把回执推进到任务上：ACCEPTED/RUNNING 只记进度，终态口径则终结并释放租约。 */
  private async advance(row: BrowserTask, receipt: BrowserReceipt) {
    const terminal = receiptStatusToTaskStatus(receipt.status);
    const base = {
      receiptStatus: receipt.status,
      receiptCode: receipt.code,
      receiptMessage: receipt.message,
      // 回执未带版本时不覆盖派发时记下的版本。
      pluginVersion: receipt.pluginVersion || undefined,
    };
    if (!terminal) {
      const running = await this.prisma.browserTask.update({
        where: { id: row.id },
        data: {
          status: 'RUNNING',
          ...base,
          ...(Object.keys(receipt.data).length
            ? { receiptData: toJsonInput(receipt.data) }
            : {}),
        },
      });
      return this.viewOf(running);
    }
    const done = await this.prisma.browserTask.update({
      where: { id: row.id },
      data: {
        ...base,
        status: terminal,
        results: toJsonInput(receipt.results),
        evidence: toJsonInput(receipt.evidence),
        receiptData: toJsonInput(receipt.data),
        leaseOwner: '',
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });
    return this.viewOf(done);
  }

  private viewOf(row: BrowserTask) {
    return {
      id: row.id,
      capability: row.capability,
      action: row.action,
      jobId: row.jobId,
      status: row.status,
      statusLabel: BROWSER_TASK_LIFECYCLE_LABELS[row.status] || row.status,
      source: row.source,
      platforms: fromJson<string[]>(row.platforms),
      leaseOwner: row.leaseOwner,
      leaseExpiresAt: row.leaseExpiresAt
        ? row.leaseExpiresAt.toISOString()
        : null,
      attempts: row.attempts,
      receiptStatus: row.receiptStatus,
      receiptCode: row.receiptCode,
      receiptMessage: row.receiptMessage,
      results: fromJson<Record<string, unknown>[]>(row.results),
      evidence: fromJson<Record<string, unknown>[]>(row.evidence),
      receiptData: fromJson<Record<string, unknown>>(row.receiptData),
      pluginVersion: row.pluginVersion,
      enqueuedAt: row.enqueuedAt.toISOString(),
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }
}

/** 生成任务幂等锚：能力前缀 + 时间 + 随机，长度受 jobId 列（80）约束。 */
function jobIdOf(capability: string): string {
  const prefix = capability.slice(0, 16);
  return `bt-${prefix}-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '')}`;
}
