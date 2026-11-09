import type { PrismaService } from '../prisma/prisma.service';

/**
 * 人岗匹配 rubric 模板库与词表（§12.9.1 单一实现点）：
 * 模板存 DB（hrm_rubric_templates，版本化可回滚），prompt 文案入库不入代码；
 * 雇主侧（hrm.ai）与候选人侧（L3 代投）共读本表——两侧不得各自维护口径。
 */

export const DEFAULT_RUBRIC_CODE = 'general';

/** 内置默认模板（首次读取懒播种 v1；四维与 §5.1 人岗匹配维度雷达同源）。 */
export const DEFAULT_RUBRIC_SEED = {
  code: DEFAULT_RUBRIC_CODE,
  dimensions: [
    {
      key: 'HARD_SKILL',
      label: '硬技能',
      description: 'JD 要求的技术/工具/专业能力的直接证据',
    },
    {
      key: 'SOFT',
      label: '软素质',
      description: '沟通、协作、责任、学习等通用素质证据',
    },
    {
      key: 'EXPERIENCE',
      label: '经验层级',
      description: '年限、职级、项目规模与 JD 职级带的匹配',
    },
    { key: 'STABILITY', label: '稳定性', description: '经历连贯度与跳槽频度' },
  ],
  weights: { HARD_SKILL: 0.4, SOFT: 0.15, EXPERIENCE: 0.3, STABILITY: 0.15 },
  thresholds: { excellent: 4.5, strong: 4.0, medium: 3.0 },
  tierLexicon: ['实习', '应届', '初级', '中级', '高级', '专家', '总监'],
  promptDigest: [
    '你是人岗匹配评估器。只依据给定结构化事实（简历条目）评估职位要求，不得编造未提供的经历。',
    '对每条要求给出 importance(HIGH|MEDIUM|NICE) 与 match(STRONG|PARTIAL|MISSING)：',
    'STRONG 必须有原文级证据（sourceRef 指向给定条目 id）；间接旁证为 PARTIAL；无证据一律 MISSING。',
    '输出 JSON：{"score":1-5 一位小数,"dimensions":[{"key","score"}],"requirementsMatrix":[...],"knockouts":[],"recommendation"}',
  ].join('\n'),
};

/** 职级错位判定用词表（§12.9.4：classifyTier 单一函数，两侧同调用）。 */
const TIER_PATTERNS: Record<string, string[]> = {
  实习: ['实习', 'intern'],
  应届: ['应届', 'graduate', '在校'],
  初级: ['初级', 'junior', '助理', '应届'],
  中级: ['中级', 'intermediate', '工程师', '主管', '3年', '5年'],
  高级: ['高级', 'senior', '资深', 'expert', '8年', '10年'],
  专家: ['专家', 'specialist', '架构师', '科学家'],
  总监: ['总监', 'director', 'vp', '负责人', '合伙人'],
};

export type RubricView = {
  id: number;
  code: string;
  version: number;
  dimensions: { key: string; label: string; description: string }[];
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  tierLexicon: string[];
  promptDigest: string;
  active: boolean;
  updatedBy: string;
  updatedAt: string;
};

/** 取当前生效模板；库内无 active 时懒播种内置默认 v1（确定性可验收）。 */
export async function ensureActiveRubric(
  prisma: PrismaService,
  code = DEFAULT_RUBRIC_CODE,
): Promise<RubricView> {
  const row = await prisma.hrmRubricTemplate.findFirst({
    where: { code, active: true },
    orderBy: { version: 'desc' },
  });
  if (row) return rubricView(row);
  const seeded = await prisma.hrmRubricTemplate.create({
    data: {
      code: DEFAULT_RUBRIC_SEED.code,
      version: 1,
      dimensions: DEFAULT_RUBRIC_SEED.dimensions,
      weights: DEFAULT_RUBRIC_SEED.weights,
      thresholds: DEFAULT_RUBRIC_SEED.thresholds,
      tierLexicon: DEFAULT_RUBRIC_SEED.tierLexicon,
      promptDigest: DEFAULT_RUBRIC_SEED.promptDigest,
      active: true,
      updatedBy: 'system',
    },
  });
  return rubricView(seeded);
}

export function rubricView(row: {
  id: number;
  code: string;
  version: number;
  dimensions: unknown;
  weights: unknown;
  thresholds: unknown;
  tierLexicon: unknown;
  promptDigest: string;
  active: boolean;
  updatedBy: string;
  updatedAt: Date;
}): RubricView {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    dimensions: Array.isArray(row.dimensions)
      ? (row.dimensions as RubricView['dimensions']).map((d) => ({
          key: String(d?.key ?? ''),
          label: String(d?.label ?? ''),
          description: String(d?.description ?? ''),
        }))
      : [],
    weights: asNumRecord(row.weights),
    thresholds: asNumRecord(row.thresholds),
    tierLexicon: Array.isArray(row.tierLexicon)
      ? (row.tierLexicon as unknown[]).map(String)
      : [],
    promptDigest: String(row.promptDigest ?? ''),
    active: row.active,
    updatedBy: String(row.updatedBy ?? ''),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : '',
  };
}

function asNumRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(val);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

/**
 * 职级归类（单一函数）：文本命中词表取「最高」档；无命中返回空串（不臆断）。
 * 雇主侧用于「候选人层级 vs JD 职级带」错位判定；候选人侧用于 skipTiers 过滤。
 */
export function classifyTier(text: string, lexicon?: string[]): string {
  const lower = String(text ?? '').toLowerCase();
  const order = lexicon?.length ? lexicon : DEFAULT_RUBRIC_SEED.tierLexicon;
  let hit = '';
  for (const tier of order) {
    const patterns = TIER_PATTERNS[tier] ?? [tier.toLowerCase()];
    if (patterns.some((p) => lower.includes(p.toLowerCase()))) hit = tier;
  }
  return hit;
}

/** 职级序（同词表下标）：错位判定用；未知返回 -1。 */
export function tierRank(tier: string, lexicon?: string[]): number {
  const order = lexicon?.length ? lexicon : DEFAULT_RUBRIC_SEED.tierLexicon;
  return order.indexOf(tier);
}
