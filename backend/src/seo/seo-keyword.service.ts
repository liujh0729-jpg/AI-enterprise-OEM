import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { parseJsonObject } from '../ai/ai-gateway';
import { intentLabel } from './seo-dataforseo.client';
import { analyzeGsc, parseGscCsv, type GscRow } from './seo-gsc';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  json,
  normalizeDomain,
  num,
  pageOf,
  skipTake,
  strArr,
  text,
  type PageQuery,
  type Row,
} from './seo-shared';

type ResearchKeyword = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
  intent: string;
  source: 'DATAFORSEO' | 'AI' | 'GSC';
  opportunity: number;
};

const INTENT_WEIGHT: Record<string, number> = {
  transactional: 80,
  commercial: 70,
  informational: 50,
  navigational: 40,
};

const readClusters = (parsed: Record<string, unknown> | null) =>
  (Array.isArray(parsed?.clusters) ? parsed.clusters : []).map((item) => {
    const row = (item || {}) as Row;
    return {
      name: text(row.name),
      intent: text(row.intent),
      keywords: strArr(row.keywords),
      mappedPageUrl: text(row.mappedPageUrl),
    };
  });

/** 关键词：实测（DataForSEO）/ 估计（系统 LLM）双轨 + 词库 + 聚类 + GSC 导入分析。 */
export class SeoKeywordService extends SeoBase {
  async researchKeywords(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const seed = clip(body.seed, 200).trim();
    const competitorDomain = text(body.competitorDomain).trim();
    if (!seed && !competitorDomain)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写种子词或竞品域名（至少一个）',
      );
    const params = {
      seed,
      domain: competitorDomain ? normalizeDomain(competitorDomain) : '',
      locationCode: num(body.locationCode, project.locationCode),
      languageCode: clip(body.languageCode, 12) || project.languageCode,
      limit: Math.min(100, Math.max(1, num(body.limit, 30))),
    };
    const credential = await this.ctx.dfs.credential(user.userId);
    if (credential) {
      const result = await this.research<ResearchKeyword[]>({
        org: orgKeyOf(org),
        projectId: project.id,
        action: 'keywords',
        params,
        resultRef: `keywords:${params.limit}`,
        load: async () => {
          const metrics = await this.ctx.dfs.discoverKeywords(credential, {
            seed: params.seed,
            domain: params.domain,
            locationCode: params.locationCode,
            languageCode: params.languageCode,
            limit: params.limit,
          });
          const maxVolume = Math.max(
            1,
            ...metrics.map((item) => item.volume || 0),
          );
          return metrics.slice(0, params.limit).map((item) => ({
            keyword: clip(item.keyword, 200),
            volume: item.volume,
            cpc: item.cpc,
            difficulty: item.difficulty,
            intent: intentLabel(item.intent),
            source: 'DATAFORSEO' as const,
            opportunity: Math.round(
              ((item.volume || 0) / maxVolume) *
                (100 - (item.difficulty ?? 50)),
            ),
          }));
        },
      });
      return {
        keywords: result.value,
        mode: 'dataforseo' as const,
        reused: result.reused,
      };
    }
    // 无付费数据源：走系统 LLM 估计；搜索量/CPC/难度一律留空，绝不编造实测数字
    const context = await this.brandContext(org);
    const call = await this.ai(
      user,
      '你是 SEO 关键词研究员。只输出 JSON，格式 {"keywords":[{"keyword":"…","intent":"informational|commercial|transactional|navigational","reason":"…"}]}。' +
        '不要输出搜索量、CPC、难度等任何数字指标（没有实测来源就不许编造）。关键词用目标市场语言。',
      `站点域名：${project.domain}\n品牌背景：${context || '未提供'}\n` +
        `${params.domain ? `竞品域名：${params.domain}\n` : ''}种子词：${params.seed || '（按站点业务扩展）'}\n` +
        `目标市场语言：${params.languageCode}\n请给出 ${params.limit} 个有商业价值的关键词。`,
      1800,
    );
    await this.charge(
      user,
      'seo_keyword_ai',
      call,
      `seo-keywords:${project.id}`,
    );
    const parsed = call.reply ? parseJsonObject(call.reply) : null;
    const ideas = Array.isArray(parsed?.keywords) ? parsed.keywords : [];
    const keywords: ResearchKeyword[] = ideas
      .map((item) => {
        const row = (item || {}) as Row;
        const intent = text(row.intent).toLowerCase();
        return {
          keyword: clip(row.keyword, 200).trim(),
          volume: null,
          cpc: null,
          difficulty: null,
          intent: intentLabel(intent),
          source: 'AI' as const,
          opportunity: INTENT_WEIGHT[intent] ?? 45,
        };
      })
      .filter((item) => item.keyword)
      .slice(0, params.limit);
    const list = keywords.length
      ? keywords
      : this.expandSeed(
          params.seed || project.brandName || project.domain,
          params.limit,
        );
    return { keywords: list, mode: 'ai' as const, reused: false };
  }

  /** LLM 也不可用时的确定性扩展：种子词 × 常见修饰词，指标全部留空（标注为估计）。 */
  private expandSeed(seed: string, limit: number): ResearchKeyword[] {
    const modifiers = [
      '',
      '价格',
      '厂家',
      '批发',
      '供应商',
      '怎么选',
      '十大品牌',
      '定制',
      '报价',
      '多少钱',
    ];
    const base = seed.trim();
    if (!base) return [];
    return modifiers
      .map((modifier) => ({
        keyword: clip(`${base}${modifier}`.trim(), 200),
        volume: null,
        cpc: null,
        difficulty: null,
        intent: modifier ? 'commercial' : 'informational',
        source: 'AI' as const,
        opportunity: modifier ? 60 : 45,
      }))
      .filter((item) => item.keyword)
      .slice(0, limit)
      .map((item) => ({ ...item, intent: intentLabel(item.intent) }));
  }

  async saveKeywords(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const key = orgKeyOf(org);
    const list = Array.isArray(body.keywords) ? body.keywords : [];
    if (!list.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有可保存的关键词');
    let saved = 0;
    for (const item of list.slice(0, 200)) {
      const row = (item || {}) as Row;
      const keyword = clip(row.keyword, 200).trim();
      if (!keyword) continue;
      const source = ['DATAFORSEO', 'AI', 'GSC'].includes(String(row.source))
        ? String(row.source)
        : 'AI';
      const metrics =
        row.volume === null || row.volume === undefined
          ? {}
          : {
              volume: Math.max(0, Math.round(num(row.volume))),
              cpc: row.cpc === null ? null : num(row.cpc),
              difficulty: row.difficulty === null ? null : num(row.difficulty),
              metricsAt: new Date(),
            };
      await this.prisma.seoKeyword.upsert({
        where: {
          orgType_orgUserId_projectId_keyword: {
            ...key,
            projectId: project.id,
            keyword,
          },
        },
        create: {
          ...key,
          projectId: project.id,
          keyword,
          tags: json(strArr(row.tags).map((tag) => clip(tag, 60))),
          intent: clip(row.intent, 40),
          source,
          ...metrics,
        },
        update: {
          tags: json(strArr(row.tags).map((tag) => clip(tag, 60))),
          intent: clip(row.intent, 40),
          source,
          ...metrics,
        },
      });
      saved += 1;
    }
    return { saved };
  }

  async listKeywords(user: CurrentUser, query: PageQuery & Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const tag = text(query.tag);
    const where = {
      ...orgKeyOf(org),
      projectId: row.id,
      ...(query.q ? { keyword: { contains: text(query.q) } } : {}),
      ...(tag ? { tags: { array_contains: tag } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.seoKeyword.count({ where }),
      this.prisma.seoKeyword.findMany({
        where,
        orderBy: [{ volume: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
    ]);
    return pageOf(
      rows.map((item) => this.keywordView(item)),
      total,
      query,
    );
  }

  async removeKeyword(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const result = await this.prisma.seoKeyword.deleteMany({
      where: { id: num(body.id), ...orgKeyOf(org) },
    });
    if (!result.count)
      throw new BusinessException(ErrorCode.NOT_FOUND, '关键词不存在');
    return this.ok('关键词已删除');
  }

  async clusterKeywords(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const key = orgKeyOf(org);
    const keywords = await this.prisma.seoKeyword.findMany({
      where: { ...key, projectId: project.id },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (!keywords.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '词库为空，请先研究或导入关键词',
      );
    const call = await this.ai(
      user,
      '你是 SEO 信息架构师。把给定关键词按搜索意图聚类，只输出 JSON：' +
        '{"clusters":[{"name":"集群名","intent":"informational|commercial|transactional|navigational","keywords":["…"],"mappedPageUrl":"建议承接页路径或空串"}]}。' +
        '每个关键词只能归入一个集群；集群名用中文；不要编造不在清单里的词。',
      `站点：${project.domain}\n关键词清单：\n${keywords
        .map((item) => `${item.keyword}（意图：${item.intent || '未判定'}）`)
        .join('\n')}`,
      2000,
    );
    await this.charge(
      user,
      'seo_keyword_ai',
      call,
      `seo-cluster:${project.id}`,
    );
    const parsed = call.reply ? parseJsonObject(call.reply) : null;
    const rawClusters = readClusters(parsed);
    const groups = rawClusters.length
      ? rawClusters
      : this.ruleClusters(
          keywords.map((item) => ({
            keyword: item.keyword,
            intent: item.intent,
          })),
        );
    const known = new Set(keywords.map((item) => item.keyword));
    await this.prisma.seoKeywordCluster.deleteMany({
      where: { ...key, projectId: project.id },
    });
    await this.prisma.seoKeyword.updateMany({
      where: { ...key, projectId: project.id },
      data: { clusterId: null },
    });
    const created: Array<{
      id: number;
      projectId: number;
      name: string;
      intent: string;
      mappedPageUrl: string;
      keywordCount: number;
    }> = [];
    for (const group of groups.slice(0, 30)) {
      const members = group.keywords.filter((word) => known.has(word));
      if (!members.length) continue;
      const cluster = await this.prisma.seoKeywordCluster.create({
        data: {
          ...key,
          projectId: project.id,
          name: clip(group.name, 120),
          intent: clip(group.intent, 40),
          mappedPageUrl: clip(group.mappedPageUrl, 500),
        },
      });
      await this.prisma.seoKeyword.updateMany({
        where: { ...key, projectId: project.id, keyword: { in: members } },
        data: { clusterId: cluster.id },
      });
      created.push({
        id: cluster.id,
        projectId: project.id,
        name: cluster.name,
        intent: cluster.intent,
        mappedPageUrl: cluster.mappedPageUrl,
        keywordCount: members.length,
      });
    }
    return {
      clusters: created,
      mode:
        call.reply && rawClusters.length ? ('llm' as const) : ('rule' as const),
    };
  }

  private ruleClusters(keywords: Array<{ keyword: string; intent: string }>) {
    const buckets = new Map<
      string,
      { name: string; intent: string; keywords: string[] }
    >();
    for (const item of keywords) {
      const intent = item.intent || '未判定';
      const bucket = buckets.get(intent) || {
        name: `${intent}意图词`,
        intent,
        keywords: [],
      };
      bucket.keywords.push(item.keyword);
      buckets.set(intent, bucket);
    }
    return [...buckets.values()].map((bucket) => ({
      ...bucket,
      mappedPageUrl: '',
    }));
  }

  async listClusters(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const key = orgKeyOf(org);
    const clusters = await this.prisma.seoKeywordCluster.findMany({
      where: { ...key, projectId: row.id },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.seoKeyword.groupBy({
      by: ['clusterId'],
      where: { ...key, projectId: row.id, clusterId: { not: null } },
      _count: { id: true },
    });
    const countOf = new Map(
      counts.map((item) => [item.clusterId, item._count.id]),
    );
    return clusters.map((cluster) => ({
      id: cluster.id,
      projectId: cluster.projectId,
      name: cluster.name,
      intent: cluster.intent,
      mappedPageUrl: cluster.mappedPageUrl,
      keywordCount: countOf.get(cluster.id) || 0,
    }));
  }

  // ---------- GSC ----------

  async importGsc(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const parsed = parseGscCsv(text(body.csv));
    if (!parsed.rows.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '无法识别该 CSV：需要 Search Console 效果导出（含点击次数/曝光次数/平均排名列）',
      );
    const key = orgKeyOf(org);
    const batch = await this.prisma.seoGscImport.create({
      data: {
        ...key,
        projectId: project.id,
        fileName: clip(body.fileName, 200) || 'Search Console 导出',
        rowCount: parsed.rows.length,
        dateRange: parsed.dateRange,
        source: 'CSV',
      },
    });
    await this.prisma.seoGscRow.createMany({
      data: parsed.rows.map((row) => ({ importId: batch.id, ...row })),
    });
    return this.importView(batch);
  }

  async listGscImports(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const rows = await this.prisma.seoGscImport.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((item) => this.importView(item));
  }

  async gscAnalysis(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const key = orgKeyOf(org);
    const importId = num(query.importId, 0);
    const batch = importId
      ? await this.prisma.seoGscImport.findFirst({
          where: { id: importId, ...key, projectId: row.id },
        })
      : await this.prisma.seoGscImport.findFirst({
          where: { ...key, projectId: row.id },
          orderBy: { id: 'desc' },
        });
    if (!batch) return analyzeGsc([]);
    const rows = await this.prisma.seoGscRow.findMany({
      where: { importId: batch.id },
      take: 5000,
    });
    return analyzeGsc(rows);
  }

  /** OAuth 同步复用同一张明细表：来源标记在批次上（CSV / OAUTH）。 */
  async saveOauthImport(
    org: { orgType: string; orgUserId: string },
    projectId: number,
    rows: GscRow[],
    dateRange: string,
  ) {
    const batch = await this.prisma.seoGscImport.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        projectId,
        fileName: 'Search Console 自动同步',
        rowCount: rows.length,
        dateRange: clip(dateRange, 60),
        source: 'OAUTH',
      },
    });
    if (rows.length)
      await this.prisma.seoGscRow.createMany({
        data: rows
          .slice(0, 5000)
          .map((row) => ({ importId: batch.id, ...row })),
      });
    return batch;
  }

  private importView(row: {
    id: number;
    projectId: number;
    fileName: string;
    rowCount: number;
    dateRange: string;
    source: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      fileName: row.fileName,
      rowCount: row.rowCount,
      dateRange: row.dateRange,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private keywordView(row: {
    id: number;
    projectId: number;
    keyword: string;
    tags: unknown;
    clusterId: number | null;
    volume: number | null;
    cpc: number | null;
    difficulty: number | null;
    intent: string;
    source: string;
    metricsAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      keyword: row.keyword,
      tags: strArr(row.tags),
      clusterId: row.clusterId,
      volume: row.volume,
      cpc: row.cpc,
      difficulty: row.difficulty,
      intent: row.intent,
      source: row.source,
      metricsAt: row.metricsAt ? row.metricsAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
