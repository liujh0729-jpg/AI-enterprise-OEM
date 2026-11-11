import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aipddBaseUrl } from '../content/content-shared';
import type { PrismaService } from '../prisma/prisma.service';
import {
  geoChatMulti,
  geoChatStream,
  geoEmbed,
  type ChatMessage,
  type GeoChatResult,
} from '../geo/geo-llm.client';
import {
  aipddApiKey,
  computeProviderSupported,
  tryChannelCredentials,
} from './ai-channels';
import { aiGuardDeny, assertAiAllowed } from './ai-guard.service';
import { LOCALAPI_CHANNEL_ID } from '../model-plaza/localapi';
import { platformModelFor } from '../model-plaza/platform-defaults.service';

/**
 * 全系统统一 AI 网关（AI 底座方案 §4.1）。
 *
 * 收口三件事：
 * 1. **取模型**：优先级 = 本轮显式选择 → 模块自有默认 → 账号「模型设置」默认渠道 →
 *    历史口径（AIPDD Key + RPA/Workbuddy 默认模型）。用户在主模型设置页配的模型从此对全系统生效，
 *    「content 渠道 / RPA·Workbuddy / geo」三源割裂到此结束。
 * 2. **发请求**：OpenAI 兼容与 Anthropic 两种方言、JSON 解析、流式、嵌入都从这一个出口走，
 *    传输与并发仍由 httpRequest/streamRequest 统一限流；模块不再自带 LLM 客户端。
 * 3. **统一计量**（§4.4）：每次真实调用都落一条用量事实（板块 / 动作 / 模型 / token / 积分）。
 *    带 `charge.code` 才按 BillingRule 扣分，不带的只记用量、一分不扣——
 *    「看得见花了多少」与「是否开始扣费」是两件事，后者由科目种子决定，网关不擅自改变用户可见扣费。
 *
 * 缺 Key / 缺模型：resolveModel 返回 null，tryChat/aiJson 返回 null，调用方按既有口径走规则式兜底，
 * 绝不抛穿业务链路；只有 requireModel（用户主动点「AI 生成」这类明确动作）才抛引导性错误。
 */

export type AiModelSource =
  'override' | 'module' | 'account' | 'legacy' | 'platform';

export type AiModel = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'anthropic';
  channelId: number;
  source: AiModelSource;
};

export type AiModelQuery = {
  userId: string;
  /** 路由层已解析出的上游令牌（AIPDD sk- Key）；缺省时回落平台/账号绑定的 Key。 */
  token?: string;
  /** 本轮用户在功能里显式选的模型。 */
  model?: string;
  /** 本轮显式选的渠道（与 model 配套；缺省按账号默认渠道）。 */
  channelId?: number;
  /** 模块配置页存的默认模型（如 RPA / 大数据集 / 客服）。 */
  moduleModel?: string;
  /** 模块配置页存的渠道。 */
  moduleChannelId?: number;
  /** 关掉账号默认渠道这一级（模块坚持只用自己那份配置时）。 */
  skipAccountSlot?: boolean;
  /**
   * 本轮需要的模型能力槽位：缺省 text；视觉理解等场景传 vision 会先读「视觉理解」槽位，
   * 没配再回落文本槽位（多数渠道一个模型两种能力，用户的直观预期是「配了就能用」）。
   */
  mediaType?: string;
};

export type AiUsage = {
  tokenIn: number;
  tokenOut: number;
  call: number;
};

export type AiCharge = {
  /** BillingRule 科目 code；未配规则行时由 AiEvalService 回落按次包价。 */
  code: string;
  refId?: string;
};

/** 一次调用的用量事实维度：哪个板块、哪个动作、走的哪个模型。 */
export type AiMeterMeta = {
  module: string;
  operation: string;
  model: string;
};

export type AiMeteringHooks = {
  /** 带科目：按 BillingRule 扣分并落用量事实。 */
  charge: (
    userId: string,
    code: string,
    usage: AiUsage,
    refId: string,
    meta: AiMeterMeta,
  ) => Promise<unknown>;
  /** 不带科目：只落用量事实，一分钱不扣（用量可见 ≠ 开新扣费）。 */
  record: (
    userId: string,
    usage: AiUsage,
    meta: AiMeterMeta,
  ) => Promise<unknown>;
};

let metering: AiMeteringHooks | null = null;

/** 应用装配时注册（http/services.ts → AiEvalService）；未注册则只调用不落账（如 GEO worker）。 */
export function registerAiMetering(hooks: AiMeteringHooks) {
  metering = hooks;
}

async function meter(
  userId: string,
  subject: AiCharge | undefined,
  usage: AiUsage,
  meta: AiMeterMeta,
) {
  if (!metering) return;
  try {
    if (subject?.code) {
      await metering.charge(
        userId,
        subject.code,
        usage,
        subject.refId || '',
        meta,
      );
      return;
    }
    await metering.record(userId, usage, meta);
  } catch {
    // 记账失败不影响已完成的 AI 结果（与 chargeSafely 同口径）
  }
}

/** 账号「模型设置」里某一类型的默认槽位（渠道 + 模型）。 */
async function accountSlot(
  prisma: PrismaService,
  userId: string,
  mediaType: string,
): Promise<{ channelId: number; model: string } | null> {
  const row = await prisma.contentModelSlot.findUnique({
    where: { userId_mediaType: { userId, mediaType } },
  });
  const model = String(row?.model || '').trim();
  if (!model) return null;
  return { channelId: Number(row?.channelId || 0), model };
}

/** 历史口径：RPA / Workbuddy 的默认模型（老模块只配过这两处，保留作最后回落）。 */
async function legacyModel(
  prisma: PrismaService,
  userId: string,
): Promise<string> {
  const [rpa, workbuddy] = await Promise.all([
    prisma.rpaLlmSetting.findUnique({ where: { userId } }),
    prisma.workbuddyLlmSetting.findUnique({ where: { userId } }),
  ]);
  return String(rpa?.model || workbuddy?.model || '')
    .trim()
    .slice(0, 128);
}

/** 组装一个层级：拿到凭据 + 模型名才算命中。channelId=0 时用 AIPDD Key（令牌优先，其次绑定 Key）。 */
async function level(
  prisma: PrismaService,
  userId: string,
  token: string | undefined,
  channelId: number,
  model: string,
  source: AiModelSource,
  mediaType = 'text',
): Promise<AiModel | null> {
  const trimmed = String(model || '')
    .trim()
    .slice(0, 128);
  if (!trimmed) return null;
  const credentials = await tryChannelCredentials({
    prisma,
    userId,
    channelId,
    token,
    mediaType: mediaType === 'vision' ? 'vision' : 'text',
  });
  if (credentials?.apiKey) {
    return { ...credentials, model: trimmed, channelId, source };
  }
  if (channelId !== 0) return null;
  // 平台管理员关闭了 AIPDD 算力渠道：算力不再回落 AIPDD Key（业务服务的 AIPDD Key 不受影响）。
  if (!(await computeProviderSupported(prisma, 'aipdd'))) return null;
  const key = await aipddApiKey(prisma, userId, token);
  if (!key) return null;
  return {
    baseUrl: aipddBaseUrl(),
    apiKey: key,
    model: trimmed,
    protocol: 'openai',
    channelId: 0,
    source,
  };
}

/**
 * 取这一轮真正要用的模型通道：按「本轮显式选择 → 模块自有默认 → 账号默认渠道 → 历史口径
 * → 平台默认模型」顺序逐级试，全不成立返回 null（调用方走规则式兜底）。
 * 平台层只对完成真实充值的账号生效，并受平台设置的单次/日/月额度约束。
 */
export async function resolveModel(
  prisma: PrismaService,
  query: AiModelQuery,
  guard = true,
): Promise<AiModel | null> {
  const { userId, token } = query;
  // 主开关/限流闸在取模型前收口：静默链路返回 null 由调用方回落规则式产出。
  if (guard && (await aiGuardDeny(userId))) return null;
  const mediaType = String(query.mediaType || 'text').trim() || 'text';
  const exactSlot = query.skipAccountSlot
    ? null
    : await accountSlot(prisma, userId, mediaType).catch(() => null);
  const account = query.skipAccountSlot
    ? null
    : (exactSlot ??
      (mediaType === 'text'
        ? null
        : await accountSlot(prisma, userId, 'text').catch(() => null)));
  const ladder: Array<{
    channelId: number;
    model: string;
    source: AiModelSource;
  }> = [];
  if (query.model) {
    ladder.push({
      channelId: Number(query.channelId ?? account?.channelId ?? 0),
      model: query.model,
      source: 'override',
    });
  }
  if (query.moduleModel) {
    ladder.push({
      channelId: Number(query.moduleChannelId ?? 0),
      model: query.moduleModel,
      source: 'module',
    });
  }
  if (account) {
    ladder.push({
      channelId: account.channelId,
      model: account.model,
      source: 'account',
    });
  }
  for (const step of ladder) {
    const resolved = await level(
      prisma,
      userId,
      token,
      step.channelId,
      step.model,
      step.source,
      mediaType,
    );
    if (resolved) return resolved;
  }
  const legacy = await legacyModel(prisma, userId).catch(() => '');
  if (legacy) {
    const resolved = await level(
      prisma,
      userId,
      token,
      0,
      legacy,
      'legacy',
      mediaType,
    );
    if (resolved) return resolved;
  }
  // 个人已配置模型调用失败时不自动切到收费的平台模型，避免配置故障变成意外扣费。
  if (exactSlot?.model || legacy) return null;
  // 平台默认模型：走本站模型广场的 LocalAPI 通道，按目录价从调用者积分扣费。
  const platform = await platformModelFor(prisma, userId, mediaType).catch(
    () => null,
  );
  return platform
    ? level(
        prisma,
        userId,
        token,
        LOCALAPI_CHANNEL_ID,
        platform.modelKey,
        'platform',
        mediaType,
      )
    : null;
}

/** 用户主动发起的 AI 动作：解析不出通道就给出可执行的引导，不静默降级。 */
export async function requireModel(
  prisma: PrismaService,
  query: AiModelQuery,
): Promise<AiModel> {
  // 用户主动动作：闸门拒绝时抛可读错误（关闭/限流），不伪装成「没配模型」。
  await assertAiAllowed(query.userId);
  const resolved = await resolveModel(prisma, query, false);
  if (resolved) return resolved;
  const vision = String(query.mediaType || 'text') === 'vision';
  throw new BusinessException(
    ErrorCode.FORBIDDEN,
    `还没有可用的${vision ? '视觉理解' : '文字'}模型：请在「模型服务 → 模型设置」为「${vision ? '视觉理解' : '文本'}」选择渠道与默认模型` +
      '（自定义渠道需保存 Key），或在「模型服务 → API Key 管理」绑定 AIPDD API Key 并在 RPA/Workbuddy 里选一次默认模型；' +
      '完成充值并到账后，未单独配置的类型也会自动继承平台默认模型（需管理员开启）',
  );
}

export type AiChatInput = AiModelQuery & {
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  purpose?: 'chat' | 'batch';
  charge?: AiCharge;
  /** 用量事实的板块名（如 'seo'/'erp'/'kb'）；缺省 'ai'。 */
  module?: string;
  /** 用量事实的动作名（如 'audit_interpret'）；缺省取 purpose。 */
  operation?: string;
};

export type AiChatOutput = GeoChatResult & {
  model: string;
  source: AiModelSource;
  usage: AiUsage;
};

function toUsage(result: GeoChatResult): AiUsage {
  return {
    tokenIn: result.promptTokens,
    tokenOut: result.completionTokens,
    call: 1,
  };
}

function toMeta(input: AiChatInput, model: string): AiMeterMeta {
  return {
    module: String(input.module || 'ai').slice(0, 32),
    operation: String(input.operation || input.purpose || 'chat').slice(0, 64),
    model: String(model || '').slice(0, 128),
  };
}

/** 多轮对话（抛错版，供用户主动动作）。 */
export async function aiChat(
  prisma: PrismaService,
  input: AiChatInput,
): Promise<AiChatOutput> {
  const model = await requireModel(prisma, input);
  const result = await geoChatMulti({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    messages: input.messages,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    userId: input.userId,
    purpose: input.purpose,
    api: model.protocol === 'anthropic' ? 'anthropic' : 'openai',
  });
  const usage = toUsage(result);
  await meter(input.userId, input.charge, usage, toMeta(input, model.model));
  return { ...result, model: model.model, source: model.source, usage };
}

/** 多轮对话（静默版）：缺通道或调用失败返回 null，让上层走规则式兜底。 */
export async function tryChat(
  prisma: PrismaService,
  input: AiChatInput,
): Promise<AiChatOutput | null> {
  try {
    return await aiChat(prisma, input);
  } catch {
    return null;
  }
}

/** 从模型回复里抠出第一个 JSON 对象（剥围栏、截花括号；全系统唯一实现）。 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export type AiJsonOutput<T> = {
  data: T;
  reply: string;
  model: string;
  source: AiModelSource;
  elapsedMs: number;
  usage: AiUsage;
};

/** 结构化产出：抠 JSON + 可选 schema 校验；不合规返回 null（调用方兜底）。 */
export async function aiJson<T = Record<string, unknown>>(
  prisma: PrismaService,
  input: AiChatInput & {
    validate?: (data: Record<string, unknown>) => T | null;
  },
): Promise<AiJsonOutput<T> | null> {
  const result = await tryChat(prisma, input);
  if (!result) return null;
  const parsed = parseJsonObject(result.reply);
  if (!parsed) return null;
  const data = input.validate ? input.validate(parsed) : (parsed as T);
  if (!data) return null;
  return {
    data,
    reply: result.reply,
    model: result.model,
    source: result.source,
    elapsedMs: result.elapsedMs,
    usage: result.usage,
  };
}

/**
 * 只记用量、不扣分的入口：给不走统一网关发请求（自带流式客户端）的链路补记用量事实，
 * 让工作流、Agent 这类按运行汇总成本的场景与网关调用落在同一张 usage_events 上。
 */
export async function recordAiUsage(
  userId: string,
  usage: AiUsage,
  meta: { module: string; operation: string; model: string },
) {
  if (!usage.call) return;
  await meter(userId, undefined, usage, {
    module: String(meta.module || 'ai').slice(0, 32),
    operation: String(meta.operation || 'chat').slice(0, 64),
    model: String(meta.model || '').slice(0, 128),
  });
}

/** 逐块回调的对话流（抛错版；静默需求先 resolveModel 再 geoChatStream）。 */
export async function aiStream(
  prisma: PrismaService,
  input: AiChatInput & { onDelta: (chunk: string) => void | Promise<void> },
): Promise<AiChatOutput> {
  const model = await requireModel(prisma, input);
  const result = await geoChatStream({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    messages: input.messages,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    userId: input.userId,
    purpose: input.purpose,
    api: model.protocol === 'anthropic' ? 'anthropic' : 'openai',
    onDelta: input.onDelta,
  });
  const usage = toUsage(result);
  await meter(input.userId, input.charge, usage, toMeta(input, model.model));
  return { ...result, model: model.model, source: model.source, usage };
}

export type AiEmbedInput = AiModelQuery & {
  texts: string[];
  timeoutMs?: number;
  charge?: AiCharge;
  module?: string;
  operation?: string;
};

/**
 * 真实向量：账号在「模型设置 → 向量嵌入」配了槽位才走上游 embeddings，
 * 未配置返回 null（调用方回落到本地袋装向量）。不引入外部向量库进程。
 * `model` 只换槽位渠道上的模型名（检索侧要按分块记录的模型取查询向量）。
 */
export async function aiEmbed(
  prisma: PrismaService,
  input: AiEmbedInput,
): Promise<{ vectors: number[][]; model: string } | null> {
  if (!input.texts.length) return null;
  // 嵌入是静默链路：闸门拒绝即回落本地袋装向量，不打断检索。
  if (await aiGuardDeny(input.userId)) return null;
  const slot = await accountSlot(prisma, input.userId, 'embedding').catch(
    () => null,
  );
  const platform = slot
    ? null
    : await platformModelFor(prisma, input.userId, 'embedding').catch(
        () => null,
      );
  if (!slot && !platform) return null;
  const embedModel =
    String(input.model || '').trim() || slot?.model || platform?.modelKey || '';
  const credentials = await tryChannelCredentials({
    prisma,
    userId: input.userId,
    channelId: slot ? slot.channelId : LOCALAPI_CHANNEL_ID,
    token: input.token,
    mediaType: 'embedding',
  });
  if (!credentials?.apiKey || credentials.protocol !== 'openai') return null;
  try {
    const result = await geoEmbed(
      {
        baseUrl: credentials.baseUrl,
        apiKey: credentials.apiKey,
        model: embedModel,
      },
      input.texts,
      input.timeoutMs,
    );
    await meter(
      input.userId,
      input.charge,
      { tokenIn: 0, tokenOut: 0, call: input.texts.length },
      {
        module: String(input.module || 'ai').slice(0, 32),
        operation: String(input.operation || 'embed').slice(0, 64),
        model: embedModel,
      },
    );
    return { vectors: result.vectors, model: embedModel };
  } catch {
    return null;
  }
}
