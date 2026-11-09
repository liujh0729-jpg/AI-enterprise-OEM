import type { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { IdentityService } from '../identity/identity.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import { KbPageService } from './kb-page.service';
import { KbSearchService } from './kb-search.service';
import { KbSpaceService, putLog } from './kb-space.service';
import { clip, iso, normalizeSlug } from './kb-util';

/**
 * 记忆提炼（§10.4 consolidation）：把 L0 意图事件流（AgentMemoryEvent）按业务域
 * 聚合进用户的 AGENT 默认空间——每个域一张 ENTITY 页（时间线 + 高频对象 wikilink），
 * 随图长节点和边；同一对象既被创建又被删除视为潜在矛盾，页进 PENDING_REVIEW 交人裁决。
 * L1 为确定性规则式聚合（零模型依赖、验收可复现）；LLM 归纳版留表演化升级位。
 */

export interface ConsolidateInput {
  spaceId?: number;
  userId?: string;
  limit: number;
}

export class KbMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
    private readonly pages: KbPageService,
    private readonly aiEval: AiEvalService,
    private readonly identity: IdentityService,
  ) {}

  async consolidate(body: ConsolidateInput, user: CurrentUser) {
    const targetUserId = (body.userId || user.userId).trim();
    if (targetUserId !== user.userId && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只能提炼本人的操作记忆',
      );
    }
    const target = {
      userId: targetUserId,
      isAdmin: this.identity.isPlatformAdmin(user),
    };
    const space = body.spaceId
      ? await this.spaces.loadWritable(body.spaceId, user)
      : await this.ensureAgentSpaceWritable(target, user);
    const events = await this.prisma.agentMemoryEvent.findMany({
      where: { userId: targetUserId },
      orderBy: { id: 'desc' },
      take: Math.min(500, Math.max(1, body.limit)),
    });
    const byDomain = new Map<string, typeof events>();
    for (const event of events) {
      const list = byDomain.get(event.domain) || [];
      list.push(event);
      byDomain.set(event.domain, list);
    }
    const pagesWritten: number[] = [];
    let entitiesUpdated = 0;
    for (const [domain, list] of [...byDomain.entries()].sort()) {
      const recent = list.slice(0, 50);
      const targets = KbSearchService.topTargets(
        recent.map((event) => ({
          target_label: event.targetLabel,
          action: event.action,
        })),
      );
      entitiesUpdated += targets.length;
      // 矛盾口径：同一 (targetType,targetId) 既有 create 类动作又有 delete 类动作
      const pairs = new Map<string, { created: boolean; deleted: boolean }>();
      for (const event of recent) {
        if (!event.targetType || !event.targetId) continue;
        const key = `${event.targetType}:${event.targetId}`;
        const cur = pairs.get(key) || { created: false, deleted: false };
        if (/create|add|submit/i.test(event.action)) cur.created = true;
        if (/delete|remove|cancel/i.test(event.action)) cur.deleted = true;
        pairs.set(key, cur);
      }
      const conflicts = [...pairs.values()].filter(
        (p) => p.created && p.deleted,
      );
      const bodyLines = [
        `> 自动提炼：最近 ${recent.length} 条「${domain}」域操作事件（截至 ${iso(
          recent[0]?.createdAt,
        )}）`,
        '',
        '## 操作时间线',
        ...recent
          .slice(0, 20)
          .map(
            (event) =>
              `- ${iso(event.createdAt).slice(0, 10)} \`${event.action}\`${
                event.targetLabel ? ` → ${clip(event.targetLabel, 60)}` : ''
              }`,
          ),
      ];
      if (targets.length) {
        bodyLines.push('', '## 高频对象', ...targets.map((t) => `- [[${t}]]`));
      }
      if (conflicts.length) {
        bodyLines.push(
          '',
          `> ⚠️ 检测到 ${conflicts.length} 个对象同时存在创建与删除记录，待人工确认口径`,
        );
      }
      const page = await this.pages.writePage(
        {
          spaceId: space.id,
          slug: normalizeSlug(`memory-${domain}`),
          type: 'ENTITY',
          title: `${domain} · 操作记忆`,
          body: bodyLines.join('\n'),
          frontmatter: {
            tags: ['memory', domain],
            entityType: 'CONCEPT',
            events: recent.length,
          },
          status: conflicts.length ? 'PENDING_REVIEW' : 'PUBLISHED',
          sourceIds: [],
        },
        user,
      );
      pagesWritten.push(page.id);
    }
    try {
      await this.aiEval.chargeByUsage(
        user.userId,
        'kb_consolidate',
        { call: 1 },
        `kb-consolidate:${targetUserId}`,
      );
    } catch {
      /* 计费失败不阻断提炼 */
    }
    await putLog(
      this.prisma,
      space.id,
      'CONSOLIDATE',
      `提炼 ${targetUserId} 的 ${events.length} 条事件 → ${pagesWritten.length} 个域页`,
      { events: events.length, pagesWritten },
      user.userId,
    );
    return {
      spaceId: space.id,
      eventsScanned: events.length,
      entitiesUpdated,
      pagesWritten,
    };
  }

  /** 目标用户的 AGENT 默认空间；非本人且非管理员不可入（防写别人记忆库）。 */
  private async ensureAgentSpaceWritable(
    target: { userId: string; isAdmin: boolean },
    user: CurrentUser,
  ) {
    const space = await this.spaces.ensureAgentSpace(target.userId);
    if (target.userId !== user.userId && !target.isAdmin) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '无权写入该记忆空间',
      );
    }
    return space;
  }
}
