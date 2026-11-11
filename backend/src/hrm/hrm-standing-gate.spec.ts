import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import { HrmScopeService } from './hrm.scope';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §3.5：离职或角色变化后，已持久化产物被再次取用前必须按「当前库表」重新鉴权，
 * 不能只靠异步清理项目成员或缓存。HrmScopeService 的 accountActive / membershipValid /
 * isStanding 是这条规则在全部调用点的共同底座，故单独锁行为。
 */

const scopeOf = (opts: {
  account?: { status: string } | null;
  member?: { id: number } | null;
}) => {
  const findUnique = jest.fn(async () => opts.account ?? null);
  const findFirst = jest.fn(async () => opts.member ?? null);
  const prisma = {
    account: { findUnique },
    orgStaff: { findFirst },
  };
  const service = new HrmScopeService(
    stub<PrismaService>(prisma),
    stub<IdentityService>({ isPlatformAdmin: () => false }),
  );
  return { service, findUnique, findFirst };
};

describe('HrmScopeService.accountActive：只有 ACTIVE 账号算在册', () => {
  it('ACTIVE 返回 true', async () => {
    const ctx = scopeOf({ account: { status: 'ACTIVE' } });
    await expect(ctx.service.accountActive('7')).resolves.toBe(true);
  });

  it('停用 / 封禁 / 注销均立即失效', async () => {
    for (const status of ['DISABLED', 'BANNED', 'DELETED']) {
      const ctx = scopeOf({ account: { status } });
      await expect(ctx.service.accountActive('7')).resolves.toBe(false);
    }
  });

  it('账号不存在按失效处理', async () => {
    const ctx = scopeOf({ account: null });
    await expect(ctx.service.accountActive('7')).resolves.toBe(false);
  });

  it('非法账号 id 不查库直接失效', async () => {
    const ctx = scopeOf({ account: { status: 'ACTIVE' } });
    await expect(ctx.service.accountActive('')).resolves.toBe(false);
    await expect(ctx.service.accountActive('abc')).resolves.toBe(false);
    await expect(ctx.service.accountActive('0')).resolves.toBe(false);
    expect(ctx.findUnique).not.toHaveBeenCalled();
  });
});

describe('HrmScopeService.membershipValid：组织资格按当前在册关系判定', () => {
  it('主账号本人恒有效，不查成员表', async () => {
    const ctx = scopeOf({ member: null });
    await expect(
      ctx.service.membershipValid('ENTERPRISE', 'ent-a', 'ent-a'),
    ).resolves.toBe(true);
    expect(ctx.findFirst).not.toHaveBeenCalled();
  });

  it('成员仍在册：命中 ACTIVE 行即有效', async () => {
    const ctx = scopeOf({ member: { id: 1 } });
    await expect(
      ctx.service.membershipValid('ENTERPRISE', 'ent-a', 'u2'),
    ).resolves.toBe(true);
    expect(ctx.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberUserId: 'u2',
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('成员离职（无 ACTIVE 行）即失效', async () => {
    const ctx = scopeOf({ member: null });
    await expect(
      ctx.service.membershipValid('ENTERPRISE', 'ent-a', 'u2'),
    ).resolves.toBe(false);
  });

  it('组织键或用户缺失直接失效', async () => {
    const ctx = scopeOf({ member: { id: 1 } });
    await expect(ctx.service.membershipValid('', 'ent-a', 'u2')).resolves.toBe(
      false,
    );
    await expect(
      ctx.service.membershipValid('ENTERPRISE', '', 'u2'),
    ).resolves.toBe(false);
    await expect(
      ctx.service.membershipValid('ENTERPRISE', 'ent-a', ''),
    ).resolves.toBe(false);
  });
});

describe('HrmScopeService.isStanding：账号 + 组织双重复核', () => {
  it('不传组织时只看账号是否在册', async () => {
    const ctx = scopeOf({ account: { status: 'ACTIVE' } });
    await expect(ctx.service.isStanding('7')).resolves.toBe(true);
  });

  it('账号被停用时，即使组织关系仍在也失效', async () => {
    const ctx = scopeOf({ account: { status: 'DISABLED' }, member: { id: 1 } });
    await expect(
      ctx.service.isStanding('7', {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
      }),
    ).resolves.toBe(false);
    expect(ctx.findFirst).not.toHaveBeenCalled();
  });

  it('账号在册但组织资格失效时整体失效', async () => {
    const ctx = scopeOf({ account: { status: 'ACTIVE' }, member: null });
    await expect(
      ctx.service.isStanding('7', {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
      }),
    ).resolves.toBe(false);
  });

  it('账号与组织都在册时放行', async () => {
    const ctx = scopeOf({ account: { status: 'ACTIVE' }, member: { id: 1 } });
    await expect(
      ctx.service.isStanding('7', {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
      }),
    ).resolves.toBe(true);
  });
});
