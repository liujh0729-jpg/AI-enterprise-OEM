jest.mock('../geo/geo-llm.client', () => ({
  geoChatMulti: jest.fn(),
  geoChatStream: jest.fn(),
  geoEmbed: jest.fn(),
}));

// 渠道凭据解算（含 AES-GCM 解密与 AIPDD Key 绑定）另测；此处只喂网关阶梯需要的「有没有凭据」。
jest.mock('./ai-channels', () => ({
  tryChannelCredentials: jest.fn(async (input: { channelId: number }) => {
    const channel = mockChannels[String(input.channelId)];
    if (!channel) return null;
    return {
      baseUrl: `https://ch${input.channelId}.example/v1`,
      apiKey: 'sk-ch',
      provider: 'custom',
      protocol: channel.protocol,
    };
  }),
  aipddApiKey: jest.fn(async () => 'sk-aipdd'),
}));

import { geoChatMulti } from '../geo/geo-llm.client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  aiJson,
  parseJsonObject,
  registerAiMetering,
  resolveModel,
} from './ai-gateway';
import { stub } from '../../test/doubles';

const mockChannels: Record<string, { protocol: 'openai' | 'anthropic' }> = {};

const prismaOf = (rows: Record<string, unknown>) =>
  stub<PrismaService>({
    contentModelSlot: {
      findUnique: async ({
        where,
      }: {
        where: { userId_mediaType: { mediaType: string } };
      }) => rows[`slot:${where.userId_mediaType.mediaType}`] ?? null,
    },
    rpaLlmSetting: { findUnique: async () => rows['rpa'] ?? null },
    workbuddyLlmSetting: { findUnique: async () => rows['workbuddy'] ?? null },
  });

const chatReply = (model: string, reply = '```json\n{"a":1}\n```') => ({
  reply,
  model,
  promptTokens: 11,
  completionTokens: 7,
  elapsedMs: 5,
});

describe('统一网关取模型阶梯', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockChannels)) delete mockChannels[key];
    mockChannels['9'] = { protocol: 'openai' };
    mockChannels['4'] = { protocol: 'anthropic' };
  });

  it('本轮显式选择优先于模块默认与账号默认渠道', async () => {
    mockChannels['3'] = { protocol: 'openai' };
    const model = await resolveModel(
      prismaOf({ 'slot:text': { channelId: 3, model: 'account-model' } }),
      {
        userId: 'u1',
        model: 'pick-model',
        channelId: 9,
        moduleModel: 'module-model',
      },
    );
    expect(model?.source).toBe('override');
    expect(model?.model).toBe('pick-model');
    expect(model?.channelId).toBe(9);
    expect(model?.baseUrl).toBe('https://ch9.example/v1');
  });

  it('显式模型没配渠道时落在账号默认渠道上', async () => {
    const model = await resolveModel(
      prismaOf({ 'slot:text': { channelId: 9, model: 'account-model' } }),
      { userId: 'u1', model: 'pick-model' },
    );
    expect(model?.channelId).toBe(9);
    expect(model?.source).toBe('override');
  });

  it('按 模块默认 → 账号默认 → 历史口径 逐级回落', async () => {
    mockChannels['2'] = { protocol: 'openai' };
    const prisma = prismaOf({
      'slot:text': { channelId: 0, model: 'account-model' },
      rpa: { model: 'legacy-model' },
    });
    expect(
      (
        await resolveModel(prisma, {
          userId: 'u1',
          moduleModel: 'module-model',
          moduleChannelId: 2,
        })
      )?.source,
    ).toBe('module');

    const accountHit = await resolveModel(prisma, { userId: 'u1' });
    expect(accountHit?.source).toBe('account');
    expect(accountHit?.channelId).toBe(0);
    expect(accountHit?.apiKey).toBe('sk-aipdd');

    const legacy = await resolveModel(
      prismaOf({ rpa: { model: 'legacy-model' } }),
      { userId: 'u1', skipAccountSlot: true },
    );
    expect(legacy?.source).toBe('legacy');
    expect(legacy?.model).toBe('legacy-model');
  });

  it('四级都凑不齐时返回 null，调用方可走规则式兜底', async () => {
    expect(
      await resolveModel(
        prismaOf({ 'slot:text': { channelId: 88, model: 'x' } }),
        {
          userId: 'u1',
        },
      ),
    ).toBeNull();
  });

  it('账号槽位模型为空视为未配置，继续往历史口径回落', async () => {
    const model = await resolveModel(
      prismaOf({
        'slot:text': { channelId: 9, model: '  ' },
        rpa: { model: 'legacy-model' },
      }),
      { userId: 'u1' },
    );
    expect(model?.source).toBe('legacy');
  });
});

describe('统一网关结构化产出与方言', () => {
  it('Anthropic 渠道以 api=anthropic 发请求，并把用量连同板块/动作交给统一计量', async () => {
    const charge = jest.fn(async () => true);
    const record = jest.fn(async () => undefined);
    registerAiMetering({ charge, record });
    mockChannels['4'] = { protocol: 'anthropic' };
    jest.mocked(geoChatMulti).mockResolvedValue(chatReply('claude-x'));
    const result = await aiJson(
      prismaOf({ 'slot:text': { channelId: 4, model: 'claude-x' } }),
      {
        userId: 'u1',
        messages: [{ role: 'user', content: 'hi' }],
        charge: { code: 'SEO_AUDIT' },
        module: 'seo',
        operation: 'audit_interpret',
      },
    );
    expect(result?.data).toEqual({ a: 1 });
    expect(result?.source).toBe('account');
    const input = jest.mocked(geoChatMulti).mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(input.api).toBe('anthropic');
    expect(charge).toHaveBeenCalledWith(
      'u1',
      'SEO_AUDIT',
      { tokenIn: 11, tokenOut: 7, call: 1 },
      '',
      { module: 'seo', operation: 'audit_interpret', model: 'claude-x' },
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('不带科目：只落用量事实，绝不扣分（既有链路扣费行为不变）', async () => {
    const charge = jest.fn(async () => true);
    const record = jest.fn(async () => undefined);
    registerAiMetering({ charge, record });
    jest.mocked(geoChatMulti).mockResolvedValue(chatReply('m'));
    await aiJson(prismaOf({ rpa: { model: 'm' } }), {
      userId: 'u1',
      module: 'rpa',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(charge).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      'u1',
      { tokenIn: 11, tokenOut: 7, call: 1 },
      { module: 'rpa', operation: 'chat', model: 'm' },
    );
  });

  it('模型不给合法 JSON、上游直接失败都静默降级为 null', async () => {
    registerAiMetering({
      charge: async () => true,
      record: async () => undefined,
    });
    jest
      .mocked(geoChatMulti)
      .mockResolvedValue(chatReply('m', '抱歉，我无法输出 JSON'));
    expect(
      await aiJson(prismaOf({ rpa: { model: 'm' } }), {
        userId: 'u1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toBeNull();

    jest.mocked(geoChatMulti).mockRejectedValue(new Error('upstream 500'));
    expect(
      await aiJson(prismaOf({ rpa: { model: 'm' } }), {
        userId: 'u1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toBeNull();
  });
});

describe('parseJsonObject', () => {
  it('剥围栏并忽略前后说明文字', () => {
    expect(
      parseJsonObject('好的：\n```json\n{"a":{"b":2}}\n```\n以上')?.a,
    ).toEqual({ b: 2 });
  });

  it('数组与坏 JSON 一律 null', () => {
    expect(parseJsonObject('[1,2]')).toBeNull();
    expect(parseJsonObject('{"a":')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
  });
});
