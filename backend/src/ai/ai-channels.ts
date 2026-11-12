import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  CONTENT_CHANNEL_PROVIDER_LABELS,
  isProviderSupported,
  type ContentChannelProvider,
} from '@enterprise/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { ContentCrypto } from '../content/content-crypto';
import { aipddBaseUrl, presetProtocol } from '../content/content-shared';
import {
  LOCALAPI_CHANNEL_ID,
  localApiBaseUrl,
  mintLocalApiKey,
} from '../model-plaza/localapi';

/**
 * 「渠道编号 → 调用凭据」的全系统唯一实现：内容创作模型设置与 AI 网关都走这里，
 * 避免同一个「渠道 3 是哪把 Key、什么协议」在两处各解一遍（解歪一次就会时好时坏）。
 * 解密后的 Key 只在本进程内存里进请求头，永不落库、落日志或回传前端。
 *
 * 算力渠道支持范围闸门也收口在此：平台管理员关闭的渠道在这里被拦下（抛错/回落 null），
 * 这里只服务算力调用；业务服务的 AIPDD Key 走 baseDataToken，不受这里影响。
 */
export type ChannelCredentials = {
  baseUrl: string;
  apiKey: string;
  provider: 'aipdd' | 'localapi' | 'custom' | 'volcengine' | 'mediakit';
  protocol: 'openai' | 'anthropic';
  asrProtocol?: 'openspeech' | 'openai';
  /** 自定义 OpenAI 兼容渠道的预设；模型类型兜底与渠道展示用 */
  preset?: string;
};

const modelKeys = new ModelKeyService();
let sharedCrypto: ContentCrypto | null = null;
function crypto(): ContentCrypto {
  if (!sharedCrypto) sharedCrypto = new ContentCrypto();
  return sharedCrypto;
}

/** 平台管理员关闭的算力渠道不能用于算力调用：抛可读错误（业务服务的 AIPDD Key 不受影响）。 */
async function assertComputeProviderSupported(
  prisma: PrismaService,
  provider: ContentChannelProvider,
) {
  if (await computeProviderSupported(prisma, provider)) return;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    `平台管理员已关闭「${CONTENT_CHANNEL_PROVIDER_LABELS[provider]}」算力渠道，暂不能用于生成调用`,
  );
}

/** 某个算力渠道是否被平台开启支持；网关各回落层与模型设置都用它判「选不选得到」。 */
export async function computeProviderSupported(
  prisma: PrismaService,
  provider: ContentChannelProvider,
): Promise<boolean> {
  const { readChannelPolicy } =
    await import('../content/channel-policy.service');
  return isProviderSupported(await readChannelPolicy(prisma), provider);
}

/**
 * 本人绑定的 AIPDD Key：没有请求令牌时按 userId 现取（未绑定由 resolveToken 抛出可执行的绑定引导）。
 * 后台 / 无请求上下文的链路（后台执行、任务重试、定时任务、静默链路）不会带回请求令牌，
 * 少了这层回落就会拿空令牌误报「请先绑定 API Key」——与 aipddApiKey() 同口径。
 */
async function ownAipddKey(
  prisma: PrismaService,
  userId: string,
): Promise<string> {
  const { AipddKeyService } = await import('../account/aipdd-key.service');
  return new AipddKeyService(prisma).resolveToken(userId);
}

export async function loadChannelCredentials(input: {
  prisma: PrismaService;
  userId: string;
  channelId: number;
  token?: string;
  mediaType?: string;
}): Promise<ChannelCredentials> {
  const { prisma, userId, channelId, token, mediaType } = input;
  if (channelId === LOCALAPI_CHANNEL_ID) {
    await assertComputeProviderSupported(prisma, 'localapi');
    // 本站模型广场：不需要用户自己的 Key，服务端按 userId 派生 lk_ 令牌，调用按目录价扣积分
    return {
      baseUrl: localApiBaseUrl(),
      apiKey: mintLocalApiKey(userId),
      provider: 'localapi',
      protocol: 'openai',
    };
  }
  if (channelId === 0) {
    await assertComputeProviderSupported(prisma, 'aipdd');
    // AIPDD 渠道的凭据不是渠道行里的 Key，而是本人绑定的 AIPDD APIKey（设计 3.4）：
    // 本次请求已解析的上游令牌优先，否则按 userId 现取本人绑定的 Key。
    const apiKey = String(token || '').trim()
      ? modelKeys.requireKey(token)
      : await ownAipddKey(prisma, userId);
    return {
      baseUrl: aipddBaseUrl(),
      apiKey,
      provider: 'aipdd',
      protocol: 'openai',
    };
  }
  const row = await prisma.contentModelChannel.findFirst({
    where: { id: channelId, userId },
  });
  if (!row) {
    throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
  }
  if (!row.enabled) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '该渠道已停用');
  }
  const isVolcengine = row.provider === 'volcengine';
  const provider: ChannelCredentials['provider'] =
    row.provider === 'mediakit'
      ? 'mediakit'
      : isVolcengine
        ? 'volcengine'
        : 'custom';
  await assertComputeProviderSupported(prisma, provider);
  // 火山引擎：语音识别走豆包语音（openspeech）的独立 Key，其余走方舟 Key
  const useAsrKey = isVolcengine && mediaType === 'asr';
  const apiKey = crypto().decrypt(
    useAsrKey ? row.asrKeyCipher || '' : row.keyCipher,
  );
  if (useAsrKey && !apiKey) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '这个火山引擎渠道还没有保存豆包语音识别的 Key（它和方舟 Key 不是同一个，请到「模型设置」补齐）',
    );
  }
  const protocol = isVolcengine
    ? ('openai' as const)
    : presetProtocol(String(row.preset || ''));
  return {
    baseUrl: row.baseUrl,
    apiKey,
    provider,
    asrProtocol: useAsrKey ? ('openspeech' as const) : ('openai' as const),
    protocol,
    preset: String(row.preset || ''),
  };
}

/** 可选版：渠道行缺失/停用/未解出 Key 时返回 null（供网关逐级回落，不抛穿）。 */
export async function tryChannelCredentials(input: {
  prisma: PrismaService;
  userId: string;
  channelId: number;
  token?: string;
  mediaType?: string;
}): Promise<ChannelCredentials | null> {
  try {
    const credentials = await loadChannelCredentials(input);
    return credentials.apiKey || input.channelId === 0 ? credentials : null;
  } catch {
    return null;
  }
}

/** AIPDD 兜底 Key：本次请求已解析的上游令牌优先，其次平台/账号绑定的基础数据 Key。 */
export async function aipddApiKey(
  prisma: PrismaService,
  userId: string,
  token?: string,
): Promise<string> {
  const direct = String(token || '').trim();
  if (direct) return direct;
  const { AipddKeyService } = await import('../account/aipdd-key.service');
  try {
    return await new AipddKeyService(prisma).baseDataToken(userId);
  } catch {
    return '';
  }
}
