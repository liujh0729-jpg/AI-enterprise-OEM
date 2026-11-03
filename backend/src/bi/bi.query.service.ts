import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { CrmScopeService } from '../crm/crm.scope';
import { PrismaService } from '../prisma/prisma.service';
import { BiScopeService, BiContext } from './bi.scope';
import { BiDatasourceService } from './bi.datasource.service';
import { biQuery, closeBiPool } from './bi-db.client';
import { internalDataset, internalScope } from './bi.internal';
import { isPostgres } from '../common/db-provider';

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|set|reset|into|pg_sleep|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|information_schema|pg_catalog|current_setting|set_config|load_file|outfile|dumpfile)\b/i;

const RATE_LIMIT = 20;
const CONCURRENCY = 2;

type RateState = { minute: number; count: number; active: number };
const rateStates = new Map<string, RateState>();

export type DatasetRow = {
  id: number;
  ownerUserId: string;
  name: string;
  type: string;
  datasourceId: number;
  internalKey: string;
  sqlText: string;
  config: unknown;
  description: string;
  status: string;
};

export type QueryColumns = { key: string; label: string; type: string }[];

export class BiQueryService {
  /** 查询成功后的计费钩子（services.ts 装配）：扣费失败不影响查询结果。 */
  pointsChargeSafely?: (
    userId: string,
    code: string,
    quantity: number,
    refId?: string,
  ) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly crmScope: CrmScopeService,
    private readonly datasources: BiDatasourceService,
  ) {}

  guardSql(raw: string) {
    const sql = text(raw).trim();
    if (!sql) throw new BusinessException(ErrorCode.BAD_REQUEST, 'SQL 为空');
    if (sql.length > 20000) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'SQL 太长（最多 20000 字符）',
      );
    }
    const stripped = sql.replace(/;+\s*$/, '');
    if (stripped.includes(';')) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '只允许执行单条查询');
    }
    if (!/^(select|with)\b/i.test(stripped)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只允许执行 SELECT / WITH 查询',
      );
    }
    if (/--|\/\*|#/.test(stripped)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'SQL 不允许包含注释');
    }
    const hit = FORBIDDEN.exec(stripped);
    if (hit) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `SQL 包含不允许的关键字：${hit[1]}`,
      );
    }
    return stripped;
  }

  private acquire(userId: string) {
    const minute = Math.floor(Date.now() / 60000);
    const state = rateStates.get(userId) || { minute, count: 0, active: 0 };
    if (state.minute !== minute) {
      state.minute = minute;
      state.count = 0;
    }
    if (state.count >= RATE_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '问数太频繁，请稍后再试',
      );
    }
    if (state.active >= CONCURRENCY) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还有查询在跑，请稍后再试',
      );
    }
    state.count += 1;
    state.active += 1;
    rateStates.set(userId, state);
    return () => {
      state.active = Math.max(0, state.active - 1);
    };
  }

  private async buildBase(ctx: BiContext, dataset: DatasetRow) {
    if (dataset.type === 'INTERNAL') {
      const key =
        dataset.internalKey ||
        text((dataset.config as Record<string, unknown>)?.internalKey);
      const crmCtx = await this.crmScope.context(
        new CurrentUser(ctx.actorId, ctx.actorId, ''),
      );
      if (!crmCtx.isMember) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '没有 CRM 权限，不能查询 CRM 数据集',
        );
      }
      const internal = internalDataset(key);
      const scoped = internalScope(internal, crmCtx, isPostgres());
      return {
        sql: scoped.sql,
        params: scoped.params,
        type: 'INTERNAL' as const,
        dataset,
      };
    }
    const row = await this.prisma.biDatasource.findFirst({
      where: {
        id: dataset.datasourceId,
        ownerUserId: ctx.ownerUserId,
        kind: 'EXTERNAL',
      },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '数据集的数据源不存在',
      );
    if (dataset.type === 'SQL') {
      const sql = this.guardSql(dataset.sqlText);
      return {
        sql,
        params: [] as unknown[],
        type: row.type as 'PG' | 'MYSQL',
        dataset: row,
      };
    }
    const tables = await this.prisma.biDatasetTable.findMany({
      where: { datasetId: dataset.id },
      orderBy: { id: 'asc' },
    });
    if (!tables.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '表数据集还没有选择表',
      );
    }
    const source = await this.prisma.biDatasourceTable.findFirst({
      where: { id: tables[0].datasourceTableId, ownerUserId: ctx.ownerUserId },
    });
    if (!source)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '数据集引用的表不存在',
      );
    const fields = await this.prisma.biDatasourceField.findMany({
      where: { tableId: source.id, enabled: true },
      orderBy: { id: 'asc' },
    });
    const quote = (name: string) =>
      row.type === 'MYSQL'
        ? `\`${name.replace(/`/g, '``')}\``
        : `"${name.replace(/"/g, '""')}"`;
    const config = this.datasources.configOf(row);
    const schema = config.schema || 'public';
    const tableRef =
      row.type === 'MYSQL'
        ? quote(source.tableName)
        : `${quote(schema)}.${quote(source.tableName)}`;
    const columns = fields.length
      ? fields.map((item) => quote(item.fieldName)).join(', ')
      : '*';
    return {
      sql: `SELECT ${columns} FROM ${tableRef}`,
      params: [] as unknown[],
      type: row.type as 'PG' | 'MYSQL',
      dataset: row,
    };
  }

  private async baseOf(ctx: BiContext, dataset: DatasetRow) {
    const base = await this.buildBase(ctx, dataset);
    if (ctx.role === 'ADMIN') return base;
    const permission = await this.prisma.biDatasetPermission.findUnique({
      where: {
        datasetId_role: { datasetId: dataset.id, role: ctx.role || 'VIEWER' },
      },
    });
    const filter = text(permission?.rowFilter).trim();
    if (!filter) return base;
    const resolved = filter
      .replace(/\$\{(userId|actorId|accountId)\}/g, this.literal(ctx.actorId))
      .replace(/\$\{deptId\}/g, this.literal(''));
    return {
      ...base,
      sql: `SELECT * FROM (${base.sql}) AS __bi_perm WHERE (${resolved})`,
    };
  }

  private async run(
    base: {
      sql: string;
      params: unknown[];
      type: 'INTERNAL' | 'PG' | 'MYSQL';
      dataset: unknown;
    },
    querySql: string,
    options: { maxRows?: number; timeoutMs?: number } = {},
  ) {
    const maxRows = Math.min(options.maxRows || 10000, 50000);
    if (base.type === 'INTERNAL') {
      const wrapped = `WITH dataset AS (${base.sql}) ${querySql}`;
      const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        wrapped,
        ...base.params,
      );
      const truncated = rows.length > maxRows;
      const sliced = truncated ? rows.slice(0, maxRows) : rows;
      return this.toResult(sliced, truncated, maxRows);
    }
    const datasource = base.dataset as {
      type: string;
      configCipher: string;
      ssl: boolean;
    };
    const config = this.datasources.configOf(datasource);
    const wrapped = `WITH dataset AS (${base.sql}) ${querySql}`;
    const result = await biQuery(
      datasource.type as 'PG' | 'MYSQL',
      config,
      wrapped,
      {
        maxRows,
        timeoutMs: options.timeoutMs || 30000,
      },
    );
    return {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      elapsedMs: result.elapsedMs,
    };
  }

  private toResult(
    rows: Record<string, unknown>[],
    truncated: boolean,
    maxRows: number,
  ) {
    const columns: QueryColumns = [];
    if (rows.length) {
      for (const [key, value] of Object.entries(rows[0])) {
        columns.push({ key, label: key, type: this.typeOf(value) });
      }
    }
    return {
      columns,
      rows: rows.map((row) => this.jsonRow(row)),
      rowCount: Math.min(rows.length, maxRows),
      truncated,
      elapsedMs: 0,
    };
  }

  private typeOf(value: unknown) {
    if (value instanceof Date) return 'date';
    if (value instanceof Prisma.Decimal) return 'number';
    if (typeof value === 'number' || typeof value === 'bigint') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'text';
  }

  private jsonRow(row: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) result[key] = value.toISOString();
      else if (value instanceof Prisma.Decimal) result[key] = value.toNumber();
      else if (typeof value === 'bigint') result[key] = Number(value);
      else result[key] = value;
    }
    return result;
  }

  async preview(user: CurrentUser, dataset: DatasetRow, limit = 20) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'read');
    const release = this.acquire(ctx.actorId);
    try {
      const base = await this.baseOf(ctx, dataset);
      const result = await this.run(
        base,
        `SELECT * FROM dataset LIMIT ${Math.min(limit, 100)}`,
      );
      await this.log(ctx, dataset, base.sql, result.rowCount, 0, '');
      return { ...result, sql: base.sql };
    } finally {
      release();
    }
  }

  async runSql(
    user: CurrentUser,
    dataset: DatasetRow,
    querySql: string,
    channel = 'web',
  ) {
    const ctx = await this.scope.requireMember(user);
    const guarded = this.guardSql(querySql);
    const release = this.acquire(ctx.actorId);
    const started = Date.now();
    try {
      const base = await this.baseOf(ctx, dataset);
      const result = await this.run(base, guarded);
      await this.log(
        ctx,
        dataset,
        guarded,
        result.rowCount,
        Date.now() - started,
        '',
        channel,
      );
      if (this.pointsChargeSafely) {
        await this.pointsChargeSafely(
          ctx.ownerUserId,
          'bi',
          1,
          String(dataset.id),
        ).catch(() => undefined);
      }
      return result;
    } catch (error) {
      await this.log(
        ctx,
        dataset,
        guarded,
        0,
        Date.now() - started,
        (error as Error)?.message || '查询失败',
        channel,
      );
      closeBiPool();
      throw error;
    } finally {
      release();
    }
  }

  private async log(
    ctx: BiContext,
    dataset: DatasetRow,
    sql: string,
    rows: number,
    elapsedMs: number,
    error: string,
    channel = 'web',
  ) {
    await this.prisma.biQueryLog.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        datasourceId: dataset.datasourceId,
        datasetId: dataset.id,
        sqlText: sql.slice(0, 20000),
        status: error ? 'error' : 'ok',
        rows,
        elapsedMs,
        error: error.slice(0, 2000),
        channel,
      },
    });
  }

  /**
   * 图表/问数最终要落到哪个库，就用那个库的标识符引用符：
   * - INTERNAL 数据集跑在应用自身库（isPostgres 判定）；
   * - SQL/TABLE 数据集跑在其外部数据源（PG 双引号 / MYSQL 反引号）。
   * （此前恒用双引号：MySQL 默认 sql_mode 下双引号是字符串字面量，会静默把列引用取成常量。）
   */
  private async quoteFor(dataset: DatasetRow) {
    let pg: boolean;
    if (dataset.type === 'INTERNAL') {
      pg = isPostgres();
    } else {
      const row = await this.prisma.biDatasource.findFirst({
        where: { id: dataset.datasourceId },
        select: { type: true },
      });
      pg = row?.type !== 'MYSQL';
    }
    return (value: string) =>
      pg ? `"${value.replace(/"/g, '""')}"` : `\`${value.replace(/`/g, '``')}\``;
  }

  /** 图表：按维度/指标/过滤生成聚合 SQL。 */
  async chartQuery(
    user: CurrentUser,
    dataset: DatasetRow,
    config: Record<string, unknown>,
  ) {
    const dimensions = Array.isArray(config.dimensions)
      ? config.dimensions.map((item) => text(item)).filter(Boolean)
      : [];
    const measures = Array.isArray(config.measures)
      ? (config.measures as Array<Record<string, unknown>>)
      : [];
    if (!dimensions.length && !measures.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '图表至少选择一个维度或指标',
      );
    }
    const fieldRows = await this.prisma.biDatasetField.findMany({
      where: { datasetId: dataset.id, visible: true },
    });
    type FieldMeta = {
      fieldKey: string;
      name: string;
      type: string;
      role: string;
      aggregate: string;
      expression: string;
    };
    const fieldMap = new Map<string, FieldMeta>();
    for (const item of fieldRows) {
      fieldMap.set(item.fieldKey, {
        fieldKey: item.fieldKey,
        name: item.name,
        type: item.type,
        role: item.role,
        aggregate: item.aggregate,
        expression: item.expression,
      });
    }
    if (!fieldMap.size && dataset.type === 'INTERNAL') {
      const internal = internalDataset(dataset.internalKey || 'LEADS');
      for (const item of internal.fields) {
        fieldMap.set(item.key, {
          fieldKey: item.key,
          name: item.name,
          type: item.type,
          role: item.role,
          aggregate: item.aggregate || '',
          expression: item.expression || '',
        });
      }
    }
    const quote = await this.quoteFor(dataset);
    const select: string[] = [];
    const measureAliases: string[] = [];
    for (const dimension of dimensions) {
      const field = fieldMap.get(dimension);
      if (!field) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `维度 ${dimension} 不存在`,
        );
      }
      select.push(
        `${field.expression || quote(field.fieldKey)} AS ${quote(dimension)}`,
      );
    }
    for (const measure of measures) {
      const key = text(measure.key);
      const field = fieldMap.get(key);
      if (!field) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `指标 ${key} 不存在`,
        );
      }
      const aggregate = text(
        measure.aggregate,
        field.aggregate || 'SUM',
      ).toUpperCase();
      if (!['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'].includes(aggregate)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '聚合方式不支持');
      }
      const expression = field.expression || quote(field.fieldKey);
      const alias = text(measure.alias) || `${key}_${aggregate.toLowerCase()}`;
      const aggregateExpression =
        field.expression && /^count\s*\(/i.test(field.expression)
          ? field.expression
          : `${aggregate}(${expression})`;
      measureAliases.push(alias);
      select.push(`${aggregateExpression} AS ${quote(alias)}`);
    }
    const where: string[] = [];
    const filters = Array.isArray(config.filters)
      ? (config.filters as Array<Record<string, unknown>>)
      : [];
    for (const filter of filters) {
      const field = fieldMap.get(text(filter.field));
      if (!field) continue;
      const operator = text(filter.operator, 'eq');
      const value = filter.value;
      const sqlOperator =
        operator === 'eq'
          ? '='
          : operator === 'neq'
            ? '<>'
            : operator === 'gt'
              ? '>'
              : operator === 'gte'
                ? '>='
                : operator === 'lt'
                  ? '<'
                  : operator === 'lte'
                    ? '<='
                    : operator === 'like'
                      ? 'LIKE'
                      : '';
      if (!sqlOperator) continue;
      where.push(
        `${field.expression || quote(field.fieldKey)} ${sqlOperator} ${this.literal(value)}`,
      );
    }
    const groupBy = dimensions.map((key) => quote(key));
    const sortKey = text(config.sortKey);
    const sortDir = text(config.sortDir, 'desc') === 'asc' ? 'ASC' : 'DESC';
    const orderBy = sortKey
      ? `${quote(sortKey)} ${sortDir}`
      : measures.length
        ? `${quote(measureAliases[0])} DESC`
        : '';
    const limit = Math.min(Number(config.limit) || 1000, 10000);
    const sql = [
      `SELECT ${select.join(', ')}`,
      'FROM dataset',
      where.length ? `WHERE ${where.join(' AND ')}` : '',
      groupBy.length ? `GROUP BY ${groupBy.join(', ')}` : '',
      orderBy ? `ORDER BY ${orderBy}` : '',
      `LIMIT ${limit}`,
    ]
      .filter(Boolean)
      .join(' ');
    return this.runSql(user, dataset, sql);
  }

  private literal(value: unknown) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number')
      return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return `'${raw.replace(/'/g, "''").slice(0, 500)}'`;
  }

  async datasetById(ownerUserId: string, id: number) {
    const row = await this.prisma.biDataset.findFirst({
      where: { id, ownerUserId, status: 'ACTIVE' },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '数据集不存在');
    return row as DatasetRow;
  }

  async permissionOf(datasetId: number, role: string) {
    const row = await this.prisma.biDatasetPermission.findUnique({
      where: { datasetId_role: { datasetId, role } },
    });
    return row;
  }
}
