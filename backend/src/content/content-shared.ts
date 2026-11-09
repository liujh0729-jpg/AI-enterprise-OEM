import {
  CONTENT_CHANNEL_PRESETS,
  CONTENT_CHANNEL_PRESET_BASE_URLS,
  CONTENT_CHANNEL_PROVIDERS,
  CONTENT_MEDIA_TYPES,
  type ContentChannelPreset,
  type ContentMediaType,
} from '@enterprise/contracts';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** AIPDD 网关：与 RPA / 潜客挖掘共用同一通道，Key 是「API Key 管理」里的 sk- Key。 */
export function aipddBaseUrl() {
  return (
    String(process.env.GEO_LLM_BASE_URL || '').trim() ||
    'https://api.aipdd.work/v1'
  ).replace(/\/+$/, '');
}

/** 渠道预设默认地址（留空由调用方兜底为自定义）。 */
export function presetBaseUrl(preset: string) {
  return isPreset(preset) ? CONTENT_CHANNEL_PRESET_BASE_URLS[preset] : '';
}

export function isPreset(value: string): value is ContentChannelPreset {
  return (CONTENT_CHANNEL_PRESETS as readonly string[]).includes(value);
}

/** Claude 走 Anthropic 原生协议（/messages + x-api-key），其余预设一律 OpenAI 兼容。 */
export function presetProtocol(preset: string) {
  return preset === 'anthropic' ? ('anthropic' as const) : ('openai' as const);
}

/** 火山引擎方舟（ArK）OpenAI 兼容入口：语音、豆包文本/视觉都从这里调。 */
export function volcengineDefaultBaseUrl() {
  return (
    String(process.env.VOLCENGINE_BASE_URL || '').trim() ||
    'https://ark.cn-beijing.volces.com/api/v3'
  ).replace(/\/+$/, '');
}

/** 火山 AI MediaKit：站点根，不是 OpenAI 兼容前缀。 */
export function mediakitDefaultBaseUrl() {
  return (
    String(process.env.MEDIAKIT_BASE_URL || '').trim() ||
    'https://mediakit.cn-beijing.volces.com/api/v1'
  ).replace(/\/+$/, '');
}

export function assertMediaType(value: unknown): ContentMediaType {
  const text = readText(value).trim();
  if (!(CONTENT_MEDIA_TYPES as readonly string[]).includes(text)) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '模型类型不被支持');
  }
  return text as ContentMediaType;
}

export function assertProvider(value: unknown) {
  const text = readText(value).trim();
  if (!(CONTENT_CHANNEL_PROVIDERS as readonly string[]).includes(text)) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道类型不被支持');
  }
  return text as (typeof CONTENT_CHANNEL_PROVIDERS)[number];
}

export function assertPreset(value: unknown) {
  const text = readText(value).trim();
  if (!text) return '';
  if (!(CONTENT_CHANNEL_PRESETS as readonly string[]).includes(text)) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道预设不被支持');
  }
  return text;
}

export function assertBaseUrl(value: unknown, provider: string) {
  const text = readText(value).trim().replace(/\/+$/, '');
  if (!text) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写渠道地址');
  }
  if (!/^https?:\/\/[^\s]+$/i.test(text)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '渠道地址必须是以 http(s):// 开头的完整地址',
    );
  }
  if (provider === 'aipdd') return aipddBaseUrl();
  return text;
}

/**
 * 上游 /v1/models 每条的 aipdd 元数据归一：kind 决定它能进哪个槽位，
 * modalities.input 含 image 才算视觉模型；没有元数据时按名字兜底并标注（inferred）。
 */
export function classifyModel(entry: Record<string, unknown>) {
  const meta = (entry.aipdd || {}) as Record<string, unknown>;
  const modalities = (meta.modalities || {}) as Record<string, unknown>;
  const inputs = Array.isArray(modalities.input) ? modalities.input : [];
  const kind = readText(meta.kind).trim().toLowerCase();
  const name = readText(entry.id).trim();
  // 嵌入模型是「向量嵌入」槽位的候选：它不生成内容，但同样要指定默认模型
  const mapped = kind === 'llm' || kind === 'decision' ? 'text' : kind;
  const vision =
    inputs.includes('image') ||
    /(vision|vl|multimodal|omni)/i.test(name) ||
    (mapped === 'text' && modalities.output === undefined && false);
  const endpoints = Array.isArray(meta.endpoint)
    ? meta.endpoint.map((item) => readText(item))
    : meta.endpoint
      ? [readText(meta.endpoint)]
      : [];
  const capabilities = modelCapabilities(meta);
  return {
    id: name,
    kind: (CONTENT_MEDIA_TYPES as readonly string[]).includes(mapped)
      ? mapped
      : 'other',
    vision,
    endpoints,
    ...(capabilities ? { capabilities } : {}),
  };
}

/** `aipdd.capabilities.media_metadata` 里的可调档位；没有声明就不带这一项。 */
function modelCapabilities(meta: Record<string, unknown>) {
  const capabilities = (meta.capabilities || {}) as Record<string, unknown>;
  const media = (capabilities.media_metadata || {}) as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => readText(item).trim()).filter(Boolean)
      : [];
  const sizes = strings(media.supportedSizes);
  const qualities = strings(media.supportedQualities);
  const aspectRatios = strings(media.supportedAspectRatios);
  const resolutions = strings(media.supportedResolutions);
  const durationOf = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const minDuration = durationOf(media.minDurationSeconds);
  const maxDuration = durationOf(media.maxDurationSeconds);
  const hasDuration = minDuration !== undefined || maxDuration !== undefined;
  if (
    !sizes.length &&
    !qualities.length &&
    !aspectRatios.length &&
    !resolutions.length &&
    !hasDuration
  ) {
    return null;
  }
  return {
    sizes,
    qualities,
    aspectRatios,
    resolutions,
    ...(minDuration !== undefined ? { minDurationSeconds: minDuration } : {}),
    ...(maxDuration !== undefined ? { maxDurationSeconds: maxDuration } : {}),
  };
}

export function shortUpstreamMessage(status: number, body: string) {
  const text = String(body || '')
    .replace(/\s+/g, ' ')
    .trim();
  const detail = text.length > 160 ? `${text.slice(0, 160)}…` : text;
  return `上游返回 HTTP ${status}${detail ? `：${detail}` : ''}`;
}
