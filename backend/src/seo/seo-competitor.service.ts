import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { discover, fetchHtml } from './seo-crawler';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  json,
  normalizeDomain,
  num,
  pageOf,
  sameSite,
  text,
  type PageQuery,
  type Row,
} from './seo-shared';

type CompetitorPage = {
  url: string;
  title: string;
  wordCount: number;
  h2Count: number;
  hasJsonLd: boolean;
  internalLinks: number;
  images: number;
};

/** 竞品洞察 + 外链分析：付费实测走 DataForSEO（30 天同参复用），页面结构对比用自有免费抓取。 */
export class SeoCompetitorService extends SeoBase {
  async competitorOverview(user: CurrentUser, query: Row) {
    const { org, row: project } = await this.project(
      user,
      num(query.projectId),
    );
    const domain = normalizeDomain(text(query.domain) || '');
    if (!domain)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写竞品域名');
    const empty = {
      available: false,
      domain,
      organicKeywords: 0,
      organicTraffic: 0,
      backlinks: 0,
      referringDomains: 0,
      rankedKeywords: [],
      overlap: [],
    };
    const credential = await this.ctx.dfs.credential(user.userId);
    if (!credential) return empty;
    const result = await this.research<{
      organicKeywords: number;
      organicTraffic: number;
      rankedKeywords: Array<{
        keyword: string;
        position: number;
        volume: number | null;
      }>;
      backlinks: number;
      referringDomains: number;
    }>({
      org: orgKeyOf(org),
      projectId: project.id,
      action: 'competitor',
      params: {
        domain,
        locationCode: project.locationCode,
        languageCode: project.languageCode,
      },
      resultRef: `competitor:${domain}`,
      load: async () => {
        const overview = await this.ctx.dfs.domainOverview(
          credential,
          domain,
          project.locationCode,
          project.languageCode,
        );
        const links = await this.ctx.dfs.backlinksSummary(credential, domain);
        return {
          ...overview,
          backlinks: links.totalBacklinks,
          referringDomains: links.referringDomains,
        };
      },
    });
    const mine = await this.myPositions(orgKeyOf(org), project.id);
    return {
      available: true,
      domain,
      organicKeywords: result.value.organicKeywords,
      organicTraffic: result.value.organicTraffic,
      backlinks: result.value.backlinks,
      referringDomains: result.value.referringDomains,
      rankedKeywords: result.value.rankedKeywords,
      overlap: result.value.rankedKeywords
        .filter((item) => mine.has(item.keyword.toLowerCase()))
        .slice(0, 50)
        .map((item) => ({
          keyword: item.keyword,
          myPosition: mine.get(item.keyword.toLowerCase()) ?? null,
          theirPosition: item.position,
        })),
    };
  }

  /** 我方最新实测名次（来自排名快照），用于竞品词重叠对比。 */
  private async myPositions(
    key: { orgType: string; orgUserId: string },
    projectId: number,
  ) {
    const trackers = await this.prisma.seoRankTracker.findMany({
      where: { ...key, projectId },
      select: { id: true },
    });
    const positions = new Map<string, number | null>();
    if (!trackers.length) return positions;
    const snapshots = await this.prisma.seoRankSnapshot.findMany({
      where: { trackerId: { in: trackers.map((item) => item.id) } },
      orderBy: { checkedAt: 'desc' },
      take: 2000,
      select: { keyword: true, position: true },
    });
    for (const snapshot of snapshots) {
      const word = snapshot.keyword.toLowerCase();
      if (!positions.has(word)) positions.set(word, snapshot.position);
    }
    return positions;
  }

  async competitorPages(user: CurrentUser, body: Row) {
    const { row: project } = await this.project(user, num(body.projectId));
    const domain = normalizeDomain(text(body.domain) || '');
    if (!domain)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写竞品域名');
    const origin = `https://${domain}`;
    const found = await discover(domain, origin);
    const candidates = [
      origin,
      ...found.sitemapUrls.filter((url) => sameSite(url, domain, false)),
    ].slice(0, 6);
    const pages: CompetitorPage[] = [];
    for (const url of candidates.slice(0, 5)) {
      const page = await fetchHtml(url, domain, { timeoutMs: 15_000 });
      if (page.fetchStatus !== 'OK') continue;
      pages.push({
        url: page.finalUrl || page.url,
        title: clip(page.title, 300),
        wordCount: page.wordCount,
        h2Count: page.h2Count,
        hasJsonLd: page.jsonLd.length > 0,
        internalLinks: page.links.filter((link) => link.internal).length,
        images: page.images.length,
      });
    }
    if (!pages.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '竞品站点抓取失败（可能拒绝自动化访问或为非 HTML 站点），无法做页面结构对比',
      );
    const summary = pages
      .map(
        (page) =>
          `${page.url}｜标题「${page.title}」｜正文 ${page.wordCount} 字｜H2 ${page.h2Count} 个｜` +
          `结构化数据 ${page.hasJsonLd ? '有' : '无'}｜内链 ${page.internalLinks}｜图片 ${page.images}`,
      )
      .join('\n');
    const call = await this.ai(
      user,
      '你是 SEO 内容策略顾问。基于给定的竞品页面真实结构数据，对比我方站点，输出中文可执行建议：' +
        '内容深度、标题写法、结构化数据、内链布局四个维度各给 1~2 条动作。不要编造未提供的数据。',
      `我方站点：${project.domain}\n竞品站点：${domain}\n竞品页面结构：\n${summary}`,
      1500,
    );
    await this.charge(
      user,
      'seo_competitor_ai',
      call,
      `seo-competitor:${project.id}`,
    );
    return {
      domain,
      pages,
      aiAnalysis:
        call.reply ||
        `（规则对比，未调用 AI）\n竞品抽样 ${pages.length} 个页面：` +
          `平均正文 ${Math.round(pages.reduce((sum, page) => sum + page.wordCount, 0) / pages.length)} 字，` +
          `${pages.filter((page) => page.hasJsonLd).length}/${pages.length} 个页面带结构化数据，` +
          `平均 H2 ${Math.round(pages.reduce((sum, page) => sum + page.h2Count, 0) / pages.length)} 个。` +
          '建议：对齐正文深度与 H2 层级，并为同类页面补齐 JSON-LD。',
    };
  }

  // ---------- 外链分析 ----------

  async backlinksOverview(user: CurrentUser, query: Row) {
    const { org, row: project } = await this.project(
      user,
      num(query.projectId),
    );
    const domain = normalizeDomain(text(query.domain) || project.domain);
    const key = orgKeyOf(org);
    const credential = await this.ctx.dfs.credential(user.userId);
    if (!credential) {
      const cached = await this.prisma.seoBacklinkSnapshot.findFirst({
        where: { ...key, projectId: project.id, domain },
        orderBy: { id: 'desc' },
      });
      if (!cached)
        return {
          available: false,
          totalBacklinks: 0,
          referringDomains: 0,
          followLinks: 0,
          nofollowLinks: 0,
          anchors: [],
          queriedAt: null,
        };
      const payload = cached.payload as {
        followLinks?: number;
        nofollowLinks?: number;
        anchors?: Array<{ text: string; count: number }>;
      };
      return {
        available: true,
        totalBacklinks: cached.totalBacklinks,
        referringDomains: cached.referringDomains,
        followLinks: Number(payload.followLinks || 0),
        nofollowLinks: Number(payload.nofollowLinks || 0),
        anchors: Array.isArray(payload.anchors) ? payload.anchors : [],
        queriedAt: cached.queriedAt.toISOString(),
      };
    }
    const result = await this.research<{
      totalBacklinks: number;
      referringDomains: number;
      followLinks: number;
      nofollowLinks: number;
      anchors: Array<{ text: string; count: number }>;
    }>({
      org: key,
      projectId: project.id,
      action: 'backlinks',
      params: { domain },
      resultRef: `backlinks:${domain}`,
      load: () => this.ctx.dfs.backlinksSummary(credential, domain),
    });
    if (!result.reused)
      await this.prisma.seoBacklinkSnapshot.create({
        data: {
          ...key,
          projectId: project.id,
          domain,
          totalBacklinks: result.value.totalBacklinks,
          referringDomains: result.value.referringDomains,
          payload: json(result.value),
        },
      });
    const latest = await this.prisma.seoBacklinkSnapshot.findFirst({
      where: { ...key, projectId: project.id, domain },
      orderBy: { id: 'desc' },
    });
    return {
      available: true,
      ...result.value,
      queriedAt: latest
        ? latest.queriedAt.toISOString()
        : new Date().toISOString(),
    };
  }

  async backlinksProfile(user: CurrentUser, query: PageQuery & Row) {
    const { row: project } = await this.project(user, num(query.projectId));
    const domain = normalizeDomain(text(query.domain) || project.domain);
    const credential = await this.ctx.dfs.credential(user.userId);
    if (!credential) return pageOf([], 0, query);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const result = await this.ctx.dfs.backlinks(
      credential,
      domain,
      pageSize,
      (Math.max(1, query.page) - 1) * pageSize,
    );
    return pageOf(
      result.items.map((item) => ({
        urlFrom: clip(item.url_from, 500),
        urlTo: clip(item.url_to, 500),
        anchor: clip(item.anchor, 300),
        domainFrom: clip(item.domain_from, 200),
        isFollow: Boolean(item.dofollow),
        firstSeen: clip(item.first_seen, 40),
      })),
      result.total,
      query,
    );
  }

  async backlinksHistory(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const rows = await this.prisma.seoBacklinkSnapshot.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: { id: 'desc' },
      take: 60,
    });
    return rows.map((item) => ({
      id: item.id,
      totalBacklinks: item.totalBacklinks,
      referringDomains: item.referringDomains,
      queriedAt: item.queriedAt.toISOString(),
    }));
  }
}
