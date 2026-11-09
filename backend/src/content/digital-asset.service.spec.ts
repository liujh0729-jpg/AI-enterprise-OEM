import { DigitalAssetService } from './digital-asset.service';
import { aiEmbed, tryChat } from '../ai/ai-gateway';
import type { AiChatOutput } from '../ai/ai-gateway';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ContentModelSettingService } from './model-setting.service';
import { AipddAssetClient } from './aipdd-asset.client';
import { PublishReviewService } from '../moderation/publish-review.service';
import { stub } from '../../test/doubles';

jest.mock('../ai/ai-gateway', () => ({
  ...jest.requireActual<typeof import('../ai/ai-gateway')>('../ai/ai-gateway'),
  tryChat: jest.fn(),
  aiEmbed: jest.fn(),
}));

const mockedChat = tryChat as jest.MockedFunction<typeof tryChat>;
const mockedEmbed = aiEmbed as jest.MockedFunction<typeof aiEmbed>;

type Row = {
  id: number;
  userId: string;
  aipddAssetId: number;
  type: string;
  name: string;
  url: string;
  previewUrl: string;
  fileSize: number;
  labels: unknown;
  ossKey: string;
  caption: string | null;
  text: string | null;
  embedding: unknown;
  embedModel: string;
  moderation: string;
  moderationNote: string;
  moderationTaskId: string;
  createdAt: Date;
  updatedAt: Date;
};

function entry(patch: Partial<Row> = {}): Row {
  return {
    id: 9,
    userId: 'u1',
    aipddAssetId: -9,
    type: 'image',
    name: 'poster.png',
    url: 'https://cdn.example.com/poster.png',
    previewUrl: 'https://cdn.example.com/poster.png',
    fileSize: 0.2,
    labels: ['人工标签'],
    ossKey: 'enterprise/u1/library/poster.png',
    caption: null,
    text: null,
    embedding: null,
    embedModel: '',
    moderation: '',
    moderationNote: '',
    moderationTaskId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

function setup(row: Row = entry()) {
  const prisma = {
    digitalAssetEntry: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    },
  };
  const identity = { audit: jest.fn() };
  const storage = { read: jest.fn() };
  const service = new DigitalAssetService(
    stub<PrismaService>(prisma),
    stub<ContentModelSettingService>(),
    stub<AipddAssetClient>(),
    stub<IdentityService>(identity),
    stub<StorageService>(storage),
    stub<PublishReviewService>(),
  );
  return { service, prisma, identity, storage };
}

const user = new CurrentUser('u1', 'tester', 'user');

beforeEach(() => {
  jest.clearAllMocks();
  mockedChat.mockResolvedValue(
    stub<AiChatOutput>({
      reply: '{"caption":"一张促销海报","labels":["海报","促销"]}',
      model: 'vision-model',
    }),
  );
  mockedEmbed.mockResolvedValue({
    model: 'text-embed',
    vectors: [[0.1, 0.2]],
  });
});

describe('DigitalAssetService.autoTag', () => {
  it('persist=false 只回候选：合并已有标签但不写台账', async () => {
    const { service, prisma, identity } = setup();
    const out = await service.autoTag(user, '9', { persist: false });
    expect(out.labels).toEqual(['人工标签', '海报', '促销']);
    expect(prisma.digitalAssetEntry.update).not.toHaveBeenCalled();
    expect(identity.audit).not.toHaveBeenCalled();
  });

  it('persist=true 写回摘要/合并标签/向量并留痕', async () => {
    const { service, prisma, identity } = setup();
    const out = await service.autoTag(user, '9', { persist: true });
    expect(out.caption).toBe('一张促销海报');
    const data = prisma.digitalAssetEntry.update.mock.calls[0][0].data as {
      caption: string;
      labels: string[];
      embedding: number[];
      embedModel: string;
    };
    expect(data.caption).toBe('一张促销海报');
    expect(data.labels).toEqual(['人工标签', '海报', '促销']);
    expect(data.embedding).toEqual([0.1, 0.2]);
    expect(data.embedModel).toBe('embed:text-embed');
    expect(identity.audit).toHaveBeenCalledWith(
      'u1',
      '数字资产自动打标',
      expect.stringContaining('#-9'),
    );
  });

  it('台账没有正文的可读文档按对象键回读后再理解', async () => {
    const { service, storage } = setup(
      entry({
        type: 'file',
        name: 'report.md',
        caption: null,
        text: null,
        labels: [],
      }),
    );
    storage.read.mockResolvedValue(Buffer.from('# 季度报告\n\n营收增长 20%'));
    await service.autoTag(user, '9', { persist: false });
    const input = mockedChat.mock.calls[0][1] as {
      mediaType: string;
      messages: { content: string }[];
    };
    expect(storage.read).toHaveBeenCalledWith(
      'enterprise/u1/library/poster.png',
    );
    expect(input.mediaType).toBe('text');
    expect(input.messages[1].content).toContain('营收增长 20%');
  });

  it('OSS 读不到正文时不抛穿，按规则口径继续给候选', async () => {
    const { service, storage } = setup(
      entry({ type: 'file', name: 'report.md', text: null, labels: [] }),
    );
    storage.read.mockRejectedValue(new Error('oss down'));
    const out = await service.autoTag(user, '9', { persist: false });
    expect(out.mode).toBe('rule');
    expect(mockedChat).not.toHaveBeenCalled();
  });
});
