import type { Prisma } from '../../generated/prisma';
import { toJsonInput, fromJson } from '../common/json-input';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 台账视图（契约 skillReviewRunSchema 同形：cost 字符串、时间 ISO）。 */
export interface SkillReviewRunView {
  id: number;
  kind: string;
  itemId: number;
  userId: string;
  inputDigest: string;
  staticHits: { rule: string; file: string; excerpt: string }[];
  llmVerdict: Record<string, unknown>;
  decision: string;
  riskLevel: string;
  model: string;
  tokens: number;
  cost: string;
  createdAt: string;
}

function toView(row: {
  id: number;
  kind: string;
  itemId: number;
  userId: string;
  inputDigest: string;
  staticHits: Prisma.JsonValue;
  llmVerdict: Prisma.JsonValue;
  decision: string;
  riskLevel: string;
  model: string;
  tokens: number;
  costAmount: Prisma.Decimal;
  createdAt: Date;
}): SkillReviewRunView {
  return {
    id: row.id,
    kind: row.kind,
    itemId: row.itemId,
    userId: row.userId,
    inputDigest: row.inputDigest,
    staticHits: Array.isArray(row.staticHits)
      ? fromJson<SkillReviewRunView['staticHits']>(row.staticHits)
      : [],
    llmVerdict:
      row.llmVerdict &&
      typeof row.llmVerdict === 'object' &&
      !Array.isArray(row.llmVerdict)
        ? row.llmVerdict
        : {},
    decision: row.decision,
    riskLevel: row.riskLevel,
    model: row.model,
    tokens: row.tokens,
    cost: row.costAmount.toString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 技能审查台账服务（§5.9 的管理侧读写）：
 * - list：Platform_skillReviews 分页台账（静态命中 + LLM 判定全程留痕）；
 * - applyDecision：Platform_reviewSkillDecision 人工放行/终裁，直接改写 Skill/Plugin 的 reviewStatus；
 * - recordRun：审查执行（静态扫描 + LLM）落台账的统一入口，供 importZip / 存量首扫调用（l0-review 接入）。
 * 审查执行引擎本体在 skill-review.rules / skill-review.runner，本服务只管台账与放行状态。
 */
export class SkillReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    page: number;
    size: number;
    kind?: string;
    decision?: string;
  }): Promise<{
    list: SkillReviewRunView[];
    total: number;
    page: number;
    size: number;
  }> {
    const where: Prisma.SkillReviewRunWhereInput = {};
    if (input.kind === 'skill' || input.kind === 'plugin')
      where.kind = input.kind;
    if (
      ['pass', 'reject', 'needsAdmin', 'unreviewed'].includes(
        input.decision || '',
      )
    )
      where.decision = input.decision;
    const [rows, total] = await Promise.all([
      this.prisma.skillReviewRun.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (input.page - 1) * input.size,
        take: input.size,
      }),
      this.prisma.skillReviewRun.count({ where }),
    ]);
    return {
      list: rows.map(toView),
      total,
      page: input.page,
      size: input.size,
    };
  }

  /** 人工终裁（passed/rejected）：放行即进可用集（gating 查询只认 reviewStatus=passed）。 */
  async applyDecision(
    input: {
      kind: 'skill' | 'plugin';
      itemId: number;
      decision: 'passed' | 'rejected';
      note: string;
    },
    adminUserId: string,
  ) {
    const reviewedBy = `admin:${adminUserId}`.slice(0, 32);
    const verdict = toJsonInput({
      decision: input.decision,
      summary: input.note,
      source: reviewedBy,
    });
    const data = {
      reviewStatus: input.decision,
      reviewVerdict: verdict,
      reviewedAt: new Date(),
      reviewedBy,
    };
    if (input.kind === 'skill') {
      const row = await this.prisma.contentAgentSkill.findUnique({
        where: { id: input.itemId },
      });
      if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
      await this.prisma.contentAgentSkill.update({
        where: { id: input.itemId },
        data,
      });
    } else {
      const row = await this.prisma.contentAgentPlugin.findUnique({
        where: { id: input.itemId },
      });
      if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '插件不存在');
      await this.prisma.contentAgentPlugin.update({
        where: { id: input.itemId },
        data,
      });
    }
    return {
      kind: input.kind,
      itemId: input.itemId,
      reviewStatus: input.decision,
    };
  }

  /** 台账写入统一入口（审查执行引擎调用）：返回行 id 便于回链。 */
  async recordRun(input: {
    kind: 'skill' | 'plugin';
    itemId: number;
    userId: string;
    inputDigest: string;
    staticHits: unknown;
    llmVerdict: unknown;
    decision: 'pass' | 'reject' | 'needsAdmin' | 'unreviewed';
    riskLevel: string;
    model: string;
    tokens: number;
    costAmount: number;
  }) {
    const row = await this.prisma.skillReviewRun.create({
      data: {
        kind: input.kind,
        itemId: input.itemId,
        userId: input.userId,
        inputDigest: input.inputDigest.slice(0, 64),
        staticHits: input.staticHits ?? [],
        llmVerdict: input.llmVerdict ?? {},
        decision: input.decision,
        riskLevel: input.riskLevel.slice(0, 8),
        model: input.model.slice(0, 64),
        tokens: input.tokens,
        costAmount: input.costAmount,
      },
    });
    return toView(row);
  }
}
