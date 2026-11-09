import { sandboxLimitsSchema } from '@enterprise/contracts';
import type { Prisma } from '../../generated/prisma';
import { toJsonInput, fromJson } from '../common/json-input';
import { PrismaService } from '../prisma/prisma.service';
import { setOutboundBlacklist } from '../http/outbound-guard';
import { matchBlacklistHost } from './skill-review.rules';

/** 黑名单条目（§5.9 出口网关）：domain 匹配主机名本身与子域；ip 精确；cidr 前段匹配（v4 按网段字符串）。 */
export interface AccessBlacklistEntry {
  type: 'domain' | 'ip' | 'cidr';
  value: string;
  reason: string;
  addedBy: string;
}

export interface SandboxLimits {
  minIntervalMs: number;
  maxConcurrency: number;
  timeoutMs: number;
  maxRequestsPerRun: number;
  perDomainQps: number;
  allowMethods: ('GET' | 'HEAD')[];
  enforceRobots: boolean;
  botUa: string;
}

const DEFAULT_LIMITS = sandboxLimitsSchema.parse({});

export interface AccessPolicyView {
  blacklist: AccessBlacklistEntry[];
  limits: SandboxLimits;
  updatedBy: string;
  updatedAt: string;
}

function normalizeEntries(
  input: unknown,
  adminUserId: string,
): AccessBlacklistEntry[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const entries: AccessBlacklistEntry[] = [];
  for (const raw of input.slice(0, 500)) {
    const item = raw as Partial<AccessBlacklistEntry>;
    const type = item?.type;
    const value = String(item?.value || '')
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!value || (type !== 'domain' && type !== 'ip' && type !== 'cidr'))
      continue;
    const key = `${type}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      type,
      value: value.slice(0, 120),
      reason: String(item?.reason || '').slice(0, 200),
      addedBy: String(item?.addedBy || '') || adminUserId,
    });
  }
  return entries;
}

/**
 * Agent 访问策略服务（§5.9）：平台级单行——出口黑名单 + 沙箱硬上限。
 * 运行期（技能/连接器外呼）实时读取本策略，技能自带参数只能收紧、不能突破；
 * get() 带 TTL 缓存，save() 立即失效，保证「收紧即时生效、无需重启」。
 */
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private cached: { at: number; policy: AccessPolicyView } | null = null;

  async current(): Promise<AccessPolicyView> {
    if (this.cached && Date.now() - this.cached.at < 15_000)
      return this.cached.policy;
    const row = await this.prisma.agentAccessPolicy.findFirst({
      orderBy: { id: 'desc' },
    });
    const policy: AccessPolicyView = row
      ? {
          blacklist: normalizeEntries(row.blacklist, row.updatedBy),
          limits: {
            ...DEFAULT_LIMITS,
            ...fromJson<Partial<SandboxLimits>>(row.limits),
          },
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { blacklist: [], limits: DEFAULT_LIMITS, updatedBy: '', updatedAt: '' };
    // 同步推送到出站守卫（§5.9 红线 4 运行期）：刷新即生效，守卫侧保持同步判定
    setOutboundBlacklist(policy.blacklist);
    this.cached = { at: Date.now(), policy };
    return policy;
  }

  /** 保存（Platform_saveAccessPolicy）：黑名单整表替换（去重夹 500 条），limits 增量合并并夹到契约边界。 */
  async save(
    input: { blacklist?: unknown; limits?: Record<string, unknown> },
    adminUserId: string,
  ): Promise<AccessPolicyView> {
    const current = await this.current();
    const blacklist =
      input.blacklist === undefined
        ? current.blacklist
        : normalizeEntries(input.blacklist, adminUserId);
    let limits = current.limits;
    if (input.limits !== undefined) {
      // partial().parse 负责逐字段校验夹边界；只回写调用方实际提交的键，未提交字段保留现值
      const parsed = sandboxLimitsSchema
        .partial()
        .parse(input.limits) as Record<string, unknown>;
      const provided = Object.fromEntries(
        Object.keys(input.limits)
          .filter((key) => key in parsed)
          .map((key) => [key, parsed[key]]),
      );
      limits = { ...current.limits, ...provided };
    }
    const data: Prisma.AgentAccessPolicyUpdateInput &
      Prisma.AgentAccessPolicyCreateInput = {
      blacklist: toJsonInput(blacklist),
      limits: toJsonInput(limits),
      updatedBy: adminUserId,
    };
    const existing = await this.prisma.agentAccessPolicy.findFirst({
      orderBy: { id: 'desc' },
    });
    if (existing)
      await this.prisma.agentAccessPolicy.update({
        where: { id: existing.id },
        data,
      });
    else await this.prisma.agentAccessPolicy.create({ data });
    this.cached = null;
    return this.current();
  }

  /** 出口黑名单判定（静态审查/运行期共用入口）：委托 matchBlacklistHost 统一口径。 */
  async isBlacklistedHost(host: string): Promise<boolean> {
    const { blacklist } = await this.current();
    return matchBlacklistHost(blacklist, host);
  }
}
