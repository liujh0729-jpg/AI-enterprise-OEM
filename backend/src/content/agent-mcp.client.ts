import {
  MCP_PROTOCOL_FALLBACKS,
  MCP_PROTOCOL_VERSION,
} from '@enterprise/contracts';
import { text } from '../common/api';
import {
  httpRequest,
  readCappedBody,
  streamRequest,
  TransportError,
} from '../http/transport';

/**
 * 通用 MCP 客户端：只实现两条接入方式——
 * - http：Streamable HTTP（2025-03-26 起的主推方式），一条 POST 承载一条 JSON-RPC；
 * - sse：旧版 HTTP+SSE，GET 流下发 `endpoint` 事件，消息 POST 到该地址、响应从流里回来。
 * 不做 stdio（本系统不在服务器上装第三方进程），响应既可能是 JSON 也可能是 SSE。
 * 服务地址与返回内容都由用户/第三方控制，所以：不跟随跳转、正文与 SSE 流都有硬上限。
 */

export type McpTransport = 'http' | 'sse';

export type McpRemoteTool = {
  name: string;
  description: string;
  /** 远程声明的入参 JSON Schema；缺失按空对象处理 */
  inputSchema: Record<string, unknown>;
};

export type McpCallOutcome = { text: string; isError: boolean };

export type McpConnectorConfig = {
  transport: McpTransport;
  url: string;
  /** 解密后的额外请求头 */
  headers: Record<string, string>;
};

const CLIENT_NAME = 'aiworkin-enterprise-agent';
const CLIENT_VERSION = '1.0.0';
const LIST_TIMEOUT = 20_000;
const CALL_TIMEOUT = 90_000;
const NOTIFY_TIMEOUT = 5_000;
const RESULT_TEXT_LIMIT = 6000;
/** 一条 JSON-RPC 响应的字节上限：合法报文远小于此，超限只可能是灌数据或畸形服务。 */
const MAX_RESPONSE_BYTES = 1_000_000;
/** SSE 流在一次等待里允许累计的字节数（同一口径，防无界流把内存吃光）。 */
const MAX_SSE_BYTES = 1_000_000;

/** 上游文案一律换成中文口径：原文只用于服务端判断，不进界面、不回给模型。 */
export class McpClientError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'auth' | 'protocol' | 'upstream',
  ) {
    super(message);
    this.name = 'McpClientError';
  }
}

class McpRpcError extends McpClientError {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message, 'upstream');
    this.name = 'McpRpcError';
  }
}

function transportError(error: unknown, timeoutMs: number): McpClientError {
  if (error instanceof McpClientError) return error;
  if (error instanceof TransportError) {
    if (error.kind === 'timeout')
      return new McpClientError(
        `连接器在 ${Math.round(timeoutMs / 1000)} 秒内没有响应`,
        'timeout',
      );
    if (error.kind === 'protocol')
      return new McpClientError('连接器返回的不是合法的 MCP 报文', 'protocol');
  }
  return new McpClientError(
    '连接器地址不可达（域名解析或网络不通）',
    'network',
  );
}

function cronyMessage(value: unknown) {
  return text(value)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * 跳转一律拒绝：连接器地址是用户填的公网地址，跟着 302 走等于把出站校验绕过去
 * （重定向到内网/元数据地址），所以只允许把最终地址直接填进来。
 */
function assertNoRedirect(response: { status: number }): void {
  if (response.status >= 300 && response.status < 400) {
    throw new McpClientError(
      `连接器返回跳转（HTTP ${response.status}）：本系统不跟随跳转，请把服务地址填成最终地址`,
      'protocol',
    );
  }
}

type SseFrame = { event: string; data: string };

const NOOP_SIGNAL = new AbortController().signal;

/** 按上限读完一条 JSON-RPC 响应正文（不走 fetch 默认的整包 text）。 */
async function readCappedText(response: Response, signal?: AbortSignal) {
  const bytes = await readCappedBody(
    response,
    MAX_RESPONSE_BYTES,
    signal ?? NOOP_SIGNAL,
  );
  return new TextDecoder().decode(bytes);
}

/** 读 SSE 帧；回调返回 true 表示已经拿到要的结果，提前断开。 */
async function pumpSse(
  body: ReadableStream<Uint8Array> | null,
  onFrame: (frame: SseFrame) => boolean,
  maxBytes = MAX_SSE_BYTES,
) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let received = 0;
  let event = '';
  let data: string[] = [];
  let stopped = false;
  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new McpClientError(
          '连接器推送的内容超过大小上限，已中断读取',
          'protocol',
        );
      }
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const raw = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!raw) {
          if (
            data.length &&
            onFrame({ event: event || 'message', data: data.join('\n') })
          ) {
            stopped = true;
            break outer;
          }
          event = '';
          data = [];
          continue;
        }
        if (raw.startsWith(':')) continue;
        const colon = raw.indexOf(':');
        const field = colon < 0 ? raw : raw.slice(0, colon);
        const value = colon < 0 ? '' : raw.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
    if (
      !stopped &&
      data.length &&
      onFrame({ event: event || 'message', data: data.join('\n') })
    )
      stopped = true;
  } finally {
    if (stopped) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function asSchema(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { type: 'object', properties: {} };
}

function unwrapResult(
  message: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const error = message.error;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const code = Number(row.code ?? 0);
    const detail = cronyMessage(row.message);
    throw new McpRpcError(
      detail
        ? `连接器返回错误：${detail}（code ${code}）`
        : `连接器返回错误（code ${code}）`,
      Number.isFinite(code) ? code : 0,
    );
  }
  return message.result && typeof message.result === 'object'
    ? (message.result as Record<string, unknown>)
    : {};
}

function readTools(result: Record<string, unknown> | undefined) {
  const list = Array.isArray(result?.tools) ? result.tools : [];
  const tools: McpRemoteTool[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const tool = raw as Record<string, unknown>;
    const name = text(tool.name).trim();
    if (!name) continue;
    tools.push({
      name,
      description: text(tool.description)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400),
      inputSchema: asSchema(tool.inputSchema),
    });
  }
  return {
    tools,
    nextCursor: text((result ?? {}).nextCursor).trim(),
  };
}

/** 把 tools/call 的 content 数组压成一段文本：文本原样，图片/资源给占位说明。 */
function flattenCall(
  result: Record<string, unknown> | undefined,
): McpCallOutcome {
  const parts: string[] = [];
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = text(item.type);
    if (type === 'text') parts.push(text(item.text));
    else if (type === 'image')
      parts.push(`[图片内容：${text(item.mimeType) || '未知类型'}]`);
    else if (type === 'audio') parts.push('[音频内容]');
    else if (type === 'resource') {
      const resource = (item.resource || {}) as Record<string, unknown>;
      parts.push(text(resource.text) || `[资源：${text(resource.uri)}]`);
    } else parts.push(`[${type || '未知类型'}内容]`);
  }
  const structured = result?.structuredContent;
  if (!parts.length && structured && typeof structured === 'object') {
    try {
      parts.push(JSON.stringify(structured));
    } catch {
      parts.push('连接器返回了无法读取的结构化结果');
    }
  }
  const joined = parts.filter(Boolean).join('\n') || '连接器没有返回文本内容';
  return {
    text:
      joined.length > RESULT_TEXT_LIMIT
        ? `${joined.slice(0, RESULT_TEXT_LIMIT)}…`
        : joined,
    isError: result?.isError === true,
  };
}

/** Streamable HTTP：POST 一条消息，响应可能是 JSON 或一条 SSE 流。 */
class StreamableHttp {
  private sessionId = '';

  constructor(private readonly config: McpConnectorConfig) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...this.config.headers,
    };
  }

  private async send(
    method: string,
    params: Record<string, unknown> | undefined,
    id: number | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (id !== undefined) payload.id = id;
    if (params !== undefined) payload.params = params;
    let stream;
    try {
      stream = await streamRequest(this.config.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal,
        timeoutMs,
        redirect: 'manual',
        operation: 'content:agentMcp',
      });
    } catch (error) {
      throw transportError(error, timeoutMs);
    }
    try {
      const response = stream.response;
      assertNoRedirect(response);
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new McpClientError(
            `连接器拒绝了连接（HTTP ${response.status}），请检查服务地址与请求头`,
            'auth',
          );
        if (response.status === 404)
          throw new McpClientError(
            '连接器地址不存在（HTTP 404），请检查服务地址',
            'protocol',
          );
        throw new McpClientError(
          `连接器返回 HTTP ${response.status}`,
          'upstream',
        );
      }
      if (id === undefined) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const type = response.headers.get('content-type') || '';
      if (type.includes('text/event-stream')) {
        return await this.readSse(response.body, id, timeoutMs);
      }
      const raw = await readCappedText(response, signal).catch((error) => {
        // 超上限 / 读失败都要如实报错，不能当成「没有正文」静默过去
        if (error instanceof McpClientError) throw error;
        const detail = error instanceof Error ? error.message : '';
        throw new McpClientError(
          detail.includes('大小上限')
            ? '连接器返回的内容超过大小上限，已中断读取'
            : '连接器返回的内容无法读取',
          'protocol',
        );
      });
      if (!raw.trim()) return undefined;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new McpClientError(
          '连接器返回的不是合法的 MCP 报文（不是 JSON）',
          'protocol',
        );
      }
      return unwrapResult(parsed);
    } finally {
      stream.close();
    }
  }

  private readSse(
    body: ReadableStream<Uint8Array> | null,
    id: number,
    timeoutMs: number,
  ) {
    return new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(
            new McpClientError(
              `连接器在 ${Math.round(timeoutMs / 1000)} 秒内没有返回结果`,
              'timeout',
            ),
          );
        }, timeoutMs);
        const finish = (work: () => void) => {
          if (settled) return true;
          settled = true;
          clearTimeout(timer);
          work();
          return true;
        };
        void pumpSse(body, (frame) => {
          if (frame.data === '[DONE]') return false;
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            return false;
          }
          if (message.id !== id) return false;
          try {
            const result = unwrapResult(message);
            return finish(() => resolve(result));
          } catch (error) {
            return finish(() =>
              reject(
                error instanceof Error
                  ? error
                  : new McpClientError('连接器返回的结果无法解析', 'protocol'),
              ),
            );
          }
        })
          .then(() => {
            finish(() =>
              reject(
                new McpClientError(
                  '连接器提前关闭了连接，没有返回结果',
                  'protocol',
                ),
              ),
            );
          })
          .catch((error: unknown) => {
            finish(() => reject(transportError(error, timeoutMs)));
          });
      },
    );
  }

  async open(signal?: AbortSignal) {
    let lastError: unknown;
    for (const version of [MCP_PROTOCOL_VERSION, ...MCP_PROTOCOL_FALLBACKS]) {
      try {
        await this.send(
          'initialize',
          {
            protocolVersion: version,
            capabilities: {},
            clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
          },
          1,
          LIST_TIMEOUT,
          signal,
        );
        await this.send(
          'notifications/initialized',
          undefined,
          undefined,
          NOTIFY_TIMEOUT,
          signal,
        ).catch(() => undefined);
        return;
      } catch (error) {
        if (
          error instanceof McpClientError &&
          (error.kind === 'auth' || error.kind === 'network')
        )
          throw error;
        lastError = error;
      }
    }
    throw lastError instanceof McpClientError
      ? lastError
      : new McpClientError('连接器初始化失败', 'protocol');
  }

  async listTools(signal?: AbortSignal) {
    const tools: McpRemoteTool[] = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const result = await this.send(
        'tools/list',
        cursor ? { cursor } : {},
        2 + page,
        LIST_TIMEOUT,
        signal,
      );
      const pageResult = readTools(result);
      tools.push(...pageResult.tools);
      if (!pageResult.nextCursor) break;
      cursor = pageResult.nextCursor;
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const result = await this.send(
      'tools/call',
      { name, arguments: args },
      100,
      CALL_TIMEOUT,
      signal,
    );
    return flattenCall(result);
  }
}

/** 旧版 HTTP+SSE：GET 流上先收 `endpoint` 事件，之后消息 POST 到该地址、响应从流里回来。 */
class LegacySse {
  private endpoint = '';
  private closeStream?: () => void;
  private closed = false;
  private waiting = new Map<
    number,
    (message: Record<string, unknown>) => void
  >();
  private early = new Map<number, Record<string, unknown>>();
  private counter = 0;

  constructor(private readonly config: McpConnectorConfig) {}

  private waitFor(id: number, timeoutMs: number) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const early = this.early.get(id);
      if (early) {
        this.early.delete(id);
        resolve(early);
        return;
      }
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(
          new McpClientError(
            `连接器在 ${Math.round(timeoutMs / 1000)} 秒内没有返回结果`,
            'timeout',
          ),
        );
      }, timeoutMs);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        resolve(message);
      });
    });
  }

  async open(signal?: AbortSignal) {
    let stream;
    try {
      stream = await streamRequest(this.config.url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...this.config.headers },
        signal,
        timeoutMs: LIST_TIMEOUT,
        redirect: 'manual',
        operation: 'content:agentMcpSse',
      });
    } catch (error) {
      throw transportError(error, LIST_TIMEOUT);
    }
    this.closeStream = stream.close;
    assertNoRedirect(stream.response);
    if (!stream.response.ok) {
      stream.close();
      throw new McpClientError(
        stream.response.status === 401 || stream.response.status === 403
          ? `连接器拒绝了连接（HTTP ${stream.response.status}），请检查服务地址与请求头`
          : `连接器返回 HTTP ${stream.response.status}`,
        stream.response.status === 401 || stream.response.status === 403
          ? 'auth'
          : 'upstream',
      );
    }
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new McpClientError(
              '连接器没有给出消息地址（SSE endpoint 事件超时）',
              'timeout',
            ),
          ),
        LIST_TIMEOUT,
      );
      void pumpSse(stream.response.body, (frame) => {
        if (frame.event === 'endpoint') {
          clearTimeout(timer);
          this.endpoint = new URL(
            frame.data.trim(),
            this.config.url,
          ).toString();
          resolve();
          return false;
        }
        if (frame.event === 'message') this.dispatch(frame.data);
        return false;
      })
        .then(() => {
          clearTimeout(timer);
          if (!this.closed)
            reject(new McpClientError('连接器关闭了 SSE 连接', 'protocol'));
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(transportError(error, LIST_TIMEOUT));
        });
    });
    await ready;
    await this.send(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
      LIST_TIMEOUT,
      signal,
    );
    await this.notify('notifications/initialized', signal);
  }

  private dispatch(data: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof message.id === 'number' ? message.id : Number(message.id);
    if (!Number.isFinite(id)) return;
    const waiter = this.waiting.get(id);
    if (waiter) waiter(message);
    else if (this.early.size < 32) this.early.set(id, message);
  }

  private async post(payload: Record<string, unknown>, signal?: AbortSignal) {
    try {
      const result = await httpRequest(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify(payload),
        signal,
        timeoutMs: 10_000,
        readAs: 'text',
        redirect: 'manual',
        maxBytes: MAX_RESPONSE_BYTES,
        operation: 'content:agentMcpSseMessage',
      });
      assertNoRedirect(result);
      if (!result.ok)
        throw new McpClientError(
          `连接器返回 HTTP ${result.status}`,
          'upstream',
        );
    } catch (error) {
      throw transportError(error, 10_000);
    }
  }

  async send(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const id = ++this.counter;
    const payload: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;
    const pending = this.waitFor(id, timeoutMs);
    await this.post(payload, signal);
    return unwrapResult(await pending);
  }

  private async notify(method: string, signal?: AbortSignal) {
    await this.post({ jsonrpc: '2.0', method }, signal).catch(() => undefined);
  }

  async listTools(signal?: AbortSignal) {
    const result = await this.send('tools/list', {}, LIST_TIMEOUT, signal);
    return readTools(result).tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const result = await this.send(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT,
      signal,
    );
    return flattenCall(result);
  }

  close() {
    this.closed = true;
    this.closeStream?.();
  }
}

/** 一次探测/调用用一个客户端：开连接 → 干活 → close()。 */
export class McpClient {
  private readonly http?: StreamableHttp;
  private readonly sse?: LegacySse;

  constructor(config: McpConnectorConfig) {
    if (config.transport === 'sse') this.sse = new LegacySse(config);
    else this.http = new StreamableHttp(config);
  }

  private async connect(signal?: AbortSignal) {
    if (this.http) return this.http.open(signal);
    await this.sse?.open(signal);
  }

  async listTools(signal?: AbortSignal) {
    await this.connect(signal);
    return this.http
      ? this.http.listTools(signal)
      : this.sse!.listTools(signal);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await this.connect(signal);
    return this.http
      ? this.http.callTool(name, args, signal)
      : this.sse!.callTool(name, args, signal);
  }

  close() {
    this.sse?.close();
  }
}
