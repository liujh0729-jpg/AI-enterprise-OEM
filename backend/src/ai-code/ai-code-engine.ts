import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { readSse, streamRequest, TransportError } from '../http/transport';
import { protocolHeaders } from '../content/model-catalog.service';
import type { AiCodeToolCall } from '@enterprise/contracts';
import {
  AI_CODE_TOOLS,
  runAiCodeTool,
  type AiCodeToolContext,
} from './ai-code-tools';

/**
 * AI 编程对话循环：只挂「代码工具」，最多 10 轮；输出逐字回给 SSE 界面。
 * 模型没有任何 shell 能力，写操作全部落在暂存区（由 AiCodeStaging 收口）。
 */

const MAX_ROUNDS = 10;
const MAX_TOKENS = 8000;
const TOOL_PROGRESS_MS = 10_000;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 纯文本，或多模态内容块（含图片时的 user 消息） */
  content: string | Record<string, unknown>[];
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};

type AnthropicBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
};

export type AiCodeEngineEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; name: string; args: string }
  | { type: 'tool_progress'; name: string; text: string; waitedSeconds: number }
  | { type: 'tool_end'; name: string; ok: boolean; text: string }
  | { type: 'notice'; text: string };

export type AiCodeEngineInput = {
  model: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  system: string;
  /** 已落库的历史（含本轮用户消息），按时间正序 */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 本轮附件：图片以 base64 直接发给视觉模型；文本类直接内联 */
  images: { mime: string; dataUrl: string }[];
  toolContext: AiCodeToolContext;
  signal: AbortSignal;
  emit: (event: AiCodeEngineEvent) => Promise<void>;
};

export type AiCodeEngineResult = {
  text: string;
  toolCalls: AiCodeToolCall[];
};

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function canceledError() {
  return new BusinessException(ErrorCode.BAD_REQUEST, '对话已取消');
}

export class AiCodeEngine {
  async run(input: AiCodeEngineInput): Promise<AiCodeEngineResult> {
    return input.protocol === 'anthropic'
      ? this.runAnthropic(input)
      : this.runOpenAi(input);
  }

  private async openStream(
    url: string,
    protocol: 'openai' | 'anthropic',
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    try {
      const stream = await streamRequest(url, {
        method: 'POST',
        headers: {
          ...protocolHeaders(apiKey, protocol),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
        timeoutMs: 300_000,
        operation: 'admin:aiCodeChat',
      });
      if (!stream.response.ok) {
        stream.close();
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `模型通道拒绝了这次对话（HTTP ${stream.response.status}）`,
        );
      }
      return stream;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      if (error instanceof TransportError && error.kind === 'cancelled') {
        throw canceledError();
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '模型通道不可达，请稍后重试',
      );
    }
  }

  private async runOpenAi(
    input: AiCodeEngineInput,
  ): Promise<AiCodeEngineResult> {
    const messages = this.openAiMessages(input);
    const base = input.baseUrl.replace(/\/+$/, '');
    const toolCalls: AiCodeToolCall[] = [];
    let answer = '';

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const stream = await this.openStream(
        `${base}/chat/completions`,
        'openai',
        input.apiKey,
        {
          model: input.model,
          messages,
          tools: AI_CODE_TOOLS,
          tool_choice: 'auto',
          stream: true,
          max_tokens: MAX_TOKENS,
        },
        input.signal,
      );
      let roundText = '';
      const drafts = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      await readSse(stream.response.body, (payload) => {
        const choices = payload.choices;
        const choice = Array.isArray(choices)
          ? (choices[0] as Record<string, unknown>)
          : undefined;
        const delta = (choice?.delta || {}) as Record<string, unknown>;
        const text = typeof delta.content === 'string' ? delta.content : '';
        if (text) {
          roundText += text;
          void input.emit({ type: 'delta', text });
        }
        const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        for (const raw of calls) {
          const call = raw as Record<string, unknown>;
          const index = Number(call.index ?? 0);
          const draft = drafts.get(index) || {
            id: '',
            name: '',
            arguments: '',
          };
          if (typeof call.id === 'string' && call.id) draft.id = call.id;
          const fn = (call.function || {}) as Record<string, unknown>;
          if (typeof fn.name === 'string' && fn.name) draft.name = fn.name;
          if (typeof fn.arguments === 'string') draft.arguments += fn.arguments;
          drafts.set(index, draft);
        }
      });
      stream.close();

      const calls = Array.from(drafts.values()).filter((item) => item.name);
      if (roundText) answer += roundText;
      if (!calls.length) return { text: answer.trim(), toolCalls };

      messages.push({
        role: 'assistant',
        content: roundText,
        tool_calls: calls.map((call, index) => ({
          id: call.id || `call_${round}_${index}`,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments || '{}' },
        })),
      });
      for (const [index, call] of calls.entries()) {
        const callId = call.id || `call_${round}_${index}`;
        const result = await this.executeTool(
          input,
          call.name,
          call.arguments,
          toolCalls,
        );
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: result.text,
        });
      }
    }
    await input.emit({
      type: 'notice',
      text: '这一轮工具调用已达上限，先把已有结果给你；需要的话请再发一条消息继续。',
    });
    return { text: answer.trim(), toolCalls };
  }

  /** 构造首轮 OpenAI 消息（最后一条用户消息支持多模态图片）。 */
  private openAiMessages(input: AiCodeEngineInput): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: input.system }];
    input.history.forEach((item, index) => {
      const isLast = index === input.history.length - 1 && item.role === 'user';
      if (!isLast || !input.images.length) {
        messages.push({ role: item.role, content: item.content });
        return;
      }
      const parts: Record<string, unknown>[] = [
        { type: 'text', text: item.content },
      ];
      for (const image of input.images) {
        parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
      }
      messages.push({ role: 'user', content: parts });
    });
    return messages;
  }

  private async runAnthropic(
    input: AiCodeEngineInput,
  ): Promise<AiCodeEngineResult> {
    const messages: AnthropicMessage[] = [];
    input.history.forEach((item, index) => {
      const isLast = index === input.history.length - 1 && item.role === 'user';
      const blocks: AnthropicBlock[] = [];
      if (isLast) {
        for (const image of input.images) {
          const match = /^data:([^;]+);base64,(.*)$/.exec(image.dataUrl);
          if (match) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            });
          }
        }
      }
      blocks.push({ type: 'text', text: item.content });
      messages.push({ role: item.role, content: blocks });
    });
    while (messages.length && messages[0].role !== 'user') messages.shift();

    const base = input.baseUrl.replace(/\/+$/, '');
    const toolCalls: AiCodeToolCall[] = [];
    let answer = '';

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const stream = await this.openStream(
        `${base}/messages`,
        'anthropic',
        input.apiKey,
        {
          model: input.model,
          max_tokens: MAX_TOKENS,
          system: input.system,
          messages,
          tools: AI_CODE_TOOLS.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters,
          })),
          stream: true,
        },
        input.signal,
      );
      let roundText = '';
      const blocks: AnthropicBlock[] = [];
      const drafts: { id: string; name: string; arguments: string }[] = [];
      let pending: { id: string; name: string; arguments: string } | null =
        null;
      let upstreamError = '';
      await readSse(stream.response.body, (payload) => {
        const type = readText(payload.type);
        if (type === 'content_block_start') {
          const block = (payload.content_block || {}) as Record<
            string,
            unknown
          >;
          if (block.type === 'tool_use') {
            pending = {
              id: readText(block.id),
              name: readText(block.name),
              arguments: '',
            };
          }
        } else if (type === 'content_block_delta') {
          const delta = (payload.delta || {}) as Record<string, unknown>;
          if (delta.type === 'text_delta') {
            const text = readText(delta.text);
            if (text) {
              roundText += text;
              void input.emit({ type: 'delta', text });
            }
          } else if (delta.type === 'input_json_delta' && pending) {
            pending.arguments += readText(delta.partial_json);
          }
        } else if (type === 'content_block_stop') {
          if (pending) {
            drafts.push(pending);
            pending = null;
          }
        } else if (type === 'error') {
          const error = (payload.error || {}) as Record<string, unknown>;
          upstreamError = readText(error.message, '模型通道中断了这次对话');
        }
      });
      stream.close();
      if (upstreamError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          upstreamError,
        );
      }
      if (roundText) answer += roundText;
      const usable = drafts.filter((item) => item.name);
      if (!usable.length) return { text: answer.trim(), toolCalls };
      if (roundText) blocks.push({ type: 'text', text: roundText });
      for (const call of usable) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArgs(call.arguments),
        });
      }
      messages.push({ role: 'assistant', content: blocks });
      const results: AnthropicBlock[] = [];
      for (const call of usable) {
        const result = await this.executeTool(
          input,
          call.name,
          call.arguments,
          toolCalls,
        );
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.text,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    await input.emit({
      type: 'notice',
      text: '这一轮工具调用已达上限，先把已有结果给你；需要的话请再发一条消息继续。',
    });
    return { text: answer.trim(), toolCalls };
  }

  private async executeTool(
    input: AiCodeEngineInput,
    name: string,
    argsJson: string,
    toolCalls: AiCodeToolCall[],
  ) {
    if (input.signal.aborted) throw canceledError();
    await input.emit({ type: 'tool_start', name, args: argsJson || '{}' });
    const startedAt = new Date().toISOString();
    let waitedSeconds = 0;
    const progress = setInterval(() => {
      waitedSeconds += TOOL_PROGRESS_MS / 1000;
      void input
        .emit({
          type: 'tool_progress',
          name,
          text: `${name} 执行中，已等待 ${waitedSeconds} 秒`,
          waitedSeconds,
        })
        .catch(() => undefined);
    }, TOOL_PROGRESS_MS);
    let result: Awaited<ReturnType<typeof runAiCodeTool>>;
    try {
      result = await runAiCodeTool(
        name,
        parseArgs(argsJson),
        input.toolContext,
      );
    } finally {
      clearInterval(progress);
    }
    const ok = !result.text.startsWith('工具调用失败');
    toolCalls.push({
      name,
      input: parseArgs(argsJson),
      output: result.text.slice(0, 4000),
      status: ok ? 'success' : 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    await input.emit({ type: 'tool_end', name, ok, text: result.text });
    return result;
  }
}
