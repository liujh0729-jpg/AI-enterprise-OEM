import type { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { DataTableAiService } from './data-table-ai.service';
import type { DataFieldRow, DataTableService } from './data-table.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import { stub } from '../../test/doubles';

/**
 * P1-B 多维表格 AI 单测：AI 列（走模型 / 缺 Key 规则兜底 / 取材列校验）、
 * 问数（先聚合再喂模型 / 无模型回聚合口径）、一句话建表（列键与类型归一）、AI 视图归一。
 */

jest.mock('../ai/ai-gateway', () => ({
  tryChat: jest.fn(),
  aiChat: jest.fn(),
  parseJsonObject: (raw: unknown) => {
    const body = text(raw)
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  },
}));

import { aiChat, tryChat } from '../ai/ai-gateway';

const user = { userId: 'u1' } as CurrentUser;

const FIELDS: DataFieldRow[] = [
  {
    id: 1,
    tableId: 5,
    name: '客户',
    fieldKey: 'customer',
    fieldType: 'text',
    sortOrder: 0,
    options: {},
    required: false,
    createdAt: new Date(),
  },
  {
    id: 2,
    tableId: 5,
    name: '备注',
    fieldKey: 'remark',
    fieldType: 'text',
    sortOrder: 1,
    options: {},
    required: false,
    createdAt: new Date(),
  },
  {
    id: 3,
    tableId: 5,
    name: '金额',
    fieldKey: 'amount',
    fieldType: 'number',
    sortOrder: 2,
    options: {},
    required: false,
    createdAt: new Date(),
  },
  {
    id: 4,
    tableId: 5,
    name: '状态',
    fieldKey: 'status',
    fieldType: 'select',
    sortOrder: 3,
    options: { choices: ['待联系', '已签约'] },
    required: false,
    createdAt: new Date(),
  },
];

const ROWS = [
  { id: 11, tableId: 5, data: { customer: '甲公司', amount: 100 } },
  { id: 12, tableId: 5, data: { customer: '乙公司', amount: 200 } },
];

function makeService() {
  const prisma = {
    dataTableRow: {
      findMany: jest.fn(async () => ROWS),
      count: jest.fn(async () => ROWS.length),
    },
  };
  const tables = {
    authorize: jest.fn(async () => ({
      owner: true,
      can: { read: true, create: true, update: true, delete: true },
      table: { id: 5, createdBy: 'u1', name: '客户表', description: '' },
    })),
    fieldsOf: jest.fn(async () => FIELDS),
    updateRows: jest.fn(
      async (
        _user: CurrentUser,
        _tableId: number,
        updates: { id: number; data: Record<string, unknown> }[],
      ) => ({ updated: updates.length }),
    ),
    normalizeRow: jest.fn((fields: DataFieldRow[], raw: unknown) => {
      const target = fields.find((field) => field.fieldType === 'number');
      const data = raw as Record<string, unknown>;
      if (target && typeof data[target.fieldKey] === 'string') {
        throw new Error('列要填数字');
      }
      return data;
    }),
  };
  const identity = { audit: jest.fn(async () => undefined) };
  const service = new DataTableAiService(
    stub<PrismaService>(prisma),
    stub<DataTableService>(tables),
    stub<IdentityService>(identity),
  );
  return { service, prisma, tables, identity };
}

describe('DataTableAiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AI 列走模型：按行 id 回填并写回，mode=llm', async () => {
    (tryChat as jest.Mock).mockResolvedValue({
      reply: '{"values":{"11":"优质客户","12":"普通客户"}}',
      model: 'gpt-x',
    });
    const { service, tables } = makeService();
    const result = await service.fillColumn(user, 5, {
      field_key: 'remark',
      prompt: '按客户名打分',
      source_keys: ['customer'],
    });
    expect(result).toEqual({
      fieldKey: 'remark',
      updated: 2,
      skipped: 0,
      model: 'gpt-x',
      mode: 'llm',
    });
    const updates = tables.updateRows.mock.calls[0][2];
    expect(updates[0].data).toMatchObject({
      customer: '甲公司',
      remark: '优质客户',
    });
  });

  it('AI 列缺 Key：回落规则拼接取材列，mode=rule', async () => {
    (tryChat as jest.Mock).mockResolvedValue(null);
    const { service, tables } = makeService();
    const result = await service.fillColumn(user, 5, {
      field_key: 'remark',
      source_keys: ['customer', 'amount'],
    });
    expect(result.mode).toBe('rule');
    expect(result.model).toBe('');
    const updates = tables.updateRows.mock.calls[0][2];
    expect(updates[0].data.remark).toBe('甲公司 · 100');
  });

  it('AI 列：取材列不存在直接拒绝', async () => {
    const { service } = makeService();
    await expect(
      service.fillColumn(user, 5, {
        field_key: 'remark',
        source_keys: ['nope'],
      }),
    ).rejects.toThrow('取材列不存在');
  });

  it('问数无模型：回服务端聚合口径，含合计与行数', async () => {
    (tryChat as jest.Mock).mockResolvedValue(null);
    const { service } = makeService();
    const result = await service.ask(user, 5, { question: '金额合计多少' });
    expect(result.mode).toBe('aggregate');
    expect(result.answer).toContain('共 2 行');
    expect(result.answer).toContain('合计 300');
    expect((result.aggregates.amount as { sum: number }).sum).toBe(300);
    expect(result.total).toBe(2);
  });

  it('问数有模型：返回模型结论并标 llm', async () => {
    (tryChat as jest.Mock).mockResolvedValue({
      reply: '金额合计 300，其中甲公司 100。',
      model: 'gpt-x',
    });
    const { service } = makeService();
    const result = await service.ask(user, 5, { question: '金额合计' });
    expect(result.mode).toBe('llm');
    expect(result.model).toBe('gpt-x');
    expect(result.answer).toContain('300');
  });

  it('一句话建表：列键归一（非法键改名、select 无候选降级文本）', async () => {
    (aiChat as jest.Mock).mockResolvedValue({
      reply: JSON.stringify({
        name: '客户跟进',
        description: '记录客户进度',
        fields: [
          { name: '客户名', field_key: 'Customer Name!', field_type: 'text' },
          { name: '状态', field_key: 'status', field_type: 'select' },
        ],
      }),
      model: 'gpt-x',
    });
    const { service } = makeService();
    const plan = await service.planTable(user, {
      text: '帮我建一张客户跟进表',
    });
    expect(plan.mode).toBe('llm');
    expect(plan.fields[0].field_key).toBe('customer_name_');
    expect(plan.fields[1].field_type).toBe('text');
  });

  it('AI 视图：groupBy 不在列里就换成本表第一个可分组列', async () => {
    (aiChat as jest.Mock).mockResolvedValue({
      reply: JSON.stringify({
        name: '按状态看板',
        type: 'KANBAN',
        config: { groupBy: 'not_exist' },
      }),
      model: 'gpt-x',
    });
    const { service } = makeService();
    const view = await service.planView(user, 5, { text: '按状态分组看看' });
    expect(view.type).toBe('KANBAN');
    expect(view.config).toEqual({ groupBy: 'customer' });
  });
});
