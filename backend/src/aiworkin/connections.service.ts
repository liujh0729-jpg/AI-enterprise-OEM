import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AiworkinClient } from './aiworkin.client';
import { localRegionDictionary } from '../shared/region-dictionary';
/** AIWORKIN：上游返回；LOCAL：本地内置省市字典兜底。 */
export type ConnectionSource = 'AIWORKIN' | 'LOCAL';
export type ConnectionPage = {
  list: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  source: ConnectionSource;
};
/** 转发到 AIworkin 的查询参数白名单（契约：connections/resources）。 */
const LIST_PARAMS = [
  'category',
  'keyword',
  'province',
  'city',
  'channel',
  'talentCategory',
  'talentType',
  'serviceScenario',
  'identityType',
  'associationType',
  'categoryKey',
  'locationMode',
  'minFollowers',
  'maxFollowers',
  'minScore',
  'minMembers',
  'maxMembers',
  'sort',
  'page',
  'pageSize',
] as const;
type UpstreamPage = {
  list: Record<string, unknown>[];
  total: number;
};
/** 建联资源与收藏均以当前用户身份调用平台，失败直接返回给工作台。 */
export class ConnectionsService {
  constructor(private readonly client: AiworkinClient) {}
  async listResources(
    token: string,
    query: Record<string, unknown>,
  ): Promise<ConnectionPage> {
    const upstream = await this.request<UpstreamPage>(
      token,
      `/connections/resources${toQueryString(query, LIST_PARAMS)}`,
    );
    return this.page(upstream, query, 9);
  }
  /**
   * 省市字典：有凭证且上游通道开启时走上游（平台 Key 优先，见 routes.ts 的 baseDataToken）；
   * 否则回落本地内置字典——参照数据不该因为「未绑 Key」而阻塞省市下拉。
   */
  async locations(token: string) {
    if (!token.trim() || !this.client.isEnabled()) {
      return { list: localRegionDictionary(), source: 'LOCAL' as const };
    }
    const list = await this.request<unknown[]>(
      token,
      '/connections/resources/locations',
    );
    if (!Array.isArray(list)) throw invalidResponse();
    return { list, source: 'AIWORKIN' as const };
  }
  async dictionary(token: string, code: string) {
    const list = await this.request<unknown[]>(
      token,
      `/dictionaries/${encodeURIComponent(code)}/items`,
    );
    if (!Array.isArray(list)) throw invalidResponse();
    return { list, source: 'AIWORKIN' as const };
  }
  async contact(token: string, sourceType: string, resourceId: string) {
    const upstream = await this.request<Record<string, unknown>>(
      token,
      `/connections/resources/${encodeURIComponent(sourceType)}/${encodeURIComponent(resourceId)}/contact`,
    );
    if (typeof upstream !== 'object' || Array.isArray(upstream)) {
      throw invalidResponse();
    }
    return { ...upstream, source: 'AIWORKIN' as const };
  }
  async favoriteList(token: string, query: Record<string, unknown>) {
    const upstream = await this.request<UpstreamPage>(
      token,
      `/connections/resources/favorites/marketing${toQueryString(query, [
        'page',
        'pageSize',
      ])}`,
    );
    return this.page(upstream, query, 20);
  }
  async profileFavoriteList(token: string, query: Record<string, unknown>) {
    const upstream = await this.request<UpstreamPage>(
      token,
      `/connections/profile-favorites${toQueryString(query, [
        'profileType',
        'page',
        'pageSize',
      ])}`,
    );
    return this.page(upstream, query, 20);
  }
  async setFavorite(
    token: string,
    resourceId: string,
    favorited: boolean,
    sourceType: 'talent' | 'profile' = 'talent',
  ) {
    const prefix =
      sourceType === 'profile'
        ? '/connections/profile-favorites'
        : '/connections/resources/favorites/talent';
    const upstream = await this.request<{
      favorited: boolean;
    }>(
      token,
      `${prefix}/${encodeURIComponent(resourceId)}`,
      favorited ? 'POST' : 'DELETE',
    );
    if (typeof upstream.favorited !== 'boolean') throw invalidResponse();
    return { favorited: upstream.favorited, source: 'AIWORKIN' as const };
  }
  private async request<T>(
    token: string,
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
  ): Promise<T> {
    if (!this.client.isEnabled()) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        'AIworkin 建联通道已关闭，请联系管理员启用',
      );
    }
    if (!token.trim()) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '请先登录后使用建联服务',
      );
    }
    const result = await this.client.request<T>(path, {
      token,
      method,
      retry: method === 'GET' ? 1 : 0,
    });
    if (result == null) throw invalidResponse();
    return result;
  }
  private page(
    upstream: UpstreamPage,
    query: Record<string, unknown>,
    defaultPageSize: number,
  ): ConnectionPage {
    if (
      !Array.isArray(upstream.list) ||
      !Number.isFinite(upstream.total) ||
      upstream.total < 0
    ) {
      throw invalidResponse();
    }
    return {
      list: upstream.list,
      total: upstream.total,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || defaultPageSize,
      source: 'AIWORKIN',
    };
  }
}
function invalidResponse() {
  return new BusinessException(
    ErrorCode.AIWORKIN_UNAVAILABLE,
    'AIworkin 建联接口返回数据异常，请稍后重试',
  );
}
function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  const single = text(value ?? '').trim();
  return single ? [single] : [];
}
/** 保留重复参数（多选筛选按 AIworkin 契约用同名参数重复传递）。 */
function toQueryString(
  query: Record<string, unknown>,
  allowed: readonly string[],
) {
  const params = new URLSearchParams();
  for (const key of allowed) {
    for (const value of asList(query[key])) params.append(key, value);
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}
