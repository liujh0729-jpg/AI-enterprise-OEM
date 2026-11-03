import {
  agentActionLabel,
  agentChannelLabel,
  agentDomainLabel,
  agentOutcomeLabel,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf, pageParam, text } from '../common/api';
import { truncate } from './agent-intent';
import {
  MCP_WRITE_OPERATIONS,
  findOperation,
  forbiddenReasonOf,
} from '../mcp/mcp-catalog';

/** 一条意图事件的最小输入：全部字段由 HTTP 层的意图中间件给出，业务服务不再各自埋点。 */
export type AgentIntentDraft = {
  userId: string;
  domain: string;
  action: string;
  method: string;
  path: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  params: Record<string, unknown>;
  outcome: 'ok' | 'failed' | 'blocked';
  errorCode: string;
  errorMessage: string;
  channel: 'web' | 'machine' | 'mcp' | 'scheduler';
};

const READ_LIMIT = 5000;

/**
 * 智能体记忆的地基：写入只有 `record()` 一个入口，读接口和提炼（含 MCP 收到指令时的分析）都走这里。
 * 每条意图事件同时补一条 audit_logs 留痕，两套记录用 auditLogId 互为锚点。
 */
export class AgentMemoryService {
  private warnReported = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 唯一写入点：await 落库但绝不抛错——记忆是旁路，不能把业务请求带下水。
   * 失败只在进程里告警一次，避免写库故障时把日志刷满。
   */
  async record(draft: AgentIntentDraft): Promise<void> {
    try {
      const detail = truncate(
        `${draft.method} ${draft.path}${
          draft.targetId ? ` #${draft.targetId}` : ''
        }${draft.outcome === 'ok' ? '' : ` 失败 ${draft.errorCode}`}`,
        500,
      );
      await this.prisma.$transaction(async (tx) => {
        const audit = await tx.auditLog.create({
          data: { userId: draft.userId, action: draft.action, detail },
        });
        return tx.agentMemoryEvent.create({
          data: {
            userId: draft.userId,
            domain: truncate(draft.domain, 32),
            action: truncate(draft.action, 64),
            targetType: truncate(draft.targetType, 32),
            targetId: truncate(draft.targetId, 64),
            targetLabel: truncate(draft.targetLabel, 200),
            params: draft.params as Prisma.InputJsonValue,
            outcome: draft.outcome,
            errorCode: truncate(draft.errorCode, 64),
            errorMessage: truncate(draft.errorMessage, 500),
            channel: draft.channel,
            auditLogId: audit.id,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      if (!this.warnReported) {
        this.warnReported = true;
        console.warn(
          JSON.stringify({
            event: 'agent_memory_record_failed',
            type: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }
  }

  /** 记忆概览：总量、近 7/30 天、活跃天数、失败数、按域/通道分布、高频动作。 */
  async overview(userId: string) {
    const now = Date.now();
    const since7 = new Date(now - 7 * 86_400_000);
    const since30 = new Date(now - 30 * 86_400_000);
    // 计数用 count 取准确值；分布与高频动作只扫最近 READ_LIMIT 条，避免长账号全表搬运。
    const [total, last7Days, last30Days, failed, first, last, rows] =
      await Promise.all([
        this.prisma.agentMemoryEvent.count({ where: { userId } }),
        this.prisma.agentMemoryEvent.count({
          where: { userId, occurredAt: { gte: since7 } },
        }),
        this.prisma.agentMemoryEvent.count({
          where: { userId, occurredAt: { gte: since30 } },
        }),
        this.prisma.agentMemoryEvent.count({
          where: { userId, outcome: { not: 'ok' } },
        }),
        this.prisma.agentMemoryEvent.findFirst({
          where: { userId },
          orderBy: { occurredAt: 'asc' },
          select: { occurredAt: true },
        }),
        this.prisma.agentMemoryEvent.findFirst({
          where: { userId },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        }),
        this.prisma.agentMemoryEvent.findMany({
          where: { userId },
          orderBy: { occurredAt: 'desc' },
          take: READ_LIMIT,
          select: {
            domain: true,
            action: true,
            channel: true,
            outcome: true,
            occurredAt: true,
          },
        }),
      ]);
    const byDomain = new Map<string, number>();
    const byChannel = new Map<string, number>();
    const byAction = new Map<string, { domain: string; count: number }>();
    const activeDays = new Set<string>();
    for (const row of rows) {
      activeDays.add(row.occurredAt.toISOString().slice(0, 10));
      byDomain.set(row.domain, (byDomain.get(row.domain) ?? 0) + 1);
      byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + 1);
      const action = byAction.get(row.action) ?? {
        domain: row.domain,
        count: 0,
      };
      action.count += 1;
      byAction.set(row.action, action);
    }
    return {
      total,
      last7Days,
      last30Days,
      activeDays: activeDays.size,
      failed,
      firstAt: first ? first.occurredAt.toISOString() : null,
      lastAt: last ? last.occurredAt.toISOString() : null,
      byDomain: [...byDomain.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => ({
          domain,
          label: agentDomainLabel(domain),
          count,
        })),
      byChannel: [...byChannel.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([channel, count]) => ({
          channel,
          label: agentChannelLabel(channel),
          count,
        })),
      topActions: [...byAction.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([action, row]) => ({
          action,
          label: agentActionLabel(action),
          domain: row.domain,
          domainLabel: agentDomainLabel(row.domain),
          count: row.count,
        })),
    };
  }

  /** 操作流分页：只看本人账号的意图事件，可按业务域、结果、通道筛。 */
  async events(userId: string, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      text(query.page),
      text(query.pageSize),
    );
    const where = {
      userId,
      ...(text(query.domain) ? { domain: text(query.domain) } : {}),
      ...(text(query.outcome) ? { outcome: text(query.outcome) } : {}),
      ...(text(query.channel) ? { channel: text(query.channel) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.agentMemoryEvent.count({ where }),
      this.prisma.agentMemoryEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        domain: row.domain,
        domainLabel: agentDomainLabel(row.domain),
        action: row.action,
        actionLabel: agentActionLabel(row.action),
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: row.targetLabel,
        outcome: row.outcome,
        outcomeLabel: agentOutcomeLabel(row.outcome),
        channel: row.channel,
        channelLabel: agentChannelLabel(row.channel),
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        params: (row.params ?? {}) as Record<string, unknown>,
        occurredAt: row.occurredAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  /** 本账号已勾选「可自动执行」的动作集合；授权闸与 MCP 清单都用它，判定只有一处。 */
  async grantedActions(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.agentActionGrant.findMany({
      where: { userId },
      select: { action: true },
    });
    return new Set(rows.map((row) => row.action));
  }

  /** 授权闸清单：契约派生的全部写动作 + 本人勾选状态 + 永久排除理由。 */
  async grants(userId: string) {
    const granted = await this.grantedActions(userId);
    const items = MCP_WRITE_OPERATIONS.map((row) => {
      const forbidden = forbiddenReasonOf(row.operationId);
      return {
        domain: row.domain,
        domainLabel: row.domainLabel,
        action: row.operationId,
        actionLabel: row.label,
        method: row.method.toUpperCase(),
        path: row.path,
        allowed: granted.has(row.operationId),
        forbidden: Boolean(forbidden),
        forbiddenReason: forbidden,
      };
    });
    const byDomain = new Map<string, { total: number; granted: number }>();
    for (const item of items) {
      const bucket = byDomain.get(item.domain) ?? { total: 0, granted: 0 };
      bucket.total += 1;
      if (item.allowed) bucket.granted += 1;
      byDomain.set(item.domain, bucket);
    }
    return {
      total: items.length,
      grantedCount: items.filter((item) => item.allowed).length,
      forbiddenCount: items.filter((item) => item.forbidden).length,
      domains: [...byDomain.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([domain, bucket]) => ({
          domain,
          label: agentDomainLabel(domain),
          total: bucket.total,
          granted: bucket.granted,
        })),
      items,
    };
  }

  /**
   * 保存勾选：整份覆盖（取消勾选＝删行），未知动作、读接口、永久排除一律拒收。
   * 授权只由人在界面上改，MCP 自己看不到这一组接口（见 mcp-catalog 的排除域），所以无法自我提权。
   */
  async saveGrants(userId: string, actions: string[]) {
    const requested = new Set<string>();
    for (const raw of actions) {
      const action = raw.trim();
      if (!action) continue;
      const operation = findOperation(action);
      if (!operation)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `没有名为 ${truncate(action, 64)} 的接口动作`,
        );
      if (!operation.write)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${agentActionLabel(action)}」是读取接口，不需要授权`,
        );
      const forbidden = forbiddenReasonOf(action);
      if (forbidden)
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `「${agentActionLabel(action)}」永久不允许自动执行：${forbidden}`,
        );
      requested.add(action);
    }
    const existing = await this.grantedActions(userId);
    const toAdd = [...requested].filter((action) => !existing.has(action));
    const toRemove = [...existing].filter((action) => !requested.has(action));
    if (toAdd.length)
      await this.prisma.agentActionGrant.createMany({
        data: toAdd.map((action) => {
          const operation = findOperation(action);
          return {
            userId,
            domain: truncate(operation?.domain ?? '', 32),
            action,
          };
        }),
        skipDuplicates: true,
      });
    if (toRemove.length)
      await this.prisma.agentActionGrant.deleteMany({
        where: { userId, action: { in: toRemove } },
      });
    if (toAdd.length || toRemove.length)
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'AGENT_GRANTS_SAVE',
          detail: truncate(
            `自动执行授权：新增 ${toAdd.join(',') || '无'}；取消 ${
              toRemove.join(',') || '无'
            }；共 ${requested.size} 项`,
            500,
          ),
        },
      });
    return {
      granted: toAdd.length,
      revoked: toRemove.length,
      actions: [...requested].sort(),
    };
  }

  /** 已采纳的表单偏好，按命中次数排序；MCP 的 `analyze_memory` 用它解释「这个账号习惯怎么填」。 */
  async preferences(userId: string, limit = 20) {
    const rows = await this.prisma.agentPreference.findMany({
      where: { userId },
      orderBy: [{ hits: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      key: row.key,
      value: (row.value ?? {}) as Record<string, unknown>,
      hits: row.hits,
      adoptedAt: row.adoptedAt.toISOString(),
    }));
  }

  /** 某个动作最近一次成功执行时的参数摘要，供外部客户端按用户已有习惯预填。 */
  async lastEventParams(
    userId: string,
    action: string,
  ): Promise<{ params: Record<string, unknown>; occurredAt: string } | null> {
    const row = await this.prisma.agentMemoryEvent.findFirst({
      where: { userId, action, outcome: 'ok' },
      orderBy: { occurredAt: 'desc' },
      select: { params: true, occurredAt: true },
    });
    if (!row) return null;
    return {
      params: (row.params ?? {}) as Record<string, unknown>,
      occurredAt: row.occurredAt.toISOString(),
    };
  }

  /**
   * 清空我的记忆：六张记忆表按本人账号一次删净，返回各表删除条数供界面回执。
   * `agent_action_grants`（可自动执行的动作）不在清理范围内——那是账号的授权决定，不是记忆内容。
   */
  async clear(userId: string) {
    const [events, candidates, preferences, playbooks, grants, runs] =
      await Promise.all([
        this.prisma.agentMemoryEvent.deleteMany({ where: { userId } }),
        this.prisma.agentMemoryCandidate.deleteMany({ where: { userId } }),
        this.prisma.agentPreference.deleteMany({ where: { userId } }),
        this.prisma.agentPlaybook.deleteMany({ where: { userId } }),
        this.prisma.agentGrant.deleteMany({ where: { userId } }),
        this.prisma.agentPlaybookRun.deleteMany({ where: { userId } }),
      ]);
    return {
      events: events.count,
      candidates: candidates.count,
      preferences: preferences.count,
      playbooks: playbooks.count,
      grants: grants.count,
      runs: runs.count,
    };
  }
}
