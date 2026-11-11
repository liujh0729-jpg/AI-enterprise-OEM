import { EXTENSION_CAPABILITIES } from '@enterprise/contracts';
import { stub } from '../../test/doubles';
import { BusinessException } from '../common/business.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { ExtensionCatalogService } from './extension-catalog.service';

/** 平台覆盖行（与服务端读到的列同形）。 */
type OverrideRow = {
  key: string;
  status: string;
  minVersion: string;
  grayOrgIds: unknown;
  forceUpgradeAt: Date | null;
  note: string;
  updatedBy: string;
};

/** 只实现被测服务实际用到的三个 Prisma 方法，写入落内存 Map 便于断言。 */
function prismaStub(rows: OverrideRow[] = []) {
  const store = new Map<string, OverrideRow>(rows.map((row) => [row.key, row]));
  return stub<PrismaService>({
    extensionCapability: {
      findMany: async () => [...store.values()],
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.get(where.key) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: OverrideRow;
        update: Partial<OverrideRow>;
      }) => {
        const prev = store.get(where.key);
        const next = prev ? { ...prev, ...update } : create;
        store.set(where.key, next);
        return next;
      },
    },
  });
}

/**
 * 平台统一插件能力目录（§10.7）：能力定义在契约层，本服务只叠加平台覆盖——
 * 无覆盖行回落契约默认，有覆盖行以库为准，供前端入口与派发前版本门槛共用同一份口径。
 */
describe('ExtensionCatalogService', () => {
  it('无覆盖行时能力目录回落契约默认', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    const catalog = await service.catalog();
    expect(catalog.capabilities).toHaveLength(EXTENSION_CAPABILITIES.length);
    const [distribution, acquisition] = catalog.capabilities;
    expect(distribution.key).toBe(EXTENSION_CAPABILITIES[0].key);
    expect(distribution.status).toBe(EXTENSION_CAPABILITIES[0].status);
    expect(distribution.statusLabel).toBe('已启用');
    expect(distribution.minVersion).toBe(EXTENSION_CAPABILITIES[0].minVersion);
    expect(distribution.grayOrgIds).toEqual([]);
    expect(distribution.forceUpgradeAt).toBeNull();
    expect(acquisition.key).toBe(EXTENSION_CAPABILITIES[1].key);
  });

  it('发布信息与能力清单并列返回，release 不重复能力字段', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    const catalog = await service.catalog();
    expect(catalog.release.version).toBeTruthy();
    expect(typeof catalog.release.published).toBe('boolean');
    expect('capabilities' in catalog.release).toBe(false);
  });

  it('平台覆盖优先：状态 / 最低版本 / 灰度 / 强制升级以库为准', async () => {
    const forceAt = new Date('2026-12-01T00:00:00.000Z');
    const service = new ExtensionCatalogService(
      prismaStub([
        {
          key: 'acquisition',
          status: 'GRAY',
          minVersion: '1.4.0',
          grayOrgIds: ['org-1', 2, '  '],
          forceUpgradeAt: forceAt,
          note: '灰度中',
          updatedBy: 'admin',
        },
      ]),
    );
    const catalog = await service.catalog();
    const acquisition = catalog.capabilities[1];
    expect(acquisition.status).toBe('GRAY');
    expect(acquisition.statusLabel).toBe('灰度中');
    expect(acquisition.minVersion).toBe('1.4.0');
    // 非字符串与空白一律丢弃
    expect(acquisition.grayOrgIds).toEqual(['org-1']);
    expect(acquisition.forceUpgradeAt).toBe(forceAt.toISOString());
    expect(acquisition.note).toBe('灰度中');
  });

  it('effective 对契约里不存在的能力返回 undefined', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    expect(await service.effective('nope')).toBeUndefined();
  });

  it('effective 叠加平台覆盖，供派发前版本门槛使用', async () => {
    const service = new ExtensionCatalogService(
      prismaStub([
        {
          key: 'distribution',
          status: 'DEPRECATED',
          minVersion: '2.0.0',
          grayOrgIds: [],
          forceUpgradeAt: null,
          note: '',
          updatedBy: 'admin',
        },
      ]),
    );
    const effective = await service.effective('distribution');
    expect(effective).toMatchObject({
      key: 'distribution',
      status: 'DEPRECATED',
      minVersion: '2.0.0',
      grayOrgIds: [],
      forceUpgradeAt: null,
    });
  });

  it('effective 无覆盖行时取契约默认状态与最低版本', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    const effective = await service.effective('acquisition');
    expect(effective?.status).toBe(EXTENSION_CAPABILITIES[1].status);
    expect(effective?.minVersion).toBe(EXTENSION_CAPABILITIES[1].minVersion);
  });

  it('save 拒绝契约里不存在的能力', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    await expect(service.save('nope', {}, 'admin')).rejects.toBeInstanceOf(
      BusinessException,
    );
  });

  it('save 写入覆盖并返回合并视图；未提供字段保留、null 清空强制升级时间', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    const saved = await service.save(
      'distribution',
      {
        status: 'GRAY',
        grayOrgIds: ['a'],
        forceUpgradeAt: '2026-12-01T00:00:00.000Z',
      },
      'admin-1',
    );
    expect(saved.status).toBe('GRAY');
    expect(saved.grayOrgIds).toEqual(['a']);
    expect(saved.forceUpgradeAt).toBe('2026-12-01T00:00:00.000Z');

    const cleared = await service.save(
      'distribution',
      { forceUpgradeAt: null },
      'admin-1',
    );
    expect(cleared.status).toBe('GRAY');
    expect(cleared.forceUpgradeAt).toBeNull();
  });

  it('save 拒绝非法强制升级时间', async () => {
    const service = new ExtensionCatalogService(prismaStub());
    await expect(
      service.save('distribution', { forceUpgradeAt: 'not-a-date' }, 'admin'),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
