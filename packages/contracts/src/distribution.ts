import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 多平台内容分发（营销工具）：内容台账在服务器落库，实际发布由 AIPDD Enterprise
 * 浏览器插件在本地完成（复用浏览器已登录的媒体平台会话，账号凭据不出本机）。
 * 平台注册表在这里统一维护：前端勾选清单、后端 meta 接口与 MCP 工具读同一份；
 * 插件（extensions/aipdd-enterprise）内置镜像的 code/type，两边按 code 对齐。
 */

export const DISTRIBUTION_MEDIA_TYPES = ["MOMENT", "ARTICLE"] as const;
export type DistributionMediaType =
  (typeof DISTRIBUTION_MEDIA_TYPES)[number];
export const DISTRIBUTION_MEDIA_TYPE_LABELS: Record<string, string> = {
  MOMENT: "动态/图文",
  ARTICLE: "文章",
};

/** 发布结果状态：FILLED＝已填好待确认，SUCCESS＝插件点了发布，FAILED＝填充或脚本失败。 */
export const DISTRIBUTION_LOG_STATUSES = ["FILLED", "SUCCESS", "FAILED"] as const;
export type DistributionLogStatus =
  (typeof DISTRIBUTION_LOG_STATUSES)[number];
export const DISTRIBUTION_LOG_STATUS_LABELS: Record<string, string> = {
  FILLED: "已填充待确认",
  SUCCESS: "已发布",
  FAILED: "失败",
};

/** 内容状态：DRAFT＝未推送，DISTRIBUTED＝至少向插件推送过一次。 */
export const DISTRIBUTION_CONTENT_STATUSES = ["DRAFT", "DISTRIBUTED"] as const;
export const DISTRIBUTION_CONTENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "未分发",
  DISTRIBUTED: "已分发",
};

export type DistributionPlatform = {
  code: string;
  name: string;
  mediaType: DistributionMediaType;
  /** 平台创作/发布页，插件打这个页做填充 */
  publishUrl: string;
  homepage: string;
};

/**
 * 支持的发布平台（与插件 extensions/aipdd-enterprise/background.js PUBLISH_TARGETS 一一对应）。
 * 对齐 PostBot 参考口径的国内图文/文章渠道：音频（播客）与视频类因台账只存
 * 文本+图片暂不纳入，QQ 企鹅号已停服。发布器依赖各平台创作页 DOM，改版时优先更新插件，其次这里补新平台。
 * 公众号/视频号/快手/知识星球的编辑器入口带动态参数，属「半自动」：插件打开创作页尽力填充，失败时保留标签页人工接手。
 */
export const DISTRIBUTION_PLATFORMS: readonly DistributionPlatform[] = [
  {
    code: "weibo",
    name: "微博",
    mediaType: "MOMENT",
    publishUrl: "https://weibo.com/",
    homepage: "https://weibo.com/",
  },
  {
    code: "xiaohongshu",
    name: "小红书",
    mediaType: "MOMENT",
    publishUrl: "https://creator.xiaohongshu.com/publish/publish",
    homepage: "https://creator.xiaohongshu.com/",
  },
  {
    code: "douyin",
    name: "抖音",
    mediaType: "MOMENT",
    publishUrl: "https://creator.douyin.com/creator-micro/content/upload",
    homepage: "https://creator.douyin.com/",
  },
  {
    code: "zhihu",
    name: "知乎",
    mediaType: "ARTICLE",
    publishUrl: "https://zhuanlan.zhihu.com/write",
    homepage: "https://www.zhihu.com/",
  },
  {
    code: "toutiao",
    name: "今日头条",
    mediaType: "ARTICLE",
    publishUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    homepage: "https://mp.toutiao.com/",
  },
  {
    code: "kuaishou",
    name: "快手",
    mediaType: "MOMENT",
    publishUrl: "https://cp.kuaishou.com/",
    homepage: "https://cp.kuaishou.com/",
  },
  {
    code: "weixin_channels",
    name: "微信视频号",
    mediaType: "MOMENT",
    publishUrl: "https://channels.weixin.qq.com/platform/post/create",
    homepage: "https://channels.weixin.qq.com/platform",
  },
  {
    code: "zsxq",
    name: "知识星球",
    mediaType: "MOMENT",
    publishUrl: "https://wx.zsxq.com/",
    homepage: "https://wx.zsxq.com/",
  },
  {
    code: "weixin",
    name: "微信公众号",
    mediaType: "ARTICLE",
    publishUrl: "https://mp.weixin.qq.com/",
    homepage: "https://mp.weixin.qq.com/",
  },
  {
    code: "baijiahao",
    name: "百家号",
    mediaType: "ARTICLE",
    publishUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    homepage: "https://baijiahao.baidu.com/",
  },
  {
    code: "bilibili",
    name: "B站专栏",
    mediaType: "ARTICLE",
    publishUrl: "https://member.bilibili.com/article-text/home?newArticle=true",
    homepage: "https://member.bilibili.com/",
  },
  {
    code: "jianshu",
    name: "简书",
    mediaType: "ARTICLE",
    publishUrl: "https://www.jianshu.com/writer",
    homepage: "https://www.jianshu.com/",
  },
  {
    code: "douban",
    name: "豆瓣笔记",
    mediaType: "ARTICLE",
    publishUrl: "https://www.douban.com/note/create",
    homepage: "https://www.douban.com/",
  },
];

/** 按内容类型给前端/插件出可用平台清单。 */
export function distributionPlatformsOf(mediaType: string) {
  return DISTRIBUTION_PLATFORMS.filter(
    (platform) => platform.mediaType === mediaType,
  );
}

export const distributionPlatformSchema = z.object({
  code: z.string(),
  name: z.string(),
  mediaType: z.string(),
  mediaTypeLabel: z.string(),
  publishUrl: z.string(),
  homepage: z.string(),
});
export type DistributionPlatformView = z.infer<
  typeof distributionPlatformSchema
>;

export const distributionImageSchema = z.object({
  name: z.string(),
  url: z.string(),
});
export type DistributionImage = z.infer<typeof distributionImageSchema>;

export const distributionContentSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string(),
  mediaType: z.string(),
  mediaTypeLabel: z.string(),
  images: z.array(distributionImageSchema),
  platformCodes: z.array(z.string()),
  platformNames: z.array(z.string()),
  autoPublish: z.boolean(),
  status: z.string(),
  statusLabel: z.string(),
  tags: z.string(),
  lastDistributedAt: z.string().nullable(),
  /** 内容资产统计（D8 效果回流聚合）：各平台效果之和，未回写时为 0。 */
  totalViews: z.number(),
  totalLikes: z.number(),
  totalComments: z.number(),
  /** 最近一次效果回写时间（ISO）；从未回写时为 null。 */
  lastMetricsAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DistributionContent = z.infer<typeof distributionContentSchema>;

/** 效果数据来源：EXTENSION＝插件从平台创作中心读取，MANUAL＝人工补录。 */
export const DISTRIBUTION_METRIC_SOURCES = ["EXTENSION", "MANUAL"] as const;
export type DistributionMetricSource =
  (typeof DISTRIBUTION_METRIC_SOURCES)[number];

/** 计数上限：MySQL INT 上限，插件 `countOf` 已把「1.2万/亿」折成整数，越界一律截顶。 */
export const DISTRIBUTION_METRIC_MAX = 2_000_000_000;

export const distributionLogSchema = z.object({
  id: z.number(),
  contentId: z.number(),
  platformCode: z.string(),
  platformName: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  publishedUrl: z.string(),
  errorMsg: z.string(),
  source: z.string(),
  /** 平台侧作品标识：从创作中心读效果时用它对齐「哪一条内容」，重复回写按内容+平台覆盖。 */
  publishedItemId: z.string(),
  /** 效果数据（D8）：阅读/播放量、点赞、评论；未回写时为 0。 */
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  /** 效果数据来源：EXTENSION（插件读创作中心） | MANUAL | ""（尚未回写）。 */
  metricsSource: z.string(),
  /** 效果数据的抓取时间（ISO）；未回写时为 null。 */
  metricsCapturedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DistributionLog = z.infer<typeof distributionLogSchema>;

export const distributionDetailSchema = z.object({
  content: distributionContentSchema,
  logs: z.array(distributionLogSchema),
});
export type DistributionDetail = z.infer<typeof distributionDetailSchema>;

/** meta：平台清单 + 插件发布信息（下载路径/版本），供工具页与 MCP 客户端读取。 */
export const distributionMetaSchema = z.object({
  platforms: z.array(distributionPlatformSchema),
  extension: z.object({
    name: z.string(),
    version: z.string(),
    /** 相对站点根目录的下载路径（前端 public 静态分发） */
    downloadPath: z.string(),
    chromeStoreUrl: z.string(),
  }),
});
export type DistributionMeta = z.infer<typeof distributionMetaSchema>;

export const DISTRIBUTION_TITLE_MAX = 200;
/**
 * 正文上限：存的是「受约束的 HTML」（见 rich-text.ts），样式标记会占额度，
 * 所以原始串长度放到 5 万；可见字数（用户真正写进去的字）另按 2 万在服务层卡。
 */
export const DISTRIBUTION_CONTENT_MAX = 50000;
export const DISTRIBUTION_CONTENT_VISIBLE_MAX = 20000;
export const DISTRIBUTION_IMAGES_MAX = 18;

export const distributionEndpoints = {
  Distribution_meta: {
    method: "get" as const,
    path: "/enterprise/distribution/meta",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(distributionMetaSchema),
  },
  Distribution_page: {
    method: "get" as const,
    path: "/enterprise/distribution/contents",
    params: z.object({}),
    query: pageQuerySchema.extend({
      mediaType: z.enum(DISTRIBUTION_MEDIA_TYPES).optional(),
      status: z.enum(DISTRIBUTION_CONTENT_STATUSES).optional(),
      keyword: z.string().max(120).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(distributionContentSchema)),
  },
  Distribution_create: {
    method: "post" as const,
    path: "/enterprise/distribution/contents",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      title: z.string().min(1).max(DISTRIBUTION_TITLE_MAX),
      /** 富文本正文（受限 HTML）；旧调用方传纯文本同样接受，落库前统一清洗。 */
      content: z
        .string()
        .min(1)
        .max(DISTRIBUTION_CONTENT_MAX)
        .describe("富文本正文：受限 HTML（纯文本亦可）"),
      mediaType: z.enum(DISTRIBUTION_MEDIA_TYPES).default("MOMENT"),
      images: z
        .array(
          z.object({
            name: z.string().max(200).default(""),
            url: z.string().min(1).max(2000),
          }),
        )
        .max(DISTRIBUTION_IMAGES_MAX)
        .default([]),
      platformCodes: z.array(z.string().min(1).max(32)).max(20).default([]),
      autoPublish: z.boolean().default(false),
      tags: z.string().max(200).default(""),
    }),
    response: envelope(distributionContentSchema),
  },
  Distribution_update: {
    method: "put" as const,
    path: "/enterprise/distribution/contents/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({
      title: z.string().min(1).max(DISTRIBUTION_TITLE_MAX).optional(),
      content: z.string().min(1).max(DISTRIBUTION_CONTENT_MAX).optional(),
      mediaType: z.enum(DISTRIBUTION_MEDIA_TYPES).optional(),
      images: z
        .array(
          z.object({
            name: z.string().max(200).default(""),
            url: z.string().min(1).max(2000),
          }),
        )
        .max(DISTRIBUTION_IMAGES_MAX)
        .optional(),
      platformCodes: z.array(z.string().min(1).max(32)).max(20).optional(),
      autoPublish: z.boolean().optional(),
      tags: z.string().max(200).optional(),
    }),
    response: envelope(distributionContentSchema),
  },
  Distribution_remove: {
    method: "delete" as const,
    path: "/enterprise/distribution/contents/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Distribution_detail: {
    method: "get" as const,
    path: "/enterprise/distribution/contents/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(distributionDetailSchema),
  },
  /** 页面把内容推给插件后调用（状态置为已分发并留推送时间；插件结果走 reportLogs）。 */
  Distribution_mark: {
    method: "post" as const,
    path: "/enterprise/distribution/contents/:id/mark",
    params: z.object({ id: z.string().min(1) }),
    /** 页面检测到的插件版本（可选）：低于能力最低版本时服务端拒绝派发并提示升级。 */
    query: z.object({ pluginVersion: z.string().max(20).optional() }),
    body: z.undefined(),
    response: envelope(distributionContentSchema),
  },
  /** 回写逐平台发布结果：页面收到插件回调后上报，也允许人工补记（MCP 通道同样可调）。 */
  Distribution_reportLogs: {
    method: "post" as const,
    path: "/enterprise/distribution/contents/:id/logs",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({
      source: z.enum(["EXTENSION", "MANUAL"]).default("EXTENSION"),
      logs: z
        .array(
          z.object({
            platformCode: z.string().min(1).max(32),
            status: z.enum(DISTRIBUTION_LOG_STATUSES),
            publishedUrl: z.string().max(500).default(""),
            errorMsg: z.string().max(500).default(""),
          }),
        )
        .min(1)
        .max(20),
    }),
    response: envelope(z.array(distributionLogSchema)),
  },
  /**
   * 分发效果回流（D8）：插件从平台创作中心读阅读/点赞/评论后回写，
   * 也可人工补录。同一内容同一平台覆盖写；服务端按内容+平台定位行，
   * publishedItemId 记录平台作品标识，重复上报天然幂等。
   */
  Distribution_reportMetrics: {
    method: "post" as const,
    path: "/enterprise/distribution/contents/:id/metrics",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({
      source: z.enum(DISTRIBUTION_METRIC_SOURCES).default("EXTENSION"),
      metrics: z
        .array(
          z.object({
            platformCode: z.string().min(1).max(32),
            /** 平台侧作品标识（如微博 mid、B 站 bvid），用于对齐是哪一条内容。 */
            publishedItemId: z.string().max(120).default(""),
            views: z.number().int().min(0).max(DISTRIBUTION_METRIC_MAX).default(0),
            likes: z.number().int().min(0).max(DISTRIBUTION_METRIC_MAX).default(0),
            comments: z
              .number()
              .int()
              .min(0)
              .max(DISTRIBUTION_METRIC_MAX)
              .default(0),
            /** 抓取时间（ISO）；缺省或非法时服务端按当前时间落库。 */
            capturedAt: z.string().max(40).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    response: envelope(z.array(distributionLogSchema)),
  },
};
