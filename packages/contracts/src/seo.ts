import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const okResult = z.object({ ok: z.boolean(), message: z.string() });

/** SEO 工作台：传统搜索引擎侧（体检/关键词/排名/竞品/外链/本地/结构化/收录/程序化/报告）。
 *  三层数据源：自有抓取免费 + DataForSEO 用户自带 Key + 系统 LLM 计积分；无 Key 不造假数据。 */

export const SEO_AUDIT_STATUSES = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;
export const SEO_AUDIT_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  DONE: "已完成",
  FAILED: "失败",
};
export const SEO_SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;
export const SEO_SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "严重",
  WARNING: "警告",
  INFO: "提示",
};
export const SEO_FETCH_STATUSES = ["OK", "BLOCKED", "TIMEOUT", "NON_HTML", "ERROR"] as const;
export const SEO_FETCH_STATUS_LABELS: Record<string, string> = {
  OK: "成功",
  BLOCKED: "被拒绝",
  TIMEOUT: "超时",
  NON_HTML: "非页面",
  ERROR: "错误",
};
export const SEO_DEVICES = ["MOBILE", "DESKTOP"] as const;
export const SEO_DEVICE_LABELS: Record<string, string> = {
  MOBILE: "移动端",
  DESKTOP: "桌面端",
};
export const SEO_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export const SEO_FREQUENCY_LABELS: Record<string, string> = {
  DAILY: "每日",
  WEEKLY: "每周",
  MONTHLY: "每月",
};
export const SEO_KEYWORD_SOURCES = ["DATAFORSEO", "AI", "GSC"] as const;
export const SEO_KEYWORD_SOURCE_LABELS: Record<string, string> = {
  DATAFORSEO: "数据源实测",
  AI: "AI 估计",
  GSC: "GSC 导入",
};
export const SEO_KEY_PAGE_ROLES = ["HUB", "CONTENT", "MONEY", "OTHER"] as const;
export const SEO_KEY_PAGE_ROLE_LABELS: Record<string, string> = {
  HUB: "枢纽页",
  CONTENT: "内容页",
  MONEY: "转化页",
  OTHER: "其他",
};
export const SEO_PROSPECT_STATUSES = [
  "NEW",
  "QUALIFIED",
  "DRAFTED",
  "SENT",
  "REPLIED",
  "WON",
  "IGNORED",
] as const;
export const SEO_PROSPECT_STATUS_LABELS: Record<string, string> = {
  NEW: "待筛选",
  QUALIFIED: "待联系",
  DRAFTED: "已生成草稿",
  SENT: "已发送",
  REPLIED: "已回复",
  WON: "已获链",
  IGNORED: "忽略",
};
export const SEO_SCHEMA_TYPES = ["ARTICLE", "PRODUCT", "FAQ", "ORGANIZATION", "BREADCRUMB"] as const;
export const SEO_SCHEMA_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "文章",
  PRODUCT: "产品",
  FAQ: "常见问题",
  ORGANIZATION: "组织",
  BREADCRUMB: "面包屑",
};
export const SEO_GOOGLE_SERVICES = ["GSC", "GA4"] as const;
export const SEO_GOOGLE_SERVICE_LABELS: Record<string, string> = {
  GSC: "Search Console",
  GA4: "GA4 分析",
};
export const SEO_RUN_STATUSES = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;

// ---------------------------------------------------------------------------
// 实体 schema
// ---------------------------------------------------------------------------

export const seoKeyPageSchema = z.object({
  url: z.string(),
  role: z.enum(SEO_KEY_PAGE_ROLES),
});

export const seoProjectSchema = z.object({
  id: z.number(),
  domain: z.string(),
  brandName: z.string(),
  locationCode: z.number(),
  languageCode: z.string(),
  competitors: z.array(z.string()),
  keyPages: z.array(seoKeyPageSchema),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const seoProviderSettingSchema = z.object({
  code: z.string(),
  accountName: z.string(),
  connected: z.boolean(),
  updatedAt: z.string(),
});

export const seoSetupItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  done: z.boolean(),
});

export const seoOverviewSchema = z.object({
  project: seoProjectSchema.nullable(),
  healthScore: z.number().nullable(),
  keywordCount: z.number(),
  trackerCount: z.number(),
  auditCount: z.number(),
  backlinkTotal: z.number().nullable(),
  referringDomains: z.number().nullable(),
  geoMentionRate: z.number().nullable(),
  ga4Sessions: z.number().nullable(),
  rankTrend: z.array(z.object({ date: z.string(), avgPosition: z.number().nullable() })),
  setup: z.array(seoSetupItemSchema),
  providerConnected: z.boolean(),
  googleConnected: z.boolean(),
});

export const seoAuditSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  startUrl: z.string(),
  maxPages: z.number(),
  status: z.enum(SEO_AUDIT_STATUSES),
  phase: z.string(),
  healthScore: z.number().nullable(),
  pageCount: z.number(),
  issueCount: z.number(),
  criticalCount: z.number(),
  warningCount: z.number(),
  errorCode: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const seoAuditPageSchema = z.object({
  id: z.number(),
  auditId: z.number(),
  url: z.string(),
  fetchStatus: z.enum(SEO_FETCH_STATUSES),
  title: z.string(),
  metaDescription: z.string(),
  canonical: z.string(),
  h1: z.array(z.string()),
  wordCount: z.number(),
  imageCount: z.number(),
  imagesMissingAlt: z.number(),
  internalLinks: z.number(),
  externalLinks: z.number(),
  hasJsonLd: z.boolean(),
  bytes: z.number(),
  blockingScripts: z.number(),
  inSitemap: z.boolean(),
});

export const seoAuditIssueSchema = z.object({
  id: z.number(),
  auditId: z.number(),
  pageId: z.number().nullable(),
  url: z.string(),
  type: z.string(),
  typeLabel: z.string(),
  severity: z.enum(SEO_SEVERITIES),
  detail: z.string(),
  fixHint: z.string(),
});

export const seoAuditDetailSchema = z.object({
  audit: seoAuditSchema,
  issues: z.array(seoAuditIssueSchema),
  pages: z.array(seoAuditPageSchema),
  performance: z.object({
    available: z.boolean(),
    note: z.string(),
    avgBytes: z.number(),
    avgBlockingScripts: z.number(),
    imagesMissingAlt: z.number(),
    lighthouse: z
      .object({
        performance: z.number(),
        accessibility: z.number(),
        bestPractices: z.number(),
        seo: z.number(),
        lcp: z.number().nullable(),
        cls: z.number().nullable(),
        inp: z.number().nullable(),
        ttfb: z.number().nullable(),
      })
      .nullable(),
  }),
  aiAdvice: z.string(),
});

export const seoKeywordSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  keyword: z.string(),
  tags: z.array(z.string()),
  clusterId: z.number().nullable(),
  volume: z.number().nullable(),
  cpc: z.number().nullable(),
  difficulty: z.number().nullable(),
  intent: z.string(),
  source: z.enum(SEO_KEYWORD_SOURCES),
  metricsAt: z.string().nullable(),
  createdAt: z.string(),
});

export const seoKeywordClusterSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  name: z.string(),
  intent: z.string(),
  mappedPageUrl: z.string(),
  keywordCount: z.number(),
});

export const seoResearchKeywordSchema = z.object({
  keyword: z.string(),
  volume: z.number().nullable(),
  cpc: z.number().nullable(),
  difficulty: z.number().nullable(),
  intent: z.string(),
  source: z.enum(SEO_KEYWORD_SOURCES),
  opportunity: z.number(),
});

export const seoGscImportSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  fileName: z.string(),
  rowCount: z.number(),
  dateRange: z.string(),
  source: z.string(),
  createdAt: z.string(),
});

export const seoGscRowSchema = z.object({
  query: z.string(),
  page: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});

export const seoGscAnalysisSchema = z.object({
  totalClicks: z.number(),
  totalImpressions: z.number(),
  avgCtr: z.number(),
  avgPosition: z.number(),
  strikingDistance: z.array(seoGscRowSchema),
  topQueries: z.array(seoGscRowSchema),
  topPages: z.array(seoGscRowSchema),
});

export const seoRankTrackerSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  domain: z.string(),
  locationCode: z.number(),
  languageCode: z.string(),
  device: z.enum(SEO_DEVICES),
  depth: z.number(),
  frequency: z.enum(SEO_FREQUENCIES),
  reads: z.number(),
  nextRunAt: z.string().nullable(),
  enabled: z.boolean(),
  keywordCount: z.number(),
  lastPosition: z.number().nullable(),
  createdAt: z.string(),
});

export const seoRankKeywordSchema = z.object({
  id: z.number(),
  trackerId: z.number(),
  keyword: z.string(),
  pinned: z.boolean(),
  lastPosition: z.number().nullable(),
});

export const seoRankRunSchema = z.object({
  id: z.number(),
  trackerId: z.number(),
  status: z.enum(SEO_RUN_STATUSES),
  trigger: z.string(),
  costEstimate: z.number(),
  errorCode: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const seoRankSnapshotSchema = z.object({
  keyword: z.string(),
  device: z.string(),
  position: z.number().nullable(),
  url: z.string(),
  checkedAt: z.string(),
});

export const seoRankHistorySchema = z.object({
  runs: z.array(seoRankRunSchema),
  snapshots: z.array(seoRankSnapshotSchema),
  trend: z.array(z.object({ date: z.string(), avgPosition: z.number().nullable() })),
});

export const seoBacklinkOverviewSchema = z.object({
  available: z.boolean(),
  totalBacklinks: z.number(),
  referringDomains: z.number(),
  followLinks: z.number(),
  nofollowLinks: z.number(),
  anchors: z.array(z.object({ text: z.string(), count: z.number() })),
  queriedAt: z.string().nullable(),
});

export const seoBacklinkItemSchema = z.object({
  urlFrom: z.string(),
  urlTo: z.string(),
  anchor: z.string(),
  domainFrom: z.string(),
  isFollow: z.boolean(),
  firstSeen: z.string(),
});

export const seoBacklinkSnapshotSchema = z.object({
  id: z.number(),
  totalBacklinks: z.number(),
  referringDomains: z.number(),
  queriedAt: z.string(),
});

export const seoCompetitorOverviewSchema = z.object({
  available: z.boolean(),
  domain: z.string(),
  organicKeywords: z.number(),
  organicTraffic: z.number(),
  backlinks: z.number(),
  referringDomains: z.number(),
  rankedKeywords: z.array(z.object({ keyword: z.string(), position: z.number(), volume: z.number().nullable() })),
  overlap: z.array(z.object({ keyword: z.string(), myPosition: z.number().nullable(), theirPosition: z.number() })),
});

export const seoCompetitorPageCompareSchema = z.object({
  domain: z.string(),
  pages: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      wordCount: z.number(),
      h2Count: z.number(),
      hasJsonLd: z.boolean(),
      internalLinks: z.number(),
      images: z.number(),
    }),
  ),
  aiAnalysis: z.string(),
});

export const seoLocalTrackerSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  businessName: z.string(),
  keyword: z.string(),
  centerLat: z.number(),
  centerLng: z.number(),
  gridSize: z.number(),
  radiusKm: z.number(),
  createdAt: z.string(),
});

export const seoLocalPointSchema = z.object({
  row: z.number(),
  col: z.number(),
  lat: z.number(),
  lng: z.number(),
  rank: z.number().nullable(),
  competitors: z.array(z.object({ name: z.string(), rank: z.number() })),
});

export const seoLocalGridSchema = z.object({
  tracker: seoLocalTrackerSchema,
  runId: z.number().nullable(),
  gridSize: z.number(),
  points: z.array(seoLocalPointSchema),
  stats: z.object({
    avgRank: z.number().nullable(),
    top1: z.number(),
    top3: z.number(),
    covered: z.number(),
    total: z.number(),
  }),
  centerResults: z.array(z.object({ name: z.string(), rank: z.number(), address: z.string() })),
  checkedAt: z.string().nullable(),
});

export const seoGoogleConnectionSchema = z.object({
  service: z.enum(SEO_GOOGLE_SERVICES),
  propertyId: z.string(),
  propertyName: z.string(),
  connected: z.boolean(),
  lastSyncAt: z.string().nullable(),
  syncError: z.string(),
});

export const seoGoogleClientSchema = z.object({
  configured: z.boolean(),
  clientIdMasked: z.string(),
  callbackUrl: z.string(),
  connections: z.array(seoGoogleConnectionSchema),
});

export const seoGa4RowSchema = z.object({
  date: z.string(),
  page: z.string(),
  sessions: z.number(),
  users: z.number(),
  engagement: z.number(),
  conversions: z.number(),
});

export const seoLinkProspectSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  domain: z.string(),
  url: z.string(),
  sourceQuery: z.string(),
  contactEmail: z.string(),
  contactUrl: z.string(),
  outreachAngle: z.string(),
  status: z.enum(SEO_PROSPECT_STATUSES),
  draftArtifactId: z.number().nullable(),
  note: z.string(),
  createdAt: z.string(),
});

export const seoProgrammaticRunSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  tableId: z.number(),
  tableName: z.string(),
  keywordPattern: z.string(),
  rowCount: z.number(),
  status: z.enum(SEO_RUN_STATUSES),
  createdAt: z.string(),
});

export const seoProgrammaticPageSchema = z.object({
  id: z.number(),
  runId: z.number(),
  slug: z.string(),
  title: z.string(),
  metaDescription: z.string(),
  body: z.string(),
  jsonLd: z.string(),
});

export const seoIndexnowKeySchema = z.object({
  keyValue: z.string(),
  verifiedAt: z.string().nullable(),
  keyFileUrl: z.string(),
});

export const seoIndexnowSubmissionSchema = z.object({
  id: z.number(),
  urls: z.array(z.string()),
  responseCode: z.number(),
  submittedBy: z.string(),
  createdAt: z.string(),
});

export const seoBaiduCredentialSchema = z.object({
  site: z.string(),
  configured: z.boolean(),
});

export const seoBaiduSubmissionSchema = z.object({
  id: z.number(),
  urls: z.array(z.string()),
  success: z.number(),
  remain: z.number().nullable(),
  notValid: z.array(z.string()),
  submittedBy: z.string(),
  createdAt: z.string(),
});

export const seoReportSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  shareUrl: z.string(),
  createdAt: z.string(),
});

export const seoResearchLogSchema = z.object({
  id: z.number(),
  action: z.string(),
  paramsHash: z.string(),
  resultRef: z.string(),
  reused: z.boolean(),
  createdAt: z.string(),
});

export const seoCostEstimateSchema = z.object({
  calls: z.number(),
  estimatedUsd: z.number(),
  note: z.string(),
});

export const seoSchemaResultSchema = z.object({
  jsonLd: z.string(),
  valid: z.boolean(),
  issues: z.array(z.string()),
  mode: z.enum(["llm", "rule"]),
});

// ---------------------------------------------------------------------------
// body schema
// ---------------------------------------------------------------------------

export const saveSeoProjectBodySchema = z.object({
  id: z.number().int().positive().optional(),
  domain: z.string().min(3).max(200),
  brandName: z.string().max(80).default(""),
  locationCode: z.number().int().default(2840),
  languageCode: z.string().max(12).default("en"),
  competitors: z.array(z.string().max(120)).max(20).default([]),
  keyPages: z.array(seoKeyPageSchema).max(50).default([]),
  note: z.string().max(500).default(""),
});

export const saveSeoProviderBodySchema = z.object({
  code: z.string().min(2).max(40),
  accountName: z.string().max(80).default(""),
  login: z.string().max(200).default(""),
  password: z.string().max(200).default(""),
});

export const startSeoAuditBodySchema = z.object({
  projectId: z.number().int().positive(),
  startUrl: z.string().url(),
  maxPages: z.number().int().min(1).max(200).default(50),
  includeSubdomains: z.boolean().default(false),
  runLighthouse: z.boolean().default(false),
});

export const researchSeoKeywordsBodySchema = z.object({
  projectId: z.number().int().positive(),
  seed: z.string().max(200).default(""),
  competitorDomain: z.string().max(200).default(""),
  locationCode: z.number().int().default(2840),
  languageCode: z.string().max(12).default("en"),
  limit: z.number().int().min(1).max(100).default(30),
});

export const saveSeoKeywordsBodySchema = z.object({
  projectId: z.number().int().positive(),
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1).max(200),
        tags: z.array(z.string().max(60)).max(10).default([]),
        volume: z.number().nullable().default(null),
        cpc: z.number().nullable().default(null),
        difficulty: z.number().nullable().default(null),
        intent: z.string().max(40).default(""),
        source: z.enum(SEO_KEYWORD_SOURCES).default("AI"),
      }),
    )
    .min(1)
    .max(200),
});

export const importSeoGscBodySchema = z.object({
  projectId: z.number().int().positive(),
  fileName: z.string().max(200).default(""),
  csv: z.string().min(1).max(4_000_000),
});

export const saveSeoRankTrackerBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  domain: z.string().min(3).max(200),
  locationCode: z.number().int().default(2840),
  languageCode: z.string().max(12).default("en"),
  device: z.enum(SEO_DEVICES).default("MOBILE"),
  depth: z.number().int().min(10).max(100).default(20),
  frequency: z.enum(SEO_FREQUENCIES).default("WEEKLY"),
  reads: z.number().int().min(1).max(3).default(1),
  enabled: z.boolean().default(true),
});

export const addSeoRankKeywordsBodySchema = z.object({
  trackerId: z.number().int().positive(),
  keywords: z.array(z.string().min(1).max(200)).min(1).max(200),
});

export const runSeoRankCheckBodySchema = z.object({
  trackerId: z.number().int().positive(),
});

export const saveSeoLocalTrackerBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  businessName: z.string().min(1).max(120),
  keyword: z.string().min(1).max(200),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  gridSize: z.number().int().refine((v) => v === 3 || v === 5).default(3),
  radiusKm: z.number().min(0.5).max(50).default(5),
});

export const saveSeoGoogleClientBodySchema = z.object({
  clientId: z.string().max(300).default(""),
  clientSecret: z.string().max(300).default(""),
});

export const connectSeoGoogleBodySchema = z.object({
  service: z.enum(SEO_GOOGLE_SERVICES),
  propertyId: z.string().max(200).default(""),
  propertyName: z.string().max(200).default(""),
  refreshToken: z.string().max(2000).default(""),
});

export const discoverSeoProspectsBodySchema = z.object({
  projectId: z.number().int().positive(),
  query: z.string().min(1).max(200),
  locationCode: z.number().int().default(2840),
  languageCode: z.string().max(12).default("en"),
  limit: z.number().int().min(1).max(50).default(20),
});

export const addSeoProspectBodySchema = z.object({
  projectId: z.number().int().positive(),
  domain: z.string().min(3).max(200),
  url: z.string().max(500).default(""),
  sourceQuery: z.string().max(200).default(""),
  note: z.string().max(500).default(""),
});

export const updateSeoProspectBodySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(SEO_PROSPECT_STATUSES).optional(),
  contactEmail: z.string().max(200).optional(),
  contactUrl: z.string().max(500).optional(),
  outreachAngle: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
});

export const seoProspectIdBodySchema = z.object({
  id: z.number().int().positive(),
});

/** 外链潜客 → 阿里云邮件推送：把已提取的邮箱写成多维表格并同步到收件人列表（不发送）。 */
export const pushSeoProspectsMailBodySchema = z.object({
  projectId: z.number().int().positive(),
  ids: z.array(z.number().int().positive()).min(1).max(200),
  /** 空＝新建收件人列表；填＝追加到该列表。 */
  receiverId: z.string().max(120).default(""),
});

export const pushSeoProspectsMailResultSchema = z.object({
  tableId: z.number(),
  tableName: z.string(),
  importId: z.number(),
  total: z.number(),
});

export const seoProgrammaticPreviewBodySchema = z.object({
  projectId: z.number().int().positive(),
  tableId: z.number().int().positive(),
  keywordPattern: z.string().max(200).default(""),
  template: z.string().max(20000).default(""),
  sampleRows: z.number().int().min(1).max(5).default(3),
});

export const seoProgrammaticGenerateBodySchema = z.object({
  projectId: z.number().int().positive(),
  tableId: z.number().int().positive(),
  keywordPattern: z.string().max(200).default(""),
  template: z.string().max(20000).default(""),
  maxRows: z.number().int().min(1).max(200).default(50),
});

export const generateSeoSchemaBodySchema = z.object({
  projectId: z.number().int().positive(),
  type: z.enum(SEO_SCHEMA_TYPES),
  pageUrl: z.string().max(500).default(""),
  fields: z.record(z.string(), z.string()).default({}),
});

export const validateSeoSchemaBodySchema = z.object({
  jsonLd: z.string().min(1).max(50000),
  pageUrl: z.string().max(500).default(""),
});

export const submitSeoIndexnowBodySchema = z.object({
  projectId: z.number().int().positive(),
  urls: z.array(z.string().url()).min(1).max(1000),
});

export const saveSeoBaiduCredentialBodySchema = z.object({
  projectId: z.number().int().positive(),
  site: z.string().min(3).max(200),
  token: z.string().max(200).default(""),
});

export const submitSeoBaiduBodySchema = z.object({
  projectId: z.number().int().positive(),
  urls: z.array(z.string().url()).min(1).max(2000),
});

export const generateSeoReportBodySchema = z.object({
  projectId: z.number().int().positive(),
  periodLabel: z.string().max(60).default(""),
});

export const seoIdBodySchema = z.object({ id: z.number().int().positive() });
export const seoProjectIdBodySchema = z.object({ projectId: z.number().int().positive() });

const projectIdQuery = z.object({ projectId: z.coerce.number().int().positive() });

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

export const seoEndpoints = {
  // 站点档案
  Seo_listProjects: {
    method: "get" as const,
    path: "/enterprise/seo/projects",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(seoProjectSchema)),
  },
  Seo_createProject: {
    method: "post" as const,
    path: "/enterprise/seo/projects/create",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoProjectBodySchema,
    response: envelope(seoProjectSchema),
  },
  Seo_updateProject: {
    method: "post" as const,
    path: "/enterprise/seo/projects/update",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoProjectBodySchema,
    response: envelope(seoProjectSchema),
  },
  Seo_removeProject: {
    method: "post" as const,
    path: "/enterprise/seo/projects/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(okResult),
  },
  Seo_overview: {
    method: "get" as const,
    path: "/enterprise/seo/overview",
    params: z.object({}),
    query: z.object({ projectId: z.coerce.number().int().positive().optional() }),
    body: z.undefined(),
    response: envelope(seoOverviewSchema),
  },
  // 数据源设置
  Seo_settings: {
    method: "get" as const,
    path: "/enterprise/seo/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(seoProviderSettingSchema)),
  },
  Seo_saveProvider: {
    method: "post" as const,
    path: "/enterprise/seo/settings/provider",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoProviderBodySchema,
    response: envelope(seoProviderSettingSchema),
  },
  Seo_clearProvider: {
    method: "post" as const,
    path: "/enterprise/seo/settings/provider/clear",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ code: z.string().min(2).max(40) }),
    response: envelope(okResult),
  },
  Seo_testProvider: {
    method: "post" as const,
    path: "/enterprise/seo/settings/provider/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ code: z.string().min(2).max(40) }),
    response: envelope(okResult),
  },
  // 站点体检
  Seo_startAudit: {
    method: "post" as const,
    path: "/enterprise/seo/audits/start",
    params: z.object({}),
    query: emptyQuery,
    body: startSeoAuditBodySchema,
    response: envelope(seoAuditSchema),
  },
  Seo_listAudits: {
    method: "get" as const,
    path: "/enterprise/seo/audits",
    params: z.object({}),
    query: pageQuerySchema.extend({ projectId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(pageSchema(seoAuditSchema)),
  },
  Seo_getAudit: {
    method: "get" as const,
    path: "/enterprise/seo/audits/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(seoAuditDetailSchema),
  },
  Seo_explainAudit: {
    method: "post" as const,
    path: "/enterprise/seo/audits/explain",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(z.object({ advice: z.string(), mode: z.enum(["llm", "rule"]) })),
  },
  // 关键词
  Seo_researchKeywords: {
    method: "post" as const,
    path: "/enterprise/seo/keywords/research",
    params: z.object({}),
    query: emptyQuery,
    body: researchSeoKeywordsBodySchema,
    response: envelope(z.object({ keywords: z.array(seoResearchKeywordSchema), mode: z.enum(["dataforseo", "ai"]), reused: z.boolean() })),
  },
  Seo_saveKeywords: {
    method: "post" as const,
    path: "/enterprise/seo/keywords/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoKeywordsBodySchema,
    response: envelope(z.object({ saved: z.number() })),
  },
  Seo_listKeywords: {
    method: "get" as const,
    path: "/enterprise/seo/keywords",
    params: z.object({}),
    query: pageQuerySchema.extend({ projectId: z.coerce.number().int().positive(), q: z.string().optional(), tag: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(seoKeywordSchema)),
  },
  Seo_removeKeyword: {
    method: "post" as const,
    path: "/enterprise/seo/keywords/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(okResult),
  },
  Seo_clusterKeywords: {
    method: "post" as const,
    path: "/enterprise/seo/keywords/cluster",
    params: z.object({}),
    query: emptyQuery,
    body: seoProjectIdBodySchema,
    response: envelope(z.object({ clusters: z.array(seoKeywordClusterSchema), mode: z.enum(["llm", "rule"]) })),
  },
  Seo_listClusters: {
    method: "get" as const,
    path: "/enterprise/seo/keywords/clusters",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoKeywordClusterSchema)),
  },
  // GSC
  Seo_importGsc: {
    method: "post" as const,
    path: "/enterprise/seo/gsc/import",
    params: z.object({}),
    query: emptyQuery,
    body: importSeoGscBodySchema,
    response: envelope(seoGscImportSchema),
  },
  Seo_listGscImports: {
    method: "get" as const,
    path: "/enterprise/seo/gsc/imports",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoGscImportSchema)),
  },
  Seo_gscAnalysis: {
    method: "get" as const,
    path: "/enterprise/seo/gsc/analysis",
    params: z.object({}),
    query: projectIdQuery.extend({ importId: z.coerce.number().int().positive().optional() }),
    body: z.undefined(),
    response: envelope(seoGscAnalysisSchema),
  },
  // 排名跟踪
  Seo_createTracker: {
    method: "post" as const,
    path: "/enterprise/seo/rank/trackers/create",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoRankTrackerBodySchema,
    response: envelope(seoRankTrackerSchema),
  },
  Seo_listTrackers: {
    method: "get" as const,
    path: "/enterprise/seo/rank/trackers",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoRankTrackerSchema)),
  },
  Seo_updateTracker: {
    method: "post" as const,
    path: "/enterprise/seo/rank/trackers/update",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoRankTrackerBodySchema,
    response: envelope(seoRankTrackerSchema),
  },
  Seo_removeTracker: {
    method: "post" as const,
    path: "/enterprise/seo/rank/trackers/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(okResult),
  },
  Seo_listRankKeywords: {
    method: "get" as const,
    path: "/enterprise/seo/rank/keywords",
    params: z.object({}),
    query: z.object({ trackerId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(z.array(seoRankKeywordSchema)),
  },
  Seo_addRankKeywords: {
    method: "post" as const,
    path: "/enterprise/seo/rank/keywords/add",
    params: z.object({}),
    query: emptyQuery,
    body: addSeoRankKeywordsBodySchema,
    response: envelope(z.object({ added: z.number() })),
  },
  Seo_removeRankKeyword: {
    method: "post" as const,
    path: "/enterprise/seo/rank/keywords/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(okResult),
  },
  Seo_estimateRankCost: {
    method: "get" as const,
    path: "/enterprise/seo/rank/estimate",
    params: z.object({}),
    query: z.object({ trackerId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(seoCostEstimateSchema),
  },
  Seo_runRankCheck: {
    method: "post" as const,
    path: "/enterprise/seo/rank/run",
    params: z.object({}),
    query: emptyQuery,
    body: runSeoRankCheckBodySchema,
    response: envelope(seoRankRunSchema),
  },
  Seo_rankHistory: {
    method: "get" as const,
    path: "/enterprise/seo/rank/history",
    params: z.object({}),
    query: z.object({ trackerId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(seoRankHistorySchema),
  },
  // 竞品
  Seo_competitorOverview: {
    method: "get" as const,
    path: "/enterprise/seo/competitors/overview",
    params: z.object({}),
    query: projectIdQuery.extend({ domain: z.string().min(3) }),
    body: z.undefined(),
    response: envelope(seoCompetitorOverviewSchema),
  },
  Seo_competitorPages: {
    method: "post" as const,
    path: "/enterprise/seo/competitors/pages",
    params: z.object({}),
    query: emptyQuery,
    body: seoProjectIdBodySchema.extend({ domain: z.string().min(3).max(200) }),
    response: envelope(seoCompetitorPageCompareSchema),
  },
  // 外链分析
  Seo_backlinksOverview: {
    method: "get" as const,
    path: "/enterprise/seo/backlinks/overview",
    params: z.object({}),
    query: projectIdQuery.extend({ domain: z.string().min(3) }),
    body: z.undefined(),
    response: envelope(seoBacklinkOverviewSchema),
  },
  Seo_backlinksProfile: {
    method: "get" as const,
    path: "/enterprise/seo/backlinks/profile",
    params: z.object({}),
    query: pageQuerySchema.extend({ projectId: z.coerce.number().int().positive(), domain: z.string().min(3) }),
    body: z.undefined(),
    response: envelope(pageSchema(seoBacklinkItemSchema)),
  },
  Seo_backlinksHistory: {
    method: "get" as const,
    path: "/enterprise/seo/backlinks/history",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoBacklinkSnapshotSchema)),
  },
  // 外链建设
  Seo_discoverProspects: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/discover",
    params: z.object({}),
    query: emptyQuery,
    body: discoverSeoProspectsBodySchema,
    response: envelope(z.object({ prospects: z.array(seoLinkProspectSchema), mode: z.enum(["dataforseo", "manual"]) })),
  },
  Seo_listProspects: {
    method: "get" as const,
    path: "/enterprise/seo/prospects",
    params: z.object({}),
    query: pageQuerySchema.extend({ projectId: z.coerce.number().int().positive(), status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(seoLinkProspectSchema)),
  },
  Seo_addProspect: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/add",
    params: z.object({}),
    query: emptyQuery,
    body: addSeoProspectBodySchema,
    response: envelope(seoLinkProspectSchema),
  },
  Seo_extractContact: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/extract-contact",
    params: z.object({}),
    query: emptyQuery,
    body: seoProspectIdBodySchema,
    response: envelope(seoLinkProspectSchema),
  },
  Seo_draftOutreach: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/draft",
    params: z.object({}),
    query: emptyQuery,
    body: seoProspectIdBodySchema,
    response: envelope(z.object({ artifactId: z.number(), draft: z.string(), mode: z.enum(["llm", "rule"]) })),
  },
  Seo_updateProspect: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/update",
    params: z.object({}),
    query: emptyQuery,
    body: updateSeoProspectBodySchema,
    response: envelope(seoLinkProspectSchema),
  },
  Seo_removeProspect: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoProspectIdBodySchema,
    response: envelope(okResult),
  },
  Seo_pushProspectsToMail: {
    method: "post" as const,
    path: "/enterprise/seo/prospects/push-mail",
    params: z.object({}),
    query: emptyQuery,
    body: pushSeoProspectsMailBodySchema,
    response: envelope(pushSeoProspectsMailResultSchema),
  },
  // 本地 SEO
  Seo_createLocalTracker: {
    method: "post" as const,
    path: "/enterprise/seo/local/trackers/create",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoLocalTrackerBodySchema,
    response: envelope(seoLocalTrackerSchema),
  },
  Seo_listLocalTrackers: {
    method: "get" as const,
    path: "/enterprise/seo/local/trackers",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoLocalTrackerSchema)),
  },
  Seo_removeLocalTracker: {
    method: "post" as const,
    path: "/enterprise/seo/local/trackers/remove",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(okResult),
  },
  Seo_estimateLocalCost: {
    method: "get" as const,
    path: "/enterprise/seo/local/estimate",
    params: z.object({}),
    query: z.object({ trackerId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(seoCostEstimateSchema),
  },
  Seo_runLocalCheck: {
    method: "post" as const,
    path: "/enterprise/seo/local/run",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ trackerId: z.number().int().positive() }),
    response: envelope(seoLocalGridSchema),
  },
  Seo_localGrid: {
    method: "get" as const,
    path: "/enterprise/seo/local/grid",
    params: z.object({}),
    query: z.object({ trackerId: z.coerce.number().int().positive(), runId: z.coerce.number().int().positive().optional() }),
    body: z.undefined(),
    response: envelope(seoLocalGridSchema),
  },
  // Google 同步
  Seo_googleSettings: {
    method: "get" as const,
    path: "/enterprise/seo/google/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(seoGoogleClientSchema),
  },
  Seo_saveGoogleClient: {
    method: "post" as const,
    path: "/enterprise/seo/google/client",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoGoogleClientBodySchema,
    response: envelope(seoGoogleClientSchema),
  },
  Seo_googleAuthUrl: {
    method: "get" as const,
    path: "/enterprise/seo/google/auth-url",
    params: z.object({}),
    query: z.object({ service: z.enum(SEO_GOOGLE_SERVICES) }),
    body: z.undefined(),
    response: envelope(z.object({ url: z.string(), state: z.string() })),
  },
  Seo_googleCallback: {
    method: "get" as const,
    path: "/enterprise/seo/google/callback",
    params: z.object({}),
    query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.object({ ok: z.boolean(), service: z.string(), message: z.string() })),
  },
  Seo_connectGoogle: {
    method: "post" as const,
    path: "/enterprise/seo/google/connect",
    params: z.object({}),
    query: emptyQuery,
    body: connectSeoGoogleBodySchema,
    response: envelope(seoGoogleConnectionSchema),
  },
  Seo_disconnectGoogle: {
    method: "post" as const,
    path: "/enterprise/seo/google/disconnect",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ service: z.enum(SEO_GOOGLE_SERVICES) }),
    response: envelope(okResult),
  },
  Seo_syncGoogle: {
    method: "post" as const,
    path: "/enterprise/seo/google/sync",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ service: z.enum(SEO_GOOGLE_SERVICES) }),
    response: envelope(okResult),
  },
  Seo_ga4Rows: {
    method: "get" as const,
    path: "/enterprise/seo/google/ga4",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoGa4RowSchema)),
  },
  // 结构化数据
  Seo_generateSchema: {
    method: "post" as const,
    path: "/enterprise/seo/schema/generate",
    params: z.object({}),
    query: emptyQuery,
    body: generateSeoSchemaBodySchema,
    response: envelope(seoSchemaResultSchema),
  },
  Seo_validateSchema: {
    method: "post" as const,
    path: "/enterprise/seo/schema/validate",
    params: z.object({}),
    query: emptyQuery,
    body: validateSeoSchemaBodySchema,
    response: envelope(seoSchemaResultSchema),
  },
  // IndexNow
  Seo_setupIndexnow: {
    method: "post" as const,
    path: "/enterprise/seo/indexnow/setup",
    params: z.object({}),
    query: emptyQuery,
    body: seoProjectIdBodySchema,
    response: envelope(seoIndexnowKeySchema),
  },
  Seo_verifyIndexnow: {
    method: "post" as const,
    path: "/enterprise/seo/indexnow/verify",
    params: z.object({}),
    query: emptyQuery,
    body: seoProjectIdBodySchema,
    response: envelope(seoIndexnowKeySchema),
  },
  Seo_submitIndexnow: {
    method: "post" as const,
    path: "/enterprise/seo/indexnow/submit",
    params: z.object({}),
    query: emptyQuery,
    body: submitSeoIndexnowBodySchema,
    response: envelope(seoIndexnowSubmissionSchema),
  },
  Seo_indexnowHistory: {
    method: "get" as const,
    path: "/enterprise/seo/indexnow/history",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoIndexnowSubmissionSchema)),
  },
  // 百度提交
  Seo_baiduCredential: {
    method: "get" as const,
    path: "/enterprise/seo/baidu/credential",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(seoBaiduCredentialSchema),
  },
  Seo_saveBaiduCredential: {
    method: "post" as const,
    path: "/enterprise/seo/baidu/credential",
    params: z.object({}),
    query: emptyQuery,
    body: saveSeoBaiduCredentialBodySchema,
    response: envelope(seoBaiduCredentialSchema),
  },
  Seo_submitBaidu: {
    method: "post" as const,
    path: "/enterprise/seo/baidu/submit",
    params: z.object({}),
    query: emptyQuery,
    body: submitSeoBaiduBodySchema,
    response: envelope(seoBaiduSubmissionSchema),
  },
  Seo_baiduHistory: {
    method: "get" as const,
    path: "/enterprise/seo/baidu/history",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoBaiduSubmissionSchema)),
  },
  // 程序化页面
  Seo_programmaticPreview: {
    method: "post" as const,
    path: "/enterprise/seo/programmatic/preview",
    params: z.object({}),
    query: emptyQuery,
    body: seoProgrammaticPreviewBodySchema,
    response: envelope(z.object({ pages: z.array(seoProgrammaticPageSchema), template: z.string(), mode: z.enum(["llm", "rule"]) })),
  },
  Seo_programmaticGenerate: {
    method: "post" as const,
    path: "/enterprise/seo/programmatic/generate",
    params: z.object({}),
    query: emptyQuery,
    body: seoProgrammaticGenerateBodySchema,
    response: envelope(seoProgrammaticRunSchema),
  },
  Seo_programmaticRuns: {
    method: "get" as const,
    path: "/enterprise/seo/programmatic/runs",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoProgrammaticRunSchema)),
  },
  Seo_programmaticPages: {
    method: "get" as const,
    path: "/enterprise/seo/programmatic/pages",
    params: z.object({}),
    query: z.object({ runId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(z.array(seoProgrammaticPageSchema)),
  },
  Seo_programmaticExport: {
    method: "get" as const,
    path: "/enterprise/seo/programmatic/export",
    params: z.object({}),
    query: z.object({ runId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(z.object({ fileName: z.string(), contentBase64: z.string() })),
  },
  // 报告
  Seo_generateReport: {
    method: "post" as const,
    path: "/enterprise/seo/reports/generate",
    params: z.object({}),
    query: emptyQuery,
    body: generateSeoReportBodySchema,
    response: envelope(seoReportSchema),
  },
  Seo_listReports: {
    method: "get" as const,
    path: "/enterprise/seo/reports",
    params: z.object({}),
    query: projectIdQuery,
    body: z.undefined(),
    response: envelope(z.array(seoReportSchema)),
  },
  Seo_shareReport: {
    method: "post" as const,
    path: "/enterprise/seo/reports/share",
    params: z.object({}),
    query: emptyQuery,
    body: seoIdBodySchema,
    response: envelope(z.object({ shareUrl: z.string() })),
  },
  // 研究日志
  Seo_researchLog: {
    method: "get" as const,
    path: "/enterprise/seo/research-log",
    params: z.object({}),
    query: pageQuerySchema.extend({ projectId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(pageSchema(seoResearchLogSchema)),
  },
};