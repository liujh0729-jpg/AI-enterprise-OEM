import type { CurrentUser } from '../auth/current-user';
import { DataTableViewService } from './data-table-view.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DataTableService } from './data-table.service';
import type { IdentityService } from '../identity/identity.service';
import { stub } from '../../test/doubles';

/**
 * P1-B 表格视图单测：读用访问权、存/删归归属账号、类型与配置归一、不存在如实报错。
 */

const user = { userId: 'u1' } as CurrentUser;

function makeService(owner = true) {
  const row = {
    id: 9,
    tableId: 5,
    createdBy: 'u1',
    name: '按状态',
    type: 'KANBAN',
    config: { groupBy: 'status' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
  const prisma = {
    dataTableView: {
      findMany: jest.fn(async () => [row]),
      findFirst: jest.fn(async (): Promise<typeof row | null> => row),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...row,
        ...data,
      })),
      update: jest.fn(async () => row),
      delete: jest.fn(async () => row),
    },
  };
  const tables = {
    authorize: jest.fn(async () => ({
      owner,
      can: { read: true, create: true, update: true, delete: true },
      table: { id: 5, createdBy: 'u1', name: '客户表', description: '' },
    })),
  };
  const identity = { audit: jest.fn(async () => undefined) };
  const service = new DataTableViewService(
    stub<PrismaService>(prisma),
    stub<DataTableService>(tables),
    stub<IdentityService>(identity),
  );
  return { service, prisma, tables, identity };
}

describe('DataTableViewService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('列表：有访问权即可看，返回带 config 的视图', async () => {
    const { service, tables } = makeService();
    const list = await service.list(user, 5);
    expect(tables.authorize).toHaveBeenCalledWith(user, 5, 'read');
    expect(list[0]).toMatchObject({
      id: 9,
      tableId: 5,
      name: '按状态',
      type: 'KANBAN',
      config: { groupBy: 'status' },
    });
  });

  it('保存视图：非归属账号被拒', async () => {
    const { service } = makeService(false);
    await expect(
      service.save(user, 5, { name: 'x', type: 'GRID' }),
    ).rejects.toThrow('只有表归属账号可以保存视图');
  });

  it('保存视图：新建时类型大写归一、配置落 JSON', async () => {
    const { service, prisma } = makeService();
    await service.save(user, 5, {
      name: '看板',
      type: 'kanban',
      config: { groupBy: 'status' },
    });
    expect(prisma.dataTableView.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tableId: 5,
          createdBy: 'u1',
          name: '看板',
          type: 'KANBAN',
          config: { groupBy: 'status' },
        }),
      }),
    );
  });

  it('删除视图：不存在如实报错', async () => {
    const { service, prisma } = makeService();
    prisma.dataTableView.findFirst.mockResolvedValue(null);
    await expect(service.remove(user, 5, 9)).rejects.toThrow('该视图不存在');
  });
});
