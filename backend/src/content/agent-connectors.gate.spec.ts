import { CurrentUser } from '../auth/current-user';
import { runWithAgentScope } from './agent-scope';
import {
  ContentAgentConnectorService,
  type BuiltinMcpRunner,
} from './agent-connectors.service';
import { AgentMcpCrypto } from './agent-mcp-crypto';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';

/**
 * 连接器授权闸（智能硬件方案 8.5）：用户自建 MCP 连接器的工具此前无任何授权闸，
 * 模型选中即无条件执行。这里验两道闸——本人未勾选只回草案、无人值守默认不执行；
 * 远端工具一律按写动作对待（没有可靠的读写标注，宁可多拦）。
 */
jest.mock('./agent-mcp.client', () => {
  class McpClientError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
    }
  }
  const listTools = jest
    .fn()
    .mockResolvedValue([
      { name: 'do_thing', description: '远端工具', inputSchema: {} },
    ]);
  const callTool = jest
    .fn()
    .mockResolvedValue({ text: '远端结果', isError: false });
  const close = jest.fn();
  class McpClient {
    constructor(readonly config: unknown) {}
    listTools = listTools;
    callTool = callTool;
    close = close;
  }
  return { McpClient, McpClientError, __mock: { listTools, callTool, close } };
});

jest.mock('../http/outbound-guard', () => ({
  assertOutboundUrl: jest.fn(async (value: string) => value),
  assertOutboundUrlSync: jest.fn((value: string) => new URL(value)),
}));

const mocked = jest.requireMock<{
  __mock: { listTools: jest.Mock; callTool: jest.Mock; close: jest.Mock };
}>('./agent-mcp.client');

const user = new CurrentUser('u1', 'dave', 'user');

const row = {
  id: 7,
  userId: 'u1',
  name: '车间网关',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  headers: '',
  headerNames: [],
  enabled: true,
  toolCount: 1,
  toolNames: ['do_thing'],
  lastError: '',
  lastCheckedAt: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

function build(granted: number[]) {
  const findFirst = jest.fn().mockResolvedValue(row);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = stub<PrismaService>({
    contentAgentMcpConnector: { findFirst, updateMany },
  });
  const grants = {
    grantedConnectors: jest.fn().mockResolvedValue(new Set(granted)),
  };
  const memory = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ContentAgentConnectorService(
    prisma,
    stub<AgentMcpCrypto>({
      decrypt: () => '{}',
      encrypt: (v: string) => v,
    }),
    stub<IdentityService>({ audit: jest.fn() }),
    stub<{ current?: BuiltinMcpRunner }>(),
    grants,
    memory,
  );
  return { service, grants, memory, findFirst };
}

describe('ContentAgentConnectorService 连接器授权闸', () => {
  beforeEach(() => {
    mocked.__mock.listTools.mockClear();
    mocked.__mock.callTool.mockClear();
    mocked.__mock.close.mockClear();
  });

  it('本人没勾选这条连接器时只回草案，远端工具一次都不调', async () => {
    const { service, memory } = build([]);
    const result = await service.callTool(user, 'mcp__c7__do_thing', { a: 1 });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('没有勾选');
    expect(mocked.__mock.callTool).not.toHaveBeenCalled();
    expect(memory.record).toHaveBeenCalledTimes(1);
    expect(memory.record.mock.calls[0][0]).toMatchObject({
      outcome: 'blocked',
      errorCode: 'NOT_GRANTED',
      targetId: '7',
    });
  });

  it('本人已勾选且是对话轮次时正常调远端', async () => {
    const { service, memory } = build([7]);
    const result = await service.callTool(user, 'mcp__c7__do_thing', { a: 1 });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('远端结果');
    expect(mocked.__mock.callTool).toHaveBeenCalledTimes(1);
    expect(memory.record).not.toHaveBeenCalled();
  });

  it('无人值守任务即使已勾选连接器，没放开写动作也只回草案', async () => {
    const { service, memory } = build([7]);
    const result = await runWithAgentScope(
      { connectorIds: [7], mailboxIds: [], trigger: 'schedule' },
      () => service.callTool(user, 'mcp__c7__do_thing', { a: 1 }),
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain('无人值守');
    expect(mocked.__mock.callTool).not.toHaveBeenCalled();
    expect(memory.record.mock.calls[0][0]).toMatchObject({
      errorCode: 'SCHEDULE_DENIED',
      channel: 'scheduler',
    });
  });

  it('无人值守任务放开写动作且已勾选连接器时才真执行', async () => {
    const { service } = build([7]);
    const result = await runWithAgentScope(
      {
        connectorIds: [7],
        mailboxIds: [],
        trigger: 'schedule',
        allowWrite: true,
      },
      () => service.callTool(user, 'mcp__c7__do_thing', { a: 1 }),
    );
    expect(result.ok).toBe(true);
    expect(mocked.__mock.callTool).toHaveBeenCalledTimes(1);
  });

  it('本站内置连接器（id 0）不走这条闸，交回内置执行器', async () => {
    const { service, grants } = build([]);
    const runner = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '内置结果' }],
      structuredContent: {},
    });
    // 内置执行器由 app 组装后回填，这里直接替换
    stub<{ builtin: { current?: unknown } }>(service).builtin = {
      current: runner,
    };
    const result = await service.callTool(user, 'mcp__c0__read_data', {});
    expect(result.ok).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(grants.grantedConnectors).not.toHaveBeenCalled();
  });
});
