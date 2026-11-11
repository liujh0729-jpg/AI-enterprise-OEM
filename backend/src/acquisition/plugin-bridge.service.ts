import { createHash, randomBytes } from 'node:crypto';
import { ACQ_DEFAULT_LIMITS, ACQ_PLUGIN_TYPES } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { EXTENSION_INFO } from '../distribution/distribution.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import type { ExtensionCatalogService } from '../platform/extension-catalog.service';
import type { BrowserTaskService } from '../platform/browser-task.service';
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

/** 令牌只落哈希：明文仅在签发响应里出现一次，服务端与日志都不可回读。 */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * 浏览器插件桥：页面用登录态签发一次性令牌（绑定用户+组织+任务类型，5 分钟过期），
 * 插件只拿令牌 pull/report，不带会话、不读 Cookie。令牌**落库**（只存哈希 + 过期时间），
 * 因此进程重启或多实例部署下仍按同一份状态校验。
 */
export class AcquisitionPluginBridgeService {
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
    private readonly scope: HrmScopeService,
    private readonly catalog: ExtensionCatalogService,
    private readonly tasks: BrowserTaskService,
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
    const key = orgKey(org);
    // 派发前校验插件能力：下线/弃用/灰度未覆盖或版本过低时拒绝签发令牌。
    await this.catalog.assertDispatchable('acquisition', {
      pluginVersion: text(body.pluginVersion),
      orgUserId: key.orgUserId,
    });
    // 统一任务队列（§10.3）：每次启动落一条浏览器任务，插件终态回执由页面挂回它。
    // 同一用户同一组织只保留一条在办任务，重新启动时旧任务按 EXPIRED 收尾。
    await this.tasks.dispatch(user, {
      capability: 'acquisition',
      action: type,
      source: `acquisition:${key.orgUserId}:${type}`,
      orgType: key.orgType,
      orgUserId: key.orgUserId,
      // 台账只记任务类型：令牌是 5 分钟密钥，由页面拿到后直传插件，不留服务端（契约同口径）。
      payload: { type },
      pluginVersion: text(body.pluginVersion),
    });
    const token = randomBytes(24).toString('hex');
    const expiresAt =
      Date.now() + ACQ_DEFAULT_LIMITS.pluginTokenTtlSeconds * 1000;
    await this.prisma.pluginSessionToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.userId,
        scope: type,
        orgType: key.orgType,
        orgUserId: key.orgUserId,
        expiresAt: new Date(expiresAt),
      },
    });
    // 顺手清掉过期行：过期即无效，留着只会涨表；索引在 expires_at 上，代价可忽略。
    await this.prisma.pluginSessionToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
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
    const entry = await this.verify(body.token);
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
    const entry = await this.verify(body.token);
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

  /**
   * 统一回执落库（登录态，§10.7 统一协议）：插件终态回执由页面挂到浏览器任务队列上。
   * 业务结果仍以 `report`（令牌）为准，这里只终结任务并留下证据，未登记任务按幂等忽略。
   */
  async recordReceipt(user: CurrentUser, body: Row) {
    return this.tasks.recordReceipt(user, {
      ...body,
      capability: 'acquisition',
    });
  }

  private async verify(raw: unknown): Promise<TokenEntry> {
    const token = clip(text(raw), 200);
    const row = token
      ? await this.prisma.pluginSessionToken.findUnique({
          where: { tokenHash: hashToken(token) },
        })
      : null;
    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '插件令牌无效或已过期，请回到获客页面重新连接插件',
      );
    }
    // 令牌只证明「曾经登录过」：每次拉取/回报都按当前库表复核账号状态与组织在册资格，
    // 离职/移出组织后 5 分钟令牌窗口内也立即失效，并顺手把该令牌吊销。
    const standing = await this.scope.isStanding(row.userId, {
      orgType: row.orgType,
      orgUserId: row.orgUserId,
    });
    if (!standing) {
      await this.prisma.pluginSessionToken
        .update({ where: { id: row.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '账号或组织资格已失效，请重新登录后再连接插件',
      );
    }
    // lastUsedAt 只作运维观察，写失败（如只读副本）不影响拉取/回报主链路。
    void this.prisma.pluginSessionToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return {
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      userId: row.userId,
      type: row.scope,
      expiresAt: row.expiresAt.getTime(),
    };
  }
}
