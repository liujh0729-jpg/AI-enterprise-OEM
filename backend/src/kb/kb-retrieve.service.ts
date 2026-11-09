import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ContentAgentLibraryService } from '../content/agent-library.service';
import type { HelpService } from '../help/help.service';
import type { PrismaService } from '../prisma/prisma.service';
import { clip } from './kb-util';
import type { KbSpaceService } from './kb-space.service';
import type { KbSearchService } from './kb-search.service';
import { normalizeScores, RANK } from '../ai/retrieval-kernel';

/**
 * 跨模块统一 RAG 出口（AI 底座方案 §4.2）：
 * 入参 = 组织 scope + query + 过滤（空间/资料库/类型/时间），出参 = 带引用的片段。
 * 任何板块/技能/分身要挂知识检索，调这一个方法（或 Agent/MCP 工具 kb_retrieve）即可，
 * 不必再各自实现一遍「拿空间 → 检索 → 拼上下文」。
 *
 * 检索来源与口径：
 * - kb：知识空间混合检索（复用 KbSearchService，可见性闸在空间服务内部收口）；
 * - library：Agent 资料库（已并入知识库：条目即 AGENT 空间的 KbSource，召回走 KbSearchService 混合检索 + 语义重排，账号归属隔离）；
 * - help：帮助中心（字段加权，版本化条目）；
 * 三源分数各自归一到 0~1 后合并排序，片段总长按 maxChars 预算裁剪。
 * 数字分身/客服的「挂库」= KbConsumer 绑定（consumerType + consumerId），这里按优先级聚合空间；
 * agent 记忆的语义回流 = 长期记忆落成知识库记忆页、操作留痕经 consolidate 沉淀成知识页后走同一检索（§10.4）。
 */

export const KB_RETRIEVE_SOURCES = ['kb', 'library', 'help'] as const;
export type RetrieveSource = (typeof KB_RETRIEVE_SOURCES)[number];

export type RetrieveConsumerType =
  | 'AVATAR'
  | 'AGENT'
  | 'SERVICE_DESK'
  | 'ERP'
  | 'CRM'
  | 'THINK_TANK'
  | 'LEGAL'
  | 'OVERSEAS';

export type RetrieveInput = {
  query: string;
  /** 检索来源；缺省三源全开 */
  sources?: RetrieveSource[];
  /** 知识空间范围；与 consumer 二选一（spaceIds 优先） */
  spaceIds?: number[];
  /** 消费者绑定（分身/客服/ERP/CRM 挂库）：按优先级聚合其可读空间 */
  consumerType?: RetrieveConsumerType;
  consumerId?: string;
  /** 资料库范围（content 资料库 id；空 = 该账号全部资料） */
  libraryIds?: number[];
  /** 知识页类型过滤（kb 来源） */
  types?: string[];
  /** 标签过滤（kb 来源：frontmatter.tags） */
  tags?: string[];
  /** 时间过滤（kb 来源，ISO 日期字符串） */
  from?: string;
  to?: string;
  topK?: number;
  /** 片段总字数预算（跨源合并后从高到低截断） */
  maxChars?: number;
};

export type RetrieveSnippet = {
  source: RetrieveSource;
  spaceId?: number;
  /** kb=pageId；library=nodeId；help=0（slug 才是稳定标识） */
  id: number;
  slug?: string;
  title: string;
  text: string;
  /** 归一分 0~1，跨源可比 */
  score: number;
  /** 引用锚点：kb=页 slug；library=资料名；help=主题 code */
  ref: string;
};

export type RetrieveResult = {
  query: string;
  sources: RetrieveSource[];
  snippets: RetrieveSnippet[];
  /** 召回口径：keyword / vector / rerank（如实报告，向量或重排缺失自动退化） */
  modes: string[];
  total: number;
  spaces: { id: number; name: string }[];
};

export class KbRetrieveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
    private readonly search: KbSearchService,
    private readonly library: ContentAgentLibraryService,
    private readonly help: HelpService,
  ) {}

  async retrieve(
    user: CurrentUser,
    input: RetrieveInput,
  ): Promise<RetrieveResult> {
    const query = String(input.query || '')
      .trim()
      .slice(0, 500);
    if (!query) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入要检索的问题');
    }
    const topK = Math.max(1, Math.min(RANK.maxTopK, input.topK || RANK.topK));
    const maxChars = Math.max(200, Math.min(8000, input.maxChars || 4000));
    const sources = (
      input.sources?.length ? input.sources : KB_RETRIEVE_SOURCES
    ).filter((source) => KB_RETRIEVE_SOURCES.includes(source));

    const resolvedSpaces = await this.resolveSpaceIds(user, input);
    const modes = new Set<string>();
    const candidates: RetrieveSnippet[] = [];

    // kb 不在来源里时不列空间（避免 help-only 检索却报告知识空间范围）
    const spaceIds = sources.includes('kb') ? resolvedSpaces : [];

    if (sources.includes('kb') && spaceIds.length) {
      for (const spaceId of spaceIds) {
        const found = await this.search.search(spaceId, query, topK, user);
        found.modes.forEach((mode) => modes.add(mode));
        candidates.push(
          ...found.hits.map<RetrieveSnippet>((hit) => ({
            source: 'kb',
            spaceId,
            id: hit.pageId,
            slug: hit.slug,
            title: hit.title,
            text: hit.excerpt,
            score: hit.score,
            ref: hit.slug,
          })),
        );
      }
    }
    if (sources.includes('library')) {
      const found = await this.library
        .search(user, undefined, {
          question: query,
          libraryIds: input.libraryIds,
        })
        .catch(() => null);
      if (found) {
        if (found.semantic) modes.add('rerank');
        const scores = normalizeScores(found.hits.map((hit) => hit.score));
        candidates.push(
          ...found.hits.slice(0, topK).map<RetrieveSnippet>((hit, index) => ({
            source: 'library',
            id: hit.nodeId,
            slug: String(hit.itemId),
            title: hit.itemName,
            text: hit.snippet,
            score: scores[index],
            ref: hit.itemName,
          })),
        );
      }
    }
    if (sources.includes('help')) {
      const hits = this.help.search({ keyword: query });
      candidates.push(
        ...hits.slice(0, topK).map<RetrieveSnippet>((hit) => ({
          source: 'help',
          id: 0,
          slug: hit.code,
          title: hit.title,
          text: hit.excerpt,
          score: hit.score,
          ref: hit.code,
        })),
      );
    }

    const filtered = await this.applyKbFilters(candidates, input);
    filtered.sort(
      (a, b) => b.score - a.score || a.title.localeCompare(b.title),
    );

    // 字数预算：从高分往下收，单条至少留 200 字，收不下就停
    const snippets: RetrieveSnippet[] = [];
    let budget = maxChars;
    for (const item of filtered) {
      if (budget < 200) break;
      const text = clip(item.text, budget);
      budget -= text.length;
      snippets.push({ ...item, text });
    }

    const spaceNames = spaceIds.length
      ? await this.prisma.kbSpace.findMany({
          where: { id: { in: spaceIds } },
          select: { id: true, name: true },
        })
      : [];
    return {
      query,
      sources,
      snippets,
      modes: [...modes],
      total: filtered.length,
      spaces: spaceNames.map((row) => ({ id: row.id, name: row.name })),
    };
  }

  /** 空间范围：显式 spaceIds → 消费者绑定（可读性过滤）→ 用户当前/默认空间。 */
  private async resolveSpaceIds(
    user: CurrentUser,
    input: RetrieveInput,
  ): Promise<number[]> {
    if (input.spaceIds?.length) {
      const ids = [...new Set(input.spaceIds)].slice(0, 10);
      for (const id of ids) await this.spaces.loadReadable(id, user);
      return ids;
    }
    if (input.consumerType && input.consumerId) {
      const rows = await this.prisma.kbConsumer.findMany({
        where: {
          consumerType: input.consumerType,
          consumerId: clip(input.consumerId.trim(), 64),
          role: 'READ',
        },
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
        take: 10,
      });
      const readable: number[] = [];
      for (const row of rows) {
        // 绑定可见 ≠ 用户可读：逐空间核读闸，不可读的静默跳过（不泄露空间存在性）
        const space = await this.prisma.kbSpace.findUnique({
          where: { id: row.spaceId },
        });
        if (space && (await this.spaces.canRead(space, user))) {
          readable.push(row.spaceId);
        }
      }
      return [...new Set(readable)].slice(0, 5);
    }
    const active = await this.spaces.resolveActiveSpace(user, undefined);
    return active?.id ? [active.id] : [];
  }

  /** 类型/标签/时间过滤（只作用于 kb 片段；其余来源无这些维度）。 */
  private async applyKbFilters(
    candidates: RetrieveSnippet[],
    input: RetrieveInput,
  ): Promise<RetrieveSnippet[]> {
    const kbIds = candidates
      .filter((item) => item.source === 'kb')
      .map((item) => item.id);
    const needPage =
      (input.types?.length || input.tags?.length || input.from || input.to) &&
      kbIds.length > 0;
    if (!needPage) return candidates;

    const pages = await this.prisma.kbPage.findMany({
      where: { id: { in: kbIds } },
      select: { id: true, type: true, createdAt: true, frontmatter: true },
    });
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const from = input.from ? new Date(input.from).getTime() : 0;
    const to = input.to
      ? new Date(input.to).getTime()
      : Number.MAX_SAFE_INTEGER;
    return candidates.filter((item) => {
      if (item.source !== 'kb') return true;
      const page = pageById.get(item.id);
      if (!page) return false;
      if (input.types?.length && !input.types.includes(page.type)) return false;
      const at = page.createdAt.getTime();
      if (at < from || at > to) return false;
      if (input.tags?.length) {
        const tags = Array.isArray(
          (page.frontmatter as Record<string, unknown>)?.tags,
        )
          ? (
              (page.frontmatter as Record<string, unknown>).tags as unknown[]
            ).map(String)
          : [];
        if (!input.tags.some((tag) => tags.includes(tag))) return false;
      }
      return true;
    });
  }
}
