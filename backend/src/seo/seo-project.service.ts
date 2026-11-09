import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { SEO_PROVIDER_CODE } from './seo-dataforseo.client';
import {
  orgKeyOf,
  SeoBase,
  type OrgKey,
  type SeoScope,
} from './seo-base.service';
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

/** 站点档案 / 数据源设置 / 概览 / 研究日志：SEO 工作台的入口与全局状态。 */
export class SeoProjectService extends SeoBase {
  async listProjects(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.seoProject.findMany({
      where: orgKeyOf(org),
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.projectView(row));
  }

  async createProject(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const domain = normalizeDomain(text(body.domain) || '');
    const existing = await this.prisma.seoProject.findFirst({
      where: { ...orgKeyOf(org), domain },
    });
    if (existing)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该域名已建立站点档案，请直接编辑',
      );
    const row = await this.prisma.seoProject.create({
      data: {
        ...orgKeyOf(org),
        domain,
        brandName: clip(body.brandName, 80),
        locationCode: num(body.locationCode, 2840),
        languageCode: clip(body.languageCode, 12) || 'en',
        competitors: json(strArr(body.competitors).map(normalizeDomain)),
        keyPages: json(this.keyPages(body.keyPages)),
        note: clip(body.note, 500),
        createdBy: org.actorId,
      },
    });
    return this.projectView(row);
  }

  async updateProject(user: CurrentUser, body: Row) {
    const { org, row } = await this.project(user, num(body.id));
    const domain = normalizeDomain(text(body.domain) || row.domain);
    if (domain !== row.domain) {
      const clash = await this.prisma.seoProject.findFirst({
        where: { ...orgKeyOf(org), domain, id: { not: row.id } },
      });
      if (clash)
        throw new BusinessException(ErrorCode.CONFLICT, '该域名已建立站点档案');
    }
    const updated = await this.prisma.seoProject.update({
      where: { id: row.id },
      data: {
        domain,
        brandName: clip(body.brandName, 80),
        locationCode: num(body.locationCode, row.locationCode),
        languageCode: clip(body.languageCode, 12) || row.languageCode,
        competitors: json(strArr(body.competitors).map(normalizeDomain)),
        keyPages: json(this.keyPages(body.keyPages)),
        note: clip(body.note, 500),
      },
    });
    return this.projectView(updated);
  }

  async removeProject(user: CurrentUser, body: Row) {
    const { org, row } = await this.project(user, num(body.id));
    const key = orgKeyOf(org);
    const trackers = await this.prisma.seoRankTracker.findMany({
      where: { ...key, projectId: row.id },
      select: { id: true },
    });
    const trackerIds = trackers.map((item) => item.id);
    const localTrackers = await this.prisma.seoLocalTracker.findMany({
      where: { ...key, projectId: row.id },
      select: { id: true },
    });
    const localIds = localTrackers.map((item) => item.id);
    const audits = await this.prisma.seoAudit.findMany({
      where: { ...key, projectId: row.id },
      select: { id: true },
    });
    const auditIds = audits.map((item) => item.id);
    const imports = await this.prisma.seoGscImport.findMany({
      where: { ...key, projectId: row.id },
      select: { id: true },
    });
    const importIds = imports.map((item) => item.id);
    const runs = await this.prisma.seoProgrammaticRun.findMany({
      where: { ...key, projectId: row.id },
      select: { id: true },
    });
    const runIds = runs.map((item) => item.id);
    await this.prisma.$transaction([
      this.prisma.seoAuditIssue.deleteMany({
        where: { auditId: { in: auditIds } },
      }),
      this.prisma.seoAuditPage.deleteMany({
        where: { auditId: { in: auditIds } },
      }),
      this.prisma.seoAudit.deleteMany({ where: { id: { in: auditIds } } }),
      this.prisma.seoRankSnapshot.deleteMany({
        where: { trackerId: { in: trackerIds } },
      }),
      this.prisma.seoRankRun.deleteMany({
        where: { trackerId: { in: trackerIds } },
      }),
      this.prisma.seoRankKeyword.deleteMany({
        where: { trackerId: { in: trackerIds } },
      }),
      this.prisma.seoRankTracker.deleteMany({
        where: { id: { in: trackerIds } },
      }),
      this.prisma.seoLocalPoint.deleteMany({
        where: { trackerId: { in: localIds } },
      }),
      this.prisma.seoLocalRun.deleteMany({
        where: { trackerId: { in: localIds } },
      }),
      this.prisma.seoLocalTracker.deleteMany({
        where: { id: { in: localIds } },
      }),
      this.prisma.seoGscRow.deleteMany({
        where: { importId: { in: importIds } },
      }),
      this.prisma.seoGscImport.deleteMany({ where: { id: { in: importIds } } }),
      this.prisma.seoKeyword.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoKeywordCluster.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoBacklinkSnapshot.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoLinkProspect.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoIndexnowKey.deleteMany({ where: { projectId: row.id } }),
      this.prisma.seoIndexnowSubmission.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoBaiduCredential.deleteMany({
        where: { projectId: row.id },
      }),
      this.prisma.seoBaiduSubmission.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoProgrammaticPage.deleteMany({
        where: { runId: { in: runIds } },
      }),
      this.prisma.seoProgrammaticRun.deleteMany({
        where: { id: { in: runIds } },
      }),
      this.prisma.seoGa4Row.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoResearchLog.deleteMany({
        where: { ...key, projectId: row.id },
      }),
      this.prisma.seoProject.delete({ where: { id: row.id } }),
    ]);
    return this.ok('站点档案及其 SEO 数据已删除');
  }

  private keyPages(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).map((item) => {
      const row = (item || {}) as Row;
      const role = text(row.role) || 'OTHER';
      return {
        url: clip(row.url, 500),
        role: ['HUB', 'CONTENT', 'MONEY', 'OTHER'].includes(role)
          ? role
          : 'OTHER',
      };
    });
  }

  // ---------- 数据源设置 ----------

  async settings(user: CurrentUser) {
    const rows = await this.prisma.seoProviderSetting.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
    });
    const list = rows.map((row) => ({
      code: row.code,
      accountName: row.accountName,
      connected: Boolean(row.credentialCipher),
      updatedAt: row.updatedAt.toISOString(),
    }));
    if (!list.some((item) => item.code === SEO_PROVIDER_CODE))
      list.unshift({
        code: SEO_PROVIDER_CODE,
        accountName: '',
        connected: false,
        updatedAt: '',
      });
    return list;
  }

  async saveProvider(user: CurrentUser, body: Row) {
    const code = clip(body.code, 40);
    if (code !== SEO_PROVIDER_CODE)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '当前只支持 DataForSEO 数据源',
      );
    const login = clip(body.login, 200).trim();
    const password = clip(body.password, 200).trim();
    if (!login || !password)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 DataForSEO 的登录名与 API 密码（两者都要）',
      );
    const row = await this.prisma.seoProviderSetting.upsert({
      where: { userId_code: { userId: user.userId, code } },
      create: {
        userId: user.userId,
        code,
        accountName: clip(body.accountName, 80) || login,
        credentialCipher: this.ctx.crypto.encrypt(`${login}:${password}`),
        connected: false,
      },
      update: {
        accountName: clip(body.accountName, 80) || login,
        credentialCipher: this.ctx.crypto.encrypt(`${login}:${password}`),
        connected: false,
      },
    });
    return {
      code: row.code,
      accountName: row.accountName,
      connected: false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async clearProvider(user: CurrentUser, body: Row) {
    await this.prisma.seoProviderSetting.deleteMany({
      where: { userId: user.userId, code: clip(body.code, 40) },
    });
    return this.ok('数据源凭据已清除');
  }

  async testProvider(user: CurrentUser, body: Row) {
    const code = clip(body.code, 40);
    if (code !== SEO_PROVIDER_CODE)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '当前只支持 DataForSEO 数据源',
      );
    const credential = await this.requireDfs(user);
    const result = await this.ctx.dfs.testConnection(credential);
    await this.prisma.seoProviderSetting.update({
      where: { userId_code: { userId: user.userId, code } },
      data: { connected: result.ok },
    });
    return result;
  }

  // ---------- 概览 ----------

  async overview(user: CurrentUser, query: Row) {
    const org = await this.org(user);
    const key = orgKeyOf(org);
    const projectId = num(query.projectId, 0);
    const row = projectId
      ? await this.prisma.seoProject.findFirst({
          where: { id: projectId, ...key },
        })
      : await this.prisma.seoProject.findFirst({
          where: key,
          orderBy: { id: 'desc' },
        });
    const providerConnected = await this.providerConnected(user.userId);
    const google = await this.prisma.seoGoogleConnection.findMany({
      where: key,
    });
    const googleConnected = google.some((item) => item.refreshTokenCipher);
    if (!row) {
      return {
        project: null,
        healthScore: null,
        keywordCount: 0,
        trackerCount: 0,
        auditCount: 0,
        backlinkTotal: null,
        referringDomains: null,
        geoMentionRate: null,
        ga4Sessions: null,
        rankTrend: [],
        setup: this.setupItems({
          hasProject: false,
          providerConnected,
          googleConnected,
          auditCount: 0,
          keywordCount: 0,
          trackerCount: 0,
          gscCount: 0,
          indexnowVerified: false,
        }),
        providerConnected,
        googleConnected,
      };
    }
    const scope: SeoScope = { ...key, projectId: row.id };
    const [
      audit,
      keywordCount,
      trackerCount,
      auditCount,
      backlink,
      gscCount,
      ga4,
      indexnow,
    ] = await Promise.all([
      this.prisma.seoAudit.findFirst({
        where: { ...scope, status: 'DONE' },
        orderBy: { id: 'desc' },
      }),
      this.prisma.seoKeyword.count({ where: scope }),
      this.prisma.seoRankTracker.count({ where: scope }),
      this.prisma.seoAudit.count({ where: scope }),
      this.prisma.seoBacklinkSnapshot.findFirst({
        where: scope,
        orderBy: { id: 'desc' },
      }),
      this.prisma.seoGscImport.count({ where: scope }),
      this.prisma.seoGa4Row.aggregate({
        where: scope,
        _sum: { sessions: true },
      }),
      this.prisma.seoIndexnowKey.findUnique({ where: { projectId: row.id } }),
    ]);
    return {
      project: this.projectView(row),
      healthScore: audit?.healthScore ?? null,
      keywordCount,
      trackerCount,
      auditCount,
      backlinkTotal: backlink?.totalBacklinks ?? null,
      referringDomains: backlink?.referringDomains ?? null,
      geoMentionRate: await this.geoMentionRate(org, row.brandName, row.domain),
      ga4Sessions: ga4._sum.sessions ?? null,
      rankTrend: await this.rankTrend(scope),
      setup: this.setupItems({
        hasProject: true,
        providerConnected,
        googleConnected,
        auditCount,
        keywordCount,
        trackerCount,
        gscCount,
        indexnowVerified: Boolean(indexnow?.verifiedAt),
      }),
      providerConnected,
      googleConnected,
    };
  }

  private setupItems(input: {
    hasProject: boolean;
    providerConnected: boolean;
    googleConnected: boolean;
    auditCount: number;
    keywordCount: number;
    trackerCount: number;
    gscCount: number;
    indexnowVerified: boolean;
  }) {
    return [
      { key: 'project', label: '建立站点档案', done: input.hasProject },
      {
        key: 'audit',
        label: '完成一次站点体检（免费）',
        done: input.auditCount > 0,
      },
      {
        key: 'keywords',
        label: '建立关键词词库',
        done: input.keywordCount > 0,
      },
      {
        key: 'tracker',
        label: '建立排名跟踪器',
        done: input.trackerCount > 0,
      },
      {
        key: 'gsc',
        label: '导入 Search Console 数据',
        done: input.gscCount > 0,
      },
      {
        key: 'provider',
        label: '连接 DataForSEO（付费实测，选填）',
        done: input.providerConnected,
      },
      {
        key: 'google',
        label: '授权 Google 自动同步（选填）',
        done: input.googleConnected,
      },
      {
        key: 'indexnow',
        label: '验证 IndexNow 密钥',
        done: input.indexnowVerified,
      },
    ];
  }

  /** 与 GEO 分析联动：取同品牌最近一批真实采集的点名率；无真实数据返回 null，不编造。 */
  private async geoMentionRate(
    org: OrgKey,
    brandName: string,
    domain: string,
  ): Promise<number | null> {
    const projects = await this.prisma.geoProject.findMany({
      where: {
        OR: [
          { ownerUserId: org.orgUserId },
          { enterpriseUserId: org.orgUserId },
        ],
      },
      orderBy: { id: 'desc' },
      take: 20,
    });
    const brand = brandName.trim().toLowerCase();
    const matched =
      projects.find((item) => brand && item.brand.toLowerCase() === brand) ||
      projects.find((item) => domain.includes(item.brand.toLowerCase())) ||
      (projects.length === 1 ? projects[0] : null);
    if (!matched) return null;
    const batch = await this.prisma.geoBatch.findFirst({
      where: { projectId: matched.id, dataNature: 'real' },
      orderBy: { id: 'desc' },
    });
    if (!batch) return null;
    const [total, mentioned] = await Promise.all([
      this.prisma.geoObservation.count({ where: { batchId: batch.id } }),
      this.prisma.geoObservation.count({
        where: { batchId: batch.id, brandMentioned: 1 },
      }),
    ]);
    if (!total) return null;
    return Math.round((mentioned / total) * 1000) / 10;
  }

  private async rankTrend(scope: SeoScope) {
    const trackers = await this.prisma.seoRankTracker.findMany({
      where: scope,
      select: { id: true },
    });
    if (!trackers.length) return [];
    const runs = await this.prisma.seoRankRun.findMany({
      where: {
        trackerId: { in: trackers.map((item) => item.id) },
        status: 'DONE',
      },
      orderBy: { startedAt: 'desc' },
      take: 30,
      select: { id: true, startedAt: true },
    });
    if (!runs.length) return [];
    const snapshots = await this.prisma.seoRankSnapshot.findMany({
      where: { runId: { in: runs.map((item) => item.id) } },
      select: { runId: true, position: true },
    });
    const byRun = new Map<number, { sum: number; count: number }>();
    for (const snapshot of snapshots) {
      if (snapshot.position === null) continue;
      const bucket = byRun.get(snapshot.runId) || { sum: 0, count: 0 };
      bucket.sum += snapshot.position;
      bucket.count += 1;
      byRun.set(snapshot.runId, bucket);
    }
    const byDate = new Map<string, { sum: number; count: number }>();
    for (const run of runs) {
      const bucket = byRun.get(run.id);
      if (!bucket) continue;
      const date = run.startedAt.toISOString().slice(0, 10);
      const day = byDate.get(date) || { sum: 0, count: 0 };
      day.sum += bucket.sum;
      day.count += bucket.count;
      byDate.set(date, day);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, bucket]) => ({
        date,
        avgPosition: Math.round((bucket.sum / bucket.count) * 10) / 10,
      }));
  }

  // ---------- 研究日志 ----------

  async researchLog(user: CurrentUser, query: PageQuery & Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const key = orgKeyOf(org);
    const where = { ...key, projectId: row.id };
    const [total, rows, earliest] = await Promise.all([
      this.prisma.seoResearchLog.count({ where }),
      this.prisma.seoResearchLog.findMany({
        where,
        orderBy: { id: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.seoResearchLog.groupBy({
        by: ['action', 'paramsHash'],
        where,
        _min: { id: true },
      }),
    ]);
    const firstId = new Map(
      earliest.map((item) => [
        `${item.action}|${item.paramsHash}`,
        item._min.id ?? 0,
      ]),
    );
    return pageOf(
      rows.map((item) => ({
        id: item.id,
        action: item.action,
        paramsHash: item.paramsHash,
        resultRef: item.resultRef,
        reused:
          item.id > (firstId.get(`${item.action}|${item.paramsHash}`) || 0),
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}
