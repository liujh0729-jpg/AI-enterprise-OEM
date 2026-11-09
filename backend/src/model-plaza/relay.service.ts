import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, streamRequest, TransportError } from '../http/transport';

export type RelayCredentials = {
  upstreamId: number;
  provider: string;
  baseUrl: string;
  apiKey: string;
  protocol: 'openai' | 'anthropic';
  upstreamName: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;

/** baseUrl 已含 `/v1`，path 以 `/` 开头；只做一次拼接，避免出现 `//chat`。 */
export function relayUrl(baseUrl: string, path: string): string {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function authHeaders(credentials: RelayCredentials): Record<string, string> {
  if (credentials.protocol === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': credentials.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credentials.apiKey}`,
  };
}

function upstreamMessage(text: string) {
  const trimmed = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    (trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed) ||
    '无返回内容'
  );
}

/** 传输层异常 → 业务异常；超时与不可达对用户是两种提示，不能混。 */
function relayFailure(error: unknown): BusinessException {
  if (error instanceof TransportError) {
    if (error.kind === 'timeout') {
      return new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '上游调用超时，请稍后重试',
      );
    }
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `上游渠道不可达：${error.message}`,
    );
  }
  return new BusinessException(
    ErrorCode.SERVICE_UNAVAILABLE,
    `上游渠道不可达：${error instanceof Error ? error.message : '未知错误'}`,
  );
}

/**
 * 广场转发内核：把请求原样转给上游渠道并回传上游响应。
 * 计量与扣分不在这里做（由调用方按 usage 结算），这里只负责「带凭据转发」。
 */
export class ModelRelayService {
  /** 非流式转发；上游非 2xx 也原样返回状态码与正文，由调用方决定如何暴露。 */
  async forwardJson(
    credentials: RelayCredentials,
    path: string,
    payload: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ status: number; ok: boolean; text: string }> {
    try {
      const result = await httpRequest<string>(
        relayUrl(credentials.baseUrl, path),
        {
          method: 'POST',
          headers: authHeaders(credentials),
          body: JSON.stringify(payload ?? {}),
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          readAs: 'text',
          operation: 'model-plaza:relay',
        },
      );
      return { status: result.status, ok: result.ok, text: result.data };
    } catch (error) {
      throw relayFailure(error);
    }
  }

  /** 流式转发：直接回上游的 ReadableStream，调用方自行 tee/观察。 */
  async forwardStream(
    credentials: RelayCredentials,
    path: string,
    payload: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<Response> {
    try {
      const { response, close } = await streamRequest(
        relayUrl(credentials.baseUrl, path),
        {
          method: 'POST',
          headers: { ...authHeaders(credentials), Accept: 'text/event-stream' },
          body: JSON.stringify(payload ?? {}),
          signal: options.signal,
          timeoutMs: 60_000,
          operation: 'model-plaza:stream',
        },
      );
      if (!response.body) {
        close();
        return response;
      }
      const reader = response.body.getReader();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        close();
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              release();
              controller.close();
              return;
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          release();
          await reader.cancel(reason).catch(() => undefined);
        },
      });
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      throw relayFailure(error);
    }
  }

  /** GET 转发（异步任务回查：视频 / 图像编辑 / 语音合成）。 */
  async forwardGet(
    credentials: RelayCredentials,
    path: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ status: number; ok: boolean; text: string }> {
    try {
      const result = await httpRequest<string>(
        relayUrl(credentials.baseUrl, path),
        {
          method: 'GET',
          headers: authHeaders(credentials),
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          readAs: 'text',
          operation: 'model-plaza:relay-get',
        },
      );
      return { status: result.status, ok: result.ok, text: result.data };
    } catch (error) {
      throw relayFailure(error);
    }
  }

  /** 二进制转发（语音合成 / 图片下载），用于站内试用把结果落成资产。 */
  async forwardBinary(
    credentials: RelayCredentials,
    path: string,
    payload: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{
    status: number;
    ok: boolean;
    contentType: string;
    bytes: Uint8Array;
    text: string;
  }> {
    try {
      const result = await httpRequest<Uint8Array>(
        relayUrl(credentials.baseUrl, path),
        {
          method: 'POST',
          headers: authHeaders(credentials),
          body: JSON.stringify(payload ?? {}),
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          readAs: 'bytes',
          operation: 'model-plaza:relay-binary',
        },
      );
      const contentType = result.headers.get('content-type') || '';
      if (!result.ok || contentType.includes('application/json')) {
        return {
          status: result.status,
          ok: result.ok,
          contentType,
          bytes: new Uint8Array(),
          text: new TextDecoder().decode(result.data),
        };
      }
      return {
        status: result.status,
        ok: result.ok,
        contentType,
        bytes: result.data,
        text: '',
      };
    } catch (error) {
      throw relayFailure(error);
    }
  }
}

export function upstreamErrorMessage(status: number, text: string) {
  return `上游返回 HTTP ${status}：${upstreamMessage(text)}`;
}
