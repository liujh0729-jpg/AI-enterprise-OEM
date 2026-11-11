import { Prisma } from '../../generated/prisma';
import {
  RC_AGENT_MODE_LABELS,
  RC_AGENT_MODES,
  RC_SCHEDULE_LAST_STATUS_LABELS,
  RC_SCHEDULE_STATUS_LABELS,
  rcSessionTerminal,
  type RcScheduleView,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { parseId } from '../common/parse-id';
import {
  computeNextOccurrence,
  readScheduleFields,
  scheduleConfigOf,
  SCHEDULE_TYPE_LABELS,
} from '../common/schedule';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { PrismaService } from '../prisma/prisma.service';
import { asJsonArray, toJsonArray } from '../shared/json-value';
import type { ChromeAgentService } from './chrome-agent.service';
import { normalizeChromeAction } from './chrome-device.service';

/**
 * 浏览器代理的计划任务（docs/浏览器代理插件升级方案.md §七 P5）：
 * 到点让本人某台设备按同一套会话引擎（ChromeAgentService）跑一个目标。
 *
 * 绿灯闸：执行前先要求目标设备在线（requireOnlineDevice）——插件没开、令牌失效、
 * 设备离线都当轮「跳过」，不排队补跑；账号停用即自动暂停（isStanding 复权）。
 * 定时触发不管在途会话：同一个任务到点即起一轮，长跑会话由会话引擎自身的步数/时长上限收口。
 */

const TITLE_MAX = 80;
const GOAL_MAX = 1000;
const DUE_LIMIT = 10;

/** 计划任务只允许「定时一次 / 周期重复」，不接受「不排期」。 */
function readScheduleForPlan(body: Record<string, unknown>) {
  const fields = readScheduleFields(body);
  const type = text(fields.scheduleType).trim();
  if (type !== 'scheduled' && type !== 'recurring') {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '计划任务要么「定时一次」，要么「周期重复」',
    );
  }
  return fields;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : text(error) || '执行失败';
}

export class RpaChromeScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly agent: ChromeAgentService,
  ) {}

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const where: Prisma.RpaChromeScheduleWhereInput = {
      createdBy: user.userId,
    };
    const status = text(query.status).trim().toLowerCase();
    if (status) where.status = status.slice(0, 16);
    const rows = await this.prisma.rpaChromeSchedule.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    });
    await this.reconcile(user.userId, rows);
    const names = await this.deviceNames(
      user.userId,
      rows.map((row) => row.clientId),
    );
    return {
      list: rows.map((row) => this.view(row, names.get(row.clientId) || '')),
    };
  }

  /** 计划任务 upsert：id>0 且归属本人时更新，否则新建；新建/改动周期即重算下一次执行时刻。 */
  async save(user: CurrentUser, body: Record<string, unknown>) {
    const title = text(body.title).trim().slice(0, TITLE_MAX);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务名称');
    }
    const goal = text(body.goal).trim().slice(0, GOAL_MAX);
    if (!goal) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写要执行的目标');
    }
    const clientId = text(body.clientId).trim().slice(0, 64);
    if (!clientId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要执行的本机设备',
      );
    }
    const device = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: user.userId, clientId } },
      select: { name: true },
    });
    if (!device) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '设备不存在：请先在「本地 Chrome」插件里登录本系统',
      );
    }
    const modeRaw = text(body.mode).trim().toLowerCase();
    const mode = (RC_AGENT_MODES as readonly string[]).includes(modeRaw)
      ? modeRaw
      : 'act';
    const script = asJsonArray(body.script as Prisma.JsonValue)
      .map((item) => normalizeChromeAction(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const maxStepsRaw = Number(body.maxSteps);
    const maxSteps = Number.isFinite(maxStepsRaw)
      ? Math.min(60, Math.max(1, Math.round(maxStepsRaw)))
      : 25;
    const fields = readScheduleForPlan(body);
    const now = new Date();
    const scheduledAt =
      fields.scheduleType === 'recurring'
        ? computeNextOccurrence(scheduleConfigOf(fields.scheduleConfig), now)
        : (fields.scheduledAt ?? null);
    if (fields.scheduleType === 'recurring' && !scheduledAt) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '周期配置算不出下一次执行时刻，请检查频率与时刻',
      );
    }
    const data = {
      clientId,
      title,
      goal,
      mode,
      startUrl: text(body.startUrl).trim().slice(0, 2000),
      script: toJsonArray(script),
      model: text(body.model).trim().slice(0, 128),
      maxSteps,
      scheduleType: fields.scheduleType,
      scheduleConfig: fields.scheduleConfig ?? {},
      scheduledAt,
      status: body.status === 'paused' ? 'paused' : 'enabled',
    };
    const id = Math.max(0, Math.round(Number(body.id) || 0));
    let row;
    if (id > 0) {
      const existing = await this.prisma.rpaChromeSchedule.findFirst({
        where: { id, createdBy: user.userId },
        select: { id: true },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '计划任务不存在');
      }
      row = await this.prisma.rpaChromeSchedule.update({
        where: { id },
        data,
      });
    } else {
      row = await this.prisma.rpaChromeSchedule.create({
        data: { createdBy: user.userId, ...data },
      });
    }
    return this.view(row, device.name);
  }

  async remove(user: CurrentUser, idRaw: string) {
    const id = parseId(idRaw, '计划任务 ID');
    const result = await this.prisma.rpaChromeSchedule.deleteMany({
      where: { id, createdBy: user.userId },
    });
    if (!result.count) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划任务不存在');
    }
    return { removed: true };
  }

  /** 「立即执行」：不动 scheduledAt，只补跑一轮并回执本轮结果。 */
  async runNow(user: CurrentUser, idRaw: string) {
    const id = parseId(idRaw, '计划任务 ID');
    const row = await this.load(user.userId, id);
    await this.dispatch(row);
    const fresh = await this.load(user.userId, id);
    await this.reconcile(user.userId, [fresh]);
    const names = await this.deviceNames(user.userId, [fresh.clientId]);
    return this.view(fresh, names.get(fresh.clientId) || '');
  }

  /**
   * 调度器调用：把到点的计划任务各跑一轮。
   * 先把下一次执行时刻推走再跑，避免一轮没跑完就被下一个 tick 重复接走；
   * 定时一次跑完即没有下一次（scheduledAt 置空）。
   */
  async advanceDue() {
    const now = new Date();
    const due = await this.prisma.rpaChromeSchedule.findMany({
      where: {
        status: 'enabled',
        scheduleType: { in: ['scheduled', 'recurring'] },
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: DUE_LIMIT,
    });
    if (!due.length) return 0;
    for (const row of due) {
      const nextAt =
        row.scheduleType === 'recurring'
          ? computeNextOccurrence(scheduleConfigOf(row.scheduleConfig), now)
          : null;
      await this.prisma.rpaChromeSchedule.update({
        where: { id: row.id },
        data: { scheduledAt: nextAt },
      });
      await this.dispatch(row);
    }
    return due.length;
  }

  // ---------------------------------------------------------------- 内部

  private async load(userId: string, id: number) {
    const row = await this.prisma.rpaChromeSchedule.findFirst({
      where: { id, createdBy: userId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划任务不存在');
    return row;
  }

  /** 起一轮会话：账号先复权，再走到点在线的绿灯闸；离线/停用一律如实记「跳过」，不谎报成功。 */
  private async dispatch(row: Prisma.RpaChromeScheduleGetPayload<object>) {
    const standing = await this.scope.isStanding(row.createdBy);
    if (!standing) {
      await this.prisma.rpaChromeSchedule.update({
        where: { id: row.id },
        data: {
          status: 'paused',
          scheduledAt: null,
          lastRunAt: new Date(),
          lastStatus: 'skipped',
          lastError: '账号已停用，计划任务已自动暂停',
        },
      });
      return;
    }
    const user = new CurrentUser(row.createdBy, '', 'user');
    try {
      const session = await this.agent.startSession(user, {
        clientId: row.clientId,
        goal: row.goal,
        mode: row.mode,
        startUrl: row.startUrl,
        maxSteps: row.maxSteps,
        modelKey: row.model,
        actions: asJsonArray(row.script),
      });
      await this.prisma.rpaChromeSchedule.update({
        where: { id: row.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'running',
          lastError: '',
          lastSessionId: session.id,
          runCount: { increment: 1 },
        },
      });
      return;
    } catch (error) {
      const reason = messageOf(error);
      // 设备离线/停用/不存在属「本轮没条件跑」，记跳过；其余（模型/参数等）记失败。
      const skipped = /离线|停用|不存在|未登录/.test(reason);
      await this.prisma.rpaChromeSchedule.update({
        where: { id: row.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: skipped ? 'skipped' : 'failed',
          lastError: reason.slice(0, 500),
          lastSessionId: 0,
        },
      });
      return;
    }
  }

  /** 把「执行中」的行按最近一次会话的终态回写成功/失败，避免状态一直挂在 running。 */
  private async reconcile(
    userId: string,
    rows: Prisma.RpaChromeScheduleGetPayload<object>[],
  ) {
    const pending = rows.filter(
      (row) => row.lastStatus === 'running' && row.lastSessionId > 0,
    );
    if (!pending.length) return;
    const sessions = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: userId,
        id: { in: pending.map((row) => row.lastSessionId) },
      },
      select: { id: true, status: true, stopReason: true, errorMessage: true },
    });
    const byId = new Map(sessions.map((item) => [item.id, item]));
    for (const row of pending) {
      const session = byId.get(row.lastSessionId);
      if (!session || !rcSessionTerminal(session.status)) continue;
      const succeeded = session.status === 'COMPLETED';
      const detail = succeeded
        ? ''
        : session.errorMessage || session.stopReason || '会话未完成';
      row.lastStatus = succeeded ? 'succeeded' : 'failed';
      row.lastError = succeeded ? '' : detail.slice(0, 500);
      await this.prisma.rpaChromeSchedule.update({
        where: { id: row.id },
        data: { lastStatus: row.lastStatus, lastError: row.lastError },
      });
    }
  }

  private async deviceNames(userId: string, clientIds: string[]) {
    const unique = [...new Set(clientIds.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.rpaChromeDevice.findMany({
      where: { createdBy: userId, clientId: { in: unique } },
      select: { clientId: true, name: true },
    });
    return new Map(rows.map((row) => [row.clientId, row.name]));
  }

  private view(
    row: Prisma.RpaChromeScheduleGetPayload<object>,
    deviceName: string,
  ): RcScheduleView {
    return {
      id: row.id,
      clientId: row.clientId,
      deviceName: deviceName || `Chrome · ${row.clientId.slice(0, 6)}`,
      title: row.title,
      goal: row.goal,
      mode: row.mode,
      modeLabel: RC_AGENT_MODE_LABELS[row.mode] || row.mode,
      startUrl: row.startUrl,
      scriptSteps: asJsonArray(row.script).length,
      model: row.model,
      maxSteps: row.maxSteps,
      scheduleType: row.scheduleType,
      scheduleTypeLabel:
        SCHEDULE_TYPE_LABELS[row.scheduleType] || row.scheduleType,
      scheduleConfig: scheduleConfigOf(row.scheduleConfig),
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      status: row.status,
      statusLabel: RC_SCHEDULE_STATUS_LABELS[row.status] || row.status,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastStatus: row.lastStatus,
      lastStatusLabel: RC_SCHEDULE_LAST_STATUS_LABELS[row.lastStatus] || '',
      lastError: row.lastError,
      lastSessionId: row.lastSessionId,
      runCount: row.runCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
