import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { httpRequest } from '../http/transport';
import { AipddAssetClient } from './aipdd-asset.client';
import { DigitalAssetService } from './digital-asset.service';
import { ContentModelSettingService } from './model-setting.service';
import { protocolHeaders } from './model-catalog.service';
import {
  extractLibraryText,
  LIBRARY_TYPE_LABELS,
  libraryTypeOf,
  type LibraryBlock,
} from './library-extract';

/** 重排用的大模型凭据：本轮对话就用本轮渠道；记忆页测试则回落「模型设置 → 文本」槽位。 */
export type LibraryLlm = {
  base: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'anthropic';
};

const LIBRARY_ITEMS_MAX = 200;
const SOURCE_BYTES_MAX = 20 * 1024 * 1024;
const PUBLISH_CHARS_MAX = 200_000;
const DRAFT_CHARS_MAX = 60_000;
const NODES_SCAN_MAX = 3000;
const CANDIDATES = 24;
const HITS_MAX = 8;
const SNIPPET_CHARS = 360;

type ItemRow = {
  id: number;
  aipddAssetId: number;
  source: string;
  name: string;
  type: string;
  url: string;
  fileSize: number;
  text: string;
  charCount: number;
  nodeCount: number;
  status: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
};

type NodeRow = {
  id: number;
  itemId: number;
  kind: string;
  path: string;
  ordinal: number;
  content: string;
  chars: number;
};

type DraftRow = {
  id: number;
  itemId: number;
  nodeId: number;
  nodePath: string;
  reason: string;
  before: string;
  after: string;
  status: string;
  createdAt: Date;
};

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/** 中文按二元组、英文按词切：不需要分词服务，也足够做候选召回。 */
function tokenize(value: string) {
  const lowered = value.toLowerCase();
  const tokens: string[] = [];
  const latin = lowered.match(/[a-z0-9_]{2,}/g);
  if (latin) tokens.push(...latin);
  for (const run of lowered.match(CJK_RUN) || []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }
  return tokens;
}

function snippetOf(content: string, tokens: string[]) {
  const plain = content.replace(/\s+/g, ' ').trim();
  if (plain.length <= SNIPPET_CHARS) return plain;
  const lowered = plain.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const index = lowered.indexOf(token);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) return `${plain.slice(0, SNIPPET_CHARS)}…`;
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(plain.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

function normalizeIds(raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(
      list
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ].slice(0, 50);
}

function iso(value: Date) {
  return value.toISOString();
}

/**
 * Agent 资料库：把数字资产里的文档收进来，切片段、做检索，供模型按问题召回片段+出处。
 * 归属严格按登录账号（与数字资产同一个台账口径）：
 * 用户看不到的资产，Agent 也读不到；原件从数字资产删掉后，这篇自动停止参与检索。
 */
export class ContentAgentLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly client: AipddAssetClient,
    private readonly digitalAssets: DigitalAssetService,
    private readonly identity: IdentityService,
  ) {}

  private shapeItem(row: ItemRow) {
    return {
      id: row.id,
      aipddAssetId: row.aipddAssetId,
      source:
        row.source === 'report' ? ('report' as const) : ('asset' as const),
      name: row.name,
      type: row.type,
      url: row.url,
      fileSize: row.fileSize,
      charCount: row.charCount,
      nodeCount: row.nodeCount,
      status: row.status,
      note: row.note,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private shapeNode(row: NodeRow, itemName: string) {
    return {
      id: row.id,
      itemId: row.itemId,
      itemName,
      kind: row.kind,
      path: row.path,
      ordinal: row.ordinal,
      chars: row.chars,
      content: row.content,
    };
  }

  private shapeDraft(row: DraftRow, itemName: string) {
    return {
      id: row.id,
      itemId: row.itemId,
      itemName,
      nodeId: row.nodeId,
      nodePath: row.nodePath,
      reason: row.reason,
      before: row.before,
      after: row.after,
      status: row.status,
      createdAt: iso(row.createdAt),
    };
  }

  /** 原件从数字资产台账里消失（用户删了）→ 标 missing，检索直接跳过。 */
  private async syncMissing(userId: string) {
    const rows = await this.prisma.contentAgentLibraryItem.findMany({
      where: {
        userId,
        source: 'asset',
        aipddAssetId: { gt: 0 },
        status: { in: ['ready', 'empty', 'failed'] },
      },
      select: { id: true, aipddAssetId: true },
    });
    if (!rows.length) return;
    const alive = await this.prisma.digitalAssetEntry.findMany({
      where: {
        userId,
        aipddAssetId: { in: rows.map((row) => row.aipddAssetId) },
      },
      select: { aipddAssetId: true },
    });
    const aliveSet = new Set(alive.map((row) => row.aipddAssetId));
    const gone = rows.filter((row) => !aliveSet.has(row.aipddAssetId));
    if (!gone.length) return;
    await this.prisma.contentAgentLibraryItem.updateMany({
      where: { userId, id: { in: gone.map((row) => row.id) } },
      data: {
        status: 'missing',
        note: '原件已从数字资产里删除，这篇不再参与检索',
      },
    });
  }

  async list(user: CurrentUser) {
    await this.syncMissing(user.userId);
    const rows = await this.prisma.contentAgentLibraryItem.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
      take: LIBRARY_ITEMS_MAX,
    });
    return rows.map((row) => this.shapeItem(row as ItemRow));
  }

  private async createItem(
    user: CurrentUser,
    input: {
      aipddAssetId: number;
      source: 'asset' | 'report';
      name: string;
      type: string;
      url: string;
      fileSize: number;
      text: string;
      blocks: LibraryBlock[];
      note: string;
    },
  ) {
    const blocks = input.blocks
      .filter((block) => block.content.trim())
      .slice(0, 1500);
    const status = input.text.trim() ? 'ready' : 'empty';
    const note =
      input.note || (status === 'empty' ? '没能从这份文件里读出文字' : '');
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentAgentLibraryItem.create({
        data: {
          userId: user.userId,
          aipddAssetId: input.aipddAssetId,
          source: input.source,
          name: input.name.slice(0, 200),
          type: input.type,
          url: input.url,
          fileSize: input.fileSize,
          text: input.text,
          charCount: input.text.length,
          nodeCount: blocks.length,
          status,
          note: note.slice(0, 200),
        },
      });
      if (blocks.length) {
        await tx.contentAgentLibraryNode.createMany({
          data: blocks.map((block, index) => ({
            itemId: item.id,
            userId: user.userId,
            kind: block.kind,
            path: block.path.slice(0, 300),
            ordinal: index,
            content: block.content,
            chars: block.content.length,
          })),
        });
      }
      return this.shapeItem(item);
    });
  }

  /** 整篇改写后重建节点：按原文件类型重新切块。 */
  private async rebuildNodes(
    user: CurrentUser,
    item: ItemRow,
    content: string,
  ) {
    const extraction = extractLibraryText(
      new Uint8Array(Buffer.from(content, 'utf8')),
      item.type === 'md' ? 'md' : 'txt',
      { name: item.name },
    );
    const blocks = extraction.blocks
      .filter((block) => block.content.trim())
      .slice(0, 1500);
    await this.prisma.$transaction([
      this.prisma.contentAgentLibraryNode.deleteMany({
        where: { itemId: item.id, userId: user.userId },
      }),
      ...(blocks.length
        ? [
            this.prisma.contentAgentLibraryNode.createMany({
              data: blocks.map((block, index) => ({
                itemId: item.id,
                userId: user.userId,
                kind: block.kind,
                path: block.path.slice(0, 300),
                ordinal: index,
                content: block.content,
                chars: block.content.length,
              })),
            }),
          ]
        : []),
      this.prisma.contentAgentLibraryItem.update({
        where: { id: item.id },
        data: {
          text: content,
          charCount: content.length,
          nodeCount: blocks.length,
          status: content.trim() ? 'ready' : 'empty',
          note: content.trim() ? '' : '正文为空，这篇不参与检索',
        },
      }),
    ]);
  }

  /** 从数字资产挑文档收进资料库：只认本账号台账里的资产。 */
  async add(user: CurrentUser, body: Record<string, unknown>) {
    const ids = normalizeIds(body.assetIds);
    if (!ids.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择要放进资料库的数字资产',
      );
    }
    const entries = await this.prisma.digitalAssetEntry.findMany({
      where: { userId: user.userId, aipddAssetId: { in: ids } },
    });
    if (!entries.length) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这些资产不存在或不属于当前账号',
      );
    }
    const existing = await this.prisma.contentAgentLibraryItem.findMany({
      where: { userId: user.userId, aipddAssetId: { in: ids } },
      select: { aipddAssetId: true },
    });
    const existingIds = new Set(existing.map((row) => row.aipddAssetId));
    const skipped: string[] = [];
    let created = 0;
    for (const entry of entries) {
      if (existingIds.has(entry.aipddAssetId)) continue;
      const name =
        readText(entry.name).trim() ||
        decodeURIComponent(entry.url || '')
          .split('/')
          .pop() ||
        '未命名文档';
      const type = libraryTypeOf(name, entry.url);
      if (!type) {
        skipped.push(`${name}：不是可检索的文字文档`);
        continue;
      }
      if (entry.fileSize > SOURCE_BYTES_MAX) {
        skipped.push(`${name}：文件超过 20MB，请先拆分`);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.client.download(entry.url);
      } catch {
        skipped.push(`${name}：原件下载失败`);
        continue;
      }
      if (bytes.length > SOURCE_BYTES_MAX) {
        skipped.push(`${name}：文件超过 20MB，请先拆分`);
        continue;
      }
      let extraction;
      try {
        extraction = extractLibraryText(bytes, type, { name });
      } catch (error) {
        await this.createItem(user, {
          aipddAssetId: entry.aipddAssetId,
          source: 'asset',
          name,
          type,
          url: entry.url,
          fileSize: entry.fileSize,
          text: '',
          blocks: [],
          note:
            error instanceof Error ? error.message.slice(0, 200) : '解析失败',
        });
        created += 1;
        continue;
      }
      await this.createItem(user, {
        aipddAssetId: entry.aipddAssetId,
        source: 'asset',
        name,
        type,
        url: entry.url,
        fileSize: entry.fileSize,
        text: extraction.text,
        blocks: extraction.blocks,
        note: extraction.note,
      });
      created += 1;
    }
    if (!created && skipped.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `没能收进资料库：${skipped.slice(0, 5).join('；')}`,
      );
    }
    await this.identity.audit(
      user.userId,
      '资料库收录数字资产',
      `${created} 份文档`,
    );
    return { items: await this.list(user), skipped };
  }

  private async ownedItem(user: CurrentUser, id: string) {
    const itemId = Number(id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资料编号无效');
    }
    const row = await this.prisma.contentAgentLibraryItem.findFirst({
      where: { id: itemId, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '资料不存在');
    return row as ItemRow;
  }

  async remove(user: CurrentUser, id: string) {
    const item = await this.ownedItem(user, id);
    await this.prisma.$transaction([
      this.prisma.contentAgentLibraryNode.deleteMany({
        where: { itemId: item.id, userId: user.userId },
      }),
      this.prisma.contentAgentLibraryDraft.deleteMany({
        where: { itemId: item.id, userId: user.userId },
      }),
      this.prisma.contentAgentLibraryItem.delete({ where: { id: item.id } }),
    ]);
    await this.identity.audit(
      user.userId,
      '资料库移除资料',
      item.name || `#${item.id}`,
    );
    return { removed: true };
  }

  async nodes(user: CurrentUser, id: string) {
    const item = await this.ownedItem(user, id);
    const rows = await this.prisma.contentAgentLibraryNode.findMany({
      where: { itemId: item.id, userId: user.userId },
      orderBy: { ordinal: 'asc' },
    });
    return rows.map((row) => this.shapeNode(row as NodeRow, item.name));
  }

  /** 候选召回：BM25-lite（中文二元组）打分，只取前 N 个片段进重排。 */
  private lexical(question: string, nodes: (NodeRow & { itemName: string })[]) {
    const queryTokens = [...new Set(tokenize(question))];
    if (!queryTokens.length || !nodes.length) return [];
    const docs = nodes.map((node) => {
      const counts = new Map<string, number>();
      const tokens = tokenize(`${node.path} ${node.content}`);
      for (const token of tokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
      return { node, counts, length: tokens.length };
    });
    const avgLength =
      docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
    const df = new Map<string, number>();
    for (const token of queryTokens) {
      let count = 0;
      for (const doc of docs) if (doc.counts.has(token)) count += 1;
      df.set(token, count);
    }
    const k1 = 1.4;
    const b = 0.75;
    const scored = docs.map((doc) => {
      let score = 0;
      for (const token of queryTokens) {
        const tf = doc.counts.get(token) || 0;
        if (!tf) continue;
        const idf = Math.log(
          1 +
            (docs.length - (df.get(token) || 0) + 0.5) /
              ((df.get(token) || 0) + 0.5),
        );
        const norm =
          tf + k1 * (1 - b + (b * doc.length) / Math.max(1, avgLength));
        score += idf * ((tf * (k1 + 1)) / norm);
      }
      return { node: doc.node, score };
    });
    return scored
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, CANDIDATES);
  }

  private async completeText(
    llm: LibraryLlm,
    prompt: string,
    operation: string,
  ) {
    const base = String(llm.base || '').replace(/\/+$/, '');
    if (!base || !llm.apiKey) throw new Error('没有可用的文本渠道');
    const anthropic = llm.protocol === 'anthropic';
    const response = await httpRequest<string>(
      anthropic ? `${base}/messages` : `${base}/chat/completions`,
      {
        method: 'POST',
        headers: {
          ...protocolHeaders(llm.apiKey, llm.protocol),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          anthropic
            ? {
                model: llm.model,
                max_tokens: 800,
                messages: [{ role: 'user', content: prompt }],
              }
            : {
                model: llm.model,
                temperature: 0,
                max_tokens: 800,
                messages: [{ role: 'user', content: prompt }],
              },
        ),
        timeoutMs: 30_000,
        readAs: 'text',
        operation,
      },
    );
    if (!response.ok) throw new Error(`模型通道返回 HTTP ${response.status}`);
    const payload = JSON.parse(response.data) as Record<string, unknown>;
    if (anthropic) {
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      return blocks
        .map((block) =>
          block &&
          typeof block === 'object' &&
          typeof (block as Record<string, unknown>).text === 'string'
            ? String((block as Record<string, unknown>).text)
            : '',
        )
        .join('');
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = (choices[0] || {}) as Record<string, unknown>;
    const message = (first.message || {}) as Record<string, unknown>;
    return typeof message.content === 'string' ? message.content : '';
  }

  /**
   * 语义重排：按「问题」而不是关键词挑片段。重排失败就退回词面顺序，
   * 并在 note 里说明——检索这件事不能因为辅助链路失败就整体不可用。
   */
  private async rerank(
    llm: LibraryLlm,
    question: string,
    candidates: { node: NodeRow & { itemName: string }; score: number }[],
  ) {
    if (candidates.length <= 1) return null;
    const listing = candidates
      .map((item, index) => {
        const where = item.node.path ? ` · ${item.node.path}` : '';
        return `[${index + 1}] 《${item.node.itemName}》${where}\n${item.node.content.slice(0, 600)}`;
      })
      .join('\n\n');
    const prompt = [
      '你是资料检索的重排器。用户的问题：',
      question,
      '',
      '下面是候选片段（方括号里是编号）。只保留能直接回答这个问题的片段，按相关度从高到低排序，给出 0~1 的分数；不相关的不要出现。',
      '只输出 JSON 数组，元素形如 {"i": 1, "score": 0.87}，不要输出其它文字。',
      '',
      listing,
    ].join('\n');
    let raw = '';
    try {
      raw = await this.completeText(llm, prompt, 'content:libraryRerank');
    } catch {
      return null;
    }
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const picked: {
      node: (typeof candidates)[number]['node'];
      score: number;
    }[] = [];
    for (const entry of parsed) {
      const index =
        typeof entry === 'number'
          ? entry
          : Number((entry as Record<string, unknown>)?.i ?? 0);
      const target = candidates[index - 1];
      if (!target) continue;
      const rawScore =
        typeof entry === 'object' && entry
          ? Number((entry as Record<string, unknown>).score ?? 0)
          : 0.5;
      picked.push({
        node: target.node,
        score: Number.isFinite(rawScore)
          ? Math.max(0, Math.min(1, rawScore))
          : 0.5,
      });
      if (picked.length >= HITS_MAX) break;
    }
    return picked.length ? picked : null;
  }

  private async llmOf(
    user: CurrentUser,
    token?: string,
  ): Promise<LibraryLlm | null> {
    try {
      const target = await this.settings.resolveTarget(user, 'text', token);
      return {
        base: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        protocol: target.protocol,
      };
    } catch {
      return null;
    }
  }

  async search(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
    options: { llm?: LibraryLlm; topK?: number } = {},
  ) {
    const question = readText(body.question).trim().slice(0, 2000);
    if (!question) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请把要查的问题写完整（一句完整的问题比关键词更容易召回）',
      );
    }
    const scopedIds = normalizeIds(body.libraryIds);
    await this.syncMissing(user.userId);
    const items = await this.prisma.contentAgentLibraryItem.findMany({
      where: {
        userId: user.userId,
        status: 'ready',
        ...(scopedIds.length ? { id: { in: scopedIds } } : {}),
      },
      select: { id: true, name: true },
      take: LIBRARY_ITEMS_MAX,
    });
    if (!items.length) {
      return {
        question,
        semantic: false,
        scope: [],
        hits: [],
        note: scopedIds.length
          ? '这次指定的资料不在资料库里，或已被删除'
          : '资料库里还没有可检索的资料',
      };
    }
    const names = new Map(items.map((item) => [item.id, item.name]));
    const nodeRows = await this.prisma.contentAgentLibraryNode.findMany({
      where: {
        userId: user.userId,
        itemId: { in: items.map((item) => item.id) },
      },
      orderBy: [{ itemId: 'asc' }, { ordinal: 'asc' }],
      take: NODES_SCAN_MAX,
      select: {
        id: true,
        itemId: true,
        kind: true,
        path: true,
        ordinal: true,
        content: true,
        chars: true,
      },
    });
    const nodes = nodeRows.map((row) => ({
      ...row,
      itemName: names.get(row.itemId) || '资料',
    }));
    const candidates = this.lexical(question, nodes);
    if (!candidates.length) {
      return {
        question,
        semantic: false,
        scope: items.map((item) => item.name),
        hits: [],
        note: '没有找到和这个问题相关的片段，可以换个问法，或先把资料收进资料库',
      };
    }
    const llm = options.llm ?? (await this.llmOf(user, token));
    const reranked = llm ? await this.rerank(llm, question, candidates) : null;
    const chosen = reranked
      ? reranked
      : candidates.map((item, index) => ({
          node: item.node,
          score: Math.max(0.01, 1 - index / Math.max(1, candidates.length)),
        }));
    const tokens = [...new Set(tokenize(question))];
    const limit = options.topK
      ? Math.max(1, Math.min(HITS_MAX, options.topK))
      : HITS_MAX;
    const hits = chosen.slice(0, limit).map((item) => ({
      nodeId: item.node.id,
      itemId: item.node.itemId,
      itemName: item.node.itemName,
      kind: item.node.kind,
      path: item.node.path,
      snippet: snippetOf(item.node.content, tokens),
      score: Math.round(item.score * 1000) / 1000,
    }));
    return {
      question,
      semantic: Boolean(reranked),
      scope: items.map((item) => item.name),
      hits,
      note: reranked
        ? ''
        : llm
          ? '语义重排没有跑通，先按词面相关度给出候选'
          : '没有可用的文本模型，先按词面相关度给出候选',
    };
  }

  /** 精读：按节点 id 读全文（片段往往不够用，模型要二次读全文再综合作答）。 */
  async readNode(user: CurrentUser, nodeId: number) {
    if (!Number.isInteger(nodeId) || nodeId <= 0) return null;
    const row = await this.prisma.contentAgentLibraryNode.findFirst({
      where: { id: nodeId, userId: user.userId },
    });
    if (!row) return null;
    const item = await this.prisma.contentAgentLibraryItem.findFirst({
      where: { id: row.itemId, userId: user.userId },
      select: { name: true, status: true },
    });
    return {
      node: row as NodeRow,
      itemName: item?.name || '资料',
      status: item?.status || 'ready',
    };
  }

  async readItem(user: CurrentUser, itemId: number) {
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    const row = await this.prisma.contentAgentLibraryItem.findFirst({
      where: { id: itemId, userId: user.userId },
    });
    return row ? (row as ItemRow) : null;
  }

  /** 送给系统提示的资料清单：只列名字与规模，不塞正文（正文按需检索）。 */
  async promptBlock(userId: string, ids: number[] = []) {
    const scopedIds = ids.filter((id) => Number.isInteger(id) && id > 0);
    const where = {
      userId,
      status: 'ready' as const,
      ...(scopedIds.length ? { id: { in: scopedIds } } : {}),
    };
    const rows = await this.prisma.contentAgentLibraryItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, name: true, type: true, nodeCount: true },
    });
    if (!rows.length) return { block: '', scoped: scopedIds.length > 0 };
    const lines = rows.map(
      (row) =>
        `- #${row.id} 《${row.name}》（${LIBRARY_TYPE_LABELS[row.type] || row.type}·${row.nodeCount} 个片段）`,
    );
    return {
      scoped: scopedIds.length > 0,
      block: lines.join('\n'),
    };
  }

  /** AI 改 Markdown 先落草稿：用户点接受才写回正文，绝不静默覆盖。 */
  async proposeEdit(user: CurrentUser, body: Record<string, unknown>) {
    const item = await this.ownedItem(user, readText(body.itemId));
    const nodeIdRaw = Number(body.nodeId || 0);
    const nodeId = Number.isInteger(nodeIdRaw) && nodeIdRaw > 0 ? nodeIdRaw : 0;
    const after = readText(body.content).trim();
    if (!after) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '改写内容为空');
    }
    let before = item.text;
    let nodePath = '整篇';
    if (nodeId) {
      const node = await this.prisma.contentAgentLibraryNode.findFirst({
        where: { id: nodeId, itemId: item.id, userId: user.userId },
      });
      if (!node) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '要改的片段不存在');
      }
      before = node.content;
      nodePath = node.path || '片段';
    }
    const draft = await this.prisma.contentAgentLibraryDraft.create({
      data: {
        userId: user.userId,
        itemId: item.id,
        nodeId,
        nodePath: nodePath.slice(0, 300),
        reason: readText(body.reason).trim().slice(0, 300),
        before: before.slice(0, DRAFT_CHARS_MAX),
        after: after.slice(0, DRAFT_CHARS_MAX),
        status: 'pending',
      },
    });
    return this.shapeDraft(draft, item.name);
  }

  async drafts(user: CurrentUser) {
    const rows = await this.prisma.contentAgentLibraryDraft.findMany({
      where: { userId: user.userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    if (!rows.length) return [];
    const items = await this.prisma.contentAgentLibraryItem.findMany({
      where: { userId: user.userId, id: { in: rows.map((row) => row.itemId) } },
      select: { id: true, name: true },
    });
    const names = new Map(items.map((item) => [item.id, item.name]));
    return rows.map((row) =>
      this.shapeDraft(row as DraftRow, names.get(row.itemId) || '资料'),
    );
  }

  async decideDraft(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const draftId = Number(id);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '修改编号无效');
    }
    const draft = await this.prisma.contentAgentLibraryDraft.findFirst({
      where: { id: draftId, userId: user.userId, status: 'pending' },
    });
    if (!draft) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这条修改不存在，或已经处理过了',
      );
    }
    const item = await this.prisma.contentAgentLibraryItem.findFirst({
      where: { id: draft.itemId, userId: user.userId },
    });
    if (!item) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '资料已不在资料库里');
    }
    const accept = body.accept === true;
    if (!accept) {
      const rejected = await this.prisma.contentAgentLibraryDraft.update({
        where: { id: draft.id },
        data: { status: 'rejected', decidedAt: new Date() },
      });
      return this.shapeDraft(rejected, item.name);
    }
    let content = draft.after;
    if (draft.nodeId > 0) {
      const node = await this.prisma.contentAgentLibraryNode.findFirst({
        where: { id: draft.nodeId, itemId: item.id, userId: user.userId },
      });
      if (!node) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '要改的片段不存在');
      }
      await this.prisma.contentAgentLibraryNode.update({
        where: { id: node.id },
        data: { content: draft.after, chars: draft.after.length },
      });
      const nodes = await this.prisma.contentAgentLibraryNode.findMany({
        where: { itemId: item.id, userId: user.userId },
        orderBy: { ordinal: 'asc' },
        select: { content: true },
      });
      content = nodes.map((row) => row.content).join('\n\n');
      await this.prisma.contentAgentLibraryItem.update({
        where: { id: item.id },
        data: {
          text: content,
          charCount: content.length,
          status: 'ready',
          note: '',
        },
      });
    } else {
      await this.rebuildNodes(user, item, content);
    }
    const accepted = await this.prisma.contentAgentLibraryDraft.update({
      where: { id: draft.id },
      data: { status: 'accepted', decidedAt: new Date() },
    });
    await this.identity.audit(
      user.userId,
      '资料库接受 AI 改写',
      item.name || `#${item.id}`,
    );
    return this.shapeDraft(accepted, item.name);
  }

  /**
   * 回流：Agent 产出的报告存成数字资产（台账照记），同一份正文也进资料库。
   * 平台上传失败时仍保留本地资料（正文已切好，照样能检索），只在 note 里说明。
   */
  async publish(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    const rawName = readText(body.name).trim().slice(0, 200) || 'Agent 报告';
    const name = rawName.toLowerCase().endsWith('.md')
      ? rawName
      : `${rawName}.md`;
    const content = readText(body.content).trim().slice(0, PUBLISH_CHARS_MAX);
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有可回流的正文');
    }
    let url = '';
    let assetId = 0;
    let note = '';
    try {
      const asset = await this.digitalAssets.uploadText(user, token, {
        name,
        content,
        labels: ['agent-report'],
      });
      url = asset.url;
      assetId = asset.id;
    } catch {
      note = '数字资产上传没有成功，这份报告先只存在资料库里';
    }
    const extraction = extractLibraryText(
      new Uint8Array(Buffer.from(content, 'utf8')),
      'md',
      { name },
    );
    const item = await this.createItem(user, {
      aipddAssetId: assetId,
      source: 'report',
      name,
      type: 'md',
      url,
      fileSize: Buffer.byteLength(content, 'utf8'),
      text: extraction.text,
      blocks: extraction.blocks,
      note,
    });
    await this.identity.audit(user.userId, '资料库回流 Agent 报告', name);
    return item;
  }
}
