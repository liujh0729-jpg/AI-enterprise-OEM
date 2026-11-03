import { randomUUID } from 'node:crypto';
import { currentRequest } from '../common/request-context';
import { Logger } from '../common/logger';
export class TransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'cancelled' | 'network' | 'protocol',
    message: string,
  ) {
    super(message);
  }
}
type ReadMode = 'json' | 'text' | 'bytes' | 'empty';
export interface TransportOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeoutMs?: number;
  readAs?: ReadMode;
  /** Safe service/operation label; never include query strings or credentials. */
  operation?: string;
  concurrency?: number;
  limiterKey?: string;
}
export interface TransportResult<T> {
  status: number;
  ok: boolean;
  headers: Headers;
  data: T;
}
const logger = new Logger('HttpTransport');
const hosts = new Map<
  string,
  {
    active: number;
    waiting: (() => void)[];
  }
>();
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('请求已取消'),
      );
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    void work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function acquire(host: string, limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const state = hosts.get(host) || { active: 0, waiting: [] };
  hosts.set(host, state);
  if (state.active >= limit) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const index = state.waiting.indexOf(ready);
        if (index >= 0) state.waiting.splice(index, 1);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('请求已取消'),
        );
      };
      state.waiting.push(ready);
      signal.addEventListener('abort', abort, { once: true });
    });
  } else state.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = state.waiting.shift();
    if (next) next();
    else {
      state.active -= 1;
      if (!state.active) hosts.delete(host);
    }
  };
}
/** Sole backend fetch boundary. Deadline includes queue time and consuming the body. No automatic retries. */
export async function httpRequest<T = unknown>(
  url: string,
  options: TransportOptions = {},
): Promise<TransportResult<T>> {
  const {
    timeoutMs = 5000,
    signal: providedSignal,
    readAs = 'json',
    operation = 'upstream',
    concurrency = 8,
    limiterKey,
    ...init
  } = options;
  const signals = [providedSignal, currentRequest()?.signal].filter(
    (signal): signal is AbortSignal => !!signal,
  );
  const parent = signals.length ? AbortSignal.any(signals) : undefined;
  const controller = new AbortController();
  const started = Date.now();
  let expired = false;
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  let release: (() => void) | undefined;
  let status: number | undefined;
  const requestId = currentRequest()?.requestId || randomUUID();
  try {
    if (
      process.env.ISOLATED_TEST === '1' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
    )
      throw new TransportError('network', '隔离测试禁止访问外部上游');
    release = await acquire(
      limiterKey || new URL(url).origin,
      Math.max(1, concurrency),
      controller.signal,
    );
    if (controller.signal.aborted) throw controller.signal.reason;
    const headers =
      init.headers instanceof Headers || Array.isArray(init.headers)
        ? Object.fromEntries(new Headers(init.headers).entries())
        : { ...init.headers };
    if (!new Headers(headers).has('x-request-id'))
      headers['x-request-id'] = requestId;
    const response = await withAbort(
      fetch(url, { ...init, headers, signal: controller.signal }),
      controller.signal,
    );
    status = response.status;
    let data: unknown = null;
    if (readAs === 'bytes')
      data = new Uint8Array(
        await withAbort(response.arrayBuffer(), controller.signal),
      );
    else if (readAs !== 'empty') {
      const text = await withAbort(response.text(), controller.signal);
      if (readAs === 'text') data = text;
      else if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new TransportError('protocol', '上游返回格式不正确');
        }
      }
    } else await response.body?.cancel();
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      data: data as T,
    };
  } catch (error) {
    if (expired) throw new TransportError('timeout', '上游请求超时');
    if (parent?.aborted) throw new TransportError('cancelled', '请求已取消');
    if (error instanceof TransportError) throw error;
    throw new TransportError('network', '上游连接失败');
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
    release?.();
    const metrics = currentRequest()?.metrics;
    if (metrics) {
      metrics.upstreamCount++;
      metrics.upstreamMs += Date.now() - started;
    }
    logger.log({
      operation,
      requestId,
      status,
      elapsedMs: Date.now() - started,
    });
  }
}

export type StreamResult = {
  response: Response;
  /** 读完或提前放弃时必须调用：释放并发额度、清理计时器。 */
  close: () => void;
};

/**
 * 流式请求（SSE）：与 httpRequest 共用并发限流与取消语义，但只等响应头，
 * 正文由调用方逐块消费（对话逐字返回不能等整包）。
 * 计时器只管到「拿到响应头」为止；开始读流后由调用方的 signal 控制。
 */
export async function streamRequest(
  url: string,
  options: TransportOptions = {},
): Promise<StreamResult> {
  const {
    timeoutMs = 60000,
    signal: providedSignal,
    operation = 'upstream-stream',
    concurrency = 8,
    limiterKey,
    ...init
  } = options;
  const signals = [providedSignal, currentRequest()?.signal].filter(
    (signal): signal is AbortSignal => !!signal,
  );
  const parent = signals.length ? AbortSignal.any(signals) : undefined;
  const controller = new AbortController();
  const started = Date.now();
  let expired = false;
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  let release: (() => void) | undefined;
  let status: number | undefined;
  try {
    if (
      process.env.ISOLATED_TEST === '1' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
    )
      throw new TransportError('network', '隔离测试禁止访问外部上游');
    release = await acquire(
      limiterKey || new URL(url).origin,
      Math.max(1, concurrency),
      controller.signal,
    );
    if (controller.signal.aborted) throw controller.signal.reason;
    const headers =
      init.headers instanceof Headers || Array.isArray(init.headers)
        ? Object.fromEntries(new Headers(init.headers).entries())
        : { ...init.headers };
    const response = await withAbort(
      fetch(url, { ...init, headers, signal: controller.signal }),
      controller.signal,
    );
    status = response.status;
    clearTimeout(timer);
    logger.log({ operation, status, elapsedMs: Date.now() - started });
    let closed = false;
    return {
      response,
      close: () => {
        if (closed) return;
        closed = true;
        parent?.removeEventListener('abort', abort);
        release?.();
        release = undefined;
      },
    };
  } catch (error) {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
    release?.();
    if (expired) throw new TransportError('timeout', '上游请求超时');
    if (parent?.aborted) throw new TransportError('cancelled', '请求已取消');
    if (error instanceof TransportError) throw error;
    throw new TransportError('network', '上游连接失败');
  }
}
