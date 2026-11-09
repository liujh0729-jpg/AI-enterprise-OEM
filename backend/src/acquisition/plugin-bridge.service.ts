import { randomBytes } from 'node:crypto';
import { ACQ_DEFAULT_LIMITS, ACQ_PLUGIN_TYPES } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { EXTENSION_INFO } from '../distribution/distribution.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import {
  clip,
  int,
  iso,
  oneOf,
  orgKey,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

export type AcqPluginReportOutcome = {
  duplicated?: boolean;
  newLeads?: number;
  runStatus?: string;
  outreachStatus?: string;
  message?: string;
};

/** 采集与触达各自实现认领/回执，插件桥只管令牌、限流与分发，不认识业务表。 */
export type AcqPluginJobKind = {
  type: (typeof ACQ_PLUGIN_TYPES)[number];
  claim: (key: OrgKey, limit: number) => Promise<Row[]>;
  report: (
    key: OrgKey,
    body: Row,
    actorUserId: string,
  ) => Promise<AcqPluginReportOutcome>;
};

type TokenEntry = OrgKey & {
  userId: string;
  type: string;
  expiresAt: number;
};

/**
 * 浏览器插件桥：页面用登录态签发一次性令牌（绑定用户+组织+任务类型，5 分钟过期），
 * 插件只拿令牌 pull/report，不带会话、不读 Cookie。令牌存进程内（调度器同样是进程内定时器）。
 */
export class AcquisitionPluginBridgeService {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly kinds = new Map<string, AcqPluginJobKind>();
  /** 用户×组织双维限流：挡住连点与插件失控轮询，不当全局配额。 */
  private readonly pullWindow = new RateWindow(60, 60_000);
  private readonly reportWindow = new RateWindow(
    ACQ_DEFAULT_LIMITS.batchPerMinute * 4,
    60_000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
  ) {}

  register(kind: AcqPluginJobKind) {
    this.kinds.set(kind.type, kind);
  }

  async issueToken(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '获客已关闭，请先在设置里开启',
      );
    }
    const type = oneOf(body.type, ACQ_PLUGIN_TYPES, 'collect');
    if (!this.kinds.has(type)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该插件任务类型不可用',
      );
    }
    this.prune();
    const token = randomBytes(24).toString('hex');
    const expiresAt =
      Date.now() + ACQ_DEFAULT_LIMITS.pluginTokenTtlSeconds * 1000;
    this.tokens.set(token, {
      ...orgKey(org),
      userId: user.userId,
      type,
      expiresAt,
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: '获客插件令牌签发',
        detail: clip(
          `${type} 有效期${ACQ_DEFAULT_LIMITS.pluginTokenTtlSeconds}秒`,
          500,
        ),
      },
    });
    return {
      token,
      expiresAt: iso(new Date(expiresAt)),
      version: EXTENSION_INFO.version,
      pullMax: ACQ_DEFAULT_LIMITS.pluginPullMax,
      intervalMinSeconds: settings.intervalMinSeconds,
      intervalMaxSeconds: settings.intervalMaxSeconds,
    };
  }

  async pull(body: Row) {
    const entry = this.verify(body.token);
    const requested = text(body.type);
    if (requested && requested !== entry.type) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '令牌不能拉取其他类型的任务',
      );
    }
    const settings = await this.settings.forOrg(entry);
    if (!settings.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '获客已关闭，请回到页面重新开启',
      );
    }
    this.pullWindow.consume(
      `${entry.orgUserId}:${entry.userId}`,
      '插件拉取过于频繁，请一分钟后再试',
    );
    const kinds = requested
      ? [this.kinds.get(requested)]
      : [...this.kinds.values()];
    const jobs: Row[] = [];
    for (const kind of kinds) {
      if (!kind) continue;
      const remaining = ACQ_DEFAULT_LIMITS.pluginPullMax - jobs.length;
      if (remaining <= 0) break;
      jobs.push(...(await kind.claim(entry, remaining)));
    }
    return {
      jobs,
      intervalMinSeconds: settings.intervalMinSeconds,
      intervalMaxSeconds: settings.intervalMaxSeconds,
    };
  }

  async report(body: Row) {
    const entry = this.verify(body.token);
    const type = oneOf(body.type, ACQ_PLUGIN_TYPES, 'collect');
    if (type !== entry.type) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '令牌不能回报其他类型的任务',
      );
    }
    const kind = this.kinds.get(type);
    if (!kind) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该插件任务类型不可用',
      );
    }
    this.reportWindow.consume(
      `${entry.orgUserId}:${entry.userId}`,
      '插件回报过于频繁，请一分钟后再试',
    );
    const outcome = await kind.report(entry, body, entry.userId);
    return {
      accepted: true,
      duplicated: outcome.duplicated === true,
      newLeads: Math.max(0, int(outcome.newLeads)),
      runStatus: clip(outcome.runStatus, 20),
      outreachStatus: clip(outcome.outreachStatus, 20),
      message: clip(outcome.message, 300),
    };
  }

  private verify(raw: unknown): TokenEntry {
    this.prune();
    const token = clip(text(raw), 200);
    const entry = token ? this.tokens.get(token) : undefined;
    if (!entry || entry.expiresAt <= Date.now()) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '插件令牌无效或已过期，请回到获客页面重新连接插件',
      );
    }
    return entry;
  }

  private prune() {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) this.tokens.delete(token);
    }
  }
}
