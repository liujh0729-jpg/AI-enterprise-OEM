import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { streamRequest, TransportError } from '../http/transport';
import { ContentModelSettingService } from './model-setting.service';
import { protocolHeaders } from './model-catalog.service';
import type { ModelOverrides } from './content-media.service';
import type { ConnectorToolSpec } from './agent-connectors.service';
import {
  type AgentReference,
  type AgentToolContext,
  AGENT_TOOLS,
  runAgentTool,
} from './agent-tools';

const MAX_TOOL_ROUNDS = 8;
const HISTORY_LIMIT = 30;
const MAX_TOKENS = 4000;
/** 长工具（出图/出片）轮询期间每 10 秒报一次进度，避免 SSE 长时间零字节被中间层掐断 */
const TOOL_PROGRESS_MS = 10_000;

const TOOL_PROGRESS_LABEL: Record<string, string> = {
  generate_image: '图片生成',
  generate_video: '视频生成',
  generate_music: '音乐生成',
  transcribe_audio: '语音识别',
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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

type ToolCallDraft = {
  id: string;
  name: string;
  arguments: string;
};

export type EngineEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; name: string; args: string }
  | { type: 'tool_progress'; name: string; text: string; waitedSeconds: number }
  | {
      type: 'tool_end';
      name: string;
      ok: boolean;
      text: string;
      media?: { kind: string; url: string }[];
    }
  | { type: 'notice'; text: string };

export type EngineResult = {
  text: string;
  toolEvents: { name: string; args: string; ok: boolean; text: string }[];
  media: { kind: string; url: string; assetId?: string }[];
};

type Emit = (event: EngineEvent) => Promise<void>;

type RunInput = {
  user: CurrentUser;
  token: string | undefined;
  /** 本轮选的渠道（模型设置里的 channelId；0＝AIPDD 内置） */
  channelId?: number;
  model?: string;
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 本轮参考素材（@ 选中的图片/音频/视频），只在这一轮有效，不落进历史 */
  references?: AgentReference[];
  /** MCP 连接器发布给模型调用的工具（名字带 mcp__c<id>__ 前缀） */
  connectorTools?: ConnectorToolSpec[];
  /** 文本 / 图片 / 视频：图片与视频模式会让模型直接调用生成工具 */
  mode?: 'text' | 'image' | 'video';
  /** 图片模式下本轮选的图片模型（没传就用「模型设置 → 图像」槽位） */
  imageChannelId?: number;
  imageModel?: string;
  /** 视频模式下本轮选的视频模型（没传就用「模型设置 → 视频」槽位） */
  videoChannelId?: number;
  videoModel?: string;
  /** 视频模式勾了超清时的目标分辨率（1080p / 2k / 4k） */
  videoUpscaleResolution?: string;
  imageSize?: string;
  videoResolution?: string;
  videoDuration?: number;
  /** 本轮在「+」里勾选的资料：资料检索与精读都只在这个范围内 */
  libraryIds?: number[];
  signal: AbortSignal;
  emit: Emit;
};

const MODE_RULES: Record<'image' | 'video', string> = {
  image:
    '本轮用户选择的是「图片」模式：请直接调用 generate_image 产出图片，把相关参考素材填进 reference_labels；不要只用文字描述代替出图。',
  video:
    '本轮用户选择的是「视频」模式：请直接调用 generate_video 产出视频，把相关参考素材（图片/视频/音频）填进 reference_labels；不要只用文字描述代替出片。',
};

/** 把参考素材以文字清单附在这一轮的用户消息后面（和附件项目同口径）。 */
function withReferences(content: string, references: AgentReference[]) {
  if (!references.length) return content;
  const labels = { image: '图片', video: '视频', audio: '音频' } as const;
  const lines = references.map(
    (item) =>
      `- ${labels[item.media]}「${item.label}」（${item.fileName}）：${item.url}`,
  );
  return [
    content,
    '',
    '[本回合参考素材]（用户在输入框用 @ 选中的文件；调用生成工具时把对应名字填进 reference_labels，才能真的用到它们）',
    ...lines,
  ].join('\n');
}

/** 逐行解析 SSE（OpenAI 与 Anthropic 都是 `data: {json}` 行），遇到 [DONE] 结束。 */
async function readSse(
  body: ReadableStream<Uint8Array> | null,
  onChunk: (payload: Record<string, unknown>) => void,
) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          onChunk(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // 单块坏数据不打断整轮
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 内置工具 + 本轮连接器发布的远程工具；远程名字已带前缀，不会与内置重名。 */
function openAiTools(connectorTools: ConnectorToolSpec[]) {
  return [
    ...AGENT_TOOLS,
    ...connectorTools.map((spec) => ({
      type: 'function' as const,
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema,
      },
    })),
  ];
}

function anthropicTools(connectorTools: ConnectorToolSpec[]) {
  return [
    ...AGENT_TOOLS.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    })),
    ...connectorTools.map((spec) => ({
      name: spec.name,
      description: spec.description,
      input_schema: spec.inputSchema,
    })),
  ];
}

function parseArgs(raw: string) {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 同一句口径：无论是工具中途被断，还是断在工具之间，都按「用户停止」收尾。 */
function canceledError() {
  return new BusinessException(ErrorCode.BAD_REQUEST, '对话已取消');
}

/**
 * Agent 对话循环（照附件的语义重写）：最多 8 轮工具调用、重放最近 30 条历史，
 * 逐字返回模型输出，工具调用与媒体卡通过事件流给界面。
 * 模型与凭据来自「模型设置 → 文本」槽位，Key 只在服务端使用。
 * 渠道协议：OpenAI 兼容（/chat/completions）或 Anthropic 原生（/messages）。
 */
export class ContentAgentEngine {
  constructor(
    private readonly settings: ContentModelSettingService,
    private readonly tools: AgentToolContext,
  ) {}

  /** 本轮生成模型的渠道：前端带了就用；没带回落到该类型的默认槽位渠道。 */
  private async channelOf(
    user: CurrentUser,
    mediaType: 'image' | 'video',
    channelId?: number,
  ) {
    if (Number.isInteger(channelId) && (channelId as number) >= 0) {
      return channelId as number;
    }
    const slot = await this.settings.slotOf(user, mediaType);
    return slot?.channelId ?? 0;
  }

  async run(input: RunInput): Promise<EngineResult> {
    // 前端先选渠道再选模型：本轮可以覆盖「模型设置 → 文本」的默认槽位；
    // 没传渠道就沿用槽位，模型没传且渠道与槽位一致才拿槽位默认模型。
    const slot = await this.settings.slotOf(input.user, 'text');
    const slotChannel = slot?.channelId ?? 0;
    const channelId =
      Number.isInteger(input.channelId) && (input.channelId as number) >= 0
        ? (input.channelId as number)
        : slotChannel;
    const model =
      String(input.model || '').trim() ||
      (channelId === slotChannel ? slot?.model || '' : '');
    if (!model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择要用的模型（渠道 + 模型）',
      );
    }
    const target0 = await this.settings.channelCredentials(
      input.user,
      channelId,
      input.token,
      'text',
    );
    const base = String(target0.baseUrl || '').replace(/\/+$/, '');
    // 图片/视频模式：把本轮选的生成模型带进工具；渠道没带就取对应类型的槽位渠道
    const generationModels: ModelOverrides = {};
    const imageModel = String(input.imageModel || '').trim();
    if (imageModel) {
      generationModels.image = {
        channelId: await this.channelOf(
          input.user,
          'image',
          input.imageChannelId,
        ),
        model: imageModel,
      };
    }
    const videoModel = String(input.videoModel || '').trim();
    if (videoModel) {
      generationModels.video = {
        channelId: await this.channelOf(
          input.user,
          'video',
          input.videoChannelId,
        ),
        model: videoModel,
      };
    }
    const references = input.references || [];
    const history = input.history
      .slice(-HISTORY_LIMIT)
      .filter((item) => item.content.trim());
    // 参考清单与模式参数只作用于这一轮：附在最后一条用户消息 / 系统提示上
    const last = history.length - 1;
    if (last >= 0 && history[last].role === 'user') {
      history[last] = {
        ...history[last],
        content: withReferences(history[last].content, references),
      };
    }
    const modeRules: string[] = [];
    if (input.mode === 'image' || input.mode === 'video') {
      modeRules.push(MODE_RULES[input.mode]);
    }
    if (input.mode === 'image' && input.imageSize) {
      modeRules.push(
        `图片尺寸用 ${input.imageSize}（传给 generate_image 的 size）。`,
      );
    }
    if (input.mode === 'video') {
      if (input.videoResolution) {
        modeRules.push(`视频分辨率用 ${input.videoResolution}。`);
      }
      if (input.videoDuration) {
        modeRules.push(`视频时长用 ${input.videoDuration} 秒。`);
      }
      if (input.videoUpscaleResolution) {
        modeRules.push(
          `出片后会自动超清到 ${input.videoUpscaleResolution}，不用在 generate_video 参数里传这个值。`,
        );
      }
    }
    const target: RunTarget = {
      user: input.user,
      token: input.token,
      base,
      apiKey: target0.apiKey,
      model,
      protocol: target0.protocol,
      libraryIds: input.libraryIds,
      system: modeRules.length
        ? `${input.system}\n\n【本回合模式】\n${modeRules.join('\n')}`
        : input.system,
      history,
      references,
      connectorTools: input.connectorTools || [],
      models: generationModels,
      videoUpscaleResolution: input.videoUpscaleResolution,
      imageSize: input.imageSize,
      videoResolution: input.videoResolution,
      videoDuration: input.videoDuration,
      signal: input.signal,
      emit: input.emit,
    };
    return target0.protocol === 'anthropic'
      ? this.runAnthropic(target)
      : this.runOpenAi(target);
  }

  private async runOpenAi(target: RunTarget): Promise<EngineResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: target.system },
      ...target.history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
    ];
    const toolEvents: EngineResult['toolEvents'] = [];
    const media: EngineResult['media'] = [];
    let answer = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const stream = await this.openStream(
        `${target.base}/chat/completions`,
        'openai',
        target.apiKey,
        {
          model: target.model,
          messages,
          tools: openAiTools(target.connectorTools),
          tool_choice: 'auto',
          stream: true,
          max_tokens: MAX_TOKENS,
        },
        target.signal,
      );
      let roundText = '';
      const drafts = new Map<number, ToolCallDraft>();
      await readSse(stream.response.body, (payload) => {
        const choices = payload.choices;
        const choice = Array.isArray(choices)
          ? (choices[0] as Record<string, unknown>)
          : undefined;
        const delta = (choice?.delta || {}) as Record<string, unknown>;
        const text = typeof delta.content === 'string' ? delta.content : '';
        if (text) {
          roundText += text;
          void target.emit({ type: 'delta', text });
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
      if (!calls.length) {
        answer += roundText;
        return { text: answer.trim(), toolEvents, media };
      }
      if (roundText) answer += roundText;
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
          target,
          call.name,
          call.arguments,
          toolEvents,
          media,
        );
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: result.text,
        });
      }
    }
    await target.emit({
      type: 'notice',
      text: '这一轮工具调用已经达到上限，先把已有的结果给你',
    });
    return { text: answer.trim(), toolEvents, media };
  }

  private async runAnthropic(target: RunTarget): Promise<EngineResult> {
    const messages: AnthropicMessage[] = target.history.map((item) => ({
      role: item.role,
      content: [{ type: 'text', text: item.content }],
    }));
    // Anthropic 要求首条是 user：历史里以助手结尾的轮次先裁掉
    while (messages.length && messages[0].role !== 'user') messages.shift();
    const toolEvents: EngineResult['toolEvents'] = [];
    const media: EngineResult['media'] = [];
    let answer = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const stream = await this.openStream(
        `${target.base}/messages`,
        'anthropic',
        target.apiKey,
        {
          model: target.model,
          max_tokens: MAX_TOKENS,
          system: target.system,
          messages,
          tools: anthropicTools(target.connectorTools),
          stream: true,
        },
        target.signal,
      );
      let roundText = '';
      const assistantBlocks: AnthropicBlock[] = [];
      const drafts: ToolCallDraft[] = [];
      let pending: ToolCallDraft | null = null;
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
              void target.emit({ type: 'delta', text });
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
      if (roundText) assistantBlocks.push({ type: 'text', text: roundText });
      for (const call of drafts) {
        if (!call.name) continue;
        assistantBlocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArgs(call.arguments),
        });
      }
      if (roundText) answer += roundText;
      if (!drafts.length) {
        return { text: answer.trim(), toolEvents, media };
      }
      messages.push({ role: 'assistant', content: assistantBlocks });
      const results: AnthropicBlock[] = [];
      for (const call of drafts) {
        if (!call.name) continue;
        const result = await this.executeTool(
          target,
          call.name,
          call.arguments,
          toolEvents,
          media,
        );
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.text,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    await target.emit({
      type: 'notice',
      text: '这一轮工具调用已经达到上限，先把已有的结果给你',
    });
    return { text: answer.trim(), toolEvents, media };
  }

  private async executeTool(
    target: RunTarget,
    name: string,
    argsJson: string,
    toolEvents: EngineResult['toolEvents'],
    media: EngineResult['media'],
  ) {
    // 已点「停止」就不再起新的工具：runAgentTool 会把中断包成普通失败结果，
    // 不放行的话循环会接着调下一个工具，多跑一轮、多出一条「工具执行失败」。
    if (target.signal.aborted) throw canceledError();
    await target.emit({ type: 'tool_start', name, args: argsJson || '{}' });
    // 出图/出片要轮询几分钟，中间一个事件都没有，连接会被 Next dev 代理（30 秒）、
    // 反向代理和前端 90 秒空闲看门狗掐掉，界面上就表现成「失败」。这里定时报进度。
    const progressLabel = TOOL_PROGRESS_LABEL[name] || '这一步';
    let waitedSeconds = 0;
    const progress = setInterval(() => {
      waitedSeconds += TOOL_PROGRESS_MS / 1000;
      void target
        .emit({
          type: 'tool_progress',
          name,
          text: `${progressLabel}进行中，已等待 ${waitedSeconds} 秒`,
          waitedSeconds,
        })
        .catch(() => undefined);
    }, TOOL_PROGRESS_MS);
    let result: Awaited<ReturnType<typeof runAgentTool>>;
    try {
      result = await runAgentTool(name, parseArgs(argsJson), this.tools, {
        user: target.user,
        token: target.token,
        references: target.references,
        models: target.models,
        videoUpscaleResolution: target.videoUpscaleResolution,
        imageSize: target.imageSize,
        videoResolution: target.videoResolution,
        videoDuration: target.videoDuration,
        libraryIds: target.libraryIds,
        llm: {
          base: target.base,
          apiKey: target.apiKey,
          model: target.model,
          protocol: target.protocol,
        },
      });
    } finally {
      clearInterval(progress);
    }
    if (target.signal.aborted) throw canceledError();
    const ok = !result.text.startsWith('工具执行失败');
    toolEvents.push({ name, args: argsJson || '{}', ok, text: result.text });
    if (result.media?.length) {
      media.push(...result.media.map((item) => ({ ...item })));
    }
    await target.emit({
      type: 'tool_end',
      name,
      ok,
      text: result.text,
      media: result.media,
    });
    return result;
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
        timeoutMs: 120_000,
        operation: 'content:agentStream',
      });
      if (!stream.response.ok) {
        stream.close();
        // 上游鉴权失败不能回 401：前端见到 401 会把已登录用户踢出会话
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
}

type RunTarget = {
  user: CurrentUser;
  token: string | undefined;
  base: string;
  apiKey: string;
  model: string;
  /** 本轮渠道协议：资料检索重排也用同一个渠道/模型 */
  protocol: 'openai' | 'anthropic';
  /** 本轮勾选的资料（只在这几篇里检索） */
  libraryIds?: number[];
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  references: AgentReference[];
  connectorTools: ConnectorToolSpec[];
  /** 图片/视频模式本轮选的生成模型 */
  models: ModelOverrides;
  /** 视频模式勾了超清时的目标分辨率 */
  videoUpscaleResolution?: string;
  /** 本轮输入区选的图片像素 / 视频分辨率与时长（档位来自所选模型声明的能力） */
  imageSize?: string;
  videoResolution?: string;
  videoDuration?: number;
  signal: AbortSignal;
  emit: Emit;
};
