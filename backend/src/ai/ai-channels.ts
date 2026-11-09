import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
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
 */
export type ChannelCredentials = {
  baseUrl: string;
  apiKey: string;
  provider: 'aipdd' | 'localapi' | 'custom' | 'volcengine' | 'mediakit';
  protocol: 'openai' | 'anthropic';
  asrProtocol?: 'openspeech' | 'openai';
};

const modelKeys = new ModelKeyService();
let sharedCrypto: ContentCrypto | null = null;
function crypto(): ContentCrypto {
  if (!sharedCrypto) sharedCrypto = new ContentCrypto();
  return sharedCrypto;
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
    // 本站模型广场：不需要用户自己的 Key，服务端按 userId 派生 lk_ 令牌，调用按目录价扣积分
    return {
      baseUrl: localApiBaseUrl(),
      apiKey: mintLocalApiKey(userId),
      provider: 'localapi',
      protocol: 'openai',
    };
  }
  if (channelId === 0) {
    const apiKey = modelKeys.requireKey(token);
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
    provider:
      row.provider === 'mediakit'
        ? ('mediakit' as const)
        : isVolcengine
          ? ('volcengine' as const)
          : ('custom' as const),
    asrProtocol: useAsrKey ? ('openspeech' as const) : ('openai' as const),
    protocol,
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
