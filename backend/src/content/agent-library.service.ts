import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { httpRequest } from '../http/transport';
import { RANK, snippet as snippetOf, tokenize } from '../ai/retrieval-kernel';
import type {
  AgentDocCandidate,
  AgentDocInput,
  AgentDocSearch,
  AgentDocView,
  AgentEditView,
} from '../kb/kb-agent-store.service';
import { AipddAssetClient } from './aipdd-asset.client';
import { DigitalAssetService } from './digital-asset.service';
import { ContentModelSettingService } from './model-setting.service';
import { protocolHeaders } from './model-catalog.service';
import { extractLibraryText, libraryTypeOf } from './library-extract';

/** 重排用的大模型凭据：本轮对话就用本轮渠道；记忆页测试则回落「模型设置 → 文本」槽位。 */
export type LibraryLlm = {
  base: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'anthropic';
};

const SOURCE_BYTES_MAX = 20 * 1024 * 1024;
const PUBLISH_CHARS_MAX = 200_000;

type NodeRow = {
  id: number;
  itemId: number;
  kind: string;
  path: string;
  ordinal: number;
  content: string;
  chars: number;
};

/** 资料库的存储口：由知识库实现（资料落成 AGENT 空间的「资料」并跑摄取编译），见 KbAgentStoreService。 */
export type AgentLibraryStore = {
  listDocs(user: CurrentUser): Promise<AgentDocView[]>;
  addDoc(user: CurrentUser, input: AgentDocInput): Promise<AgentDocView>;
  removeDoc(
    user: CurrentUser,
    id: number,
  ): Promise<{ removed: boolean; name: string }>;
  listNodes(user: CurrentUser, id: number): Promise<NodeRow[]>;
  readNode(
    user: CurrentUser,
    nodeId: number,
  ): Promise<{ itemName: string; status: string; node: NodeRow } | null>;
  readDocBody(
    user: CurrentUser,
    id: number,
  ): Promise<{
    id: number;
    name: string;
    status: string;
    note: string;
    text: string;
    charCount: number;
    nodeCount: number;
  } | null>;
  searchDocs(
    user: CurrentUser,
    question: string,
    docIds: number[],
    limit: number,
  ): Promise<AgentDocSearch>;
  docsBlock(
    userId: string,
    ids?: number[],
  ): Promise<{ block: string; scoped: boolean }>;
  proposeDocEdit(
    user: CurrentUser,
    docId: number,
    content: string,
    reason: string,
  ): Promise<{ pageId: number; before: string; after: string } | null>;
  pendingEdits(user: CurrentUser): Promise<AgentEditView[]>;
  decideEdit(
    user: CurrentUser,
    pageId: number,
    accept: boolean,
  ): Promise<AgentEditView>;
};

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

/**
 * Agent 资料库：把数字资产里的文档收进来，交给知识库同一套「资料 → 摄取 → 检索」机制。
 * 归属严格按登录账号（与数字资产同一个台账口径）；存储与检索都在知识库侧
 * （KbAgentStoreService），本服务只做「挑资产、抽正文、按问题语义重排」这几件 Agent 侧的事。
 */
export class ContentAgentLibraryService {
  /** services 装配时注入：知识库服务晚于本服务构造，故用设置口而不是构造参数。 */
  store?: AgentLibraryStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly client: AipddAssetClient,
    private readonly digitalAssets: DigitalAssetService,
    private readonly identity: IdentityService,
  ) {}

  private library() {
    if (!this.store) throw new Error('资料库存储未装配');
    return this.store;
  }

  private docId(value: string) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资料编号无效');
    }
    return id;
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
   * 语义重排：按「问题」而不是关键词挑片段。重排失败就退回知识库检索顺序，
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
      if (picked.length >= RANK.topK) break;
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

  async list(user: CurrentUser): Promise<AgentDocView[]> {
    return this.library().listDocs(user);
  }

  /** 从数字资产挑文档收进资料库：本账号台账里的资产抽好正文后落成知识库资料并编译。 */
  async add(user: CurrentUser, body: Record<string, unknown>) {
    const ids = normalizeIds(body.assetIds);
    if (!ids.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择要放进资料库的数字资产',
      );
    }
    const entries = await this.prisma.digitalAssetEntry.findMany({
      where: {
        userId: user.userId,
        OR: [{ id: { in: ids } }, { aipddAssetId: { in: ids } }],
      },
    });
    if (!entries.length) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这些资产不存在或不属于当前账号',
      );
    }
    const existingIds = new Set(
      (await this.library().listDocs(user)).map((doc) => doc.assetId),
    );
    const skipped: string[] = [];
    let created = 0;
    for (const entry of entries) {
      if (existingIds.has(entry.id)) continue;
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
      // 资产上传时多半已抽正文，直接取用；没有才下载原件现抽一遍
      let text = (entry.text ?? '').trim();
      let note = '';
      if (!text) {
        try {
          const bytes = await this.client.download(entry.url);
          if (bytes.length > SOURCE_BYTES_MAX) {
            throw new Error('文件超过 20MB，请先拆分');
          }
          const extraction = extractLibraryText(bytes, type, { name });
          text = extraction.text;
          note = extraction.note;
        } catch (error) {
          note =
            error instanceof Error ? error.message.slice(0, 200) : '解析失败';
        }
      }
      await this.library().addDoc(user, {
        assetId: entry.id,
        source: 'asset',
        name,
        url: entry.url,
        fileSize: entry.fileSize,
        text,
        note,
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

  async remove(user: CurrentUser, id: string) {
    const result = await this.library().removeDoc(user, this.docId(id));
    await this.identity.audit(
      user.userId,
      '资料库移除资料',
      result.name || `#${id}`,
    );
    return { removed: result.removed };
  }

  async nodes(user: CurrentUser, id: string) {
    return this.library().listNodes(user, this.docId(id));
  }

  /** 候选召回：知识库混合检索（同一套词面+向量）→ 语义重排 → 带出处的片段。 */
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
    const limit = options.topK
      ? Math.max(1, Math.min(RANK.topK, options.topK))
      : RANK.topK;
    const found = await this.library().searchDocs(
      user,
      question,
      scopedIds,
      Math.max(limit, 8),
    );
    if (!found.hits.length) {
      return {
        question,
        semantic: false,
        scope: found.scope,
        hits: [],
        note: scopedIds.length
          ? '这次指定的资料不在知识库里，或已被删除'
          : '知识库里还没有可检索的资料',
      };
    }
    const candidates = found.hits.map((hit: AgentDocCandidate) => ({
      node: {
        id: hit.nodeId,
        itemId: hit.itemId,
        kind: hit.kind,
        path: hit.path,
        ordinal: 0,
        content: hit.content,
        chars: hit.content.length,
        itemName: hit.itemName,
      },
      score: hit.score,
    }));
    const llm = options.llm ?? (await this.llmOf(user, token));
    const reranked = llm ? await this.rerank(llm, question, candidates) : null;
    const chosen = reranked
      ? reranked
      : candidates.map((item, index) => ({
          node: item.node,
          score: Math.max(0.01, 1 - index / Math.max(1, candidates.length)),
        }));
    const tokens = [...new Set(tokenize(question))];
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
      scope: found.scope,
      hits,
      note: reranked
        ? ''
        : llm
          ? '语义重排没有跑通，先按知识库检索相关度给出候选'
          : '没有可用的文本模型，先按知识库检索相关度给出候选',
    };
  }

  /** 精读：按片段 id 读全文（片段往往不够用，模型要二次读全文再综合作答）。 */
  async readNode(user: CurrentUser, nodeId: number) {
    return this.library().readNode(user, nodeId);
  }

  async readItem(user: CurrentUser, itemId: number) {
    return this.library().readDocBody(user, itemId);
  }

  /** 送给系统提示的资料清单：只列名字与规模，不塞正文（正文按需检索）。 */
  async promptBlock(userId: string, ids: number[] = []) {
    return this.library().docsBlock(userId, ids);
  }

  /** AI 改 Markdown 先进待审：用户点了放行才成为正文，绝不静默覆盖。 */
  async proposeEdit(user: CurrentUser, body: Record<string, unknown>) {
    const itemId = this.docId(readText(body.itemId));
    const after = readText(body.content).trim();
    if (!after) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '改写内容为空');
    }
    const reason = readText(body.reason).trim().slice(0, 300);
    const result = await this.library().proposeDocEdit(
      user,
      itemId,
      after,
      reason,
    );
    if (!result) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '资料不存在');
    }
    const doc = await this.library().readDocBody(user, itemId);
    return {
      id: result.pageId,
      itemId,
      itemName: doc?.name || '资料',
      nodeId: 0,
      nodePath: '整篇',
      reason,
      before: result.before,
      after: result.after,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  async drafts(user: CurrentUser) {
    return this.library().pendingEdits(user);
  }

  async decideDraft(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.library().decideEdit(
      user,
      this.docId(id),
      body.accept === true,
    );
  }

  /**
   * 回流：Agent 产出的报告存成数字资产（台账照记），同一份正文也进知识库资料。
   * 上传失败时仍保留本地资料（正文照样能检索），只在 note 里说明。
   */
  async publish(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    void token;
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
      const asset = await this.digitalAssets.uploadText(user, {
        name,
        content,
        labels: ['agent-report'],
      });
      url = asset.url;
      const entry = await this.prisma.digitalAssetEntry.findFirst({
        where: { userId: user.userId, aipddAssetId: asset.id },
        select: { id: true },
      });
      assetId = entry?.id || 0;
    } catch {
      note = '数字资产上传没有成功，这份报告先只存在知识库里';
    }
    const view = await this.library().addDoc(user, {
      assetId,
      source: 'report',
      name,
      url,
      fileSize: Buffer.byteLength(content, 'utf8'),
      text: content,
      note,
    });
    await this.identity.audit(user.userId, '资料库回流 Agent 报告', name);
    return view;
  }
}
