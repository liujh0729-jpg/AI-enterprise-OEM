import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { ErpService } from './erp.service';
import { stub } from '../../test/doubles';

/**
 * 采购闭环「付款审批」（docs §5.3）：
 * 应付金额 ≥ 50000 需财务审批通过才可登记付款；低于阈值免审批；
 * 审批驳回后可改金额重新提交（改金额会重新置为待审批）。
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

function model(seed: AnyRow[] = []) {
  const rows = [...seed];
  let seq = 1000;
  return {
    rows,
    count: jest.fn(async ({ where }: { where?: AnyRow } = {}) =>
      rows.filter((row) => matches(row, where ?? {})).length,
    ),
    findFirst: jest.fn(
      async ({ where }: { where: AnyRow }) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    findMany: jest.fn(async (args: { where?: AnyRow } = {}) =>
      rows.filter((row) => matches(row, args.where ?? {})),
    ),
    create: jest.fn(async ({ data }: { data: AnyRow }) => {
      const row = {
        id: ++seq,
        paidAmount: 0,
        status: 'OPEN',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        ...data,
      };
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

const payable = (over: AnyRow = {}): AnyRow => ({
  id: 1,
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  code: 'YF-20260101-0001',
  vendorId: 3,
  sourceType: 'PURCHASE_ORDER',
  sourceId: 9,
  amount: 120000,
  paidAmount: 0,
  dueDate: '2026-01-01',
  recurrence: 'NONE',
  nextAt: '',
  status: 'OPEN',
  approvalStatus: 'PENDING',
  approverId: '',
  decidedAt: null,
  approvalNote: '',
  note: '',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

function build(org: HrmOrg = ORG) {
  const prisma = {
    erpPayable: model([payable()]),
    erpVendor: model([
      { id: 3, orgType: 'ENTERPRISE', orgUserId: 'ent-a', name: '供应商甲' },
    ]),
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
  return { service, prisma };
}

describe('ERP 大额付款审批', () => {
  it('待审批的大额应付不能直接付款', async () => {
    const ctx = build();
    await expect(
      ctx.service.payPayable(USER, { id: 1, amount: 120000 }),
    ).rejects.toThrow('需财务审批通过后才能付款');
    expect(ctx.prisma.erpPayable.update).not.toHaveBeenCalled();
  });

  it('审批驳回后付款被拒，提示改金额重新提交', async () => {
    const ctx = build();
    ctx.prisma.erpPayable.rows[0].approvalStatus = 'REJECTED';
    await expect(
      ctx.service.payPayable(USER, { id: 1, amount: 1000 }),
    ).rejects.toThrow('付款审批已被驳回');
  });

  it('审批通过后可按金额付款并结清', async () => {
    const ctx = build();
    ctx.prisma.erpPayable.rows[0].approvalStatus = 'APPROVED';
    const view = await ctx.service.payPayable(USER, {
      id: 1,
      amount: 120000,
    });
    expect(view.status).toBe('PAID');
    expect(view.paidAmount).toBe('120000.00');
  });

  it('小额应付免审批，可直接付款', async () => {
    const ctx = build();
    ctx.prisma.erpPayable.rows[0] = payable({
      amount: 800,
      approvalStatus: 'NONE',
    });
    const view = await ctx.service.payPayable(USER, { id: 1, amount: 800 });
    expect(view.status).toBe('PAID');
  });

  it('审批结论写入后不可重复审批', async () => {
    const ctx = build();
    const view = await ctx.service.decidePayable(USER, {
      id: 1,
      decision: 'approve',
      note: '同意付款',
    });
    expect(view.approvalStatus).toBe('APPROVED');
    expect(view.approverId).toBe('u1');
    await expect(
      ctx.service.decidePayable(USER, { id: 1, decision: 'reject' }),
    ).rejects.toThrow('已完成付款审批');
  });

  it('新建应付：大额自动进入待审批，小额免审批', async () => {
    const ctx = build();
    const large = await ctx.service.savePayable(USER, {
      vendorId: 3,
      amount: 60000,
    });
    expect(large.approvalStatus).toBe('PENDING');
    const small = await ctx.service.savePayable(USER, {
      vendorId: 3,
      amount: 100,
    });
    expect(small.approvalStatus).toBe('NONE');
  });

  it('已通过的应付改金额上调后重新进入待审批', async () => {
    const ctx = build();
    ctx.prisma.erpPayable.rows[0].approvalStatus = 'APPROVED';
    const view = await ctx.service.savePayable(USER, {
      id: 1,
      vendorId: 3,
      amount: 200000,
    });
    expect(view.approvalStatus).toBe('PENDING');
  });

  it('已通过的应付只改备注不影响审批结论', async () => {
    const ctx = build();
    ctx.prisma.erpPayable.rows[0].approvalStatus = 'APPROVED';
    const view = await ctx.service.savePayable(USER, {
      id: 1,
      vendorId: 3,
      amount: 120000,
      note: '补充说明',
    });
    expect(view.approvalStatus).toBe('APPROVED');
  });
});
