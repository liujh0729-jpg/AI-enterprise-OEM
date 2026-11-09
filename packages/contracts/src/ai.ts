import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.number(),
    message: z.string(),
    data: data.nullable(),
  });

const emptyQuery = z.object({});

/**
 * 全系统通用 AI 能力（AI 底座方案 §10 P2-B）：
 * 摘要 / 抽取 / 分类 / 评分 / RAG 问答五个原子能力，以及各模块的点状 AI 动作。
 * 统一走 `backend/src/ai/ai-gateway`，缺 Key 或缺模型时返回规则式结果（mode=rule），
 * 不阻断业务链路；RAG 问答没有模型时返回检索片段（mode=retrieval）。
 */
export const AI_RUN_MODES = ["llm", "rule", "retrieval"] as const;
export const aiRunModeSchema = z.enum(AI_RUN_MODES);
export const AI_RUN_MODE_LABELS: Record<string, string> = {
  llm: "模型生成",
  rule: "规则兜底",
  retrieval: "知识库检索",
};

export const AI_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export const aiLevelSchema = z.enum(AI_LEVELS);
export const AI_LEVEL_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

export const aiScoreDimensionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  weight: z.number().positive().max(100).optional(),
});

export const aiClassifyLabelSchema = z.object({
  value: z.string().trim().min(1).max(60),
  label: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
});

export const aiExtractFieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  required: z.boolean().optional(),
});

const moduleAiGuide = z.string().trim().max(2000).optional();

export const aiSummarizeBodySchema = z.object({
  text: z.string().trim().min(1).max(20000),
  maxChars: z.number().int().min(100).max(5000).optional(),
  instruction: z.string().trim().max(500).optional(),
});
export const aiSummarizeResultSchema = z.object({
  summary: z.string(),
  points: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});
export type AiSummarizeResult = z.infer<typeof aiSummarizeResultSchema>;

export const aiExtractBodySchema = z.object({
  text: z.string().trim().min(1).max(30000),
  fields: z.array(aiExtractFieldSchema).min(1).max(30),
  instruction: z.string().trim().max(500).optional(),
});
export const aiExtractResultSchema = z.object({
  values: z.record(z.string(), z.string()),
  missing: z.array(z.string()),
  confidence: z.number(),
  mode: aiRunModeSchema,
  model: z.string(),
});

export const aiClassifyBodySchema = z.object({
  text: z.string().trim().min(1).max(20000),
  labels: z.array(aiClassifyLabelSchema).min(1).max(30),
  multi: z.boolean().optional(),
  instruction: z.string().trim().max(500).optional(),
});
export const aiClassifyResultSchema = z.object({
  label: z.string(),
  labelName: z.string(),
  confidence: z.number(),
  candidates: z.array(
    z.object({ label: z.string(), labelName: z.string(), score: z.number() }),
  ),
  mode: aiRunModeSchema,
  model: z.string(),
});

export const aiScoreBodySchema = z.object({
  text: z.string().trim().min(1).max(20000),
  dimensions: z.array(aiScoreDimensionSchema).min(1).max(12),
  guide: moduleAiGuide,
  module: z.string().trim().max(40).optional(),
});
export const aiScoreResultSchema = z.object({
  total: z.number(),
  level: aiLevelSchema,
  dimensions: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      score: z.number(),
      reason: z.string(),
    }),
  ),
  advice: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});

export const aiAskBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  sources: z.array(z.enum(["kb", "library", "help"])).optional(),
  spaceIds: z.array(z.number().int().positive()).max(20).optional(),
  consumerType: z
    .enum(["AVATAR", "AGENT", "SERVICE_DESK", "ERP", "CRM", "THINK_TANK", "LEGAL", "OVERSEAS"])
    .optional(),
  consumerId: z.string().trim().max(64).optional(),
  libraryIds: z.array(z.number().int().positive()).max(20).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  maxChars: z.number().int().min(200).max(8000).optional(),
});
export const aiAskResultSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      title: z.string(),
      ref: z.string(),
      source: z.string(),
      score: z.number(),
    }),
  ),
  mode: aiRunModeSchema,
  model: z.string(),
  modes: z.array(z.string()),
});

/** CRM：线索评分（补方案 §10「已草稿/摘要，补评分」）。 */
export const aiCrmLeadScoreBodySchema = z.object({
  leadId: z.number().int().positive(),
});
export const aiCrmLeadScoreResultSchema = z.object({
  score: z.number(),
  level: aiLevelSchema,
  reasons: z.array(z.string()),
  advice: z.string(),
  nextStep: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** OKR：KR 质量检查与进度总结（方案 §10：现无 LLM）。 */
export const aiOkrCheckKrBodySchema = z.object({
  krId: z.number().int().positive(),
});
export const aiOkrCheckKrResultSchema = z.object({
  score: z.number(),
  level: aiLevelSchema,
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  improvedTitle: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});
export const aiOkrProgressSummaryBodySchema = z.object({
  cycleId: z.number().int().positive().optional(),
});
export const aiOkrProgressSummaryResultSchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 项目：站会/周报摘要与任务智能拆分。 */
export const aiProjectStandupBodySchema = z.object({
  projectId: z.number().int().positive(),
  days: z.number().int().min(1).max(30).optional(),
});
export const aiProjectStandupResultSchema = z.object({
  summary: z.string(),
  done: z.array(z.string()),
  doing: z.array(z.string()),
  blocked: z.array(z.string()),
  next: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});
export const aiProjectSplitBodySchema = z.object({
  taskId: z.number().int().positive(),
  max: z.number().int().min(2).max(12).optional(),
});
export const aiProjectSplitResultSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      estimateHours: z.number(),
      acceptance: z.array(z.string()),
    }),
  ),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 问卷：开放题编码聚类 + 自动报告。 */
export const aiSurveyReportBodySchema = z.object({
  surveyId: z.number().int().positive(),
});
export const aiSurveyReportResultSchema = z.object({
  responses: z.number(),
  summary: z.string(),
  findings: z.array(z.string()),
  clusters: z.array(
    z.object({
      label: z.string(),
      count: z.number(),
      examples: z.array(z.string()),
    }),
  ),
  suggestions: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 分发：一稿多平台改写 + 标题标签。 */
export const aiDistributionRewriteBodySchema = z.object({
  contentId: z.number().int().positive().optional(),
  title: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1).max(20000),
  platformCodes: z.array(z.string().trim().min(1).max(32)).min(1).max(12),
});
export const aiDistributionRewriteResultSchema = z.object({
  versions: z.array(
    z.object({
      platformCode: z.string(),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()),
    }),
  ),
  titles: z.array(z.string()),
  tags: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 邮箱：摘要 / 分类 / 待办抽取 / 起草。 */
export const aiMailboxAnalyzeBodySchema = z.object({
  subject: z.string().trim().max(300).optional(),
  from: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(30000),
});
export const aiMailboxAnalyzeResultSchema = z.object({
  summary: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  priority: aiLevelSchema,
  todos: z.array(
    z.object({
      text: z.string(),
      dueAt: z.string(),
    }),
  ),
  replyDraft: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** HRM：离职风险评分。 */
export const aiHrmAttritionBodySchema = z.object({
  memberUserId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(2000).optional(),
});
export const aiHrmAttritionResultSchema = z.object({
  score: z.number(),
  level: aiLevelSchema,
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 法务：文书条款风险提示。 */
export const aiLegalReviewBodySchema = z.object({
  text: z.string().trim().min(1).max(30000),
  role: z.enum(["BUYER", "SELLER", "NEUTRAL"]).optional(),
});
export const aiLegalReviewResultSchema = z.object({
  summary: z.string(),
  risks: z.array(
    z.object({
      clause: z.string(),
      risk: z.string(),
      level: aiLevelSchema,
      suggestion: z.string(),
    }),
  ),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 出海：国别合规 RAG 问答。 */
export const aiOverseasCheckBodySchema = z.object({
  country: z.string().trim().min(1).max(60),
  question: z.string().trim().min(1).max(2000),
  text: z.string().trim().max(10000).optional(),
});
export const aiOverseasCheckResultSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({ title: z.string(), ref: z.string(), source: z.string() }),
  ),
  risks: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 开票：材料抽取与一致性校验。 */
export const aiInvoiceExtractBodySchema = z.object({
  text: z.string().trim().min(1).max(30000),
});
export const aiInvoiceExtractResultSchema = z.object({
  values: z.record(z.string(), z.string()),
  warnings: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 财税：材料合规检查。 */
export const aiTaxCheckBodySchema = z.object({
  text: z.string().trim().min(1).max(30000),
  region: z.string().trim().max(60).optional(),
});
export const aiTaxCheckResultSchema = z.object({
  summary: z.string(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** 社媒：帖子文案生成与私信意图分类。 */
export const aiSocialComposeBodySchema = z.object({
  topic: z.string().trim().min(1).max(2000),
  platform: z.string().trim().max(40).optional(),
  tone: z.string().trim().max(40).optional(),
  intentText: z.string().trim().max(5000).optional(),
});
export const aiSocialComposeResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  intent: z.string(),
  intentLabel: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});

/** OA：自然语言发起流程。只按模板产出草稿（选模板 + 预填字段 + 建议标题），由用户确认后再保存/提交。 */
export const aiOaDraftBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  orgType: z.string().trim().max(16).optional(),
  orgUserId: z.string().trim().max(64).optional(),
  templateId: z.number().int().positive().optional(),
});
export const aiOaDraftResultSchema = z.object({
  templateId: z.number().int(),
  templateName: z.string(),
  title: z.string(),
  formData: z.record(z.string(), z.unknown()),
  missing: z.array(z.string()),
  reason: z.string(),
  mode: aiRunModeSchema,
  model: z.string(),
});

export const aiEndpoints = {
  Ai_summarize: {
    method: "post" as const,
    path: "/enterprise/ai/summarize",
    params: z.object({}),
    query: emptyQuery,
    body: aiSummarizeBodySchema,
    response: envelope(aiSummarizeResultSchema),
  },
  Ai_extract: {
    method: "post" as const,
    path: "/enterprise/ai/extract",
    params: z.object({}),
    query: emptyQuery,
    body: aiExtractBodySchema,
    response: envelope(aiExtractResultSchema),
  },
  Ai_classify: {
    method: "post" as const,
    path: "/enterprise/ai/classify",
    params: z.object({}),
    query: emptyQuery,
    body: aiClassifyBodySchema,
    response: envelope(aiClassifyResultSchema),
  },
  Ai_score: {
    method: "post" as const,
    path: "/enterprise/ai/score",
    params: z.object({}),
    query: emptyQuery,
    body: aiScoreBodySchema,
    response: envelope(aiScoreResultSchema),
  },
  Ai_ask: {
    method: "post" as const,
    path: "/enterprise/ai/ask",
    params: z.object({}),
    query: emptyQuery,
    body: aiAskBodySchema,
    response: envelope(aiAskResultSchema),
  },
  Ai_crmLeadScore: {
    method: "post" as const,
    path: "/enterprise/ai/crm/lead-score",
    params: z.object({}),
    query: emptyQuery,
    body: aiCrmLeadScoreBodySchema,
    response: envelope(aiCrmLeadScoreResultSchema),
  },
  Ai_okrCheckKr: {
    method: "post" as const,
    path: "/enterprise/ai/okr/check-kr",
    params: z.object({}),
    query: emptyQuery,
    body: aiOkrCheckKrBodySchema,
    response: envelope(aiOkrCheckKrResultSchema),
  },
  Ai_okrProgressSummary: {
    method: "post" as const,
    path: "/enterprise/ai/okr/progress-summary",
    params: z.object({}),
    query: emptyQuery,
    body: aiOkrProgressSummaryBodySchema,
    response: envelope(aiOkrProgressSummaryResultSchema),
  },
  Ai_projectStandup: {
    method: "post" as const,
    path: "/enterprise/ai/project/standup",
    params: z.object({}),
    query: emptyQuery,
    body: aiProjectStandupBodySchema,
    response: envelope(aiProjectStandupResultSchema),
  },
  Ai_projectSplitTask: {
    method: "post" as const,
    path: "/enterprise/ai/project/split-task",
    params: z.object({}),
    query: emptyQuery,
    body: aiProjectSplitBodySchema,
    response: envelope(aiProjectSplitResultSchema),
  },
  Ai_surveyReport: {
    method: "post" as const,
    path: "/enterprise/ai/survey/report",
    params: z.object({}),
    query: emptyQuery,
    body: aiSurveyReportBodySchema,
    response: envelope(aiSurveyReportResultSchema),
  },
  Ai_distributionRewrite: {
    method: "post" as const,
    path: "/enterprise/ai/distribution/rewrite",
    params: z.object({}),
    query: emptyQuery,
    body: aiDistributionRewriteBodySchema,
    response: envelope(aiDistributionRewriteResultSchema),
  },
  Ai_mailboxAnalyze: {
    method: "post" as const,
    path: "/enterprise/ai/mailbox/analyze",
    params: z.object({}),
    query: emptyQuery,
    body: aiMailboxAnalyzeBodySchema,
    response: envelope(aiMailboxAnalyzeResultSchema),
  },
  Ai_hrmAttrition: {
    method: "post" as const,
    path: "/enterprise/ai/hrm/attrition",
    params: z.object({}),
    query: emptyQuery,
    body: aiHrmAttritionBodySchema,
    response: envelope(aiHrmAttritionResultSchema),
  },
  Ai_legalReview: {
    method: "post" as const,
    path: "/enterprise/ai/legal/review",
    params: z.object({}),
    query: emptyQuery,
    body: aiLegalReviewBodySchema,
    response: envelope(aiLegalReviewResultSchema),
  },
  Ai_overseasCheck: {
    method: "post" as const,
    path: "/enterprise/ai/overseas/check",
    params: z.object({}),
    query: emptyQuery,
    body: aiOverseasCheckBodySchema,
    response: envelope(aiOverseasCheckResultSchema),
  },
  Ai_invoiceExtract: {
    method: "post" as const,
    path: "/enterprise/ai/invoice/extract",
    params: z.object({}),
    query: emptyQuery,
    body: aiInvoiceExtractBodySchema,
    response: envelope(aiInvoiceExtractResultSchema),
  },
  Ai_taxCheck: {
    method: "post" as const,
    path: "/enterprise/ai/tax/check",
    params: z.object({}),
    query: emptyQuery,
    body: aiTaxCheckBodySchema,
    response: envelope(aiTaxCheckResultSchema),
  },
  Ai_socialCompose: {
    method: "post" as const,
    path: "/enterprise/ai/social/compose",
    params: z.object({}),
    query: emptyQuery,
    body: aiSocialComposeBodySchema,
    response: envelope(aiSocialComposeResultSchema),
  },
  Ai_oaDraftApplication: {
    method: "post" as const,
    path: "/enterprise/ai/oa/draft",
    params: z.object({}),
    query: emptyQuery,
    body: aiOaDraftBodySchema,
    response: envelope(aiOaDraftResultSchema),
  },
};
