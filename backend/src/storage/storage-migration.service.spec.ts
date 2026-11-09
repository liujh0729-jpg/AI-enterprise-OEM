import { StorageMigrationService } from './storage-migration.service';
import { assertOutboundUrl } from '../http/outbound-guard';
import { httpRequest } from '../http/transport';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from './storage.service';
import type { IdentityService } from '../identity/identity.service';

jest.mock('../http/outbound-guard', () => ({
  assertOutboundUrl: jest.fn(),
}));
jest.mock('../http/transport', () => ({
  httpRequest: jest.fn(),
}));

const assertOutboundMock = assertOutboundUrl as jest.MockedFunction<
  typeof assertOutboundUrl
>;
const httpMock = httpRequest as jest.MockedFunction<typeof httpRequest>;

function setup() {
  const prisma = {
    digitalAssetEntry: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    storageDailySnapshot: { findFirst: jest.fn() },
    modulePricing: { findUnique: jest.fn() },
  };
  const storage = { put: jest.fn() };
  const identity = { audit: jest.fn() };
  const service = new StorageMigrationService(
    stub<PrismaService>(prisma),
    stub<StorageService>(storage),
    stub<IdentityService>(identity),
  );
  return { prisma, storage, identity, service };
}

const legacyRow = {
  id: 7,
  userId: 'user-1',
  aipddAssetId: 42,
  type: 'file',
  name: '季度报告.pdf',
  url: 'https://cdn.example.test/report.pdf',
  previewUrl: '',
  fileSize: 1,
  ossKey: '',
  migratedFrom: '',
};

describe('StorageMigrationService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    assertOutboundMock.mockResolvedValue(new URL('https://cdn.example.test/'));
  });

  it('summarises local, legacy and migrated ledger rows', async () => {
    const { prisma, service } = setup();
    prisma.digitalAssetEntry.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4);
    prisma.digitalAssetEntry.aggregate.mockResolvedValue({
      _sum: { fileSize: 2048 },
    });
    prisma.storageDailySnapshot.findFirst.mockResolvedValue({
      snapshotAt: new Date('2026-11-07T00:30:00Z'),
      bytesAmount: 2048n * 1024n * 1024n,
      assetCount: 6,
    });
    prisma.modulePricing.findUnique.mockResolvedValue({
      unit: 'gb_day',
      unitPriceAmount: { toString: () => '0.1000' },
      enabled: 1,
    });

    const overview = await service.overview();

    expect(overview).toMatchObject({
      totalAssets: 10,
      localAssets: 6,
      migratedAssets: 2,
      legacyAssets: 4,
      storageMb: 2048,
      storageBytes: 2048 * 1024 * 1024,
      pricing: { unit: 'gb_day', unitPriceAmount: '0.1000', enabled: true },
    });
    expect(overview.lastSnapshot?.assets).toBe(6);
    expect(overview.lastSnapshot?.bytes).toBe(2048 * 1024 * 1024);
  });

  it('downloads a legacy asset, stores it in own OSS and updates the ledger', async () => {
    const { prisma, storage, identity, service } = setup();
    prisma.digitalAssetEntry.findMany.mockResolvedValue([legacyRow]);
    prisma.digitalAssetEntry.count.mockResolvedValue(0);
    httpMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      data: new Uint8Array(Buffer.from('pdf-bytes')),
    });
    storage.put.mockResolvedValue({
      key: 'asset/enterprise/user-1/migrated/report.pdf',
      url: 'https://oss.example.test/report.pdf',
      size: 9,
      contentType: 'application/pdf',
    });

    const result = await service.migrateBatch('admin-1', { limit: 20 });

    expect(assertOutboundUrl).toHaveBeenCalledWith(
      legacyRow.url,
      '数字资产地址',
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^enterprise\/user-1\/migrated\/\d+-[a-f0-9]+-季度报告\.pdf$/,
      ),
      Buffer.from('pdf-bytes'),
    );
    expect(prisma.digitalAssetEntry.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        ossKey: 'asset/enterprise/user-1/migrated/report.pdf',
        url: 'https://oss.example.test/report.pdf',
        migratedFrom: 'aipdd',
      }),
    });
    expect(result).toMatchObject({
      processed: 1,
      migrated: 1,
      failed: 0,
      nextCursor: 7,
      remaining: 0,
    });
    expect(identity.audit).toHaveBeenCalled();
  });

  it('keeps a failed row untouched so a rerun can retry it', async () => {
    const { prisma, storage, service } = setup();
    prisma.digitalAssetEntry.findMany.mockResolvedValue([legacyRow]);
    prisma.digitalAssetEntry.count.mockResolvedValue(1);
    httpMock.mockRejectedValue(new Error('上游连接失败'));

    const result = await service.migrateBatch('admin-1', { limit: 10 });

    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.digitalAssetEntry.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      processed: 1,
      migrated: 0,
      failed: 1,
      remaining: 1,
    });
    expect(result.results[0].reason).toContain('上游连接失败');
  });
});
