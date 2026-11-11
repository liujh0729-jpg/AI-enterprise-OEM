import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AcquisitionSettingsService } from './acquisition-settings.service';
import type { BrowserTaskService } from '../platform/browser-task.service';
import type { ExtensionCatalogService } from '../platform/extension-catalog.service';
import {
  AcquisitionPluginBridgeService,
  type AcqPluginJobKind,
} from './plugin-bridge.service';
import { stub } from '../../test/doubles';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

type TokenRow = {
  id: number;
  tokenHash: string;
  userId: string;
  scope: string;
  orgType: string;
  orgUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

/** 内存替身模拟 Prisma：跨服务实例共享同一份「库」，用来说明重启后令牌仍有效。 */
function build() {
  const rows: TokenRow[] = [];
  let seq = 0;
  const prisma = {
    pluginSessionToken: {
      create: jest.fn(async ({ data }: { data: Partial<TokenRow> }) => {
        const row: TokenRow = {
          id: ++seq,
          tokenHash: data.tokenHash ?? '',
          userId: data.userId ?? '',
          scope: data.scope ?? '',
          orgType: data.orgType ?? 'ENTERPRISE',
          orgUserId: data.orgUserId ?? '',
          expiresAt: data.expiresAt ?? new Date(),
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      deleteMany: jest.fn(
        async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
          const keep = rows.filter(
            (row) => row.expiresAt >= where.expiresAt.lt,
          );
          const removed = rows.length - keep.length;
          rows.length = 0;
          rows.push(...keep);
          return { count: removed };
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<TokenRow>;
        }) => {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return row ?? data;
        },
      ),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const settings = {
    org: jest.fn(async () => ({ orgType: 'ENTERPRISE', orgUserId: 'ent-a' })),
    forOrg: jest.fn(async () => ({
      enabled: true,
      intervalMinSeconds: 20,
      intervalMaxSeconds: 60,
    })),
  };
  const standing = { value: true };
  const scope = {
    isStanding: jest.fn(async () => standing.value),
  };
  const claim = jest.fn(async () => [{ id: 1 }]);
  const catalog = { assertDispatchable: jest.fn(async () => ({})) };
  // 统一任务队列：启动即落一条浏览器任务，规格里只关心「被调用」，不做真实落库。
  const tasks = {
    dispatch: jest.fn(async () => ({ id: 1 })),
    recordReceipt: jest.fn(async () => ({ recorded: true })),
  };
  const service = new AcquisitionPluginBridgeService(
    stub<PrismaService>(prisma),
    stub<AcquisitionSettingsService>(settings),
    stub<HrmScopeService>(scope),
    stub<ExtensionCatalogService>(catalog),
    stub<BrowserTaskService>(tasks),
  );
  const kind: AcqPluginJobKind = {
    type: 'collect',
    claim,
    report: jest.fn(async () => ({ newLeads: 1 })),
  };
  service.register(kind);
  return {
    service,
    prisma,
    settings,
    scope,
    standing,
    rows,
    claim,
    catalog,
    tasks,
  };
}

const USER = new CurrentUser('u1', '张三', 'member');

describe('插件令牌落库', () => {
  it('签发时只落哈希，明文不回库且写一条签发审计', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });

    expect(res.token).toMatch(/^[0-9a-f]{48}$/);
    expect(ctx.rows[0].tokenHash).toBe(sha256(res.token));
    expect(JSON.stringify(ctx.rows)).not.toContain(res.token);
    expect(ctx.rows[0]).toMatchObject({
      userId: 'u1',
      scope: 'collect',
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
    });
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('进程重启后（新实例、空内存）令牌仍按库中行校验通过', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });

    // 新实例只共享 prisma 替身，内存里的任何缓存都不复存在。
    const fresh = new AcquisitionPluginBridgeService(
      stub<PrismaService>(ctx.prisma),
      stub<AcquisitionSettingsService>(ctx.settings),
      stub<HrmScopeService>(ctx.scope),
      stub<ExtensionCatalogService>(ctx.catalog),
      stub<BrowserTaskService>(ctx.tasks),
    );
    fresh.register({
      type: 'collect',
      claim: ctx.claim,
      report: jest.fn(async () => ({})),
    });

    const out = await fresh.pull({ token: res.token });
    expect(out.jobs).toHaveLength(1);
    expect(ctx.claim).toHaveBeenCalledTimes(1);
  });

  it('过期令牌拒绝，且未知令牌一律 401', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });
    ctx.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(ctx.service.pull({ token: res.token })).rejects.toThrow(
      /令牌无效或已过期/,
    );
    await expect(ctx.service.pull({ token: 'nope' })).rejects.toThrow(
      /令牌无效或已过期/,
    );
  });

  it('已撤销令牌即使未过期也拒绝', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });
    ctx.rows[0].revokedAt = new Date();

    await expect(ctx.service.pull({ token: res.token })).rejects.toThrow(
      /令牌无效或已过期/,
    );
  });

  it('拉取类型与令牌 scope 不符即 403', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });

    await expect(
      ctx.service.pull({ token: res.token, type: 'outreach' }),
    ).rejects.toThrow(/不能拉取其他类型/);
    expect(ctx.claim).not.toHaveBeenCalled();
  });

  it('获客关闭时既不签发也不拉取', async () => {
    const ctx = build();
    ctx.settings.forOrg.mockResolvedValue({
      enabled: false,
      intervalMinSeconds: 20,
      intervalMaxSeconds: 60,
    });
    await expect(
      ctx.service.issueToken(USER, { type: 'collect' }),
    ).rejects.toThrow(/获客已关闭/);
    expect(ctx.rows).toHaveLength(0);
  });
});

describe('令牌的有效性按当前在册状态复核', () => {
  it('账号离职/被移出组织后，未到期的令牌立即失效并就地吊销', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });

    ctx.standing.value = false;
    await expect(ctx.service.pull({ token: res.token })).rejects.toThrow(
      /账号或组织资格已失效/,
    );
    expect(ctx.rows[0].revokedAt).toBeInstanceOf(Date);
    expect(ctx.claim).not.toHaveBeenCalled();
  });

  it('复核时会带上令牌落库时的组织主体', async () => {
    const ctx = build();
    const res = await ctx.service.issueToken(USER, { type: 'collect' });
    await ctx.service.pull({ token: res.token });
    expect(ctx.scope.isStanding).toHaveBeenCalledWith('u1', {
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
    });
  });
});
