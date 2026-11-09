import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const httpUrl = z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), {
  message: "只接受 http(s) 地址",
});

/**
 * 视频模版社区（内容创作板块下的社区入口）。
 *
 * 与「创意社区」的 Comfy Cloud 工作流市场不是一回事：这里的模版是站内内容，
 * 发布者提供样片、参考图、提示词与所用模型，使用者用自己「模型设置」里的模型复刻生成。
 * 查看可设积分：首位非发布者查看时，查看者扣分、发布者得分，同一账号只收一次。
 */

export const VIDEO_TEMPLATE_TYPES = [
  "all-reference",
  "character-swap",
  "motion",
  "lip-sync",
  "other",
] as const;
export type VideoTemplateType = (typeof VIDEO_TEMPLATE_TYPES)[number];
export const VIDEO_TEMPLATE_TYPE_LABELS: Record<VideoTemplateType, string> = {
  "all-reference": "全能参考",
  "character-swap": "人物替换",
  motion: "动作模版",
  "lip-sync": "对口型",
  other: "其他",
};

export const VIDEO_TEMPLATE_SORTS = ["hot", "latest", "favorite"] as const;
export type VideoTemplateSort = (typeof VIDEO_TEMPLATE_SORTS)[number];
export const VIDEO_TEMPLATE_SORT_LABELS: Record<VideoTemplateSort, string> = {
  hot: "使用最多",
  latest: "最新",
  favorite: "收藏最多",
};

export const VIDEO_TEMPLATE_REFERENCE_MAX = 6;
export const VIDEO_TEMPLATE_VIEW_COST_MAX = 100000;

/** 模版来源：LOCAL＝本站用户发布；AIWORKIN＝平台管理员开启后由 AIworkin 平台补充。 */
export const VIDEO_TEMPLATE_SOURCES = ["LOCAL", "AIWORKIN"] as const;
export type VideoTemplateSource = (typeof VIDEO_TEMPLATE_SOURCES)[number];

export const VIDEO_TEMPLATE_SYNC_MODES = ["MANUAL", "SCHEDULED"] as const;
export type VideoTemplateSyncMode = (typeof VIDEO_TEMPLATE_SYNC_MODES)[number];

export const videoTemplateSyncStatusSchema = z.object({
  /** 展示开关：只控制 AIWORKIN 来源是否出现在列表里 */
  showAiworkin: z.boolean(),
  mode: z.enum(VIDEO_TEMPLATE_SYNC_MODES),
  /** 定时同步间隔（分钟）；MANUAL 时仅作展示 */
  intervalMinutes: z.number(),
  lastSyncAt: z.string(),
  lastResult: z.enum(["SUCCESS", "FAILED", "SKIPPED", ""]),
  lastError: z.string(),
  lastCount: z.number(),
});
export type VideoTemplateSyncStatus = z.infer<typeof videoTemplateSyncStatusSchema>;

const videoTemplateBaseSchema = z.object({
  id: z.number(),
  title: z.string(),
  /** 列表只回截断后的简介，详情回全文 */
  description: z.string(),
  videoType: z.string(),
  videoTypeLabel: z.string(),
  coverUrl: z.string(),
  source: z.enum(VIDEO_TEMPLATE_SOURCES),
  ownerName: z.string(),
  /** 查看一次要扣的积分；0＝免费 */
  viewCost: z.number(),
  useCount: z.number(),
  favoriteCount: z.number(),
  viewCount: z.number(),
  /** 平均分（1 位小数）；0 条评分时为 0 */
  ratingAvg: z.number(),
  ratingCount: z.number(),
  createdAt: z.string(),
  /** 我发布的 */
  mine: z.boolean(),
  favorited: z.boolean(),
  /** 我的评分：0＝未评分 */
  myRating: z.number(),
});
export type VideoTemplateCard = z.infer<typeof videoTemplateBaseSchema>;

export const videoTemplateDetailSchema = videoTemplateBaseSchema.extend({
  /** 「配方」未解锁：样片照常可看，提示词 / 参考图 / 发布者模型不下发 */
  locked: z.boolean(),
  viewed: z.boolean(),
  sampleUrl: z.string(),
  prompt: z.string(),
  referenceImages: z.array(z.string()),
  /** 发布者当时用的渠道与模型，仅供使用者选模型时参考 */
  modelChannelName: z.string(),
  modelName: z.string(),
  canManage: z.boolean(),
});
export type VideoTemplateDetail = z.infer<typeof videoTemplateDetailSchema>;

export const videoTemplatePublishSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  videoType: z.enum(VIDEO_TEMPLATE_TYPES).default("all-reference"),
  /** 样片视频直链（上传接口回流） */
  sampleUrl: httpUrl,
  /** 封面图直链；空＝前端退回第一张参考图 */
  coverUrl: z.union([httpUrl, z.literal("")]).default(""),
  referenceImages: z.array(httpUrl).max(VIDEO_TEMPLATE_REFERENCE_MAX).default([]),
  prompt: z.string().trim().min(1).max(4000),
  modelChannelName: z.string().trim().max(120).default(""),
  modelName: z.string().trim().min(1).max(200),
  /** 查看积分：0＝免费；发布者本人查看不扣不赚 */
  viewCost: z.number().int().min(0).max(VIDEO_TEMPLATE_VIEW_COST_MAX).default(0),
});
export type VideoTemplatePublish = z.infer<typeof videoTemplatePublishSchema>;

const videoModelSchema = z.object({
  channelId: z.number().int().min(-1),
  model: z.string().trim().min(1).max(200),
});

export const videoTemplateGenerateSchema = z.object({
  prompt: z.string().trim().max(4000).optional(),
  referenceImages: z.array(httpUrl).max(VIDEO_TEMPLATE_REFERENCE_MAX).optional(),
  duration: z.number().min(1).max(30).optional(),
  ratio: z.string().trim().max(16).optional(),
  resolution: z.string().trim().max(16).optional(),
  /** 使用者自己的视频模型：必填，先选渠道再选模型 */
  models: z.object({ video: videoModelSchema }),
});
export type VideoTemplateGenerate = z.infer<typeof videoTemplateGenerateSchema>;

export const videoTemplateEndpoints = {
  VideoTemplate_list: {
    method: "get" as const,
    path: "/enterprise/content/video-templates",
    params: z.object({}),
    query: pageQuerySchema.extend({
      keyword: z.string().max(120).optional(),
      type: z.enum(VIDEO_TEMPLATE_TYPES).optional(),
      sort: z.enum(VIDEO_TEMPLATE_SORTS).default("latest"),
      /** 我的发布 */
      mine: z.coerce.boolean().optional(),
      /** 我的收藏 */
      favorite: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(videoTemplateBaseSchema)),
  },
  VideoTemplate_detail: {
    method: "get" as const,
    path: "/enterprise/content/video-templates/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(videoTemplateDetailSchema),
  },
  VideoTemplate_view: {
    method: "post" as const,
    path: "/enterprise/content/video-templates/:id/view",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(videoTemplateDetailSchema),
  },
  VideoTemplate_publish: {
    method: "post" as const,
    path: "/enterprise/content/video-templates",
    params: z.object({}),
    query: emptyQuery,
    body: videoTemplatePublishSchema,
    response: envelope(videoTemplateDetailSchema),
  },
  VideoTemplate_remove: {
    method: "delete" as const,
    path: "/enterprise/content/video-templates/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  VideoTemplate_favorite: {
    method: "post" as const,
    path: "/enterprise/content/video-templates/:id/favorite",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ favorited: z.boolean(), favoriteCount: z.number() })),
  },
  VideoTemplate_unfavorite: {
    method: "delete" as const,
    path: "/enterprise/content/video-templates/:id/favorite",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ favorited: z.boolean(), favoriteCount: z.number() })),
  },
  VideoTemplate_rate: {
    method: "put" as const,
    path: "/enterprise/content/video-templates/:id/rating",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({ score: z.number().int().min(1).max(5) }),
    response: envelope(
      z.object({ myRating: z.number(), ratingAvg: z.number(), ratingCount: z.number() }),
    ),
  },
  VideoTemplate_generate: {
    method: "post" as const,
    path: "/enterprise/content/video-templates/:id/generate",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: videoTemplateGenerateSchema,
    response: envelope(
      z.object({
        /** 复刻任务 id，前端沿用内容创作任务轮询 */
        jobId: z.number(),
        useCount: z.number(),
      }),
    ),
  },
  /** 平台后台：是否展示 AIworkin 平台模版 + 同步策略与状态。 */
  VideoTemplateAdmin_settings: {
    method: "get" as const,
    path: "/enterprise/admin/video-templates/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(videoTemplateSyncStatusSchema),
  },
  VideoTemplateAdmin_saveSettings: {
    method: "put" as const,
    path: "/enterprise/admin/video-templates/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      showAiworkin: z.boolean().optional(),
      mode: z.enum(VIDEO_TEMPLATE_SYNC_MODES).optional(),
      intervalMinutes: z.number().int().min(5).max(1440).optional(),
    }),
    response: envelope(videoTemplateSyncStatusSchema),
  },
  VideoTemplateAdmin_sync: {
    method: "post" as const,
    path: "/enterprise/admin/video-templates/sync",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(videoTemplateSyncStatusSchema),
  },
};
