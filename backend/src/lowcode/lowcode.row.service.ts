import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DataTableService } from '../data-table/data-table.service';
import { PrismaService } from '../prisma/prisma.service';
import { LowCodeAccessService } from './lowcode.access.service';
import {
  type AccessContext,
  fieldRuleState,
  hasEntityAction,
  ownerUser,
  rowAllowed,
  ruleMatches,
  rulesForEntity,
} from './lowcode.shared';

const SCAN_LIMIT = 5000;
const EXPORT_LIMIT = 50000;

type RowFilter = { field: string; op: string; value: string };

type Row = {
  id: number;
  tableId: number;
  data: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type Field = {
  id: number;
  tableId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  sortOrder: number;
  options: Prisma.JsonValue;
  required: boolean;
};

/**
 * 低代码行数据：直接落在实体的多维表格里。
 *
 * 与多维表格模块的分工：写入（类型/必填校验、飞书同步通知）走 `DataTableService`；
 * 读取要叠加低代码自己的两层门控 —— 字段级（hidden / readonly）与行级（数据规则），
 * 多维表格不认识这些规则，所以读路径在这里按权限行过滤后再排序分页。
 */
export class LowCodeRowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataTables: DataTableService,
    private readonly access: LowCodeAccessService,
  ) {}

  private async entityOf(projectId: number, raw: unknown) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '实体编号无效');
    }
    const entity = await this.prisma.lowCodeEntity.findFirst({
      where: { id, projectId },
    });
    if (!entity) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '实体不存在');
    }
    return entity;
  }

  private async fieldsOf(tableId: number): Promise<Field[]> {
    return await this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** 当前角色看不见的字段 / 只读字段（按 `entity:field` 权限行）。 */
  private fieldGates(access: AccessContext, entityId: number, fields: Field[]) {
    const hidden: string[] = [];
    const readonly: string[] = [];
    for (const field of fields) {
      const state = fieldRuleState(access, entityId, field.fieldKey);
      if (state === 'hidden') hidden.push(field.fieldKey);
      if (state === 'readonly') readonly.push(field.fieldKey);
    }
    return { hidden, readonly };
  }

  private rowView(row: Row, hidden: string[]) {
    const data = { ...(row.data || {}) };
    for (const key of hidden) delete data[key];
    return {
      id: row.id,
      tableId: row.tableId,
      data,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private columns(fields: Field[], hidden: string[]) {
    const skip = new Set(hidden);
    return fields
      .filter((field) => !skip.has(field.fieldKey))
      .map((field) => ({
        key: field.fieldKey,
        name: field.name,
        type: field.fieldType,
      }));
  }

  private filtersOf(raw: unknown): RowFilter[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '筛选条件格式不正确');
    }
    return this.normalizeFilters(parsed);
  }

  private normalizeFilters(raw: unknown): RowFilter[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const row = (item || {}) as Record<string, unknown>;
        return {
          field: text(row.field).trim(),
          op: text(row.op).trim() || '=',
          value: text(row.value),
        };
      })
      .filter((item) => item.field);
  }

  private rowMatches(
    access: AccessContext,
    entityId: number,
    row: Row,
    keyword: string,
    filters: RowFilter[],
    visibleKeys: Set<string>,
  ) {
    if (!rowAllowed(access, entityId, row)) return false;
    const data = row.data || {};
    if (keyword) {
      const hit = Object.entries(data).some(
        ([key, value]) =>
          visibleKeys.has(key) && text(value).toLowerCase().includes(keyword),
      );
      if (!hit) return false;
    }
    return filters.every((filter) =>
      ruleMatches(filter, data, row.createdBy, access),
    );
  }

  private sortRows(
    rows: Row[],
    fields: Field[],
    sort: string,
    sortDir: 'asc' | 'desc',
  ) {
    const dir = sortDir === 'desc' ? -1 : 1;
    if (!sort) return rows;
    const field = fields.find((item) => item.fieldKey === sort);
    if (!field) return rows;
    const valueOf = (row: Row) => (row.data || {})[sort];
    return [...rows].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const leftEmpty = left === undefined || left === null || left === '';
      const rightEmpty = right === undefined || right === null || right === '';
      if (leftEmpty && rightEmpty) return b.id - a.id;
      if (leftEmpty) return 1;
      if (rightEmpty) return -1;
      if (field.fieldType === 'number' || field.fieldType === 'boolean') {
        const diff = Number(left) - Number(right);
        return diff === 0 ? b.id - a.id : diff * dir;
      }
      const diff = text(left).localeCompare(text(right), 'zh-CN');
      return diff === 0 ? b.id - a.id : diff * dir;
    });
  }

  private async scan(tableId: number) {
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId },
      orderBy: { id: 'desc' },
      take: SCAN_LIMIT,
    });
    return rows.map(
      (row) =>
        ({
          id: row.id,
          tableId: row.tableId,
          data:
            row.data && typeof row.data === 'object' && !Array.isArray(row.data)
              ? (row.data as Record<string, unknown>)
              : {},
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }) satisfies Row,
    );
  }

  async entityRows(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    query: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      sort?: string;
      sortDir?: 'asc' | 'desc';
      filter?: string;
    },
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'read')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色看不到该实体的数据',
      );
    }
    const fields = await this.fieldsOf(entity.dataTableId);
    const { hidden, readonly } = this.fieldGates(access, entity.id, fields);
    const visibleKeys = new Set(
      fields
        .map((field) => field.fieldKey)
        .filter((key) => !hidden.includes(key)),
    );
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 200);
    const keyword = text(query.keyword).trim().toLowerCase();
    const filters = this.filtersOf(query.filter);
    const sort = text(query.sort).trim();
    const sortDir: 'asc' | 'desc' = query.sortDir === 'desc' ? 'desc' : 'asc';
    const rules = rulesForEntity(access, entity.id);
    const needsScan = Boolean(
      keyword || filters.length || rules.length || sort,
    );

    let list: Row[];
    let total: number;
    if (!needsScan) {
      const [rows, count] = await Promise.all([
        this.prisma.dataTableRow.findMany({
          where: { tableId: entity.dataTableId },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.dataTableRow.count({
          where: { tableId: entity.dataTableId },
        }),
      ]);
      list = rows.map(
        (row) =>
          ({
            id: row.id,
            tableId: row.tableId,
            data:
              row.data &&
              typeof row.data === 'object' &&
              !Array.isArray(row.data)
                ? (row.data as Record<string, unknown>)
                : {},
            createdBy: row.createdBy,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }) satisfies Row,
      );
      total = count;
    } else {
      const scanned = await this.scan(entity.dataTableId);
      const allowed = scanned.filter((row) =>
        this.rowMatches(access, entity.id, row, keyword, filters, visibleKeys),
      );
      const sorted = this.sortRows(allowed, fields, sort, sortDir);
      total = sorted.length;
      list = sorted.slice((page - 1) * pageSize, page * pageSize);
    }

    return {
      list: list.map((row) => this.rowView(row, hidden)),
      total,
      page,
      pageSize,
      columns: this.columns(fields, hidden),
      canCreate: hasEntityAction(access, entity.id, 'create'),
      canUpdate: hasEntityAction(access, entity.id, 'update'),
      canDelete: hasEntityAction(access, entity.id, 'delete'),
      canExport: hasEntityAction(access, entity.id, 'export'),
      hiddenFields: hidden,
      readonlyFields: readonly,
    };
  }

  private async rowOf(
    entityTableId: number,
    raw: unknown,
    access: AccessContext,
    entityId: number,
  ) {
    const rowId = Number(raw);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '数据行编号无效');
    }
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId: entityTableId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    }
    const view = {
      id: row.id,
      tableId: row.tableId,
      data:
        row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? row.data
          : {},
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies Row;
    // 数据规则不放行时按「不存在」处理，不向无权限者泄露该行
    if (!rowAllowed(access, entityId, view)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    }
    return view;
  }

  async entityRow(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    rowIdRaw: unknown,
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'read')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色看不到该实体的数据',
      );
    }
    const row = await this.rowOf(
      entity.dataTableId,
      rowIdRaw,
      access,
      entity.id,
    );
    const fields = await this.fieldsOf(entity.dataTableId);
    const { hidden, readonly } = this.fieldGates(access, entity.id, fields);
    return {
      ...this.rowView(row, hidden),
      canUpdate: hasEntityAction(access, entity.id, 'update'),
      canDelete: hasEntityAction(access, entity.id, 'delete'),
      readonlyFields: readonly,
    };
  }

  async entityRowCreate(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    body: { data: Record<string, unknown> },
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'create')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色不能新增该实体的数据',
      );
    }
    const fields = await this.fieldsOf(entity.dataTableId);
    const { hidden, readonly } = this.fieldGates(access, entity.id, fields);
    const data = this.editableData(body.data, [...hidden, ...readonly]);
    const row = await this.dataTables.createRow(
      ownerUser(access.project),
      entity.dataTableId,
      data,
    );
    return this.rowView(row, hidden);
  }

  async entityRowUpdate(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    rowIdRaw: unknown,
    body: { data: Record<string, unknown> },
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'update')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色不能修改该实体的数据',
      );
    }
    const current = await this.rowOf(
      entity.dataTableId,
      rowIdRaw,
      access,
      entity.id,
    );
    const fields = await this.fieldsOf(entity.dataTableId);
    const { hidden, readonly } = this.fieldGates(access, entity.id, fields);
    const patch = this.editableData(body.data, [...hidden, ...readonly]);
    // 多维表格的写入是整行替换：先把既有值并回来，再叠加本次改动
    const merged = { ...(current.data || {}), ...patch };
    const row = await this.dataTables.updateRow(
      ownerUser(access.project),
      entity.dataTableId,
      current.id,
      merged,
    );
    return this.rowView(row, hidden);
  }

  async entityRowDelete(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    rowIdRaw: unknown,
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'delete')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色不能删除该实体的数据',
      );
    }
    const row = await this.rowOf(
      entity.dataTableId,
      rowIdRaw,
      access,
      entity.id,
    );
    await this.dataTables.deleteRow(
      ownerUser(access.project),
      entity.dataTableId,
      row.id,
    );
    return { removed: true };
  }

  /** 当前角色不可见 / 只读的字段一律丢弃，不静默写进库。 */
  private editableData(raw: Record<string, unknown>, blocked: string[]) {
    const skip = new Set(blocked);
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw || {})) {
      if (skip.has(key)) continue;
      data[key] = value;
    }
    return data;
  }

  async entityRowExport(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    body: {
      keyword: string;
      sort: string;
      sortDir: 'asc' | 'desc';
      filter: Array<Record<string, unknown>>;
    },
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    if (!hasEntityAction(access, entity.id, 'export')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色不能导出该实体的数据',
      );
    }
    const fields = await this.fieldsOf(entity.dataTableId);
    const { hidden } = this.fieldGates(access, entity.id, fields);
    const exportFields = fields.filter(
      (field) => !hidden.includes(field.fieldKey),
    );
    if (!exportFields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该实体没有可导出的列',
      );
    }
    const keyword = text(body.keyword).trim().toLowerCase();
    const filters = this.normalizeFilters(body.filter);
    const visibleKeys = new Set(exportFields.map((field) => field.fieldKey));
    const scanned = await this.scan(entity.dataTableId);
    const allowed = scanned.filter((row) =>
      this.rowMatches(access, entity.id, row, keyword, filters, visibleKeys),
    );
    const sorted = this.sortRows(
      allowed,
      fields,
      text(body.sort).trim(),
      body.sortDir === 'desc' ? 'desc' : 'asc',
    );
    const truncated = sorted.length > EXPORT_LIMIT;
    const rows = truncated ? sorted.slice(0, EXPORT_LIMIT) : sorted;

    const lines = [
      exportFields.map((field) => csvEscape(field.name)).join(','),
    ];
    for (const row of rows) {
      const data = row.data || {};
      lines.push(
        exportFields
          .map((field) => csvEscape(cell(field, data[field.fieldKey])))
          .join(','),
      );
    }
    if (truncated) {
      lines.push(
        csvEscape(
          `注意：本次命中超过 ${EXPORT_LIMIT} 行，此处仅导出前 ${EXPORT_LIMIT} 行。`,
        ),
      );
    }
    const content = '\ufeff' + lines.join('\r\n');
    return {
      filename: `${entity.name}.csv`,
      content,
      rows: rows.length,
    };
  }
}

function cell(field: Field, value: unknown) {
  if (value === undefined || value === null) return '';
  if (field.fieldType === 'boolean') return value ? '是' : '否';
  if (field.fieldType === 'date') {
    const date = new Date(text(value));
    return Number.isNaN(date.getTime()) ? text(value) : date.toISOString();
  }
  if (field.fieldType === 'json' && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return text(value);
}

function csvEscape(value: string) {
  const raw = value ?? '';
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}
