import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { BiScopeService } from './bi.scope';
import { BiQueryService } from './bi.query.service';

const CHART_TYPES = new Set([
  'TABLE',
  'METRIC',
  'BAR',
  'LINE',
  'AREA',
  'PIE',
  'DONUT',
  'SCATTER',
  'FUNNEL',
]);

const TYPE_LABELS: Record<string, string> = {
  TABLE: '表格',
  METRIC: '指标卡',
  BAR: '柱状图',
  LINE: '折线图',
  AREA: '面积图',
  PIE: '饼图',
  DONUT: '环形图',
  SCATTER: '散点图',
  FUNNEL: '漏斗图',
};

export class BiChartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly query: BiQueryService,
  ) {}

  private async views(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return [];
    const datasets = await this.prisma.biDataset.findMany({
      where: { id: { in: rows.map((row) => Number(row.datasetId)) } },
      select: { id: true, name: true },
    });
    const names = new Map(datasets.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: Number(row.id),
      datasetId: Number(row.datasetId),
      datasetName: names.get(Number(row.datasetId)) || '',
      name: text(row.name),
      chartType: text(row.chartType),
      chartTypeLabel: TYPE_LABELS[text(row.chartType)] || text(row.chartType),
      config:
        row.config && typeof row.config === 'object'
          ? (row.config as Record<string, unknown>)
          : {},
      status: text(row.status),
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where: Prisma.BiChartWhereInput = { ownerUserId: ctx.ownerUserId };
    if (query.datasetId) where.datasetId = Number(query.datasetId);
    const keyword = text(query.keyword).trim();
    if (keyword) where.name = { contains: keyword };
    const [rows, total] = await Promise.all([
      this.prisma.biChart.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.biChart.count({ where }),
    ]);
    return {
      list: await this.views(rows),
      total,
      page,
      pageSize,
    };
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.prisma.biChart.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '图表不存在');
    return (await this.views([row]))[0];
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const datasetId = Number(body.datasetId) || 0;
    await this.query.datasetById(ctx.ownerUserId, datasetId);
    const name = text(body.name).trim().slice(0, 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写图表名称');
    const chartType = text(body.chartType, 'TABLE').toUpperCase();
    if (!CHART_TYPES.has(chartType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '图表类型不支持');
    }
    const data = {
      datasetId,
      name,
      chartType,
      config: toJsonInput(body.config || {}),
    };
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biChart.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '图表不存在');
    }
    const row = id
      ? await this.prisma.biChart.update({ where: { id }, data })
      : await this.prisma.biChart.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '图表不存在');
    }
    return (await this.views([row]))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const id = Number(rawId);
    const row = await this.prisma.biChart.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '图表不存在');
    const used = await this.prisma.biDashboardComponent.count({
      where: { chartId: id },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '图表还在仪表板里使用',
      );
    await this.prisma.biChart.delete({ where: { id } });
    return { removed: true };
  }

  async data(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const chart = await this.prisma.biChart.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!chart) throw new BusinessException(ErrorCode.NOT_FOUND, '图表不存在');
    const dataset = await this.query.datasetById(
      ctx.ownerUserId,
      chart.datasetId,
    );
    const result = await this.query.chartQuery(
      user,
      dataset,
      (chart.config || {}) as Record<string, unknown>,
    );
    return {
      chart: (await this.views([chart]))[0],
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      sql: '',
    };
  }
}
