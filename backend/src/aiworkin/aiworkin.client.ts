import {
  httpRequest,
  TransportError,
  type TransportResult,
} from '../http/transport';
import { currentRequest } from '../common/request-context';
import { randomBytes } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode, ErrorCodeValue } from '../common/error-code';
import {
  aiworkinBaseUrl,
  aiworkinRetryCount,
  aiworkinTimeoutMs,
} from './aiworkin.config';
export interface AiworkinRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** 代表当前用户转发调用时携带的访问令牌。 */
  token?: string;
  body?: unknown;
  /** 写接口必带的幂等键。 */
  idempotencyKey?: string;
  /** 幂等重试次数；未指定时 GET 默认重试 2 次、写操作不重试。 */
  retry?: number;
  locale?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖目标地址（如账号侧接口走 JAVA_BASE_URL）。 */
  baseUrl?: string;
  /** 追加请求头（如内部接口的 X-Internal-Token）。 */
  headers?: Record<string, string>;
}
interface ApiEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
export class AiworkinClient {
  isEnabled() {
    return process.env.AIWORKIN_ENABLED !== 'false';
  }
  /** 生成符合 AIworkin 契约的幂等键：^[A-Za-z0-9_-]{16,100}$ */
  newIdempotencyKey(prefix = 'ent') {
    return `${prefix}_${randomBytes(16).toString('hex')}`;
  }
  assertValidIdempotencyKey(key: string) {
    if (!IDEMPOTENCY_PATTERN.test(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Idempotency-Key 需为 16-100 位字母/数字/下划线/连字符',
      );
    }
    return key;
  }
  async request<T>(
    path: string,
    options: AiworkinRequestOptions = {},
  ): Promise<T> {
    const signals = [options.signal, currentRequest()?.signal].filter(
      (signal): signal is AbortSignal => !!signal,
    );
    options = {
      ...options,
      signal: signals.length ? AbortSignal.any(signals) : undefined,
    };
    const method = options.method || 'GET';
    const attempts = Math.min(
      2,
      Math.max(
        0,
        options.retry ?? (method === 'GET' ? aiworkinRetryCount() : 0),
      ),
    );
    if (method !== 'GET' && attempts > 0 && !options.idempotencyKey)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '写操作重试必须提供幂等键',
      );
    const deadline = Date.now() + (options.timeoutMs ?? aiworkinTimeoutMs());
    let lastError: unknown;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      try {
        return await this.send<T>(path, method, {
          ...options,
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
      } catch (error) {
        lastError = error;
        if (
          !shouldRetry(error) ||
          attempt === attempts ||
          options.signal?.aborted ||
          Date.now() + 150 * 2 ** attempt >= deadline
        )
          break;
        await delay(150 * 2 ** attempt, options.signal);
      }
    }
    throw lastError;
  }
  private async send<T>(
    path: string,
    method: string,
    options: AiworkinRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = this.assertValidIdempotencyKey(
        options.idempotencyKey,
      );
    }
    if (options.locale) {
      headers['x-locale'] = options.locale;
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }
    let response: TransportResult<ApiEnvelope<T> | null>;
    try {
      response = await httpRequest<ApiEnvelope<T> | null>(
        `${options.baseUrl ? options.baseUrl.replace(/\/$/, '') : aiworkinBaseUrl()}${path}`,
        {
          method,
          headers,
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          operation: `aiworkin:${method}:${path.split('?')[0]}`,
        },
      );
    } catch (error) {
      if (error instanceof TransportError && error.kind === 'cancelled')
        throw error;
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        'AIworkin 通道暂时不可达',
      );
    }
    const payload = response.data;
    if (!response.ok) {
      throw mapHttpStatus(response.status, payload);
    }
    if (!payload || (payload.code != null && payload.code !== 0)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        payload?.message || 'AIworkin 返回异常',
        payload?.data ?? null,
      );
    }
    return payload.data as T;
  }
}
function mapHttpStatus<T>(
  status: number,
  payload: ApiEnvelope<T> | null,
): BusinessException {
  const raw = payload?.message || `AIworkin 返回 HTTP ${status}`;
  const data = payload?.data ?? null;
  const code = upstreamErrorCode(status);
  // 上游令牌失效不是「本系统未登录」：前端对 code 401 一律跳登录页，直传会把已登录用户顶出会话。
  if (status === 401) {
    return new BusinessException(code, `AIworkin 通道鉴权失败：${raw}`, data);
  }
  // 24001 是「通道不可用」的总口径，上游 5xx 给的是它自己的内部报错（实测有「服务器内部错误」），
  // 原样透传会让界面把通道故障显示成一句无信息量的内部错误，与「确实没有数据」不可区分。
  if (code === ErrorCode.AIWORKIN_UNAVAILABLE) {
    return new BusinessException(code, 'AIworkin 能力暂不可用', {
      upstreamStatus: status,
      upstreamMessage: raw,
    });
  }
  return new BusinessException(code, raw, data);
}
function upstreamErrorCode(status: number): ErrorCodeValue {
  switch (status) {
    case 400:
    case 413:
    case 422:
    case 428:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.AIWORKIN_AUTH_FAILED;
    case 402:
      return ErrorCode.FORBIDDEN;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
    case 410:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 501:
      return ErrorCode.NOT_IMPLEMENTED;
    default:
      return ErrorCode.AIWORKIN_UNAVAILABLE;
  }
}
function shouldRetry(error: unknown) {
  return (
    error instanceof BusinessException &&
    error.errorCode === ErrorCode.AIWORKIN_UNAVAILABLE
  );
}
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(new TransportError('cancelled', '请求已取消'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
