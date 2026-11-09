import type { PrismaService } from '../prisma/prisma.service';
import type { AccountCrypto } from '../account/account-crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import { clip, text } from './seo-shared';

/**
 * DataForSEO 连接器（用户自带 Key、按量向 DataForSEO 付费，本系统不计积分）。
 * - 凭据：SeoProviderSetting（userId+code）里 AES-256-GCM 密文，明文是 `login:password`（HTTP Basic）；
 * - 全部请求走 httpRequest 统一传输层 + assertOutboundUrl，带 timeout/maxBytes/limiterKey；
 * - 付费步骤失败**不自动重试**（方案 §3.11/§5.4），直接把原因抛给调用方标记失败。
 */
export const SEO_PROVIDER_CODE = 'dataforseo';
const DFS_BASE = 'https://api.dataforseo.com';

export type DfsCredential = { login: string; password: string };

type DfsTask<T> = {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result_count?: number;
  result?: T[] | null;
};
type DfsEnvelope<T> = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: DfsTask<T>[] | null;
};

export type DfsKeywordMetric = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string;
};

export type DfsSerpItem = {
  type: string;
  rank_group: number;
  rank_absolute: number;
  domain: string;
  url: string;
  title: string;
  description: string;
};

export type DfsMapsItem = {
  type: string;
  rank_group: number;
  rank_absolute: number;
  title: string;
  address: string;
  url: string;
};

export type DfsBacklinkItem = {
  url_from: string;
  url_to: string;
  anchor: string;
  domain_from: string;
  dofollow: boolean;
  first_seen: string;
};

export type DfsLighthouseResult = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
};

const INTENT_LABELS: Record<string, string> = {
  informational: '信息型',
  navigational: '导航型',
  commercial: '商业型',
  transactional: '交易型',
};

export const intentLabel = (raw: string): string =>
  INTENT_LABELS[String(raw || '').toLowerCase()] || '未判定';

export class SeoDataForSeoClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AccountCrypto,
  ) {}

  /** 取本账号自己的凭据；未配置返回 null（调用方据此走「未配置数据源」引导，绝不造假）。 */
  async credential(userId: string): Promise<DfsCredential | null> {
    const row = await this.prisma.seoProviderSetting.findUnique({
      where: {
        userId_code: { userId, code: SEO_PROVIDER_CODE },
      },
    });
    if (!row?.credentialCipher) return null;
    let plain = '';
    try {
      plain = this.crypto.decrypt(row.credentialCipher);
    } catch {
      return null;
    }
    const index = plain.indexOf(':');
    if (index <= 0) return null;
    return {
      login: plain.slice(0, index),
      password: plain.slice(index + 1),
    };
  }

  async requireCredential(userId: string): Promise<DfsCredential> {
    const credential = await this.credential(userId);
    if (!credential)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未配置 DataForSEO 数据源：请在「站点设置」里填写 login 与 password（真实搜索量/排名/外链需要它）',
      );
    return credential;
  }

  private authHeader(credential: DfsCredential): string {
    return `Basic ${Buffer.from(
      `${credential.login}:${credential.password}`,
      'utf8',
    ).toString('base64')}`;
  }

  private async request<T>(
    credential: DfsCredential,
    path: string,
    payload: unknown[] | null,
    operation: string,
    timeoutMs = 60_000,
  ): Promise<DfsEnvelope<T>> {
    const url = `${DFS_BASE}${path}`;
    await assertOutboundUrl(url, 'DataForSEO 接口');
    try {
      const response = await httpRequest<DfsEnvelope<T>>(url, {
        method: payload ? 'POST' : 'GET',
        headers: {
          Authorization: this.authHeader(credential),
          'Content-Type': 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
        readAs: 'json',
        timeoutMs,
        maxBytes: 8 * 1024 * 1024,
        concurrency: 4,
        limiterKey: 'seo-dataforseo',
        operation,
        redirect: 'manual',
      });
      if (response.status === 401)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'DataForSEO 凭证无效（401）：请检查 login/password 后重新保存',
        );
      if (response.status === 402)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'DataForSEO 账户余额不足（402）：请充值后重试',
        );
      if (!response.ok)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `DataForSEO 返回 ${response.status}：${clip(
            text(response.data?.status_message),
            160,
          )}`,
        );
      const envelope = response.data || {};
      const task = envelope.tasks?.[0];
      if (task && task.status_code && task.status_code >= 40000)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `DataForSEO 任务失败：${clip(task.status_message, 160)}`,
        );
      return envelope;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      const reason =
        error instanceof TransportError
          ? error.kind === 'timeout'
            ? '请求超时'
            : '网络不可达'
          : text(error instanceof Error ? error.message : error);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `DataForSEO 调用失败：${clip(reason, 160)}（付费步骤不自动重试）`,
      );
    }
  }

  private results<T>(envelope: DfsEnvelope<T>): T[] {
    const result = envelope.tasks?.[0]?.result;
    return Array.isArray(result) ? result : [];
  }

  /** 测试连接：查余额端点，不发 SERP 试探（省钱）。 */
  async testConnection(
    credential: DfsCredential,
  ): Promise<{ ok: boolean; message: string }> {
    const envelope = await this.request<{
      money?: { balance?: number };
      login?: string;
    }>(credential, '/v3/appendix/user_data', null, 'seo.provider.test', 20_000);
    const balance = envelope.tasks?.[0]?.result?.[0]?.money?.balance;
    return {
      ok: true,
      message:
        typeof balance === 'number'
          ? `凭证有效，账户余额 $${balance.toFixed(2)}`
          : '凭证有效（余额端点未返回金额）',
    };
  }

  /** 真实搜索量/CPC/竞争度（Google Ads 口径）。 */
  async searchVolume(
    credential: DfsCredential,
    keywords: string[],
    locationCode: number,
    languageCode: string,
  ): Promise<DfsKeywordMetric[]> {
    const envelope = await this.request<{
      keyword?: string;
      search_volume?: number | null;
      cpc?: number | null;
      competition?: number | null;
      keyword_difficulty?: number | null;
      search_intent_info?: { main_intent?: string };
    }>(
      credential,
      '/v3/keywords_data/google_ads/search_volume/live',
      [
        {
          keywords: keywords.slice(0, 1000),
          location_code: locationCode,
          language_code: languageCode,
        },
      ],
      'seo.keywords.volume',
    );
    return this.results(envelope).map((item) => ({
      keyword: text(item.keyword),
      volume:
        typeof item.search_volume === 'number' ? item.search_volume : null,
      cpc: typeof item.cpc === 'number' ? item.cpc : null,
      competition:
        typeof item.competition === 'number' ? item.competition : null,
      difficulty:
        typeof item.keyword_difficulty === 'number'
          ? item.keyword_difficulty
          : null,
      intent: intentLabel(item.search_intent_info?.main_intent || ''),
    }));
  }

  /** Labs 相关词/建议词/域名排名词：发现 + 指标一次拿回（域名模式附带真实名次）。 */
  async discoverKeywords(
    credential: DfsCredential,
    input: {
      seed?: string;
      domain?: string;
      locationCode: number;
      languageCode: string;
      limit: number;
    },
  ): Promise<Array<DfsKeywordMetric & { position: number | null }>> {
    const path = input.domain
      ? '/v3/dataforseo_labs/google/ranked_keywords/live'
      : input.seed
        ? '/v3/dataforseo_labs/google/related_keywords/live'
        : '';
    if (!path) return [];
    const payload = input.domain
      ? {
          target: input.domain,
          location_code: input.locationCode,
          language_code: input.languageCode,
          limit: input.limit,
          order_by: ['keyword_data.search_volume,desc'],
        }
      : {
          keyword: input.seed,
          location_code: input.locationCode,
          language_code: input.languageCode,
          limit: input.limit,
          depth: 2,
          include_seed_keyword: true,
          include_serp_info: false,
        };
    const envelope = await this.request<{
      keyword_data?: {
        keyword?: string;
        keyword_info?: {
          search_volume?: number | null;
          cpc?: number | null;
          competition?: number | null;
        };
        keyword_properties?: { keyword_difficulty?: number | null };
        search_intent_info?: { main_intent?: string };
      };
      ranked_serp_element?: {
        serp_item?: { rank_group?: number; rank_absolute?: number };
      };
    }>(credential, path, [payload], 'seo.keywords.discover');
    const out: Array<DfsKeywordMetric & { position: number | null }> = [];
    for (const item of this.results(envelope)) {
      const data = item.keyword_data;
      if (!data?.keyword) continue;
      const position = Number(
        item.ranked_serp_element?.serp_item?.rank_group ||
          item.ranked_serp_element?.serp_item?.rank_absolute ||
          0,
      );
      out.push({
        keyword: text(data.keyword),
        volume:
          typeof data.keyword_info?.search_volume === 'number'
            ? data.keyword_info.search_volume
            : null,
        cpc:
          typeof data.keyword_info?.cpc === 'number'
            ? data.keyword_info.cpc
            : null,
        competition:
          typeof data.keyword_info?.competition === 'number'
            ? data.keyword_info.competition
            : null,
        difficulty:
          typeof data.keyword_properties?.keyword_difficulty === 'number'
            ? data.keyword_properties.keyword_difficulty
            : null,
        intent: intentLabel(data.search_intent_info?.main_intent || ''),
        position: position > 0 ? position : null,
      });
    }
    return out.slice(0, input.limit);
  }

  /** SERP 实时结果（排名跟踪 / 竞品重叠 / 线索发现共用）。 */
  async serp(
    credential: DfsCredential,
    input: {
      keyword: string;
      locationCode: number;
      languageCode: string;
      device: 'MOBILE' | 'DESKTOP';
      depth: number;
    },
  ): Promise<{ items: DfsSerpItem[]; features: string[]; cost: number }> {
    const envelope = await this.request<{
      items?: DfsSerpItem[] | null;
    }>(
      credential,
      '/v3/serp/google/organic/live/advanced',
      [
        {
          keyword: input.keyword,
          location_code: input.locationCode,
          language_code: input.languageCode,
          device: input.device === 'MOBILE' ? 'mobile' : 'desktop',
          depth: Math.min(100, Math.max(10, input.depth)),
          calculate_rectangles: false,
        },
      ],
      'seo.serp',
      90_000,
    );
    const items = this.results(envelope)[0]?.items || [];
    return {
      items: items.filter((item) => item && item.type === 'organic'),
      features: [
        ...new Set(
          items
            .filter((item) => item && item.type !== 'organic')
            .map((item) => String(item.type)),
        ),
      ],
      cost: Number(envelope.tasks?.[0]?.cost || envelope.cost || 0),
    };
  }

  /** Google Maps SERP（本地网格逐点查询，带坐标定位）。 */
  async mapsSerp(
    credential: DfsCredential,
    input: {
      keyword: string;
      lat: number;
      lng: number;
      languageCode: string;
      depth: number;
    },
  ): Promise<DfsMapsItem[]> {
    const envelope = await this.request<{ items?: DfsMapsItem[] | null }>(
      credential,
      '/v3/serp/google/maps/live/advanced',
      [
        {
          keyword: input.keyword,
          location_coordinate: `${input.lat.toFixed(6)},${input.lng.toFixed(
            6,
          )},200`,
          language_code: input.languageCode,
          depth: Math.min(100, Math.max(10, input.depth)),
        },
      ],
      'seo.maps',
      90_000,
    );
    return (this.results(envelope)[0]?.items || []).filter(
      (item) => item && item.type === 'maps_search',
    );
  }

  /** 域名概览（竞品洞察：自然词数/流量估计）。 */
  async domainOverview(
    credential: DfsCredential,
    domain: string,
    locationCode: number,
    languageCode: string,
  ): Promise<{
    organicKeywords: number;
    organicTraffic: number;
    rankedKeywords: Array<{
      keyword: string;
      position: number;
      volume: number | null;
    }>;
  }> {
    const envelope = await this.request<{
      metrics?: {
        organic?: { count?: number; etv?: number };
      };
    }>(
      credential,
      '/v3/dataforseo_labs/google/domain_rank_overview/live',
      [
        {
          target: domain,
          location_code: locationCode,
          language_code: languageCode || 'en',
        },
      ],
      'seo.competitor.overview',
    );
    const metrics = this.results(envelope)[0]?.metrics?.organic;
    const ranked = await this.discoverKeywords(credential, {
      domain,
      locationCode,
      languageCode,
      limit: 50,
    });
    return {
      organicKeywords: Number(metrics?.count || 0),
      organicTraffic: Math.round(Number(metrics?.etv || 0)),
      rankedKeywords: ranked.map((item, index) => ({
        keyword: item.keyword,
        position: item.position || index + 1,
        volume: item.volume,
      })),
    };
  }

  /** 外链概览 + 锚文本分布。 */
  async backlinksSummary(
    credential: DfsCredential,
    domain: string,
  ): Promise<{
    totalBacklinks: number;
    referringDomains: number;
    followLinks: number;
    nofollowLinks: number;
    anchors: Array<{ text: string; count: number }>;
  }> {
    const envelope = await this.request<{
      total_backlinks?: number;
      referring_domains?: number;
      dofollow?: number;
      nofollow?: number;
    }>(
      credential,
      '/v3/backlinks/summary/live',
      [{ target: domain, include_subdomains: true }],
      'seo.backlinks.summary',
    );
    const summary = this.results(envelope)[0] || {};
    const anchors = await this.request<{
      anchor?: string;
      backlinks?: number;
    }>(
      credential,
      '/v3/backlinks/anchors/live',
      [{ target: domain, limit: 20, order_by: ['backlinks,desc'] }],
      'seo.backlinks.anchors',
    );
    return {
      totalBacklinks: Number(summary.total_backlinks || 0),
      referringDomains: Number(summary.referring_domains || 0),
      followLinks: Number(summary.dofollow || 0),
      nofollowLinks: Number(summary.nofollow || 0),
      anchors: this.results(anchors)
        .filter((item) => text(item.anchor))
        .map((item) => ({
          text: clip(item.anchor, 120),
          count: Number(item.backlinks || 0),
        })),
    };
  }

  /** 外链明细（分页）。 */
  async backlinks(
    credential: DfsCredential,
    domain: string,
    limit: number,
    offset: number,
  ): Promise<{ items: DfsBacklinkItem[]; total: number }> {
    const envelope = await this.request<{
      total_count?: number;
      items?: DfsBacklinkItem[] | null;
    }>(
      credential,
      '/v3/backlinks/backlinks/live',
      [
        {
          target: domain,
          limit: Math.min(1000, Math.max(1, limit)),
          offset: Math.max(0, offset),
          order_by: ['rank,desc'],
        },
      ],
      'seo.backlinks.list',
    );
    const result = this.results(envelope)[0];
    return {
      items: result?.items || [],
      total: Number(result?.total_count || 0),
    };
  }

  /** 引荐域列表。 */
  async referringDomains(
    credential: DfsCredential,
    domain: string,
    limit: number,
  ): Promise<Array<{ domain: string; backlinks: number }>> {
    const envelope = await this.request<{
      items?: Array<{ domain?: string; backlinks?: number }> | null;
    }>(
      credential,
      '/v3/backlinks/referring_domains/live',
      [{ target: domain, limit: Math.min(1000, limit) }],
      'seo.backlinks.domains',
    );
    return (this.results(envelope)[0]?.items || []).map((item) => ({
      domain: text(item.domain),
      backlinks: Number(item.backlinks || 0),
    }));
  }

  /** Lighthouse 真实性能分（可选，走 DataForSEO API，不在服务器装 Chrome）。 */
  async lighthouse(
    credential: DfsCredential,
    url: string,
    device: 'MOBILE' | 'DESKTOP',
  ): Promise<DfsLighthouseResult | null> {
    await assertOutboundUrl(url, 'Lighthouse 目标页');
    const posted = await this.request<never>(
      credential,
      '/v3/on_page/lighthouse/task_post',
      [
        {
          url,
          for_mobile: device === 'MOBILE',
          tag: 'seo-audit',
        },
      ],
      'seo.lighthouse.post',
      30_000,
    );
    const taskId = text(posted.tasks?.[0]?.id);
    if (!taskId) return null;
    // 任务型端点：轮询有界（最多 10 次 × 6s），不无限等待
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const ready = await this.request<{
        lighthouse?: {
          performance?: number;
          accessibility?: number;
          best_practices?: number;
          seo?: number;
        };
        metrics?: {
          largest_contentful_paint?: number;
          cumulative_layout_shift?: number;
          interaction_to_next_paint?: number;
          time_to_first_byte?: number;
        };
      }>(
        credential,
        `/v3/on_page/lighthouse/task_get/advanced/${taskId}`,
        null,
        'seo.lighthouse.get',
        30_000,
      );
      const result = this.results(ready)[0];
      if (!result) continue;
      const score = (value: unknown): number =>
        Math.round(Number(value || 0) * (Number(value || 0) <= 1 ? 100 : 1));
      return {
        performance: score(result.lighthouse?.performance),
        accessibility: score(result.lighthouse?.accessibility),
        bestPractices: score(result.lighthouse?.best_practices),
        seo: score(result.lighthouse?.seo),
        lcp: numberOrNull(result.metrics?.largest_contentful_paint),
        cls: numberOrNull(result.metrics?.cumulative_layout_shift),
        inp: numberOrNull(result.metrics?.interaction_to_next_paint),
        ttfb: numberOrNull(result.metrics?.time_to_first_byte),
      };
    }
    return null;
  }
}

const numberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
