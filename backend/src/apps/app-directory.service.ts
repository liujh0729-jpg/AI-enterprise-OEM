import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest } from '../http/transport';

/**
 * 应用市场：外部公开目录的**只读展示层**（口径照 SNS 既有实现）。
 * 本站不建应用表、不代上架、不代评价，条目与评价都来自目录接口；
 * 上架、编辑与评价都在应用自己的站点完成。这块也不进 `/api/v1` 与 MCP。
 */
const PATH = '/v1/directory/apps';
const TIMEOUT_MS = Number(process.env.APP_DIRECTORY_TIMEOUT_MS || 6000);
/** 列表按「能打开应用」过滤后再分页：先整目录取回，避免页内过滤把 total 与页码算歪。 */
const FETCH_LIMIT = 100;
const MAX_PAGES = 20;
const CACHE_TTL_MS = Number(process.env.APP_DIRECTORY_CACHE_TTL_MS || 60_000);
/** 上游抖动时先回旧值：宽限期从「新鲜期到期」起算。 */
const STALE_MS = 10 * CACHE_TTL_MS;
const BREAKER_MS = Number(process.env.APP_DIRECTORY_BREAKER_MS || 30_000);
const BREAKER_THRESHOLD = 3;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;
const CATEGORY_MAX = 60;
const REVIEW_MAX = 2000;
const CLIENT_ID_MAX = 128;

const logger = new Logger('AppDirectoryService');

export type AppItem = {
  clientId: string;
  name: string;
  description: string;
  category: string;
  scopes: string[];
  homepageUrl: string;
};

export type AppDetail = AppItem & { publishedAt: string | null };

export type AppReview = {
  id: string;
  author: string;
  rating: number;
  content: string;
  createdAt: string | null;
};

type UpstreamEnvelope = {
  data?: unknown;
  error?: { code?: string; message?: string };
};

type CacheEntry = { value: unknown; expires: number };

/** 上游不可用（网络 / 5xx / 报文不对）：与 404 区分开，前者可以回旧值。 */
class UpstreamFailure extends Error {}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** 目录数据来自外部：只有 http(s) 能当跳转地址，别让它塞进 javascript: 之类的协议。 */
function httpUrl(value: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function rating(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(5, Math.round(score * 10) / 10);
}

export class AppDirectoryService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private failures = 0;
  private openedUntil = 0;

  async list(query: {
    category?: string;
    q?: string;
    page?: number | string;
    pageSize?: number | string;
  }) {
    const { page, pageSize } = pageParam(query.page, query.pageSize, 12);
    const category = text(query.category).slice(0, CATEGORY_MAX);
    const q = text(query.q).slice(0, 100);
    // 打不开的应用（没有 http(s) 首页地址）不进列表：卡片点了也没地方去。
    const visible = (await this.catalog(category, q)).filter(
      (item) => item.homepageUrl,
    );
    const start = (page - 1) * pageSize;
    return pageOf(
      visible.slice(start, start + pageSize),
      visible.length,
      page,
      pageSize,
    );
  }

  /** 整份目录（按分类 / 关键词收窄）取回后再本地分页；每页上游报文仍走 60 秒缓存。 */
  private async catalog(category: string, q: string): Promise<AppItem[]> {
    const items: AppItem[] = [];
    const seen = new Set<string>();
    let total = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= MAX_PAGES && items.length < total; page += 1) {
      const search = new URLSearchParams({
        page: String(page),
        limit: String(FETCH_LIMIT),
      });
      if (category) search.set('category', category);
      if (q) search.set('q', q);
      const data = (await this.load(`${PATH}?${search.toString()}`)) as {
        items?: unknown[];
        meta?: { total?: unknown };
      };
      const rows = Array.isArray(data?.items) ? data.items : [];
      if (!rows.length) break;
      for (const row of rows) {
        const item = this.toItem(row);
        // 上游翻页排序不稳时可能重复；按 clientId 去重，免得本地 total 虚高。
        if (seen.has(item.clientId)) continue;
        seen.add(item.clientId);
        items.push(item);
      }
      total = Number(str(data?.meta?.total)) || items.length;
    }
    return items;
  }

  async detail(clientId: string): Promise<AppDetail> {
    const data = (await this.load(
      `${PATH}/${this.encodeId(clientId)}`,
    )) as Record<string, unknown>;
    return {
      ...this.toItem(data),
      publishedAt: str(data?.published_at) || null,
    };
  }

  async reviews(
    clientId: string,
    page?: number | string,
    pageSize?: number | string,
  ) {
    const { page: pageNo, pageSize: size } = pageParam(page, pageSize, 10);
    const id = this.encodeId(clientId);
    const data = (await this.load(
      `${PATH}/${id}/reviews?page=${pageNo}&limit=${size}`,
    )) as {
      items?: unknown[];
      meta?: { total?: unknown };
      summary?: { avg_rating?: unknown; review_count?: unknown };
    };
    const list = (Array.isArray(data?.items) ? data.items : []).map(
      (row, index) => this.toReview(row, id, index),
    );
    return {
      ...pageOf(list, Number(str(data?.meta?.total)) || 0, pageNo, size),
      avgRating: rating(data?.summary?.avg_rating),
      reviewCount: Number(str(data?.summary?.review_count)) || 0,
    };
  }

  private encodeId(clientId: string) {
    const id = text(clientId).slice(0, CLIENT_ID_MAX);
    if (!id) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '应用标识不正确');
    }
    return encodeURIComponent(id);
  }

  /** 目录条目与详情共用这一份映射：字段一律归一成驼峰并截断，缺值给空串。 */
  private toItem(raw: unknown): AppItem {
    const value = (raw || {}) as Record<string, unknown>;
    return {
      clientId: str(value.client_id ?? value.clientId),
      name: str(value.name).slice(0, NAME_MAX),
      description: str(value.description).slice(0, DESCRIPTION_MAX),
      category: str(value.category).slice(0, CATEGORY_MAX),
      scopes: str(value.scopes)
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, 20),
      homepageUrl: httpUrl(str(value.homepage_url ?? value.homepageUrl)),
    };
  }

  /** 上游评价字段尚未定稿（现网五款应用评价数为 0），按常见命名逐个兜底取用。 */
  private toReview(raw: unknown, key: string, index: number): AppReview {
    const value = (raw || {}) as Record<string, unknown>;
    return {
      id:
        str(value.id ?? value.review_id ?? value.reviewId) || `${key}:${index}`,
      author: str(
        value.author_nickname ??
          value.authorNickname ??
          value.nickname ??
          value.author ??
          value.user_name ??
          value.userName,
      ).slice(0, NAME_MAX),
      rating: rating(value.rating ?? value.score),
      content: str(
        value.content ?? value.body ?? value.comment ?? value.text,
      ).slice(0, REVIEW_MAX),
      createdAt: str(value.created_at ?? value.createdAt) || null,
    };
  }

  /** 同一份数据 60 秒内只打上游一次；并发请求合并，失败先回旧值。 */
  private async load(key: string): Promise<unknown> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && entry.expires > now) return entry.value;
    if (this.openedUntil > now) {
      if (entry) return entry.value;
      throw this.unavailable();
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const task = this.requestUpstream(key)
      .then((value) => {
        this.cache.set(key, {
          value,
          expires: Date.now() + CACHE_TTL_MS,
        });
        return value;
      })
      .catch((error: unknown) => {
        // 404 是正常答复：应用真的没了，不能拿旧值顶回去。
        if (error instanceof BusinessException) throw error;
        if (entry && entry.expires + STALE_MS > now) return entry.value;
        throw this.unavailable();
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async requestUpstream(path: string): Promise<unknown> {
    const base = (
      process.env.APP_DIRECTORY_URL || 'https://app.chandler.work'
    ).replace(/\/$/, '');
    try {
      const response = await httpRequest<UpstreamEnvelope | null>(
        `${base}${path}`,
        {
          headers: { accept: 'application/json' },
          timeoutMs: TIMEOUT_MS,
          operation: 'app-directory',
        },
      );
      const payload = response.data;
      if (response.status === 404) {
        this.failures = 0;
        throw new BusinessException(ErrorCode.NOT_FOUND, '应用不存在');
      }
      if (!response.ok || !payload || payload.data == null) {
        throw new UpstreamFailure(
          payload?.error?.message || `应用目录返回 ${response.status}`,
        );
      }
      this.failures = 0;
      return payload.data;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.failures += 1;
      if (this.failures >= BREAKER_THRESHOLD) {
        this.openedUntil = Date.now() + BREAKER_MS;
        this.failures = 0;
      }
      // 上游原文不进界面，也不写进日志的 message。
      logger.warn({
        operation: 'app-directory',
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new UpstreamFailure('应用目录请求失败');
    }
  }

  private unavailable() {
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '应用市场暂时不可用，请稍后重试',
    );
  }
}
