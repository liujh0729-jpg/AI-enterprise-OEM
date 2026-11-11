import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import {
  RC_DEVICE_STATUS_LABELS,
  RC_DEVICE_TOKEN_PREFIX,
  RC_HEARTBEAT_BATCH,
  RC_ONLINE_TIMEOUT_MS,
  rcDeviceOnline,
  rcActionNeedsConfirm,
  normalizeLoginDomain,
  type RcDeviceView,
  type RcHeartbeatResult,
  type RcLoginResult,
} from '@enterprise/contracts';
import type { AccountService } from '../account/account.service';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonObject, asJsonArray } from '../shared/json-value';

/**
 * 本地 Chrome 插件设备通道（docs/本地Chrome插件RPA控制方案.md §5.1 / §5.2 / §8）：
 * 插件用本站账号登录 → 设备注册（令牌只存 sha256）→ 心跳领取指令 → 按 commandCode 幂等回执。
 * 云端不持有目标平台口令（D3-A），插件本地登录；插件只执行闭集动作（D4-A）。
 */

const loginLimiter = new RateWindow(12, 60_000);
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 设备可执行动作的闭集（与契约 RC_ACTIONS 对齐；未知动作一律 FAILED，不做「尽力而为」）。 */
const RC_ACTION_SET = new Set([
  'open_tab',
  'close_tab',
  'navigate',
  'snapshot',
  'read',
  'act',
  'wait',
  'screenshot',
  'finish',
]);

export type ChromeSettings = {
  maxSteps: number;
  stepTimeoutSeconds: number;
  sessionTimeoutSeconds: number;
  blockedHosts: string[];
  confirmSensitive: boolean;
  retainDays: number;
};

export const CHROME_SETTING_DEFAULTS: ChromeSettings = {
  maxSteps: 25,
  stepTimeoutSeconds: 120,
  sessionTimeoutSeconds: 900,
  blockedHosts: [],
  confirmSensitive: true,
  retainDays: 7,
};

export type ChromeDevicePrincipal = {
  id: number;
  userId: string;
  clientId: string;
  name: string;
};

/** 设备终态指令（不再变化）：心跳不再下发、回执按幂等处理。 */
const TERMINAL_COMMAND = new Set(['DONE', 'FAILED', 'TIMEOUT', 'CANCELLED']);
const ACTIVE_SESSION_STATUSES = ['RUNNING', 'WAITING_CONFIRM', 'PAUSED'];

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function newDeviceToken() {
  return `${RC_DEVICE_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
}

function newCommandCode() {
  return `rc${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

function clip(value: unknown, max: number) {
  return text(value).slice(0, max);
}

export class RpaChromeDeviceService {
  private accounts: AccountService | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  /**
   * 账号模块在 app 装配阶段才构造（依赖 services），晚于本服务；
   * 由 main/app 在挂载路由前注入，登录校验走同一套账号逻辑。
   */
  bindAccounts(accounts: AccountService) {
    this.accounts = accounts;
  }

  private requireAccounts() {
    if (!this.accounts) {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '账号模块尚未就绪，请稍后重试',
      );
    }
    return this.accounts;
  }

  // ---------- 设置 ----------

  async settingsOf(userId: string): Promise<ChromeSettings> {
    const row = await this.prisma.rpaSetting.findUnique({
      where: { createdBy: userId },
      select: { chromeSettings: true },
    });
    const stored: Record<string, unknown> = toJsonObject(row?.chromeSettings);
    const num = (
      key: keyof ChromeSettings,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const value = Number(stored[key as string]);
      if (!Number.isFinite(value)) return fallback;
      return Math.min(max, Math.max(min, Math.round(value)));
    };
    return {
      maxSteps: num('maxSteps', CHROME_SETTING_DEFAULTS.maxSteps, 1, 60),
      stepTimeoutSeconds: num(
        'stepTimeoutSeconds',
        CHROME_SETTING_DEFAULTS.stepTimeoutSeconds,
        10,
        600,
      ),
      sessionTimeoutSeconds: num(
        'sessionTimeoutSeconds',
        CHROME_SETTING_DEFAULTS.sessionTimeoutSeconds,
        60,
        7200,
      ),
      blockedHosts: asJsonArray(stored.blockedHosts as Prisma.JsonValue)
        .map((item) => text(item).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 100),
      confirmSensitive: stored.confirmSensitive !== false,
      retainDays: num('retainDays', CHROME_SETTING_DEFAULTS.retainDays, 1, 90),
    };
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const base = await this.settingsOf(user.userId);
    const merged: ChromeSettings = {
      maxSteps:
        body.maxSteps === undefined ? base.maxSteps : Number(body.maxSteps),
      stepTimeoutSeconds:
        body.stepTimeoutSeconds === undefined
          ? base.stepTimeoutSeconds
          : Number(body.stepTimeoutSeconds),
      sessionTimeoutSeconds:
        body.sessionTimeoutSeconds === undefined
          ? base.sessionTimeoutSeconds
          : Number(body.sessionTimeoutSeconds),
      blockedHosts:
        body.blockedHosts === undefined
          ? base.blockedHosts
          : asJsonArray(body.blockedHosts).map((item) => text(item)),
      confirmSensitive:
        body.confirmSensitive === undefined
          ? base.confirmSensitive
          : body.confirmSensitive !== false,
      retainDays:
        body.retainDays === undefined
          ? base.retainDays
          : Number(body.retainDays),
    };
    const value = normalizeSettingsJson(merged) as Prisma.InputJsonValue;
    await this.prisma.rpaSetting.upsert({
      where: { createdBy: user.userId },
      create: { createdBy: user.userId, chromeSettings: value },
      update: { chromeSettings: value },
    });
    return this.settingsOf(user.userId);
  }

  // ---------- 登录 / 令牌 ----------

  async login(
    body: Record<string, unknown>,
    ip: string,
    userAgent: string,
  ): Promise<RcLoginResult> {
    const domain = normalizeLoginDomain(text(body.domain));
    if (!domain) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '登录地址必须是本站地址（http / https 均可，在插件侧边栏的账号菜单里填本系统域名）',
      );
    }
    const clientId = text(body.clientId).trim();
    if (!CLIENT_ID_PATTERN.test(clientId)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '设备号格式不合法');
    }
    const username = text(body.username).trim();
    const password = text(body.password);
    if (!username || !password) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写账号与密码');
    }
    loginLimiter.consume(`chrome:${clientId}`, '登录尝试过于频繁，请稍后再试');

    const account = await this.requireAccounts().login(username, password, {
      ip,
      userAgent,
    });
    const deviceName = (
      text(body.deviceName).trim() || `Chrome · ${clientId.slice(0, 6)}`
    ).slice(0, 80);
    const version = clip(body.extensionVersion, 24);
    const token = newDeviceToken();
    const tokenHash = hashToken(token);
    await this.prisma.rpaChromeDevice.upsert({
      where: { createdBy_clientId: { createdBy: account.userId, clientId } },
      create: {
        createdBy: account.userId,
        clientId,
        name: deviceName,
        domain,
        tokenHash,
        extensionVersion: version,
        status: 'ONLINE',
        lastSeenAt: new Date(),
        lastIp: clip(ip, 64),
      },
      update: {
        name: deviceName,
        domain,
        tokenHash,
        extensionVersion: version,
        status: 'ONLINE',
        lastSeenAt: new Date(),
        lastIp: clip(ip, 64),
      },
    });
    const settings = await this.settingsOf(account.userId);
    return {
      token,
      clientId,
      deviceName,
      username: account.username,
      limits: limitsOf(settings),
      blockedHosts: settings.blockedHosts,
      confirmSensitive: settings.confirmSensitive,
      heartbeatSeconds: 30,
    };
  }

  /** 令牌 → 设备主体：查库 + 复权（账号被封/注销/不在册即拒并停用），失败一律 null。 */
  async deviceByToken(raw: string): Promise<ChromeDevicePrincipal | null> {
    const token = text(raw).trim();
    if (!token.startsWith(RC_DEVICE_TOKEN_PREFIX)) return null;
    const row = await this.prisma.rpaChromeDevice.findFirst({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.status !== 'ONLINE') return null;
    const standing = await this.scope
      .isStanding(row.createdBy)
      .catch(() => false);
    if (!standing) {
      await this.prisma.rpaChromeDevice
        .update({
          where: { id: row.id },
          data: { status: 'DISABLED', tokenHash: '' },
        })
        .catch(() => undefined);
      return null;
    }
    return {
      id: row.id,
      userId: row.createdBy,
      clientId: row.clientId,
      name: row.name,
    };
  }

  private async principalRow(id: number) {
    return this.prisma.rpaChromeDevice.findUnique({ where: { id } });
  }

  /**
   * 设备主体 → 登录人身份：设备通道免登录，但下游（模型广场 / 积分 / 授权闸）
   * 都要 CurrentUser，这里按设备属主还原一个最小身份，不伪造角色越权。
   */
  async currentUser(device: ChromeDevicePrincipal): Promise<CurrentUser> {
    const id = Number(device.userId);
    const row =
      Number.isFinite(id) && id > 0
        ? await this.prisma.account.findUnique({
            where: { id },
            select: { username: true, role: true },
          })
        : null;
    return new CurrentUser(
      device.userId,
      row?.username || device.name || '',
      row?.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
    );
  }

  async logout(device: ChromeDevicePrincipal) {
    await this.prisma.rpaChromeDevice.update({
      where: { id: device.id },
      data: { tokenHash: '', status: 'OFFLINE', lastSeenAt: null },
    });
    return { ok: true };
  }

  // ---------- 心跳（顺带领取指令） ----------

  async touch(
    device: ChromeDevicePrincipal,
    body: Record<string, unknown>,
    ip: string,
  ): Promise<RcHeartbeatResult> {
    const prev = await this.principalRow(device.id);
    const now = new Date();
    const version = clip(body.version, 24);
    const pages = Array.isArray(body.pages) ? body.pages.slice(0, 20) : [];
    await this.prisma.rpaChromeDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        lastIp: clip(ip, 64),
        status: 'ONLINE',
        pages: pages as Prisma.InputJsonValue,
        ...(version ? { extensionVersion: version } : {}),
      },
    });
    // 被云端停掉的会话：上报「上次心跳之后结束的会话」，插件据此收横幅、停本地执行。
    const since = prev?.lastSeenAt ?? new Date(now.getTime() - 5 * 60_000);
    const stopped = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: device.userId,
        clientId: device.clientId,
        status: { in: ['CANCELLED', 'TIMEOUT', 'FAILED', 'COMPLETED'] },
        endedAt: { gt: since },
      },
      select: { id: true },
    });
    const pendingConfirms = await this.prisma.rpaChromeCommand.findMany({
      where: { clientId: device.clientId, status: 'PENDING_CONFIRM' },
      orderBy: { id: 'asc' },
      take: RC_HEARTBEAT_BATCH,
    });
    const commands = await this.prisma.rpaChromeCommand.findMany({
      where: { clientId: device.clientId, status: 'PENDING' },
      orderBy: { id: 'asc' },
      take: RC_HEARTBEAT_BATCH,
    });
    if (commands.length) {
      await this.prisma.rpaChromeCommand.updateMany({
        where: { id: { in: commands.map((item) => item.id) } },
        data: { status: 'DISPATCHED', dispatchedAt: now },
      });
    }
    const settings = await this.settingsOf(device.userId);
    return {
      received: true,
      serverTime: now.toISOString(),
      pendingConfirms: pendingConfirms.map((row) => ({
        commandCode: row.commandCode,
        sessionId: row.sessionId,
        stepIndex: row.stepIndex,
        action: toJsonObject(row.action),
      })),
      commands: commands.map((row) => ({
        commandCode: row.commandCode,
        sessionId: row.sessionId,
        stepIndex: row.stepIndex,
        action: toJsonObject(row.action),
      })),
      stoppedSessionIds: stopped.map((row) => row.id),
      revoked: false,
      limits: limitsOf(settings),
    };
  }

  // ---------- 回执 / 确认 / 停止 ----------

  async report(device: ChromeDevicePrincipal, body: Record<string, unknown>) {
    const code = clip(body.commandCode, 40);
    const row = await this.prisma.rpaChromeCommand.findFirst({
      where: { commandCode: code, clientId: device.clientId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '指令不存在或不属于本设备',
      );
    }
    if (TERMINAL_COMMAND.has(row.status))
      return { received: true, duplicate: true };
    const ok = body.ok === true;
    await this.prisma.rpaChromeCommand.update({
      where: { id: row.id },
      data: {
        status: ok ? 'DONE' : 'FAILED',
        finishedAt: new Date(),
        result: {
          ok,
          data: toJsonObject(body.data),
          errorMessage: clip(body.errorMessage, 500),
          elapsedMs: Math.max(0, Math.round(Number(body.elapsedMs) || 0)),
          code: clip(body.code, 40),
        },
      },
    });
    return { received: true, duplicate: false };
  }

  async confirm(device: ChromeDevicePrincipal, body: Record<string, unknown>) {
    const code = clip(body.commandCode, 40);
    const allow = body.allow === true;
    const row = await this.prisma.rpaChromeCommand.findFirst({
      where: { commandCode: code, clientId: device.clientId },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '指令不存在或不属于本设备',
      );
    if (row.status !== 'PENDING_CONFIRM') return { received: true };
    if (allow) {
      // 允许本次 → 转回 PENDING，由下一次心跳下发执行
      await this.prisma.rpaChromeCommand.update({
        where: { id: row.id },
        data: { status: 'PENDING', confirmState: 'ALLOWED' },
      });
    } else {
      await this.prisma.rpaChromeCommand.update({
        where: { id: row.id },
        data: {
          status: 'CANCELLED',
          confirmState: 'DENIED',
          finishedAt: new Date(),
          result: {
            ok: false,
            data: {},
            errorMessage: '用户拒绝了本次敏感操作',
            elapsedMs: 0,
            code: 'NEED_CONFIRM',
          },
        },
      });
    }
    return { received: true };
  }

  async stopFromPlugin(
    device: ChromeDevicePrincipal,
    body: Record<string, unknown>,
  ) {
    const sessionId = Math.max(0, Math.round(Number(body.sessionId) || 0));
    const sessions = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: device.userId,
        clientId: device.clientId,
        ...(sessionId
          ? { id: sessionId }
          : { status: { in: ACTIVE_SESSION_STATUSES } }),
      },
      select: { id: true },
    });
    for (const row of sessions) {
      await this.cancelSession(row.id, 'stopped', '用户在插件端停止了会话');
    }
    return { received: true, stopped: sessions.map((row) => row.id) };
  }

  /** 取消会话：置终态 + 取消其未终结指令（心跳/回执侧不再重复处理）。 */
  async cancelSession(sessionId: number, reason: string, message = '') {
    const now = new Date();
    await this.prisma.rpaChromeSession.updateMany({
      where: { id: sessionId, status: { in: ACTIVE_SESSION_STATUSES } },
      data: {
        status: 'CANCELLED',
        stopReason: reason,
        errorMessage: clip(message, 500),
        endedAt: now,
      },
    });
    await this.prisma.rpaChromeCommand.updateMany({
      where: {
        sessionId,
        status: { in: ['PENDING', 'DISPATCHED', 'PENDING_CONFIRM'] },
      },
      data: { status: 'CANCELLED', finishedAt: now },
    });
  }

  // ---------- 指令入队 ----------

  async enqueueCommand(input: {
    userId: string;
    clientId: string;
    sessionId: number;
    stepIndex: number;
    action: Record<string, unknown>;
    needsConfirm: boolean;
  }) {
    const commandCode = newCommandCode();
    return this.prisma.rpaChromeCommand.create({
      data: {
        createdBy: input.userId,
        clientId: input.clientId,
        sessionId: input.sessionId,
        stepIndex: input.stepIndex,
        commandCode,
        action: input.action as Prisma.InputJsonValue,
        status: input.needsConfirm ? 'PENDING_CONFIRM' : 'PENDING',
        confirmState: input.needsConfirm ? 'PENDING' : 'NONE',
      },
    });
  }

  // ---------- 设备清单（界面） ----------

  async listDevices(user: CurrentUser) {
    const rows = await this.prisma.rpaChromeDevice.findMany({
      where: { createdBy: user.userId },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    });
    const active = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: user.userId,
        status: { in: ACTIVE_SESSION_STATUSES },
      },
      select: { id: true, clientId: true },
      orderBy: { id: 'desc' },
    });
    const activeMap = new Map<string, number>();
    for (const row of active) {
      if (!activeMap.has(row.clientId)) activeMap.set(row.clientId, row.id);
    }
    const settings = await this.settingsOf(user.userId);
    return {
      devices: rows.map((row) =>
        this.viewOf(row, activeMap.get(row.clientId) || 0),
      ),
      settings,
    };
  }

  viewOf(
    row: {
      clientId: string;
      name: string;
      domain: string;
      extensionVersion: string;
      status: string;
      lastSeenAt: Date | null;
      createdAt: Date;
    },
    activeSessionId: number,
  ): RcDeviceView {
    const online = rcDeviceOnline({
      status: row.status,
      lastSeenAt: row.lastSeenAt,
    });
    const status =
      row.status === 'DISABLED' ? 'DISABLED' : online ? 'ONLINE' : 'OFFLINE';
    return {
      clientId: row.clientId,
      name: row.name || `Chrome · ${row.clientId.slice(0, 6)}`,
      domain: row.domain,
      extensionVersion: row.extensionVersion,
      status,
      statusLabel: RC_DEVICE_STATUS_LABELS[status] || status,
      online,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      activeSessionId,
    };
  }

  async getDeviceView(user: CurrentUser, clientId: string) {
    const row = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: user.userId, clientId } },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    const active = await this.prisma.rpaChromeSession.findFirst({
      where: {
        createdBy: user.userId,
        clientId,
        status: { in: ACTIVE_SESSION_STATUSES },
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return this.viewOf(row, active?.id || 0);
  }

  async setDeviceStatus(user: CurrentUser, clientId: string, enabled: boolean) {
    const row = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: user.userId, clientId } },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    await this.prisma.rpaChromeDevice.update({
      where: { id: row.id },
      data: { status: enabled ? 'ONLINE' : 'DISABLED' },
    });
    if (!enabled) {
      const sessions = await this.prisma.rpaChromeSession.findMany({
        where: {
          createdBy: user.userId,
          clientId,
          status: { in: ACTIVE_SESSION_STATUSES },
        },
        select: { id: true },
      });
      for (const item of sessions) {
        await this.cancelSession(item.id, 'stopped', '设备被停用');
      }
    }
    return this.getDeviceView(user, clientId);
  }

  async removeDevice(user: CurrentUser, clientId: string) {
    const row = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: user.userId, clientId } },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    const sessions = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: user.userId,
        clientId,
        status: { in: ACTIVE_SESSION_STATUSES },
      },
      select: { id: true },
    });
    for (const item of sessions) {
      await this.cancelSession(item.id, 'stopped', '设备被移除');
    }
    await this.prisma.rpaChromeCommand.deleteMany({
      where: {
        createdBy: user.userId,
        clientId,
        status: { notIn: ['DONE', 'FAILED'] },
      },
    });
    await this.prisma.rpaChromeDevice.delete({ where: { id: row.id } });
    return { removed: true };
  }

  // ---------- 供会话引擎复用的判断 ----------

  async deviceOnline(userId: string, clientId: string) {
    const row = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: userId, clientId } },
      select: { status: true, lastSeenAt: true },
    });
    return Boolean(row && rcDeviceOnline(row));
  }

  async requireOnlineDevice(user: CurrentUser, clientId: string) {
    const row = await this.prisma.rpaChromeDevice.findUnique({
      where: { createdBy_clientId: { createdBy: user.userId, clientId } },
      select: { status: true, lastSeenAt: true, name: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '设备不存在：请先在「本地 Chrome」插件里登录本系统',
      );
    }
    if (row.status === 'DISABLED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '设备已停用，请先在设备列表启用',
      );
    }
    if (!rcDeviceOnline(row)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `设备「${row.name || clientId}」当前离线（超过 ${Math.round(RC_ONLINE_TIMEOUT_MS / 1000)} 秒没有心跳），请确认插件已登录并保持 Chrome 打开`,
      );
    }
    return row;
  }
}

export function limitsOf(settings: ChromeSettings) {
  return {
    maxSteps: settings.maxSteps,
    stepTimeoutSeconds: settings.stepTimeoutSeconds,
    sessionTimeoutSeconds: settings.sessionTimeoutSeconds,
    // 插件侧 Agent 的安全前置：黑名单域名先拦、敏感动作先问（与设备通道同一套账号设置）。
    blockedHosts: settings.blockedHosts,
    confirmSensitive: settings.confirmSensitive,
  };
}

/** 校验并规整一次 LLM/脚本给出的动作：只放行闭集动作，act 只放行已登记子动作。 */
export function normalizeChromeAction(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const action = toJsonObject(raw);
  const name = text(action.action).trim().toLowerCase();
  if (!RC_ACTION_SET.has(name)) return null;
  const normalized: Record<string, unknown> = { action: name };
  if (name === 'act') {
    const interact = text(action.act).trim().toLowerCase();
    if (
      !['click', 'type', 'select', 'check', 'scroll', 'key', 'submit'].includes(
        interact,
      )
    ) {
      return null;
    }
    normalized.act = interact;
  }
  for (const key of [
    'selector',
    'elementIndex',
    'value',
    'url',
    'tabId',
    'ms',
    'key',
    'target',
    'reason',
  ]) {
    if (action[key] !== undefined) normalized[key] = action[key];
  }
  return normalized;
}

/** 动作是否属于敏感操作（提交类 / 命中关键词的点击），需本人在插件弹窗确认。 */
export function chromeActionNeedsConfirm(action: Record<string, unknown>) {
  return rcActionNeedsConfirm(action);
}

/**
 * 取模型给的这一步动作：模型可能写成扁平 { action: "open_tab", url: ... }，
 * 也可能写成嵌套 { action: { action: "open_tab", url: ... } }，两种都认（别的字段忽略）。
 */
export function normalizeDecidedAction(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  return normalizeChromeAction(raw.action) ?? normalizeChromeAction(raw);
}

function normalizeSettingsJson(value: ChromeSettings): Record<string, unknown> {
  return {
    maxSteps: Math.min(
      60,
      Math.max(
        1,
        Math.round(Number(value.maxSteps) || CHROME_SETTING_DEFAULTS.maxSteps),
      ),
    ),
    stepTimeoutSeconds: Math.min(
      600,
      Math.max(
        10,
        Math.round(
          Number(value.stepTimeoutSeconds) ||
            CHROME_SETTING_DEFAULTS.stepTimeoutSeconds,
        ),
      ),
    ),
    sessionTimeoutSeconds: Math.min(
      7200,
      Math.max(
        60,
        Math.round(
          Number(value.sessionTimeoutSeconds) ||
            CHROME_SETTING_DEFAULTS.sessionTimeoutSeconds,
        ),
      ),
    ),
    blockedHosts: Array.isArray(value.blockedHosts)
      ? value.blockedHosts
          .map((item) => text(item).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 100)
      : [],
    confirmSensitive: value.confirmSensitive !== false,
    retainDays: Math.min(
      90,
      Math.max(
        1,
        Math.round(
          Number(value.retainDays) || CHROME_SETTING_DEFAULTS.retainDays,
        ),
      ),
    ),
  };
}
