import { randomBytes } from 'node:crypto';
import type { DigitalAssetEntry } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { assertOutboundUrl } from '../http/outbound-guard';
import { httpRequest } from '../http/transport';
import { AIPDD_MEDIA_MAX_BYTES } from '../content/aipdd-asset.client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

export type StorageOverview = {
  totalAssets: number;
  localAssets: number;
  legacyAssets: number;
  migratedAssets: number;
  storageMb: number;
  storageBytes: number;
  lastSnapshot: { at: string; bytes: number; assets: number } | null;
  pricing: {
    unit: string;
    unitPriceAmount: string;
    enabled: boolean;
  } | null;
};

export type StorageMigrationItem = {
  id: number;
  name: string;
  status: 'migrated' | 'failed';
  reason: string;
};

export type StorageMigrationResult = {
  processed: number;
  migrated: number;
  failed: number;
  nextCursor: number;
  remaining: number;
  results: StorageMigrationItem[];
};

const MIGRATION_BATCH_MAX = 100;
const MIGRATION_TIMEOUT_MS = 300_000;

function safeName(name: string) {
  return (
    String(name || '')
      .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'asset'
  );
}

function extensionOf(entry: DigitalAssetEntry) {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(entry.name || '')?.[1];
  if (fromName) return fromName.toLowerCase();
  try {
    const pathname = new URL(entry.url).pathname;
    const fromUrl = /\.([A-Za-z0-9]{1,8})$/.exec(pathname)?.[1];
    if (fromUrl) return fromUrl.toLowerCase();
  } catch {
    // URL 不合法时留空，交给后续下载环节报错。
  }
  return 'bin';
}

/**
 * 存量数字资产迁移（积分/OSS 方案 §2.2）：
 * AIPDD 托管的旧资产按批下载 → 写入本站 OSS → 回填台账；失败的记录不改台账，
 * 下次从头重跑会再次尝试，因此天然可中断续跑、失败可重试。
 */
export class StorageMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly identity: IdentityService,
  ) {}

  async overview(): Promise<StorageOverview> {
    const [
      totalAssets,
      localAssets,
      migratedAssets,
      legacyAssets,
      sum,
      snapshot,
      pricing,
    ] = await Promise.all([
      this.prisma.digitalAssetEntry.count(),
      this.prisma.digitalAssetEntry.count({ where: { ossKey: { not: '' } } }),
      this.prisma.digitalAssetEntry.count({
        where: { migratedFrom: 'aipdd' },
      }),
      this.prisma.digitalAssetEntry.count({ where: { ossKey: '' } }),
      this.prisma.digitalAssetEntry.aggregate({
        where: { ossKey: { not: '' } },
        _sum: { fileSize: true },
      }),
      this.prisma.storageDailySnapshot.findFirst({
        orderBy: { snapshotAt: 'desc' },
      }),
      this.prisma.modulePricing.findUnique({
        where: { code: 'asset_storage' },
      }),
    ]);
    const storageMb = Number(sum._sum.fileSize || 0);
    return {
      totalAssets,
      localAssets,
      legacyAssets,
      migratedAssets,
      storageMb: Number(storageMb.toFixed(4)),
      storageBytes: Math.round(storageMb * 1024 * 1024),
      lastSnapshot: snapshot
        ? {
            at: snapshot.snapshotAt.toISOString(),
            bytes: Number(snapshot.bytesAmount),
            assets: snapshot.assetCount,
          }
        : null,
      pricing: pricing
        ? {
            unit: pricing.unit,
            unitPriceAmount: pricing.unitPriceAmount.toString(),
            enabled: pricing.enabled === 1,
          }
        : null,
    };
  }

  async migrateBatch(
    adminUserId: string,
    input: { limit?: number; cursor?: number },
  ): Promise<StorageMigrationResult> {
    const limit = Math.min(
      MIGRATION_BATCH_MAX,
      Math.max(1, Math.floor(Number(input.limit) || 20)),
    );
    const cursor = Math.max(0, Math.floor(Number(input.cursor) || 0));
    const rows = await this.prisma.digitalAssetEntry.findMany({
      where: { ossKey: '', id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    const results: StorageMigrationItem[] = [];
    let migrated = 0;
    for (const entry of rows) {
      try {
        await this.migrateOne(entry);
        migrated += 1;
        results.push({
          id: entry.aipddAssetId,
          name: entry.name,
          status: 'migrated',
          reason: '',
        });
      } catch (error) {
        results.push({
          id: entry.aipddAssetId,
          name: entry.name,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const nextCursor = rows.length ? rows[rows.length - 1].id : cursor;
    const remaining = await this.prisma.digitalAssetEntry.count({
      where: { ossKey: '', id: { gt: nextCursor } },
    });
    await this.identity.audit(
      adminUserId,
      '存储底座迁移',
      `批次 ${rows.length} 条：成功 ${migrated}，失败 ${rows.length - migrated}，剩余 ${remaining}`,
    );
    return {
      processed: rows.length,
      migrated,
      failed: rows.length - migrated,
      nextCursor,
      remaining,
      results,
    };
  }

  private async migrateOne(entry: DigitalAssetEntry) {
    const url = String(entry.url || '').trim();
    if (!url) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '台账缺少原始地址');
    }
    await assertOutboundUrl(url, '数字资产地址');
    const response = await httpRequest<Uint8Array>(url, {
      readAs: 'bytes',
      maxBytes: AIPDD_MEDIA_MAX_BYTES,
      timeoutMs: MIGRATION_TIMEOUT_MS,
      operation: 'storage:migrate',
      redirect: 'error',
    });
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `下载失败（HTTP ${response.status}）`,
      );
    }
    const bytes = Buffer.from(response.data);
    if (!bytes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '源文件为空');
    }
    const ext = extensionOf(entry);
    const filename = safeName(entry.name).replace(/\.[A-Za-z0-9]{1,8}$/, '');
    const path = `enterprise/${entry.userId}/migrated/${Date.now()}-${randomBytes(4).toString('hex')}-${filename}.${ext}`;
    const uploaded = await this.storage.put(path, bytes);
    await this.prisma.digitalAssetEntry.update({
      where: { id: entry.id },
      data: {
        ossKey: uploaded.key,
        url: uploaded.url,
        previewUrl: uploaded.url,
        fileSize: uploaded.size / 1024 / 1024,
        migratedFrom: 'aipdd',
      },
    });
  }
}
