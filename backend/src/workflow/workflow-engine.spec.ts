import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskCenterService } from '../task-center/task-center.service';
import { stub } from '../../test/doubles';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowRuntime } from './workflow.types';

/**
 * B5 引擎补强：真并行、重试、超时、取消。
 * 这些语义都在「一波节点」这一层收口，因此用最小 DAG + 可控的运行期能力来断言，
 * 不碰真实模块（动作节点只经 runtime.runOperation，工具/人工节点不在这里重复覆盖）。
 */
const ACTOR = new CurrentUser('u1', '测试员', 'member');

type NodeSeed = {
  id: string;
  type: string;
  kind: string;
  name?: string;
  operationId?: string;
  params?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

function node(seed: NodeSeed) {
  return {
    name: '',
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config: {},
    ...seed,
  };
}

function edge(id: string, source: string, target: string) {
  return {
    id,
    source,
    target,
    sourceHandle: '',
    targetHandle: '',
    mapping: {},
  };
}

type StepLike = {
  id: number;
  runId: number;
  nodeId: string;
  nodeType: string;
  status: string;
  output: unknown;
  error: string;
  attempts: number;
  durationMs: number;
};

function build(
  nodes: NodeSeed[],
  edges: ReturnType<typeof edge>[],
  runtime: WorkflowRuntime = {},
) {
  const runRow = {
    id: 7,
    workflowId: 1,
    version: 1,
    trigger: 'MANUAL',
    status: 'PENDING',
    input: {},
    output: {},
    actorId: ACTOR.userId,
    error: '',
    sourceType: '',
    sourceId: '',
    dedupeKey: null as string | null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
  };
  const stepRows: StepLike[] = [];
  // 逐次返回的运行状态序列：start 读一次、驱动每波再读一次，用于模拟「中途被取消」。
  let statusSequence: string[] | null = null;
  const prisma = stub<PrismaService>({
    workflowRun: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          ...runRow,
          status: statusSequence
            ? (statusSequence.shift() ?? runRow.status)
            : runRow.status,
        }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(runRow, data);
        return Promise.resolve({ ...runRow });
      }),
    },
    workflowVersion: {
      findFirst: jest.fn(() => Promise.resolve({ graph: { nodes, edges } })),
    },
    workflowRunStep: {
      findMany: jest.fn(() => Promise.resolve(stepRows)),
      findFirst: jest.fn(({ where }: { where: { nodeId: string } }) =>
        Promise.resolve(
          stepRows.find((step) => step.nodeId === where.nodeId) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: stepRows.length + 1, ...data } as StepLike;
        stepRows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = stepRows.find((step) => step.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
  });
  const engine = new WorkflowEngine(prisma, stub<TaskCenterService>({}));
  engine.setRuntime(runtime);
  return {
    engine,
    runRow,
    stepRows,
    cancelBeforeDrive: () => {
      statusSequence = ['PENDING', 'CANCELED'];
    },
    stepOf: (nodeId: string) => stepRows.find((step) => step.nodeId === nodeId),
  };
}

function step(seed: {
  id: number;
  nodeId: string;
  nodeType?: string;
  status: string;
  output?: unknown;
}): StepLike {
  return {
    runId: 7,
    nodeType: 'human',
    output: {},
    error: '',
    attempts: 1,
    durationMs: 0,
    ...seed,
  };
}

/**
 * P1-8 恢复协议：等待锚点写在步骤产出里（saveStep 把 waitFor.anchor 合并进 output），
 * 恢复侧 resumeFromTask 必须读同一字段。这里以「已落库的 WAITING 运行 + 等待步骤」为起点，
 * 直接调 resumeFromTask 断言唤醒与续跑，绕开整轮的等待判定。
 */
function resumeBuild(
  nodes: NodeSeed[],
  edges: ReturnType<typeof edge>[],
  seed: {
    runStatus?: string;
    steps: StepLike[];
    task: {
      id: number;
      sourceId: string;
      status?: string;
      formData?: Record<string, string> | null;
      closeNote?: string | null;
    } | null;
  },
) {
  const runRow = {
    id: 7,
    workflowId: 1,
    version: 1,
    trigger: 'MANUAL',
    status: seed.runStatus ?? 'WAITING',
    input: {},
    output: {},
    actorId: ACTOR.userId,
    error: '',
    sourceType: '',
    sourceId: '',
    dedupeKey: null as string | null,
    startedAt: new Date('2026-11-10T00:00:00.000Z'),
    finishedAt: null,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
  };
  const stepRows: StepLike[] = [...seed.steps];
  const prisma = stub<PrismaService>({
    workflowRun: {
      findUnique: jest.fn(() => Promise.resolve({ ...runRow })),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(runRow, data);
        return Promise.resolve({ ...runRow });
      }),
    },
    workflowVersion: {
      findFirst: jest.fn(() => Promise.resolve({ graph: { nodes, edges } })),
    },
    workflowRunStep: {
      findMany: jest.fn(
        ({ where }: { where: { runId?: number; status?: string } }) =>
          Promise.resolve(
            stepRows.filter(
              (row) =>
                (where.runId === undefined || row.runId === where.runId) &&
                (where.status === undefined || row.status === where.status),
            ),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: { nodeId: string } }) =>
        Promise.resolve(
          stepRows.find((row) => row.nodeId === where.nodeId) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: stepRows.length + 1, ...data } as StepLike;
        stepRows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = stepRows.find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
    myTask: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          seed.task
            ? {
                source: 'workflow',
                status: 'DONE',
                formData: null,
                closeNote: null,
                ...seed.task,
              }
            : null,
        ),
      ),
    },
  });
  const engine = new WorkflowEngine(prisma, stub<TaskCenterService>({}));
  return {
    engine,
    runRow,
    stepRows,
    stepOf: (nodeId: string) => stepRows.find((item) => item.nodeId === nodeId),
  };
}

describe('节点并行（B5）', () => {
  it('并行分支同波并发执行，耗时≈最慢分支', async () => {
    let active = 0;
    let peak = 0;
    const runOperation = jest.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return { status: 200, code: 0, message: 'ok', data: { ok: true } };
    });
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({ id: 'n1', type: 'action', kind: 'Workflow_list' }),
        node({ id: 'n2', type: 'action', kind: 'Workflow_list' }),
      ],
      [edge('e1', 'n0', 'n1'), edge('e2', 'n0', 'n2')],
      { runOperation },
    );

    await ctx.engine.start(7, ACTOR);

    expect(peak).toBe(2);
    expect(runOperation).toHaveBeenCalledTimes(2);
    expect(ctx.runRow.status).toBe('DONE');
  });

  it('变量节点取值提升到共享上下文，供后续节点模板引用', async () => {
    const runOperation = jest.fn(async () => ({
      status: 200,
      code: 0,
      message: 'ok',
      data: {},
    }));
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'logic',
          kind: 'logic.variable',
          config: { name: 'kw', value: '线索' },
        }),
        node({
          id: 'n2',
          type: 'action',
          kind: 'Workflow_list',
          params: { keyword: '{{vars.kw}}' },
        }),
      ],
      [edge('e1', 'n0', 'n1'), edge('e2', 'n1', 'n2')],
      { runOperation },
    );

    await ctx.engine.start(7, ACTOR);

    const call = runOperation.mock.calls[0] as unknown[];
    expect(call[3]).toMatchObject({ query: { keyword: '线索' } });
  });
});

describe('节点重试与超时（B5）', () => {
  it('读动作失败按 config.retry 重试到成功，步骤记真实尝试次数', async () => {
    let calls = 0;
    const runOperation = jest.fn(async () => {
      calls += 1;
      return calls === 1
        ? { status: 500, code: 1, message: 'boom', data: null }
        : { status: 200, code: 0, message: 'ok', data: { ok: true } };
    });
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'action',
          kind: 'Workflow_list',
          config: { retry: { times: 2, backoffMs: 0 } },
        }),
      ],
      [edge('e1', 'n0', 'n1')],
      { runOperation },
    );

    await ctx.engine.start(7, ACTOR);

    expect(runOperation).toHaveBeenCalledTimes(2);
    expect(ctx.stepOf('n1')).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(ctx.runRow.status).toBe('DONE');
  });

  it('写动作节点永不自动重试（D6）', async () => {
    const runOperation = jest.fn(async () => ({
      status: 500,
      code: 1,
      message: 'boom',
      data: null,
    }));
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'action',
          kind: 'Workflow_create',
          config: { retry: { times: 3, backoffMs: 0 } },
        }),
      ],
      [edge('e1', 'n0', 'n1')],
      { runOperation },
    );

    await ctx.engine.start(7, ACTOR);

    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(ctx.stepOf('n1')).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(ctx.runRow.status).toBe('FAILED');
  });

  it('节点超时记 TIMEOUT 并让运行失败，不拖死整轮', async () => {
    const runOperation = jest.fn(() => new Promise<never>(() => undefined));
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'action',
          kind: 'Workflow_list',
          config: { timeoutMs: 20 },
        }),
      ],
      [edge('e1', 'n0', 'n1')],
      {
        runOperation: stub<WorkflowRuntime['runOperation']>(runOperation),
      },
    );

    await ctx.engine.start(7, ACTOR);

    const step = ctx.stepOf('n1');
    expect(step?.status).toBe('TIMEOUT');
    expect(step?.error).toContain('超时');
    expect(ctx.runRow.status).toBe('FAILED');
  });
});

describe('运行取消（B5）', () => {
  it('驱动前发现运行已被取消：不再开任何节点', async () => {
    const runOperation = jest.fn();
    const ctx = build(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({ id: 'n1', type: 'action', kind: 'Workflow_list' }),
      ],
      [edge('e1', 'n0', 'n1')],
      { runOperation },
    );
    ctx.cancelBeforeDrive();

    await ctx.engine.start(7, ACTOR);

    expect(runOperation).not.toHaveBeenCalled();
    expect(ctx.runRow.status).toBe('RUNNING');
  });
});

describe('等待锚点恢复（P1-8）', () => {
  it('分配任务 → 等待任务：关单按产出里的锚点唤醒，续跑至完成', async () => {
    const ctx = resumeBuild(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'human',
          kind: 'human.assign_task',
          config: { assignee: 'u2', title: '请审批' },
        }),
        node({
          id: 'n2',
          type: 'human',
          kind: 'human.wait_task',
          config: { node: 'n1' },
        }),
      ],
      [edge('e1', 'n0', 'n1'), edge('e2', 'n1', 'n2')],
      {
        steps: [
          step({
            id: 1,
            nodeId: 'n1',
            status: 'DONE',
            output: { taskId: 55, dedupKey: 'wf-55', assignee: 'u2' },
          }),
          step({
            id: 2,
            nodeId: 'n2',
            status: 'WAITING',
            output: { waiting: true, taskId: 55, anchor: 'n1' },
          }),
        ],
        task: { id: 55, sourceId: '7:n1' },
      },
    );

    await ctx.engine.resumeFromTask(55, '已处理');

    // 等待步骤读产出里的 anchor 命中并置完成（修复前读 input，永远匹配不到）。
    expect(ctx.stepOf('n2')).toMatchObject({
      status: 'DONE',
      output: { taskId: 55, closed: true, closeNote: '已处理' },
    });
    expect(ctx.runRow.status).toBe('DONE');
  });

  it('表单任务：锚点＝节点自身，关单回写结构化提交结果并续跑', async () => {
    const ctx = resumeBuild(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'human',
          kind: 'human.form',
          config: { assignee: 'u2', title: '立项登记' },
        }),
      ],
      [edge('e1', 'n0', 'n1')],
      {
        steps: [
          step({
            id: 1,
            nodeId: 'n1',
            status: 'WAITING',
            output: { waiting: true, taskId: 66, anchor: 'n1' },
          }),
        ],
        task: {
          id: 66,
          sourceId: '7:n1',
          formData: { budget: '12万' },
        },
      },
    );

    await ctx.engine.resumeFromTask(66, '已提交');

    expect(ctx.stepOf('n1')).toMatchObject({
      status: 'DONE',
      output: {
        taskId: 66,
        closed: true,
        closeNote: '已提交',
        form: { budget: '12万' },
      },
    });
    expect(ctx.runRow.status).toBe('DONE');
  });

  it('等待步骤的锚点与任务所属节点不符：不误唤醒，运行仍停在等待', async () => {
    const ctx = resumeBuild(
      [
        node({ id: 'n0', type: 'trigger', kind: 'trigger.manual' }),
        node({
          id: 'n1',
          type: 'human',
          kind: 'human.assign_task',
          config: { assignee: 'u2', title: '请审批' },
        }),
        node({
          id: 'n2',
          type: 'human',
          kind: 'human.wait_task',
          config: { node: 'n1' },
        }),
      ],
      [edge('e1', 'n0', 'n1'), edge('e2', 'n1', 'n2')],
      {
        steps: [
          step({
            id: 1,
            nodeId: 'n1',
            status: 'DONE',
            output: { taskId: 55, dedupKey: 'wf-55', assignee: 'u2' },
          }),
          step({
            id: 2,
            nodeId: 'n2',
            status: 'WAITING',
            output: { waiting: true, taskId: 999, anchor: '其他节点' },
          }),
        ],
        task: { id: 55, sourceId: '7:n1' },
      },
    );

    await ctx.engine.resumeFromTask(55, '已处理');

    expect(ctx.stepOf('n2')).toMatchObject({ status: 'WAITING' });
    expect(ctx.runRow.status).toBe('WAITING');
  });
});
