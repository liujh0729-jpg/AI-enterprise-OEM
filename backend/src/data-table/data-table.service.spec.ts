import type { CurrentUser } from '../auth/current-user';
import { DataTableService } from './data-table.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import { stub } from '../../test/doubles';

/**
 * 字段级 AI 列配置（options.ai）落库与保留：
 * 建列带 ai 要写进 options；改列只改名字时不能把已配的 ai 擦掉。
 */

const user = { userId: 'u1' } as CurrentUser;

function makeService() {
  const created: { options: unknown }[] = [];
  const updated: { options?: unknown }[] = [];
  const fieldRow = {
    id: 7,
    tableId: 5,
    name: '摘要',
    fieldKey: 'summary',
    fieldType: 'text',
    sortOrder: 0,
    options: { ai: { prompt: '总结这条记录', source_keys: ['name'] } },
    required: false,
    createdAt: new Date(),
  };
  const prisma = {
    dataTable: {
      findUnique: jest.fn(async () => ({
        id: 5,
        createdBy: 'u1',
        name: '客户表',
        description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    dataTableField: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ sortOrder: -1 })),
      createMany: jest.fn(
        async ({ data }: { data: { options: unknown }[] }) => {
          created.push(...data);
        },
      ),
      update: jest.fn(async ({ data }: { data: { options?: unknown } }) => {
        updated.push(data);
        return { ...fieldRow, ...data };
      }),
    },
  };
  const identity = {
    audit: jest.fn(async () => undefined),
    isPlatformAdmin: () => false,
  };
  const users = { displayNames: jest.fn(async () => new Map()) };
  const service = new DataTableService(
    stub<PrismaService>(prisma),
    stub<IdentityService>(identity),
    stub<UserLookupService>(users),
  );
  return { service, prisma, created, updated, fieldRow };
}

describe('DataTableService 的 AI 列配置', () => {
  beforeEach(() => jest.clearAllMocks());

  it('建列带 ai：提示词与取材列写进 options', async () => {
    const { service, created } = makeService();
    await service.addField(user, 5, {
      name: '摘要',
      field_key: 'summary',
      field_type: 'text',
      ai: { prompt: '总结这条记录', source_keys: ['name'] },
    });
    expect(created[0].options).toEqual({
      ai: { prompt: '总结这条记录', source_keys: ['name'] },
    });
  });

  it('改列只改名字：已配的 ai 原样保留', async () => {
    const { service, prisma, updated } = makeService();
    (prisma.dataTableField.findFirst as jest.Mock).mockResolvedValue({
      id: 7,
      tableId: 5,
      name: '摘要',
      fieldKey: 'summary',
      fieldType: 'text',
      sortOrder: 0,
      options: { ai: { prompt: '总结这条记录', source_keys: ['name'] } },
      required: false,
    });
    await service.updateField(user, 5, 7, { name: '一句摘要' });
    // 没提交 ai 也没改类型：整份 options 不动，已存的 ai 配置自然保留。
    expect(updated[0]).toEqual({ name: '一句摘要' });
  });

  it('改列带 ai：整份 options 按提交内容替换', async () => {
    const { service, prisma, updated } = makeService();
    (prisma.dataTableField.findFirst as jest.Mock).mockResolvedValue({
      id: 7,
      tableId: 5,
      name: '摘要',
      fieldKey: 'summary',
      fieldType: 'text',
      sortOrder: 0,
      options: { ai: { prompt: '旧的', source_keys: ['name'] } },
      required: false,
    });
    await service.updateField(user, 5, 7, {
      field_type: 'text',
      ai: { prompt: '新的要求', source_keys: ['name', 'amount'] },
    });
    expect(updated[0].options).toEqual({
      ai: { prompt: '新的要求', source_keys: ['name', 'amount'] },
    });
  });
});
