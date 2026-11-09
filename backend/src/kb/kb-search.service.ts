import type { CurrentUser } from '../auth/current-user';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  cosine,
  excerpt,
  hybridScore,
  keywordScore,
  LOCAL_EMBED_ID,
  RANK,
} from '../ai/retrieval-kernel';
import { toJsonInput } from '../common/json-input';
import { queryVectors } from './kb-embed';
import { kbChatMulti, resolveKbLlm } from './kb-llm';
import { KbPageService } from './kb-page.service';
import { KbSpaceService, putLog } from './kb-space.service';
import { clip, num, objMap } from './kb-util';

/**
 * 混合检索与问答（§10.5 Query 操作）：
 * - 关键词 + 向量双路打分走统一检索内核（词面 0.6 / 向量 0.4）；向量可插拔——
 *   按分块记录的模型取查询向量（本地袋装零成本，真实向量逐模型一次调用），
 *   槽位缺失/失配自动退化关键词（modes 如实报告）；
 * - Ask：LLM 可用带摘录综合并编号引用；不可用抽取式拼接（同样带引用），好答案 saveAsPage 沉淀 SYNTHESIS；
 * - Recall：Agent 组 prompt 前的回流通道，按「绑定空间 → AGENT 默认空间」取片段并做总字数裁剪。
 * L1 数据规模下空间内 chunk 全扫（上限 RANK.scanChunks）；演进判据（>5 万页切专用向量库）见 §10.9。
 */

export interface SearchHit {
  pageId: number;
  slug: string;
  title: string;
  type:
    | 'ENTITY'
    | 'CONCEPT'
    | 'SUMMARY'
    | 'COMPARISON'
    | 'SYNTHESIS'
    | 'INDEX'
    | 'LOG';
  score: number;
  keywordScore: number;
  vectorScore: number;
  excerpt: string;
  sourceIds: number[];
}

export class KbSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
    private readonly pages: KbPageService,
    private readonly aiEval: AiEvalService,
  ) {}

  async search(spaceId: number, q: string, topK: number, user: CurrentUser) {
    const started = Date.now();
    await this.spaces.loadReadable(spaceId, user);
    const published = await this.prisma.kbPage.findMany({
      where: { spaceId, status: 'PUBLISHED' },
      select: { id: true, slug: true, title: true, type: true, body: true },
      take: RANK.scanPages,
    });
    const pageById = new Map(published.map((p) => [p.id, p]));
    const chunks = await this.prisma.kbChunk.findMany({
      where: { spaceId, pageId: { in: [...pageById.keys()] } },
      take: RANK.scanChunks,
    });
    // 按分块记录的向量模型取查询向量：本地袋装同步算，真实向量逐模型一次调用
    const qVectors = await queryVectors(
      this.prisma,
      user.userId,
      chunks.map((chunk) => chunk.model),
      q,
    );
    let vectorUsed = false;
    const best = new Map<
      number,
      { kw: number; vec: number; excerpt: string; vecSeen: boolean }
    >();
    for (const chunk of chunks) {
      const kw = keywordScore(
        q,
        `${pageById.get(chunk.pageId)!.title}\n${chunk.text}`,
      );
      const embedding = Array.isArray(chunk.embedding)
        ? (chunk.embedding as unknown[]).map(num)
        : [];
      const qVec = qVectors[chunk.model || LOCAL_EMBED_ID];
      const vec =
        qVec && embedding.length === qVec.length ? cosine(qVec, embedding) : 0;
      if (embedding.length) vectorUsed = true;
      if (kw <= 0 && vec <= RANK.vectorFloor) continue;
      const cur = best.get(chunk.pageId);
      if (!cur || hybridScore(kw, vec) > hybridScore(cur.kw, cur.vec)) {
        best.set(chunk.pageId, {
          kw: Math.max(cur?.kw ?? 0, kw),
          vec: Math.max(cur?.vec ?? 0, vec),
          excerpt: excerpt(chunk.text, RANK.excerptChars),
          vecSeen: cur?.vecSeen ?? false,
        });
      }
    }
    // 兜底：chunk 缺失（历史数据）时按页正文直接关键词打分
    for (const page of published) {
      if (best.has(page.id)) continue;
      const kw = keywordScore(q, `${page.title}\n${page.body}`);
      if (kw > 0.05) {
        best.set(page.id, {
          kw,
          vec: 0,
          excerpt: excerpt(page.body, RANK.excerptChars),
          vecSeen: false,
        });
      }
    }
    const pageIds = [...best.keys()];
    const linkRows = pageIds.length
      ? await this.prisma.kbPageSource.findMany({
          where: { pageId: { in: pageIds } },
        })
      : [];
    const sourcesByPage = new Map<number, number[]>();
    for (const link of linkRows) {
      const list = sourcesByPage.get(link.pageId) || [];
      list.push(link.sourceId);
      sourcesByPage.set(link.pageId, list);
    }
    const scored = [...best.entries()]
      .map(([pageId, s]) => ({
        pageId,
        slug: pageById.get(pageId)!.slug,
        title: pageById.get(pageId)!.title,
        type: pageById.get(pageId)!.type as SearchHit['type'],
        score: hybridScore(s.kw, s.vec),
        keywordScore: Number(s.kw.toFixed(6)),
        vectorScore: Number(s.vec.toFixed(6)),
        excerpt: s.excerpt,
        sourceIds: sourcesByPage.get(pageId) || [],
      }))
      .sort((a, b) => b.score - a.score || a.pageId - b.pageId)
      .slice(0, topK);
    void this.trackQuery(spaceId, Date.now() - started);
    return {
      hits: scored,
      modes:
        vectorUsed && scored.some((h) => h.vectorScore > 0)
          ? ['keyword', 'vector']
          : ['keyword'],
      total: scored.length,
    };
  }

  async ask(
    body: {
      spaceId: number;
      question: string;
      topK: number;
      saveAsPage: boolean;
    },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(body.spaceId, user);
    const found = await this.search(
      body.spaceId,
      body.question,
      body.topK,
      user,
    );
    const citations = found.hits.map((hit) => ({
      pageId: hit.pageId,
      slug: hit.slug,
      title: hit.title,
      excerpt: hit.excerpt,
    }));
    let answer = '';
    let mode: 'llm' | 'extractive' = 'extractive';
    let usage: { call: number; tokenIn?: number; tokenOut?: number } = {
      call: 1,
    };
    if (found.hits.length) {
      const channel = await resolveKbLlm(this.prisma, user.userId);
      const context = found.hits
        .map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.excerpt}`)
        .join('\n\n');
      if (channel) {
        const result = await kbChatMulti(
          channel,
          [
            {
              role: 'system',
              content:
                '你是企业知识库问答引擎。只依据给定资料摘录回答，观点后用 [编号] 标注引用；资料不足时明说缺什么。输出中文。',
            },
            {
              role: 'user',
              content: `问题：${body.question}\n\n资料：\n${context}`,
            },
          ],
          user.userId,
          1200,
        );
        if (result) {
          answer = result.reply.trim();
          mode = 'llm';
          usage = {
            call: 1,
            tokenIn: result.promptTokens,
            tokenOut: result.completionTokens,
          };
        }
      }
      if (!answer) {
        // 抽取式回落：按命中顺序拼接摘录（确定可验收）
        answer = found.hits
          .map((hit, i) => `[${i + 1}] ${hit.title}：${hit.excerpt}`)
          .join('\n');
      }
    } else {
      answer =
        '知识库中没有找到与该问题相关的已发布内容；可先投料或换用更具体的关键词。';
    }
    let savedPageId = 0;
    if (body.saveAsPage && found.hits.length) {
      const page = await this.pages.writePage(
        {
          spaceId: body.spaceId,
          slug: `ask-${Date.now().toString(36)}`,
          type: 'SYNTHESIS',
          title: `问答沉淀：${clip(body.question, 60)}`,
          body: [
            `**问题**：${body.question}`,
            '',
            answer,
            '',
            '## 引用',
            ...found.hits.map(
              (hit, i) => `- [${i + 1}] [[${hit.title}]]（${hit.slug}）`,
            ),
          ].join('\n'),
          frontmatter: {
            tags: ['ask', mode],
            question: body.question,
            citedPageIds: found.hits.map((hit) => hit.pageId),
          },
          // 复利沉淀走人在环：默认待审（§10.1）
          status: 'PENDING_REVIEW',
          sourceIds: [],
        },
        user,
      );
      savedPageId = page.id;
    }
    let cost = 0;
    try {
      cost = await this.aiEval.chargeByUsage(
        user.userId,
        'kb_query',
        usage,
        `kb-ask:${mode}`,
      );
    } catch {
      cost = 0;
    }
    await putLog(
      this.prisma,
      body.spaceId,
      'QUERY',
      `问答（${mode}，命中 ${found.hits.length}）：${clip(body.question, 80)}`,
      { hits: found.hits.map((h) => h.pageId), savedPageId },
      user.userId,
    );
    return { answer, citations, mode, savedPageId, cost: cost.toString() };
  }

  /** Agent 回流：组 prompt 前的知识片段（读 PUBLISHED 页，总字数预算裁剪）。 */
  async recall(
    body: { spaceId?: number; query: string; topK: number; maxChars: number },
    user: CurrentUser,
  ) {
    const space = await this.spaces.resolveActiveSpace(user, body.spaceId);
    const found = await this.search(space.id, body.query, body.topK, user);
    const snippets: {
      pageId: number;
      slug: string;
      title: string;
      text: string;
      score: number;
    }[] = [];
    let budget = body.maxChars;
    for (const hit of found.hits) {
      if (budget <= 0) break;
      const text = clip(hit.excerpt, Math.min(400, budget));
      budget -= text.length;
      snippets.push({
        pageId: hit.pageId,
        slug: hit.slug,
        title: hit.title,
        text,
        score: hit.score,
      });
    }
    return { snippets, boundSpaceId: space.id, total: found.total };
  }

  /** 索引统计（§10.9 演进判据快照）：查询耗时均值随 search 滚动更新。 */
  async trackQuery(spaceId: number, elapsedMs: number) {
    const row = await this.prisma.kbIndex.findUnique({ where: { spaceId } });
    if (!row) return;
    const stats = objMap(row.stats);
    const n = num(stats.querySamples) + 1;
    const avg = num(stats.avgQueryMs);
    await this.prisma.kbIndex
      .update({
        where: { spaceId },
        data: {
          stats: toJsonInput({
            ...stats,
            querySamples: n,
            avgQueryMs: Math.round(avg + (elapsedMs - avg) / n),
          }),
          statsAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  /** 关键词兜底扩展：给 consolidate 生成「相关操作」列表用的轻量聚合。 */
  static topTargets(
    events: { target_label: string; action: string }[],
  ): string[] {
    const count = new Map<string, number>();
    for (const event of events) {
      const label = String(event.target_label || event.action || '').trim();
      if (!label) continue;
      count.set(label, (count.get(label) || 0) + 1);
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name]) => name);
  }
}
