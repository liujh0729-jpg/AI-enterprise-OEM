import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { BiScopeService, BiContext } from './bi.scope';
import { BiCrypto } from './bi-crypto';
import {
  biQuery,
  biTestConnection,
  type BiDbConfig,
  type BiDbType,
} from './bi-db.client';

type StoredConfig = {
  host: string;
  port: number;
  database: string;
  schema: string;
  username: string;
  password: string;
};

const DB_TYPE_LABELS: Record<string, string> = {
  PG: 'PostgreSQL',
  MYSQL: 'MySQL',
  CRM: '内置 CRM 数据',
  BUSINESS: '内置业务数据',
  DATATABLE: '多维表格',
};

export const BI_INTERNAL_SOURCE_ID = 0;
export const BI_INTERNAL_SOURCE = {
  id: 0,
  name: '内置 CRM 数据',
  kind: 'INTERNAL',
  type: 'CRM',
  typeLabel: '内置 CRM 数据',
  host: '',
  port: 0,
  database: '',
  schema: 'public',
  username: '',
  ssl: false,
  status: 'ACTIVE',
  lastTestAt: '',
  lastError: '',
  tableCount: 6,
  hasPassword: false,
};

export class BiDatasourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BiScopeService,
    private readonly crypto: BiCrypto,
  ) {}

  async list(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.biDatasource.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.biDatasourceTable.groupBy({
      by: ['datasourceId'],
      where: { ownerUserId: ctx.ownerUserId },
      _count: { _all: true },
    });
    const countMap = new Map(
      counts.map((row) => [row.datasourceId, row._count._all]),
    );
    return [
      { ...BI_INTERNAL_SOURCE },
      ...rows.map((row) => {
        const config = this.readConfig(row.configCipher, false);
        return {
          id: row.id,
          name: row.name,
          kind: row.kind,
          type: row.type,
          typeLabel: DB_TYPE_LABELS[row.type] || row.type,
          host: config.host,
          port: config.port,
          database: config.database,
          schema: config.schema,
          username: config.username,
          ssl: row.ssl,
          status: row.status,
          lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : '',
          lastError: row.lastError,
          tableCount: countMap.get(row.id) || 0,
          hasPassword: Boolean(row.configCipher),
        };
      }),
    ];
  }

  private readConfig(cipher: string, withPassword: boolean): StoredConfig {
    if (!cipher) {
      return {
        host: '',
        port: 0,
        database: '',
        schema: '',
        username: '',
        password: '',
      };
    }
    try {
      const parsed = JSON.parse(this.crypto.decrypt(cipher)) as StoredConfig;
      return {
        host: text(parsed.host),
        port: Number(parsed.port) || 0,
        database: text(parsed.database),
        schema: text(parsed.schema, 'public') || 'public',
        username: text(parsed.username),
        password: withPassword ? text(parsed.password) : '',
      };
    } catch {
      return {
        host: '',
        port: 0,
        database: '',
        schema: '',
        username: '',
        password: '',
      };
    }
  }

  private dbConfig(row: { configCipher: string; ssl: boolean }): BiDbConfig {
    const config = this.readConfig(row.configCipher, true);
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      schema: config.schema,
      username: config.username,
      password: config.password,
      ssl: row.ssl,
    };
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    return this.save(user, body, 0);
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    return this.save(user, body, Number(rawId));
  }

  private async save(
    user: CurrentUser,
    body: Record<string, unknown>,
    id: number,
  ) {
    const ctx = await this.scope.requireMember(user);
    const type = text(body.type, 'PG');
    if (!['PG', 'MYSQL'].includes(type)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只支持 PostgreSQL / MySQL',
      );
    }
    const name = text(body.name).trim().slice(0, 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写数据源名称');
    const host = text(body.host).trim();
    const database = text(body.database).trim();
    const username = text(body.username).trim();
    const port = Number(body.port) || (type === 'PG' ? 5432 : 3306);
    if (!host || !database || !username) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '主机、库名、用户名都要填写',
      );
    }
    if (!/^[A-Za-z0-9_$-]{1,64}$/.test(database)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '库名只能包含字母、数字、下划线、短横线和 $',
      );
    }
    const schema = text(body.schema, 'public').trim() || 'public';
    if (!/^[A-Za-z0-9_$]{1,64}$/.test(schema)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'schema 只能包含字母、数字、下划线和 $',
      );
    }
    let password = text(body.password);
    if (id) {
      const existing = await this.prisma.biDatasource.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId, kind: 'EXTERNAL' },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '数据源不存在');
      if (!password)
        password = this.readConfig(existing.configCipher, true).password;
      if (!password)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写数据库密码');
      const config: StoredConfig = {
        host,
        port,
        database,
        schema,
        username,
        password,
      };
      const row = await this.prisma.biDatasource.update({
        where: { id },
        data: {
          name,
          type,
          configCipher: this.crypto.encrypt(JSON.stringify(config)),
          ssl: Boolean(body.ssl),
          status: text(body.status, 'ACTIVE'),
          lastError: '',
        },
      });
      return this.view(row);
    }
    if (!password)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写数据库密码');
    const config: StoredConfig = {
      host,
      port,
      database,
      schema: text(body.schema, 'public') || 'public',
      username,
      password,
    };
    const row = await this.prisma.biDatasource.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        name,
        kind: 'EXTERNAL',
        type,
        configCipher: this.crypto.encrypt(JSON.stringify(config)),
        ssl: Boolean(body.ssl),
        readOnly: true,
        status: 'ACTIVE',
      },
    });
    return this.view(row);
  }

  private view(row: {
    id: number;
    name: string;
    kind: string;
    type: string;
    configCipher: string;
    ssl: boolean;
    status: string;
    lastTestAt: Date | null;
    lastError: string;
  }) {
    const config = this.readConfig(row.configCipher, false);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      type: row.type,
      typeLabel: DB_TYPE_LABELS[row.type] || row.type,
      host: config.host,
      port: config.port,
      database: config.database,
      schema: config.schema,
      username: config.username,
      ssl: row.ssl,
      status: row.status,
      lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : '',
      lastError: row.lastError,
      tableCount: 0,
      hasPassword: Boolean(row.configCipher),
    };
  }

  async external(ctx: BiContext, id: number) {
    const row = await this.prisma.biDatasource.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId, kind: 'EXTERNAL' },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '数据源不存在');
    return row;
  }

  async test(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.external(ctx, Number(rawId));
    const result = await biTestConnection(
      row.type as BiDbType,
      this.dbConfig(row),
    );
    await this.prisma.biDatasource.update({
      where: { id: row.id },
      data: {
        lastTestAt: new Date(),
        lastError: result.ok ? '' : result.message,
        status: result.ok ? 'ACTIVE' : 'ERROR',
      },
    });
    return result;
  }

  async sync(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    const row = await this.external(ctx, Number(rawId));
    const config = this.dbConfig(row);
    const sql =
      row.type === 'PG'
        ? `SELECT t.table_name, COALESCE(obj_description(c.oid), '') AS table_comment, a.attname AS field_name, format_type(a.atttypid, a.atttypmod) AS field_type, COALESCE(col_description(c.oid, a.attnum), '') AS field_comment FROM information_schema.tables t JOIN pg_class c ON c.relname = t.table_name JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE t.table_schema = '${config.schema || 'public'}' ORDER BY t.table_name, a.attnum`
        : `SELECT TABLE_NAME AS table_name, TABLE_COMMENT AS table_comment, COLUMN_NAME AS field_name, COLUMN_TYPE AS field_type, COLUMN_COMMENT AS field_comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${config.database}' ORDER BY TABLE_NAME, ORDINAL_POSITION`;
    let result;
    try {
      result = await biQuery(row.type as BiDbType, config, sql, {
        timeoutMs: 20000,
        maxRows: 50000,
      });
    } catch (error) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `同步表结构失败：${(error as Error)?.message || '数据库返回错误'}`,
      );
    }
    const tables = new Map<
      string,
      { comment: string; fields: Array<Record<string, unknown>> }
    >();
    for (const item of result.rows) {
      const tableName = text(item.table_name);
      if (!tableName) continue;
      const entry = tables.get(tableName) || {
        comment: text(item.table_comment),
        fields: [],
      };
      entry.fields.push(item);
      tables.set(tableName, entry);
    }
    let tableCount = 0;
    let fieldCount = 0;
    for (const [tableName, entry] of tables) {
      const table = await this.prisma.biDatasourceTable.upsert({
        where: {
          datasourceId_tableName: {
            datasourceId: row.id,
            tableName,
          },
        },
        create: {
          ownerUserId: ctx.ownerUserId,
          datasourceId: row.id,
          tableName,
          tableComment: entry.comment.slice(0, 200),
        },
        update: { tableComment: entry.comment.slice(0, 200) },
      });
      tableCount += 1;
      for (const field of entry.fields) {
        const fieldName = text(field.field_name);
        if (!fieldName) continue;
        await this.prisma.biDatasourceField.upsert({
          where: { tableId_fieldName: { tableId: table.id, fieldName } },
          create: {
            ownerUserId: ctx.ownerUserId,
            tableId: table.id,
            fieldName,
            fieldType: text(field.field_type).slice(0, 40),
            fieldComment: text(field.field_comment).slice(0, 200),
          },
          update: {
            fieldType: text(field.field_type).slice(0, 40),
            fieldComment: text(field.field_comment).slice(0, 200),
          },
        });
        fieldCount += 1;
      }
    }
    return { tables: tableCount, fields: fieldCount };
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.external(ctx, id);
    const datasets = await this.prisma.biDataset.count({
      where: { ownerUserId: ctx.ownerUserId, datasourceId: id },
    });
    if (datasets) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `还有 ${datasets} 个数据集在用这个数据源，不能删除`,
      );
    }
    await this.prisma.biDatasourceTable.deleteMany({
      where: { datasourceId: id },
    });
    await this.prisma.biDatasource.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async tables(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.external(ctx, Number(rawId));
    const tables = await this.prisma.biDatasourceTable.findMany({
      where: { ownerUserId: ctx.ownerUserId, datasourceId: row.id },
      orderBy: { tableName: 'asc' },
    });
    const fields = await this.prisma.biDatasourceField.findMany({
      where: { tableId: { in: tables.map((item) => item.id) } },
      orderBy: { id: 'asc' },
    });
    return tables.map((table) => ({
      id: table.id,
      datasourceId: table.datasourceId,
      tableName: table.tableName,
      tableComment: table.tableComment,
      enabled: table.enabled,
      fields: fields
        .filter((field) => field.tableId === table.id)
        .map((field) => ({
          id: field.id,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          fieldComment: field.fieldComment,
          enabled: field.enabled,
        })),
    }));
  }

  async saveField(
    user: CurrentUser,
    rawId: string,
    fieldId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'editor');
    await this.external(ctx, Number(rawId));
    const field = await this.prisma.biDatasourceField.findFirst({
      where: { id: Number(fieldId), ownerUserId: ctx.ownerUserId },
    });
    if (!field) throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    const updated = await this.prisma.biDatasourceField.update({
      where: { id: field.id },
      data: {
        fieldComment: text(body.fieldComment).slice(0, 200),
        enabled:
          body.enabled === undefined ? field.enabled : Boolean(body.enabled),
      },
    });
    return {
      id: updated.id,
      fieldName: updated.fieldName,
      fieldType: updated.fieldType,
      fieldComment: updated.fieldComment,
      enabled: updated.enabled,
    };
  }

  configOf(row: { type: string; configCipher: string; ssl: boolean }) {
    return this.dbConfig(row);
  }
}
