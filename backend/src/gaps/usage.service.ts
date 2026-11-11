import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import {
  asInt,
  asText,
  clip,
  iso,
  json,
  jsonBlock,
  pageParams,
  Row,
} from './gaps.helpers';

const SETTING_KEY = 'usage_analytics';
const DEFAULT_SETTINGS = { enabled: false, retentionDays: 90 };

/** 埋点只收「谁在哪个页面做了什么」，metadata 限长并裁掉疑似敏感键。 */
const UNSAFE_KEY =
  /pass(word)?|token|secret|credential|phone|email|idcard|bank/i;
const META_KEY_LIMIT = 32;

const cleanMeta = (value: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(jsonBlock(value))) {
    if (kept >= META_KEY_LIMIT) break;
    if (UNSAFE_KEY.test(key)) continue;
    const safeKey = key.slice(0, 48);
    const safeValue =
      typeof raw === 'string'
        ? raw.slice(0, 120)
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? raw
          : undefined;
    if (safeValue === undefined) continue;
    if (!(safeKey in out)) kept += 1;
    out[safeKey] = safeValue;
  }
  return out;
};

/**
 * B3#30 产品使用埋点：默认关闭；开启后才落库，且只记路由/动作/对象标识。
 * 平台管理员可调整开关与保留天数，汇总按动作给次数与去重用户数。
 */
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  async settings() {
    const row = await this.prisma.usageSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(row.value) as Row;
      return {
        enabled: parsed.enabled === true,
        retentionDays: Math.min(
          730,
          Math.max(
            7,
            asInt(parsed.retentionDays, DEFAULT_SETTINGS.retentionDays),
          ),
        ),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const data = {
      enabled: body.enabled === true,
      retentionDays: Math.min(
        730,
        Math.max(7, asInt(body.retentionDays, 90) || 90),
      ),
    };
    await this.prisma.usageSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(data) },
      update: { value: JSON.stringify(data) },
    });
    await this.cleanup(data.retentionDays);
    return data;
  }

  /** 每日留存清理：按当前设置删除超过留存天数的事件。 */
  async prune(): Promise<number> {
    const settings = await this.settings();
    const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000);
    const result = await this.prisma.productUsageEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  private async cleanup(retentionDays: number) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    await this.prisma.productUsageEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }

  async track(user: CurrentUser, body: Row, meta: { ip?: string } = {}) {
    const settings = await this.settings();
    if (!settings.enabled) return { recorded: false };
    const event = clip(body.event, 64).trim();
    if (!event)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少事件名');
    const org = await this.scope.resolve(user);
    await this.prisma.productUsageEvent.create({
      data: {
        userId: user.userId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        event,
        route: clip(body.route, 200),
        targetType: clip(body.targetType, 32),
        targetId: clip(body.targetId, 64),
        metadata: json(cleanMeta(body.metadata)),
        ip: clip(meta.ip, 64),
      },
    });
    return { recorded: true };
  }

  async events(user: CurrentUser, query: Row) {
    this.scope.requirePlatformAdmin(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      ...(asText(query.event).trim()
        ? { event: asText(query.event).trim() }
        : {}),
      ...(asText(query.userId).trim()
        ? { userId: asText(query.userId).trim() }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.productUsageEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.productUsageEvent.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        orgType: row.orgType,
        orgUserId: row.orgUserId,
        event: row.event,
        route: row.route,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: jsonBlock(row.metadata),
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async summary(user: CurrentUser, query: Row) {
    this.scope.requirePlatformAdmin(user);
    const days = Math.min(365, Math.max(1, asInt(query.days, 30) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.productUsageEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { event: true, userId: true },
    });
    const byEvent = new Map<string, { count: number; users: Set<string> }>();
    for (const row of rows) {
      const entry = byEvent.get(row.event) || {
        count: 0,
        users: new Set<string>(),
      };
      entry.count += 1;
      entry.users.add(row.userId);
      byEvent.set(row.event, entry);
    }
    return {
      total: rows.length,
      rows: [...byEvent.entries()]
        .map(([event, entry]) => ({
          event,
          count: entry.count,
          users: entry.users.size,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
