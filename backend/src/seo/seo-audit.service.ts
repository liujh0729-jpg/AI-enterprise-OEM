import type { CurrentUser } from '../auth/current-user';
import type { SeoAudit } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { crawlSite } from './seo-crawler';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  issueLabel,
  json,
  num,
  pageOf,
  sameSite,
  skipTake,
  type PageQuery,
  type Row,
} from './seo-shared';

const STALE_LOCK_MS = 30 * 60_000;

/** 站点体检：免费自有抓取 + 约 30 项确定性规则；Lighthouse 与 AI 解读为可选付费层。 */
export class SeoAuditService extends SeoBase {
  async startAudit(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const startUrl = clip(body.startUrl, 500);
    const includeSubdomains = Boolean(body.includeSubdomains);
    if (!sameSite(startUrl, project.domain, includeSubdomains))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '起始地址必须属于该站点档案的域名',
      );
    const key = orgKeyOf(org);
    const running = await this.prisma.seoAudit.findFirst({
      where: { ...key, projectId: project.id, activeLock: project.id },
    });
    if (running) {
      // 进程崩溃会留下死锁：超过 30 分钟无进展才回收，正常任务绝不抢占
      if (Date.now() - running.createdAt.getTime() < STALE_LOCK_MS)
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该站点已有体检在进行中，请等待完成',
        );
      await this.prisma.seoAudit.update({
        where: { id: running.id },
        data: {
          status: 'FAILED',
          activeLock: null,
          errorCode: '任务超时未完成，已回收',
          finishedAt: new Date(),
        },
      });
    }
    const audit = await this.prisma.seoAudit.create({
      data: {
        ...key,
        projectId: project.id,
        startUrl,
        maxPages: Math.min(200, Math.max(1, num(body.maxPages, 50))),
        includeSubdomains,
        runLighthouse: Boolean(body.runLighthouse),
        status: 'PENDING',
        phase: 'DISCOVER',
        activeLock: project.id,
        createdBy: org.actorId,
      },
    });
    void this.execute(audit.id, project.domain).catch(() => undefined);
    return this.auditView(audit);
  }

  /** 后台执行：阶段回写让前端能轮询进度；任何失败都落到 FAILED 并释放单飞锁。 */
  private async execute(auditId: number, domain: string) {
    const audit = await this.prisma.seoAudit.findUnique({
      where: { id: auditId },
    });
    if (!audit) return;
    try {
      await this.prisma.seoAudit.update({
        where: { id: auditId },
        data: { status: 'RUNNING', phase: 'DISCOVER' },
      });
      const result = await crawlSite({
        domain,
        startUrl: audit.startUrl,
        maxPages: audit.maxPages,
        includeSubdomains: audit.includeSubdomains,
        onPhase: async (phase, pageCount) => {
          await this.prisma.seoAudit.update({
            where: { id: auditId },
            data: { phase, pageCount },
          });
        },
      });
      const sitemap = new Set(
        result.sitemapUrls.map((url) => url.replace(/\/$/, '').toLowerCase()),
      );
      await this.prisma.seoAuditPage.createMany({
        data: result.pages.map((page) => ({
          auditId,
          url: clip(page.url, 500),
          fetchStatus: page.fetchStatus,
          title: clip(page.title, 500),
          metaDescription: page.metaDescription,
          canonical: clip(page.canonical, 500),
          h1: json(page.h1),
          wordCount: page.wordCount,
          imageCount: page.images.length,
          imagesMissingAlt: page.images.filter((image) => !image.alt.trim())
            .length,
          internalLinks: page.links.filter((link) => link.internal).length,
          externalLinks: page.links.filter((link) => !link.internal).length,
          hasJsonLd: page.jsonLd.length > 0,
          bytes: page.bytes,
          blockingScripts: page.blockingScripts,
          inSitemap: sitemap.has(page.url.replace(/\/$/, '').toLowerCase()),
          contentHash: page.contentHash,
        })),
      });
      const savedPages = await this.prisma.seoAuditPage.findMany({
        where: { auditId },
        select: { id: true, url: true },
      });
      const pageIdByUrl = new Map(
        savedPages.map((page) => [page.url, page.id]),
      );
      if (result.issues.length)
        await this.prisma.seoAuditIssue.createMany({
          data: result.issues.map((issue) => ({
            auditId,
            pageId: pageIdByUrl.get(issue.pageUrl || issue.url) ?? null,
            url: issue.url,
            type: clip(issue.type, 60),
            severity: issue.severity,
            detail: issue.detail,
            fixHint: issue.fixHint,
          })),
        });
      if (audit.runLighthouse) await this.measureLighthouse(audit);
      await this.prisma.seoAudit.update({
        where: { id: auditId },
        data: {
          status: 'DONE',
          phase: 'DONE',
          healthScore: result.healthScore,
          pageCount: result.pages.length,
          issueCount: result.issues.length,
          criticalCount: result.criticalCount,
          warningCount: result.warningCount,
          activeLock: null,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.seoAudit
        .update({
          where: { id: auditId },
          data: {
            status: 'FAILED',
            phase: 'DONE',
            errorCode: clip(
              error instanceof Error ? error.message : '体检失败',
              200,
            ),
            activeLock: null,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  /** 可选付费层：DataForSEO Lighthouse（不在服务器装 Chrome）；结果进研究日志，30 天同参复用。 */
  private async measureLighthouse(audit: SeoAudit) {
    const credential = await this.ctx.dfs.credential(audit.createdBy);
    if (!credential) return;
    await this.research({
      org: { orgType: audit.orgType, orgUserId: audit.orgUserId },
      projectId: audit.projectId,
      action: 'lighthouse',
      params: { url: audit.startUrl, device: 'MOBILE' },
      resultRef: `audit:${audit.id}`,
      load: () => this.ctx.dfs.lighthouse(credential, audit.startUrl, 'MOBILE'),
    }).catch(() => undefined);
  }

  async listAudits(user: CurrentUser, query: PageQuery & Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const where = { ...orgKeyOf(org), projectId: row.id };
    const [total, rows] = await Promise.all([
      this.prisma.seoAudit.count({ where }),
      this.prisma.seoAudit.findMany({
        where,
        orderBy: { id: 'desc' },
        ...skipTake(query),
      }),
    ]);
    return pageOf(
      rows.map((item) => this.auditView(item)),
      total,
      query,
    );
  }

  async getAudit(user: CurrentUser, id: number) {
    const org = await this.org(user);
    const audit = await this.prisma.seoAudit.findFirst({
      where: { id: Number(id), ...orgKeyOf(org) },
    });
    if (!audit)
      throw new BusinessException(ErrorCode.NOT_FOUND, '体检任务不存在');
    const [issues, pages, advice, lighthouseLog] = await Promise.all([
      this.prisma.seoAuditIssue.findMany({
        where: { auditId: audit.id },
        orderBy: [{ severity: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
      this.prisma.seoAuditPage.findMany({
        where: { auditId: audit.id },
        orderBy: { id: 'asc' },
        take: 200,
      }),
      this.prisma.mktArtifact.findFirst({
        where: {
          ...orgKeyOf(org),
          kind: 'SEO_AUDIT',
          sourceRunId: audit.id,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.seoResearchLog.findFirst({
        where: {
          orgType: audit.orgType,
          orgUserId: audit.orgUserId,
          projectId: audit.projectId,
          action: 'lighthouse',
          resultRef: `audit:${audit.id}`,
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const okPages = pages.filter((page) => page.fetchStatus === 'OK');
    const avg = (values: number[]) =>
      values.length
        ? Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          )
        : 0;
    const lighthouse = (lighthouseLog?.payload || null) as {
      performance: number;
      accessibility: number;
      bestPractices: number;
      seo: number;
      lcp: number | null;
      cls: number | null;
      inp: number | null;
      ttfb: number | null;
    } | null;
    return {
      audit: this.auditView(audit),
      issues: issues.map((issue) => ({
        id: issue.id,
        auditId: issue.auditId,
        pageId: issue.pageId,
        url: issue.url,
        type: issue.type,
        typeLabel: issueLabel(issue.type),
        severity: issue.severity,
        detail: issue.detail,
        fixHint: issue.fixHint,
      })),
      pages: pages.map((page) => ({
        id: page.id,
        auditId: page.auditId,
        url: page.url,
        fetchStatus: page.fetchStatus,
        title: page.title,
        metaDescription: page.metaDescription,
        canonical: page.canonical,
        h1: Array.isArray(page.h1) ? (page.h1 as string[]) : [],
        wordCount: page.wordCount,
        imageCount: page.imageCount,
        imagesMissingAlt: page.imagesMissingAlt,
        internalLinks: page.internalLinks,
        externalLinks: page.externalLinks,
        hasJsonLd: page.hasJsonLd,
        bytes: page.bytes,
        blockingScripts: page.blockingScripts,
        inSitemap: page.inSitemap,
      })),
      performance: {
        available: okPages.length > 0,
        note: lighthouse
          ? '性能分为 DataForSEO Lighthouse 实测（移动端）。'
          : '以下为服务端 HTML 的静态线索（体积、阻塞脚本、图片 alt），不是真实渲染性能分。' +
            '单页应用客户端渲染的内容测不到；需要真实性能分请在体检时勾选 Lighthouse（DataForSEO 付费）。',
        avgBytes: avg(okPages.map((page) => page.bytes)),
        avgBlockingScripts: avg(okPages.map((page) => page.blockingScripts)),
        imagesMissingAlt: okPages.reduce(
          (sum, page) => sum + page.imagesMissingAlt,
          0,
        ),
        lighthouse:
          lighthouse && typeof lighthouse.performance === 'number'
            ? lighthouse
            : null,
      },
      aiAdvice: advice?.body || '',
    };
  }

  async explainAudit(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const audit = await this.prisma.seoAudit.findFirst({
      where: { id: num(body.id), ...orgKeyOf(org) },
    });
    if (!audit)
      throw new BusinessException(ErrorCode.NOT_FOUND, '体检任务不存在');
    if (audit.status !== 'DONE')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '体检尚未完成，完成后才能生成修复建议',
      );
    const issues = await this.prisma.seoAuditIssue.findMany({
      where: { auditId: audit.id },
      orderBy: [{ severity: 'asc' }, { id: 'asc' }],
      take: 60,
    });
    const grouped = this.groupIssues(issues);
    const call = await this.ai(
      user,
      '你是资深技术 SEO 顾问。基于给定的真实体检问题清单，输出中文修复优先级建议：' +
        '先按「本周必做 / 本月安排 / 长期优化」三档分组，每条给出具体动作与预期收益。' +
        '不要编造清单里没有的问题，不要给出无法验证的排名承诺。',
      `站点：${audit.startUrl}\n健康分：${audit.healthScore ?? '未出分'}\n` +
        `页面数：${audit.pageCount}，问题数：${audit.issueCount}\n问题清单：\n${grouped}`,
      1800,
    );
    const mode: 'llm' | 'rule' = call.reply ? 'llm' : 'rule';
    const advice =
      call.reply ||
      `以下是按规则整理的修复顺序（未调用 AI，不消耗积分）：\n\n${this.ruleAdvice(issues)}`;
    await this.charge(user, 'seo_audit_ai', call, `seo-audit:${audit.id}`);
    await this.prisma.mktArtifact.create({
      data: {
        ...orgKeyOf(org),
        title: clip(`SEO 体检修复建议 · ${audit.startUrl}`, 120),
        kind: 'SEO_AUDIT',
        body: advice,
        status: 'READY',
        sourceRunId: audit.id,
        createdBy: org.actorId,
      },
    });
    return { advice, mode };
  }

  private groupIssues(
    issues: Array<{
      type: string;
      severity: string;
      url: string;
      detail: string;
    }>,
  ): string {
    return issues
      .map(
        (issue) =>
          `[${issue.severity}] ${issueLabel(issue.type)} ${issue.url} — ${issue.detail}`,
      )
      .join('\n');
  }

  private ruleAdvice(
    issues: Array<{
      type: string;
      severity: string;
      url: string;
      fixHint: string;
    }>,
  ): string {
    if (!issues.length)
      return '本次体检未发现问题，保持现有结构与内容更新节奏即可。';
    const order = ['CRITICAL', 'WARNING', 'INFO'];
    const labels: Record<string, string> = {
      CRITICAL: '本周必做（严重）',
      WARNING: '本月安排（警告）',
      INFO: '长期优化（提示）',
    };
    return order
      .map((severity) => {
        const list = issues.filter((issue) => issue.severity === severity);
        if (!list.length) return '';
        const byType = new Map<string, number>();
        for (const issue of list)
          byType.set(issue.type, (byType.get(issue.type) || 0) + 1);
        const lines = [...byType.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([type, count]) => {
            const sample = list.find((issue) => issue.type === type);
            return `- ${issueLabel(type)}（${count} 处）：${sample?.fixHint || ''}`;
          });
        return `## ${labels[severity]}\n${lines.join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private auditView(row: SeoAudit) {
    return {
      id: row.id,
      projectId: row.projectId,
      startUrl: row.startUrl,
      maxPages: row.maxPages,
      status: row.status,
      phase: row.phase,
      healthScore: row.healthScore,
      pageCount: row.pageCount,
      issueCount: row.issueCount,
      criticalCount: row.criticalCount,
      warningCount: row.warningCount,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }
}
