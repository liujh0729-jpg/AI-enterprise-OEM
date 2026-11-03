import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { DataTableService } from '../data-table/data-table.service';
import { PrismaService } from '../prisma/prisma.service';
import { BiScopeService, BI_ROLE_LABELS } from './bi.scope';
import { BiQueryService } from './bi.query.service';
import { BiChartService } from './bi.chart.service';

const csvEscape = (value: unknown) => {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export class BiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly query: BiQueryService,
    private readonly charts: BiChartService,
    private readonly dataTables: DataTableService,
  ) {}

  async settings(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    const row = ctx.isMember
      ? await this.prisma.biSetting.findUnique({
          where: { ownerUserId: ctx.ownerUserId },
        })
      : null;
    return {
      defaultTextChannelId: row?.defaultTextChannelId || 0,
      defaultTextModel: row?.defaultTextModel || '',
      maxRows: row?.maxRows || 10000,
      queryTimeoutMs: row?.queryTimeoutMs || 30000,
      role: ctx.role,
      roleLabel: BI_ROLE_LABELS[ctx.role] || '',
      isAdmin: ctx.isAdmin,
      isMember: ctx.isMember,
    };
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const data = {
      defaultTextChannelId:
        body.defaultTextChannelId === undefined
          ? undefined
          : Number(body.defaultTextChannelId),
      defaultTextModel:
        body.defaultTextModel === undefined
          ? undefined
          : text(body.defaultTextModel).slice(0, 128),
      maxRows:
        body.maxRows === undefined
          ? undefined
          : Math.min(50000, Math.max(100, Number(body.maxRows))),
      queryTimeoutMs:
        body.queryTimeoutMs === undefined
          ? undefined
          : Math.min(120000, Math.max(1000, Number(body.queryTimeoutMs))),
    };
    await this.prisma.biSetting.upsert({
      where: { ownerUserId: ctx.ownerUserId },
      create: {
        ownerUserId: ctx.ownerUserId,
        defaultTextChannelId: data.defaultTextChannelId || 0,
        defaultTextModel: data.defaultTextModel || '',
        maxRows: data.maxRows || 10000,
        queryTimeoutMs: data.queryTimeoutMs || 30000,
      },
      update: data as never,
    });
    return this.settings(user);
  }

  async members(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const [rows, staff] = await Promise.all([
      this.prisma.biMember.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { id: 'asc' },
      }),
      this.scope.staff(ctx.ownerUserId),
    ]);
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...rows.map((row) => row.memberUserId),
      ...staff.map((row) => row.memberUserId),
    ]);
    const configured = new Set(rows.map((row) => row.memberUserId));
    return {
      rows: rows.map((row) => ({
        id: row.id,
        memberUserId: row.memberUserId,
        memberName: names.get(row.memberUserId) || row.memberUserId,
        role: row.role,
        roleLabel: BI_ROLE_LABELS[row.role] || row.role,
        status: row.status,
        isSelf: row.memberUserId === ctx.actorId,
      })),
      candidates: staff
        .filter((row) => !configured.has(row.memberUserId))
        .map((row) => ({
          memberUserId: row.memberUserId,
          name: row.name,
          memberKind: row.memberKind,
          memberKindLabel: row.memberKindLabel,
          department: row.department,
        })),
      owner: {
        userId: ctx.ownerUserId,
        name: names.get(ctx.ownerUserId) || ctx.ownerUserId,
      },
      isAdmin: ctx.isAdmin,
      myRole: ctx.role,
      myRoleLabel: BI_ROLE_LABELS[ctx.role] || '',
    };
  }

  async saveMember(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const memberUserId = text(body.memberUserId).trim();
    if (!memberUserId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择成员');
    if (memberUserId === ctx.ownerUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '账号所有者不需要再分配权限',
      );
    }
    const staff = await this.scope.staff(ctx.ownerUserId);
    const target = staff.find((row) => row.memberUserId === memberUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该成员不在本账号的职员与代理人中',
      );
    }
    const role = text(body.role, 'ANALYST');
    if (!['ADMIN', 'EDITOR', 'ANALYST', 'VIEWER'].includes(role)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '权限级别不正确');
    }
    const row = await this.prisma.biMember.upsert({
      where: {
        ownerUserId_memberUserId: {
          ownerUserId: ctx.ownerUserId,
          memberUserId,
        },
      },
      create: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        role,
        status: 'ACTIVE',
      },
      update: { role, status: 'ACTIVE' },
    });
    return {
      id: row.id,
      memberUserId: row.memberUserId,
      memberName: target.name,
      role: row.role,
      roleLabel: BI_ROLE_LABELS[row.role] || row.role,
      status: row.status,
      isSelf: row.memberUserId === ctx.actorId,
    };
  }

  async removeMember(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.biMember.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    await this.prisma.biMember.delete({ where: { id } });
    return { removed: true };
  }

  async terms(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.biTerm.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(query.datasetId ? { datasetId: Number(query.datasetId) } : {}),
      },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      datasetId: row.datasetId,
      term: row.term,
      definition: row.definition,
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
      enabled: row.enabled,
    }));
  }

  async saveTerm(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const term = text(body.term).trim().slice(0, 80);
    if (!term) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写术语');
    const data = {
      datasetId: Number(body.datasetId) || 0,
      term,
      definition: text(body.definition).slice(0, 1000),
      synonyms: (Array.isArray(body.synonyms) ? body.synonyms : []) as never,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    };
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biTerm.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '术语不存在');
    }
    const row = id
      ? await this.prisma.biTerm.update({ where: { id }, data })
      : await this.prisma.biTerm.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      datasetId: row.datasetId,
      term: row.term,
      definition: row.definition,
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
      enabled: row.enabled,
    };
  }

  async removeTerm(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    await this.prisma.biTerm.deleteMany({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    return { removed: true };
  }

  async trainings(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.biTraining.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(query.datasetId ? { datasetId: Number(query.datasetId) } : {}),
      },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      datasetId: row.datasetId,
      question: row.question,
      sqlText: row.sqlText,
      enabled: row.enabled,
    }));
  }

  async saveTraining(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const question = text(body.question).trim().slice(0, 500);
    const sqlText = this.query.guardSql(text(body.sqlText));
    if (!question)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写示例问题');
    const data = {
      datasetId: Number(body.datasetId) || 0,
      question,
      sqlText,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    };
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biTraining.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '示例不存在');
    }
    const row = id
      ? await this.prisma.biTraining.update({ where: { id }, data })
      : await this.prisma.biTraining.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      datasetId: row.datasetId,
      question: row.question,
      sqlText: row.sqlText,
      enabled: row.enabled,
    };
  }

  async removeTraining(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    await this.prisma.biTraining.deleteMany({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    return { removed: true };
  }

  async recommended(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.biRecommendedQuestion.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(query.datasetId ? { datasetId: Number(query.datasetId) } : {}),
      },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      datasetId: row.datasetId,
      question: row.question,
      sort: row.sort,
    }));
  }

  async saveRecommended(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const question = text(body.question).trim().slice(0, 500);
    if (!question)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写推荐问题');
    const data = {
      datasetId: Number(body.datasetId) || 0,
      question,
      sort: Number(body.sort) || 0,
    };
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biRecommendedQuestion.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '推荐问题不存在');
    }
    const row = id
      ? await this.prisma.biRecommendedQuestion.update({ where: { id }, data })
      : await this.prisma.biRecommendedQuestion.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      datasetId: row.datasetId,
      question: row.question,
      sort: row.sort,
    };
  }

  async removeRecommended(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    await this.prisma.biRecommendedQuestion.deleteMany({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    return { removed: true };
  }

  async queryLogs(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where = {
      ownerUserId: ctx.ownerUserId,
      ...(query.status ? { status: text(query.status) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.biQueryLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.biQueryLog.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        datasetId: row.datasetId,
        datasourceId: row.datasourceId,
        sqlText: row.sqlText,
        status: row.status,
        rows: row.rows,
        elapsedMs: row.elapsedMs,
        error: row.error,
        channel: row.channel,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async workbench(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    if (!ctx.isMember) {
      return {
        isMember: false,
        role: '',
        roleLabel: '',
        stats: [],
        recentSessions: [],
        recentDashboards: [],
        datasets: [],
      };
    }
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [sessions, queries, failed, datasets, dashboards] = await Promise.all(
      [
        this.prisma.biChatSession.count({
          where: { ownerUserId: ctx.ownerUserId },
        }),
        this.prisma.biQueryLog.count({
          where: { ownerUserId: ctx.ownerUserId, createdAt: { gte: week } },
        }),
        this.prisma.biQueryLog.count({
          where: {
            ownerUserId: ctx.ownerUserId,
            status: 'error',
            createdAt: { gte: week },
          },
        }),
        this.prisma.biDataset.count({
          where: { ownerUserId: ctx.ownerUserId },
        }),
        this.prisma.biDashboard.count({
          where: { ownerUserId: ctx.ownerUserId },
        }),
      ],
    );
    const recentSessions = await this.prisma.biChatSession.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    const recentDashboards = await this.prisma.biDashboard.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    const datasetRows = await this.prisma.biDataset.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    });
    const datasetNames = new Map(datasetRows.map((row) => [row.id, row.name]));
    return {
      isMember: true,
      role: ctx.role,
      roleLabel: BI_ROLE_LABELS[ctx.role] || '',
      stats: [
        { key: 'sessions', label: '问数会话', value: String(sessions) },
        { key: 'week', label: '本周查询', value: String(queries) },
        { key: 'failed', label: '本周失败', value: String(failed) },
        { key: 'datasets', label: '数据集', value: String(datasets) },
        { key: 'dashboards', label: '仪表板', value: String(dashboards) },
      ],
      recentSessions: recentSessions.map((row) => ({
        id: row.id,
        datasetId: row.datasetId,
        datasetName: datasetNames.get(row.datasetId) || '',
        title: row.title,
        messageCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
      recentDashboards: recentDashboards.map((row) => ({
        id: row.id,
        name: row.name,
        layout: [],
        config: row.config,
        componentCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
      datasets: datasetRows.map((row) => ({
        id: row.id,
        groupId: row.groupId,
        groupName: '',
        name: row.name,
        type: row.type,
        typeLabel:
          row.type === 'INTERNAL'
            ? '内置数据集'
            : row.type === 'SQL'
              ? 'SQL 数据集'
              : '表数据集',
        datasourceId: row.datasourceId,
        datasourceName: '',
        internalKey: row.internalKey,
        sqlText: row.sqlText,
        description: row.description,
        status: row.status,
        fieldCount: 0,
        chartCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async recent(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const [sessions, charts, dashboards] = await Promise.all([
      this.prisma.biChatSession.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.biChart.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.biDashboard.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);
    return {
      sessions: sessions.map((row) => ({
        id: row.id,
        datasetId: row.datasetId,
        datasetName: '',
        title: row.title,
        messageCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
      charts: charts.map((row) => ({
        id: row.id,
        datasetId: row.datasetId,
        datasetName: '',
        name: row.name,
        chartType: row.chartType,
        chartTypeLabel: row.chartType,
        config: row.config,
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      })),
      dashboards: dashboards.map((row) => ({
        id: row.id,
        name: row.name,
        layout: [],
        config: row.config,
        componentCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  private toCsv(
    columns: { key: string; label?: string }[],
    rows: Record<string, unknown>[],
  ) {
    const header = columns
      .map((item) => csvEscape(item.label || item.key))
      .join(',');
    const body = rows
      .map((row) => columns.map((item) => csvEscape(row[item.key])).join(','))
      .join('\r\n');
    return `\uFEFF${header}\r\n${body}`;
  }

  async export(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const type = text(body.type, 'DATASET');
    const id = Number(body.id);
    if (type === 'CHART') {
      const data = await this.charts.data(user, String(id));
      return {
        filename: `${data.chart.name}.csv`,
        content: this.toCsv(data.columns, data.rows),
        rows: data.rowCount,
      };
    }
    if (type === 'ASK') {
      const message = await this.prisma.biChatMessage.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!message)
        throw new BusinessException(ErrorCode.NOT_FOUND, '问数结果不存在');
      const rows = Array.isArray(message.resultPreview)
        ? (message.resultPreview as Array<Record<string, unknown>>)
        : [];
      const columns = rows.length
        ? Object.keys(rows[0]).map((key) => ({ key }))
        : [];
      return {
        filename: `ask-${id}.csv`,
        content: this.toCsv(columns, rows),
        rows: rows.length,
      };
    }
    const dataset = await this.query.datasetById(ctx.ownerUserId, id);
    const preview = await this.query.preview(user, dataset, 100);
    const columns = preview.columns.map((item) => ({
      key: item.key,
      label: item.label,
    }));
    return {
      filename: `${dataset.name}.csv`,
      content: this.toCsv(columns, preview.rows),
      rows: preview.rowCount,
    };
  }

  async exportToDataTable(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const dataset = await this.query.datasetById(
      ctx.ownerUserId,
      Number(body.datasetId),
    );
    const preview = await this.query.preview(
      user,
      dataset,
      Number(body.limit) || 1000,
    );
    let dataTableId = Number(body.dataTableId) || 0;
    let created = false;
    if (!dataTableId) {
      const table = await this.dataTables.create(user, {
        name: text(body.tableName) || `BI ${dataset.name} 导出`,
        description: '从 BI 数据集导出',
      });
      dataTableId = Number((table as Record<string, unknown>).id);
      created = true;
      await this.dataTables.addFields(
        user,
        dataTableId,
        preview.columns.map((item) => ({
          name: item.label,
          fieldKey: item.key,
          fieldType: item.type === 'number' ? 'number' : 'text',
        })),
      );
    }
    for (let index = 0; index < preview.rows.length; index += 200) {
      await this.dataTables.createRows(
        user,
        dataTableId,
        preview.rows.slice(index, index + 200),
      );
    }
    return { dataTableId, rows: preview.rows.length, created };
  }
}
