import { createHash } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';

/**
 * 飞书开放平台多维表格客户端（自建应用 tenant_access_token 鉴权）。
 *
 * 只封装同步需要的接口：应用鉴权、列清单、记录分页读取、记录增改删。
 * 上游报错一律折成可读文案返回给界面，原始 msg 只进服务端日志，
 * 避免飞书内部错误串（含 app_token 等）漏到浏览器。
 */
const FEISHU_BASE = String(
  process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn',
).replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 20_000;
/** 单次全量读取封顶：飞书单页 500 条，20 页 = 1 万行，够用且防进程内存失控。 */
const MAX_RECORD_PAGES = 20;
/** token 失效类错误码：清缓存后用同一凭据重取一次。 */
const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991668]);

export type FeishuTable = { tableId: string; name: string };
export type FeishuField = {
  fieldId: string;
  fieldName: string;
  /** 飞书字段类型数值（1 文本 / 2 数字 / 3 单选 / 4 多选 / 5 日期 / 7 复选框 / 15 链接 …）。 */
  type: number;
};
export type FeishuRecord = {
  recordId: string;
  fields: Record<string, unknown>;
  /** 飞书最后修改时间（毫秒；部分旧数据为空）。 */
  lastModifiedTime: number;
};

type Envelope<T> = { code?: number; msg?: string; data?: T };

type RecordPage = {
  items?: {
    record_id?: string;
    fields?: Record<string, unknown>;
    last_modified_time?: number;
  }[];
  has_more?: boolean;
  page_token?: string;
};

export class FeishuBitableClient {
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  /** 凭证指纹只用于缓存键，不与明文一起落任何地方。 */
  private cacheKey(appId: string, appSecret: string) {
    return `${appId}:${createHash('sha256').update(appSecret).digest('hex')}`;
  }

  async tenantAccessToken(appId: string, appSecret: string): Promise<string> {
    const key = this.cacheKey(appId, appSecret);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const body = await this.post<{
      tenant_access_token?: string;
      expire?: number;
    }>('/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: appId,
      app_secret: appSecret,
    });
    const token = String(body.tenant_access_token || '');
    if (!token) throw this.upstreamError('获取飞书访问凭据失败');
    // 提前 60 秒过期，避免边界上拿着将失效的 token 发请求。
    const ttl = Math.max(Number(body.expire || 7200) - 60, 60) * 1000;
    this.tokenCache.set(key, { token, expiresAt: Date.now() + ttl });
    return token;
  }

  async listTables(appId: string, appSecret: string, appToken: string) {
    return this.pagedList<{ table_id?: string; name?: string }, FeishuTable>(
      appId,
      appSecret,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
      (item): FeishuTable | null =>
        item.table_id
          ? { tableId: item.table_id, name: String(item.name || item.table_id) }
          : null,
      10,
    );
  }

  async listFields(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
  ) {
    return this.pagedList<
      {
        field_id?: string;
        field_name?: string;
        type?: number;
      },
      FeishuField
    >(
      appId,
      appSecret,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      (item): FeishuField | null =>
        item.field_id && item.field_name
          ? {
              fieldId: item.field_id,
              fieldName: item.field_name,
              type: Number(item.type || 1),
            }
          : null,
      10,
    );
  }

  /** 全量读记录（自动翻页）。 */
  async listRecords(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
  ): Promise<FeishuRecord[]> {
    const token = await this.tenantAccessToken(appId, appSecret);
    const records: FeishuRecord[] = [];
    let pageToken = '';
    for (let page = 0; page < MAX_RECORD_PAGES; page += 1) {
      const query = new URLSearchParams({ page_size: '500' });
      if (pageToken) query.set('page_token', pageToken);
      const body = await this.get<RecordPage>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`,
        token,
      );
      for (const item of body.items || []) {
        if (!item.record_id) continue;
        records.push({
          recordId: item.record_id,
          fields:
            item.fields && typeof item.fields === 'object' ? item.fields : {},
          lastModifiedTime: Number(item.last_modified_time || 0),
        });
      }
      if (!body.has_more || !body.page_token) break;
      pageToken = body.page_token;
    }
    return records;
  }

  async getRecord(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
    recordId: string,
  ): Promise<FeishuRecord | null> {
    const token = await this.tenantAccessToken(appId, appSecret);
    const body = await this.get<{
      record?: {
        record_id?: string;
        fields?: Record<string, unknown>;
        last_modified_time?: number;
      };
    }>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
      token,
      true,
    );
    const record = body.record;
    if (!record?.record_id) return null;
    return {
      recordId: record.record_id,
      fields:
        record.fields && typeof record.fields === 'object' ? record.fields : {},
      lastModifiedTime: Number(record.last_modified_time || 0),
    };
  }

  async createRecord(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>,
  ): Promise<FeishuRecord> {
    const token = await this.tenantAccessToken(appId, appSecret);
    const body = await this.send<{
      record?: {
        record_id?: string;
        fields?: Record<string, unknown>;
        last_modified_time?: number;
      };
    }>(
      'POST',
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      token,
      { fields },
    );
    return this.recordOf(body.record);
  }

  async updateRecord(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<FeishuRecord> {
    const token = await this.tenantAccessToken(appId, appSecret);
    const body = await this.send<{
      record?: {
        record_id?: string;
        fields?: Record<string, unknown>;
        last_modified_time?: number;
      };
    }>(
      'PUT',
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
      token,
      { fields },
    );
    return this.recordOf(body.record);
  }

  async deleteRecord(
    appId: string,
    appSecret: string,
    appToken: string,
    tableId: string,
    recordId: string,
  ): Promise<void> {
    const token = await this.tenantAccessToken(appId, appSecret);
    await this.send(
      'DELETE',
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
      token,
    );
  }

  private recordOf(
    record:
      | {
          record_id?: string;
          fields?: Record<string, unknown>;
          last_modified_time?: number;
        }
      | undefined,
  ): FeishuRecord {
    if (!record?.record_id) throw this.upstreamError('飞书未返回记录 ID');
    return {
      recordId: record.record_id,
      fields:
        record.fields && typeof record.fields === 'object' ? record.fields : {},
      lastModifiedTime: Number(record.last_modified_time || Date.now()),
    };
  }

  /** 分页清单（表 / 列）：page_size 上限 100，最多 10 页。 */
  private async pagedList<Raw, Out>(
    appId: string,
    appSecret: string,
    path: string,
    map: (item: Raw) => Out | null,
    maxPages: number,
  ): Promise<Out[]> {
    const token = await this.tenantAccessToken(appId, appSecret);
    const result: Out[] = [];
    let pageToken = '';
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const body = await this.get<{
        items?: Raw[];
        has_more?: boolean;
        page_token?: string;
      }>(`${path}?${query}`, token);
      for (const item of body.items || []) {
        const mapped = map(item);
        if (mapped) result.push(mapped);
      }
      if (!body.has_more || !body.page_token) break;
      pageToken = body.page_token;
    }
    return result;
  }

  private async get<T>(path: string, token: string, allowNotFound = false) {
    return this.send<T>('GET', path, token, undefined, allowNotFound);
  }

  private async post<T>(path: string, body: unknown) {
    return this.send<T>('POST', path, '', body);
  }

  private async send<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<T> {
    let response: { ok: boolean; status: number; data: unknown };
    try {
      response = await httpRequest(`${FEISHU_BASE}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
        readAs: 'text',
        operation: 'feishu_bitable',
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'feishu_request_error',
          method,
          path,
          kind: error instanceof TransportError ? error.kind : 'unknown',
        }),
      );
      throw this.upstreamError('连不上飞书开放平台，请稍后重试');
    }
    let payload: Envelope<T> = {};
    const text = typeof response.data === 'string' ? response.data : '';
    if (text) {
      try {
        payload = JSON.parse(text) as Envelope<T>;
      } catch {
        payload = {};
      }
    }
    const code = Number(payload.code ?? 0);
    if (allowNotFound && (response.status === 404 || code === 1254005)) {
      return {} as T;
    }
    if (!response.ok || code !== 0) {
      console.error(
        JSON.stringify({
          event: 'feishu_api_error',
          method,
          path,
          httpStatus: response.status,
          code,
          msg: payload.msg,
        }),
      );
      if (TOKEN_INVALID_CODES.has(code)) {
        // token 可能被提前吊销：清空缓存，调用方重试一次即可拿到新 token。
        this.tokenCache.clear();
      }
      throw this.upstreamError(this.friendly(code));
    }
    return (payload.data ?? {}) as T;
  }

  private friendly(code: number) {
    if (code === 1254005 || code === 1254040 || code === 1254041)
      return '飞书多维表格或数据表不存在，请核对 app_token 与 table_id';
    if (code === 1254045 || code === 1254018)
      return '飞书数据表的列与字段映射不一致，请重新读取列清单';
    if (TOKEN_INVALID_CODES.has(code))
      return '飞书应用凭据无效或已过期，请核对 App ID / App Secret';
    if (code === 99991672 || code === 99991679)
      return '飞书应用未开通多维表格权限，请在应用后台添加 bitable:app 权限并发布';
    if (code === 1254290) return '飞书接口调用过于频繁，请稍后再试';
    if (code === 1254006) return '飞书数据表字段类型不支持写入该值';
    return `飞书接口调用失败（${code || '网络错误'}）`;
  }

  private upstreamError(message: string) {
    // 上游失败统一 503：前端只对本地 code 401 跳登录，上游 401/502 不能把已登录用户踢出会话。
    return new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
