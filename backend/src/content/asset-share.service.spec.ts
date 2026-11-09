import { CurrentUser } from '../auth/current-user';
import type { UserLookupService } from '../directory/user-lookup.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AssetShareService } from './asset-share.service';
import { stub } from '../../test/doubles';

const user = (userId: string) => new CurrentUser(userId, userId, 'user');

type PrismaPatch = Record<string, unknown>;

const prismaOf = (patch: PrismaPatch = {}) =>
  stub<PrismaService>({
    enterpriseProfile: { findFirst: jest.fn(async () => null) },
    orgStaff: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    providerStaff: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    providerApplication: { findFirst: jest.fn(async () => null) },
    staffProfile: { findMany: jest.fn(async () => []) },
    digitalAssetEntry: { findUnique: jest.fn(async () => null) },
    contentSharedAsset: { upsert: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    ...patch,
  });

const usersOf = () => ({
  lookup: jest.fn(async (ids: string[]) =>
    ids.map((id) => ({
      id,
      username: id,
      displayName: `账号${id}`,
      avatarUrl: null,
      personalIntro: null,
      enabled: true,
      createdAt: '',
    })),
  ),
});

const makeShare = (
  prisma: ReturnType<typeof prismaOf>,
  users: ReturnType<typeof usersOf>,
) => new AssetShareService(prisma, stub<UserLookupService>(users));

describe('共享资料：组织口径', () => {
  it('企业成员仍按企业共享（含企业主，不含本人）', async () => {
    const prisma = prismaOf({
      enterpriseProfile: {
        findFirst: jest.fn(async () => ({
          userId: 'ent-owner',
          name: '某某科技',
        })),
      },
      orgStaff: {
        findFirst: jest.fn(async () => ({ orgUserId: 'ent-owner' })),
        findMany: jest.fn(async () => [
          { memberUserId: 'ent-staff', department: '市场部' },
        ]),
      },
    });
    const users = usersOf();
    const targets = await makeShare(prisma, users).targets(user('ent-staff'));
    expect(targets.orgName).toBe('某某科技');
    expect(targets.users.map((item) => item.userId)).toEqual(['ent-owner']);
  });

  it('服务商职员可以看到同服务商的其他职员与负责人', async () => {
    const prisma = prismaOf({
      providerStaff: {
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            where.providerUserId ? null : { providerUserId: 'provider-owner' },
        ),
        findMany: jest.fn(async () => [
          { staffUserId: 'provider-staff', department: '交付部' },
          { staffUserId: 'provider-staff-2', department: '' },
        ]),
      },
      providerApplication: {
        findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === 'provider-owner' ? { orgName: '某某服务商' } : null,
        ),
      },
    });
    const users = usersOf();
    const targets = await makeShare(prisma, users).targets(
      user('provider-staff'),
    );
    expect(targets.orgName).toBe('某某服务商');
    expect(targets.users.map((item) => item.userId)).toEqual([
      'provider-owner',
      'provider-staff-2',
    ]);
    expect(targets.users[0].department).toBe('');
  });

  it('服务商负责人合并新旧两张挂靠表的在职职员', async () => {
    const prisma = prismaOf({
      providerStaff: {
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            where.providerUserId ? { id: 1 } : null,
        ),
        findMany: jest.fn(async () => [
          { staffUserId: 'legacy-staff', department: '老表部门' },
        ]),
      },
      orgStaff: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => [
          { memberUserId: 'new-staff', department: '新表部门' },
          { memberUserId: 'legacy-staff', department: '' },
        ]),
      },
      providerApplication: {
        findFirst: jest.fn(async () => ({ orgName: '某某服务商' })),
      },
    });
    const users = usersOf();
    const targets = await makeShare(prisma, users).targets(
      user('provider-owner'),
    );
    expect(targets.users.map((item) => item.userId)).toEqual([
      'legacy-staff',
      'new-staff',
    ]);
    expect(targets.users[0].department).toBe('老表部门');
  });

  it('既不是企业也不是服务商时没有共享目标', async () => {
    const targets = await makeShare(prismaOf(), usersOf()).targets(
      user('nobody'),
    );
    expect(targets).toEqual({ orgName: '', users: [] });
  });

  it('服务商职员共享时只允许同服务商成员', async () => {
    const upsert = jest.fn(async () => ({}));
    const prisma = prismaOf({
      providerStaff: {
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            where.providerUserId ? null : { providerUserId: 'provider-owner' },
        ),
        findMany: jest.fn(async () => [
          { staffUserId: 'provider-staff', department: '' },
        ]),
      },
      providerApplication: {
        findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === 'provider-owner' ? { orgName: '某某服务商' } : null,
        ),
      },
      digitalAssetEntry: {
        findUnique: jest.fn(async () => ({
          aipddAssetId: 9,
          name: 'poster.png',
          type: 'image',
          fileSize: 12,
          url: 'https://cdn.example.com/poster.png',
        })),
      },
      contentSharedAsset: { upsert },
    });
    const result = await makeShare(prisma, usersOf()).share(
      user('provider-staff'),
      {
        asset: { id: '9' },
        targetUserIds: ['provider-owner', 'outsider'],
      },
    );
    expect(result).toEqual({ shared: 1 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ targetUserId: 'provider-owner' }),
      }),
    );
  });
});
