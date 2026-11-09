import type { CurrentUser } from '../auth/current-user';
import type {
  CreateSpaceInput,
  KbSpaceService,
  SaveSchemaInput,
  UpdateSpaceInput,
} from './kb-space.service';
import type { AddSourceInput, KbSourceService } from './kb-source.service';
import type { KbPageService, WritePageInput } from './kb-page.service';
import type { KbIngestService } from './kb-ingest.service';
import type { KbSearchService } from './kb-search.service';
import type { KbGraphService } from './kb-graph.service';
import type {
  BindConsumerInput,
  KbConsumerService,
} from './kb-consumer.service';
import type { ConsolidateInput, KbMemoryService } from './kb-memory.service';
import type { KbRetrieveService, RetrieveInput } from './kb-retrieve.service';
import type { KbIntakeService } from './kb-intake.service';
import type { AssistInput, KbAssistService } from './kb-assist.service';

type PageQuery = { page: number; pageSize: number };

/**
 * 知识库控制器：契约端点 id `Kb_xxx` → 方法名 `xxx`，由 automation-routes 的
 * moduleHandlers 统一注册（自动进 OpenAPI/MCP，参数顺序＝用户、路径参数、查询、请求体）。
 * 可见性与写闸仍在各服务内部收口，这里只做解参与转发。
 */
export class KbController {
  constructor(
    private readonly spaces: KbSpaceService,
    private readonly sources: KbSourceService,
    private readonly pages: KbPageService,
    private readonly ingestService: KbIngestService,
    private readonly searchService: KbSearchService,
    private readonly graphService: KbGraphService,
    private readonly consumers: KbConsumerService,
    private readonly memoryService: KbMemoryService,
    private readonly retrieveService: KbRetrieveService,
    private readonly intakeService: KbIntakeService,
    private readonly assistService: KbAssistService,
  ) {}

  // ---------- 空间与绑定 ----------

  listSpaces(user: CurrentUser) {
    return this.spaces.listSpaces(user);
  }

  createSpace(user: CurrentUser, body: CreateSpaceInput) {
    return this.spaces.createSpace(body, user);
  }

  updateSpace(user: CurrentUser, body: UpdateSpaceInput) {
    return this.spaces.updateSpace(body, user);
  }

  getSpace(user: CurrentUser, id: string) {
    return this.spaces.getSpace(Number(id), user);
  }

  getCurrentSpace(user: CurrentUser) {
    return this.spaces.currentSpace(user);
  }

  setSpace(user: CurrentUser, body: { spaceId: number }) {
    return this.spaces.selectSpace(body.spaceId, user);
  }

  // ---------- 维护规范 ----------

  getSchema(user: CurrentUser, query: { spaceId: number }) {
    return this.spaces.schemaView(query.spaceId, user);
  }

  saveSchema(user: CurrentUser, body: SaveSchemaInput) {
    return this.spaces.saveSchema(body, user);
  }

  // ---------- 源与摄取 ----------

  listSources(
    user: CurrentUser,
    query: PageQuery & { spaceId: number; status?: string },
  ) {
    return this.sources.listSources(query, user);
  }

  addSource(user: CurrentUser, body: AddSourceInput) {
    return this.sources.addSource(body, user);
  }

  /** URL 抓取投料（P1-A 摄取管道）。 */
  addSourceUrl(
    user: CurrentUser,
    body: { spaceId: number; url: string; title: string; kind: string },
  ) {
    return this.intakeService.addUrl(body, user);
  }

  /** 飞书文档导入（复用 IM 连接器的应用凭据）。 */
  addSourceFeishu(
    user: CurrentUser,
    body: {
      spaceId: number;
      url: string;
      token: string;
      title: string;
      kind: string;
    },
  ) {
    return this.intakeService.addFeishu(body, user);
  }

  /** 文件上传投料（multipart 不进 JSON 契约，见 automation-routes）。 */
  uploadSource(user: CurrentUser, file: File, fields: Record<string, unknown>) {
    return this.intakeService.addUpload(file, fields, user);
  }

  /** 向量重算：换 embedding 模型后回填空间内全部分块。 */
  reembed(user: CurrentUser, body: { spaceId: number }) {
    return this.pages.reembedSpace(body.spaceId, user);
  }

  ingest(user: CurrentUser, body: { spaceId: number; sourceId: number }) {
    return this.ingestService.ingest(body, user);
  }

  ingestJobs(user: CurrentUser, query: PageQuery & { spaceId: number }) {
    return this.ingestService.listJobs(query, user);
  }

  // ---------- 页 ----------

  listPages(
    user: CurrentUser,
    query: PageQuery & {
      spaceId: number;
      type?: string;
      status?: string;
      q?: string;
    },
  ) {
    return this.pages.listPages(query, user);
  }

  readPage(user: CurrentUser, id: string) {
    return this.pages.readPage(Number(id), user);
  }

  writePage(user: CurrentUser, body: WritePageInput) {
    return this.pages.writePage(body, user);
  }

  reviewPage(
    user: CurrentUser,
    body: { id: number; decision: 'publish' | 'reject'; note: string },
  ) {
    return this.pages.reviewPage(body, user);
  }

  deletePage(user: CurrentUser, body: { id: number }) {
    return this.pages.deletePage(body.id, user);
  }

  // ---------- 检索与问答 ----------

  search(
    user: CurrentUser,
    query: { spaceId: number; q: string; topK: number },
  ) {
    return this.searchService.search(query.spaceId, query.q, query.topK, user);
  }

  ask(
    user: CurrentUser,
    body: {
      spaceId: number;
      question: string;
      topK: number;
      saveAsPage: boolean;
    },
  ) {
    return this.searchService.ask(body, user);
  }

  // ---------- 图谱与巡检 ----------

  graph(
    user: CurrentUser,
    query: { spaceId: number; entityId?: number; depth: number },
  ) {
    return this.graphService.graph(query, user);
  }

  graphInsights(user: CurrentUser, query: { spaceId: number }) {
    return this.graphService.insights(query.spaceId, user);
  }

  lint(user: CurrentUser, body: { spaceId: number }) {
    return this.graphService.lint(body.spaceId, user);
  }

  lintRuns(user: CurrentUser, query: PageQuery & { spaceId: number }) {
    return this.graphService.lintRuns(query, user);
  }

  // ---------- 消费者 ----------

  listConsumers(user: CurrentUser, query: { spaceId: number }) {
    return this.consumers.list(query.spaceId, user);
  }

  bindConsumer(user: CurrentUser, body: BindConsumerInput) {
    return this.consumers.bind(body, user);
  }

  unbindConsumer(user: CurrentUser, body: { id: number }) {
    return this.consumers.unbind(body.id, user);
  }

  // ---------- 记忆提炼与回流 ----------

  consolidate(user: CurrentUser, body: ConsolidateInput) {
    return this.memoryService.consolidate(body, user);
  }

  recall(
    user: CurrentUser,
    body: {
      spaceId?: number;
      query: string;
      topK: number;
      maxChars: number;
    },
  ) {
    return this.searchService.recall(body, user);
  }

  /** 跨模块统一检索（kb_retrieve）：任意板块/技能挂知识检索的同一出口。 */
  retrieve(user: CurrentUser, body: RetrieveInput) {
    return this.retrieveService.retrieve(user, body);
  }

  /** 业务板块知识增强（统一挂载）：按 consumerType 召回 + 综合作答。 */
  assist(user: CurrentUser, body: AssistInput) {
    return this.assistService.assist(user, body, {
      module: body.consumerType || 'kb',
    });
  }

  // ---------- 统计与时间线 ----------

  indexStats(user: CurrentUser, query: { spaceId: number }) {
    return this.graphService.indexStats(query.spaceId, user);
  }

  logs(user: CurrentUser, query: PageQuery & { spaceId: number }) {
    return this.graphService.logs(query, user);
  }
}
