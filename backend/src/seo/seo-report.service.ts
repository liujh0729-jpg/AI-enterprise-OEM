import type { CurrentUser } from '../auth/current-user';
import type { MktArtifact } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  orgKeyOf,
  SeoBase,
  type SeoContext,
  type SeoScope,
} from './seo-base.service';
import type { SeoProjectService } from './seo-project.service';
import { analyzeGsc, type GscRow } from './seo-gsc';
import { clip, paramsHash } from './seo-shared';

const REPORT_KIND = 'SEO_REPORT';
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * 分享前脱敏（硬约束）：公开链接面向站外，正文不得带凭据、抓取到的邮箱原文。
 * 机会词明细与竞品内部数据不进公开投影（publicProjection 只收聚合指标）。
 */
export function desensitizeReport(markdown: string): string {
  return markdown
    .replace(EMAIL_RE, '〔邮箱已脱敏〕')
    .replace(
      /(?:token|password|secret|api[_-]?key|refresh_token|client_secret)\s*[:=]\s*\S+/gi,
      '〔凭据已脱敏〕',
    )
    .replace(/\b\d{16,}:[A-Za-z0-9_-]{16,}\b/g, '〔凭据已脱敏〕')
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      '〔令牌已脱敏〕',
    );
}

/** 公开投影白名单：只有结论与聚合指标，机会词/竞品明细/联系方式一律不进。 */
export function publicProjection(input: {
  title: string;
  domain: string;
  summary: string;
}) {
  return {
    title: input.title,
    domain: input.domain,
    summary: desensitizeReport(input.summary),
  };
}

type ReportData = {
  metrics: {
    domain: string;
    brandName: string;
    healthScore: number | null;
    keywordCount: number;
    trackerCount: number;
    auditCount: number;
    backlinkTotal: number | null;
    referringDomains: number | null;
    geoMentionRate: number | null;
    ga4Sessions: number | null;
    providerConnected: boolean;
    googleConnected: boolean;
    trackedKeywords: number;
    avgPosition: number | null;
    top3: number;
    gscClicks: number;
    gscImpressions: number;
    aiEstimatedKeywords: number;
  };
  issues: Array<{ type: string; severity: string; url: string }>;
  striking: Array<{
    query: string;
    page: string;
    impressions: number;
    position: number;
  }>;
  rankTrend: Array<{ date: string; avgPosition: number | null }>;
  pageCount: number;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
};

/** SEO 报告：聚合本工作台已有数据 → LLM 撰写（缺模型规则式拼装）→ MktArtifact → 脱敏分享。 */
export class SeoReportService extends SeoBase {
  constructor(
    ctx: SeoContext,
    private readonly projects: SeoProjectService,
  ) {
    super(ctx);
  }

  async generateReport(
    user: CurrentUser,
    body: { projectId: number; periodLabel?: string },
  ) {
    const { org, row } = await this.project(user, body.projectId);
    const scope: SeoScope = { ...orgKeyOf(org), projectId: row.id };
    const periodLabel =
      clip(body.periodLabel, 60).trim() || this.defaultPeriod();
    const data = await this.collect(user, scope, row.domain, row.brandName);
    const call = await this.ai(
      user,
      [
        '你是 SEO 分析顾问，输出 Markdown 报告。结构固定四段：## 现状 / ## 机会 / ## 本期行动（按优先级列 3-5 条）/ ## 证据与口径。',
        '硬约束：只使用给出的数据，不得编造排名、流量、外链数或搜索量；数据缺失就写「未采集」并说明缺哪一层；',
        '不承诺排名结果；区分「实测数据」与「AI 估计」；不要在报告里写任何凭据、邮箱原文；',
        '行动项要具体到页面/关键词层级，中文，总长 800-1500 字。',
      ].join('\n'),
      [
        `站点：${row.domain}（品牌 ${row.brandName}）`,
        `周期：${periodLabel}`,
        `聚合数据：${JSON.stringify(data.metrics)}`,
        `体检问题摘要：${JSON.stringify(data.issues)}`,
        `GSC 机会词（排名 5-20）：${JSON.stringify(data.striking)}`,
        `排名趋势：${JSON.stringify(data.rankTrend)}`,
      ].join('\n'),
      2500,
    );
    let markdown = (call.reply || '').trim();
    let mode: 'llm' | 'rule' = 'llm';
    if (!markdown) {
      markdown = this.ruleReport(row.domain, row.brandName, periodLabel, data);
      mode = 'rule';
    } else {
      await this.charge(
        user,
        'seo_report_ai',
        call,
        `seo-report:${row.id}:${periodLabel}`,
      );
      markdown = `${markdown}\n\n---\n\n${this.evidenceAppendix(data)}`;
    }
    const title = clip(`${row.domain} SEO 报告 · ${periodLabel}`, 120);
    // 同站点同周期替换旧草稿，不重复堆积
    const existing = await this.prisma.mktArtifact.findFirst({
      where: { ...orgKeyOf(org), kind: REPORT_KIND, title, status: 'DRAFT' },
      orderBy: { id: 'desc' },
    });
    const artifact = existing
      ? await this.prisma.mktArtifact.update({
          where: { id: existing.id },
          data: { body: markdown, sourceRunId: row.id },
        })
      : await this.prisma.mktArtifact.create({
          data: {
            ...orgKeyOf(org),
            title,
            kind: REPORT_KIND,
            body: markdown,
            status: 'DRAFT',
            sourceRunId: row.id,
            createdBy: user.userId,
          },
        });
    await this.prisma.seoResearchLog
      .create({
        data: {
          ...orgKeyOf(org),
          projectId: row.id,
          action: 'report',
          paramsHash: paramsHash({ projectId: row.id, periodLabel }),
          resultRef: `artifact:${artifact.id}`,
          payload: { mode, healthScore: data.metrics.healthScore },
        },
      })
      .catch(() => undefined);
    return this.reportView(artifact, '');
  }

  async listReports(user: CurrentUser, query: { projectId: number }) {
    const { org, row } = await this.project(user, query.projectId);
    const rows = await this.prisma.mktArtifact.findMany({
      where: { ...orgKeyOf(org), kind: REPORT_KIND, sourceRunId: row.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    const shares = rows.length
      ? await this.prisma.publicShare.findMany({
          where: {
            ...orgKeyOf(org),
            kind: 'REPORT',
            targetId: { in: rows.map((item) => String(item.id)) },
          },
          orderBy: { id: 'desc' },
        })
      : [];
    return rows.map((item) => {
      const share = shares.find((entry) => entry.targetId === String(item.id));
      return this.reportView(item, share ? `/share/${share.slug}` : '');
    });
  }

  async shareReport(user: CurrentUser, body: { id: number }) {
    const org = await this.org(user);
    const artifact = await this.prisma.mktArtifact.findFirst({
      where: { id: Number(body.id), ...orgKeyOf(org), kind: REPORT_KIND },
    });
    if (!artifact)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SEO 报告不存在');
    const project = artifact.sourceRunId
      ? await this.prisma.seoProject.findFirst({
          where: { id: artifact.sourceRunId, ...orgKeyOf(org) },
        })
      : null;
    const safeBody = desensitizeReport(artifact.body);
    const summary = safeBody
      .split('\n')
      .filter(
        (line) =>
          line.trim() && !line.startsWith('#') && !line.startsWith('<!--'),
      )
      .slice(0, 6)
      .join('\n');
    const share = await this.ctx.mechanisms.createShare(user, {
      kind: 'REPORT',
      targetId: String(artifact.id),
      title: artifact.title,
      projection: publicProjection({
        title: artifact.title,
        domain: project?.domain || '',
        summary,
      }),
    });
    await this.prisma.mktArtifact.update({
      where: { id: artifact.id },
      data: { status: 'READY' },
    });
    return { shareUrl: share.url };
  }

  // -------------------------------------------------------------------------

  private async collect(
    user: CurrentUser,
    scope: SeoScope,
    domain: string,
    brandName: string,
  ): Promise<ReportData> {
    const overview = await this.projects.overview(user, {
      projectId: scope.projectId,
    });
    const [audit, keywords, trackers, gscImport] = await Promise.all([
      this.prisma.seoAudit.findFirst({
        where: { ...scope, status: 'DONE' },
        orderBy: { id: 'desc' },
      }),
      this.prisma.seoKeyword.findMany({
        where: scope,
        orderBy: { id: 'desc' },
        take: 200,
      }),
      this.prisma.seoRankTracker.findMany({
        where: scope,
        select: { id: true },
      }),
      this.prisma.seoGscImport.findFirst({
        where: scope,
        orderBy: { id: 'desc' },
      }),
    ]);
    const [issues, snapshots] = await Promise.all([
      audit
        ? this.prisma.seoAuditIssue.findMany({
            where: { auditId: audit.id },
            orderBy: { severity: 'asc' },
            take: 40,
          })
        : Promise.resolve([]),
      trackers.length
        ? this.prisma.seoRankSnapshot.findMany({
            where: { trackerId: { in: trackers.map((item) => item.id) } },
            orderBy: { id: 'desc' },
            take: 500,
          })
        : Promise.resolve([]),
    ]);
    const gscRows: GscRow[] = gscImport
      ? (
          await this.prisma.seoGscRow.findMany({
            where: { importId: gscImport.id },
            take: 5000,
          })
        ).map((item) => ({
          query: item.query,
          page: item.page,
          clicks: item.clicks,
          impressions: item.impressions,
          ctr: item.ctr,
          position: item.position,
        }))
      : [];
    const analysis = analyzeGsc(gscRows);
    const positions = snapshots
      .map((item) => item.position)
      .filter((value): value is number => typeof value === 'number');
    return {
      metrics: {
        domain,
        brandName,
        healthScore: overview.healthScore,
        keywordCount: overview.keywordCount,
        trackerCount: overview.trackerCount,
        auditCount: overview.auditCount,
        backlinkTotal: overview.backlinkTotal,
        referringDomains: overview.referringDomains,
        geoMentionRate: overview.geoMentionRate,
        ga4Sessions: overview.ga4Sessions,
        providerConnected: overview.providerConnected,
        googleConnected: overview.googleConnected,
        trackedKeywords: positions.length,
        avgPosition: positions.length
          ? Math.round(
              (positions.reduce((sum, value) => sum + value, 0) /
                positions.length) *
                10,
            ) / 10
          : null,
        top3: positions.filter((value) => value <= 3).length,
        gscClicks: analysis.totalClicks,
        gscImpressions: analysis.totalImpressions,
        aiEstimatedKeywords: keywords.filter((item) => item.source === 'AI')
          .length,
      },
      issues: issues.map((item) => ({
        type: item.type,
        severity: item.severity,
        url: item.url,
      })),
      striking: analysis.strikingDistance.slice(0, 15).map((item) => ({
        query: item.query,
        page: item.page,
        impressions: item.impressions,
        position: item.position,
      })),
      rankTrend: overview.rankTrend,
      pageCount: audit?.pageCount ?? 0,
      issueCount: audit?.issueCount ?? 0,
      criticalCount: audit?.criticalCount ?? 0,
      warningCount: audit?.warningCount ?? 0,
    };
  }

  private ruleReport(
    domain: string,
    brandName: string,
    periodLabel: string,
    data: ReportData,
  ): string {
    const m = data.metrics;
    const show = (value: number | null, unit = '') =>
      value === null ? '未采集' : `${value}${unit}`;
    const lines = [
      `# ${domain} SEO 报告 · ${periodLabel}`,
      '',
      '> 本报告由规则模板拼装（未调用 AI），全部数字来自本工作台已采集数据。',
      '',
      '## 现状',
      `- 品牌：${brandName}`,
      `- 体检健康分：${show(m.healthScore)}；最近一次抓取 ${data.pageCount} 页，发现 ${data.issueCount} 个问题（严重 ${data.criticalCount} / 警告 ${data.warningCount}）`,
      `- 词库：${m.keywordCount} 个关键词，其中 ${m.aiEstimatedKeywords} 个为 AI 估计（无搜索量实测）`,
      `- 排名跟踪：${m.trackerCount} 个跟踪器，最近快照平均名次 ${show(m.avgPosition)}，前 3 名 ${m.top3} 条`,
      `- 外链：总数 ${show(m.backlinkTotal)}，引荐域 ${show(m.referringDomains)}`,
      `- Search Console：点击 ${m.gscClicks}，曝光 ${m.gscImpressions}`,
      `- GA4 会话：${show(m.ga4Sessions)}`,
      `- GEO 提及率：${show(m.geoMentionRate, '%')}`,
      '',
      '## 机会',
    ];
    if (data.striking.length) {
      lines.push(
        '排名 5-20 位的「一步之遥」词（按曝光排序，优化既有页面即可望进前三）：',
      );
      for (const item of data.striking.slice(0, 10))
        lines.push(
          `- ${item.query} ｜ 平均名次 ${item.position} ｜ 曝光 ${item.impressions} ｜ ${item.page}`,
        );
    } else {
      lines.push(
        '- 暂无 GSC 数据，无法识别「一步之遥」词：请先导入 Search Console CSV 或授权自动同步。',
      );
    }
    lines.push('', '## 本期行动');
    const actions: string[] = [];
    if (data.criticalCount)
      actions.push(
        `先修 ${data.criticalCount} 个严重问题（见站点体检问题清单）。`,
      );
    if (data.warningCount)
      actions.push(`安排修复 ${data.warningCount} 个警告项。`);
    if (data.striking.length)
      actions.push('针对上表机会词优化对应页面的标题、正文与内链。');
    if (!m.providerConnected)
      actions.push(
        '需要搜索量/难度/外链实测时，连接自有 DataForSEO 账号（费用由数据源直接收取）。',
      );
    if (!m.googleConnected)
      actions.push('授权 Search Console / GA4 自动同步，免去每日手工导 CSV。');
    if (!actions.length)
      actions.push('保持现有节奏：每周复查排名跟踪器，按月复跑站点体检。');
    actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
    lines.push('', '## 证据与口径', '', this.evidenceAppendix(data));
    return lines.join('\n');
  }

  private evidenceAppendix(data: ReportData): string {
    const m = data.metrics;
    return [
      `数据口径：体检与 GSC/GA4 为自有抓取或用户授权导入；搜索量/外链/竞品来自用户自有 DataForSEO 账号（${m.providerConnected ? '已连接' : '未连接，相关指标为空'}）。`,
      '标记为「AI 估计」的关键词没有搜索量实测值，不可当作事实引用。',
      'IndexNow 仅通知 Bing/Yandex 等参与方，Google 与百度不参与；百度主动推送成功仅代表已推送，均不保证收录。',
    ].join('\n');
  }

  private defaultPeriod(): string {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getTime() - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return `${start} ~ ${end}`;
  }

  private reportView(row: MktArtifact, shareUrl: string) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      shareUrl,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
