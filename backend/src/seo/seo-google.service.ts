import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import type { GscRow } from './seo-gsc';
import type { SeoKeywordService } from './seo-keyword.service';
import {
  orgKeyOf,
  SeoBase,
  type OrgKey,
  type SeoContext,
} from './seo-base.service';
import { clip, normalizeDomain, num, text, type Row } from './seo-shared';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GSC_API = 'https://www.googleapis.com/webmasters/v3';
const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
const CALLBACK_PATH = 'api/backend/enterprise/seo/google/callback';
const STATE_TTL_MS = 10 * 60_000;

const SCOPES: Record<string, string> = {
  GSC: 'https://www.googleapis.com/auth/webmasters.readonly',
  GA4: 'https://www.googleapis.com/auth/analytics.readonly',
};

type GoogleClient = { clientId: string; clientSecret: string };

/**
 * GSC / GA4 双轨接入：① 组织级 OAuth 客户端 + 浏览器授权（回调换取 refresh_token）；
 * ② 手工粘贴已有 refresh_token。凭据一律 AES-256-GCM 落库，任何接口都不回显原文。
 */
export class SeoGoogleService extends SeoBase {
  constructor(
    ctx: SeoContext,
    private readonly keywords: SeoKeywordService,
  ) {
    super(ctx);
  }

  async googleSettings(user: CurrentUser) {
    const org = await this.org(user);
    const key = orgKeyOf(org);
    const client = await this.prisma.seoGoogleClient.findUnique({
      where: { orgType_orgUserId: key },
    });
    const connections = await this.prisma.seoGoogleConnection.findMany({
      where: key,
      orderBy: { service: 'asc' },
    });
    const clientId = client?.clientIdCipher
      ? this.ctx.crypto.decrypt(client.clientIdCipher)
      : '';
    return {
      configured: Boolean(clientId && client?.clientSecretCipher),
      clientIdMasked: this.mask(clientId),
      callbackUrl: await this.callbackUrl(),
      connections: ['GSC', 'GA4'].map((service) => {
        const row = connections.find((item) => item.service === service);
        return {
          service,
          propertyId: row?.propertyId || '',
          propertyName: row?.propertyName || '',
          connected: Boolean(row?.refreshTokenCipher),
          lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
          syncError: row?.syncError || '',
        };
      }),
    };
  }

  async saveGoogleClient(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const key = orgKeyOf(org);
    const clientId = clip(body.clientId, 300).trim();
    const clientSecret = clip(body.clientSecret, 300).trim();
    const existing = await this.prisma.seoGoogleClient.findUnique({
      where: { orgType_orgUserId: key },
    });
    if (!clientId && !existing?.clientIdCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 Google OAuth 客户端 ID（Google Cloud Console → 凭据 → OAuth 2.0 客户端）',
      );
    if (!clientSecret && !existing?.clientSecretCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 Google OAuth 客户端密钥',
      );
    await this.prisma.seoGoogleClient.upsert({
      where: { orgType_orgUserId: key },
      create: {
        ...key,
        clientIdCipher: clientId ? this.ctx.crypto.encrypt(clientId) : '',
        clientSecretCipher: clientSecret
          ? this.ctx.crypto.encrypt(clientSecret)
          : '',
      },
      update: {
        ...(clientId
          ? { clientIdCipher: this.ctx.crypto.encrypt(clientId) }
          : {}),
        ...(clientSecret
          ? { clientSecretCipher: this.ctx.crypto.encrypt(clientSecret) }
          : {}),
      },
    });
    return this.googleSettings(user);
  }

  async googleAuthUrl(user: CurrentUser, query: Row) {
    const service = this.service(query.service);
    const org = await this.org(user);
    const client = await this.requireClient(orgKeyOf(org));
    const redirectUri = await this.callbackUrl();
    const state = this.ctx.crypto.encrypt(
      JSON.stringify({
        o: org.orgType,
        u: org.orgUserId,
        s: service,
        e: Date.now() + STATE_TTL_MS,
      }),
    );
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES[service]);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  async googleCallback(user: CurrentUser, query: Row) {
    const denied = text(query.error);
    if (denied)
      return {
        ok: false,
        service: '',
        message: `授权被拒绝：${clip(denied, 120)}`,
      };
    const stateRaw = text(query.state);
    const code = text(query.code);
    if (!stateRaw || !code)
      return { ok: false, service: '', message: '回调缺少 code 或 state' };
    let state: { o?: string; u?: string; s?: string; e?: number };
    try {
      state = JSON.parse(this.ctx.crypto.decrypt(stateRaw)) as typeof state;
    } catch {
      return {
        ok: false,
        service: '',
        message: 'state 校验失败，请重新发起授权',
      };
    }
    const org = await this.org(user);
    if (
      state.o !== org.orgType ||
      state.u !== org.orgUserId ||
      Number(state.e || 0) < Date.now()
    )
      return {
        ok: false,
        service: '',
        message: 'state 已过期或与当前组织不符，请重新授权',
      };
    const service = this.service(state.s);
    try {
      const client = await this.requireClient(orgKeyOf(org));
      const token = await this.exchangeCode(
        client,
        code,
        await this.callbackUrl(),
      );
      if (!token.refresh_token)
        return {
          ok: false,
          service,
          message:
            'Google 未返回 refresh_token：请在授权 URL 中保留 prompt=consent 后重试',
        };
      await this.prisma.seoGoogleConnection.upsert({
        where: {
          orgType_orgUserId_service: { ...orgKeyOf(org), service },
        },
        create: {
          ...orgKeyOf(org),
          service,
          refreshTokenCipher: this.ctx.crypto.encrypt(token.refresh_token),
        },
        update: {
          refreshTokenCipher: this.ctx.crypto.encrypt(token.refresh_token),
          syncError: '',
        },
      });
      return {
        ok: true,
        service,
        message: '授权成功，可关闭本窗口并回到 SEO 工作台同步数据',
      };
    } catch (error) {
      return {
        ok: false,
        service,
        message: clip(error instanceof Error ? error.message : '授权失败', 200),
      };
    }
  }

  /** 双轨之二：已有 refresh_token 直接粘贴（不经浏览器回调）。 */
  async connectGoogle(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const service = this.service(body.service);
    const refreshToken = clip(body.refreshToken, 2000).trim();
    const key = orgKeyOf(org);
    const existing = await this.prisma.seoGoogleConnection.findUnique({
      where: { orgType_orgUserId_service: { ...key, service } },
    });
    if (!refreshToken && !existing?.refreshTokenCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 refresh_token，或改用「浏览器授权」获取',
      );
    const row = await this.prisma.seoGoogleConnection.upsert({
      where: { orgType_orgUserId_service: { ...key, service } },
      create: {
        ...key,
        service,
        refreshTokenCipher: refreshToken
          ? this.ctx.crypto.encrypt(refreshToken)
          : '',
        propertyId: clip(body.propertyId, 200),
        propertyName: clip(body.propertyName, 200),
      },
      update: {
        ...(refreshToken
          ? { refreshTokenCipher: this.ctx.crypto.encrypt(refreshToken) }
          : {}),
        propertyId: clip(body.propertyId, 200),
        propertyName: clip(body.propertyName, 200),
        syncError: '',
      },
    });
    return {
      service,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      connected: Boolean(row.refreshTokenCipher),
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      syncError: row.syncError,
    };
  }

  async disconnectGoogle(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const service = this.service(body.service);
    await this.prisma.seoGoogleConnection.deleteMany({
      where: { ...orgKeyOf(org), service },
    });
    return this.ok(
      `${service === 'GSC' ? 'Search Console' : 'GA4'} 授权已解除`,
    );
  }

  async syncGoogle(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const service = this.service(body.service);
    const result = await this.sync(orgKeyOf(org), service);
    return this.ok(result);
  }

  async ga4Rows(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const rows = await this.prisma.seoGa4Row.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: [{ date: 'desc' }, { sessions: 'desc' }],
      take: 1000,
    });
    return rows.map((item) => ({
      date: item.date,
      page: item.page,
      sessions: item.sessions,
      users: item.users,
      engagement: item.engagement,
      conversions: item.conversions,
    }));
  }

  /** 调度器每日同步入口：失败只记录到连接行，不抛穿夜间批次。 */
  async syncAll(org: OrgKey) {
    const messages: string[] = [];
    for (const service of ['GSC', 'GA4']) {
      const connection = await this.prisma.seoGoogleConnection.findUnique({
        where: { orgType_orgUserId_service: { ...org, service } },
      });
      if (!connection?.refreshTokenCipher) continue;
      try {
        messages.push(await this.sync(org, service));
      } catch (error) {
        messages.push(
          `${service} 同步失败：${clip(error instanceof Error ? error.message : '未知错误', 200)}`,
        );
      }
    }
    return messages;
  }

  private async sync(key: OrgKey, service: string): Promise<string> {
    const connection = await this.prisma.seoGoogleConnection.findUnique({
      where: { orgType_orgUserId_service: { ...key, service } },
    });
    if (!connection?.refreshTokenCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${service === 'GSC' ? 'Search Console' : 'GA4'} 尚未授权`,
      );
    const projects = await this.prisma.seoProject.findMany({
      where: key,
      orderBy: { id: 'desc' },
      take: 20,
    });
    if (!projects.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先建立站点档案，同步数据需要落到具体站点',
      );
    try {
      const client = await this.requireClient(key);
      const accessToken = await this.accessToken(
        client,
        this.ctx.crypto.decrypt(connection.refreshTokenCipher),
      );
      const message =
        service === 'GSC'
          ? await this.syncGsc(key, projects, connection, accessToken)
          : await this.syncGa4(key, projects, connection, accessToken);
      await this.prisma.seoGoogleConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), syncError: '' },
      });
      return message;
    } catch (error) {
      const message = clip(
        error instanceof Error ? error.message : '同步失败',
        300,
      );
      await this.prisma.seoGoogleConnection.update({
        where: { id: connection.id },
        data: { syncError: message },
      });
      throw error instanceof BusinessException
        ? error
        : new BusinessException(ErrorCode.BAD_REQUEST, message);
    }
  }

  private async syncGsc(
    key: OrgKey,
    projects: Array<{ id: number; domain: string }>,
    connection: { id: number; propertyId: string },
    accessToken: string,
  ) {
    const sites = await this.get<{ siteEntry?: Array<{ siteUrl?: string }> }>(
      `${GSC_API}/sites`,
      accessToken,
      'seo.gsc.sites',
    );
    const entries = (sites.siteEntry || []).map((item) => text(item.siteUrl));
    if (!entries.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该 Google 账号下没有 Search Console 资源',
      );
    const endDate = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    let synced = 0;
    let matched = '';
    for (const project of projects) {
      const site =
        (connection.propertyId && entries.includes(connection.propertyId)
          ? connection.propertyId
          : '') || this.matchSite(entries, project.domain);
      if (!site) continue;
      matched = site;
      const data = await this.post<{
        rows?: Array<{
          keys?: string[];
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
        }>;
      }>(
        `${GSC_API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
        accessToken,
        {
          startDate,
          endDate,
          dimensions: ['query', 'page'],
          rowLimit: 5000,
          dataState: 'all',
        },
        'seo.gsc.query',
      );
      const rows: GscRow[] = (data.rows || []).map((row) => ({
        query: clip(row.keys?.[0] || '', 500),
        page: clip(row.keys?.[1] || '', 500),
        clicks: Math.round(num(row.clicks)),
        impressions: Math.round(num(row.impressions)),
        ctr: Math.round(num(row.ctr) * 10000) / 100,
        position: Math.round(num(row.position) * 100) / 100,
      }));
      await this.keywords.saveOauthImport(
        key,
        project.id,
        rows,
        `${startDate} ~ ${endDate}`,
      );
      synced += 1;
    }
    if (!synced)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '授权的 Search Console 资源与任何站点档案域名都不匹配，请在连接设置里指定资源',
      );
    if (matched && matched !== connection.propertyId)
      await this.prisma.seoGoogleConnection.update({
        where: { id: connection.id },
        data: { propertyId: matched, propertyName: matched },
      });
    return `Search Console 已同步 ${synced} 个站点（${startDate} ~ ${endDate}）`;
  }

  private async syncGa4(
    key: OrgKey,
    projects: Array<{ id: number; domain: string }>,
    connection: { id: number; propertyId: string; propertyName: string },
    accessToken: string,
  ) {
    let propertyId = connection.propertyId.replace(/^properties\//, '');
    let propertyName = connection.propertyName;
    if (!propertyId) {
      const listed = await this.get<{
        accountSummaries?: Array<{
          propertySummaries?: Array<{
            property?: string;
            displayName?: string;
          }>;
        }>;
      }>(
        `${GA4_ADMIN_API}/accountSummaries?pageSize=200`,
        accessToken,
        'seo.ga4.properties',
      );
      const properties = (listed.accountSummaries || []).flatMap(
        (account) => account.propertySummaries || [],
      );
      const hit =
        properties.find((item) =>
          projects.some((project) =>
            String(item.displayName || '')
              .toLowerCase()
              .includes(project.domain),
          ),
        ) || (properties.length === 1 ? properties[0] : null);
      if (!hit?.property)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '无法自动确定 GA4 媒体资源：请在连接设置里填写媒体资源 ID',
        );
      propertyId = hit.property.replace(/^properties\//, '');
      propertyName = text(hit.displayName);
    }
    if (!/^\d+$/.test(propertyId))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'GA4 媒体资源 ID 必须是纯数字（如 123456789）',
      );
    const data = await this.post<{
      rows?: Array<{
        dimensionValues?: Array<{ value?: string }>;
        metricValues?: Array<{ value?: string }>;
      }>;
    }>(
      `${GA4_DATA_API}/properties/${propertyId}:runReport`,
      accessToken,
      {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagementRate' },
          { name: 'conversions' },
        ],
        limit: 5000,
      },
      'seo.ga4.report',
    );
    const rows = (data.rows || []).map((row) => {
      const raw = text(row.dimensionValues?.[0]?.value);
      const date = /^\d{8}$/.test(raw)
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : clip(raw, 10);
      return {
        date,
        page: clip(row.dimensionValues?.[1]?.value || '', 500),
        sessions: Math.round(num(row.metricValues?.[0]?.value)),
        users: Math.round(num(row.metricValues?.[1]?.value)),
        engagement: num(row.metricValues?.[2]?.value),
        conversions: num(row.metricValues?.[3]?.value),
      };
    });
    const matched = projects.filter((item) =>
      propertyName.toLowerCase().includes(item.domain),
    );
    const project =
      matched.length === 1
        ? matched[0]
        : projects.length === 1
          ? projects[0]
          : null;
    if (!project)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该 GA4 媒体资源无法对应到唯一站点档案：请只保留一个站点档案，或在连接设置里指定资源',
      );
    const dates = [...new Set(rows.map((row) => row.date))];
    await this.prisma.$transaction([
      this.prisma.seoGa4Row.deleteMany({
        where: { ...key, projectId: project.id, date: { in: dates } },
      }),
      ...(rows.length
        ? [
            this.prisma.seoGa4Row.createMany({
              data: rows.map((row) => ({
                ...key,
                projectId: project.id,
                ...row,
              })),
            }),
          ]
        : []),
    ]);
    await this.prisma.seoGoogleConnection.update({
      where: { id: connection.id },
      data: { propertyId, propertyName },
    });
    return `GA4 已同步 ${rows.length} 行（近 30 天，站点 ${project.domain}）`;
  }

  // ---------- Google HTTP ----------

  private async exchangeCode(
    client: GoogleClient,
    code: string,
    redirectUri: string,
  ) {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
  }

  private async accessToken(client: GoogleClient, refreshToken: string) {
    const result = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    if (!result.access_token)
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Google 未返回访问令牌：refresh_token 可能已被撤销，请重新授权',
      );
    return result.access_token;
  }

  private async tokenRequest(params: Record<string, string>) {
    await assertOutboundUrl(TOKEN_ENDPOINT, 'Google 令牌端点');
    const response = await httpRequest<{
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    }>(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      readAs: 'json',
      timeoutMs: 20_000,
      maxBytes: 1024 * 1024,
      operation: 'seo.google.token',
      redirect: 'manual',
    });
    if (!response.ok || response.data?.error)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `Google 授权失败：${clip(response.data?.error_description || response.data?.error || `HTTP ${response.status}`, 200)}`,
      );
    return response.data || {};
  }

  private async get<T>(url: string, accessToken: string, operation: string) {
    await assertOutboundUrl(url, 'Google API');
    const response = await httpRequest<T & { error?: { message?: string } }>(
      url,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        readAs: 'json',
        timeoutMs: 30_000,
        maxBytes: 8 * 1024 * 1024,
        operation,
        redirect: 'manual',
      },
    );
    if (!response.ok)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `Google API 返回 ${response.status}：${clip(response.data?.error?.message || '请检查授权范围与资源权限', 200)}`,
      );
    return response.data;
  }

  private async post<T>(
    url: string,
    accessToken: string,
    body: unknown,
    operation: string,
  ) {
    await assertOutboundUrl(url, 'Google API');
    const response = await httpRequest<T & { error?: { message?: string } }>(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        readAs: 'json',
        timeoutMs: 60_000,
        maxBytes: 16 * 1024 * 1024,
        operation,
        redirect: 'manual',
      },
    );
    if (!response.ok)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `Google API 返回 ${response.status}：${clip(response.data?.error?.message || '请检查授权范围与资源权限', 200)}`,
      );
    return response.data;
  }

  private async requireClient(key: OrgKey): Promise<GoogleClient> {
    const row = await this.prisma.seoGoogleClient.findUnique({
      where: { orgType_orgUserId: key },
    });
    if (!row?.clientIdCipher || !row.clientSecretCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未配置 Google OAuth 客户端：请先在「站点设置 → Google 同步」填写客户端 ID 与密钥',
      );
    return {
      clientId: this.ctx.crypto.decrypt(row.clientIdCipher),
      clientSecret: this.ctx.crypto.decrypt(row.clientSecretCipher),
    };
  }

  private async callbackUrl(): Promise<string> {
    const base = await resolveSiteUrl(this.prisma);
    if (!base)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未配置站点对外域名：请先在平台管理后台「站点设置」填写站点域名，Google 回调需要绝对地址',
      );
    return joinSiteUrl(base, CALLBACK_PATH);
  }

  /** GSC 资源匹配：sc-domain:example.com 与 https://example.com/ 两种写法都认。 */
  private matchSite(entries: string[], domain: string): string {
    const target = normalizeDomain(domain);
    return (
      entries.find((entry) => {
        const value = entry
          .replace(/^sc-domain:/, '')
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '');
        return normalizeDomain(value) === target;
      }) || ''
    );
  }

  private service(value: unknown): string {
    const raw = text(value).toUpperCase();
    if (raw !== 'GSC' && raw !== 'GA4')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务只能是 GSC 或 GA4',
      );
    return raw;
  }

  private mask(value: string): string {
    if (!value) return '';
    return value.length <= 12
      ? `${value.slice(0, 4)}****`
      : `${value.slice(0, 8)}****${value.slice(-6)}`;
  }
}
