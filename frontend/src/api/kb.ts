import { endpoints, type EndpointResponse } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 知识库 API（方案 §10 契约端点的薄包装）：
 * - 读面按空间可见性收口（PRIVATE 外人 404，不泄露存在性）；
 * - 写面要求 owner 或 WRITE 消费者身份（后端 loadWritable 双闸）；
 * - 视图类型全部从契约响应派生，避免手写漂移。
 */

/** 知识空间行（含页/源计数，列表已按可见性过滤）。 */
export type KbSpace = NonNullable<EndpointResponse<"Kb_listSpaces">["data"]>[number];
/** 空间维护规范（页面类型定义 + 工作流提示词，版本化）。 */
export type KbSchemaView = NonNullable<EndpointResponse<"Kb_getSchema">["data"]>;
/** 原始资料行（不可变，只回摘要不回全文）。 */
export type KbSource = NonNullable<EndpointResponse<"Kb_listSources">["data"]>["list"][number];
/** 摄取作业行。 */
export type KbIngestJob = NonNullable<EndpointResponse<"Kb_ingest">["data"]>;
/** wiki 页列表行。 */
export type KbPageRow = NonNullable<EndpointResponse<"Kb_listPages">["data"]>["list"][number];
/** wiki 页详情（正文 + 溯源 + 出入链）。 */
export type KbPageDetail = NonNullable<EndpointResponse<"Kb_readPage">["data"]>;
/** 混合检索结果（命中 + 召回口径）。 */
export type KbSearchResult = NonNullable<EndpointResponse<"Kb_search">["data"]>;
/** 带引用问答结果。 */
export type KbAskResult = NonNullable<EndpointResponse<"Kb_ask">["data"]>;
/** 子图（实体节点 + 关系边）。 */
export type KbGraph = NonNullable<EndpointResponse<"Kb_graph">["data"]>;
/** 图谱洞察（枢纽/孤儿/矛盾/缺失引用 + 统计）。 */
export type KbGraphInsights = NonNullable<EndpointResponse<"Kb_graphInsights">["data"]>;
/** 巡检台账行。 */
export type KbLintRun = NonNullable<EndpointResponse<"Kb_lint">["data"]>;
/** 消费者绑定行。 */
export type KbConsumer = NonNullable<EndpointResponse<"Kb_listConsumers">["data"]>[number];
/** 记忆提炼结果。 */
export type KbConsolidateResult = NonNullable<EndpointResponse<"Kb_consolidate">["data"]>;
/** 检索回流结果。 */
export type KbRecallResult = NonNullable<EndpointResponse<"Kb_recall">["data"]>;
/** 索引统计快照。 */
export type KbIndexStats = NonNullable<EndpointResponse<"Kb_indexStats">["data"]>;
/** 时间线日志行。 */
export type KbLogRow = NonNullable<EndpointResponse<"Kb_logs">["data"]>["list"][number];

export const kbApi = {
  // ---------- 空间 ----------
  listSpaces: endpoint(endpoints.Kb_listSpaces),
  createSpace: endpoint(endpoints.Kb_createSpace),
  updateSpace: endpoint(endpoints.Kb_updateSpace),
  getSpace: endpoint(endpoints.Kb_getSpace),
  currentSpace: endpoint(endpoints.Kb_getCurrentSpace),
  selectSpace: endpoint(endpoints.Kb_setSpace),
  // ---------- 维护规范 ----------
  getSchema: endpoint(endpoints.Kb_getSchema),
  saveSchema: endpoint(endpoints.Kb_saveSchema),
  // ---------- 资料与摄取 ----------
  listSources: endpoint(endpoints.Kb_listSources),
  addSource: endpoint(endpoints.Kb_addSource),
  ingest: endpoint(endpoints.Kb_ingest),
  ingestJobs: endpoint(endpoints.Kb_ingestJobs),
  // ---------- 页面（wiki 三层之制品） ----------
  listPages: endpoint(endpoints.Kb_listPages),
  readPage: endpoint(endpoints.Kb_readPage),
  writePage: endpoint(endpoints.Kb_writePage),
  reviewPage: endpoint(endpoints.Kb_reviewPage),
  deletePage: endpoint(endpoints.Kb_deletePage),
  // ---------- 检索与问答 ----------
  search: endpoint(endpoints.Kb_search),
  ask: endpoint(endpoints.Kb_ask),
  // ---------- 图谱与巡检 ----------
  graph: endpoint(endpoints.Kb_graph),
  graphInsights: endpoint(endpoints.Kb_graphInsights),
  lint: endpoint(endpoints.Kb_lint),
  lintRuns: endpoint(endpoints.Kb_lintRuns),
  // ---------- 消费者绑定 ----------
  listConsumers: endpoint(endpoints.Kb_listConsumers),
  bindConsumer: endpoint(endpoints.Kb_bindConsumer),
  unbindConsumer: endpoint(endpoints.Kb_unbindConsumer),
  // ---------- Agent 记忆闭环 ----------
  consolidate: endpoint(endpoints.Kb_consolidate),
  recall: endpoint(endpoints.Kb_recall),
  // ---------- 统计与时间线 ----------
  indexStats: endpoint(endpoints.Kb_indexStats),
  logs: endpoint(endpoints.Kb_logs),
};
