import { z } from "zod";
import { ACQ_PLATFORMS } from "./acquisition";
import { DISTRIBUTION_PLATFORMS } from "./distribution";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 平台统一浏览器插件（AIPDD Enterprise）的能力目录（设计方案 §10.7）。
 *
 * 能力定义写在契约层：插件每个能力模块、服务端派发门槛、前端入口与 MCP 都读同一份，
 * 避免「分发」「获客」各自维护一套能力清单。平台可运营的覆盖值（启用/灰度/强制升级）
 * 落在 extension_capabilities 表，由 ExtensionCatalogService 与本定义合并后对外。
 */

/* ---------------------------------------------------------------- 能力标识与状态 */

export const EXTENSION_CAPABILITY_KEYS = ["distribution", "acquisition", "chrome"] as const;
export type ExtensionCapabilityKey = (typeof EXTENSION_CAPABILITY_KEYS)[number];

/**
 * 浏览器代理（Agent 控制浏览器）能力所需的最低插件版本。
 * 与 EXTENSION_RELEASE.minVersion 同口径；本方案沿用 1.4.0，不升版本号。
 */
export const BROWSER_AGENT_MIN_VERSION = "1.4.0";

/** ACTIVE＝正常派发；GRAY＝灰度（仅命中 grayOrgIds 的机构派发）；DEPRECATED＝停止派发、仅留入口；RETIRED＝下线。 */
export const EXTENSION_CAPABILITY_STATUSES = [
  "ACTIVE",
  "GRAY",
  "DEPRECATED",
  "RETIRED",
] as const;
export type ExtensionCapabilityStatus =
  (typeof EXTENSION_CAPABILITY_STATUSES)[number];
export const EXTENSION_CAPABILITY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "已启用",
  GRAY: "灰度中",
  DEPRECATED: "已停止派发",
  RETIRED: "已下线",
};

/** 完成判定与证据种类：URL＝结果链接，SCREENSHOT＝页面截图，TEXT＝文本回执，METRIC＝效果指标。 */
export const EXTENSION_EVIDENCE_KINDS = [
  "URL",
  "SCREENSHOT",
  "TEXT",
  "METRIC",
] as const;
export type ExtensionEvidenceKind = (typeof EXTENSION_EVIDENCE_KINDS)[number];
export const EXTENSION_EVIDENCE_LABELS: Record<string, string> = {
  URL: "结果链接",
  SCREENSHOT: "页面截图",
  TEXT: "文本回执",
  METRIC: "效果指标",
};

/* ---------------------------------------------------------------- 站点权限推导 */

/** 从完整 URL 折出 origin 匹配模式：`https://weibo.com/` → `https://weibo.com/*`。 */
const originOf = (url: string) =>
  url.replace(/^(https?:\/\/[^/]+).*$/i, "$1/*");

const DISTRIBUTION_ORIGINS: string[] = Array.from(
  new Set(DISTRIBUTION_PLATFORMS.map((platform) => originOf(platform.homepage))),
);

/** 获客采集/触达落到的公开站点（与插件 collector/outreach 支持平台对齐）。 */
const ACQUISITION_ORIGINS = [
  "https://www.xiaohongshu.com/*",
  "https://www.douyin.com/*",
  "https://www.zhihu.com/*",
  "https://weibo.com/*",
  "https://www.bilibili.com/*",
  "https://channels.weixin.qq.com/*",
  "https://mp.weixin.qq.com/*",
  "https://www.tiktok.com/*",
  "https://x.com/*",
  "https://www.kuaishou.com/*",
];

/* ---------------------------------------------------------------- 能力定义 */

export type ExtensionCapabilityAction = {
  key: string;
  label: string;
  /** 该动作是否必须经人工确认后才执行（§10.7「是否需要人工确认」）。 */
  requiresConfirmation: boolean;
  /** 输入字段（按键名描述类型与必填）：服务端派发与页面组包共用同一份。 */
  input: Record<string, { type: string; required: boolean; note: string }>;
  /** 回执逐条结果字段（插件按此回填，页面按此落库）。 */
  output: Record<string, { type: string; note: string }>;
};

export type ExtensionCapabilityDef = {
  key: ExtensionCapabilityKey;
  label: string;
  description: string;
  /** 业务入口页路径。 */
  entry: string;
  /** 最低插件版本（semver）：低于它一律不派发该能力任务。 */
  minVersion: string;
  /** 适用业务模块。 */
  businessModules: string[];
  /** 支持平台（distribution 平台 code / ACQ_PLATFORMS）。 */
  platforms: string[];
  /** 动作清单与输入输出结构（动作 key 即协议里的 action）。 */
  actions: ExtensionCapabilityAction[];
  /** 能力覆盖的站点（origin 匹配模式）；用于把内容脚本限定登记到这些平台页。 */
  sitePermissions: string[];
  /** 能力整体是否需要人工确认。 */
  requiresConfirmation: boolean;
  /** 完成判定与证据要求。 */
  completionEvidence: ExtensionEvidenceKind[];
  /** 失败重试与取消规则。 */
  retryRule: string;
  /** 数据最小化要求。 */
  dataMinimization: string;
  /** 出厂默认状态（可被平台在后台覆盖）。 */
  status: ExtensionCapabilityStatus;
};

export const EXTENSION_CAPABILITIES: readonly ExtensionCapabilityDef[] = [
  {
    key: "distribution",
    label: "多平台内容分发",
    description:
      "把营销工具里的内容自动填充到微博、小红书、抖音等平台的创作页；可只填不发布，由你人工确认。",
    entry: "/marketing-tools/distribution",
    minVersion: "1.2.0",
    businessModules: ["营销工具"],
    platforms: DISTRIBUTION_PLATFORMS.map((platform) => platform.code),
    actions: [
      {
        key: "fill",
        label: "填充到创作页",
        requiresConfirmation: false,
        input: {
          contentId: { type: "number", required: true, note: "分发台账内容 ID" },
          title: { type: "string", required: true, note: "标题（缺省取台账）" },
          content: { type: "string", required: true, note: "正文" },
          images: {
            type: "string[]",
            required: false,
            note: "图片地址，后台转 dataURL 后填入",
          },
        },
        output: {
          platformCode: { type: "string", note: "平台编码" },
          status: { type: "string", note: "FILLED / SUBMITTED / VERIFIED / FAILED" },
          publishedUrl: { type: "string", note: "作品链接（已发布时）" },
          errorMsg: { type: "string", note: "失败原因" },
        },
      },
      {
        key: "publish",
        label: "自动发布",
        requiresConfirmation: true,
        input: {
          contentId: { type: "number", required: true, note: "分发台账内容 ID" },
          title: { type: "string", required: true, note: "标题" },
          content: { type: "string", required: true, note: "正文" },
          images: { type: "string[]", required: false, note: "图片地址" },
        },
        output: {
          platformCode: { type: "string", note: "平台编码" },
          status: { type: "string", note: "SUBMITTED / VERIFIED / FAILED" },
          publishedUrl: { type: "string", note: "作品链接" },
          errorMsg: { type: "string", note: "失败原因" },
        },
      },
      {
        key: "metrics",
        label: "回读效果数据",
        requiresConfirmation: false,
        input: {
          contentId: { type: "number", required: true, note: "分发台账内容 ID" },
          items: {
            type: "object[]",
            required: true,
            note: "逐平台已发布作品：platformCode / publishedUrl / publishedItemId",
          },
        },
        output: {
          platformCode: { type: "string", note: "平台编码" },
          views: { type: "number", note: "阅读" },
          likes: { type: "number", note: "点赞" },
          comments: { type: "number", note: "评论" },
          errorMsg: { type: "string", note: "失败原因" },
        },
      },
    ],
    sitePermissions: DISTRIBUTION_ORIGINS,
    requiresConfirmation: true,
    completionEvidence: ["URL", "TEXT", "METRIC"],
    retryRule:
      "失败保留标签页人工接手；结果未知不自动重试；同内容同平台按 code 幂等回写，不重复入库。",
    dataMinimization:
      "只上传你在工具页勾选的内容与图片，不读取浏览器 Cookie、不采集创作页之外的数据。",
    status: "ACTIVE",
  },
  {
    key: "acquisition",
    label: "AI 获客采集与触达",
    description:
      "在平台公开搜索页、详情页与评论区采集线索并回传；触达只执行服务端审核通过且你确认过的那一条。",
    entry: "/marketing-tools/acquisition",
    minVersion: "1.3.0",
    businessModules: ["营销工具"],
    platforms: [...ACQ_PLATFORMS],
    actions: [
      {
        key: "collect",
        label: "采集线索",
        requiresConfirmation: false,
        input: {
          type: { type: "string", required: true, note: "固定 collect" },
          // 令牌由页面签发后直传插件，服务端台账不留该密钥，故这里不作必填约束。
          token: { type: "string", required: false, note: "插件执行令牌（5 分钟有效，由页面直传插件）" },
        },
        output: {
          runId: { type: "number", note: "采集批次 ID" },
          jobId: { type: "string", note: "批次幂等锚" },
          items: { type: "object[]", note: "本轮采集线索" },
          newLeads: { type: "number", note: "新增线索数" },
        },
      },
      {
        key: "outreach",
        label: "发送触达",
        requiresConfirmation: true,
        input: {
          type: { type: "string", required: true, note: "固定 outreach" },
          // 同 collect：令牌走页面直传插件，不落服务端台账。
          token: { type: "string", required: false, note: "插件执行令牌（由页面直传插件）" },
        },
        output: {
          outreachId: { type: "number", note: "触达任务 ID" },
          status: { type: "string", note: "SENT / FAILED / UNKNOWN" },
          receipt: { type: "string", note: "回执口径" },
          receiptRef: { type: "string", note: "回执凭据" },
        },
      },
      {
        key: "metrics",
        label: "回读效果数据",
        requiresConfirmation: false,
        input: {
          contentId: { type: "number", required: true, note: "分发台账内容 ID" },
          items: { type: "object[]", required: true, note: "逐平台已发布作品" },
        },
        output: {
          platformCode: { type: "string", note: "平台编码" },
          views: { type: "number", note: "阅读" },
          likes: { type: "number", note: "点赞" },
          comments: { type: "number", note: "评论" },
        },
      },
    ],
    sitePermissions: ACQUISITION_ORIGINS,
    requiresConfirmation: true,
    completionEvidence: ["URL", "TEXT", "SCREENSHOT"],
    retryRule:
      "私信首条始终人工确认；遇 NEED_LOGIN / CAPTCHA / RISK_CONTROL 立即停止并回报，不自动重试；按 runId + platformUserId 幂等。",
    dataMinimization:
      "只采集公开可见字段与页面肉眼可见的联系方式，逐条带可见性标注与证据链；不读取 Cookie、不抓取私密内容。",
    status: "ACTIVE",
  },
  {
    key: "chrome",
    label: "浏览器代理（Agent 控制浏览器）",
    description:
      "在本机 Chrome 里由 Agent 自主规划并逐步操作：Act 操作页面、Crawl 遍历抓取、Extract 抽取结构化结果；模型与平台工具都走本系统网关。",
    entry: "/rpa?tab=status",
    minVersion: BROWSER_AGENT_MIN_VERSION,
    businessModules: ["RPA 自动化"],
    // 站点不定：代理默认可接管任意普通网页（manifest 申请 <all_urls>），无需逐站点授权。
    platforms: [],
    actions: [
      {
        key: "act",
        label: "操作页面（Act）",
        requiresConfirmation: true,
        input: {
          goal: { type: "string", required: true, note: "自然语言目标" },
          startUrl: { type: "string", required: false, note: "起始地址" },
          maxSteps: { type: "number", required: false, note: "最大步数" },
          modelKey: { type: "string", required: false, note: "决策模型（缺省＝本账号默认文本模型）" },
        },
        output: {
          sessionId: { type: "number", note: "浏览器代理会话号" },
          status: { type: "string", note: "COMPLETED / FAILED / CANCELLED / TIMEOUT" },
          stepCount: { type: "number", note: "实际步数" },
          summary: { type: "string", note: "结果摘要" },
        },
      },
      {
        key: "crawl",
        label: "遍历抓取（Crawl）",
        requiresConfirmation: false,
        input: {
          goal: { type: "string", required: true, note: "抓取目标描述（抓什么、抓多少）" },
          startUrl: { type: "string", required: true, note: "列表/起始地址" },
          limit: { type: "number", required: false, note: "最多抓取条数" },
        },
        output: {
          sessionId: { type: "number", note: "浏览器代理会话号" },
          items: { type: "object[]", note: "逐条抓取结果" },
          truncated: { type: "boolean", note: "是否因上限截断" },
        },
      },
      {
        key: "extract",
        label: "抽取结构化结果（Extract）",
        requiresConfirmation: false,
        input: {
          schemaNote: { type: "string", required: true, note: "期望字段说明（自然语言或字段名清单）" },
          url: { type: "string", required: false, note: "目标页面（缺省＝当前活动页）" },
        },
        output: {
          data: { type: "object", note: "结构化结果" },
          screenshot: { type: "string", note: "证据截图 key" },
        },
      },
    ],
    sitePermissions: [],
    requiresConfirmation: true,
    completionEvidence: ["URL", "SCREENSHOT", "TEXT"],
    retryRule:
      "敏感动作先人工确认；遇 NEED_LOGIN / CAPTCHA / RISK_CONTROL 立即停止并回报，不自动重试；单会话受最大步数/总时长约束。",
    dataMinimization:
      "只回「可见交互元素清单 + 截断正文 + 少量截图」；不读 Cookie、不抓目标平台口令、不调用平台私有接口。",
    status: "ACTIVE",
  },
];

export function extensionCapabilityDefOf(
  key: string,
): ExtensionCapabilityDef | undefined {
  return EXTENSION_CAPABILITIES.find((item) => item.key === key);
}

/* ---------------------------------------------------------------- 对外视图契约 */

/** 插件发布信息（服务端由 EXTENSION_RELEASE 填充）：入口、下载、安装说明与更新记录同源。 */
export const extensionReleaseSchema = z.object({
  name: z.string(),
  version: z.string(),
  /** 低于该版本的插件不再派发需要新版协议的任务。 */
  minVersion: z.string(),
  downloadPath: z.string(),
  chromeStoreUrl: z.string(),
  edgeStoreUrl: z.string(),
  checksum: z.string(),
  browsers: z.array(z.string()),
  homepage: z.string(),
  installSteps: z.array(z.string()),
  usage: z.array(z.string()),
  changelog: z.array(
    z.object({
      version: z.string(),
      date: z.string(),
      notes: z.array(z.string()),
    }),
  ),
  /** 平台是否真的发布了可下载的插件包。 */
  published: z.boolean(),
});

/** 能力目录条目 = 能力定义 + 平台覆盖状态（合并后的对外口径）。 */
export const extensionCapabilitySchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  entry: z.string(),
  /** 生效最低版本：平台覆盖值优先，空则用定义默认。 */
  minVersion: z.string(),
  /** 生效状态：平台覆盖值优先，空则用定义默认。 */
  status: z.string(),
  statusLabel: z.string(),
  businessModules: z.array(z.string()),
  platforms: z.array(z.string()),
  actions: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      requiresConfirmation: z.boolean(),
      /** 动作输入字段：服务端派发校验、页面组包与文档展示同源。 */
      input: z.record(z.string(), z.object({
        type: z.string(),
        required: z.boolean(),
        note: z.string(),
      })).default({}),
      /** 动作回执逐条结果字段：插件按此回填，页面按此落库。 */
      output: z.record(z.string(), z.object({
        type: z.string(),
        note: z.string(),
      })).default({}),
    }),
  ),
  sitePermissions: z.array(z.string()),
  requiresConfirmation: z.boolean(),
  completionEvidence: z.array(z.string()),
  retryRule: z.string(),
  dataMinimization: z.string(),
  /** 平台覆盖：灰度机构 userId 列表。 */
  grayOrgIds: z.array(z.string()),
  /** 平台覆盖：强制升级时间（ISO）；到点后低于生效版本的插件一律拒绝派发。 */
  forceUpgradeAt: z.string().nullable(),
  note: z.string(),
});
export type ExtensionCapabilityView = z.infer<
  typeof extensionCapabilitySchema
>;

export const extensionCatalogSchema = z.object({
  release: extensionReleaseSchema,
  capabilities: z.array(extensionCapabilitySchema),
});
export type ExtensionCatalog = z.infer<typeof extensionCatalogSchema>;

/** 平台维护能力状态（§10.7 灰度 / 强制升级 / 下线）。 */
export const extensionCapabilitySaveBodySchema = z.object({
  status: z.enum(EXTENSION_CAPABILITY_STATUSES).optional(),
  minVersion: z.string().max(20).optional(),
  grayOrgIds: z.array(z.string().max(64)).max(200).optional(),
  forceUpgradeAt: z.string().max(40).nullable().optional(),
  note: z.string().max(300).optional(),
});
export type ExtensionCapabilitySaveBody = z.infer<
  typeof extensionCapabilitySaveBodySchema
>;

/* ---------------------------------------------------------------- endpoints */

export const extensionEndpoints = {
  /** 统一能力目录 + 插件发布信息：前端入口、工具页与 MCP 读同一份。 */
  Extension_catalog: {
    method: "get" as const,
    path: "/enterprise/extension/catalog",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(extensionCatalogSchema),
  },
  /** 平台维护单个能力的启用/灰度/强制升级（平台管理员）。 */
  Extension_capabilitySave: {
    method: "put" as const,
    path: "/enterprise/extension/capabilities/:key",
    params: z.object({ key: z.string().min(1).max(32) }),
    query: emptyQuery,
    body: extensionCapabilitySaveBodySchema,
    response: envelope(extensionCapabilitySchema),
  },
};
