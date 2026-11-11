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
 * §7.3-9 / §11.4 执行预算：单次运行按创建时的预算快照累计 AI 调用、token、
 * 工具调用、浏览器动作与节点次数，触顶即停在节点边界并把触顶项落在运行行上。
 */
const ACTOR = new CurrentUser('u1', '测试员', 'member');

function node(id: string, type: string, kind: string, config = {}) {
  return {
    id,
    type,
    kind,
    name: id,
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config,
  };
}

function chain(count: number) {
  const nodes = [node('n0', 'trigger', 'trigger.manual')];
  for (let i = 1; i <= count; i += 1) {
    nodes.push(node(`n${i}`, 'ai', 'ai.llm', { prompt: `第 ${i} 句` }));
  }
  const edges = nodes.slice(1).map((item, index) => ({
    id: `e${index + 1}`,
    source: `n${index}`,
    target: item.id,
    sourceHandle: '',
    targetHandle: '',
    mapping: {},
  }));
  return { nodes, edges };
}

/** 扇出图：触发后 3 个模型节点同波并发，用于验证 token 这类事后才知道的用量。 */
function fanOut(count: number) {
  const nodes = [node('n0', 'trigger', 'trigger.manual')];
  const edges = [] as {
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    mapping: Record<string, string>;
  }[];
  for (let i = 1; i <= count; i += 1) {
    nodes.push(node(`n${i}`, 'ai', 'ai.llm', { prompt: `第 ${i} 句` }));
    edges.push({
      id: `e${i}`,
      source: 'n0',
      target: `n${i}`,
      sourceHandle: '',
      targetHandle: '',
      mapping: {},
    });
  }
  return { nodes, edges };
}

type StepRow = { id: number; nodeId: string; status: string; output: unknown };

function build(budgets: Record<string, number>, graph = chain(3)) {
  const runRow: Record<string, unknown> = {
    id: 9,
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
    dedupeKey: null,
    budgets,
    usage: {},
    budgetStop: 'NONE',
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-11-11T00:00:00.000Z'),
  };
  const steps: StepRow[] = [];
  const prisma = stub<PrismaService>({
    workflowRun: {
      findUnique: jest.fn(async () => ({ ...runRow })),
      update: jest.fn(
        async ({
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(runRow, data);
          return { ...runRow };
        },
      ),
    },
    workflowVersion: {
      findFirst: jest.fn(async () => ({ graph })),
    },
    workflowRunStep: {
      findMany: jest.fn(async () => steps),
      findFirst: jest.fn(async () => null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: steps.length + 1,
          attempts: 0,
          ...data,
        } as StepRow & { attempts: number };
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
  const chat = jest.fn(async () => ({
    text: '回答',
    usage: { tokenIn: 100, tokenOut: 20, call: 1 },
  }));
  const engine = new WorkflowEngine(prisma, stub<TaskCenterService>({}));
  engine.setRuntime({ chat, runAgent: chat });
  return { engine, runRow, steps, chat };
}

describe('工作流执行预算（§7.3-9）', () => {
  it('不改预算时跑完全部节点，用量按实际发生额累计', async () => {
    const { engine, runRow, chat } = build({
      maxAiCalls: 0,
      maxTokens: 0,
      maxToolCalls: 0,
      maxBrowserActions: 0,
      maxNodes: 0,
    });
    await engine.start(9, ACTOR);
    expect(runRow.status).toBe('DONE');
    expect(chat).toHaveBeenCalledTimes(3);
    expect(runRow.usage).toEqual({
      nodes: 4,
      aiCalls: 3,
      tokenIn: 300,
      tokenOut: 60,
      toolCalls: 0,
      browserActions: 0,
    });
    expect(runRow.budgetStop).toBe('NONE');
  });

  it('AI 调用次数触顶后停在边界上，不再多发一次模型请求', async () => {
    const { engine, runRow, chat, steps } = build({
      maxAiCalls: 2,
      maxTokens: 0,
      maxToolCalls: 0,
      maxBrowserActions: 0,
      maxNodes: 0,
    });
    await engine.start(9, ACTOR);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(runRow.budgetStop).toBe('AI_CALLS');
    expect(runRow.status).toBe('FAILED');
    expect(String(runRow.error)).toContain('AI 调用次数上限 2');
    // 触发 + 两次模型调用落账，被跳过的节点只留跳过原因
    expect(steps.map((step) => `${step.nodeId}:${step.status}`)).toEqual([
      'n0:DONE',
      'n1:DONE',
      'n2:DONE',
      'n3:SKIPPED',
    ]);
  });

  // token 只能在模型回传用量后得知，所以是「累计到上限即停」：同一波里的节点会一起跑完，
  // 这一波照实记账，下一波开门即判停、不再发起请求。
  it('token 累计到上限即停，同波已发生的用量照实记账', async () => {
    const { engine, runRow, chat } = build(
      {
        maxAiCalls: 0,
        maxTokens: 250,
        maxToolCalls: 0,
        maxBrowserActions: 0,
        maxNodes: 0,
      },
      fanOut(3),
    );
    await engine.start(9, ACTOR);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(runRow.usage).toMatchObject({ tokenIn: 300, tokenOut: 60 });
    expect(runRow.budgetStop).toBe('TOKENS');
    expect(runRow.status).toBe('FAILED');
    expect(String(runRow.error)).toContain('AI 用量（token）上限 250');
  });

  it('节点次数上限同时兜住循环与重复触发', async () => {
    const { engine, runRow } = build({
      maxAiCalls: 0,
      maxTokens: 0,
      maxToolCalls: 0,
      maxBrowserActions: 0,
      maxNodes: 2,
    });
    await engine.start(9, ACTOR);
    expect(runRow.budgetStop).toBe('LOOP_LIMIT');
    expect(runRow.usage).toMatchObject({ nodes: 2 });
  });
});
