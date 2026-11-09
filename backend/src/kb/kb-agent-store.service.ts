import type { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import { text } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import { keywordScore } from '../ai/retrieval-kernel';
import { LIBRARY_TYPE_LABELS, libraryTypeOf } from '../content/library-extract';
import { KbIngestService } from './kb-ingest.service';
import { KbPageService } from './kb-page.service';
import { KbSearchService } from './kb-search.service';
import { KbSourceService } from './kb-source.service';
import { KbSpaceService } from './kb-space.service';
import { clip, iso, normalizeSlug } from './kb-util';

/**
 * 智能体的记忆与资料在知识库里的落点（§10.4 整合）：
 * - 长期记忆：账号/分身各一页知识页（AGENT 空间，slug 固定+幂等覆盖），
 *   因此长期记忆天然进检索、进图谱、进时间线台账，不再单独维护一张记忆表；
 * - 资料库：数字资产里的文档落成该空间的「资料（KbSource）」并跑一次摄取编译，
 *   检索/精读/改写全部走知识库同一套机制（不再有第二套切块与检索）。
 * 只有一处存储决策（都在 AGENT 空间的知识库表），Agent 侧服务只做翻译。
 */

export type AgentMemoryEntry = {
  id: number;
  personaId: number;
  kind: string;
  content: string;
  source: string;
  createdAt: string;
};

/** 资料条目视图：id＝知识库资料（KbSource）编号，assetId＝来源数字资产台账行编号。 */
export type AgentDocView = {
  id: number;
  assetId: number;
  source: 'asset' | 'report';
  name: string;
  type: string;
  url: string;
  fileSize: number;
  charCount: number;
  nodeCount: number;
  status: 'ready' | 'empty' | 'failed';
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentDocNode = {
  id: number;
  itemId: number;
  itemName: string;
  kind: string;
  path: string;
  ordinal: number;
  chars: number;
  content: string;
};

export type AgentDocCandidate = {
  nodeId: number;
  itemId: number;
  itemName: string;
  kind: string;
  path: string;
  content: string;
  score: number;
};

export type AgentDocSearch = {
  hits: AgentDocCandidate[];
  /** 参与检索的资料名（用于「检索范围」展示） */
  scope: string[];
};

export type AgentDocInput = {
  assetId: number;
  source: 'asset' | 'report';
  name: string;
  url: string;
  fileSize: number;
  text: string;
  note: string;
};

/** 待审 AI 改写视图（对齐旧「待确认改写」的形状，前端迁移期不用改渲染）。 */
export type AgentEditView = {
  id: number;
  itemId: number;
  itemName: string;
  nodeId: number;
  nodePath: string;
  reason: string;
  before: string;
  after: string;
  status: string;
  createdAt: string;
};

const MEMORY_SLUG_ACCOUNT = 'long-term-memory-account';
const MEMORY_TAG = 'long-term-memory';
const MEMORY_BLOCK_MAX_CHARS = 16000;

function memorySlug(personaId: number) {
  return personaId > 0
    ? `long-term-memory-persona-${personaId}`
    : MEMORY_SLUG_ACCOUNT;
}

function parseMemoryLines(body: string): string[] {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

function toMemoryBody(lines: string[]) {
  return lines.map((line) => `- ${line}`).join('\n');
}

function docStatus(status: string): AgentDocView['status'] {
  if (status === 'INGESTED') return 'ready';
  if (status === 'FAILED') return 'failed';
  return 'empty';
}

export class KbAgentStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
    private readonly pages: KbPageService,
    private readonly sources: KbSourceService,
    private readonly ingest: KbIngestService,
    private readonly search: KbSearchService,
  ) {}

  private async agentSpaceId(userId: string) {
    return (await this.spaces.ensureAgentSpace(userId)).id;
  }

  private async readMemoryPage(userId: string, personaId: number) {
    const spaceId = await this.agentSpaceId(userId);
    return this.prisma.kbPage.findUnique({
      where: {
        spaceId_slug: { spaceId, slug: normalizeSlug(memorySlug(personaId)) },
      },
    });
  }

  private memoryEntriesFrom(
    page: { body: string; updatedAt: Date } | null,
    personaId: number,
  ) {
    if (!page) return [];
    return parseMemoryLines(page.body).map((content, index) => ({
      id: index + 1,
      personaId,
      kind: 'fact',
      content,
      source: 'store',
      createdAt: iso(page.updatedAt),
    }));
  }

  /** 请求作用域的记忆条目：personaId=0 只读账号共用，>0 只读该分身。 */
  async readMemoryEntries(userId: string, personaId: number) {
    return this.memoryEntriesFrom(
      await this.readMemoryPage(userId, personaId),
      personaId,
    );
  }

  /** 注入提示词：账号共用永远注入，选定分身时叠加它自己的那一页。 */
  async memoryBlock(userId: string, personaId: number) {
    const pages = [await this.readMemoryPage(userId, 0)];
    if (personaId > 0) pages.push(await this.readMemoryPage(userId, personaId));
    const lines = pages.flatMap((page) =>
      page ? parseMemoryLines(page.body) : [],
    );
    const block = lines.map((line) => `- ${line}`).join('\n');
    return block.length > MEMORY_BLOCK_MAX_CHARS
      ? block.slice(-MEMORY_BLOCK_MAX_CHARS)
      : block;
  }

  private async memoryTitle(userId: string, personaId: number) {
    if (personaId <= 0) return '长期记忆 · 账号共用';
    const persona = await this.prisma.contentAgentPersona.findFirst({
      where: { id: personaId, userId },
      select: { name: true },
    });
    return `长期记忆 · ${persona?.name || `数字分身 #${personaId}`}`;
  }

  /** 整段编辑：只重建当前作用域（账号共用或某个分身）的那一页。 */
  async replaceMemory(user: CurrentUser, personaId: number, lines: string[]) {
    const spaceId = await this.agentSpaceId(user.userId);
    const title = await this.memoryTitle(user.userId, personaId);
    // 记忆即知识页：仍走 writePage 同一套写入（切块/图谱/台账），因此记忆天然可检索
    await this.pages.writePage(
      {
        spaceId,
        slug: memorySlug(personaId),
        type: 'CONCEPT',
        title,
        body: toMemoryBody(lines),
        frontmatter: {
          tags: ['memory', MEMORY_TAG],
          personaId,
          kind: MEMORY_TAG,
        },
        status: 'PUBLISHED',
        sourceIds: [],
      },
      user,
    );
    return this.readMemoryEntries(user.userId, personaId);
  }

  /** 删除某个作用域的记忆页（删数字分身时调用；共用记忆 personaId=0 不动）。 */
  async removeMemory(user: CurrentUser, personaId: number) {
    const page = await this.readMemoryPage(user.userId, personaId);
    if (page) await this.pages.deletePage(page.id, user);
  }

  // ---------- 资料库（KbSource + 摄取产物） ----------

  private async docRows(spaceId: number, ids?: number[]) {
    return this.prisma.kbSource.findMany({
      where: { spaceId, ...(ids?.length ? { id: { in: ids } } : {}) },
      orderBy: { id: 'desc' },
      take: 200,
    });
  }

  /** 每条资料的可检索规模：其摄取产物页的分块数。 */
  private async nodeCounts(sourceIds: number[]) {
    if (!sourceIds.length) return new Map<number, number>();
    const links = await this.prisma.kbPageSource.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { pageId: true, sourceId: true },
    });
    if (!links.length) return new Map<number, number>();
    const chunks = await this.prisma.kbChunk.findMany({
      where: { pageId: { in: links.map((link) => link.pageId) } },
      select: { pageId: true },
    });
    const byPage = new Map<number, number>();
    for (const chunk of chunks) {
      byPage.set(chunk.pageId, (byPage.get(chunk.pageId) || 0) + 1);
    }
    const bySource = new Map<number, number>();
    for (const link of links) {
      bySource.set(
        link.sourceId,
        (bySource.get(link.sourceId) || 0) + (byPage.get(link.pageId) || 0),
      );
    }
    return bySource;
  }

  private docView(
    row: {
      id: number;
      title: string;
      assetId: number;
      originUrl: string;
      text: string;
      status: string;
      error: string;
      createdAt: Date;
      updatedAt: Date;
    },
    nodeCount: number,
  ): AgentDocView {
    return {
      id: row.id,
      assetId: row.assetId,
      source: 'asset' as const,
      name: row.title,
      type: libraryTypeOf(row.title, row.originUrl) || 'md',
      url: row.originUrl,
      fileSize: 0,
      charCount: row.text.length,
      nodeCount,
      status: docStatus(row.status),
      note:
        row.status === 'INGESTED'
          ? ''
          : row.error || '还没编译，去知识库点「摄取」',
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async listDocs(user: CurrentUser): Promise<AgentDocView[]> {
    const spaceId = await this.agentSpaceId(user.userId);
    const rows = await this.docRows(spaceId);
    const counts = await this.nodeCounts(rows.map((row) => row.id));
    return rows.map((row) => this.docView(row, counts.get(row.id) || 0));
  }

  private async readDoc(user: CurrentUser, id: number) {
    if (!Number.isInteger(id) || id <= 0) return null;
    const spaceId = await this.agentSpaceId(user.userId);
    const row = await this.prisma.kbSource.findFirst({
      where: { id, spaceId },
    });
    if (!row) return null;
    const counts = await this.nodeCounts([row.id]);
    return { row, view: this.docView(row, counts.get(row.id) || 0) };
  }

  /** 从数字资产收一份文档：落资料 → 立刻跑一次摄取编译（失败不阻断，状态如实回显）。 */
  async addDoc(user: CurrentUser, input: AgentDocInput): Promise<AgentDocView> {
    const spaceId = await this.agentSpaceId(user.userId);
    const source = await this.sources.putExtracted(
      {
        spaceId,
        kind: 'article',
        type: 'UPLOAD',
        title: input.name,
        text: input.text,
        assetId: input.assetId,
        originUrl: input.url,
        errorNote: input.note || undefined,
      },
      user,
    );
    if (source.status === 'PENDING') {
      await this.ingest.ingest({ spaceId, sourceId: source.id }, user);
    }
    const fresh = await this.readDoc(user, source.id);
    if (fresh) return fresh.view;
    const rows = await this.docRows(spaceId, [source.id]);
    const counts = await this.nodeCounts([source.id]);
    return this.docView(rows[0], counts.get(source.id) || 0);
  }

  async removeDoc(user: CurrentUser, id: number) {
    const spaceId = await this.agentSpaceId(user.userId);
    const row = await this.prisma.kbSource.findFirst({
      where: { id, spaceId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '资料不存在');
    const links = await this.prisma.kbPageSource.findMany({
      where: { sourceId: id },
      select: { pageId: true },
    });
    for (const link of links) await this.pages.deletePage(link.pageId, user);
    await this.prisma.kbIngestJob.deleteMany({ where: { sourceId: id } });
    await this.prisma.kbSource.delete({ where: { id } });
    return { removed: true, name: row.title };
  }

  /** 整篇精读：对齐旧「资料」条目形状（正文 + 规模）。 */
  async readDocBody(user: CurrentUser, id: number) {
    const doc = await this.readDoc(user, id);
    if (!doc) return null;
    return {
      id: doc.view.id,
      name: doc.view.name,
      status: doc.view.status,
      note: doc.view.note,
      text: doc.row.text,
      charCount: doc.view.charCount,
      nodeCount: doc.view.nodeCount,
    };
  }

  /** 精读单元：资料摄取产物页的分块，按页内顺序列出。 */
  async listNodes(user: CurrentUser, id: number): Promise<AgentDocNode[]> {
    const doc = await this.readDoc(user, id);
    if (!doc) throw new BusinessException(ErrorCode.NOT_FOUND, '资料不存在');
    const links = await this.prisma.kbPageSource.findMany({
      where: { sourceId: id },
      select: { pageId: true },
    });
    const chunks = await this.prisma.kbChunk.findMany({
      where: { pageId: { in: links.map((link) => link.pageId) } },
      orderBy: [{ pageId: 'asc' }, { ordinal: 'asc' }],
      take: 1500,
    });
    return chunks.map((chunk) => ({
      id: chunk.id,
      itemId: id,
      itemName: doc.view.name,
      kind: 'paragraph',
      path: `片段 ${chunk.ordinal + 1}`,
      ordinal: chunk.ordinal,
      chars: chunk.text.length,
      content: chunk.text,
    }));
  }

  async readNode(user: CurrentUser, nodeId: number) {
    if (!Number.isInteger(nodeId) || nodeId <= 0) return null;
    const chunk = await this.prisma.kbChunk.findUnique({
      where: { id: nodeId },
    });
    if (!chunk) return null;
    const link = await this.prisma.kbPageSource.findFirst({
      where: { pageId: chunk.pageId },
      select: { sourceId: true },
    });
    if (!link) return null;
    const doc = await this.readDoc(user, link.sourceId);
    if (!doc) return null;
    return {
      itemName: doc.view.name,
      status: doc.view.status,
      node: {
        id: chunk.id,
        itemId: link.sourceId,
        kind: 'paragraph',
        path: `片段 ${chunk.ordinal + 1}`,
        ordinal: chunk.ordinal,
        chars: chunk.text.length,
        content: chunk.text,
      },
    };
  }

  /** 资料检索召回：走知识库混合检索（同一套词面+向量），再回到分块粒度给出处。 */
  async searchDocs(
    user: CurrentUser,
    question: string,
    docIds: number[],
    limit: number,
  ): Promise<AgentDocSearch> {
    const spaceId = await this.agentSpaceId(user.userId);
    const rows = await this.docRows(
      spaceId,
      docIds.length ? docIds : undefined,
    );
    const scope = rows.map((row) => row.title);
    const found = await this.search.search(
      spaceId,
      question,
      Math.max(limit, 8),
      user,
    );
    const wanted = new Set(docIds);
    const picked = found.hits.filter(
      (hit) => !wanted.size || hit.sourceIds.some((id) => wanted.has(id)),
    );
    if (!picked.length) return { hits: [], scope };
    const scoreByPage = new Map(
      found.hits.map((hit) => [hit.pageId, hit.score]),
    );
    const links = await this.prisma.kbPageSource.findMany({
      where: { pageId: { in: picked.map((hit) => hit.pageId) } },
    });
    const sourceByPage = new Map(
      links.map((link) => [link.pageId, link.sourceId]),
    );
    const chunks = await this.prisma.kbChunk.findMany({
      where: { pageId: { in: picked.map((hit) => hit.pageId) } },
      orderBy: [{ pageId: 'asc' }, { ordinal: 'asc' }],
      take: 1500,
    });
    const best = new Map<
      number,
      { id: number; ordinal: number; text: string; score: number }
    >();
    for (const chunk of chunks) {
      const score = keywordScore(question, chunk.text);
      const cur = best.get(chunk.pageId);
      if (!cur || score > cur.score) {
        best.set(chunk.pageId, {
          id: chunk.id,
          ordinal: chunk.ordinal,
          text: chunk.text,
          score,
        });
      }
    }
    return {
      scope,
      hits: picked.map((hit) => {
        const chunk = best.get(hit.pageId);
        return {
          nodeId: chunk?.id || hit.pageId,
          itemId: sourceByPage.get(hit.pageId) || 0,
          itemName: hit.title,
          kind: 'paragraph',
          path: `片段 ${(chunk?.ordinal ?? 0) + 1}`,
          content: chunk?.text || hit.excerpt,
          score: scoreByPage.get(hit.pageId) ?? hit.score,
        };
      }),
    };
  }

  /** 送给系统提示的资料清单：只列名字与规模，不塞正文（正文按需检索）。 */
  async docsBlock(userId: string, ids: number[] = []) {
    const scopedIds = ids.filter((id) => Number.isInteger(id) && id > 0);
    const spaceId = await this.agentSpaceId(userId);
    const rows = (
      await this.docRows(spaceId, scopedIds.length ? scopedIds : undefined)
    ).filter((row) => row.status === 'INGESTED');
    if (!rows.length) return { block: '', scoped: scopedIds.length > 0 };
    const counts = await this.nodeCounts(rows.map((row) => row.id));
    const lines = rows.map((row) => {
      const type = libraryTypeOf(row.title, row.originUrl) || 'md';
      return `- #${row.id} 《${row.title}》（${LIBRARY_TYPE_LABELS[type] || type}·${counts.get(row.id) || 0} 个片段）`;
    });
    return { scoped: scopedIds.length > 0, block: lines.join('\n') };
  }

  private editView(row: {
    id: number;
    title: string;
    body: string;
    updatedAt: Date;
    frontmatter: unknown;
  }): AgentEditView {
    const meta = (row.frontmatter || {}) as Record<string, unknown>;
    return {
      id: row.id,
      itemId: Number(meta.sourceId || 0),
      itemName: row.title,
      nodeId: 0,
      nodePath: '整篇',
      reason: text(meta.reason),
      before: '',
      after: row.body,
      status: 'pending',
      createdAt: iso(row.updatedAt),
    };
  }

  /** 待审 AI 改写：Agent 空间里 PENDING_REVIEW 的页（等同旧的「待确认改写」）。 */
  async pendingEdits(user: CurrentUser): Promise<AgentEditView[]> {
    const spaceId = await this.agentSpaceId(user.userId);
    const rows = await this.prisma.kbPage.findMany({
      where: { spaceId, status: 'PENDING_REVIEW' },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return rows.map((row) => this.editView(row));
  }

  /** 接受/放弃 AI 改写：接受＝放行成 PUBLISHED，放弃＝退回 DRAFT。 */
  async decideEdit(user: CurrentUser, pageId: number, accept: boolean) {
    const page = await this.prisma.kbPage.findUnique({ where: { id: pageId } });
    const spaceId = await this.agentSpaceId(user.userId);
    if (!page || page.spaceId !== spaceId) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这条修改不存在，或已经处理过了',
      );
    }
    await this.pages.reviewPage(
      {
        id: pageId,
        decision: accept ? 'publish' : 'reject',
        note: accept ? '接受 AI 改写' : '放弃 AI 改写',
      },
      user,
    );
    return {
      ...this.editView(page),
      status: accept ? 'accepted' : 'rejected',
      after: accept ? page.body : '',
    };
  }

  /** 资料改写：AI 不直接改源（源不可变），改写落在摄取产物页并进待审。 */
  async proposeDocEdit(
    user: CurrentUser,
    docId: number,
    content: string,
    reason: string,
  ): Promise<{ pageId: number; before: string; after: string } | null> {
    const doc = await this.readDoc(user, docId);
    if (!doc) return null;
    const links = await this.prisma.kbPageSource.findMany({
      where: { sourceId: docId },
      select: { pageId: true },
    });
    const pageId = links[0]?.pageId || 0;
    const existing = pageId
      ? await this.prisma.kbPage.findUnique({ where: { id: pageId } })
      : null;
    const before = existing?.body || doc.row.text;
    const page = await this.pages.writePage(
      {
        spaceId: doc.row.spaceId,
        slug: existing?.slug || `source-${docId}`,
        type: 'SUMMARY',
        title: existing?.title || `${doc.view.name} · 摘要`,
        body: clip(content, 200_000),
        frontmatter: {
          tags: ['ingest', 'agent-edit'],
          sourceId: docId,
          reason: clip(reason, 300),
        },
        status: 'PENDING_REVIEW',
        sourceIds: [docId],
      },
      user,
    );
    return { pageId: page.id, before, after: content };
  }
}
