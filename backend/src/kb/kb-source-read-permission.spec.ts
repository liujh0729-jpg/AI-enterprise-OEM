import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { KbSourceService } from './kb-source.service';
import { KbSpaceService } from './kb-space.service';

const user = new CurrentUser('u1', 'owner', 'user');

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    spaceId: 7,
    assetId: 5,
    kind: 'article',
    type: 'OCR',
    originUrl: '',
    title: 'T',
    hash: 'h',
    status: 'INGESTED',
    error: '',
    text: '正文内容',
    ingestedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'u1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type CreateArgs = { data: Record<string, unknown> };

function build(prisma: PrismaService, spaces: KbSpaceService) {
  return new KbSourceService(prisma, spaces);
}

function spacesStub(): KbSpaceService {
  return stub<KbSpaceService>({
    loadWritable: jest.fn(async (id: number) => ({ id })),
  });
}

describe('KbSourceService：引用数字资产需同时校验来源读权限', () => {
  it('本人资产：可直接引用并取用其正文', async () => {
    const created: CreateArgs[] = [];
    const prisma = stub<PrismaService>({
      digitalAssetEntry: {
        findUnique: jest.fn(async () => ({
          id: 5,
          userId: 'u1',
          aipddAssetId: 55,
          text: '正文内容',
          ossKey: 'oss/key',
        })),
      },
      contentSharedAsset: { findFirst: jest.fn(async () => null) },
      kbLog: { create: jest.fn(async () => ({})) },
      kbSource: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: CreateArgs) => {
          created.push(args);
          return sourceRow();
        }),
      },
    });
    const service = build(prisma, spacesStub());
    await service.addSource(
      { spaceId: 7, kind: 'article', title: 'T', text: '', assetId: 5 },
      user,
    );
    expect(created[0].data.text).toBe('正文内容');
  });

  it('他人资产且未共享：按不存在拒绝且不落资料', async () => {
    const create = jest.fn(async () => sourceRow());
    const prisma = stub<PrismaService>({
      digitalAssetEntry: {
        findUnique: jest.fn(async () => ({
          id: 5,
          userId: 'u2',
          aipddAssetId: 55,
          text: '他人秘密正文',
          ossKey: '',
        })),
      },
      contentSharedAsset: { findFirst: jest.fn(async () => null) },
      kbSource: { findFirst: jest.fn(async () => null), create },
    });
    const service = build(prisma, spacesStub());
    await expect(
      service.addSource(
        { spaceId: 7, kind: 'article', title: 'T', text: '', assetId: 5 },
        user,
      ),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(create).not.toHaveBeenCalled();
  });

  it('他人资产但已共享给本人：放行', async () => {
    const created: CreateArgs[] = [];
    const prisma = stub<PrismaService>({
      digitalAssetEntry: {
        findUnique: jest.fn(async () => ({
          id: 5,
          userId: 'u2',
          aipddAssetId: 55,
          text: '共享正文',
          ossKey: '',
        })),
      },
      contentSharedAsset: { findFirst: jest.fn(async () => ({ id: 1 })) },
      kbLog: { create: jest.fn(async () => ({})) },
      kbSource: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: CreateArgs) => {
          created.push(args);
          return sourceRow();
        }),
      },
    });
    const service = build(prisma, spacesStub());
    await service.addSource(
      { spaceId: 7, kind: 'article', title: 'T', text: '', assetId: 5 },
      user,
    );
    expect(created[0].data.text).toBe('共享正文');
  });
});
