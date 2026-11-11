import type { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { OperationRiskService } from './operation-risk.service';

const org: HrmOrg = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-1',
  actorId: 'ent-1',
  isOwner: true,
  isAdmin: true,
  roles: [],
  positions: [],
  department: '',
};

function prismaStub(data: {
  receivables?: object[];
  payables?: object[];
  projects?: object[];
  costs?: { projectId: number; _sum: { amount: number } }[];
  stocks?: object[];
  tasks?: object[];
}) {
  return stub<PrismaService>({
    erpReceivable: { findMany: jest.fn(async () => data.receivables || []) },
    erpPayable: { findMany: jest.fn(async () => data.payables || []) },
    pjProject: { findMany: jest.fn(async () => data.projects || []) },
    pjCostItem: { groupBy: jest.fn(async () => data.costs || []) },
    erpStock: { findMany: jest.fn(async () => data.stocks || []) },
    erpVariant: { findMany: jest.fn(async () => []) },
    erpVendor: { findMany: jest.fn(async () => []) },
    pjTask: { findMany: jest.fn(async () => data.tasks || []) },
  });
}

function scopeStub(): HrmScopeService {
  return stub<HrmScopeService>({
    resolve: jest.fn(async () => org),
    requireAdmin: jest.fn(),
    names: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, id]))),
  });
}

describe('OperationRiskService：经营异常模型', () => {
  it('五类异常按现有单据现场扫描出信号，并给责任人派单', async () => {
    const prisma = prismaStub({
      receivables: [
        {
          id: 1,
          code: 'YS-1',
          customerName: '客户甲',
          amount: 100000,
          receivedAmount: 20000,
          dueDate: '2026-10-01',
        },
      ],
      payables: [
        {
          id: 2,
          code: 'YF-2',
          vendorId: 0,
          amount: 5000,
          paidAmount: 0,
          dueDate: '2026-10-02',
        },
      ],
      projects: [
        { id: 10, name: '项目 X', ownerId: 'pm-1', budgetAmount: 1000 },
      ],
      costs: [{ projectId: 10, _sum: { amount: 1300 } }],
      stocks: [{ warehouseId: 1, variantId: 5, onHand: 1, reorderPoint: 10 }],
      tasks: [
        {
          id: 9,
          title: '超期任务',
          dueDate: '2026-10-03',
          assigneeId: 'staff-1',
          assigneeType: 'STAFF',
          projectId: 10,
        },
      ],
    });
    const assign = jest.fn(async () => ({ id: 1 }));
    const dispatch = jest.fn(async () => undefined);
    const service = new OperationRiskService(
      prisma,
      scopeStub(),
      stub<MechanismService>({ dispatch }),
      { assign },
    );
    const signals = await service.dispatchRisks(org);
    expect(signals.map((item) => item.kind).sort()).toEqual(
      [
        'PAYABLE_OVERDUE',
        'PROJECT_OVER_BUDGET',
        'RECEIVABLE_OVERDUE',
        'STOCK_LOW',
        'TASK_OVERDUE',
      ].sort(),
    );
    const receivable = signals.find(
      (item) => item.kind === 'RECEIVABLE_OVERDUE',
    );
    expect(receivable?.amount).toBe('80000.00');
    expect(receivable?.severity).toBe('HIGH');
    const over = signals.find((item) => item.kind === 'PROJECT_OVER_BUDGET');
    expect(over?.ownerUserId).toBe('pm-1');
    expect(assign).toHaveBeenCalledTimes(5);
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'risk',
        sourceId: 'receivable:1',
        priority: 'URGENT',
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      org,
      'risk.detected',
      expect.objectContaining({ kind: 'RECEIVABLE_OVERDUE' }),
    );
  });

  it('关闭前复核：异常仍在就拒绝关闭并给出原因', async () => {
    const prisma = prismaStub({
      receivables: [
        {
          id: 1,
          code: 'YS-1',
          customerName: '客户甲',
          amount: 1000,
          receivedAmount: 0,
          dueDate: '2026-10-01',
        },
      ],
    });
    const service = new OperationRiskService(
      prisma,
      scopeStub(),
      stub<MechanismService>({ dispatch: jest.fn() }),
      { assign: jest.fn() },
    );
    const blocked = await service.recheck(org, 'receivable:1');
    expect(blocked.cleared).toBe(false);
    expect(blocked.reason).toContain('异常仍未消除');
    const cleared = await service.recheck(org, 'receivable:404');
    expect(cleared.cleared).toBe(true);
  });
});
