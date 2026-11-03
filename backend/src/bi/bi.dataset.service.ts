import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { BiScopeService, BiContext } from './bi.scope';
import { BiQueryService } from './bi.query.service';
import { INTERNAL_DATASETS, internalDataset } from './bi.internal';

const DATASET_TYPES = new Set(['INTERNAL', 'TABLE', 'SQL']);

export class BiDatasetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly query: BiQueryService,
  ) {}

  async groups(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.biDatasetGroup.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, sort: row.sort }));
  }

  async saveGroup(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const name = text(body.name).trim().slice(0, 60);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写分组名称');
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biDatasetGroup.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在');
    }
    const row = id
      ? await this.prisma.biDatasetGroup.update({
          where: { id },
          data: { name, sort: Number(body.sort) || 0 },
        })
      : await this.prisma.biDatasetGroup.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            name,
            sort: Number(body.sort) || 0,
          },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在');
    }
    return { id: row.id, name: row.name, sort: row.sort };
  }

  async removeGroup(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const id = Number(rawId);
    const row = await this.prisma.biDatasetGroup.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在');
    const used = await this.prisma.biDataset.count({
      where: { ownerUserId: ctx.ownerUserId, groupId: id },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `分组里还有 ${used} 个数据集`,
      );
    await this.prisma.biDatasetGroup.delete({ where: { id } });
    return { removed: true };
  }

  private async views(rows: Array<Record<string, unknown>>, ctx: BiContext) {
    if (!rows.length) return [];
    const [groups, datasources, fieldCounts, chartCounts] = await Promise.all([
      this.prisma.biDatasetGroup.findMany({
        where: { ownerUserId: ctx.ownerUserId },
      }),
      this.prisma.biDatasource.findMany({
        where: { ownerUserId: ctx.ownerUserId },
      }),
      this.prisma.biDatasetField.groupBy({
        by: ['datasetId'],
        where: { datasetId: { in: rows.map((row) => Number(row.id)) } },
        _count: { _all: true },
      }),
      this.prisma.biChart.groupBy({
        by: ['datasetId'],
        where: { ownerUserId: ctx.ownerUserId },
        _count: { _all: true },
      }),
    ]);
    const groupNames = new Map(groups.map((row) => [row.id, row.name]));
    const sourceNames = new Map(datasources.map((row) => [row.id, row.name]));
    const fieldMap = new Map(
      fieldCounts.map((row) => [row.datasetId, row._count._all]),
    );
    const chartMap = new Map(
      chartCounts.map((row) => [row.datasetId, row._count._all]),
    );
    return rows.map((row) => ({
      id: Number(row.id),
      groupId: Number(row.groupId),
      groupName: row.groupId ? groupNames.get(Number(row.groupId)) || '' : '',
      name: text(row.name),
      type: text(row.type),
      typeLabel:
        row.type === 'INTERNAL'
          ? '内置数据集'
          : row.type === 'SQL'
            ? 'SQL 数据集'
            : '表数据集',
      datasourceId: Number(row.datasourceId),
      datasourceName:
        Number(row.datasourceId) === 0
          ? '内置 CRM 数据'
          : sourceNames.get(Number(row.datasourceId)) || '',
      internalKey: text(row.internalKey),
      sqlText: text(row.sqlText),
      description: text(row.description),
      status: text(row.status),
      fieldCount: fieldMap.get(Number(row.id)) || 0,
      chartCount: chartMap.get(Number(row.id)) || 0,
      updatedAt:
        row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where: Record<string, unknown> = { ownerUserId: ctx.ownerUserId };
    if (query.groupId) where.groupId = Number(query.groupId);
    if (query.type) where.type = text(query.type);
    const keyword = text(query.keyword).trim();
    if (keyword) where.name = { contains: keyword };
    const [rows, total] = await Promise.all([
      this.prisma.biDataset.findMany({
        where: where as never,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.biDataset.count({ where: where as never }),
    ]);
    return {
      list: await this.views(rows, ctx),
      total,
      page,
      pageSize,
    };
  }

  private async findOne(ctx: BiContext, rawId: string) {
    const row = await this.prisma.biDataset.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '数据集不存在');
    return row;
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const [view] = await this.views([row], ctx);
    const [fields, tables, permissions, recommended] = await Promise.all([
      this.prisma.biDatasetField.findMany({
        where: { datasetId: row.id },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.biDatasetTable.findMany({ where: { datasetId: row.id } }),
      this.prisma.biDatasetPermission.findMany({
        where: { datasetId: row.id },
      }),
      this.prisma.biRecommendedQuestion.findMany({
        where: { ownerUserId: ctx.ownerUserId, datasetId: row.id },
        orderBy: { sort: 'asc' },
      }),
    ]);
    const internal =
      row.type === 'INTERNAL'
        ? internalDataset(row.internalKey || 'LEADS')
        : null;
    return {
      dataset: view,
      fields: fields.length
        ? fields.map((item) => ({
            id: item.id,
            datasetId: item.datasetId,
            fieldKey: item.fieldKey,
            name: item.name,
            type: item.type,
            comment: item.comment,
            role: item.role,
            aggregate: item.aggregate,
            expression: item.expression,
            format: item.format,
            sort: item.sort,
            visible: item.visible,
          }))
        : (internal?.fields || []).map((item, index) => ({
            id: -(index + 1),
            datasetId: row.id,
            fieldKey: item.key,
            name: item.name,
            type: item.type,
            comment: item.comment,
            role: item.role,
            aggregate: item.aggregate || '',
            expression: item.expression || '',
            format: '',
            sort: index,
            visible: true,
          })),
      tables: tables.map((item) => ({
        id: item.id,
        datasourceTableId: item.datasourceTableId,
        alias: item.alias,
        joinType: item.joinType,
        joinConfig: item.joinConfig,
      })),
      permissions: permissions.map((item) => ({
        id: item.id,
        role: item.role,
        rowFilter: item.rowFilter,
        columnRules: item.columnRules,
      })),
      recommended: recommended.map((item) => item.question),
    };
  }

  private async validateDatasource(ctx: BiContext, datasourceId: number) {
    if (!datasourceId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择数据源');
    }
    const row = await this.prisma.biDatasource.findFirst({
      where: {
        id: datasourceId,
        ownerUserId: ctx.ownerUserId,
        kind: 'EXTERNAL',
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '外部数据源不存在');
    return row;
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const type = text(body.type, 'INTERNAL').toUpperCase();
    if (!DATASET_TYPES.has(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '数据集类型不正确');
    }
    const name = text(body.name).trim().slice(0, 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写数据集名称');
    if (type === 'INTERNAL') {
      const key = text(body.internalKey, 'LEADS').toUpperCase();
      if (!INTERNAL_DATASETS[key as keyof typeof INTERNAL_DATASETS]) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '内置数据集不正确');
      }
      const row = await this.prisma.biDataset.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          groupId: Number(body.groupId) || 0,
          name,
          type,
          internalKey: key,
          description: text(body.description).slice(0, 500),
          config: { internalKey: key } as never,
        },
      });
      await this.seedInternalFields(row.id, key);
      return (await this.views([row], ctx))[0];
    }
    const datasourceId = Number(body.datasourceId) || 0;
    await this.validateDatasource(ctx, datasourceId);
    let sqlText = '';
    if (type === 'SQL') {
      sqlText = this.query.guardSql(text(body.sqlText));
    }
    const tableIds = Array.isArray(body.tableIds)
      ? body.tableIds.map((item) => Number(item)).filter(Boolean)
      : [];
    if (type === 'TABLE' && !tableIds.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '表数据集请至少选择一张表',
      );
    }
    const row = await this.prisma.biDataset.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        groupId: Number(body.groupId) || 0,
        name,
        type,
        datasourceId,
        sqlText,
        description: text(body.description).slice(0, 500),
      },
    });
    for (const tableId of tableIds) {
      await this.prisma.biDatasetTable.create({
        data: {
          datasetId: row.id,
          datasourceTableId: tableId,
          alias: '',
          joinType: 'LEFT',
          joinConfig: {},
        },
      });
    }
    await this.seedTableFields(row.id, tableIds[0]);
    return (await this.views([row], ctx))[0];
  }

  private async seedInternalFields(datasetId: number, key: string) {
    const internal = internalDataset(key);
    for (let index = 0; index < internal.fields.length; index++) {
      const item = internal.fields[index];
      await this.prisma.biDatasetField.create({
        data: {
          datasetId,
          fieldKey: item.key,
          name: item.name,
          type: item.type,
          comment: item.comment,
          role: item.role,
          aggregate: item.aggregate || '',
          expression: item.expression || '',
          sort: index,
          visible: true,
        },
      });
    }
  }

  private async seedTableFields(datasetId: number, tableId: number) {
    if (!tableId) return;
    const fields = await this.prisma.biDatasourceField.findMany({
      where: { tableId, enabled: true },
      orderBy: { id: 'asc' },
    });
    for (let index = 0; index < fields.length; index++) {
      const item = fields[index];
      const numeric = /int|decimal|numeric|float|double|real/i.test(
        item.fieldType,
      );
      await this.prisma.biDatasetField.create({
        data: {
          datasetId,
          fieldKey: item.fieldName,
          name: item.fieldComment || item.fieldName,
          type: item.fieldType,
          comment: item.fieldComment,
          role: numeric ? 'MEASURE' : 'DIMENSION',
          aggregate: numeric ? 'SUM' : '',
          sort: index,
          visible: true,
        },
      });
    }
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const row = await this.findOne(ctx, rawId);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = text(body.name).slice(0, 80);
    if (body.groupId !== undefined) data.groupId = Number(body.groupId) || 0;
    if (body.description !== undefined)
      data.description = text(body.description).slice(0, 500);
    if (body.status !== undefined) data.status = text(body.status, 'ACTIVE');
    if (body.sqlText !== undefined && row.type === 'SQL') {
      data.sqlText = this.query.guardSql(text(body.sqlText));
    }
    await this.prisma.biDataset.update({
      where: { id: row.id },
      data: data as never,
    });
    return (await this.views([await this.findOne(ctx, rawId)], ctx))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const row = await this.findOne(ctx, rawId);
    const charts = await this.prisma.biChart.count({
      where: { ownerUserId: ctx.ownerUserId, datasetId: row.id },
    });
    if (charts) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `还有 ${charts} 个图表在用这个数据集`,
      );
    }
    await this.prisma.biDatasetField.deleteMany({
      where: { datasetId: row.id },
    });
    await this.prisma.biDatasetTable.deleteMany({
      where: { datasetId: row.id },
    });
    await this.prisma.biDatasetPermission.deleteMany({
      where: { datasetId: row.id },
    });
    await this.prisma.biDataset.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async preview(user: CurrentUser, rawId: string, limit: number) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    return this.query.preview(user, row, limit);
  }

  async saveField(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const dataset = await this.findOne(ctx, rawId);
    const fieldKey = text(body.fieldKey).trim();
    if (!fieldKey)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写字段标识');
    const data = {
      fieldKey,
      name: text(body.name, fieldKey).slice(0, 80),
      type: text(body.type).slice(0, 40),
      comment: text(body.comment).slice(0, 200),
      role:
        text(body.role, 'DIMENSION') === 'MEASURE' ? 'MEASURE' : 'DIMENSION',
      aggregate: text(body.aggregate).slice(0, 16),
      expression: text(body.expression).slice(0, 2000),
      format: text(body.format).slice(0, 40),
      sort: Number(body.sort) || 0,
      visible: body.visible === undefined ? true : Boolean(body.visible),
    };
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.biDatasetField.findFirst({
        where: { id, datasetId: dataset.id },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    }
    const row =
      id && id > 0
        ? await this.prisma.biDatasetField.update({ where: { id }, data })
        : await this.prisma.biDatasetField.upsert({
            where: { datasetId_fieldKey: { datasetId: dataset.id, fieldKey } },
            create: { datasetId: dataset.id, ...data },
            update: data,
          });
    return {
      id: row.id,
      datasetId: row.datasetId,
      fieldKey: row.fieldKey,
      name: row.name,
      type: row.type,
      comment: row.comment,
      role: row.role,
      aggregate: row.aggregate,
      expression: row.expression,
      format: row.format,
      sort: row.sort,
      visible: row.visible,
    };
  }

  async removeField(user: CurrentUser, rawId: string, fieldId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const dataset = await this.findOne(ctx, rawId);
    const id = Number(fieldId);
    if (id < 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '内置数据集的默认字段不能删除',
      );
    }
    await this.prisma.biDatasetField.deleteMany({
      where: { id, datasetId: dataset.id },
    });
    return { removed: true };
  }

  async permissions(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const dataset = await this.findOne(ctx, rawId);
    const rows = await this.prisma.biDatasetPermission.findMany({
      where: { datasetId: dataset.id },
    });
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      rowFilter: row.rowFilter,
      columnRules: row.columnRules,
    }));
  }

  async savePermission(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const dataset = await this.findOne(ctx, rawId);
    const role = text(body.role, 'ANALYST');
    if (!['ADMIN', 'EDITOR', 'ANALYST', 'VIEWER'].includes(role)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '权限级别不正确');
    }
    const row = await this.prisma.biDatasetPermission.upsert({
      where: { datasetId_role: { datasetId: dataset.id, role } },
      create: {
        datasetId: dataset.id,
        role,
        rowFilter: text(body.rowFilter).slice(0, 2000),
        columnRules: (body.columnRules || {}) as never,
      },
      update: {
        rowFilter: text(body.rowFilter).slice(0, 2000),
        columnRules: (body.columnRules || {}) as never,
      },
    });
    return {
      id: row.id,
      role: row.role,
      rowFilter: row.rowFilter,
      columnRules: row.columnRules,
    };
  }

  async recommended(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const dataset = await this.findOne(ctx, rawId);
    const rows = await this.prisma.biRecommendedQuestion.findMany({
      where: { ownerUserId: ctx.ownerUserId, datasetId: dataset.id },
      orderBy: { sort: 'asc' },
    });
    return rows.map((row) => row.question);
  }
}
