import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 公共知识库与知识图谱契约（方案 §10 的 L1 底座）：
 * 空间/规范/源/页三层（Raw→编译制品→Schema）、Ingest/Query/Lint 三操作、
 * 图谱实体关系与洞察、KbConsumer 多消费者绑定、Agent 记忆提炼（consolidate）与回流（recall）。
 * 读接口按空间可见性收口；写接口要求 WRITE 身份（owner 或绑定 WRITE 的消费者/账号）。
 */

export const KB_SCOPE_TYPES = ["PERSONAL", "ENTERPRISE", "PROVIDER", "AGENT", "AVATAR", "SERVICE_DESK"] as const;
export const KB_VISIBILITIES = ["PRIVATE", "ORG", "SHARED", "PUBLIC"] as const;
export const KB_PAGE_TYPES = ["ENTITY", "CONCEPT", "SUMMARY", "COMPARISON", "SYNTHESIS", "INDEX", "LOG"] as const;
export const KB_PAGE_STATUSES = ["DRAFT", "PENDING_REVIEW", "PUBLISHED"] as const;
export const KB_SOURCE_KINDS = ["article", "paper", "transcript", "meeting", "customer-call", "note", "image"] as const;
/** 摄取入口类型（AI 底座 §5 P1-A）：TEXT 直投、UPLOAD 文件上传、URL 抓取、FEISHU 文档导入、OCR 图像/音视频解析。 */
export const KB_SOURCE_TYPES = ["TEXT", "UPLOAD", "URL", "FEISHU", "OCR"] as const;
/** 消费者类型：分身/客服/ERP/CRM + 业务板块（专题厅/法务/出海）可绑空间并召回（§5 P1-A 统一挂载）。 */
export const KB_CONSUMER_TYPES = ["AVATAR", "AGENT", "SERVICE_DESK", "ERP", "CRM", "THINK_TANK", "LEGAL", "OVERSEAS"] as const;

/** 知识空间（§10.2）：scopeType 区分归属，visibility 控制读面。 */
export const kbSpaceSchema = z.object({
  id: z.number(),
  orgType: z.string(),
  orgUserId: z.string(),
  ownerUserId: z.string(),
  scopeType: z.enum(KB_SCOPE_TYPES),
  name: z.string(),
  description: z.string(),
  visibility: z.enum(KB_VISIBILITIES),
  status: z.string(),
  pageCount: z.number(),
  sourceCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createKbSpaceBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  scopeType: z.enum(KB_SCOPE_TYPES).default("PERSONAL"),
  /** 组织归属留空＝个人空间（仅本人）；ENTERPRISE/PROVIDER 空间要求请求者是组织主账号或平台管理员 */
  orgType: z.enum(["ENTERPRISE", "PROVIDER"]).optional(),
  orgUserId: z.string().max(64).default(""),
  visibility: z.enum(KB_VISIBILITIES).default("PRIVATE"),
});
export const updateKbSpaceBodySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(KB_VISIBILITIES).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

/** 空间维护规范（§10.3 KbSchema）：页面类型定义 + 工作流提示词，可版本化。 */
export const kbSchemaViewSchema = z.object({
  spaceId: z.number(),
  pageTypes: z.array(z.object({ type: z.string(), fields: z.array(z.string()), description: z.string() })),
  workflowPrompt: z.string(),
  version: z.number(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export const saveKbSchemaBodySchema = z.object({
  spaceId: z.number().int().positive(),
  pageTypes: kbSchemaViewSchema.shape.pageTypes.max(20).optional(),
  workflowPrompt: z.string().max(20000).optional(),
});

/** 原始资料（不可变只读）：assetId 引用数字资产，text 为解析/直投正文。 */
export const kbSourceSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  assetId: z.number(),
  kind: z.enum(KB_SOURCE_KINDS),
  /** 摄取入口：直投/上传/URL/飞书/OCR */
  type: z.enum(KB_SOURCE_TYPES),
  /** 原始地址（URL 抓取/飞书文档/Vision 解析留痕；直投为空） */
  originUrl: z.string(),
  title: z.string(),
  hash: z.string(),
  status: z.enum(["PENDING", "INGESTED", "FAILED"]),
  error: z.string(),
  excerpt: z.string(),
  chars: z.number(),
  ingestedAt: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const addKbSourceBodySchema = z.object({
  spaceId: z.number().int().positive(),
  kind: z.enum(KB_SOURCE_KINDS).default("article"),
  title: z.string().min(1).max(200),
  /** 直投文本；引用数字资产时 assetId 必填、text 可空（由资产文本内容解析） */
  text: z.string().max(400000).default(""),
  assetId: z.number().int().min(0).default(0),
  /** 兼容旧客户端：显式声明入口类型，缺省 TEXT */
  type: z.enum(KB_SOURCE_TYPES).default("TEXT"),
  /** 兼容旧客户端：URL 抓取可直接复用投料接口（type=URL 时必填） */
  url: z.string().max(2000).default(""),
});
/** URL 抓取投料：服务端拉取网页并抽正文（零外部依赖 HTML→文本）。 */
export const addKbSourceUrlBodySchema = z.object({
  spaceId: z.number().int().positive(),
  url: z.string().url().max(2000),
  title: z.string().max(200).default(""),
  kind: z.enum(KB_SOURCE_KINDS).default("article"),
});
/** 飞书文档导入：传文档 URL 或 token，复用租户令牌读 raw_content。 */
export const addKbSourceFeishuBodySchema = z.object({
  spaceId: z.number().int().positive(),
  url: z.string().max(2000).default(""),
  token: z.string().max(200).default(""),
  title: z.string().max(200).default(""),
  kind: z.enum(KB_SOURCE_KINDS).default("note"),
});
/** 向量重算（换 embedding 模型后的存量回填）。 */
export const kbReembedResultSchema = z.object({
  spaceId: z.number(),
  pages: z.number(),
  chunks: z.number(),
  model: z.string(),
});
/** 业务板块知识增强（统一挂载）：召回片段 + 可选模型综合答复。 */
export const kbAssistBodySchema = z.object({
  question: z.string().min(1).max(2000),
  spaceIds: z.array(z.number().int().positive()).max(5).optional(),
  consumerType: z.enum(KB_CONSUMER_TYPES).optional(),
  consumerId: z.string().max(64).optional(),
  topK: z.number().int().min(1).max(20).default(6),
});
export const kbAssistResultSchema = z.object({
  answer: z.string(),
  mode: z.enum(["llm", "extractive"]),
  citations: z.array(
    z.object({
      source: z.string(),
      title: z.string(),
      ref: z.string(),
      excerpt: z.string(),
    }),
  ),
  spaces: z.array(z.object({ id: z.number(), name: z.string() })),
});

/** wiki 页行（列表不返正文，给摘要与引用数）。 */
export const kbPageRowSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  slug: z.string(),
  type: z.enum(KB_PAGE_TYPES),
  title: z.string(),
  status: z.enum(KB_PAGE_STATUSES),
  version: z.number(),
  tags: z.array(z.string()),
  sourceCount: z.number(),
  excerpt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
/** 页详情：正文 + 溯源 + wikilink 出/入链。 */
export const kbPageDetailSchema = kbPageRowSchema.extend({
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  reviewNote: z.string(),
  sources: z.array(z.object({ id: z.number(), title: z.string(), kind: z.string() })),
  outLinks: z.array(z.object({ slug: z.string(), title: z.string() })),
  inLinks: z.array(z.object({ slug: z.string(), title: z.string() })),
  createdAt: z.string(),
});
export const writeKbPageBodySchema = z.object({
  spaceId: z.number().int().positive(),
  slug: z.string().min(1).max(120),
  type: z.enum(KB_PAGE_TYPES).default("CONCEPT"),
  title: z.string().min(1).max(200),
  body: z.string().max(200000).default(""),
  frontmatter: z.record(z.string(), z.unknown()).default({}),
  /** 人在环（§10.1）：Agent/MCP 写入默认进 PENDING_REVIEW；界面作者可直接 PUBLISHED */
  status: z.enum(KB_PAGE_STATUSES).optional(),
  sourceIds: z.array(z.number().int().positive()).max(50).default([]),
});
export const reviewKbPageBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["publish", "reject"]),
  note: z.string().max(500).default(""),
});

/** 摄取作业（Ingest 操作）：LLM 可用走抽取建页，未配 Key 回落规则式摘要（确定性可验收）。 */
export const kbIngestJobSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  sourceId: z.number(),
  status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED"]),
  pagesAffected: z.array(z.number()),
  model: z.string(),
  tokens: z.number(),
  cost: z.string(),
  error: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  finishedAt: z.string(),
});

/** 混合检索命中（§10.5）：keyword + vector 双路分数与融合序。 */
export const kbSearchHitSchema = z.object({
  pageId: z.number(),
  slug: z.string(),
  title: z.string(),
  type: z.enum(KB_PAGE_TYPES),
  score: z.number(),
  keywordScore: z.number(),
  vectorScore: z.number(),
  excerpt: z.string(),
  sourceIds: z.array(z.number()),
});
export const kbSearchResultSchema = z.object({
  hits: z.array(kbSearchHitSchema),
  /** 召回口径：keyword / keyword+vector（embedding 缺失时自动退化并提示） */
  modes: z.array(z.string()),
  total: z.number(),
});

/** 带引用问答（Query 操作）：好答案可回填成新页（复利，§10.1）。 */
export const kbAskBodySchema = z.object({
  spaceId: z.number().int().positive(),
  question: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(10).default(4),
  /** 回填模式：答案满意后沉淀为 SYNTHESIS 页（默认进 PENDING_REVIEW） */
  saveAsPage: z.boolean().default(false),
});
export const kbAskResultSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ pageId: z.number(), slug: z.string(), title: z.string(), excerpt: z.string() })),
  /** llm=模型综合；extractive=无 Key 时抽取式回落（拼接命中摘要，带引用） */
  mode: z.enum(["llm", "extractive"]),
  savedPageId: z.number(),
  cost: z.string(),
});

/** 子图（§10.5 图谱）：节点=实体/页，边=关系。 */
export const kbGraphSchema = z.object({
  nodes: z.array(z.object({ id: z.number(), name: z.string(), type: z.string(), pageSlug: z.string(), degree: z.number() })),
  edges: z.array(z.object({ from: z.number(), to: z.number(), relation: z.string(), weight: z.number() })),
  truncated: z.boolean(),
});
/** 图谱洞察：枢纽/孤儿/矛盾/缺失交叉引用。 */
export const kbGraphInsightsSchema = z.object({
  hubs: z.array(z.object({ entityId: z.number(), name: z.string(), inDegree: z.number() })),
  orphans: z.array(z.object({ entityId: z.number(), name: z.string(), hasPage: z.boolean() })),
  conflicts: z.array(z.object({ entity: z.string(), pages: z.array(z.string()), note: z.string() })),
  missingRefs: z.array(z.object({ pageSlug: z.string(), wikilink: z.string() })),
  stats: z.object({ entities: z.number(), relations: z.number(), pages: z.number(), chunks: z.number() }),
});
export const kbLintRunSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  findings: z.record(z.string(), z.unknown()),
  summary: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  finishedAt: z.string(),
});

/** 消费者绑定（§10.2）：分身/客服/ERP/CRM 挂空间读或写。 */
export const kbConsumerSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  consumerType: z.enum(KB_CONSUMER_TYPES),
  consumerId: z.string(),
  role: z.enum(["READ", "WRITE"]),
  priority: z.number(),
  spaceName: z.string(),
  createdAt: z.string(),
});
export const bindKbConsumerBodySchema = z.object({
  spaceId: z.number().int().positive(),
  consumerType: z.enum(KB_CONSUMER_TYPES),
  consumerId: z.string().min(1).max(64),
  role: z.enum(["READ", "WRITE"]).default("READ"),
  priority: z.number().int().min(0).max(100).default(0),
});

/** 记忆提炼（§10.4 consolidation）：AgentMemoryEvent → 语义记忆（KbEntity/KbPage）。 */
export const kbConsolidateBodySchema = z.object({
  /** 目标空间；省略＝该用户 AGENT 归属的默认空间（无则自动建） */
  spaceId: z.number().int().positive().optional(),
  /** 提炼对象账号；仅平台管理员可传他人 userId，普通用户固定为本人 */
  userId: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const kbConsolidateResultSchema = z.object({
  spaceId: z.number(),
  eventsScanned: z.number(),
  entitiesUpdated: z.number(),
  pagesWritten: z.array(z.number()),
});
/** 检索回流（§10.4）：Agent 组 prompt 前拉取 KB 相关实体页片段（context-budget 裁剪）。 */
export const kbRecallBodySchema = z.object({
  spaceId: z.number().int().positive().optional(),
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(8).default(3),
  maxChars: z.number().int().min(200).max(8000).default(2000),
});
export const kbRecallResultSchema = z.object({
  snippets: z.array(z.object({ pageId: z.number(), slug: z.string(), title: z.string(), text: z.string(), score: z.number() })),
  boundSpaceId: z.number(),
  total: z.number(),
});

/** 跨模块统一检索（AI 底座 §4.2 kb_retrieve）：知识空间 + 资料库 + 帮助中心，出参带引用片段。 */
export const kbRetrieveSourceSchema = z.enum(["kb", "library", "help"]);
export const kbRetrieveBodySchema = z.object({
  query: z.string().min(1).max(500),
  /** 检索来源；缺省三源全开 */
  sources: z.array(kbRetrieveSourceSchema).max(3).optional(),
  /** 知识空间范围（与 consumer 绑定二选一，spaceIds 优先） */
  spaceIds: z.array(z.number().int().positive()).max(10).optional(),
  /** 消费者绑定（分身/客服/ERP/CRM 挂库）：按优先级聚合可读空间 */
  consumerType: z.enum(KB_CONSUMER_TYPES).optional(),
  consumerId: z.string().min(1).max(64).optional(),
  /** 资料库范围（content 资料库 id；空 = 全部资料） */
  libraryIds: z.array(z.number().int().positive()).max(50).optional(),
  /** 知识页类型过滤（kb 来源） */
  types: z.array(z.string().max(32)).max(10).optional(),
  /** 标签过滤（kb 来源 frontmatter.tags） */
  tags: z.array(z.string().max(32)).max(10).optional(),
  from: z.string().max(32).optional(),
  to: z.string().max(32).optional(),
  topK: z.number().int().min(1).max(20).default(8),
  /** 片段总字数预算（合并后从高分截断） */
  maxChars: z.number().int().min(200).max(8000).default(4000),
});
export const kbRetrieveSnippetSchema = z.object({
  source: kbRetrieveSourceSchema,
  spaceId: z.number().optional(),
  /** kb=pageId；library=nodeId；help=0（slug 才是稳定标识） */
  id: z.number(),
  slug: z.string().optional(),
  title: z.string(),
  text: z.string(),
  /** 归一分 0~1，跨源可比 */
  score: z.number(),
  /** 引用锚点：kb=页 slug；library=资料名；help=主题 code */
  ref: z.string(),
});
export const kbRetrieveResultSchema = z.object({
  query: z.string(),
  sources: z.array(kbRetrieveSourceSchema),
  snippets: z.array(kbRetrieveSnippetSchema),
  /** 召回口径 keyword / vector / rerank（缺失自动退化并如实报告） */
  modes: z.array(z.string()),
  total: z.number(),
  spaces: z.array(z.object({ id: z.number(), name: z.string() })),
});

/** 空间索引统计（§10.9 演进判据快照）。 */
export const kbIndexStatsSchema = z.object({
  spaceId: z.number(),
  model: z.string(),
  version: z.number(),
  pageCount: z.number(),
  chunkCount: z.number(),
  embeddingDim: z.number(),
  stats: z.record(z.string(), z.unknown()),
  statsAt: z.string(),
});
export const kbLogSchema = z.object({
  id: z.number(),
  spaceId: z.number(),
  kind: z.string(),
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
  actorUserId: z.string(),
  createdAt: z.string(),
});

export const kbEndpoints = {
  /** 当前登录用户可见的空间列表（个人 + 本组织 + 显式共享）。 */
  Kb_listSpaces: {
    method: "get" as const,
    path: "/enterprise/kb/spaces",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(kbSpaceSchema)),
  },
  /** 建空间：PERSONAL 人人可建；组织空间要求组织主账号。 */
  Kb_createSpace: {
    method: "post" as const,
    path: "/enterprise/kb/spaces/create",
    params: z.object({}),
    query: emptyQuery,
    body: createKbSpaceBodySchema,
    response: envelope(kbSpaceSchema),
  },
  /** 改空间（名称/说明/可见性/归档）：owner 或组织管理员。 */
  Kb_updateSpace: {
    method: "post" as const,
    path: "/enterprise/kb/spaces/update",
    params: z.object({}),
    query: emptyQuery,
    body: updateKbSpaceBodySchema,
    response: envelope(kbSpaceSchema),
  },
  /** 空间详情（含页/源计数与 schema 摘要）。 */
  Kb_getSpace: {
    method: "get" as const,
    path: "/enterprise/kb/spaces/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(kbSpaceSchema),
  },
  /** 当前绑定空间（Kb_setSpace 对偶）：未绑定返回 null。 */
  Kb_getCurrentSpace: {
    method: "get" as const,
    path: "/enterprise/kb/current",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(kbSpaceSchema),
  },
  /** 会话绑定空间：＝Agent/分身「当前知识库」上下文切换。 */
  Kb_setSpace: {
    method: "post" as const,
    path: "/enterprise/kb/space/select",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ spaceId: z.number().int().positive() }),
    response: envelope(kbSpaceSchema),
  },
  /** 空间维护规范读取。 */
  Kb_getSchema: {
    method: "get" as const,
    path: "/enterprise/kb/schema",
    params: z.object({}),
    query: z.object({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(kbSchemaViewSchema),
  },
  /** 空间维护规范保存：版本自增（§10.3 可版本化）。 */
  Kb_saveSchema: {
    method: "post" as const,
    path: "/enterprise/kb/schema/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveKbSchemaBodySchema,
    response: envelope(kbSchemaViewSchema),
  },
  /** 源列表（分页，不返全文只给摘要）。 */
  Kb_listSources: {
    method: "get" as const,
    path: "/enterprise/kb/sources",
    params: z.object({}),
    query: pageQuerySchema.extend({ spaceId: z.coerce.number().int().positive(), status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(kbSourceSchema)),
  },
  /** 投料：文本直投或引用数字资产（hash 去重，重复即返回既有行）。 */
  Kb_addSource: {
    method: "post" as const,
    path: "/enterprise/kb/sources/add",
    params: z.object({}),
    query: emptyQuery,
    body: addKbSourceBodySchema,
    response: envelope(kbSourceSchema),
  },
  /** URL 抓取投料：服务端拉网页抽正文（zero-dep），失败如实报错不编造。 */
  Kb_addSourceUrl: {
    method: "post" as const,
    path: "/enterprise/kb/sources/add-url",
    params: z.object({}),
    query: emptyQuery,
    body: addKbSourceUrlBodySchema,
    response: envelope(kbSourceSchema),
  },
  /** 飞书文档导入：传 URL/token，未配置飞书应用凭据时如实报错。 */
  Kb_addSourceFeishu: {
    method: "post" as const,
    path: "/enterprise/kb/sources/add-feishu",
    params: z.object({}),
    query: emptyQuery,
    body: addKbSourceFeishuBodySchema,
    response: envelope(kbSourceSchema),
  },
  /** 向量重算：按当前 embedding 槽位重算空间内全部分块（换模型后的存量回填）。 */
  Kb_reembed: {
    method: "post" as const,
    path: "/enterprise/kb/reembed",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ spaceId: z.number().int().positive() }),
    response: envelope(kbReembedResultSchema),
  },
  /** 摄取（Ingest）：编译源→摘要页/实体抽取；同步执行返回作业（kb_ingest 计费科目）。 */
  Kb_ingest: {
    method: "post" as const,
    path: "/enterprise/kb/ingest",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ spaceId: z.number().int().positive(), sourceId: z.number().int().positive() }),
    response: envelope(kbIngestJobSchema),
  },
  /** 摄取作业台账。 */
  Kb_ingestJobs: {
    method: "get" as const,
    path: "/enterprise/kb/ingest-jobs",
    params: z.object({}),
    query: pageQuerySchema.extend({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(pageSchema(kbIngestJobSchema)),
  },
  /** 页列表（可按类型/状态/关键词过滤）。 */
  Kb_listPages: {
    method: "get" as const,
    path: "/enterprise/kb/pages",
    params: z.object({}),
    query: pageQuerySchema.extend({
      spaceId: z.coerce.number().int().positive(),
      type: z.string().optional(),
      status: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(kbPageRowSchema)),
  },
  /** 页详情：正文 + 溯源 + 出入链。 */
  Kb_readPage: {
    method: "get" as const,
    path: "/enterprise/kb/pages/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(kbPageDetailSchema),
  },
  /** 写页（write_page 语义）：slug 幂等 upsert；Agent 渠道默认进 PENDING_REVIEW。 */
  Kb_writePage: {
    method: "post" as const,
    path: "/enterprise/kb/pages/write",
    params: z.object({}),
    query: emptyQuery,
    body: writeKbPageBodySchema,
    response: envelope(kbPageDetailSchema),
  },
  /** 待审页处理（人在环 review）。 */
  Kb_reviewPage: {
    method: "post" as const,
    path: "/enterprise/kb/pages/review",
    params: z.object({}),
    query: emptyQuery,
    body: reviewKbPageBodySchema,
    response: envelope(kbPageRowSchema),
  },
  /** 删页（owner/组织管理员）。 */
  Kb_deletePage: {
    method: "post" as const,
    path: "/enterprise/kb/pages/delete",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ deleted: z.number() })),
  },
  /** 混合检索（§10.5）：关键词 + 向量双路，embedding 缺失自动退化关键词。 */
  Kb_search: {
    method: "get" as const,
    path: "/enterprise/kb/search",
    params: z.object({}),
    query: z.object({
      spaceId: z.coerce.number().int().positive(),
      q: z.string().min(1).max(200),
      topK: z.coerce.number().int().min(1).max(20).default(8),
    }),
    body: z.undefined(),
    response: envelope(kbSearchResultSchema),
  },
  /** 带引用问答（Query + 好答案回填）：kb_query 计费科目。 */
  Kb_ask: {
    method: "post" as const,
    path: "/enterprise/kb/ask",
    params: z.object({}),
    query: emptyQuery,
    body: kbAskBodySchema,
    response: envelope(kbAskResultSchema),
  },
  /** 取子图：实体节点 + 关系边（depth 1~2，节点上限截断）。 */
  Kb_graph: {
    method: "get" as const,
    path: "/enterprise/kb/graph",
    params: z.object({}),
    query: z.object({
      spaceId: z.coerce.number().int().positive(),
      entityId: z.coerce.number().int().positive().optional(),
      depth: z.coerce.number().int().min(1).max(2).default(1),
    }),
    body: z.undefined(),
    response: envelope(kbGraphSchema),
  },
  /** 图谱洞察（实时口径，与 Lint 台账互补）。 */
  Kb_graphInsights: {
    method: "get" as const,
    path: "/enterprise/kb/graph-insights",
    params: z.object({}),
    query: z.object({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(kbGraphInsightsSchema),
  },
  /** 健康巡检（Lint 操作）：矛盾/孤儿/枢纽/缺失引用，同步执行落台账。 */
  Kb_lint: {
    method: "post" as const,
    path: "/enterprise/kb/lint",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ spaceId: z.number().int().positive() }),
    response: envelope(kbLintRunSchema),
  },
  /** 巡检台账。 */
  Kb_lintRuns: {
    method: "get" as const,
    path: "/enterprise/kb/lint-runs",
    params: z.object({}),
    query: pageQuerySchema.extend({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(pageSchema(kbLintRunSchema)),
  },
  /** 消费者绑定列表（空间 owner 可见）。 */
  Kb_listConsumers: {
    method: "get" as const,
    path: "/enterprise/kb/consumers",
    params: z.object({}),
    query: z.object({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(z.array(kbConsumerSchema)),
  },
  /** 绑定消费者（分身/客服/ERP/CRM ↔ 空间）。 */
  Kb_bindConsumer: {
    method: "post" as const,
    path: "/enterprise/kb/consumers/bind",
    params: z.object({}),
    query: emptyQuery,
    body: bindKbConsumerBodySchema,
    response: envelope(kbConsumerSchema),
  },
  /** 解绑消费者。 */
  Kb_unbindConsumer: {
    method: "post" as const,
    path: "/enterprise/kb/consumers/delete",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ deleted: z.number() })),
  },
  /** 记忆提炼（§10.4）：扫描 AgentMemoryEvent 聚合进实体页（矛盾进 PENDING_REVIEW）。 */
  Kb_consolidate: {
    method: "post" as const,
    path: "/enterprise/kb/consolidate",
    params: z.object({}),
    query: emptyQuery,
    body: kbConsolidateBodySchema,
    response: envelope(kbConsolidateResultSchema),
  },
  /** 检索回流（§10.4）：给 Agent 上下文装配的 KB 片段（读当前绑定空间）。 */
  Kb_recall: {
    method: "post" as const,
    path: "/enterprise/kb/recall",
    params: z.object({}),
    query: emptyQuery,
    body: kbRecallBodySchema,
    response: envelope(kbRecallResultSchema),
  },
  /** 跨模块统一检索 kb_retrieve（AI 底座 §4.2）：kb 空间 + 资料库 + 帮助中心，任何模块/技能一行挂载。 */
  Kb_retrieve: {
    method: "post" as const,
    path: "/enterprise/kb/retrieve",
    params: z.object({}),
    query: emptyQuery,
    body: kbRetrieveBodySchema,
    response: envelope(kbRetrieveResultSchema),
  },
  /** 业务板块知识增强（统一挂载 §5 P1-A）：客服/专题厅/法务/出海按 consumerType 召回并综合作答。 */
  Kb_assist: {
    method: "post" as const,
    path: "/enterprise/kb/assist",
    params: z.object({}),
    query: emptyQuery,
    body: kbAssistBodySchema,
    response: envelope(kbAssistResultSchema),
  },
  /** 索引与向量统计（§10.9 演进判据）。 */
  Kb_indexStats: {
    method: "get" as const,
    path: "/enterprise/kb/index",
    params: z.object({}),
    query: z.object({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(kbIndexStatsSchema),
  },
  /** 时间线台账（页+日志双索引的日志侧）。 */
  Kb_logs: {
    method: "get" as const,
    path: "/enterprise/kb/logs",
    params: z.object({}),
    query: pageQuerySchema.extend({ spaceId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(pageSchema(kbLogSchema)),
  },
};
export type KbEndpoints = typeof kbEndpoints;
