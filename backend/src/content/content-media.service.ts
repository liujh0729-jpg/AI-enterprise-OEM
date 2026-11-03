import type { ContentMediaType } from '@enterprise/contracts';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { httpRequest, TransportError } from '../http/transport';
import { ContentAssetService } from './asset-registry.service';
import { AipddAssetClient } from './aipdd-asset.client';
import { ContentModelSettingService } from './model-setting.service';
import { protocolHeaders } from './model-catalog.service';
import { MediaKitClient } from './mediakit.client';
import { OpenspeechClient } from './openspeech.client';

const SUBMIT_TIMEOUT_MS = 120_000;
const IMAGE_POLL_INTERVAL_MS = 3_000;
const IMAGE_MAX_POLLS = 100;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_MAX_POLLS = 120;

const FAILURE_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
]);
const DONE_STATUSES = new Set(['completed', 'succeeded', 'success', 'done']);

/** 本轮用户选的模型（先选渠道再选模型）；没传就用「模型设置」的默认槽位。 */
export type ModelOverride = { channelId: number; model: string };
export type ModelOverrides = Partial<Record<ContentMediaType, ModelOverride>>;

type GatewaySlot = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: 'openai' | 'anthropic';
};

function isAnthropic(slot: GatewaySlot) {
  return slot.protocol === 'anthropic';
}

/** Anthropic /messages 回的是 content 块数组，文本拼起来才是答案。 */
function anthropicText(node: Record<string, unknown>) {
  const blocks = Array.isArray(node.content) ? node.content : [];
  return blocks
    .map((block) =>
      block &&
      typeof block === 'object' &&
      (block as Record<string, unknown>).type === 'text'
        ? readText((block as Record<string, unknown>).text)
        : '',
    )
    .join('')
    .trim();
}

function unwrap(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : record;
}

function statusOf(task: Record<string, unknown>) {
  return readText(task.status).toLowerCase();
}

function errorOf(task: Record<string, unknown>) {
  const error = task.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  const message = task.message;
  return typeof message === 'string' ? message : '';
}

function urlOf(task: Record<string, unknown>) {
  for (const key of ['result_url', 'content_url', 'url', 'video_url']) {
    const value = task[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const metadata = task.metadata;
  if (metadata && typeof metadata === 'object') {
    for (const key of ['url', 'video_url']) {
      const value = (metadata as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

/** 上游的校验类报错（如「MiniMax H3 分辨率无效」）单独取出来，别让界面只剩下一个 HTTP 状态码。 */
function upstreamReason(body: string) {
  try {
    const parsed = JSON.parse(String(body || '')) as Record<string, unknown>;
    const error = parsed.error;
    const message =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>).message
        : undefined;
    const value =
      typeof message === 'string'
        ? message
        : typeof parsed.message === 'string'
          ? parsed.message
          : '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, 120);
  } catch {
    return '';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 内容创作与 Agent 的媒体生成：全部走模型网关（AIPDD 内置或自定义 OpenAI 兼容渠道），
 * 成功后自动把结果登记进 AIPDD 数字资产（登记失败只告警，不影响出片）。
 */
export class ContentMediaService {
  constructor(
    private readonly settings: ContentModelSettingService,
    private readonly assets: ContentAssetService,
    private readonly client: AipddAssetClient,
  ) {}

  private baseOf(slot: GatewaySlot) {
    return String(slot.baseUrl || '').replace(/\/+$/, '');
  }

  private authHeaders(slot: GatewaySlot) {
    return {
      ...protocolHeaders(
        slot.apiKey,
        isAnthropic(slot) ? 'anthropic' : 'openai',
      ),
      'Content-Type': 'application/json',
    };
  }

  private async post(
    url: string,
    slot: GatewaySlot,
    body: Record<string, unknown>,
    operation: string,
  ) {
    try {
      const response = await httpRequest<string>(url, {
        method: 'POST',
        headers: this.authHeaders(slot),
        body: JSON.stringify(body),
        timeoutMs: SUBMIT_TIMEOUT_MS,
        readAs: 'text',
        operation,
      });
      if (!response.ok) {
        const reason = upstreamReason(response.data);
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `模型通道拒绝了这次生成（HTTP ${response.status}）${reason ? `：${reason}` : ''}`,
        );
      }
      try {
        return JSON.parse(response.data) as unknown;
      } catch {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '模型通道返回的不是合法 JSON',
        );
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      if (error instanceof TransportError && error.kind === 'timeout') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '模型通道请求超时，请稍后重试',
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '模型通道不可达，请稍后重试',
      );
    }
  }

  private async poll(
    url: string,
    slot: GatewaySlot,
    intervalMs: number,
    maxPolls: number,
    operation: string,
  ) {
    for (let index = 0; index < maxPolls; index += 1) {
      await sleep(intervalMs);
      let parsed: Record<string, unknown> = {};
      try {
        const response = await httpRequest<string>(url, {
          headers: this.authHeaders(slot),
          timeoutMs: 30_000,
          readAs: 'text',
          operation,
        });
        if (!response.ok) continue;
        const json = JSON.parse(response.data) as unknown;
        parsed = unwrap(json);
      } catch (error) {
        // 客户端断开或用户取消后不再空转，把中断如实抛回对话层
        if (error instanceof TransportError && error.kind === 'cancelled') {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '生成已中断');
        }
        continue;
      }
      const mediaUrl = urlOf(parsed);
      if (mediaUrl) return mediaUrl;
      const status = statusOf(parsed);
      if (FAILURE_STATUSES.has(status)) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `生成失败${errorOf(parsed) ? `：${errorOf(parsed).slice(0, 120)}` : ''}`,
        );
      }
      if (DONE_STATUSES.has(status)) continue;
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '生成任务超时未完成，请稍后在任务里重试',
    );
  }

  private extractImage(node: Record<string, unknown>) {
    const data = node.data;
    const first = Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : node;
    const url = typeof first?.url === 'string' ? first.url : '';
    const b64 = typeof first?.b64_json === 'string' ? first.b64_json : '';
    return { url, b64 };
  }

  async generateImage(
    user: CurrentUser,
    token: string | undefined,
    input: { prompt: string; size?: string; model?: string },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'image',
      token,
      overrides?.image,
    );
    const model = String(input.model || '').trim() || slot.model;
    const payload: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: 1,
    };
    if (input.size) payload.size = input.size;
    const base = this.baseOf(slot);
    const submitUrl = `${base}/images/generations`;
    const body = await this.post(submitUrl, slot, payload, 'content:image');
    const node = unwrap(body);
    const direct = this.extractImage(node);
    let url = direct.url;
    if (!url && direct.b64) {
      const uploaded = await this.client.upload({
        baseUrl: slot.baseUrl,
        apiKey: slot.apiKey,
        bytes: new Uint8Array(Buffer.from(direct.b64, 'base64')),
        filename: 'image.png',
        prefix: `assets/enterprise/${user.userId}/outputs`,
      });
      url = uploaded.url;
    }
    if (!url) {
      const taskId = readText(node.task_id || node.id).trim();
      if (!taskId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '图片生成没有返回图片或任务编号',
        );
      }
      url = await this.poll(
        `${submitUrl}/${taskId}`,
        slot,
        IMAGE_POLL_INTERVAL_MS,
        IMAGE_MAX_POLLS,
        'content:imagePoll',
      );
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'image',
      name: `图片-${Date.now()}.png`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  async generateVideo(
    user: CurrentUser,
    token: string | undefined,
    input: {
      prompt: string;
      duration?: number;
      resolution?: string;
      ratio?: string;
      model?: string;
    },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'video',
      token,
      overrides?.video,
    );
    const model = String(input.model || '').trim() || slot.model;
    const payload: Record<string, unknown> = { model, prompt: input.prompt };
    if (input.duration) payload.duration = input.duration;
    if (input.resolution) payload.resolution = input.resolution;
    if (input.ratio) payload.ratio = input.ratio;
    const base = this.baseOf(slot);
    let submitUrl = `${base}/videos`;
    let body: unknown;
    try {
      body = await this.post(submitUrl, slot, payload, 'content:video');
    } catch (error) {
      // 部分兼容网关只实现 /video/generations；404 时退到该路径再试一次
      if (
        error instanceof BusinessException &&
        /HTTP 404/.test(error.message)
      ) {
        submitUrl = `${base}/video/generations`;
        body = await this.post(submitUrl, slot, payload, 'content:video');
      } else {
        throw error;
      }
    }
    const node = unwrap(body);
    let url = urlOf(node);
    if (!url) {
      const taskId = readText(node.task_id || node.id).trim();
      if (!taskId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '视频生成没有返回任务编号',
        );
      }
      url = await this.poll(
        `${submitUrl}/${taskId}`,
        slot,
        VIDEO_POLL_INTERVAL_MS,
        VIDEO_MAX_POLLS,
        'content:videoPoll',
      );
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'video',
      name: `视频-${Date.now()}.mp4`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 视频超清：走「模型设置 → 火山 AI MediaKit」渠道的生成式超分，结果另存一份视频资产。 */
  async upscaleVideo(
    user: CurrentUser,
    token: string | undefined,
    input: { videoUrl: string; resolution: string },
  ) {
    const credentials = await this.settings.mediakitCredentials(user);
    const kit = new MediaKitClient(credentials.baseUrl, credentials.apiKey);
    const url = await kit.enhance({
      videoUrl: input.videoUrl,
      resolution: input.resolution,
    });
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'video',
      name: `超清-${Date.now()}.mp4`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 文本生成（口播稿、反推剧本等纯文本卡片与 Agent 共用）。 */
  async chat(
    user: CurrentUser,
    token: string | undefined,
    messages: { role: string; content: string }[],
    mediaType: 'text' | 'vision' = 'text',
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      mediaType,
      token,
      overrides?.[mediaType],
    );
    const base = this.baseOf(slot);
    if (isAnthropic(slot)) {
      const system = messages
        .filter((item) => item.role === 'system')
        .map((item) => item.content)
        .join('\n\n');
      const turns = messages
        .filter((item) => item.role !== 'system')
        .map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'text', text: item.content }],
        }));
      while (turns.length && turns[0].role !== 'user') turns.shift();
      const body = await this.post(
        `${base}/messages`,
        slot,
        {
          model: slot.model,
          max_tokens: 4000,
          ...(system ? { system } : {}),
          messages: turns,
        },
        'content:chat',
      );
      const content = anthropicText(unwrap(body));
      if (!content) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '模型没有返回文本内容',
        );
      }
      return content;
    }
    const body = await this.post(
      `${base}/chat/completions`,
      slot,
      { model: slot.model, messages, stream: false },
      'content:chat',
    );
    const node = unwrap(body);
    const choice = Array.isArray(node.choices)
      ? (node.choices[0] as Record<string, unknown>)
      : undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content.trim()) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '模型没有返回文本内容',
      );
    }
    return content;
  }

  /** 多模态视频生成：复刻 / 数字人视频 / 视频换人换产品 / 混剪都走这里（网关的「全能参考」）。 */
  async generateVideoWithReferences(
    user: CurrentUser,
    token: string | undefined,
    input: {
      prompt: string;
      duration?: number;
      ratio?: string;
      resolution?: string;
      references: { type: 'video' | 'image' | 'audio'; url: string }[];
    },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'video',
      token,
      overrides?.video,
    );
    const base = this.baseOf(slot);
    const payload: Record<string, unknown> = {
      model: slot.model,
      prompt: input.prompt,
      references: input.references,
    };
    if (input.duration) payload.duration = input.duration;
    if (input.ratio) payload.ratio = input.ratio;
    if (input.resolution) payload.resolution = input.resolution;
    const submitUrl = `${base}/videos`;
    const body = await this.post(submitUrl, slot, payload, 'content:videoRef');
    const node = unwrap(body);
    let url = urlOf(node);
    if (!url) {
      const taskId = readText(node.task_id || node.id).trim();
      if (!taskId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '视频生成没有返回任务编号',
        );
      }
      url = await this.poll(
        `${submitUrl}/${taskId}`,
        slot,
        VIDEO_POLL_INTERVAL_MS,
        VIDEO_MAX_POLLS,
        'content:videoRefPoll',
      );
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'video',
      name: `视频-${Date.now()}.mp4`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 图片编辑（修图/去水印/参考出图）：OpenAI 兼容的 images/edits（multipart）。
   *  多张参考图按 `image[]` 重复提交；单张沿用 `image`（老网关只认这个字段）。 */
  async editImage(
    user: CurrentUser,
    token: string | undefined,
    input: {
      imageUrl?: string;
      imageUrls?: string[];
      prompt: string;
      size?: string;
      namePrefix?: string;
    },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'image',
      token,
      overrides?.image,
    );
    const base = this.baseOf(slot);
    const sources = (
      input.imageUrls?.length ? input.imageUrls : [input.imageUrl || '']
    )
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!sources.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有可用的参考图片');
    }
    const form = new FormData();
    form.append('model', slot.model);
    form.append('prompt', input.prompt);
    if (input.size) form.append('size', input.size);
    for (const [index, source] of sources.entries()) {
      const bytes = await this.client.download(source);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const filename = `reference-${index + 1}.png`;
      form.append(
        sources.length > 1 ? 'image[]' : 'image',
        new Blob([buffer]),
        filename,
      );
    }
    let response;
    try {
      response = await httpRequest<string>(`${base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${slot.apiKey}` },
        body: form,
        timeoutMs: SUBMIT_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:imageEdit',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '模型通道不可达，请稍后重试',
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `图片编辑被模型通道拒绝（HTTP ${response.status}）`,
      );
    }
    const node = unwrap(JSON.parse(response.data) as unknown);
    const direct = this.extractImage(node);
    let url = direct.url;
    if (!url && direct.b64) {
      const uploaded = await this.client.upload({
        baseUrl: slot.baseUrl,
        apiKey: slot.apiKey,
        bytes: new Uint8Array(Buffer.from(direct.b64, 'base64')),
        filename: 'image.png',
        prefix: `assets/enterprise/${user.userId}/outputs`,
      });
      url = uploaded.url;
    }
    if (!url) {
      const taskId = readText(node.task_id || node.id).trim();
      if (!taskId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '图片编辑没有返回图片或任务编号',
        );
      }
      url = await this.poll(
        `${base}/images/edits/${taskId}`,
        slot,
        IMAGE_POLL_INTERVAL_MS,
        IMAGE_MAX_POLLS,
        'content:imageEditPoll',
      );
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'image',
      name: `${input.namePrefix || '修图'}-${Date.now()}.png`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 语音合成：响应可能是二进制音频，也可能是 JSON 直链。 */
  async speech(
    user: CurrentUser,
    token: string | undefined,
    input: { text: string; voice?: string; format?: string },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'audio',
      token,
      overrides?.audio,
    );
    const base = this.baseOf(slot);
    const format = input.format === 'wav' ? 'wav' : 'mp3';
    const payload: Record<string, unknown> = {
      model: slot.model,
      input: input.text,
      response_format: format,
    };
    if (input.voice) payload.voice = input.voice;
    let response;
    try {
      response = await httpRequest<Uint8Array>(`${base}/audio/speech`, {
        method: 'POST',
        headers: this.authHeaders(slot),
        body: JSON.stringify(payload),
        timeoutMs: SUBMIT_TIMEOUT_MS,
        readAs: 'bytes',
        operation: 'content:speech',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '语音合成请求失败：模型通道不可达',
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `语音合成被模型通道拒绝（HTTP ${response.status}）`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    let url = '';
    if (contentType.includes('application/json')) {
      const text = new TextDecoder().decode(response.data);
      const node = unwrap(JSON.parse(text) as unknown);
      url = urlOf(node);
    }
    if (!url) {
      const uploaded = await this.client.upload({
        baseUrl: slot.baseUrl,
        apiKey: slot.apiKey,
        bytes: response.data,
        filename: `speech.${format}`,
        prefix: `assets/enterprise/${user.userId}/outputs`,
      });
      url = uploaded.url;
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'audio',
      name: `配音-${Date.now()}.${format}`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 语音识别：multipart 提交音视频，回文本。 */
  async transcribe(
    user: CurrentUser,
    token: string | undefined,
    input: { mediaUrl: string; language?: string },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'asr',
      token,
      overrides?.asr,
    );
    if (slot.asrProtocol === 'openspeech') {
      // 豆包语音识别：openspeech v3 直连，用渠道里单独保存的 ASR Key
      const text = await new OpenspeechClient(slot.apiKey).transcribe({
        audioUrl: input.mediaUrl,
        model: slot.model,
      });
      if (!text.trim()) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '豆包语音识别没有识别出文字（音频可能没有语音内容）',
        );
      }
      return { text };
    }
    const base = this.baseOf(slot);
    const bytes = await this.client.download(input.mediaUrl);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const name = input.mediaUrl.split('/').pop() || 'media.mp4';
    const form = new FormData();
    form.append('model', slot.model);
    if (input.language && input.language !== 'auto')
      form.append('language', input.language);
    form.append('file', new Blob([buffer]), name);
    let response;
    try {
      response = await httpRequest<string>(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${slot.apiKey}` },
        body: form,
        timeoutMs: 300_000,
        readAs: 'text',
        operation: 'content:transcribe',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '语音识别请求失败：模型通道不可达或超时',
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `语音识别被模型通道拒绝（HTTP ${response.status}）`,
      );
    }
    let text = '';
    try {
      const node = unwrap(JSON.parse(response.data) as unknown);
      text = readText(node.text || node.transcript).trim();
    } catch {
      text = response.data.trim();
    }
    if (!text) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '语音识别没有返回文字内容',
      );
    }
    return { text };
  }

  /** 音乐生成：任务式，成功回音频直链。 */
  async music(
    user: CurrentUser,
    token: string | undefined,
    input: { prompt: string; lyrics?: string; duration?: number },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'music',
      token,
      overrides?.music,
    );
    const base = this.baseOf(slot);
    const payload: Record<string, unknown> = {
      model: slot.model,
      prompt: input.prompt,
    };
    if (input.lyrics) payload.lyrics = input.lyrics;
    if (input.duration) payload.duration = input.duration;
    const body = await this.post(
      `${base}/music/generations`,
      slot,
      payload,
      'content:music',
    );
    const node = unwrap(body);
    let url = urlOf(node);
    if (!url) {
      const taskId = readText(node.task_id || node.id).trim();
      if (!taskId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '音乐生成没有返回任务编号',
        );
      }
      url = await this.poll(
        `${base}/music/generations/${taskId}`,
        slot,
        VIDEO_POLL_INTERVAL_MS,
        VIDEO_MAX_POLLS,
        'content:musicPoll',
      );
    }
    const asset = await this.assets.tryRegister(user, token, {
      url,
      kind: 'audio',
      name: `音乐-${Date.now()}.mp3`,
    });
    return {
      url,
      assetId: asset.assetId,
      assetNote: asset.ok ? '' : asset.message,
    };
  }

  /** 视频理解（反推剧本）：把视频直链交给「视觉理解」模型；上游不支持视频输入时如实报错。 */
  async describeVideo(
    user: CurrentUser,
    token: string | undefined,
    input: { videoUrl: string; prompt: string },
    overrides?: ModelOverrides,
  ) {
    const slot = await this.settings.resolveTarget(
      user,
      'vision',
      token,
      overrides?.vision,
    );
    const base = this.baseOf(slot);
    if (isAnthropic(slot)) {
      // Claude 收图片不收视频直链；这里如实报错并指向换渠道，不拿视频地址去撞接口
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Claude（Anthropic）渠道不支持视频输入：请在「模型设置」把「视觉理解」换成支持视频的模型（如 AIPDD 里的视觉模型）',
      );
    }
    const body = await this.post(
      `${base}/chat/completions`,
      slot,
      {
        model: slot.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: input.prompt },
              { type: 'video_url', video_url: { url: input.videoUrl } },
            ],
          },
        ],
      },
      'content:videoUnderstand',
    );
    const node = unwrap(body);
    const choice = Array.isArray(node.choices)
      ? (node.choices[0] as Record<string, unknown>)
      : undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content.trim()) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '视觉模型没有返回内容（当前模型可能不支持视频输入，请在模型设置里换一个视觉模型）',
      );
    }
    return { text: content };
  }

  /** 纯文本生成：按角色拼消息，供口播稿/公众号等卡片使用。 */
  async generateText(
    user: CurrentUser,
    token: string | undefined,
    input: { system: string; user: string },
    overrides?: ModelOverrides,
  ) {
    return this.chat(
      user,
      token,
      [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      'text',
      overrides,
    );
  }
}
