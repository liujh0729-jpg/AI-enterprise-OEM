import type { BriefRow } from './okr-brief.service';
import { nextStatus, readinessOf } from './okr-brief.service';
import {
  buildRulePayload,
  extractGoalNumber,
  normalizePayload,
  splitPayload,
} from './okr-decomposition.rules';
import type { OkrMemberRow } from './okr.scope';

const member = (id: string, name: string): OkrMemberRow => ({
  memberUserId: id,
  name,
  memberKind: 'STAFF',
  memberKindLabel: '职员',
  department: '交付部',
  positions: [],
  capabilities: '',
  roles: [],
  dualKind: false,
});

const members = [member('u1', '张三'), member('u2', '李四')];

const brief = (patch: Partial<BriefRow> = {}): BriefRow => ({
  id: 1,
  orgType: 'ENTERPRISE',
  orgUserId: 'owner',
  cycleId: 9,
  title: '2027 华东区新签增长',
  businessGoal: '2027 年华东区新签合同额增长 40%',
  scopeWhat: '华东区制造业客户拓展与交付',
  scopeTarget: '新签合同额增长 40%',
  deliverables: [
    { name: '行业解决方案包', description: '', acceptance: '评审通过' },
  ],
  startDate: '2027-01-01',
  endDate: '2027-06-30',
  budgetAmount: 800000,
  budgetHours: 2400,
  currency: 'CNY',
  labor: [{ role: '交付经理', headcount: 1, hours: 800, memberUserId: 'u1' }],
  materials: [],
  equipment: [],
  externalServices: [],
  constraints: '',
  status: 'READY',
  createdBy: 'owner',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...patch,
});

describe('OKR 目标书前置检查', () => {
  it('信息齐全时没有阻断项', () => {
    const readiness = readinessOf(brief(), 2);
    expect(readiness.blockers).toEqual([]);
  });

  it('目标/范围/交付物/周期/工期缺失会阻断', () => {
    const readiness = readinessOf(
      brief({
        businessGoal: '',
        scopeWhat: '',
        scopeTarget: '',
        deliverables: [],
        cycleId: 0,
        startDate: '',
        endDate: '',
      }),
      2,
    );
    expect(readiness.blockers).toHaveLength(6);
  });

  it('外部服务未关联主体、工期过短、缺预算只提醒不阻断', () => {
    const readiness = readinessOf(
      brief({
        startDate: '2027-01-01',
        endDate: '2027-01-03',
        budgetAmount: 0,
        labor: [],
        externalServices: [
          { kind: 'VENDOR', scope: '实施', budget: 10, partyId: 0 },
        ],
      }),
      2,
    );
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('已落库/关闭状态不被自动改写', () => {
    expect(nextStatus('COMMITTED', { blockers: [], warnings: [] })).toBe(
      'COMMITTED',
    );
    expect(nextStatus('CLOSED', { blockers: ['x'], warnings: [] })).toBe(
      'CLOSED',
    );
    expect(nextStatus('DRAFT', { blockers: ['x'], warnings: [] })).toBe(
      'DRAFT',
    );
    expect(nextStatus('CLARIFYING', { blockers: ['x'], warnings: [] })).toBe(
      'CLARIFYING',
    );
    expect(nextStatus('DRAFT', { blockers: [], warnings: [] })).toBe('READY');
  });
});

describe('OKR 规则兜底拆解', () => {
  it('从业务目标提取数字与单位', () => {
    expect(extractGoalNumber(brief())).toEqual({ value: 40, unit: '%' });
    expect(
      extractGoalNumber(
        brief({ scopeTarget: '', businessGoal: '新增 120 个客户' }),
      ),
    ).toEqual({
      value: 120,
      unit: '个',
    });
    expect(
      extractGoalNumber(
        brief({ scopeTarget: '', businessGoal: '提升交付质量' }),
      ),
    ).toBeNull();
  });

  it('规则方案标注 RULE，且有目标、KR 与覆盖 KR 的任务', () => {
    const payload = normalizePayload(
      buildRulePayload({
        brief: brief(),
        members,
        optionKey: 'BALANCED',
        actorName: '王五',
      }),
      'BALANCED',
      {
        members,
        partyIds: new Set(),
        startDate: '2027-01-01',
        endDate: '2027-06-30',
        defaultSummary: '默认摘要',
      },
    );
    expect(payload).not.toBeNull();
    expect(payload!.mode).toBe('RULE');
    expect(payload!.objectives.length).toBe(1);
    expect(payload!.objectives[0].krs.length).toBeGreaterThanOrEqual(2);
    expect(payload!.objectives[0].krs[0].target).toBe(40);
    expect(payload!.tasks.length).toBeGreaterThan(0);
    const krKeys = new Set(payload!.tasks.map((task) => task.krKey));
    for (const kr of payload!.objectives[0].krs) {
      expect(krKeys.has(kr.key)).toBe(true);
    }
    for (const task of payload!.tasks) {
      expect(task.acceptance.length).toBeGreaterThan(0);
      expect(task.rubric.length).toBeGreaterThan(0);
    }
  });

  it('三档方案的业务目标依次提高，估时依次收紧', () => {
    const base = { brief: brief(), members, actorName: '王五' };
    const conservative = buildRulePayload({
      ...base,
      optionKey: 'CONSERVATIVE',
    });
    const balanced = buildRulePayload({ ...base, optionKey: 'BALANCED' });
    const aggressive = buildRulePayload({ ...base, optionKey: 'AGGRESSIVE' });
    expect(conservative.objectives[0].krs[0].target).toBeLessThan(
      balanced.objectives[0].krs[0].target,
    );
    expect(aggressive.objectives[0].krs[0].target).toBeGreaterThan(
      balanced.objectives[0].krs[0].target,
    );
    const hours = (payload: typeof balanced) =>
      payload.tasks.reduce((sum, task) => sum + task.estimateHours, 0);
    expect(hours(conservative)).toBeGreaterThan(hours(balanced));
    expect(hours(aggressive)).toBeLessThan(hours(balanced));
  });
});

describe('OKR 拆解防幻觉归一化', () => {
  const context = {
    members,
    partyIds: new Set([7]),
    startDate: '2027-01-01',
    endDate: '2027-06-30',
    defaultSummary: '默认摘要',
  };

  it('负责人不在名册、指标源未注册时被丢弃', () => {
    const payload = normalizePayload(
      {
        objectives: [
          {
            title: '增长目标',
            ownerMemberUserId: 'u1',
            krs: [
              {
                title: '新签合同额',
                baseline: 0,
                target: 100,
                ownerMemberUserId: 'ghost',
                metricSource: { source: 'NOT_REGISTERED' },
              },
            ],
          },
        ],
        tasks: [
          {
            title: '拓展客户',
            krKey: 'k1',
            ownerMemberUserId: 'ghost',
            dueDate: '2028-01-01',
          },
        ],
      },
      'BALANCED',
      context,
    );
    expect(payload).not.toBeNull();
    expect(payload!.objectives[0].ownerMemberUserId).toBe('u1');
    expect(payload!.objectives[0].krs[0].ownerMemberUserId).toBe('');
    expect(payload!.objectives[0].krs[0].metricSource).toEqual({});
    expect(payload!.tasks[0].ownerMemberUserId).toBe('');
    expect(payload!.tasks[0].dueDate).toBe('2027-06-30');
    expect(payload!.tasks[0].acceptance.length).toBeGreaterThan(0);
    expect(payload!.tasks[0].rubric.length).toBeGreaterThan(0);
  });

  it('空内容不产生方案', () => {
    expect(
      normalizePayload({ objectives: [] }, 'BALANCED', context),
    ).toBeNull();
  });

  it('读取时剥离模拟结果', () => {
    const payload = buildRulePayload({
      brief: brief(),
      members,
      optionKey: 'BALANCED',
      actorName: '王五',
    });
    const split = splitPayload({ ...payload, simulation: { feasible: true } });
    expect(split.payload.mode).toBe('RULE');
    expect(
      (split.payload as { simulation?: unknown }).simulation,
    ).toBeUndefined();
    expect(split.simulation).toEqual({ feasible: true });
  });
});
