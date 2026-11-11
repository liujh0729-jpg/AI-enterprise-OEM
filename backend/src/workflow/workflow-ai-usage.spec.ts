import { recordAiUsage } from '../ai/ai-gateway';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskCenterService } from '../task-center/task-center.service';
import { stub } from '../../test/doubles';
import { WorkflowEngine } from './workflow-engine';

jest.mock('../ai/ai-gateway', () => ({
  ...jest.requireActual<typeof import('../ai/ai-gateway')>('../ai/ai-gateway'),
  recordAiUsage: jest.fn(async () => undefined),
}));

/**
 * P4-8：大模型节点与 Agent 节点的 token 用量必须随步骤落库，
 * 并按 workflow 科目落一条用量事实，工作流的成本才能在报表里核对。
 */
const recordMock = recordAiUsage as jest.MockedFunction<typeof recordAiUsage>;
const ACTOR = new CurrentUser('u1', '测试员', 'member');

const nodes = [
  {
    id: 'n0',
    type: 'trigger',
    kind: 'trigger.manual',
    name: '',
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config: {},
  },
  {
    id: 'n1',
    type: 'ai',
    kind: 'ai.llm',
    name: '写文案',
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config: { prompt: '写一句文案' },
  },
  {
    id: 'n2',
    type: 'ai',
    kind: 'ai.agent',
    name: '调研',
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config: { mode: 'agent', prompt: '查一下竞品' },
  },
];

const edges = [
  {
    id: 'e1',
    source: 'n0',
    target: 'n1',
    sourceHandle: '',
    targetHandle: '',
    mapping: {},
  },
  {
    id: 'e2',
    source: 'n1',
    target: 'n2',
    sourceHandle: '',
    targetHandle: '',
    mapping: {},
  },
];

type StepRow = {
  id: number;
  nodeId: string;
  status: string;
  output: unknown;
};

function build() {
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
    createdAt: new Date('2026-11-11T00:00:00.000Z'),
  };
  const steps: StepRow[] = [];
  const prisma = stub<PrismaService>({
    workflowRun: {
      findUnique: jest.fn(async () => ({ ...runRow })),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(runRow, data);
        return Promise.resolve({ ...runRow });
      }),
    },
    workflowVersion: {
      findFirst: jest.fn(async () => ({ graph: { nodes, edges } })),
    },
    workflowRunStep: {
      findMany: jest.fn(async () => steps),
      findFirst: jest.fn(
        async ({ where }: { where: { nodeId: string } }) =>
          steps.find((step) => step.nodeId === where.nodeId) ?? null,
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: steps.length + 1, ...data } as StepRow;
        steps.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = steps.find((step) => step.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
  });
  const engine = new WorkflowEngine(prisma, stub<TaskCenterService>({}));
  engine.setRuntime({
    chat: jest.fn(async () => ({
      text: '文案一',
      usage: { tokenIn: 120, tokenOut: 30, call: 1 },
    })),
    runAgent: jest.fn(async () => ({
      text: '竞品结论',
      usage: { tokenIn: 200, tokenOut: 50, call: 1 },
    })),
  });
  return { engine, runRow, steps };
}

describe('工作流 AI 节点的用量归集（P4-8）', () => {
  beforeEach(() => recordMock.mockClear());

  it('两个 AI 节点各落一条 workflow 用量事实，步骤产出带 __usage', async () => {
    const { engine, runRow, steps } = build();
    await engine.start(7, ACTOR);

    expect(runRow.status).toBe('DONE');
    expect(recordMock).toHaveBeenCalledTimes(2);
    expect(recordMock).toHaveBeenCalledWith(
      ACTOR.userId,
      { tokenIn: 120, tokenOut: 30, call: 1 },
      { module: 'workflow', operation: 'ai.llm', model: '' },
    );
    expect(recordMock).toHaveBeenCalledWith(
      ACTOR.userId,
      { tokenIn: 200, tokenOut: 50, call: 1 },
      { module: 'workflow', operation: 'ai.agent', model: '' },
    );
    const llmStep = steps.find((step) => step.nodeId === 'n1')!;
    expect(llmStep.output).toMatchObject({
      text: '文案一',
      __usage: { tokenIn: 120, tokenOut: 30, call: 1 },
    });
  });

  it('没有用量（如回复未带 usage）时不补记空账', async () => {
    const { engine } = build();
    engine.setRuntime({
      chat: jest.fn(async () => ({ text: '无水量的回答' })),
      runAgent: jest.fn(async () => ({ text: '同样无水量的结论' })),
    });
    await engine.start(7, ACTOR);
    expect(recordMock).not.toHaveBeenCalled();
  });
});
