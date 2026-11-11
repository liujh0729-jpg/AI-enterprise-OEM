import type { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import {
  aipddApiKey,
  computeProviderSupported,
  loadChannelCredentials,
  tryChannelCredentials,
} from './ai-channels';
import { stub } from '../../test/doubles';

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
