import { httpRequest, TransportError } from '../http/transport';
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
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
};
export type GeoChatResult = {
  reply: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
};
type ChatCompletionResponse = {
  choices?: {
    message?: {
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
        ? (payload.content || [])
            .map((block) => String(block?.text || ''))
            .join('')
            .trim()
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

/** 多轮对话（RPA 参数填写、Workbuddy 任务书澄清）：OpenAI 兼容 `chat/completions`。 */
export async function geoChatMulti(
  input: GeoChatMultiInput,
): Promise<GeoChatResult> {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '接口地址为空');
  }
  const timeoutMs = input.timeoutMs || 60000;
  const startedAt = Date.now();
  let failed = true;
  try {
    const response = await httpRequest<string>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens || 2000,
        stream: false,
      }),
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
      reply: String(payload.choices?.[0]?.message?.content ?? '').trim(),
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
