import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 发布审核（阿里云内容安全 / 绿网）：平台管理员配一把 AccessKey，
 * 社群发帖与简历可选、发布需求与服务必选；命中违规直接阻断本次发布。
 * 凭据只落 AES-256-GCM 密文，任何接口都不回明文。
 */
export const PUBLISH_REVIEW_REGIONS = [
  "cn-shanghai",
  "cn-beijing",
  "cn-shenzhen",
  "cn-hangzhou",
] as const;
export type PublishReviewRegion = (typeof PUBLISH_REVIEW_REGIONS)[number];
export const PUBLISH_REVIEW_REGION_LABELS: Record<PublishReviewRegion, string> =
  {
    "cn-shanghai": "华东2（上海）",
    "cn-beijing": "华北2（北京）",
    "cn-shenzhen": "华南1（深圳）",
    "cn-hangzhou": "华东1（杭州）",
  };

export const PUBLISH_REVIEW_SCENE_LABELS = {
  community_post: "社群发帖",
  resume: "发布简历",
  demand: "发布需求",
  service: "发布服务",
  acquisition_outreach: "获客触达",
} as const;
export type PublishReviewScene = keyof typeof PUBLISH_REVIEW_SCENE_LABELS;

export const PUBLISH_REVIEW_DECISIONS = ["BLOCK", "REVIEW", "ERROR"] as const;
export type PublishReviewDecision = (typeof PUBLISH_REVIEW_DECISIONS)[number];

/** 阿里云返回的 suggestion；review 在本系统按「暂不可发布」处理（无人工复核队列时不能放行）。 */
export const ALIYUN_SUGGESTIONS = ["pass", "review", "block"] as const;
export type AliyunSuggestion = (typeof ALIYUN_SUGGESTIONS)[number];

export const ALIYUN_RISK_LABELS: Record<string, string> = {
  normal: "正常",
  spam: "垃圾信息",
  ad: "广告",
  politics: "涉政",
  terrorism: "暴恐",
  abuse: "辱骂",
  porn: "色情",
  flood: "灌水",
  contraband: "违禁",
  meaningless: "无意义",
  harmful: "不良场景",
  customized: "命中自定义词库",
};

/**
 * 场景开关：需求、服务、获客触达是必选能力，配置好凭据后恒为开启，不接受单独关闭；
 * 社群发帖、简历是可选场景，默认关闭，由管理员按需打开。
 * 获客触达是对外主动发消息（评论/私信/邮件），不设开关：配了凭据就必须过内容安全。
 */
export const publishReviewScenesSchema = z.object({
  communityPost: z.boolean().default(false),
  resume: z.boolean().default(false),
  demand: z.literal(true).default(true),
  service: z.literal(true).default(true),
});

export const publishReviewSettingsSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  region: z.enum(PUBLISH_REVIEW_REGIONS),
  accessKeyIdMasked: z.string().default(""),
  scenes: publishReviewScenesSchema,
  /** db=后台保存；none=尚未配置。 */
  source: z.enum(["db", "none"]),
  updatedAt: z.string().nullable(),
});
export type PublishReviewSettings = z.infer<
  typeof publishReviewSettingsSchema
>;

export const savePublishReviewBodySchema = z.object({
  enabled: z.boolean().default(true),
  region: z.enum(PUBLISH_REVIEW_REGIONS),
  /** 留空沿用已保存值；更换凭据时整对重填。 */
  accessKeyId: z.string().trim().max(256).default(""),
  accessKeySecret: z.string().trim().max(512).default(""),
  scenes: z.object({
    communityPost: z.boolean().default(false),
    resume: z.boolean().default(false),
  }),
});
export type SavePublishReviewBody = z.infer<
  typeof savePublishReviewBodySchema
>;

export const testPublishReviewBodySchema = z.object({
  text: z.string().trim().min(1, "请填写待检测文本").max(10000),
});

export const publishReviewTestResultSchema = z.object({
  suggestion: z.enum(ALIYUN_SUGGESTIONS),
  label: z.string().default(""),
  labels: z.array(z.string()).default([]),
  rate: z.number().default(0),
  message: z.string().default(""),
});
export type PublishReviewTestResult = z.infer<
  typeof publishReviewTestResultSchema
>;

export const publishReviewLogSchema = z.object({
  id: z.number().int(),
  scene: z.enum([
    "community_post",
    "resume",
    "demand",
    "service",
    "acquisition_outreach",
  ]),
  sceneLabel: z.string(),
  userId: z.string(),
  decision: z.enum(PUBLISH_REVIEW_DECISIONS),
  suggestion: z.enum(ALIYUN_SUGGESTIONS),
  labels: z.array(z.string()).default([]),
  snippet: z.string().default(""),
  reason: z.string().default(""),
  requestId: z.string().default(""),
  createdAt: z.string(),
});
export type PublishReviewLog = z.infer<typeof publishReviewLogSchema>;

export const moderationEndpoints = {
  /** 发布审核配置（管理端）：只回掩码，是否已配置与四类场景开关。 */
  PublishReview_settings: {
    method: "get" as const,
    path: "/enterprise/platform/publish-review",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(publishReviewSettingsSchema),
  },
  /** 保存发布审核配置：凭据加密入库，保存后下一次发布即时生效。 */
  PublishReview_save: {
    method: "put" as const,
    path: "/enterprise/platform/publish-review",
    params: z.object({}),
    query: emptyQuery,
    body: savePublishReviewBodySchema,
    response: envelope(publishReviewSettingsSchema),
  },
  /** 测试审核：用已保存的凭据送一段文本，返回阿里云建议与命中分类（不落发布日志）。 */
  PublishReview_test: {
    method: "post" as const,
    path: "/enterprise/platform/publish-review/test",
    params: z.object({}),
    query: emptyQuery,
    body: testPublishReviewBodySchema,
    response: envelope(publishReviewTestResultSchema),
  },
  /** 拦截 / 复核 / 调用失败台账（管理端）：只记非 pass 结果，便于发现误杀与上游故障。 */
  PublishReview_logs: {
    method: "get" as const,
    path: "/enterprise/platform/publish-review/logs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      scene: z.string().optional(),
      decision: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(publishReviewLogSchema)),
  },
};
