import { tryChat } from '../ai/ai-gateway';
import { CurrentUser } from '../auth/current-user';
import type { TaskCenterService } from '../task-center/task-center.service';
import type { TaskDraft } from '../task-center/task-source';
import { stub } from '../../test/doubles';
import { FulfillmentAdvisorService } from './fulfillment-advisor.service';
import type { GrowthCockpitService } from './growth-cockpit.service';

jest.mock('../ai/ai-gateway', () => ({
  ...jest.requireActual<typeof import('../ai/ai-gateway')>('../ai/ai-gateway'),
  tryChat: jest.fn(),
}));

const tryChatMock = tryChat as jest.MockedFunction<typeof tryChat>;

const user = stub<CurrentUser>({ userId: 'u-1' });

const facts = {
  summary: {
    signed: 3,
    delivered: 1,
    accepted: 0,
    settled: 0,
    total: 3,
    signedAmount: '300000.00',
    receivedAmount: '10000.00',
  },
  list: [
    {
      contractId: 1,
      contractName: '年度代运营',
      customerName: '客户甲',
      amount: '200000.00',
      signedAt: '2026-10-01T00:00:00.000Z',
      projectId: 0,
      projectStatus: '',
      signed: true,
      delivered: false,
      accepted: false,
      settled: false,
      receivableAmount: '0.00',
      receivedAmount: '0.00',
      gap: 'DELIVERED',
      gapLabel: '待交付',
    },
    {
      contractId: 2,
      contractName: '短视频项目',
      customerName: '客户乙',
      amount: '50000.00',
      signedAt: '2026-10-02T00:00:00.000Z',
      projectId: 20,
      projectStatus: 'ACCEPTING',
      signed: true,
      delivered: true,
      accepted: false,
      settled: false,
      receivableAmount: '50000.00',
      receivedAmount: '10000.00',
      gap: 'SETTLED',
      gapLabel: '待结算',
    },
    {
      contractId: 3,
      contractName: '已结清合同',
      customerName: '客户丙',
      amount: '50000.00',
      signedAt: '2026-10-03T00:00:00.000Z',
      projectId: 21,
      projectStatus: 'CLOSED',
      signed: true,
      delivered: true,
      accepted: true,
      settled: true,
      receivableAmount: '50000.00',
      receivedAmount: '50000.00',
      gap: 'DONE',
      gapLabel: '已闭环',
    },
  ],
};

function build(chatResult: { reply: string; model: string } | null = null) {
  tryChatMock.mockReset();
  tryChatMock.mockResolvedValue(chatResult ? stub(chatResult) : null);
  const cockpit = stub<GrowthCockpitService>({
    fulfillment: jest.fn(async () => facts),
  });
  const assign = jest.fn(async (draft: TaskDraft) =>
    stub({ id: 'task-1', draft }),
  );
  const tasks = stub<TaskCenterService>({ assign });
  return {
    service: new FulfillmentAdvisorService(stub({}), cockpit, tasks),
    assign,
  };
}

describe('FulfillmentAdvisorService：合同履约助手', () => {
  it('模型不可用时退回规则式建议，只列未闭环合同并给出确定性动作', async () => {
    const { service } = build(null);
    const result = await service.advise(user, { days: 90 });
    expect(result.source).toBe('RULE');
    expect(result.openCount).toBe(2);
    expect(result.items.map((item) => item.contractId)).toEqual([1, 2]);
    expect(result.items[0].action).toContain('项目');
    expect(result.items[1].risk).toContain('40000.00');
    expect(result.headline).toContain('还有 2 份');
  });

  it('模型输出合规 JSON 时覆盖卡点原因，模型漏掉的合同仍保留规则结论', async () => {
    const { service } = build({
      model: 'gpt-x',
      reply: JSON.stringify({
        headline: '先补交付',
        items: [{ contractId: 1, risk: '没建项', action: '本周建项' }],
      }),
    });
    const result = await service.advise(user, { days: 90 });
    expect(result.source).toBe('AI');
    expect(result.headline).toBe('先补交付');
    expect(result.items[0]).toMatchObject({
      risk: '没建项',
      action: '本周建项',
      source: 'AI',
    });
    expect(result.items[1].source).toBe('RULE');
    const call = tryChatMock.mock.calls[0][1];
    expect(call.module).toBe('growth');
    expect(call.operation).toBe('fulfillment_advice');
  });

  it('派单只派未闭环合同，任务带卡点与下一步，幂等锚是合同主键', async () => {
    const { service, assign } = build(null);
    const result = await service.dispatch(user, {
      contractIds: [1, 2, 3],
      assigneeUserId: 'staff-1',
      note: '本周跟进',
    });
    expect(result).toEqual({ created: 2, skipped: 1, total: 3 });
    const drafts = assign.mock.calls.map((call) => call[0]);
    expect(drafts.map((draft) => draft.sourceId)).toEqual(['1', '2']);
    expect(drafts[0].source).toBe('fulfillment');
    expect(drafts[0].description).toContain('待交付');
    expect(drafts[0].description).toContain('本周跟进');
    expect(drafts[0].assigneeUserId).toBe('staff-1');
    expect(drafts[0].priority).toBe('HIGH');
  });
});
