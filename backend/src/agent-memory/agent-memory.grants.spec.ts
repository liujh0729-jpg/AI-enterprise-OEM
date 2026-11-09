import { AgentMemoryService } from './agent-memory.service';
import { assertSensitivePassword } from '../common/confirm-password';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';

/**
 * 自建 MCP 连接器的授权存取：粒度是整条连接器，与契约动作同一次提交、同一道验密。
 * 这里只验「谁被允许写进授权表」——密码校验本体由 confirm-password 的既有用例覆盖。
 */
jest.mock('../common/confirm-password', () => ({
  assertSensitivePassword: jest.fn().mockResolvedValue(undefined),
}));

const confirm = {
  assertSensitivePassword: jest.mocked(assertSensitivePassword),
};

type GrantRow = {
  userId: string;
  action: string;
  scopeType: string;
  connectorId: number;
};

const CONNECTORS = [
  {
    id: 7,
    name: '车间网关',
    enabled: true,
    toolCount: 3,
    lastError: '',
    lastCheckedAt: null,
  },
  {
    id: 8,
    name: '仓库看板',
    enabled: true,
    toolCount: 1,
    lastError: '',
    lastCheckedAt: null,
  },
];

function build(seed: GrantRow[] = []) {
  const rows = [...seed];
  const createMany = jest.fn(({ data }: { data: GrantRow | GrantRow[] }) => {
    const list = Array.isArray(data) ? data : [data];
    for (const item of list) rows.push(item);
    return Promise.resolve({ count: list.length });
  });
  const deleteMany = jest.fn(
    ({ where }: { where: Record<string, unknown> }) => {
      const before = rows.length;
      const scope = where.scopeType;
      const actionIn = (where.action as { in?: string[] } | undefined)?.in;
      const connectorIn = (where.connectorId as { in?: number[] } | undefined)
        ?.in;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (scope && row.scopeType !== scope) continue;
        if (actionIn && !actionIn.includes(row.action)) continue;
        if (connectorIn && !connectorIn.includes(row.connectorId)) continue;
        rows.splice(i, 1);
      }
      return Promise.resolve({ count: before - rows.length });
    },
  );
  const prisma = stub<PrismaService>({
    agentActionGrant: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows
            .filter(
              (row) =>
                (!where.scopeType || row.scopeType === where.scopeType) &&
                row.userId === where.userId,
            )
            .map((row) => ({
              action: row.action,
              connectorId: row.connectorId,
            })),
        ),
      ),
      createMany,
      deleteMany,
    },
    contentAgentMcpConnector: {
      findMany: jest.fn(({ where }: { where: { id?: { in: number[] } } }) => {
        const ids = where?.id?.in;
        return Promise.resolve(
          ids ? CONNECTORS.filter((item) => ids.includes(item.id)) : CONNECTORS,
        );
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  });
  return {
    service: new AgentMemoryService(prisma),
    rows,
    createMany,
    deleteMany,
  };
}

describe('AgentMemoryService 连接器授权', () => {
  beforeEach(() => confirm.assertSensitivePassword.mockClear());

  it('清单里带上本人的连接器与授权状态', async () => {
    const { service } = build([
      {
        userId: 'u1',
        action: 'CONNECTOR',
        scopeType: 'CONNECTOR',
        connectorId: 7,
      },
    ]);
    const result = await service.grants('u1');
    expect(result.connectors.map((item) => item.connectorId)).toEqual([7, 8]);
    expect(result.connectors[0]).toMatchObject({
      name: '车间网关',
      allowed: true,
    });
    expect(result.connectors[1]).toMatchObject({
      name: '仓库看板',
      allowed: false,
    });
    expect(result.connectorGrantedCount).toBe(1);
  });

  it('新增连接器授权要验密', async () => {
    const { service, rows } = build();
    await service.saveGrants('u1', [], 'secret', [7]);
    expect(confirm.assertSensitivePassword).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      {
        userId: 'u1',
        domain: 'connector',
        action: 'CONNECTOR',
        scopeType: 'CONNECTOR',
        connectorId: 7,
      },
    ]);
  });

  it('别人的连接器 id 直接拒收，不写任何行', async () => {
    const { service, rows } = build();
    await expect(service.saveGrants('u1', [], 'secret', [99])).rejects.toThrow(
      /不存在或不属于当前账号/,
    );
    expect(rows).toEqual([]);
    expect(confirm.assertSensitivePassword).not.toHaveBeenCalled();
  });

  it('收回连接器授权不必验密', async () => {
    const { service, rows } = build([
      {
        userId: 'u1',
        action: 'CONNECTOR',
        scopeType: 'CONNECTOR',
        connectorId: 7,
      },
    ]);
    const result = await service.saveGrants('u1', [], undefined, []);
    expect(confirm.assertSensitivePassword).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(result.connectorsRevoked).toBe(1);
  });

  it('契约动作与连接器的授权互不干扰', async () => {
    const { service, rows } = build([
      {
        userId: 'u1',
        action: 'CONNECTOR',
        scopeType: 'CONNECTOR',
        connectorId: 7,
      },
    ]);
    await service.saveGrants('u1', [], 'secret', [7, 8]);
    expect(rows.filter((row) => row.scopeType === 'CONNECTOR')).toHaveLength(2);
    expect(rows.filter((row) => row.scopeType === 'ACTION')).toHaveLength(0);
  });
});
