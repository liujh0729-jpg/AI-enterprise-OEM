import type { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AipddKeyService } from '../account/aipdd-key.service';
import {
  aipddApiKey,
  computeProviderSupported,
  loadChannelCredentials,
  tryChannelCredentials,
} from './ai-channels';
import { stub } from '../../test/doubles';

// AipddKeyService 构造时初始化 AccountCrypto，需要独立密钥源；单测用固定值，避免读真实 .env。
process.env.EXTERNAL_CRED_KEY =
  process.env.EXTERNAL_CRED_KEY || 'unit-test-key';

/** 只喂闸门用到的两张表：策略单键 JSON 与自建渠道行。 */
const prismaOf = (disabledProviders: string[], channelProvider = 'custom') =>
  stub<PrismaService>({
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key === 'content_channel_policy'
          ? {
              value: JSON.stringify({
                allowCustom: true,
                presetTypes: {},
                disabledProviders,
              }),
            }
          : null,
    },
    contentModelChannel: {
      findFirst: async () => ({
        id: 7,
        userId: 'u1',
        provider: channelProvider,
        enabled: true,
        keyCipher: 'cipher',
        asrKeyCipher: '',
        baseUrl: 'https://gw.example/v1',
        preset: 'openai',
      }),
    },
  });

describe('算力渠道支持范围闸门', () => {
  it('默认全部支持：没有关闭任何渠道时各 provider 都可用', async () => {
    const prisma = prismaOf([]);
    for (const provider of [
      'aipdd',
      'localapi',
      'custom',
      'volcengine',
      'mediakit',
    ] as const) {
      expect(await computeProviderSupported(prisma, provider)).toBe(true);
    }
  });

  it('被关闭的渠道判为不支持，其余照常支持', async () => {
    const prisma = prismaOf(['aipdd', 'mediakit']);
    expect(await computeProviderSupported(prisma, 'aipdd')).toBe(false);
    expect(await computeProviderSupported(prisma, 'mediakit')).toBe(false);
    expect(await computeProviderSupported(prisma, 'localapi')).toBe(true);
    expect(await computeProviderSupported(prisma, 'custom')).toBe(true);
  });

  it('关闭 AIPDD：算力取凭据抛错，可选版回落 null', async () => {
    const prisma = prismaOf(['aipdd']);
    await expect(
      loadChannelCredentials({ prisma, userId: 'u1', channelId: 0 }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(
      await tryChannelCredentials({ prisma, userId: 'u1', channelId: 0 }),
    ).toBeNull();
  });

  it('关闭 LocalAPI：算力取凭据抛错，可选版回落 null', async () => {
    const prisma = prismaOf(['localapi']);
    await expect(
      loadChannelCredentials({ prisma, userId: 'u1', channelId: -1 }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(
      await tryChannelCredentials({ prisma, userId: 'u1', channelId: -1 }),
    ).toBeNull();
  });

  it('关闭自建渠道类型：正数 id 渠道同样被拦下', async () => {
    const prisma = prismaOf(['custom']);
    await expect(
      loadChannelCredentials({ prisma, userId: 'u1', channelId: 7 }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(
      await tryChannelCredentials({ prisma, userId: 'u1', channelId: 7 }),
    ).toBeNull();
  });

  it('关闭 AIPDD 算力不影响业务服务 Key：同源令牌照常解出', async () => {
    const prisma = prismaOf(['aipdd']);
    expect(await computeProviderSupported(prisma, 'aipdd')).toBe(false);
    // 业务服务走 baseDataToken / 直传令牌，不经过算力闸门
    expect(await aipddApiKey(prisma, 'u1', 'sk-business')).toBe('sk-business');
  });
});

describe('AIPDD 渠道（0）的凭据取法：请求令牌优先，否则现取本人绑定的 Key', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('带请求令牌：直接用令牌，不查绑定', async () => {
    const bound = jest
      .spyOn(AipddKeyService.prototype, 'resolveToken')
      .mockResolvedValue('sk-bound');
    const credentials = await loadChannelCredentials({
      prisma: prismaOf([]),
      userId: 'u1',
      channelId: 0,
      token: 'sk-req',
    });
    expect(credentials.apiKey).toBe('sk-req');
    expect(credentials.provider).toBe('aipdd');
    expect(bound).not.toHaveBeenCalled();
  });

  it('无请求令牌（后台/重试/静默链路）：回落本人绑定的 Key，不再误报「请先绑定」', async () => {
    const bound = jest
      .spyOn(AipddKeyService.prototype, 'resolveToken')
      .mockResolvedValue('sk-bound');
    for (const token of [undefined, '', '   '] as const) {
      const credentials = await loadChannelCredentials({
        prisma: prismaOf([]),
        userId: 'u1',
        channelId: 0,
        token,
      });
      expect(credentials.apiKey).toBe('sk-bound');
    }
    expect(bound).toHaveBeenCalledTimes(3);
  });

  it('无请求令牌且未绑定：抛出可执行的绑定引导（403），不静默拿空 Key', async () => {
    jest
      .spyOn(AipddKeyService.prototype, 'resolveToken')
      .mockRejectedValue(
        new BusinessException(
          ErrorCode.FORBIDDEN,
          '请先在「模型服务 → API Key 管理」绑定 AIPDD API Key，再使用需要同步上游的功能',
        ),
      );
    await expect(
      loadChannelCredentials({
        prisma: prismaOf([]),
        userId: 'u1',
        channelId: 0,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    // 静默回落版：同一条链路拿不到 Key 时返回 null，由网关逐级回落
    expect(
      await tryChannelCredentials({
        prisma: prismaOf([]),
        userId: 'u1',
        channelId: 0,
      }),
    ).toBeNull();
  });
});
