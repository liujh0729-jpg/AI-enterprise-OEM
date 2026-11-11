import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AccountCrypto } from '../account/account-crypto';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';
import type { MechanismWebhookService } from './mechanism-webhook.service';
import { MechanismEventService } from './mechanism-event.service';

process.env.EXTERNAL_CRED_KEY = process.env.EXTERNAL_CRED_KEY || '0'.repeat(64);

const ORG = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  actorId: 'u9',
  isOwner: true,
  isAdmin: true,
  roles: [],
  positions: [],
  department: '',
};

type ExecutionRow = { actionType: string; status: string; error: string };

function build(
  actions: Record<string, unknown>[],
  conditions: Record<string, unknown>[] = [
    { field: 'status', op: 'eq', value: 'DONE' },
  ],
) {
  const executions: ExecutionRow[] = [];
  const prisma = {
    eventLog: {
      create: jest.fn().mockResolvedValue({ id: 77 }),
      update: jest.fn().mockResolvedValue({}),
    },
    webhookSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    ruleDefinition: {
      findMany: jest.fn().mockResolvedValue([{ id: 9, conditions, actions }]),
      update: jest.fn().mockResolvedValue({}),
    },
    ruleExecution: {
      create: jest.fn((input: { data: ExecutionRow }) => {
        executions.push(input.data);
        return Promise.resolve({ id: executions.length });
      }),
    },
  };
  const service = new MechanismEventService(
    stub<PrismaService>(prisma),
    stub<HrmScopeService>({}),
    stub<AccountCrypto>({}),
    stub<StorageService>({}),
    stub<NotificationService>({}),
    jest.fn(),
    stub<MechanismWebhookService>({}),
  );
  return { service, prisma, executions };
}

describe('规则动作 run_workflow / assign_task', () => {
  it('把规则动作转成工作流触发与任务派发，幂等锚用规则 + 事件台账，并写执行台账', async () => {
    const ctx = build([
      {
        type: 'run_workflow',
        target: 'wf.reconcile',
        payload: { name: '对账' },
      },
      { type: 'assign_task', target: 'ORG:p1' },
    ]);
    const invoke = jest.fn().mockResolvedValue({ runId: 1, duplicated: false });
    const assign = jest.fn().mockResolvedValue(undefined);
    ctx.service.useWorkflowInvoker(invoke);
    ctx.service.useTaskAssigner(assign);

    await ctx.service.dispatch(ORG, 'crm.order.paid', {
      status: 'DONE',
      orderId: 'O-1',
      source: 'crm',
      sourceId: 'O-1',
    });

    expect(invoke).toHaveBeenCalledWith({
      ownerUserId: 'ent-a',
      businessKey: 'wf.reconcile',
      input: {
        status: 'DONE',
        orderId: 'O-1',
        source: 'crm',
        sourceId: 'O-1',
        name: '对账',
      },
      dedupeKey: '9:77',
    });
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        org: ORG,
        ruleId: 9,
        target: 'ORG:p1',
        sourceId: '9:77',
      }),
    );
    expect(ctx.executions.map((row) => [row.actionType, row.status])).toEqual([
      ['run_workflow', 'DONE'],
      ['assign_task', 'DONE'],
    ]);
  });

  it('工作流触发失败只记 FAILED，不阻断后续动作', async () => {
    const ctx = build([
      { type: 'run_workflow', target: '42' },
      { type: 'assign_task', target: 's1' },
    ]);
    const invoke = jest.fn().mockRejectedValue(new Error('工作流不存在'));
    const assign = jest.fn().mockResolvedValue(undefined);
    ctx.service.useWorkflowInvoker(invoke);
    ctx.service.useTaskAssigner(assign);

    await ctx.service.dispatch(ORG, 'crm.order.paid', { status: 'DONE' });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 42, dedupeKey: '9:77' }),
    );
    expect(assign).toHaveBeenCalledTimes(1);
    expect(ctx.executions.map((row) => [row.actionType, row.status])).toEqual([
      ['run_workflow', 'FAILED'],
      ['assign_task', 'DONE'],
    ]);
    expect(ctx.executions[0].error).toContain('工作流不存在');
  });

  it('动作没填目标时报错并留痕，而不是静默成功', async () => {
    const ctx = build([{ type: 'assign_task', target: '' }]);
    ctx.service.useTaskAssigner(jest.fn());

    await ctx.service.dispatch(ORG, 'crm.order.paid', { status: 'DONE' });

    expect(ctx.executions).toHaveLength(1);
    expect(ctx.executions[0].status).toBe('FAILED');
    expect(ctx.executions[0].error).toContain('承办人');
  });
});
