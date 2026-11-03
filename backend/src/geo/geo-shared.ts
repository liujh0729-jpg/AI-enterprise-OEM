import { text } from '../common/api';
/**
 * GEO 共用口径（人工录入与自动采集两条路径必须一致，故独立成模块避免循环依赖）：
 * 平台清单 / 情绪 / 引用题材 / 缺口类型，以及观测字段的归一化规则。
 */
export const GEO_PLATFORMS = [
  'DeepSeek',
  '豆包',
  '元宝',
  'Kimi',
  '千问',
  'GLM',
  'MiMo',
  'MiniMax',
  'GPT',
  'Claude',
  'Gemini',
  'Grok',
] as const;
export const GEO_SENTIMENTS = ['正面', '中性', '负面', '未提及'] as const;
export const GEO_CITATION_GENRES = [
  '报告',
  '官网',
  '评测',
  '百科',
  '社区',
  '无',
] as const;
export const GEO_GAP_TYPES = [
  '引用真空点',
  '竞品覆盖点',
  '弱覆盖点',
  '名次缺口',
  '品牌被错误描述点',
] as const;
/**
 * 观测字段口径（人工录入与自动采集共用）：
 * 未点名则名次为空、情绪=未提及、引用题材=无——保证两条录入路径的指标口径一致。
 */
export function normalizeObservation(body: Record<string, unknown>) {
  const mentioned = Number(body.brand_mentioned || 0) ? 1 : 0;
  const rankRaw = Number(body.rank_position || 0);
  const citationGenre = GEO_CITATION_GENRES.includes(
    text(body.citation_genre) as (typeof GEO_CITATION_GENRES)[number],
  )
    ? text(body.citation_genre)
    : '无';
  const sentiment = GEO_SENTIMENTS.includes(
    text(body.sentiment) as (typeof GEO_SENTIMENTS)[number],
  )
    ? text(body.sentiment)
    : mentioned
      ? '中性'
      : '未提及';
  return {
    brandMentioned: mentioned,
    // 未上榜（未点名或未进推荐位）不记名次；平均排名只统计上榜样本
    rankPosition: mentioned && rankRaw > 0 ? Math.floor(rankRaw) : null,
    sentiment: mentioned ? sentiment : '未提及',
    citationGenre: mentioned ? citationGenre : '无',
    citationDomains: text(body.citation_domains).slice(0, 500),
    modelVersion: text(body.model_version).slice(0, 64),
    answerExcerpt: text(body.answer_excerpt),
  };
}
