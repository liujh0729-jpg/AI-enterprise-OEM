import { AssetVisionService } from './vision.service';
import { aiEmbed, tryChat } from '../ai/ai-gateway';
import type { AiChatOutput } from '../ai/ai-gateway';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import {
  hashEmbed,
  LOCAL_EMBED_ID,
  remoteEmbedId,
} from '../ai/retrieval-kernel';

jest.mock('../ai/ai-gateway', () => ({
  ...jest.requireActual<typeof import('../ai/ai-gateway')>('../ai/ai-gateway'),
  tryChat: jest.fn(),
  aiEmbed: jest.fn(),
}));

const mockedChat = tryChat as jest.MockedFunction<typeof tryChat>;
const mockedEmbed = aiEmbed as jest.MockedFunction<typeof aiEmbed>;

function service() {
  return new AssetVisionService(stub<PrismaService>());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AssetVisionService.understand', () => {
  it('模型可用时图片走视觉槽位并解析摘要与标签', async () => {
    mockedChat.mockResolvedValue(
      stub<AiChatOutput>({
        reply: '{"caption":"夏日促销海报","labels":["海报","促销","人物"]}',
        model: 'qwen-vl',
      }),
    );
    const out = await service().understand('u1', {
      name: 'promo.png',
      type: 'image',
      url: 'https://cdn.example.com/promo.png',
    });
    expect(mockedChat.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      mediaType: 'vision',
      module: 'assets',
      operation: 'asset_vision',
    });
    expect(out).toMatchObject({
      kind: 'image',
      caption: '夏日促销海报',
      labels: ['海报', '促销', '人物'],
      model: 'qwen-vl',
      mode: 'llm',
    });
  });

  it('缺模型时回落规则兜底：文件名去时间戳可当标签', async () => {
    mockedChat.mockResolvedValue(null);
    const out = await service().understand('u1', {
      name: '202401011234-summer_poster.png',
      type: 'image',
      url: 'https://cdn.example.com/p.png',
    });
    expect(out.mode).toBe('rule');
    expect(out.labels).toEqual(['summer_poster', 'image']);
  });

  it('文档理解走文本模型，正文截断到 6000 字', async () => {
    mockedChat.mockResolvedValue(
      stub<AiChatOutput>({
        reply: '{"caption":"第三季度财报","labels":["财务","财报"]}',
        model: 'gpt-text',
      }),
    );
    const out = await service().understand('u1', {
      name: 'q3.pdf',
      type: 'file',
      url: 'https://cdn.example.com/q3.pdf',
      text: 'x'.repeat(9000),
    });
    const request = mockedChat.mock.calls[0][1] as {
      mediaType: string;
      messages: { content: string }[];
    };
    expect(request.mediaType).toBe('text');
    expect(request.messages[1].content.length).toBeLessThan(6200);
    expect(out).toMatchObject({
      kind: 'text',
      caption: '第三季度财报',
      mode: 'llm',
    });
  });

  it('模型抛错不抛穿，仍返回规则兜底', async () => {
    mockedChat.mockRejectedValue(new Error('upstream down'));
    const out = await service().understand('u1', {
      name: 'clip.png',
      type: 'image',
      url: 'https://cdn.example.com/clip.png',
    });
    expect(out.mode).toBe('rule');
    expect(out.labels).toEqual(['clip', 'image']);
  });
});

describe('AssetVisionService.embedMany', () => {
  it('远端向量可用时整批用同一模型标识', async () => {
    mockedEmbed.mockResolvedValue({
      model: 'text-embedding-3-small',
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
    const out = await service().embedMany('u1', ['a', 'b']);
    expect(out.model).toBe(remoteEmbedId('text-embedding-3-small'));
    expect(out.vectors).toHaveLength(2);
  });

  it('远端不可用时整批回落本地袋装，避免混算余弦', async () => {
    mockedEmbed.mockResolvedValue(null);
    const out = await service().embedMany('u1', ['海报']);
    expect(out.model).toBe(LOCAL_EMBED_ID);
    expect(out.vectors).toEqual([hashEmbed('海报')]);
  });

  it('远端向量数量不齐时也整批回落本地', async () => {
    mockedEmbed.mockResolvedValue({ model: 'm', vectors: [[0.1]] });
    const out = await service().embedMany('u1', ['a', 'b']);
    expect(out.model).toBe(LOCAL_EMBED_ID);
    expect(out.vectors).toHaveLength(2);
  });
});
