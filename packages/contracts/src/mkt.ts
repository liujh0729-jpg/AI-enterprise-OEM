import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 营销技能库：内置技能 + 组织自定义技能，运行产出可沉淀为内容资产。 */
export const MKT_SKILL_CATEGORIES = [
  "CONTENT",
  "SOCIAL",
  "EMAIL",
  "SEO",
  "ADS",
  "RESEARCH",
  "SALES",
] as const;
export const MKT_SKILL_CATEGORY_LABELS: Record<string, string> = {
  CONTENT: "内容创作",
  SOCIAL: "社媒运营",
  EMAIL: "邮件营销",
  SEO: "搜索优化",
  ADS: "广告投放",
  RESEARCH: "市场调研",
  SALES: "销售赋能",
};
export const MKT_OUTPUT_FORMATS = ["TEXT", "MARKDOWN", "JSON", "BRIEF"] as const;
export const MKT_OUTPUT_FORMAT_LABELS: Record<string, string> = {
  TEXT: "纯文本",
  MARKDOWN: "Markdown",
  JSON: "结构化数据",
  BRIEF: "创意简报",
};

export const mktSkillInputSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  type: z.enum(["TEXT", "TEXTAREA", "SELECT", "NUMBER"]).default("TEXT"),
  required: z.boolean().default(true),
  placeholder: z.string().max(120).default(""),
  options: z.array(z.string()).default([]),
});
export const mktSkillSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  channel: z.string(),
  promptTemplate: z.string(),
  inputs: z.array(mktSkillInputSchema),
  outputFormat: z.string(),
  builtin: z.boolean(),
  enabled: z.boolean(),
  runCount: z.number(),
  updatedAt: z.string(),
});

export const mktRunSchema = z.object({
  id: z.number(),
  skillId: z.number(),
  skillKey: z.string(),
  skillName: z.string(),
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  mode: z.enum(["llm", "rule"]),
  input: z.record(z.string(), z.string()),
  output: z.string(),
  artifactId: z.number().nullable(),
  tokens: z.number(),
  points: z.number(),
  error: z.string(),
  createdAt: z.string(),
});

export const mktArtifactSchema = z.object({
  id: z.number(),
  title: z.string(),
  kind: z.string(),
  body: z.string(),
  status: z.enum(["DRAFT", "READY", "ARCHIVED"]),
  sourceRunId: z.number().nullable(),
  /** 内容审核（docs §8.4 营销内容生成→内容审核） */
  reviewStatus: z.enum(["NONE", "PENDING", "APPROVED", "REJECTED"]),
  reviewRound: z.number(),
  reviewerId: z.string(),
  reviewedAt: z.string(),
  reviewNote: z.string(),
  /** 渠道发布（内容审核通过→渠道发布） */
  publishStatus: z.enum(["NONE", "PENDING", "PUBLISHED"]),
  publishChannel: z.string(),
  publishNote: z.string(),
  publishedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mktContextSchema = z.object({
  brandName: z.string(),
  industry: z.string(),
  positioning: z.string(),
  tone: z.string(),
  audiences: z.array(z.string()),
  keywords: z.array(z.string()),
  competitors: z.array(z.string()),
  updatedAt: z.string(),
});

export const mktCapabilitySchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.string(),
  connected: z.boolean(),
  accountName: z.string(),
  connectedAt: z.string(),
  lastSyncAt: z.string(),
  note: z.string(),
});

export const mktLoopSchema = z.object({
  id: z.number(),
  skillKey: z.string(),
  skillName: z.string(),
  name: z.string(),
  cron: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.string(),
  nextRunAt: z.string(),
  createdAt: z.string(),
});

export const mktEvalSchema = z.object({
  runId: z.number(),
  mode: z.enum(["llm", "rule"]),
  score: z.number(),
  dimensions: z.array(z.object({ name: z.string(), score: z.number(), note: z.string() })),
  suggestions: z.array(z.string()),
  generatedAt: z.string(),
});

export const saveMktSkillBodySchema = z.object({
  id: z.number().int().positive().optional(),
  key: z.string().min(2).max(40),
  name: z.string().min(1).max(60),
  category: z.enum(MKT_SKILL_CATEGORIES),
  description: z.string().max(500).default(""),
  channel: z.string().max(40).default(""),
  promptTemplate: z.string().min(5).max(8000),
  inputs: z.array(mktSkillInputSchema).max(12).default([]),
  outputFormat: z.enum(MKT_OUTPUT_FORMATS).default("MARKDOWN"),
  enabled: z.boolean().default(true),
});

export const runMktSkillBodySchema = z.object({
  skillKey: z.string().min(2).max(40),
  input: z.record(z.string(), z.string()).default({}),
  persistArtifact: z.boolean().default(true),
});

export const saveMktArtifactBodySchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1).max(120),
  kind: z.string().max(24).default("COPY"),
  body: z.string().min(1).max(20000),
  status: z.enum(["DRAFT", "READY", "ARCHIVED"]).default("DRAFT"),
  sourceRunId: z.number().int().positive().optional(),
});

/** 内容审核结论：通过后自动进入渠道发布待办，驳回退回内容资产继续修改。 */
export const reviewMktArtifactBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});

/** 渠道发布回执：渠道＋执行结果，作为发布任务的完成依据。 */
export const publishMktArtifactBodySchema = z.object({
  id: z.number().int().positive(),
  channel: z.string().min(1).max(60),
  note: z.string().max(500).default(""),
});

export const updateMktContextBodySchema = z.object({
  brandName: z.string().max(80).default(""),
  industry: z.string().max(60).default(""),
  positioning: z.string().max(500).default(""),
  tone: z.string().max(200).default(""),
  audiences: z.array(z.string().max(60)).max(20).default([]),
  keywords: z.array(z.string().max(60)).max(30).default([]),
  competitors: z.array(z.string().max(60)).max(20).default([]),
});

export const connectMktAccountBodySchema = z.object({
  key: z.string().min(2).max(40),
  accountName: z.string().min(1).max(80),
  credential: z.string().max(2000).default(""),
});

export const callMktCapabilityBodySchema = z.object({
  key: z.string().min(2).max(40),
  action: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const saveMktLoopBodySchema = z.object({
  id: z.number().int().positive().optional(),
  skillKey: z.string().min(2).max(40),
  name: z.string().min(1).max(80),
  cron: z.string().min(1).max(60),
  enabled: z.boolean().default(true),
});

export const runMktEvalBodySchema = z.object({
  runId: z.number().int().positive(),
});

export const mktEndpoints = {
  Mkt_listSkills: {
    method: "get" as const,
    path: "/enterprise/mkt/skills",
    params: z.object({}),
    query: z.object({
      category: z.string().optional(),
      q: z.string().optional(),
      enabled: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(mktSkillSchema)),
  },
  Mkt_getSkill: {
    method: "get" as const,
    path: "/enterprise/mkt/skills/:key",
    params: z.object({ key: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mktSkillSchema),
  },
  Mkt_saveSkill: {
    method: "post" as const,
    path: "/enterprise/mkt/skills/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveMktSkillBodySchema,
    response: envelope(mktSkillSchema),
  },
  Mkt_runSkill: {
    method: "post" as const,
    path: "/enterprise/mkt/skills/run",
    params: z.object({}),
    query: emptyQuery,
    body: runMktSkillBodySchema,
    response: envelope(mktRunSchema),
  },
  Mkt_listRuns: {
    method: "get" as const,
    path: "/enterprise/mkt/runs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      skillKey: z.string().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(mktRunSchema)),
  },
  Mkt_listArtifacts: {
    method: "get" as const,
    path: "/enterprise/mkt/artifacts",
    params: z.object({}),
    query: pageQuerySchema.extend({
      kind: z.string().optional(),
      status: z.string().optional(),
      reviewStatus: z.string().optional(),
      publishStatus: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(mktArtifactSchema)),
  },
  Mkt_saveArtifact: {
    method: "post" as const,
    path: "/enterprise/mkt/artifacts/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveMktArtifactBodySchema,
    response: envelope(mktArtifactSchema),
  },
  Mkt_reviewArtifact: {
    method: "post" as const,
    path: "/enterprise/mkt/artifacts/review",
    params: z.object({}),
    query: emptyQuery,
    body: reviewMktArtifactBodySchema,
    response: envelope(mktArtifactSchema),
  },
  Mkt_publishArtifact: {
    method: "post" as const,
    path: "/enterprise/mkt/artifacts/publish",
    params: z.object({}),
    query: emptyQuery,
    body: publishMktArtifactBodySchema,
    response: envelope(mktArtifactSchema),
  },
  Mkt_readContext: {
    method: "get" as const,
    path: "/enterprise/mkt/context",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mktContextSchema),
  },
  Mkt_updateContext: {
    method: "post" as const,
    path: "/enterprise/mkt/context/save",
    params: z.object({}),
    query: emptyQuery,
    body: updateMktContextBodySchema,
    response: envelope(mktContextSchema),
  },
  Mkt_listCapabilities: {
    method: "get" as const,
    path: "/enterprise/mkt/capabilities",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(mktCapabilitySchema)),
  },
  Mkt_connectAccount: {
    method: "post" as const,
    path: "/enterprise/mkt/capabilities/connect",
    params: z.object({}),
    query: emptyQuery,
    body: connectMktAccountBodySchema,
    response: envelope(mktCapabilitySchema),
  },
  Mkt_disconnectAccount: {
    method: "post" as const,
    path: "/enterprise/mkt/capabilities/disconnect",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ key: z.string().min(2).max(40) }),
    response: envelope(mktCapabilitySchema),
  },
  Mkt_callCapability: {
    method: "post" as const,
    path: "/enterprise/mkt/capabilities/call",
    params: z.object({}),
    query: emptyQuery,
    body: callMktCapabilityBodySchema,
    response: envelope(z.object({ ok: z.boolean(), action: z.string(), result: z.string() })),
  },
  Mkt_listLoops: {
    method: "get" as const,
    path: "/enterprise/mkt/loops",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(mktLoopSchema)),
  },
  Mkt_saveLoop: {
    method: "post" as const,
    path: "/enterprise/mkt/loops/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveMktLoopBodySchema,
    response: envelope(mktLoopSchema),
  },
  Mkt_removeLoop: {
    method: "post" as const,
    path: "/enterprise/mkt/loops/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Mkt_runEval: {
    method: "post" as const,
    path: "/enterprise/mkt/runs/eval",
    params: z.object({}),
    query: emptyQuery,
    body: runMktEvalBodySchema,
    response: envelope(mktEvalSchema),
  },
};
