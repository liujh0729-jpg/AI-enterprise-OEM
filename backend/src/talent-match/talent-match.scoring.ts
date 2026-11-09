import { keywordScore } from '../ai/retrieval-kernel';
import { text } from '../common/api';
import type { RubricView } from './talent-match.rubric';
import { classifyTier, tierRank } from './talent-match.rubric';

/**
 * 人岗匹配确定性评分（§12.9.1：分档换算/tier 裁决/阈值比较/矩阵完整性校验在 LLM 外用代码执行）。
 * 规则式路径与 LLM 路径共用同一矩阵结构与校验器：
 * - 需求抽取：JD 逐行识别要求句，命中硬要求词＝HIGH、加分词＝NICE、其余 MEDIUM；
 * - 证据匹配：keywordScore 阈值判 STRONG/PARTIAL，证据必须回指简历条目（sourceRef）；
 * - 分档锚定（§12.9.2）：HIGH=Missing 封顶 2.9（Knock-Out）；HIGH 全有原文证据且无 Missing 起 4.5。
 */

export type ResumeFact = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  period: string;
};
export type RequirementRow = {
  requirement: string;
  importance: 'HIGH' | 'MEDIUM' | 'NICE';
  match: 'STRONG' | 'PARTIAL' | 'MISSING';
  evidence: { quote: string; sourceRef: string }[];
  gapNote: string;
};
export type TalentEvalResult = {
  score: string;
  tier: 'excellent' | 'strong' | 'medium' | 'gap';
  dimensions: { key: string; label: string; score: string }[];
  requirementsMatrix: RequirementRow[];
  knockouts: string[];
  recommendation: string;
  rubricCode: string;
  rubricVersion: number;
  mode: 'llm' | 'rule';
};

const HIGH_RE =
  /必须|扎实|精通|熟练|掌握|本科|学士|硕士|年以上|经验|核心|独立负责/;
const NICE_RE = /优先|加分|了解|熟悉.{0,6}即可|乐于|良好的?沟通/;
const REQUIRE_HINT =
  /要求|技能|经验|能力|负责|熟悉|掌握|精通|学历|本科|大专|硕士|优先|加分|年以上|独立|沟通|协作|学习|抗压/;
/** 维度归属关键词（矩阵行按关键词归维；无匹配行时维度取整体覆盖） */
const DIMENSION_HINTS: Record<string, RegExp> = {
  HARD_SKILL:
    /技能|技术|语言|框架|工具|开发|设计|数据分析|python|java|sql|excel|英语|学历|本科|大专|硕士|专业/,
  SOFT: /沟通|协作|团队|责任|学习|抗压|细致|主动性|表达|管理/,
  EXPERIENCE: /经验|年|项目|负责|行业|岗位|职级|独立/,
  STABILITY: /稳定|长期|出差/,
};

const IMPORTANCE_WEIGHT = { HIGH: 1, MEDIUM: 0.5, NICE: 0.25 } as const;
const MATCH_VALUE = { STRONG: 1, PARTIAL: 0.5, MISSING: 0 } as const;

/** JD 抽取要求句：去标题行/空行，命中要求词的短行入矩阵（上限 15 条保确定性）。 */
export function extractRequirements(
  jd: string,
): { text: string; importance: 'HIGH' | 'MEDIUM' | 'NICE' }[] {
  const lines = String(jd ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[\s#>*\-•·\d.、()（）]+/, '').trim())
    .filter((l) => l.length >= 6 && l.length <= 160);
  const out: { text: string; importance: 'HIGH' | 'MEDIUM' | 'NICE' }[] = [];
  for (const line of lines) {
    if (!REQUIRE_HINT.test(line)) continue;
    const importance = NICE_RE.test(line)
      ? 'NICE'
      : HIGH_RE.test(line)
        ? 'HIGH'
        : 'MEDIUM';
    out.push({ text: line, importance });
    if (out.length >= 15) break;
  }
  return out;
}

/** 单条要求 vs 简历条目：keywordScore 阈值 + 技能词表精确命中；证据必回指条目 id。 */
export function matchRequirement(
  requirement: string,
  items: ResumeFact[],
  skills: string[],
): {
  match: 'STRONG' | 'PARTIAL' | 'MISSING';
  evidence: { quote: string; sourceRef: string }[];
} {
  const evidence: { quote: string; sourceRef: string }[] = [];
  const lowerReq = requirement.toLowerCase();
  const skillHits = skills.filter(
    (s) => s && lowerReq.includes(s.toLowerCase()),
  );
  for (const item of items) {
    const hay = `${item.title} ${item.detail} ${item.period}`;
    const skillInItem = skillHits.some((s) =>
      hay.toLowerCase().includes(s.toLowerCase()),
    );
    const score = keywordScore(requirement, hay);
    if (score >= 0.35 || skillInItem) {
      evidence.push({
        quote: `${item.kind}:${item.title}`.slice(0, 200),
        sourceRef: item.id,
      });
    } else if (score >= 0.18 && evidence.length < 3) {
      evidence.push({
        quote: `旁证 ${item.title}`.slice(0, 200),
        sourceRef: item.id,
      });
    }
  }
  if (evidence.length === 0) return { match: 'MISSING', evidence: [] };
  const strong =
    evidence.length >= 2 ||
    evidence.some((e) => !e.quote.startsWith('旁证')) ||
    skillHits.length > 0;
  return {
    match: strong ? 'STRONG' : 'PARTIAL',
    evidence: evidence.slice(0, 3),
  };
}

function coverage(rows: RequirementRow[]): number {
  if (!rows.length) return 0.5;
  let acc = 0;
  let total = 0;
  for (const r of rows) {
    acc += IMPORTANCE_WEIGHT[r.importance] * MATCH_VALUE[r.match];
    total += IMPORTANCE_WEIGHT[r.importance];
  }
  return total > 0 ? acc / total : 0.5;
}

/** 规则式全量评估：矩阵 → 四维覆盖 → 加权分 → 锚定校正 → 分档（全部确定性代码）。 */
export function ruleEvaluate(args: {
  jd: string;
  items: ResumeFact[];
  skills: string[];
  rubric: RubricView;
}): {
  matrix: RequirementRow[];
  dimensions: { key: string; label: string; score: string }[];
  result: TalentEvalResult;
} {
  const reqs = extractRequirements(args.jd);
  const matrix: RequirementRow[] = reqs.map((req) => {
    const m = matchRequirement(req.text, args.items, args.skills);
    return {
      requirement: req.text.slice(0, 200),
      importance: req.importance,
      match: m.match,
      evidence: m.evidence,
      gapNote: m.match === 'MISSING' ? '未找到原文级证据' : '',
    };
  });
  const overall = coverage(matrix);
  const dimensions = (
    args.rubric.dimensions.length
      ? args.rubric.dimensions
      : [
          { key: 'HARD_SKILL', label: '硬技能', description: '' },
          { key: 'SOFT', label: '软素质', description: '' },
          { key: 'EXPERIENCE', label: '经验层级', description: '' },
          { key: 'STABILITY', label: '稳定性', description: '' },
        ]
  ).map((d) => {
    const hint = DIMENSION_HINTS[d.key];
    const subset = hint
      ? matrix.filter((r) => hint.test(r.requirement.toLowerCase()))
      : [];
    const cov = subset.length ? coverage(subset) : overall;
    return {
      key: d.key,
      label: d.label || d.key,
      score: (1 + 4 * cov).toFixed(1),
    };
  });
  let weighted = 0;
  let weightSum = 0;
  for (const dim of dimensions) {
    const w = args.rubric.weights[dim.key] ?? 0.25;
    weighted += (w * (Number(dim.score) - 1)) / 4;
    weightSum += w;
  }
  let score = weightSum > 0 ? 1 + (4 * weighted) / weightSum : 1 + 4 * overall;
  const knockouts: string[] = [];
  const highMissing = matrix.filter(
    (r) => r.importance === 'HIGH' && r.match === 'MISSING',
  );
  const highPartial = matrix.filter(
    (r) => r.importance === 'HIGH' && r.match === 'PARTIAL',
  );
  const highAllStrong = matrix
    .filter((r) => r.importance === 'HIGH')
    .every((r) => r.match === 'STRONG');
  if (highMissing.length) {
    score = Math.min(score, 2.9);
    knockouts.push(
      ...highMissing.map((r) => `高要求无证据：${r.requirement}`.slice(0, 120)),
    );
  } else if (highPartial.length > 2) {
    score = Math.min(score, 3.9);
  } else if (highAllStrong && matrix.length >= 3) {
    score = Math.max(score, 4.5);
  }
  score = Math.min(5, Math.max(1, Math.round(score * 10) / 10));
  const th = args.rubric.thresholds;
  const tier =
    score >= (th.excellent ?? 4.5)
      ? 'excellent'
      : score >= (th.strong ?? 4.0)
        ? 'strong'
        : score >= (th.medium ?? 3.0)
          ? 'medium'
          : 'gap';
  const recommendation =
    tier === 'excellent' || tier === 'strong'
      ? '建议进面（参考分，录用决策须人工确认留痕）'
      : tier === 'medium'
        ? '备选：关键硬技能证据间接，建议面试补验'
        : '暂不匹配：存在高重要性需求缺口或 Knock-Out';
  const result: TalentEvalResult = {
    score: score.toFixed(1),
    tier,
    dimensions,
    requirementsMatrix: matrix,
    knockouts,
    recommendation,
    rubricCode: args.rubric.code,
    rubricVersion: args.rubric.version,
    mode: 'rule',
  };
  return { matrix, dimensions, result };
}

/**
 * LLM 出参同一校验器（§12.9.3 反编造共用口径）：
 * evidence.sourceRef 必须命中给定条目 id，非法回指剔除并降级；分档/阈值由代码重算，不采信模型自报。
 */
export function finalizeLlmJson(
  raw: Record<string, unknown>,
  args: { items: ResumeFact[]; rubric: RubricView },
): TalentEvalResult | null {
  const itemIds = new Set(args.items.map((i) => String(i.id)));
  const rows: RequirementRow[] = [];
  const matrixInput = Array.isArray(raw.requirementsMatrix)
    ? raw.requirementsMatrix
    : [];
  for (const entry of matrixInput.slice(0, 15)) {
    const row = entry as Record<string, unknown>;
    const importance = ['HIGH', 'MEDIUM', 'NICE'].includes(
      text(row?.importance),
    )
      ? (text(row.importance) as RequirementRow['importance'])
      : 'MEDIUM';
    const evidenceRaw = Array.isArray(row?.evidence) ? row.evidence : [];
    const evidence = evidenceRaw
      .map((e) => e as Record<string, unknown>)
      .filter((e) => itemIds.has(text(e?.sourceRef)))
      .slice(0, 3)
      .map((e) => ({
        quote: text(e?.quote).slice(0, 200),
        sourceRef: text(e?.sourceRef),
      }));
    let match = ['STRONG', 'PARTIAL', 'MISSING'].includes(text(row?.match))
      ? (text(row.match) as RequirementRow['match'])
      : 'MISSING';
    let gapNote = text(row?.gapNote).slice(0, 300);
    // 回指失败即不得成立：STRONG 无有效证据降级 MISSING（不允 AI 新造经历）
    if (match !== 'MISSING' && evidence.length === 0) {
      match = 'MISSING';
      gapNote = gapNote || '证据回指失败（sourceRef 非法），已降级';
    }
    rows.push({
      requirement: text(row?.requirement).slice(0, 200),
      importance,
      match,
      evidence,
      gapNote,
    });
  }
  if (!rows.length) return null;
  const th = args.rubric.thresholds;
  let score = Number(raw?.score);
  if (!Number.isFinite(score)) score = 1 + 4 * coverage(rows);
  score = Math.min(5, Math.max(1, Math.round(score * 10) / 10));
  const highMissing = rows.filter(
    (r) => r.importance === 'HIGH' && r.match === 'MISSING',
  );
  if (highMissing.length) score = Math.min(score, 2.9);
  const knockouts = Array.isArray(raw?.knockouts)
    ? raw.knockouts.map((k) => text(k).slice(0, 120))
    : [];
  for (const r of highMissing) {
    const tag = `高要求无证据：${r.requirement}`;
    if (!knockouts.some((k) => k.includes(r.requirement)))
      knockouts.push(tag.slice(0, 120));
  }
  const tier =
    score >= (th.excellent ?? 4.5)
      ? 'excellent'
      : score >= (th.strong ?? 4.0)
        ? 'strong'
        : score >= (th.medium ?? 3.0)
          ? 'medium'
          : 'gap';
  const dims = (Array.isArray(raw?.dimensions) ? raw.dimensions : [])
    .map((d) => d as Record<string, unknown>)
    .filter((d) => text(d?.key))
    .slice(0, 8)
    .map((d) => ({
      key: text(d.key).slice(0, 24),
      label: text(d.label ?? d.key).slice(0, 32),
      score: (Number.isFinite(Number(d?.score))
        ? Math.min(5, Math.max(1, Number(d.score)))
        : score
      ).toFixed(1),
    }));
  return {
    score: score.toFixed(1),
    tier,
    dimensions: dims.length ? dims : ruleDimensionsFromRows(rows, args.rubric),
    requirementsMatrix: rows,
    knockouts: knockouts.slice(0, 10),
    recommendation:
      text(raw?.recommendation).slice(0, 500) || `分档：${tier}（代码裁决）`,
    rubricCode: args.rubric.code,
    rubricVersion: args.rubric.version,
    mode: 'llm',
  };
}

function ruleDimensionsFromRows(rows: RequirementRow[], rubric: RubricView) {
  const overall = coverage(rows);
  return rubric.dimensions.map((d) => ({
    key: d.key,
    label: d.label || d.key,
    score: (1 + 4 * overall).toFixed(1),
  }));
}

/** 职级错位预警（§12.9.4 雇主侧消费）：候选层级 vs JD 职级带的相对差。 */
export function tierMismatch(
  candidateText: string,
  jobTier: string,
  lexicon?: string[],
): string {
  const c = classifyTier(candidateText, lexicon);
  if (!c || !jobTier) return '';
  const diff = tierRank(c, lexicon) - tierRank(jobTier, lexicon);
  if (diff >= 2)
    return `候选层级（${c}）明显高于职位带（${jobTier}）：预警保留率风险`;
  if (diff <= -2)
    return `候选层级（${c}）明显低于职位带（${jobTier}）：预警带不动风险`;
  return '';
}
