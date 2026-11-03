import { ApiError, apiEnvelope, requestPath, z } from "@enterprise/contracts";

export type HttpOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, unknown>;
  timeoutMs?: number;
  responseType?: "json" | "blob" | "text" | "empty";
};
export type HttpResult<T> = { data: T; headers: Headers; status: number };
let privateRequests = new AbortController();
export function cancelSessionRequests() {
  privateRequests.abort();
  privateRequests = new AbortController();
}
const envelopeSchema = apiEnvelope(z.unknown());
/** HTTP only: no navigation, notifications, cache or retries. Deadline includes consuming the response body. */
export async function http<T>(
  path: string,
  schema: z.ZodType<T>,
  options: HttpOptions = {},
): Promise<HttpResult<T>> {
  const {
    body,
    query,
    timeoutMs = 30000,
    responseType = "json",
    signal: caller,
    ...init
  } = options;
  const parent = path.startsWith("/api/backend")
    ? AbortSignal.any([privateRequests.signal, ...(caller ? [caller] : [])])
    : caller;
  const controller = new AbortController();
  let expired = false;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  let status: number | undefined, requestId: string | undefined;
  let response: Response | undefined;
  try {
    const headers = new Headers(init.headers);
    let encoded: BodyInit | undefined;
    if (
      body instanceof FormData ||
      body instanceof Blob ||
      typeof body === "string" ||
      body instanceof URLSearchParams
    )
      encoded = body;
    else if (body !== undefined) {
      encoded = JSON.stringify(body);
      if (!headers.has("content-type"))
        headers.set("content-type", "application/json");
    }
    if (body instanceof FormData) headers.delete("content-type");
    const work = async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      response = await fetch(requestPath(path, query), {
        ...init,
        headers,
        body: encoded,
        credentials: "same-origin",
        signal: controller.signal,
      });
      status = response.status;
      requestId = response.headers.get("x-request-id") || undefined;
      let payload: unknown = null;
      if (responseType === "blob" && response.ok)
        payload = await response.blob();
      else {
        const text = await response.text();
        if (responseType === "text" && response.ok) payload = text;
        else if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            throw new ApiError(
              response.ok ? "响应格式不正确" : "服务暂时不可用，请稍后重试",
              response.ok ? "protocol" : "http",
              status,
              undefined,
              requestId,
            );
          }
        }
      }
      const envelope = envelopeSchema.safeParse(payload);
      if (!response.ok)
        throw new ApiError(
          envelope.success
            ? envelope.data.message
            : `请求失败（HTTP ${status}）`,
          "http",
          status,
          envelope.success ? envelope.data.code : undefined,
          requestId,
        );
      if (envelope.success && envelope.data.code !== 0)
        throw new ApiError(
          envelope.data.message || "操作失败",
          "business",
          status,
          envelope.data.code,
          requestId,
          envelope.data.data,
        );
      const parsed = schema.safeParse(payload);
      if (!parsed.success)
        throw new ApiError(
          "接口响应与约定不一致",
          "protocol",
          status,
          undefined,
          requestId,
        );
      return {
        data: parsed.data,
        headers: response.headers,
        status: response.status,
      };
    };
    return await new Promise<HttpResult<T>>((resolve, reject) => {
      const fail = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", fail, { once: true });
      if (controller.signal.aborted) fail();
      void work()
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", fail));
    });
  } catch (error) {
    if (parent?.aborted)
      throw new ApiError(
        "请求已取消",
        "cancelled",
        status,
        undefined,
        requestId,
      );
    if (expired)
      throw new ApiError(
        "请求超时，请稍后重试",
        "timeout",
        status,
        undefined,
        requestId,
      );
    if (error instanceof ApiError) {
      if (
        error.status === 401 &&
        path.startsWith("/api/backend/") &&
        typeof window !== "undefined"
      )
        queueMicrotask(() =>
          window.dispatchEvent(new Event("enterprise-session-expired")),
        );
      throw error;
    }
    throw new ApiError(
      "网络连接失败，请稍后重试",
      "network",
      status,
      undefined,
      requestId,
    );
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (controller.signal.aborted)
      void response?.body?.cancel().catch(() => undefined);
  }
}

export type SseEvent = { event: string; data: string };

/**
 * 空闲兜底：服务端每 10 秒发一条保活注释，90 秒收不到任何字节就认为连接已死。
 * 否则代理掐断半开连接后界面会一直停在「生成中…」。
 */
const SSE_IDLE_TIMEOUT_MS = 90_000;

/**
 * SSE 客户端：fetch + ReadableStream 读 `text/event-stream`（需要同源 Cookie，
 * 所以不用 EventSource）。SSE 不是 JSON 契约，因此留在传输层实现、由业务 API 包装。
 */
export async function streamSse(
  path: string,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    onEvent: (event: SseEvent) => void;
  },
) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const armIdleTimer = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SSE_IDLE_TIMEOUT_MS);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  armIdleTimer();
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `请求失败（HTTP ${response.status}）`;
      try {
        const payload = (await response.json()) as { message?: string };
        if (payload?.message) message = payload.message;
      } catch {
        // 非 JSON 错误体按状态码提示
      }
      throw new Error(message);
    }
    if (!response.body) throw new Error("连接已断开，请重试");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const flush = (chunk: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length) options.onEvent({ event, data: data.join("\n") });
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        flush(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) flush(buffer);
  } catch (error) {
    if (timedOut)
      throw new ApiError("连接中断超过 90 秒，已停止等待，请重新发送", "timeout");
    throw error;
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", forwardAbort);
    // 先取消再解锁：解锁后 reader.cancel() 会因 reader 已释放而抛错
    if (controller.signal.aborted)
      void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
