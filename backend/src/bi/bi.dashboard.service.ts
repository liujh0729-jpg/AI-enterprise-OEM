import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { BiScopeService, BiContext } from './bi.scope';
import { BiQueryService } from './bi.query.service';

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

export class BiDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly query: BiQueryService,
  ) {}

  private async views(rows: Array<Record<string, unknown>>) {
    if (!rows.length) return [];
    const counts = await this.prisma.biDashboardComponent.groupBy({
      by: ['dashboardId'],
      where: { dashboardId: { in: rows.map((row) => Number(row.id)) } },
      _count: { _all: true },
    });
    const countMap = new Map(
      counts.map((row) => [row.dashboardId, row._count._all]),
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: text(row.name),
      layout: Array.isArray(row.layout) ? row.layout : [],
      config:
        row.config && typeof row.config === 'object'
          ? (row.config as Record<string, unknown>)
          : {},
      componentCount: countMap.get(Number(row.id)) || 0,
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const keyword = text(query.keyword).trim();
    const where = {
      ownerUserId: ctx.ownerUserId,
      ...(keyword
        ? { name: { contains: keyword } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.biDashboard.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.biDashboard.count({ where }),
    ]);
    return {
      list: await this.views(rows),
      total,
      page,
      pageSize,
    };
  }

  private async findOne(ctx: BiContext, rawId: string) {
    const row = await this.prisma.biDashboard.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '仪表板不存在');
    return row;
  }

  private async chartViews(ids: number[], ctx: BiContext) {
    if (!ids.length) return new Map<number, Record<string, unknown>>();
    const rows = await this.prisma.biChart.findMany({
      where: { id: { in: ids }, ownerUserId: ctx.ownerUserId },
    });
    const datasets = await this.prisma.biDataset.findMany({
      where: { id: { in: rows.map((row) => row.datasetId) } },
      select: { id: true, name: true },
    });
    const names = new Map(datasets.map((row) => [row.id, row.name]));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          datasetId: row.datasetId,
          datasetName: names.get(row.datasetId) || '',
          name: row.name,
          chartType: row.chartType,
          chartTypeLabel: TYPE_LABELS[row.chartType] || row.chartType,
          config: row.config,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
        },
      ]),
    );
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const [view] = await this.views([row]);
    const components = await this.prisma.biDashboardComponent.findMany({
      where: { dashboardId: row.id },
      orderBy: { sort: 'asc' },
    });
    const charts = await this.chartViews(
      components.map((item) => item.chartId).filter(Boolean),
      ctx,
    );
    return {
      dashboard: view,
      components: components.map((item) => ({
        id: item.id,
        dashboardId: item.dashboardId,
        chartId: item.chartId,
        type: item.type,
        title: item.title,
        position: item.position,
        config: item.config,
        sort: item.sort,
        chart: charts.get(item.chartId) || null,
      })),
    };
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const name = text(body.name).trim().slice(0, 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写仪表板名称');
    const components = Array.isArray(body.components)
      ? (body.components as Array<Record<string, unknown>>)
      : [];
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biDashboard.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '仪表板不存在');
    }
    const data = {
      name,
      layout: (Array.isArray(body.layout) ? body.layout : []) as never,
      config: (body.config || {}) as never,
    };
    const row = id
      ? await this.prisma.biDashboard.update({ where: { id }, data })
      : await this.prisma.biDashboard.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '仪表板不存在');
    }
    await this.prisma.biDashboardComponent.deleteMany({
      where: { dashboardId: row.id },
    });
    for (let index = 0; index < components.length; index++) {
      const item = components[index];
      await this.prisma.biDashboardComponent.create({
        data: {
          dashboardId: row.id,
          chartId: Number(item.chartId) || 0,
          type: text(item.type, 'CHART'),
          title: text(item.title).slice(0, 80),
          position: (item.position || {}) as never,
          config: (item.config || {}) as never,
          sort: index,
        },
      });
    }
    return (await this.views([row]))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const row = await this.findOne(ctx, rawId);
    await this.prisma.biDashboardComponent.deleteMany({
      where: { dashboardId: row.id },
    });
    await this.prisma.biDashboard.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async data(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const components = await this.prisma.biDashboardComponent.findMany({
      where: { dashboardId: row.id },
      orderBy: { sort: 'asc' },
    });
    const charts = await this.chartViews(
      components.map((item) => item.chartId).filter(Boolean),
      ctx,
    );
    const result: Array<Record<string, unknown>> = [];
    for (const component of components) {
      const chart = charts.get(component.chartId);
      if (!chart) {
        result.push({
          id: component.id,
          chartId: component.chartId,
          type: component.type,
          title: component.title,
          position: component.position,
          config: component.config,
          chart: null,
          columns: [],
          rows: [],
          error: component.type === 'CHART' ? '图表不存在' : '',
        });
        continue;
      }
      try {
        const dataset = await this.query.datasetById(
          ctx.ownerUserId,
          Number(chart.datasetId),
        );
        const data = await this.query.chartQuery(
          user,
          dataset,
          (chart.config || {}) as Record<string, unknown>,
        );
        result.push({
          id: component.id,
          chartId: component.chartId,
          type: component.type,
          title: component.title || text(chart.name),
          position: component.position,
          config: component.config,
          chart,
          columns: data.columns,
          rows: data.rows,
          error: '',
        });
      } catch (error) {
        result.push({
          id: component.id,
          chartId: component.chartId,
          type: component.type,
          title: component.title,
          position: component.position,
          config: component.config,
          chart,
          columns: [],
          rows: [],
          error: (error as Error)?.message || '图表查询失败',
        });
      }
    }
    const [dashboard] = await this.views([row]);
    return { dashboard, components: result };
  }
}
