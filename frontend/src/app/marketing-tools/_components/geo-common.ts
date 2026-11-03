/**
 * GEO 分析（生成式引擎优化）前后端共用口径：指标与资质说明见后端 geo.service.ts
 * （与 AIworkin GEO 技能包 geo_metrics.py / 报告模板同口径）。
 */

export type GeoProject = {
  id: number;
  brand: string;
  brandAliases: string;
  brandAliasList: string[];
  industry: string;
  competitors: string[];
  platforms: string[];
  status: string;
  note: string;
};

export type GeoQuestion = {
  id: number;
  seq: string;
  text: string;
  type: string;
  scenario: string;
  expectedAnswerForm: string;
  priority: string;
  status: string;
};

export type GeoBatch = {
  id: number;
  periodLabel: string;
  channel: string;
  dataNature: string;
  platforms: string[];
  note: string;
  observationCount: number;
  createdBy: string;
};

export type GeoObservation = {
  id: number;
  questionId: number;
  questionText: string;
  questionType: string;
  platform: string;
  brandMentioned: number;
  rankPosition: number | null;
  sentiment: string;
  citationGenre: string;
  citationDomains: string;
  modelVersion: string;
  answerExcerpt: string;
};

export type GeoTopic = {
  id: number;
  title: string;
  gapType: string;
  questionId: number;
  platformCount: number;
  gapScore: number;
  citableScore: number;
  businessScore: number;
  supplyScore: number;
  styleBonus: number;
  totalScore: number;
  blacklisted: number;
  status: string;
  note: string;
};

/** 自动采集单期任务（geo_collect_runs 视图）：planned/done/failed 为「问题 × 平台」项数 */
export type GeoCollectRun = {
  id: number;
  projectId: number;
  weekStart: string;
  periodLabel: string;
  status: string;
  planned: number;
  done: number;
  failed: number;
  pending: number;
  deferred: boolean;
  batchId: number;
  startedAt: string | null;
  finishedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  lastError: string;
};

/** 用户端「开启自动采集」面板状态（GET /geo/projects/:id/auto-collect） */
export type GeoAutoCollectStatus = {
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
  weekStart: string;
  weekLabel: string;
  windowStart: string | null;
  windowEnd: string | null;
  inWindow: boolean;
  questionCount: number;
  usablePlatforms: string[];
  skippedPlatforms: string[];
  plannedPerRun: number;
  currentRun: GeoCollectRun | null;
  recentRuns: GeoCollectRun[];
};

/** 平台管理「采集任务量（本周）」（GET /admin/geo-collection/stats） */
export type GeoCollectStats = {
  weekStart: string;
  weekLabel: string;
  windowStart: string | null;
  windowEnd: string | null;
  inWindow: boolean;
  totals: {
    projects: number;
    planned: number;
    done: number;
    failed: number;
    pending: number;
  };
  runs: (GeoCollectRun & { brand: string; industry: string; enabled: boolean })[];
};

export type GeoMetrics = {
  total: number;
  mentioned: number;
  listed: number;
  negative: number;
  mentionRate: number;
  listRate: number;
  avgRank: number | null;
  negativeRate: number;
  citationQuality: number;
  exposureScore: number;
  tier: string;
};

export type GeoMeta = {
  platforms: string[];
  /** 平台管理后台已配好 Key 与模型的平台；不在其中的前台不可选用，也不参与自动采集。 */
  availablePlatforms: string[];
  questionTypes: { type: string; target: number; share: number }[];
  sentiments: string[];
  citationGenres: string[];
  gapTypes: string[];
};

export type GeoReport = {
  project: GeoProject;
  questions: GeoQuestion[];
  batches: GeoBatch[];
  current: GeoBatch | null;
  baseline: GeoBatch | null;
  metrics: GeoMetrics | null;
  prevMetrics: GeoMetrics | null;
  platforms: {
    platform: string;
    total: number;
    mentioned: number;
    listed: number;
    avgRank: number | null;
    topCitation: string;
    tip: string;
  }[];
  competitors: {
    name: string;
    mentionRate: number;
    coverGap: number;
    listRate: number | null;
    avgRank: number | null;
    exposureScore: number | null;
  }[];
  gaps: GeoGap[];
  actions: {
    action: string;
    skill: string;
    owner: string;
    priority: string;
    due: string;
  }[];
  summary: string[];
};

export type GeoGap = {
  questionId: number;
  type: string;
  priority: string;
  text: string;
  gapType: string;
  detail: string;
  platforms: string[];
  suggestForm: string;
};

export type GeoTopicDraft = {
  title: string;
  gapType: string;
  questionId: number;
  platformCount: number;
  gapScore: number;
  citableScore: number;
  businessScore: number;
  supplyScore: number;
  note: string;
};

/** 依《GEO 四维选题评分引擎》分档，把报告缺口证据预填成选题草稿（预填值需用户按实际证据调整）。 */
export function draftTopicFromGap(gap: GeoGap): GeoTopicDraft {
  const gapScores: Record<string, number> = {
    引用真空点: 9,
    竞品覆盖点: 7,
    弱覆盖点: 4,
    名次缺口: 5,
    品牌被错误描述点: 9,
  };
  const businessScores: Record<string, number> = {
    品类词: 9,
    决策词: 9,
    竞品对比词: 7,
    品牌词: 4,
  };
  return {
    title: gap.text,
    gapType: gap.gapType,
    questionId: gap.questionId,
    platformCount: gap.platforms.length,
    gapScore: gapScores[gap.gapType] ?? 5,
    citableScore: /对比表|清单|FAQ|数据文|指南/.test(gap.suggestForm || "")
      ? 8
      : 6,
    businessScore: businessScores[gap.type] ?? 5,
    supplyScore: 6,
    note: `由「${gap.gapType}」缺口生成：${gap.detail}（涉及 ${gap.platforms.join(" / ")}）`,
  };
}

export const TOPIC_WEIGHTS =
  "总分 = 缺口强度×0.30 + （可引性 + 风格加分）×0.30 + 商业价值×0.25 + 供给难度×0.15；多平台同现缺口（≥3）缺口强度 +2（封顶 10）；黑名单选题直接判 0 分淘汰。";

export function pct(rate?: number | null) {
  if (rate === undefined || rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function score(value?: number | null) {
  if (value === undefined || value === null) return "—";
  return value.toFixed(1);
}

export function tierBadge(tier?: string) {
  if (tier === "优") return "badge-green";
  if (tier === "良") return "badge-sky";
  if (tier === "中") return "badge-orange";
  return "badge-red";
}

export function priorityBadge(priority: string) {
  if (priority === "P0") return "badge-red";
  if (priority === "P1") return "badge-orange";
  return "badge-gray";
}

export function natureLabel(nature: string) {
  return nature === "real" ? "真实采集数据" : "模拟数据";
}

/** 采集通道：A 人工 / B 每月复核 / C 系统自动采集（AI 采集管线建出的批次） */
export function channelLabel(channel: string) {
  if (channel === "C") return "自动采集（系统）";
  if (channel === "B") return "周期 B（月）";
  return "周期 A（周）";
}

/** 自动采集单期任务状态中文口径 */
export function collectStatusLabel(status: string) {
  if (status === "RUNNING") return "采集中";
  if (status === "DONE") return "已完成";
  if (status === "CLOSED") return "已收口";
  if (status === "CANCELLED") return "已取消";
  return "待采集";
}

export function collectStatusBadge(status: string) {
  if (status === "RUNNING") return "badge-sky";
  if (status === "DONE") return "badge-green";
  if (status === "CLOSED") return "badge-orange";
  if (status === "CANCELLED") return "badge-gray";
  return "badge-gray";
}

/** 后端窗口时间是 ISO 串（含时区），界面按本地时间显示「周X HH:MM」 */
export function formatWindow(start?: string | null, end?: string | null) {
  if (!start) return "本期已无可用窗口";
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return String(start);
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const time = (value: Date) =>
    `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return `${days[from.getDay()]} ${time(from)}${end ? `–${time(new Date(end))}` : ""}`;
}

/** 比率差值（百分点，带符号）。 */
export function deltaPp(current?: number | null, base?: number | null) {
  if (current === undefined || current === null) return "—";
  if (base === undefined || base === null) return "基线（首次）";
  const diff = (current - base) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}pp`;
}

export function deltaNum(current?: number | null, base?: number | null, digits = 1) {
  if (current === undefined || current === null) return "—";
  if (base === undefined || base === null) return "基线（首次）";
  const diff = current - base;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(digits)}`;
}
