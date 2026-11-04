import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 创意社区（Comfy Cloud 工作流市场）。
 *
 * 运行永远发生在上游 Comfy Cloud：用户自带 API Key、烧自己的 Comfy 订阅积分（纯 BYOK），
 * 本站只负责内容目录、参数表单、提交转发与产物转存（上游签名 URL 约 6 小时就失效）。
 * 因此这里没有「算力计费」相关契约，只有 Key 绑定、工作流发布/审核与运行台账。
 */

/** 社区分类页签：与官方模板分组对齐后收敛成 6 类（tools 收图片/视频处理类小工具）。 */
export const COMMUNITY_CATEGORIES = [
  "image",
  "video",
  "audio",
  "3d",
  "llm",
  "tools",
] as const;
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];
export const COMMUNITY_CATEGORY_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
  "3d": "3D",
  llm: "文本/LLM",
  tools: "工具",
};

export const COMMUNITY_SORTS = ["recommend", "hot", "new"] as const;

/** 发布状态：用户提交即 PENDING，管理员通过后才是 APPROVED，推荐进市场为 RECOMMENDED。 */
export const COMMUNITY_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "RECOMMENDED",
  "REMOVED",
] as const;
export const COMMUNITY_STATUS_LABELS: Record<string, string> = {
  PENDING: "待审核",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  RECOMMENDED: "已推荐",
  REMOVED: "已下架",
};

/** 运行状态：与 Comfy API v2 的 job status 同名，前端直接据此渲染进度条。 */
export const COMMUNITY_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export const COMMUNITY_RUN_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

/** 槽位类型：决定前端表单控件；image 走本站上传换资产 id 后注入 `{"__type":"core/ASSET"}`。 */
export const COMMUNITY_SLOT_TYPES = [
  "text",
  "longtext",
  "int",
  "float",
  "enum",
  "seed",
  "image",
] as const;

export const communitySlotSchema = z.object({
  /** 槽位标识，同时是运行 body.inputs 的键 */
  key: z.string(),
  label: z.string(),
  type: z.enum(COMMUNITY_SLOT_TYPES),
  /** 要覆盖的节点与被覆盖的输入字段（发布期已按 object_info 校验存在） */
  nodeId: z.string(),
  field: z.string(),
  defaultValue: z.union([z.string(), z.number(), z.null()]).default(null),
  /** enum 候选值；其余类型为空数组 */
  options: z.array(z.string()).default([]),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  required: z.boolean().default(false),
});
export type CommunitySlot = z.infer<typeof communitySlotSchema>;

/** 卡片：列表页只回这些字段，不带工作流正文。 */
export const communityWorkflowCardSchema = z.object({
  id: z.number(),
  code: z.string(),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  ownerName: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  groupLabel: z.string(),
  tags: z.array(z.string()),
  mediaType: z.string(),
  /** api＝站内可直接运行；ui＝仅浏览（封面 + 说明 + 外链） */
  format: z.string(),
  runnable: z.boolean(),
  covers: z.array(z.string()),
  comfyUrl: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  runCount: z.number(),
  favoriteCount: z.number(),
  likeCount: z.number(),
  viewCount: z.number(),
  createdAt: z.string(),
  /** 我自己发布的（列表页据此显示「管理」入口） */
  mine: z.boolean(),
  favorited: z.boolean(),
  liked: z.boolean(),
});
export type CommunityWorkflowCard = z.infer<typeof communityWorkflowCardSchema>;

export const communityWorkflowDetailSchema = communityWorkflowCardSchema.extend({
  description: z.string(),
  slots: z.array(communitySlotSchema),
  /** 工作流正文：api 格式可直接下载复刻；ui 格式给「下载原图 JSON」 */
  workflowJson: z.record(z.string(), z.unknown()),
  ownerUserId: z.string(),
  /** 我能不能改它 / 下架它（作者本人；官方模板恒为 false） */
  canManage: z.boolean(),
  /** 未绑 Key 时前端点运行直接开引导弹窗 */
  keyConnected: z.boolean(),
  auditNote: z.string().default(""),
});
export type CommunityWorkflowDetail = z.infer<
  typeof communityWorkflowDetailSchema
>;

export const communityCategoryGroupSchema = z.object({
  label: z.string(),
  count: z.number(),
});
export const communityCategorySchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number(),
  groups: z.array(communityCategoryGroupSchema),
});
export type CommunityCategoryRow = z.infer<typeof communityCategorySchema>;

export const communityRunOutputSchema = z.object({
  kind: z.string(),
  name: z.string(),
  /** 本站 OSS 地址（不是上游签名 URL） */
  url: z.string(),
  ossKey: z.string(),
  sizeBytes: z.number(),
  /** 已登记进本站数字资产的 id，0＝未入台账 */
  assetId: z.number(),
});
export type CommunityRunOutput = z.infer<typeof communityRunOutputSchema>;

export const communityRunSchema = z.object({
  id: z.number(),
  workflowId: z.number(),
  workflowCode: z.string(),
  workflowTitle: z.string(),
  jobId: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  progressCurrent: z.number(),
  progressTotal: z.number(),
  queuePosition: z.number(),
  inputs: z.record(z.string(), z.unknown()),
  errorText: z.string(),
  outputs: z.array(communityRunOutputSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** 仍在跑（前端据此决定是否继续轮询） */
  active: z.boolean(),
});
export type CommunityRun = z.infer<typeof communityRunSchema>;

/** Key 绑定状态：只回掩码与校验时间，明文永不回传。 */
export const communityCredentialStatusSchema = z.object({
  connected: z.boolean(),
  keyMask: z.string(),
  verifiedAt: z.string().nullable(),
  lastError: z.string(),
  /** 引导文案要用的固定事实：Comfy Cloud 的 API 访问需要付费订阅 */
  subscriptionRequired: z.boolean().default(true),
  pricingUrl: z.string().default("https://www.comfy.org/pricing"),
});
export type CommunityCredentialStatus = z.infer<
  typeof communityCredentialStatusSchema
>;

/** 我的发布：草稿箱与已提交条目同列表，前端按 status 分页签。 */
export const communityDraftSchema = z.object({
  id: z.number(),
  code: z.string(),
  title: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  format: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  auditNote: z.string(),
  runCount: z.number(),
  rewarded: z.boolean(),
  updatedAt: z.string(),
});
export type CommunityDraft = z.infer<typeof communityDraftSchema>;

export const COMMUNITY_TITLE_MAX = 200;
export const COMMUNITY_SUMMARY_MAX = 500;
export const COMMUNITY_DESCRIPTION_MAX = 8000;
export const COMMUNITY_TAGS_MAX = 12;

const publishBodySchema = z.object({
  title: z.string().trim().min(1).max(COMMUNITY_TITLE_MAX),
  summary: z.string().trim().max(COMMUNITY_SUMMARY_MAX).default(""),
  description: z.string().max(COMMUNITY_DESCRIPTION_MAX).default(""),
  category: z.enum(COMMUNITY_CATEGORIES).default("image"),
  groupLabel: z.string().trim().max(64).default(""),
  tags: z.array(z.string().trim().min(1).max(30)).max(COMMUNITY_TAGS_MAX).default([]),
  mediaType: z.enum(["image", "video", "audio", "file"]).default("image"),
  /** 工作流 JSON：只接受 API 格式对象（nodes/links 的 UI 格式直接拒） */
  workflowJson: z.record(z.string(), z.unknown()),
  /** 允许用户改的槽位；不传＝纯浏览型，只能按原样运行 */
  slots: z.array(communitySlotSchema).max(40).default([]),
});

export const communityEndpoints = {
  Community_categories: {
    method: "get" as const,
    path: "/enterprise/community/categories",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(communityCategorySchema)),
  },
  Community_list: {
    method: "get" as const,
    path: "/enterprise/community/workflows",
    params: z.object({}),
    query: pageQuerySchema.extend({
      category: z.enum(COMMUNITY_CATEGORIES).optional(),
      group: z.string().max(64).optional(),
      keyword: z.string().max(120).optional(),
      sort: z.enum(COMMUNITY_SORTS).default("recommend"),
      /** 只看可直接运行的（过滤掉浏览型卡片） */
      runnable: z.coerce.boolean().optional(),
      /** 我的收藏（仅对已登录账号有效） */
      favorite: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(communityWorkflowCardSchema)),
  },
  Community_detail: {
    method: "get" as const,
    path: "/enterprise/community/workflows/:code",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityWorkflowDetailSchema),
  },
  Community_favorite: {
    method: "post" as const,
    path: "/enterprise/community/workflows/:code/favorite",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ favorited: z.boolean(), favoriteCount: z.number() }),
    ),
  },
  Community_unfavorite: {
    method: "delete" as const,
    path: "/enterprise/community/workflows/:code/favorite",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ favorited: z.boolean(), favoriteCount: z.number() }),
    ),
  },
  Community_like: {
    method: "post" as const,
    path: "/enterprise/community/workflows/:code/like",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ liked: z.boolean(), likeCount: z.number() }),
    ),
  },
  Community_connectStatus: {
    method: "get" as const,
    path: "/enterprise/community/comfy/status",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityCredentialStatusSchema),
  },
  Community_saveCredential: {
    method: "post" as const,
    path: "/enterprise/community/comfy/credential",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      /** 粘贴进来的 Comfy Cloud API Key：保存即校验，只回掩码 */
      apiKey: z.string().trim().min(8).max(400),
    }),
    response: envelope(communityCredentialStatusSchema),
  },
  Community_testCredential: {
    method: "post" as const,
    path: "/enterprise/community/comfy/credential/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityCredentialStatusSchema),
  },
  Community_clearCredential: {
    method: "delete" as const,
    path: "/enterprise/community/comfy/credential",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityCredentialStatusSchema),
  },
  Community_run: {
    method: "post" as const,
    path: "/enterprise/community/workflows/:code/run",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.object({
      /** 槽位键 → 值；未声明的输入一律用工作流原值，越界键直接拒 */
      inputs: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(communityRunSchema),
  },
  Community_runStatus: {
    method: "get" as const,
    path: "/enterprise/community/runs/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityRunSchema),
  },
  Community_cancelRun: {
    method: "post" as const,
    path: "/enterprise/community/runs/:id/cancel",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityRunSchema),
  },
  Community_myRuns: {
    method: "get" as const,
    path: "/enterprise/community/runs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      workflowCode: z.string().max(64).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(communityRunSchema)),
  },
  Community_myDrafts: {
    method: "get" as const,
    path: "/enterprise/community/drafts",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.enum(COMMUNITY_STATUSES).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(communityDraftSchema)),
  },
  Community_publish: {
    method: "post" as const,
    path: "/enterprise/community/workflows",
    params: z.object({}),
    query: emptyQuery,
    body: publishBodySchema,
    response: envelope(communityDraftSchema),
  },
  Community_updateWorkflow: {
    method: "put" as const,
    path: "/enterprise/community/workflows/:code",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: publishBodySchema.partial(),
    response: envelope(communityDraftSchema),
  },
  Community_unpublish: {
    method: "delete" as const,
    path: "/enterprise/community/workflows/:code",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ status: z.string() })),
  },
};

/**
 * 社区积分规则（平台后台可改，落 point_settings 键值表）：
 * 审核通过可给小额赠分，推荐进市场给主推奖；两个帽子防刷。
 */
export const communityAwardSettingsSchema = z.object({
  /** 审核通过赠分（0 = 关闭） */
  approveReward: z.number().int().min(0).max(10000).default(0),
  /** 推荐进市场奖励（0 = 关闭） */
  recommendReward: z.number().int().min(0).max(100000).default(200),
  /** 单人单日可得社区奖励上限（0 = 不限） */
  perUserDailyCap: z.number().int().min(0).max(1000000).default(1000),
  /** 全站社区奖励日发放预算帽（0 = 不限） */
  siteDailyCap: z.number().int().min(0).max(10000000).default(20000),
});
export type CommunityAwardSettings = z.infer<
  typeof communityAwardSettingsSchema
>;

export const communityAdminEndpoints = {
  CommunityAdmin_pending: {
    method: "get" as const,
    path: "/enterprise/admin/community/workflows",
    params: z.object({}),
    query: pageQuerySchema.extend({
      /** 默认看待审；传 APPROVED/REJECTED/RECOMMENDED/REMOVED 看对应队列 */
      status: z.enum(COMMUNITY_STATUSES).default("PENDING"),
      keyword: z.string().max(120).optional(),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(
        communityWorkflowCardSchema.extend({
          ownerUserId: z.string(),
          slots: z.array(communitySlotSchema),
          submittedAt: z.string(),
        }),
      ),
    ),
  },
  CommunityAdmin_decide: {
    method: "post" as const,
    path: "/enterprise/admin/community/workflows/:code/decide",
    params: z.object({ code: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.object({
      action: z.enum(["approve", "reject", "recommend", "remove"]),
      /** 驳回理由 / 备注：只回给作者与管理员 */
      note: z.string().trim().max(500).default(""),
    }),
    response: envelope(
      z.object({
        status: z.string(),
        statusLabel: z.string(),
        /** 本次是否真的发了奖（幂等重推为 false） */
        rewarded: z.boolean(),
        rewardPoints: z.number(),
      }),
    ),
  },
  CommunityAdmin_stats: {
    method: "get" as const,
    path: "/enterprise/admin/community/stats",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        pending: z.number(),
        approved: z.number(),
        recommended: z.number(),
        rejected: z.number(),
        removed: z.number(),
        official: z.number(),
        user: z.number(),
        runsToday: z.number(),
        rewardPointsToday: z.number(),
        keyBoundUsers: z.number(),
      }),
    ),
  },
  CommunityAdmin_settings: {
    method: "get" as const,
    path: "/enterprise/admin/community/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(communityAwardSettingsSchema),
  },
  CommunityAdmin_saveSettings: {
    method: "put" as const,
    path: "/enterprise/admin/community/settings",
    params: z.object({}),
    query: emptyQuery,
    body: communityAwardSettingsSchema,
    response: envelope(communityAwardSettingsSchema),
  },
  /**
   * 迁移预览：先用这把 Key 真打一次上游（验 Key），再清点「已保存工作流 / 历史任务 / 预期媒体」的数量。
   * 不写库、不下载媒体——媒体体量大，必须等管理员确认后再落存储渠道。
   */
  CommunityAdmin_importPreview: {
    method: "post" as const,
    path: "/enterprise/admin/community/import/preview",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      apiKey: z.string().trim().min(8).max(500),
    }),
    response: envelope(
      z.object({
        /** 验 Key 是否通过（通过才会去清点） */
        verified: z.boolean(),
        /** 已保存工作流文件数（`/api/userdata?dir=workflows/`） */
        workflows: z.number(),
        /** 可迁移的历史任务数（上游 completed 状态） */
        jobs: z.number(),
        /** 预期媒体文件数（各任务 outputs_count 汇总） */
        media: z.number(),
      }),
    ),
  },
  /**
   * 开始同步迁移：验 Key + 验存储渠道通过后开一个进程内任务，立刻返回 taskId，
   * 工作流 JSON 与图片/视频在后台逐条转存进后台设定好的存储渠道。
   */
  CommunityAdmin_importStart: {
    method: "post" as const,
    path: "/enterprise/admin/community/import",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      apiKey: z.string().trim().min(8).max(500),
      /** 是否迁移已保存的工作流文件 */
      includeWorkflows: z.boolean().default(true),
      /** 是否迁移历史任务的执行图与产物 */
      includeJobs: z.boolean().default(true),
      /** 历史任务最多迁移多少个（按创建时间倒序） */
      limit: z.number().int().min(1).max(100).default(20),
    }),
    response: envelope(
      z.object({
        taskId: z.string(),
        /** 本次任务要处理的条目总数（工作流文件 + 历史任务） */
        total: z.number(),
      }),
    ),
  },
  /** 迁移进度：前端按秒轮询；进程内任务，进程重启后回到 idle。 */
  CommunityAdmin_importStatus: {
    method: "get" as const,
    path: "/enterprise/admin/community/import/status",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        taskId: z.string(),
        state: z.enum(["idle", "running", "done", "failed"]),
        total: z.number(),
        done: z.number(),
        /** 成功入库的工作流条数 */
        importedWorkflows: z.number(),
        /** 成功转存进本站存储渠道的媒体个数 */
        importedMedia: z.number(),
        /** 跳过的条目（重复迁移或格式不合规） */
        skipped: z.number(),
        failed: z.number(),
        /** 最近一条失败/总结文案 */
        message: z.string(),
        startedAt: z.string(),
        finishedAt: z.string(),
      }),
    ),
  },
};
