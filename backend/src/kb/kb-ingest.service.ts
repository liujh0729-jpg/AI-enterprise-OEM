import type { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { KbIngestJob, KbSource } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { tokenize } from '../ai/retrieval-kernel';
import {
  kbChatMulti,
  parseJsonObject,
  resolveKbLlm,
  type KbLlmChannel,
} from './kb-llm';
import { KbPageService } from './kb-page.service';
import { KbSourceService } from './kb-source.service';
import { KbSpaceService, putLog } from './kb-space.service';
import { clip, iso, strArray } from './kb-util';

/**
 * Ingest 操作（§10.3/§10.4 编译流水线）：源 → SUMMARY 页 + 实体入图。
 * LLM 通道可用走抽取式（摘要+实体+关系），未配置 Key/模型回落**规则式确定性摘要**
 * （首段聚类 + 高频词 top）——保证验收与私有化零依赖环境全链路可用；
 * 计费收口 kb_ingest（成功才计，fail 路径不扣，§5.12 口径）。
 */

export interface IngestJobView {
  id: number;
  spaceId: number;
  sourceId: number;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  pagesAffected: number[];
  model: string;
  tokens: number;
  cost: string;
  error: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string;
}

const STOPWORDS = new Set([
  '我们',
  '可以',
  '这个',
  '那个',
  '需要',
  '进行',
  '可能',
  '已经',
  '进行',
  '一个',
  '没有',
  '什么',
  '就是',
  '如果',
  '因为',
  '所以',
  '但是',
  '以及',
  '对于',
  '通过',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'will',
  'your',
]);

function ruleKeywords(text: string, limit: number): string[] {
  const freq = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

/** 统一产出形状：LLM/规则两路同构，usage 随实有量可缺省。 */
type IngestOutcome = {
  pageIds: number[];
  model: string;
  tokens: number;
  usage: { call: number; tokenIn?: number; tokenOut?: number };
  mode: 'llm' | 'rule';
};

function jobView(row: KbIngestJob): IngestJobView {
  return {
    id: row.id,
    spaceId: row.spaceId,
    sourceId: row.sourceId,
    status: row.status as IngestJobView['status'],
    pagesAffected: strArray(row.pagesAffected)
      .map(Number)
      .filter((n) => n > 0),
    model: row.model,
    tokens: row.tokens,
    cost: row.costAmount.toString(),
    error: row.error,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.finishedAt),
  };
}

export class KbIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
    private readonly sources: KbSourceService,
    private readonly pages: KbPageService,
    private readonly aiEval: AiEvalService,
  ) {}

  async ingest(body: { spaceId: number; sourceId: number }, user: CurrentUser) {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    const source = await this.sources.loadSource(body.sourceId, user);
    if (source.spaceId !== space.id) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资料不属于该空间');
    }
    const job = await this.prisma.kbIngestJob.create({
      data: {
        spaceId: space.id,
        sourceId: source.id,
        status: 'RUNNING',
        createdBy: user.userId,
        startedAt: new Date(),
      },
    });
    if (!source.text.trim()) {
      return this.failJob(
        job.id,
        source.id,
        '资料正文为空：先解析回填或改用文本直投',
      );
    }
    const channel = await resolveKbLlm(this.prisma, user.userId);
    try {
      let outcome: IngestOutcome | null = channel
        ? await this.llmIngest(channel, source, user)
        : null;
      if (!outcome) {
        // 未配通道或 LLM 返回不可解析：回落规则式（不判失败，保流水线可用）
        outcome = await this.ruleIngest(source, user);
      }
      const cost = await this.charge(user.userId, channel, outcome);
      const row = await this.prisma.kbIngestJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          pagesAffected: toJsonInput(outcome.pageIds),
          model: outcome.model,
          tokens: outcome.tokens,
          costAmount: cost,
          finishedAt: new Date(),
        },
      });
      await this.prisma.kbSource.update({
        where: { id: source.id },
        data: { status: 'INGESTED', ingestedAt: new Date(), error: '' },
      });
      await putLog(
        this.prisma,
        space.id,
        'INGEST',
        `摄取「${source.title}」→ ${outcome.pageIds.length} 页（${outcome.mode}）`,
        { jobId: job.id, sourceId: source.id, pages: outcome.pageIds },
        user.userId,
      );
      return jobView(row);
    } catch (error) {
      return this.failJob(
        job.id,
        source.id,
        clip((error as Error)?.message || '摄取异常', 480),
      );
    }
  }

  private async failJob(jobId: number, sourceId: number, error: string) {
    const [job] = await Promise.all([
      this.prisma.kbIngestJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error, finishedAt: new Date() },
      }),
      this.prisma.kbSource.update({
        where: { id: sourceId },
        data: { status: 'FAILED', error },
      }),
    ]);
    return jobView(job);
  }

  private async llmIngest(
    channel: KbLlmChannel,
    source: KbSource,
    user: CurrentUser,
  ): Promise<IngestOutcome | null> {
    const result = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content: [
            '你是知识库编译引擎。读资料正文，输出 JSON（只输出 JSON）：',
            '{"summary":"200字以内中文摘要","entities":[{"name":"实体名","type":"PERSON|ORG|CONCEPT|PRODUCT|CUSTOMER|PROJECT|OTHER"}],"relations":[{"from":"实体名","to":"实体名","relation":"短语"}],"keyPoints":["要点，可含 [[实体名]]"]}',
            '实体不超过 12 个，要点不超过 8 条；不确定的不编造。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `# ${source.title}\n\n${clip(source.text, 20000)}`,
        },
      ],
      user.userId,
      2000,
    );
    if (!result) return null;
    const verdict = parseJsonObject(result.reply);
    if (!verdict || typeof verdict.summary !== 'string') return null;
    const entities = Array.isArray(verdict.entities)
      ? verdict.entities.slice(0, 12)
      : [];
    const bodyParts: string[] = [
      `> 源：${source.title}（${source.kind}，${source.text.length} 字）`,
      '',
      '## 摘要',
      String(verdict.summary).slice(0, 1000),
    ];
    const points = strArray(verdict.keyPoints).slice(0, 8);
    if (points.length) {
      bodyParts.push('', '## 要点', ...points.map((p) => `- ${p}`));
    }
    const entityNames = entities
      .map((e) => strArray([(e as { name?: unknown }).name ?? ''])[0])
      .filter(Boolean);
    if (entityNames.length) {
      bodyParts.push(
        '',
        '## 关联实体',
        ...entityNames.slice(0, 12).map((n) => `- [[${n}]]`),
      );
    }
    const page = await this.pages.writePage(
      {
        spaceId: source.spaceId,
        slug: `summary-${source.id}`,
        type: 'SUMMARY',
        title: `${source.title} · 摘要`,
        body: bodyParts.join('\n'),
        frontmatter: { tags: ['ingest', source.kind], sourceId: source.id },
        status: 'PUBLISHED',
        sourceIds: [source.id],
      },
      user,
    );
    // 模型抽取的显式关系入图（实体名对齐 wikilink 已建的节点）
    const relations = Array.isArray(verdict.relations)
      ? verdict.relations.slice(0, 20)
      : [];
    for (const rel of relations) {
      const item = rel as { from?: unknown; to?: unknown; relation?: unknown };
      const asText = (v: unknown): string =>
        typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
      const fromName = asText(item.from).trim();
      const toName = asText(item.to).trim();
      const relation = (asText(item.relation) || 'related').trim().slice(0, 64);
      if (!fromName || !toName) continue;
      const [from, to] = await Promise.all([
        this.ensureEntity(source.spaceId, fromName),
        this.ensureEntity(source.spaceId, toName),
      ]);
      if (from.id === to.id) continue;
      await this.prisma.kbRelation.upsert({
        where: {
          fromId_toId_relation: { fromId: from.id, toId: to.id, relation },
        },
        create: {
          spaceId: source.spaceId,
          fromId: from.id,
          toId: to.id,
          relation,
          sourcePageId: page.id,
        },
        update: { sourcePageId: page.id },
      });
    }
    return {
      pageIds: [page.id],
      model: channel.model,
      tokens: result.promptTokens + result.completionTokens,
      usage: {
        call: 1,
        tokenIn: result.promptTokens,
        tokenOut: result.completionTokens,
      },
      mode: 'llm' as const,
    };
  }

  /** 规则式回落（确定性）：前三段 + 高频词实体表；同 slug 重摄取即覆盖更新。 */
  private async ruleIngest(
    source: KbSource,
    user: CurrentUser,
  ): Promise<IngestOutcome> {
    const paras = source.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const head = paras.slice(0, 3).map((p) => clip(p, 500));
    const keywords = ruleKeywords(source.text, 15);
    const bodyParts: string[] = [
      `> 源：${source.title}（${source.kind}，${source.text.length} 字）｜规则式编译（未配置模型 Key 时的确定性回落）`,
      '',
      '## 内容要览',
      ...head,
    ];
    if (keywords.length) {
      bodyParts.push(
        '',
        '## 关键概念',
        ...keywords.map((word) => `- [[${word}]]`),
      );
    }
    const page = await this.pages.writePage(
      {
        spaceId: source.spaceId,
        slug: `summary-${source.id}`,
        type: 'SUMMARY',
        title: `${source.title} · 摘要`,
        body: bodyParts.join('\n'),
        frontmatter: {
          tags: ['ingest', 'rule-based', source.kind],
          sourceId: source.id,
        },
        status: 'PUBLISHED',
        sourceIds: [source.id],
      },
      user,
    );
    return {
      pageIds: [page.id],
      model: 'rule-based',
      tokens: 0,
      usage: { call: 1 },
      mode: 'rule' as const,
    };
  }

  private async ensureEntity(spaceId: number, name: string) {
    const clean = name.trim().slice(0, 120);
    return this.prisma.kbEntity.upsert({
      where: { spaceId_name: { spaceId, name: clean } },
      create: { spaceId, name: clean },
      update: {},
    });
  }

  /** 计费（成功才计）：LLM 按实际 token + 次；规则式只计次。失败绝不阻断主流程。 */
  private async charge(
    userId: string,
    channel: KbLlmChannel | null,
    outcome: { usage: { call: number; tokenIn?: number; tokenOut?: number } },
  ): Promise<number> {
    try {
      return await this.aiEval.chargeByUsage(
        userId,
        'kb_ingest',
        outcome.usage,
        `kb-ingest:${channel ? 'llm' : 'rule'}`,
      );
    } catch {
      return 0;
    }
  }

  async listJobs(
    query: { spaceId: number; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const where = { spaceId: query.spaceId };
    const [total, rows] = await Promise.all([
      this.prisma.kbIngestJob.count({ where }),
      this.prisma.kbIngestJob.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map(jobView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
