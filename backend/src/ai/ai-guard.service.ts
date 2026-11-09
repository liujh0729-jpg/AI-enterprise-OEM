import type { AiGuardSettings } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * AI 主开关与调用限流（§5.7 安全三件套，与积分、MCP 并列的第三闸）。
 *
 * - 平台总闸：SystemSetting `ai.master.enabled`，默认开启；
 * - 组织级收紧：`ai.master.org.<orgUserId>`，只能关不能反向打开平台总闸；
 * - 用户×组织双维限流：60 秒滑动窗口，`ai.rate.user.perMinute` / `ai.rate.org.perMinute`，
 *   0 表示不限；网关取模型与内容模型设置取目标同口径，静默链路据此回落规则式产出。
 *
 * 设置按 15 秒缓存，管理端保存后立即失效；限流窗口只在本进程内存，单实例部署下足够，
 * 多实例时每个实例各自计数（口径见方案 §5.7，后续可迁移到共享存储）。
 */

const PLATFORM_KEY = 'ai.master.enabled';
const ORG_PREFIX = 'ai.master.org.';
const USER_RATE_KEY = 'ai.rate.user.perMinute';
const ORG_RATE_KEY = 'ai.rate.org.perMinute';

const CACHE_TTL_MS = 15_000;
const WINDOW_MS = 60_000;

const DEFAULT_SETTINGS: AiGuardSettings = {
  enabled: true,
  userPerMinute: 30,
  orgPerMinute: 300,
  orgOverrides: [],
};

function clampInt(value: string | undefined, fallback: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.min(Math.trunc(num), max);
}

/** SystemSetting 行 → 闸门设置（纯函数，便于单测）。 */
export function parseGuardSettings(
  rows: Array<{ key: string; value: string }>,
): AiGuardSettings {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    enabled: map.get(PLATFORM_KEY) !== '0',
    userPerMinute: clampInt(
      map.get(USER_RATE_KEY),
      DEFAULT_SETTINGS.userPerMinute,
      600,
    ),
    orgPerMinute: clampInt(
      map.get(ORG_RATE_KEY),
      DEFAULT_SETTINGS.orgPerMinute,
      20_000,
    ),
    orgOverrides: rows
      .filter((row) => row.key.startsWith(ORG_PREFIX))
      .map((row) => ({
        orgUserId: row.key.slice(ORG_PREFIX.length),
        enabled: row.value !== '0',
      }))
      .filter((row) => Boolean(row.orgUserId)),
  };
}

/** 滑动窗口取一个名额（纯函数）：未超限才写入，超限原样保留旧窗口。 */
export function takeRateSlot(
  windows: Map<string, number[]>,
  key: string,
  limit: number,
  now: number,
): boolean {
  if (limit <= 0) return true;
  const cutoff = now - WINDOW_MS;
  const hits = (windows.get(key) || []).filter((at) => at > cutoff);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 5000) {
    for (const [k, list] of windows) {
      if (!list.length || list[list.length - 1] <= cutoff) windows.delete(k);
    }
  }
  return true;
}

type GuardFn = (userId: string) => Promise<void>;
let guardFn: GuardFn | null = null;

/** 应用装配时注册（http/services.ts）；未注册时视为不拦（GEO worker 等无账号上下文）。 */
export function registerAiGuard(fn: GuardFn) {
  guardFn = fn;
}

/** 静默链路（tryChat / 取模型）用：拒绝时返回原因，允许时返回空串，绝不抛穿业务。 */
export async function aiGuardDeny(userId: string): Promise<string> {
  if (!guardFn || !userId) return '';
  try {
    await guardFn(userId);
    return '';
  } catch (error) {
    return error instanceof Error && error.message
      ? error.message
      : 'AI 调用已被拒绝';
  }
}

/** 用户主动动作（requireModel / 内容模型设置）用：拒绝时抛出可读错误。 */
export async function assertAiAllowed(userId: string): Promise<void> {
  if (!guardFn || !userId) return;
  await guardFn(userId);
}

/** 区分「闸门拒绝」与「通道没配好」：前者必须显式暴露，后者才允许回落。 */
export function isAiGateError(error: unknown): boolean {
  return (
    error instanceof BusinessException &&
    (error.errorCode === ErrorCode.FEATURE_CLOSED ||
      error.errorCode === ErrorCode.RATE_LIMITED)
  );
}

export class AiGuardService {
  private cache: { at: number; settings: AiGuardSettings } | null = null;
  private readonly userHits = new Map<string, number[]>();
  private readonly orgHits = new Map<string, number[]>();
  private readonly orgCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<AiGuardSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
      return this.cache.settings;
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        OR: [
          { key: PLATFORM_KEY },
          { key: USER_RATE_KEY },
          { key: ORG_RATE_KEY },
          { key: { startsWith: ORG_PREFIX } },
        ],
      },
      select: { key: true, value: true },
    });
    const settings = parseGuardSettings(rows);
    this.cache = { at: Date.now(), settings };
    return settings;
  }

  /** 管理端保存：平台总闸/限流写固定 key，组织覆盖行整组重建，保存后即时生效。 */
  async save(input: AiGuardSettings): Promise<AiGuardSettings> {
    const settings = parseGuardSettings([
      { key: PLATFORM_KEY, value: input.enabled ? '1' : '0' },
      { key: USER_RATE_KEY, value: String(input.userPerMinute) },
      { key: ORG_RATE_KEY, value: String(input.orgPerMinute) },
      ...input.orgOverrides
        .filter((row) => row.orgUserId)
        .map((row) => ({
          key: `${ORG_PREFIX}${row.orgUserId.slice(0, 64)}`,
          value: row.enabled ? '1' : '0',
        })),
    ]);
    await this.prisma.$transaction([
      this.prisma.systemSetting.upsert({
        where: { key: PLATFORM_KEY },
        create: { key: PLATFORM_KEY, value: settings.enabled ? '1' : '0' },
        update: { value: settings.enabled ? '1' : '0' },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: USER_RATE_KEY },
        create: { key: USER_RATE_KEY, value: String(settings.userPerMinute) },
        update: { value: String(settings.userPerMinute) },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: ORG_RATE_KEY },
        create: { key: ORG_RATE_KEY, value: String(settings.orgPerMinute) },
        update: { value: String(settings.orgPerMinute) },
      }),
      this.prisma.systemSetting.deleteMany({
        where: { key: { startsWith: ORG_PREFIX } },
      }),
      this.prisma.systemSetting.createMany({
        data: settings.orgOverrides.map((row) => ({
          key: `${ORG_PREFIX}${row.orgUserId}`,
          value: row.enabled ? '1' : '0',
        })),
        skipDuplicates: true,
      }),
    ]);
    this.cache = null;
    return settings;
  }

  /** 校验并占用一次调用名额；任一闸门拒绝即抛业务异常。 */
  async assertAllowed(userId: string): Promise<void> {
    if (!userId) return;
    const settings = await this.current();
    if (!settings.enabled) {
      throw new BusinessException(
        ErrorCode.FEATURE_CLOSED,
        'AI 能力已被平台管理员关闭，暂不可用',
      );
    }
    const orgUserId = await this.orgUserIdOf(userId);
    const override = settings.orgOverrides.find(
      (row) => row.orgUserId === orgUserId,
    );
    if (override && !override.enabled) {
      throw new BusinessException(
        ErrorCode.FEATURE_CLOSED,
        'AI 能力已被所属组织关闭，暂不可用',
      );
    }
    const now = Date.now();
    if (!takeRateSlot(this.userHits, userId, settings.userPerMinute, now)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        `AI 调用过于频繁：每个账号每分钟最多 ${settings.userPerMinute} 次，请稍后再试`,
      );
    }
    if (!takeRateSlot(this.orgHits, orgUserId, settings.orgPerMinute, now)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        `AI 调用过于频繁：组织每分钟最多 ${settings.orgPerMinute} 次，请稍后再试`,
      );
    }
  }

  /** 账号的归属组织：本人企业 → 首个 ACTIVE 成员组织 → 个人自组织。 */
  private async orgUserIdOf(userId: string): Promise<string> {
    const cached = this.orgCache.get(userId);
    if (cached) return cached;
    const select = { orgType: true, orgUserId: true } as const;
    const [owned, joined] = await Promise.all([
      this.prisma.orgStaff.findFirst({
        where: { orgUserId: userId, orgType: 'ENTERPRISE' },
        orderBy: { id: 'asc' },
        select,
      }),
      this.prisma.orgStaff.findFirst({
        where: { memberUserId: userId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select,
      }),
    ]);
    const row = owned || joined;
    const orgUserId = row?.orgUserId || userId;
    this.orgCache.set(userId, orgUserId);
    if (this.orgCache.size > 5000) this.orgCache.clear();
    return orgUserId;
  }
}
