import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DataTableService } from '../data-table/data-table.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { LowCodeAccessService } from './lowcode.access.service';
import { PAGE_TYPE_LABELS, ownerUser, pageVisible } from './lowcode.shared';

const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/;

type EntityRow = {
  id: number;
  projectId: number;
  dataTableId: number;
  name: string;
  icon: string;
  formLayout: Prisma.JsonValue;
  listLayout: Prisma.JsonValue;
  kanbanField: string;
  sort: number;
  createdAt: Date;
  updatedAt: Date;
};

type FieldRow = {
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
 * 实体与页面。
 *
 * 实体＝多维表格（`data_tables`）的一层别名：列结构、行数据、导出、飞书同步全部复用多维表格模块，
 * 这里只维护「项目里有哪些实体、摆在哪张表、列表/表单/看板怎么摆」。
 * 建表与改列以项目所有者身份调用 `DataTableService`（它按 created_by 判归属）。
 */
export class LowCodeContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dataTables: DataTableService,
    private readonly access: LowCodeAccessService,
  ) {}

  private async entityOf(projectId: number, raw: unknown): Promise<EntityRow> {
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

  private async fieldsOf(tableId: number): Promise<FieldRow[]> {
    return await this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private fieldView(field: FieldRow) {
    return {
      id: field.id,
      fieldKey: field.fieldKey,
      name: field.name,
      fieldType: field.fieldType,
      required: field.required,
      sortOrder: field.sortOrder,
      options: (field.options || {}) as Record<string, unknown>,
    };
  }

  private async entityViews(entities: EntityRow[]) {
    if (!entities.length) return [];
    const tableIds = entities.map((item) => item.dataTableId);
    const [fields, counts] = await Promise.all([
      this.prisma.dataTableField.findMany({
        where: { tableId: { in: tableIds } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.dataTableRow.groupBy({
        by: ['tableId'],
        where: { tableId: { in: tableIds } },
        _count: { _all: true },
      }),
    ]);
    const fieldsByTable = new Map<number, FieldRow[]>();
    for (const field of fields as FieldRow[]) {
      const list = fieldsByTable.get(field.tableId) || [];
      list.push(field);
      fieldsByTable.set(field.tableId, list);
    }
    const countMap = new Map(
      counts.map((item) => [item.tableId, item._count._all]),
    );
    return entities.map((entity) => ({
      ...entity,
      formLayout: (entity.formLayout || {}) as Record<string, unknown>,
      listLayout: (entity.listLayout || {}) as Record<string, unknown>,
      fields: (fieldsByTable.get(entity.dataTableId) || []).map((field) =>
        this.fieldView(field),
      ),
      rowCount: countMap.get(entity.dataTableId) || 0,
    }));
  }

  // ---------- 实体 ----------

  async entities(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    const rows = await this.prisma.lowCodeEntity.findMany({
      where: { projectId: access.project.id },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return this.entityViews(rows);
  }

  async entitySave(
    user: CurrentUser,
    raw: unknown,
    body: {
      id: number;
      name: string;
      icon: string;
      dataTableId: number;
      newTableName: string;
      formLayout?: Record<string, unknown>;
      listLayout?: Record<string, unknown>;
      kanbanField?: string;
      sort?: number;
      fields?: Array<{
        fieldKey?: string;
        name: string;
        fieldType: string;
        required: boolean;
        options: Record<string, unknown>;
      }>;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const project = access.project;
    const name = text(body.name).trim().slice(0, 50);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写实体名称');
    }
    const icon = text(body.icon).trim().slice(0, 64) || 'table';

    if (body.id > 0) {
      const entity = await this.entityOf(project.id, body.id);
      const data: Prisma.LowCodeEntityUncheckedUpdateInput = {
        name,
        icon,
      };
      if (body.formLayout !== undefined) {
        data.formLayout = body.formLayout as Prisma.InputJsonValue;
      }
      if (body.listLayout !== undefined) {
        data.listLayout = body.listLayout as Prisma.InputJsonValue;
      }
      if (body.kanbanField !== undefined) {
        data.kanbanField = text(body.kanbanField).slice(0, 64);
      }
      if (body.sort !== undefined) data.sort = body.sort;
      const row = await this.prisma.lowCodeEntity.update({
        where: { id: entity.id },
        data,
      });
      await this.identity.audit(
        user.userId,
        '内建应用修改实体',
        `#${row.id} ${row.name}`,
      );
      const [view] = await this.entityViews([row]);
      return view;
    }

    const owner = ownerUser(project);
    let dataTableId = Number(body.dataTableId) || 0;
    if (dataTableId > 0) {
      const table = await this.prisma.dataTable.findUnique({
        where: { id: dataTableId },
      });
      if (
        !table ||
        table.createdBy !== project.ownerUserId ||
        (table.projectId !== 0 && table.projectId !== project.id)
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '该多维表格不能作为本项目的实体',
        );
      }
      const used = await this.prisma.lowCodeEntity.findFirst({
        where: { dataTableId },
        select: { id: true },
      });
      if (used) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该多维表格已绑定其他实体',
        );
      }
    } else {
      const tableName = (
        text(body.newTableName).trim() || `${project.name} · ${name}`
      ).slice(0, 200);
      const table = await this.prisma.dataTable.create({
        data: {
          createdBy: project.ownerUserId,
          name: tableName,
          description: `内建应用「${project.name}」的${name}实体`,
          projectId: project.id,
        },
      });
      dataTableId = table.id;
      const inputs = this.fieldInputs(body.fields || []);
      if (inputs.length) {
        await this.dataTables.addFields(owner, dataTableId, inputs);
      }
    }

    const last = await this.prisma.lowCodeEntity.findFirst({
      where: { projectId: project.id },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    const row = await this.prisma.lowCodeEntity.create({
      data: {
        projectId: project.id,
        dataTableId,
        name,
        icon,
        formLayout: (body.formLayout || {}) as Prisma.InputJsonValue,
        listLayout: (body.listLayout || {}) as Prisma.InputJsonValue,
        kanbanField: text(body.kanbanField).slice(0, 64),
        sort: body.sort ?? (last?.sort ?? -1) + 1,
      },
    });
    await this.identity.audit(
      user.userId,
      '内建应用新建实体',
      `#${row.id} ${row.name}`,
    );
    const [view] = await this.entityViews([row]);
    return view;
  }

  /** 请求体的列定义 → 多维表格建列入参（列键缺省时按 order 生成）。 */
  private fieldInputs(
    fields: Array<{
      fieldKey?: string;
      name: string;
      fieldType: string;
      required: boolean;
      options: Record<string, unknown>;
    }>,
  ) {
    const used = new Set<string>();
    return fields.map((field, index) => {
      const name = text(field.name).trim().slice(0, 200);
      let fieldKey = text(field.fieldKey).trim();
      if (!fieldKey || !FIELD_KEY_PATTERN.test(fieldKey)) {
        fieldKey = `field_${index + 1}`;
      }
      while (used.has(fieldKey)) {
        fieldKey = `${fieldKey}_${index + 1}`;
      }
      used.add(fieldKey);
      const choices = Array.isArray(field.options?.choices)
        ? (field.options.choices as unknown[]).map((item) => text(item))
        : [];
      return {
        name,
        fieldKey,
        fieldType: field.fieldType,
        required: Boolean(field.required),
        choices,
      };
    });
  }

  async entityDelete(user: CurrentUser, raw: unknown, entityIdRaw: unknown) {
    const access = await this.access.requireManage(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    const table = await this.prisma.dataTable.findUnique({
      where: { id: entity.dataTableId },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.lowCodePage.deleteMany({
        where: { projectId: access.project.id, entityId: entity.id },
      });
      const flows = await tx.lowCodeApprovalFlow.findMany({
        where: { projectId: access.project.id, entityId: entity.id },
        select: { id: true },
      });
      const instances = await tx.lowCodeApprovalInstance.findMany({
        where: { projectId: access.project.id, entityId: entity.id },
        select: { id: true },
      });
      if (flows.length) {
        await tx.lowCodeApprovalFlowVersion.deleteMany({
          where: { flowId: { in: flows.map((item) => item.id) } },
        });
      }
      if (instances.length) {
        const ids = instances.map((item) => item.id);
        await tx.lowCodeApprovalTask.deleteMany({
          where: { instanceId: { in: ids } },
        });
        await tx.lowCodeApprovalRecord.deleteMany({
          where: { instanceId: { in: ids } },
        });
      }
      await tx.lowCodeApprovalInstance.deleteMany({
        where: { projectId: access.project.id, entityId: entity.id },
      });
      await tx.lowCodeApprovalFlow.deleteMany({
        where: { projectId: access.project.id, entityId: entity.id },
      });
      await tx.lowCodeDataRule.deleteMany({
        where: { projectId: access.project.id, entityId: entity.id },
      });
      await tx.lowCodeEntity.delete({ where: { id: entity.id } });
      // 只删本项目自建的表；绑定外部表的实体只解绑，不动别人的数据
      if (table && table.projectId === access.project.id) {
        await tx.dataTableRow.deleteMany({ where: { tableId: table.id } });
        await tx.dataTableField.deleteMany({ where: { tableId: table.id } });
        await tx.dataTable.delete({ where: { id: table.id } });
      }
    });
    await this.identity.audit(
      user.userId,
      '内建应用删除实体',
      `#${entity.id} ${entity.name}`,
    );
    return { removed: true };
  }

  async entityFields(user: CurrentUser, raw: unknown, entityIdRaw: unknown) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    const fields = await this.fieldsOf(entity.dataTableId);
    return fields.map((field) => this.fieldView(field));
  }

  async entityFieldSave(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    body: {
      fieldKey: string;
      name: string;
      fieldType: string;
      required: boolean;
      options: Record<string, unknown>;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    const owner = ownerUser(access.project);
    const fieldKey = text(body.fieldKey).trim();
    const name = text(body.name).trim().slice(0, 200);
    const choices = Array.isArray(body.options?.choices)
      ? (body.options.choices as unknown[]).map((item) => text(item))
      : [];

    if (fieldKey) {
      const existing = await this.prisma.dataTableField.findFirst({
        where: { tableId: entity.dataTableId, fieldKey },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '该列不存在');
      }
      const row = await this.dataTables.updateField(
        owner,
        entity.dataTableId,
        existing.id,
        {
          name,
          fieldType: body.fieldType,
          required: body.required,
          choices,
        },
      );
      return {
        id: row.id,
        fieldKey: row.fieldKey,
        name: row.name,
        fieldType: row.fieldType,
        required: row.required,
        sortOrder: row.sortOrder,
        options: (row.options || {}) as Record<string, unknown>,
      };
    }

    const [row] = await this.dataTables.addFields(owner, entity.dataTableId, [
      {
        name,
        fieldKey: this.freeFieldKey(
          name,
          await this.fieldsOf(entity.dataTableId),
        ),
        fieldType: body.fieldType,
        required: body.required,
        choices,
      },
    ]);
    return {
      id: row.id,
      fieldKey: row.fieldKey,
      name: row.name,
      fieldType: row.fieldType,
      required: row.required,
      sortOrder: row.sortOrder,
      options: (row.options || {}) as Record<string, unknown>,
    };
  }

  /** 新增列时没给列键：按列名生成，撞键再补序号。 */
  private freeFieldKey(name: string, existing: FieldRow[]) {
    const base = (
      name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'field'
    ).replace(/^([0-9])/, 'f$1');
    const taken = new Set(existing.map((field) => field.fieldKey));
    let key = base;
    let index = 2;
    while (taken.has(key)) {
      key = `${base}_${index}`;
      index += 1;
    }
    return key;
  }

  async entityFieldDelete(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    fieldKeyRaw: unknown,
  ) {
    const access = await this.access.requireManage(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    const fieldKey = text(fieldKeyRaw).trim();
    const field = await this.prisma.dataTableField.findFirst({
      where: { tableId: entity.dataTableId, fieldKey },
    });
    if (!field) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该列不存在');
    }
    await this.dataTables.deleteField(
      ownerUser(access.project),
      entity.dataTableId,
      field.id,
    );
    return { removed: true };
  }

  // ---------- 页面 ----------

  async pages(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    const rows = await this.prisma.lowCodePage.findMany({
      where: { projectId: access.project.id },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows
      .filter((page) => pageVisible(access, page))
      .map((page) => this.pageView(page));
  }

  private pageView(page: {
    id: number;
    projectId: number;
    parentId: number;
    type: string;
    name: string;
    entityId: number;
    config: Prisma.JsonValue;
    sort: number;
    visible: boolean;
    builtin: boolean;
  }) {
    return {
      ...page,
      typeLabel: PAGE_TYPE_LABELS[page.type] || page.type,
      config: (page.config || {}) as Record<string, unknown>,
    };
  }

  /** 与 lowcode.shared 的 pageVisible 同口径（此处按权限行判定）。 */
  async pageSave(
    user: CurrentUser,
    raw: unknown,
    body: {
      id: number;
      parentId: number;
      type: string;
      name: string;
      entityId: number;
      config: Record<string, unknown>;
      sort?: number;
      visible: boolean;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const name = text(body.name).trim().slice(0, 50);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写页面名称');
    }
    const entityId = Number(body.entityId) || 0;
    if (entityId > 0) await this.entityOf(projectId, entityId);

    if (body.id > 0) {
      const page = await this.prisma.lowCodePage.findFirst({
        where: { id: body.id, projectId },
      });
      if (!page) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '页面不存在');
      }
      const row = await this.prisma.lowCodePage.update({
        where: { id: page.id },
        data: {
          parentId: Number(body.parentId) || 0,
          type: body.type,
          name,
          entityId,
          config: body.config as Prisma.InputJsonValue,
          visible: Boolean(body.visible),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
        },
      });
      return this.pageView(row);
    }

    const last = await this.prisma.lowCodePage.findFirst({
      where: { projectId },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    const row = await this.prisma.lowCodePage.create({
      data: {
        projectId,
        parentId: Number(body.parentId) || 0,
        type: body.type,
        name,
        entityId,
        config: body.config as Prisma.InputJsonValue,
        sort: body.sort ?? (last?.sort ?? -1) + 1,
        visible: Boolean(body.visible),
        builtin: false,
      },
    });
    await this.identity.audit(
      user.userId,
      '内建应用新建页面',
      `#${row.id} ${row.name}`,
    );
    return this.pageView(row);
  }

  async pageDelete(user: CurrentUser, raw: unknown, pageIdRaw: unknown) {
    const access = await this.access.requireManage(user, raw);
    const pageId = Number(pageIdRaw);
    const page = await this.prisma.lowCodePage.findFirst({
      where: { id: pageId, projectId: access.project.id },
    });
    if (!page) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '页面不存在');
    }
    await this.prisma.lowCodePage.deleteMany({
      where: { projectId: access.project.id, parentId: page.id },
    });
    await this.prisma.lowCodePage.delete({ where: { id: page.id } });
    await this.identity.audit(
      user.userId,
      '内建应用删除页面',
      `#${page.id} ${page.name}`,
    );
    return { removed: true };
  }

  async pageReorder(user: CurrentUser, raw: unknown, body: { ids: number[] }) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const pages = await this.prisma.lowCodePage.findMany({
      where: { projectId },
      select: { id: true },
    });
    const known = new Set(pages.map((page) => page.id));
    if (ids.length !== pages.length || new Set(ids).size !== ids.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '页面排序必须包含全部页面各一次',
      );
    }
    if (ids.some((id) => !known.has(id))) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '页面排序含未知页面');
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.lowCodePage.update({
          where: { id },
          data: { sort: index },
        }),
      ),
    );
    return this.pages(user, raw);
  }
}
