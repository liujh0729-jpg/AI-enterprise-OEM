import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { ErpService } from './erp.service';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §3.3/§四：管理员身份不能替代目标记录的组织校验。
 * 更新分支必须先按 (orgType, orgUserId) 找到目标记录，否则用别家组织的记录 id
 * 就能覆盖本组织数据（Prisma update({ where: { id } }) 不带租户条件）。
 */

const ORG: HrmOrg = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  actorId: 'u1',
  isOwner: true,
  isAdmin: true,
  roles: [],
  positions: [],
  department: '',
};

const USER = new CurrentUser('u1', '张三', 'member');

type AnyRow = Record<string, unknown>;

function matches(row: AnyRow, where: AnyRow): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const nested = cond as Record<string, unknown>;
      if ('in' in nested) return (nested.in as unknown[]).includes(row[key]);
      if ('not' in nested) return row[key] !== nested.not;
      return false;
    }
    return row[key] === cond;
  });
}

/** 内存表：只实现被测路径用到的 findFirst / findMany / create / update。 */
function model(seed: AnyRow[] = []) {
  const rows = [...seed];
  let seq = 1000;
  return {
    rows,
    findFirst: jest.fn(
      async ({ where }: { where: AnyRow }) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    findMany: jest.fn(async (args: { where?: AnyRow } = {}) =>
      rows.filter((row) => matches(row, args.where ?? {})),
    ),
    create: jest.fn(async ({ data }: { data: AnyRow }) => {
      const row = { id: ++seq, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(
      async ({ where, data }: { where: AnyRow; data: AnyRow }) => {
        const row = rows.find((r) => matches(r, where));
        if (row) Object.assign(row, data);
        return row;
      },
    ),
  };
}

function build(org: HrmOrg = ORG) {
  const prisma = {
    erpTaxRate: model([{ id: 7, orgType: 'ENTERPRISE', orgUserId: 'ent-b' }]),
    erpPricePolicy: model([
      { id: 7, orgType: 'ENTERPRISE', orgUserId: 'ent-b' },
    ]),
    erpVendor: model([{ id: 7, orgType: 'ENTERPRISE', orgUserId: 'ent-b' }]),
    bizParty: model(),
  };
  const scope = {
    resolve: jest.fn(async () => org),
    requireAdmin: jest.fn(),
  };
  const service = new ErpService(
    stub<PrismaService>(prisma),
    stub<HrmScopeService>(scope),
    stub<MechanismService>({ dispatch: jest.fn(async () => undefined) }),
    stub<AiEvalService>({}),
  );
  return { service, prisma, scope };
}

describe('ERP 更新分支的组织归属校验', () => {
  it('按别家组织的记录 id 更新税率被拒，且不会写库', async () => {
    const ctx = build();
    await expect(
      ctx.service.saveTaxRate(USER, { id: 7, name: '税率A', rate: 6 }),
    ).rejects.toThrow('税率不存在');
    expect(ctx.prisma.erpTaxRate.update).not.toHaveBeenCalled();
  });

  it('按别家组织的记录 id 更新价格策略被拒', async () => {
    const ctx = build();
    await expect(
      ctx.service.savePricePolicy(USER, { id: 7, name: '策略A' }),
    ).rejects.toThrow('价格策略不存在');
    expect(ctx.prisma.erpPricePolicy.update).not.toHaveBeenCalled();
  });

  it('按别家组织的记录 id 更新供应商被拒', async () => {
    const ctx = build();
    await expect(
      ctx.service.saveVendor(USER, { id: 7, name: '供应商A', code: 'V001' }),
    ).rejects.toThrow('供应商不存在');
    expect(ctx.prisma.erpVendor.update).not.toHaveBeenCalled();
  });

  it('本组织记录按 id 更新放行，写入条件仍按 id', async () => {
    const ctx = build();
    ctx.prisma.erpTaxRate.rows.push({
      id: 9,
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
      name: '旧税率',
      rate: 3,
      kind: 'BOTH',
      note: '',
    });
    const saved = await ctx.service.saveTaxRate(USER, {
      id: 9,
      name: '新税率',
      rate: 6,
    });
    expect(ctx.prisma.erpTaxRate.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ name: '新税率' }),
    });
    expect(saved.id).toBe(9);
    expect(saved.name).toBe('新税率');
  });

  it('无 id 走新建，落库时带上组织键', async () => {
    const ctx = build();
    const saved = await ctx.service.saveTaxRate(USER, {
      name: '增值税',
      rate: 13,
    });
    expect(ctx.prisma.erpTaxRate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        name: '增值税',
      }),
    });
    expect(saved.name).toBe('增值税');
  });

  it('非组织主账号且无财务职能角色时被拒，且不会写库', async () => {
    const ctx = build({
      ...ORG,
      isOwner: false,
      isAdmin: false,
      roles: ['HR'],
    });
    await expect(
      ctx.service.saveTaxRate(USER, { name: '增值税', rate: 13 }),
    ).rejects.toThrow('财务职能权限');
    expect(ctx.prisma.erpTaxRate.create).not.toHaveBeenCalled();
  });
});
