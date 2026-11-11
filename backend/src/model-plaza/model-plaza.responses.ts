import { randomUUID } from 'node:crypto';
import { text } from '../common/api';

/**
 * OpenAI Responses 协议（`/v1/responses`，Codex 一类客户端只认它）与 Chat
 * Completions 的双向翻译层。
 *
 * 网关只对接上游的 `/chat/completions`，因此这里做三件事：请求体把 `input`
 * 摊平成 `messages`，响应体把 `choices` 包成 `output`，流式把 chat 的
 * `data:` 增量改写成 Responses 的 `response.*` 事件序列。计费与时长卡不受
 * 影响——账单仍按翻译后的 chat 口径结算。
 */

/** Responses 请求里没对上 chat 字段的部分，翻译后原样丢弃的键（避免上游严格校验报错）。 */
const CHAT_KEEP_KEYS = [
  'temperature',
  'top_p',
  'max_tokens',
  'n',
  'stop',
  'presence_penalty',
  'frequency_penalty',
  'response_format',
  'seed',
  'user',
];

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** `input` 的 content 可以是字符串，也可以是 `{type,text}` 片段数组，统一摊成纯文本。 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return text(content ?? '');
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const item = part as Record<string, unknown>;
      if (
        item.type === 'input_text' ||
        item.type === 'output_text' ||
        item.type === 'text'
      ) {
        return text(item.text ?? '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Responses 的 function 工具是平铺的，chat 的要多套一层 `function`。 */
function toChatTools(tools: unknown): unknown[] | null {
  if (!Array.isArray(tools)) return null;
  const mapped: unknown[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const item = tool as Record<string, unknown>;
    if (item.type === 'function' && !item.function) {
      mapped.push({
        type: 'function',
        function: {
          name: text(item.name),
          description: text(item.description),
          parameters: item.parameters ??
            item.input_schema ?? { type: 'object', properties: {} },
        },
      });
    } else {
      mapped.push(item);
    }
  }
  return mapped.length ? mapped : null;
}

function toolCallId(call: Record<string, unknown>, fallback: string): string {
  return text(call.call_id || call.id || fallback).trim() || fallback;
}

/**
 * Responses 请求 → Chat Completions 请求。
 *
 * `instructions` 落成首条 system；`input` 里的 message 项按 role 搬运，
 * function_call 还原成 assistant 的 tool_calls，function_call_output 还原成
 * role=tool 的消息，这样带工具的多轮（Codex 的 shell 调用）也能接上。
 */
export function toChatPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  const instructions = text(payload.instructions).trim();
  if (instructions) messages.push({ role: 'system', content: instructions });

  const input = payload.input ?? payload.messages;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const type = text(item.type).trim();
      if (type === 'function_call') {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: toolCallId(item, newId('call')),
              type: 'function',
              function: {
                name: text(item.name),
                arguments: text(item.arguments),
              },
            },
          ],
        });
        continue;
      }
      if (type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: text(item.call_id),
          content: contentText(item.output),
        });
        continue;
      }
      const role = text(item.role).trim() || 'user';
      // developer 是 Responses 侧的系统角色写法，chat 侧归到 system
      const chatRole = role === 'developer' ? 'system' : role;
      messages.push({ role: chatRole, content: contentText(item.content) });
    }
  }
  if (!messages.some((m) => m.role !== 'system')) {
    messages.push({ role: 'user', content: '' });
  }

  const chat: Record<string, unknown> = {
    model: text(payload.model),
    messages,
    stream: payload.stream === true,
  };
  for (const key of CHAT_KEEP_KEYS) {
    if (payload[key] !== undefined && payload[key] !== null)
      chat[key] = payload[key];
  }
  if (chat.max_tokens === undefined) {
    const maxOutput = Number(payload.max_output_tokens);
    if (Number.isFinite(maxOutput) && maxOutput > 0)
      chat.max_tokens = Math.floor(maxOutput);
  }
  const tools = toChatTools(payload.tools);
  if (tools) chat.tools = tools;
  if (payload.tool_choice !== undefined) chat.tool_choice = payload.tool_choice;
  return chat;
}

/** Chat 的 usage → Responses 的 usage（字段名不同，数值同源）。 */
function toResponsesUsage(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const usage = (parsed.usage as Record<string, unknown>) || {};
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  const details =
    (usage.prompt_tokens_details as Record<string, unknown>) || {};
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    input_tokens_details: { cached_tokens: Number(details.cached_tokens) || 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

/** Chat 响应 → Responses 响应：文本进 `output_text`，工具调用进 `function_call` 项。 */
export function toResponseObject(
  parsed: Record<string, unknown>,
  options: { model: string; id?: string; created?: number },
): Record<string, unknown> {
  const choices = Array.isArray(parsed.choices)
    ? (parsed.choices as Record<string, unknown>[])
    : [];
  const output: Record<string, unknown>[] = [];
  let textAll = '';
  for (const choice of choices) {
    const message = (choice.message as Record<string, unknown>) || {};
    const content = contentText(message.content);
    if (content) {
      textAll += content;
      output.push({
        id: newId('msg'),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      });
    }
    const calls = Array.isArray(message.tool_calls)
      ? (message.tool_calls as Record<string, unknown>[])
      : [];
    for (const call of calls) {
      const fn = (call.function as Record<string, unknown>) || {};
      output.push({
        id: newId('fc'),
        type: 'function_call',
        call_id: toolCallId(call, newId('call')),
        name: text(fn.name),
        arguments: text(fn.arguments),
        status: 'completed',
      });
    }
  }
  const finish = text(choices[0]?.finish_reason).trim();
  return {
    id: options.id || newId('resp'),
    object: 'response',
    created_at: options.created ?? Math.floor(Date.now() / 1000),
    status: finish === 'length' ? 'incomplete' : 'completed',
    error: null,
    incomplete_details:
      finish === 'length' ? { reason: 'max_output_tokens' } : null,
    model: options.model || text(parsed.model),
    output,
    output_text: textAll,
    usage: toResponsesUsage(parsed),
  };
}

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 流式翻译器：喂进 chat 的 SSE 文本，吐出 Responses 的 `response.*` 事件。
 *
 * 上游只在最后一个 data 帧回 usage，因此 `response.completed` 要等 [DONE]
 * 才能发出；调用方把结算用的 usage 传进 `end()` 即可，不必自己解析帧。
 */
export class ResponsesSseTranslator {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private readonly responseId: string;
  private readonly model: string;
  private readonly created: number;
  private textItemId = '';
  private text = '';
  private partOpened = false;
  private readonly calls = new Map<
    number,
    { id: string; name: string; arguments: string; itemIndex: number }
  >();
  private nextItemIndex = 0;
  private finished = false;

  constructor(model: string, responseId = newId('resp')) {
    this.model = model;
    this.responseId = responseId;
    this.created = Math.floor(Date.now() / 1000);
  }

  /** 首帧：`response.created` + 一个空的 response 快照。 */
  start(): string {
    return sse('response.created', {
      type: 'response.created',
      response: this.snapshot({ status: 'in_progress', output: [] }),
    });
  }

  /**
   * 转发一段上游 SSE 文本，返回需要下发给客户端的事件。
   *
   * 上游的 reasoning 增量按 Responses 语义没有对应事件，但 Node 的流控只在
   * 「这次 pull 有入队」时才会继续 pump——空返回会让整条流卡死，所以这里补一条
   * SSE 注释行（客户端按协议忽略）当作心跳，保证读取持续推进。
   */
  feed(chunk: Uint8Array): string {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let out = '';
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      out += this.onChunk(data);
    }
    return out || ': ping\n\n';
  }

  /** 收尾：闭合文本分片与工具调用项，再发 `response.completed`（或失败事件）。 */
  end(
    options: {
      usage?: Record<string, unknown>;
      failed?: string;
    } = {},
  ): string {
    if (this.finished) return '';
    this.finished = true;
    let out = '';
    if (options.failed) {
      return (
        sse('response.failed', {
          type: 'response.failed',
          response: {
            ...this.snapshot({ status: 'failed', output: this.outputItems() }),
            error: { message: options.failed },
          },
        }) + `data: [DONE]\n\n`
      );
    }
    if (this.partOpened) {
      out += sse('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: this.textItemId,
        output_index: 0,
        content_index: 0,
        text: this.text,
      });
      out += sse('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: this.textItemId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: this.text, annotations: [] },
      });
      out += sse('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: this.textItemId,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: this.text, annotations: [] }],
        },
      });
    }
    for (const call of this.calls.values()) {
      out += sse('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        item_id: call.id,
        output_index: call.itemIndex,
        arguments: call.arguments,
      });
      out += sse('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: call.itemIndex,
        item: {
          id: call.id,
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: 'completed',
        },
      });
    }
    out += sse('response.completed', {
      type: 'response.completed',
      response: this.snapshot({
        status: 'completed',
        output: this.outputItems(),
        usage: this.usageOf(options.usage),
      }),
    });
    out += `data: [DONE]\n\n`;
    return out;
  }

  private usageOf(usage?: Record<string, unknown>): Record<string, unknown> {
    const input = Number(usage?.prompt_tokens) || 0;
    const output = Number(usage?.completion_tokens) || 0;
    return {
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
    };
  }

  private outputItems(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];
    if (this.partOpened) {
      items.push({
        id: this.textItemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: this.text, annotations: [] }],
      });
    }
    for (const call of this.calls.values()) {
      items.push({
        id: call.id,
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
        status: 'completed',
      });
    }
    return items;
  }

  private snapshot(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.created,
      model: this.model,
      output: [],
      ...over,
    };
  }

  private openText(): string {
    if (this.partOpened) return '';
    this.partOpened = true;
    this.textItemId = newId('msg');
    const itemIndex = this.nextItemIndex;
    this.nextItemIndex += 1;
    return (
      sse('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: itemIndex,
        item: {
          id: this.textItemId,
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      }) +
      sse('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: this.textItemId,
        output_index: itemIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      })
    );
  }

  private onChunk(data: string): string {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return '';
    }
    const choice = Array.isArray(json.choices)
      ? (json.choices[0] as Record<string, unknown>)
      : undefined;
    const delta = (choice?.delta as Record<string, unknown>) || {};
    let out = '';

    const content = typeof delta.content === 'string' ? delta.content : '';
    if (content) {
      out += this.openText();
      this.text += content;
      out += sse('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: this.textItemId,
        output_index: 0,
        content_index: 0,
        delta: content,
      });
    }

    const calls = Array.isArray(delta.tool_calls)
      ? (delta.tool_calls as Record<string, unknown>[])
      : [];
    for (const raw of calls) {
      const slot = Number(raw.index) || 0;
      const fn = (raw.function as Record<string, unknown>) || {};
      let call = this.calls.get(slot);
      if (!call) {
        const id = toolCallId(raw, newId('call'));
        const itemIndex = this.nextItemIndex;
        this.nextItemIndex += 1;
        out += sse('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: itemIndex,
          item: {
            id,
            type: 'function_call',
            call_id: id,
            name: text(fn.name),
            arguments: '',
            status: 'in_progress',
          },
        });
        call = { id, name: text(fn.name), arguments: '', itemIndex };
        this.calls.set(slot, call);
      }
      if (fn.name && !call.name) call.name = text(fn.name);
      const piece = text(fn.arguments ?? '');
      if (piece) {
        call.arguments += piece;
        out += sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: call.id,
          output_index: call.itemIndex,
          delta: piece,
        });
      }
    }
    return out;
  }
}
