import {
  httpRequest,
  readSse,
  streamRequest,
  TransportError,
  type StreamResult,
} from '../http/transport';
import { recordModelCall } from './metrics';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
/**
 * GEO 的模型调用（采集提问与观测解析共用）。两种方言：
 * - `openai`（默认）：十一家平台（火山方舟 / 百炼 / Moonshot / 混元 / DeepSeek / 智谱 / 小米 MiMo /
 *   MiniMax / OpenAI / Google / xAI）都是 OpenAI 兼容形态，
 *   统一打 `POST {baseUrl}/chat/completions` + `Authorization: Bearer`；
 * - `anthropic`：Claude 走 Messages API `POST {baseUrl}/messages` + `x-api-key` + `anthropic-version`。
 * 密钥只在本进程内存里进请求头，不落库、不落日志、不回传前端。
 */
export type GeoChatInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  platform?: string;
  api?: 'openai' | 'anthropic';
};
/**
 * 消息内容分片：纯文本直接给字符串；带图的视觉理解用分片数组。
 * 图片只接受**公网可访问 URL**（本站 OSS 桶公开读）或 base64 数据，
 * 两种方言各自映射（openai 用 `image_url`、anthropic 用 `image/source`），业务侧只关心「一张图 + 一段话」。
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; data?: string; mediaType?: string };
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
};
export type GeoChatMultiInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  userId?: string;
  purpose?: 'chat' | 'batch';
  /** Claude 渠道用 Messages API（system 抽到顶层参数）；缺省一律 OpenAI 兼容。 */
  api?: 'openai' | 'anthropic';
};
export type GeoChatResult = {
  reply: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
};
/** 消息内容 → 纯文本（system 提示、流式与非视觉场景用）。 */
export function messageText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n');
}

/** 统一消息 → 目标方言的 messages 数组（openai 的 image_url / anthropic 的 image source）。 */
function adaptMessages(
  messages: ChatMessage[],
  anthropic: boolean,
): Record<string, unknown>[] {
  const hasParts = messages.some((item) => Array.isArray(item.content));
  if (!hasParts) return messages;
  return messages.map((item) => {
    if (typeof item.content === 'string')
      return { role: item.role, content: item.content };
    const parts = item.content.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (anthropic) {
        return part.data
          ? {
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.mediaType || 'image/jpeg',
                data: part.data,
              },
            }
          : { type: 'image', source: { type: 'url', url: part.url || '' } };
      }
      return {
        type: 'image_url',
        image_url: {
          url: part.data
            ? `data:${part.mediaType || 'image/jpeg'};base64,${part.data}`
            : part.url || '',
        },
      };
    });
    return { role: item.role, content: parts };
  });
}

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  /** Anthropic Messages API 的回答块数组。 */
  content?: {
    text?: string;
  }[];
  error?: {
    message?: string;
  };
  message?: string;
};
const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic Messages API 的正文在 content 块数组里，按顺序拼接。 */
export function extractAssistantText(
  payload: { content?: { text?: string }[] },
  fallback = '',
): string {
  const blocks = Array.isArray(payload.content)
    ? payload.content.map((block) => String(block?.text || '')).join('')
    : '';
  return (blocks || fallback).trim();
}
/** 模型名为空时方舟等平台会直接 400，这里先给出可执行的提示。 */
export async function geoChat(input: GeoChatInput): Promise<GeoChatResult> {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '接口地址为空');
  }
  const anthropic = input.api === 'anthropic';
  const timeoutMs = input.timeoutMs || 30000;
  const startedAt = Date.now();
  let failed = true;
  const url = anthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  try {
    const response = await httpRequest<string>(url, {
      method: 'POST',
      headers: anthropic
        ? {
            'Content-Type': 'application/json',
            'x-api-key': input.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.apiKey}`,
          },
      body: JSON.stringify(
        anthropic
          ? {
              model: input.model,
              messages: [{ role: 'user', content: input.prompt }],
              max_tokens: input.maxTokens || 32,
            }
          : {
              model: input.model,
              messages: [{ role: 'user', content: input.prompt }],
              max_tokens: input.maxTokens || 32,
              stream: false,
            },
      ),
      signal: input.signal,
      timeoutMs,
      readAs: 'text',
      concurrency: 1,
      limiterKey: `geo:${input.platform || new URL(baseUrl).origin}`,
      operation: 'geo:model',
    });
    const text = response.data;
    let payload: ChatCompletionResponse = {};
    try {
      payload = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      // 非 JSON 响应（网关错误页等）按纯文本截断展示
    }
    if (!response.ok) {
      const detail = String(
        payload.error?.message ||
          payload.message ||
          text.replace(/\s+/g, ' ').trim().slice(0, 200) ||
          '无返回内容',
      )
        .replaceAll(input.apiKey, '[redacted]')
        .replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
        .slice(0, 200);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `平台返回 HTTP ${response.status}：${detail}`,
      );
    }
    failed = false;
    return {
      reply: anthropic
        ? extractAssistantText(payload)
        : String(payload.choices?.[0]?.message?.content ?? '').trim(),
      elapsedMs: Date.now() - startedAt,
      promptTokens: Number(
        payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
      ),
      completionTokens: Number(
        payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0,
      ),
    };
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (input.signal?.aborted) throw error;
    const name =
      error instanceof TransportError && error.kind === 'timeout'
        ? 'TimeoutError'
        : (error as Error)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `调用超时（${timeoutMs} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `调用失败：${(error as Error)?.message || '网络异常'}`,
    );
  } finally {
    recordModelCall(
      input.platform || 'unknown',
      Date.now() - startedAt,
      failed,
    );
  }
}

/** 多轮对话（RPA 参数填写、Workbuddy 任务书澄清）：默认 OpenAI 兼容 `chat/completions`，`api: 'anthropic'` 走 Messages API。 */
export async function geoChatMulti(
  input: GeoChatMultiInput,
): Promise<GeoChatResult> {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '接口地址为空');
  }
  const anthropic = input.api === 'anthropic';
  const timeoutMs = input.timeoutMs || 60000;
  const startedAt = Date.now();
  let failed = true;
  const url = anthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  const system = input.messages
    .filter((item) => item.role === 'system')
    .map((item) => messageText(item.content))
    .join('\n\n');
  const turns = anthropic
    ? input.messages.filter((item) => item.role !== 'system')
    : input.messages;
  const outbound = adaptMessages(turns, anthropic);
  try {
    const response = await httpRequest<string>(url, {
      method: 'POST',
      headers: anthropic
        ? {
            'Content-Type': 'application/json',
            'x-api-key': input.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.apiKey}`,
          },
      body: JSON.stringify(
        anthropic
          ? {
              model: input.model,
              ...(system ? { system } : {}),
              messages: outbound,
              max_tokens: input.maxTokens || 2000,
            }
          : {
              model: input.model,
              messages: outbound,
              max_tokens: input.maxTokens || 2000,
              stream: false,
            },
      ),
      timeoutMs,
      signal: input.signal,
      readAs: 'text',
      concurrency: 1,
      limiterKey: `model:${input.purpose || 'chat'}:${new URL(baseUrl).origin}${input.userId ? `:${input.userId}` : ''}`,
      operation: 'model:chat',
    });
    const text = response.data;
    let payload: ChatCompletionResponse = {};
    try {
      payload = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      // 非 JSON 响应（网关错误页等）按纯文本截断展示
    }
    if (!response.ok) {
      const detail = String(
        payload.error?.message ||
          payload.message ||
          text.replace(/\s+/g, ' ').trim().slice(0, 200) ||
          '无返回内容',
      )
        .replaceAll(input.apiKey, '[redacted]')
        .replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
        .slice(0, 200);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `平台返回 HTTP ${response.status}：${detail}`,
      );
    }
    failed = false;
    return {
      reply: anthropic
        ? extractAssistantText(payload)
        : String(payload.choices?.[0]?.message?.content ?? '').trim(),
      elapsedMs: Date.now() - startedAt,
      promptTokens: Number(
        payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
      ),
      completionTokens: Number(
        payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0,
      ),
    };
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (input.signal?.aborted) throw error;
    const name =
      error instanceof TransportError && error.kind === 'timeout'
        ? 'TimeoutError'
        : (error as Error)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `调用超时（${timeoutMs} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `调用失败：${(error as Error)?.message || '网络异常'}`,
    );
  } finally {
    recordModelCall(new URL(baseUrl).host, Date.now() - startedAt, failed);
  }
}

/** 流式对话（嵌入式副驾、技能运行输出）：OpenAI 兼容 SSE，逐块回调 + 末尾用量。 */
export async function geoChatStream(
  input: GeoChatMultiInput & {
    onDelta: (chunk: string) => void | Promise<void>;
  },
): Promise<GeoChatResult> {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '接口地址为空');
  }
  const anthropic = input.api === 'anthropic';
  const timeoutMs = input.timeoutMs || 120000;
  const startedAt = Date.now();
  let failed = true;
  const system = input.messages
    .filter((item) => item.role === 'system')
    .map((item) => messageText(item.content))
    .join('\n\n');
  const turns = anthropic
    ? input.messages.filter((item) => item.role !== 'system')
    : input.messages;
  const outbound = adaptMessages(turns, anthropic);
  let reply = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let stream: StreamResult | undefined;
  try {
    stream = await streamRequest(
      anthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          ...(anthropic
            ? {
                'x-api-key': input.apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
              }
            : { Authorization: `Bearer ${input.apiKey}` }),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(
          anthropic
            ? {
                model: input.model,
                ...(system ? { system } : {}),
                messages: outbound,
                max_tokens: input.maxTokens || 2000,
                stream: true,
              }
            : {
                model: input.model,
                messages: outbound,
                max_tokens: input.maxTokens || 2000,
                stream: true,
              },
        ),
        signal: input.signal,
        timeoutMs,
        concurrency: 1,
        limiterKey: `model:${input.purpose || 'chat'}:stream:${new URL(baseUrl).origin}${input.userId ? `:${input.userId}` : ''}`,
        operation: 'model:stream',
      },
    );
    if (!stream.response.ok) {
      const status = stream.response.status;
      stream.close();
      stream = undefined;
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `平台返回 HTTP ${status}：流式通道不可用`,
      );
    }
    await readSse(stream.response.body, (payload) => {
      const usage = (payload.usage || {}) as ChatCompletionResponse['usage'];
      promptTokens = Number(
        usage?.prompt_tokens ?? usage?.input_tokens ?? promptTokens,
      );
      completionTokens = Number(
        usage?.completion_tokens ?? usage?.output_tokens ?? completionTokens,
      );
      const delta = anthropic
        ? String((payload as { delta?: { text?: string } }).delta?.text ?? '')
        : String(
            (payload as ChatCompletionResponse).choices?.[0]?.delta?.content ??
              '',
          );
      if (!delta) return;
      reply += delta;
      void input.onDelta(delta);
    });
    failed = false;
    return {
      reply: reply.trim(),
      elapsedMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
    };
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (input.signal?.aborted) throw error;
    const name =
      error instanceof TransportError && error.kind === 'timeout'
        ? 'TimeoutError'
        : (error as Error)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `调用超时（${timeoutMs} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `调用失败：${(error as Error)?.message || '网络异常'}`,
    );
  } finally {
    stream?.close();
    recordModelCall(new URL(baseUrl).host, Date.now() - startedAt, failed);
  }
}

/** 取本次问答通道的渠道凭据（与 geoChatMulti 同一地址口径）。 */
export type ChatChannel = {
  baseUrl: string;
  apiKey: string;
  model: string;
  api?: 'openai' | 'anthropic';
};

/** OpenAI 兼容 embeddings：出参按 input 顺序；错误按本系统口径转 BusinessException。 */
export async function geoEmbed(
  channel: ChatChannel,
  input: string[],
  timeoutMs = 30000,
): Promise<{ vectors: number[][]; elapsedMs: number }> {
  const baseUrl = String(channel.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '接口地址为空');
  }
  const startedAt = Date.now();
  let failed = true;
  try {
    const response = await httpRequest<string>(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channel.apiKey}`,
      },
      body: JSON.stringify({ model: channel.model, input }),
      timeoutMs,
      readAs: 'text',
      concurrency: 1,
      limiterKey: `model:embed:${new URL(baseUrl).origin}`,
      operation: 'model:embed',
    });
    let payload: {
      data?: { embedding?: number[] }[];
      error?: { message?: string };
      message?: string;
    } = {};
    try {
      payload = JSON.parse(response.data) as typeof payload;
    } catch {
      // 非 JSON 响应按纯文本截断展示
    }
    if (!response.ok) {
      const detail = String(
        payload.error?.message ||
          payload.message ||
          response.data.replace(/\s+/g, ' ').trim().slice(0, 200) ||
          '无返回内容',
      )
        .replaceAll(channel.apiKey, '[redacted]')
        .slice(0, 200);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `平台返回 HTTP ${response.status}：${detail}`,
      );
    }
    const vectors = (payload.data || []).map((item) =>
      Array.isArray(item?.embedding) ? item.embedding : [],
    );
    if (!vectors.length || vectors.some((vector) => !vector.length)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '向量嵌入返回为空，请检查嵌入模型',
      );
    }
    failed = false;
    return { vectors, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    const name =
      error instanceof TransportError && error.kind === 'timeout'
        ? 'TimeoutError'
        : (error as Error)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `调用超时（${timeoutMs} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `调用失败：${(error as Error)?.message || '网络异常'}`,
    );
  } finally {
    recordModelCall(new URL(baseUrl).host, Date.now() - startedAt, failed);
  }
}
