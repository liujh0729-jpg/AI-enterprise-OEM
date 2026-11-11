import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmScopeService } from '../crm/crm.scope';
import type { BiDatasourceService } from './bi.datasource.service';
import type { BiScopeService, BiContext } from './bi.scope';
import {
  BiQueryService,
  type DatasetRow,
  type QueryColumns,
} from './bi.query.service';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §四 BI 行：已有列权限配置，但查询执行侧未见完整应用；部门过滤存在口径缺口。
 * 行列权限必须进入实际查询、预览、导出及 AI 问答链：
 * - 行权限 rowFilter 里的 ${deptId} 要用「当前操作者部门」解析，而不是恒为空字面量；
 * - 列权限 columnRules.hidden 要在结果集层剔除，预览/图表/导出/AI 问数同一口径收窄。
 */

const USER = new CurrentUser('u2', '李四', 'member');

const DATASET: DatasetRow = {
  id: 11,
  ownerUserId: 'owner-1',
  name: '线索集',
  type: 'INTERNAL',
  datasourceId: 0,
  internalKey: 'LEADS',
  sqlText: '',
  config: {},
  description: '',
  status: 'ACTIVE',
};

type Row = Record<string, unknown>;

type RunResult = {
  columns: QueryColumns;
  rows: Row[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

function build(opts: {
  role: BiContext['role'];
  department?: string;
  rowFilter?: string;
  hidden?: string[];
  rows?: Row[];
  columns?: Array<{ key: string; label: string; type: string }>;
}) {
  const ctx: BiContext = {
    ownerUserId: 'owner-1',
    actorId: 'u2',
    role: opts.role,
    isOwner: false,
    isMember: true,
    isAdmin: opts.role === 'ADMIN',
    department: opts.department ?? '',
  };
  const columns = opts.columns ?? [
    { key: 'id', label: '线索ID', type: 'number' },
    { key: 'phone', label: '电话', type: 'text' },
    { key: 'owner_id', label: '负责人', type: 'text' },
  ];
  const rows: Row[] = opts.rows ?? [
    { id: 1, phone: '138', owner_id: 'u2' },
    { id: 2, phone: '139', owner_id: 'u3' },
  ];
  const prisma = {
    biDatasetPermission: {
      findUnique: jest.fn(async () => ({
        id: 1,
        datasetId: DATASET.id,
        role: opts.role,
        rowFilter: opts.rowFilter ?? '',
        columnRules: opts.hidden ? { hidden: opts.hidden } : {},
      })),
    },
    $queryRawUnsafe: jest.fn(async () => rows),
    biQueryLog: { create: jest.fn(async () => ({ id: 1 })) },
  };
  const scope = stub<BiScopeService>({
    requireMember: jest.fn(async () => ctx),
    assertCan: jest.fn(),
  });
  const crmScope = stub<CrmScopeService>({
    context: jest.fn(async () => ({ isMember: true, ownerUserId: 'u2' })),
  });
  const service = new BiQueryService(
    stub<PrismaService>(prisma),
    scope,
    crmScope,
    stub<BiDatasourceService>({}),
  );
  const result = (cols: QueryColumns, data: Row[]): RunResult => ({
    columns: cols,
    rows: data,
    rowCount: data.length,
    truncated: false,
    elapsedMs: 0,
  });
  // 让被测路径拿到确定结果集：直接短路 run()，专注验证列权限收窄。
  const run = jest.fn();
  run.mockResolvedValue(result(columns, rows));
  Object.assign(service, { run });
  return { service, prisma, ctx, run };
}

describe('BiQueryService 列权限：columnRules.hidden 在结果集层剔除', () => {
  it('ANALYST 配置隐藏电话列：预览结果不含该列', async () => {
    const ctx = build({ role: 'ANALYST', hidden: ['phone'] });
    const preview = await ctx.service.preview(USER, DATASET, 20);
    expect(preview.columns.map((item) => item.key)).toEqual(['id', 'owner_id']);
    expect(preview.rows[0]).toEqual({ id: 1, owner_id: 'u2' });
    expect('phone' in preview.rows[0]).toBe(false);
  });

  it('未配置隐藏列：结果保持原样', async () => {
    const ctx = build({ role: 'ANALYST' });
    const preview = await ctx.service.preview(USER, DATASET, 20);
    expect(preview.columns.map((item) => item.key)).toEqual([
      'id',
      'phone',
      'owner_id',
    ]);
  });

  it('ADMIN 不受列权限约束', async () => {
    const ctx = build({ role: 'ADMIN', hidden: ['phone'] });
    const preview = await ctx.service.preview(USER, DATASET, 20);
    expect(preview.columns.map((item) => item.key)).toContain('phone');
  });

  it('runSql（图表 / AI 问数共用出口）同样按列权限收窄', async () => {
    const ctx = build({ role: 'ANALYST', hidden: ['phone', 'owner_id'] });
    const result = await ctx.service.runSql(
      USER,
      DATASET,
      'SELECT * FROM dataset',
    );
    expect(result.columns.map((item) => item.key)).toEqual(['id']);
    expect(result.rows[0]).toEqual({ id: 1 });
  });
});

describe('BiQueryService 行权限：${deptId} 用当前操作者部门解析', () => {
  it('含 ${deptId} 的行过滤下发给查询时替换为部门字面量', async () => {
    const captured: string[] = [];
    const ctx = build({
      role: 'ANALYST',
      department: '销售一部',
      rowFilter: 'department = ${deptId}',
    });
    ctx.run.mockImplementationOnce(async (base: { sql: string }) => {
      captured.push(base.sql);
      return {
        columns: [{ key: 'id', label: '线索ID', type: 'number' }],
        rows: [{ id: 1 }],
        rowCount: 1,
        truncated: false,
        elapsedMs: 0,
      };
    });
    await ctx.service.preview(USER, DATASET, 20);
    expect(captured[0]).toContain("department = '销售一部'");
    expect(captured[0]).not.toContain('${deptId}');
  });
});
