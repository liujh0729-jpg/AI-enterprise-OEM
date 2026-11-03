import { Prisma } from '../../generated/prisma';
import { LIST_ALL_LIMIT, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonArray } from '../shared/json-value';

/** 列类型（与参考实现 AIRecord 的 field_type 一致）。 */
const FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'url',
  'email',
  'json',
  'select',
] as const;
/** 列键：建列后不可改，同时是行数据 JSON 的键，故只收小写字母 / 数字 / 下划线。 */
const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/;
/** 列键长度上限＝库里的列宽（VarChar(64)）；超长必须在这里拦成 400，不能让它变成数据库报错。 */
const FIELD_KEY_MAX = 64;
/** 机器通道单次批量写入的行数上限（与界面分页上限对齐）。 */
const BATCH_ROW_LIMIT = 200;
/** 导出 CSV 一次最多带出的行数：整表进内存会打满进程，超出部分在文件里明确标注。 */
const EXPORT_ROW_LIMIT = 50000;

type DataFieldRow = {
  id: number;
  tableId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  sortOrder: number;
  options: Prisma.JsonValue;
  required: boolean;
  createdAt: Date;
};

type RowValue = Record<string, unknown>;

/** 一种操作维度：访问 / 新增 / 修改 / 删除互相独立授权。 */
type PermissionBit = 'read' | 'create' | 'update' | 'delete';

type TablePermissions = Record<PermissionBit, boolean>;

const BIT_LABEL: Record<PermissionBit, string> = {
  read: '访问',
  create: '新增',
  update: '修改',
  delete: '删除',
};

const ALL_BITS_ON: TablePermissions = {
  read: true,
  create: true,
  update: true,
  delete: true,
};

/** 只读：平台管理员看得到别人的表，但不能改结构、不能代为授权。 */
const READ_ONLY: TablePermissions = {
  read: true,
  create: false,
  update: false,
  delete: false,
};

/** 一张表对当前账号的判定：是否归属本人 + 四种操作各一个权限位。 */
type TableAccess = {
  table: {
    id: number;
    createdBy: string;
    name: string;
    description: string;
    createdAt: Date;
    updatedAt: Date;
  };
  owner: boolean;
  can: TablePermissions;
};

/** 可授权名单里的一名成员（来源只看库里的真实关系，不看当前切换的身份）。 */
type GrantCandidate = {
  userId: string;
  name: string;
  sources: string[];
};

/**
 * 多维表格（归属＝账号的用户自建结构化数据表）。
 *
 * 机制参照 AIRecord 的 `rpa_data_tables / rpa_data_fields / rpa_data_rows` 三表模型：
 * 列定义与行数据分离，行数据按列键存 JSON，列序单独维护。
 * 差异：行数据以 **列键**（而非列 ID）为键 —— 机器通道读一次表结构就能拼出写入报文，
 * 不必先取列 ID，脚本侧与界面侧写的是同一批数据。
 *
 * 归属：一个账号一份多维表格，切企业 / 服务商 / 职员身份看到的都是同一份，
 * 所以判定只看 created_by，不看当前身份。共享靠显式授权（data_table_grants）：
 * 归属账号把某张表按访问 / 新增 / 修改 / 删除四个维度分别授权给旗下成员；
 * 表结构与授权本身只归归属账号管。
 */
export class DataTableService {
  /** 行变更监听（飞书同步用）：在写库成功后通知，监听方自己吞掉异常。 */
  private rowListener?: (
    tableId: number,
    action: 'create' | 'update' | 'delete',
    rowId: number,
  ) => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
  ) {}

  setRowListener(
    listener: (
      tableId: number,
      action: 'create' | 'update' | 'delete',
      rowId: number,
    ) => void,
  ) {
    this.rowListener = listener;
  }

  private notifyRow(
    tableId: number,
    action: 'create' | 'update' | 'delete',
    rowId: number,
  ) {
    try {
      this.rowListener?.(tableId, action, rowId);
    } catch {
      // 通知失败不能影响写入结果。
    }
  }

  // ---------- 表 ----------

  async list(user: CurrentUser) {
    const grants = await this.grantMap(user);
    const where = this.identity.isPlatformAdmin(user)
      ? {}
      : {
          OR: [
            { createdBy: user.userId },
            ...(grants.size ? [{ id: { in: [...grants.keys()] } }] : []),
          ],
        };
    const tables = await this.prisma.dataTable.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      // 卡片墙没有分页参数：一次读取封顶（与 pageQuery 上限一致）
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = tables.length > LIST_ALL_LIMIT;
    const visible = truncated ? tables.slice(0, LIST_ALL_LIMIT) : tables;
    if (!visible.length) return [];
    const ids = visible.map((item) => item.id);
    const [fields, groups] = await Promise.all([
      this.prisma.dataTableField.findMany({
        where: { tableId: { in: ids } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.dataTableRow.groupBy({
        by: ['tableId'],
        where: { tableId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const countByTable = new Map(
      groups.map((item) => [item.tableId, item._count._all]),
    );
    return visible.map((table) => ({
      ...table,
      ...permissionOf(user, table.createdBy, grants.get(table.id)),
      fields: fields
        .filter((field) => field.tableId === table.id)
        .map(decorateField),
      rowCount: countByTable.get(table.id) || 0,
    }));
  }

  async get(user: CurrentUser, id: number) {
    const access = await this.access(user, id);
    const [fields, rowCount] = await Promise.all([
      this.prisma.dataTableField.findMany({
        where: { tableId: id },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.dataTableRow.count({ where: { tableId: id } }),
    ]);
    return {
      ...access.table,
      owner: access.owner,
      can: access.can,
      fields: fields.map(decorateField),
      rowCount,
    };
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写表格名称');
    const row = await this.prisma.dataTable.create({
      data: {
        createdBy: user.userId,
        name: name.slice(0, 200),
        description: text(body.description).trim().slice(0, 500),
      },
    });
    await this.identity.audit(
      user.userId,
      '多维表格建表',
      `#${row.id} ${row.name}`,
    );
    return {
      ...row,
      owner: true,
      can: ALL_BITS_ON,
      fields: [],
      rowCount: 0,
    };
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    this.requireOwner(await this.access(user, id));
    const data: { name?: string; description?: string } = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim();
      if (!name)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '表格名称不能为空');
      data.name = name.slice(0, 200);
    }
    if (body.description !== undefined) {
      data.description = text(body.description).trim().slice(0, 500);
    }
    if (!Object.keys(data).length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    const row = await this.prisma.dataTable.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      '多维表格改表',
      `#${id} ${row.name}`,
    );
    return this.get(user, id);
  }

  /** 删表连带删列、行与授权（本库无外键，四张表在一个事务里清）。 */
  async remove(user: CurrentUser, id: number) {
    const access = await this.access(user, id);
    this.requireOwner(access);
    const syncIds = (
      await this.prisma.dataTableFeishuSync.findMany({
        where: { tableId: id },
        select: { id: true },
      })
    ).map((item) => item.id);
    await this.prisma.$transaction([
      this.prisma.dataTableFeishuRowLink.deleteMany({
        where: { syncId: { in: syncIds } },
      }),
      this.prisma.dataTableFeishuSyncLog.deleteMany({
        where: { syncId: { in: syncIds } },
      }),
      this.prisma.dataTableFeishuSync.deleteMany({ where: { tableId: id } }),
      this.prisma.dataTableRow.deleteMany({ where: { tableId: id } }),
      this.prisma.dataTableField.deleteMany({ where: { tableId: id } }),
      this.prisma.dataTableGrant.deleteMany({ where: { tableId: id } }),
      this.prisma.dataTable.delete({ where: { id } }),
    ]);
    await this.identity.audit(
      user.userId,
      '多维表格删表',
      `#${id} ${access.table.name}`,
    );
    return { id, deleted: true };
  }

  /**
   * 可作为工具结果表的候选（营销工具「换结果表」用）：
   * 当前账号写进行（本人归属或有新增权）且列已覆盖所需列键的表。
   * 口径与写行逐字一致——写行拒收未知列键，所以列不齐的表选了也写不进去，这里直接不进候选。
   */
  async writableTables(user: CurrentUser, requiredKeys: string[]) {
    const grants = await this.grantMap(user);
    const tables = await this.prisma.dataTable.findMany({
      where: {
        OR: [
          { createdBy: user.userId },
          ...(grants.size ? [{ id: { in: [...grants.keys()] } }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      // 候选清单与卡片墙同一个封顶
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = tables.length > LIST_ALL_LIMIT;
    const visible = truncated ? tables.slice(0, LIST_ALL_LIMIT) : tables;
    const writable = visible.filter(
      (table) =>
        table.createdBy === user.userId ||
        grants.get(table.id)?.create === true,
    );
    if (!writable.length) return { list: [], truncated: false };
    const ids = writable.map((table) => table.id);
    const [fields, groups] = await Promise.all([
      this.prisma.dataTableField.findMany({ where: { tableId: { in: ids } } }),
      this.prisma.dataTableRow.groupBy({
        by: ['tableId'],
        where: { tableId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const keysByTable = new Map<number, Set<string>>();
    for (const field of fields) {
      const set = keysByTable.get(field.tableId) || new Set<string>();
      set.add(field.fieldKey);
      keysByTable.set(field.tableId, set);
    }
    const countByTable = new Map(
      groups.map((item) => [item.tableId, item._count._all]),
    );
    return {
      list: writable
        .filter((table) =>
          requiredKeys.every(
            (key) => keysByTable.get(table.id)?.has(key) === true,
          ),
        )
        .map((table) => ({
          id: table.id,
          name: table.name,
          rowCount: countByTable.get(table.id) || 0,
        })),
      truncated,
    };
  }

  /**
   * 任务要写某张表前的硬校验：写得进行（新增权）+ 列够模板要求。
   * `label` 用于把「哪张表不够格」说清（界面只认表名，不认内部 id）。
   */
  async assertWritable(
    user: CurrentUser,
    tableId: number,
    requiredKeys: string[],
    label: string,
  ) {
    const access = this.requireBit(await this.access(user, tableId), 'create');
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId },
    });
    const keys = new Set(fields.map((field) => field.fieldKey));
    const missing = requiredKeys.filter((key) => !keys.has(key));
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${label}「${access.table.name}」缺少列：${missing.join('、')}，请在多维表格里补齐后重试`,
      );
    }
    return access.table;
  }

  // ---------- 授权 ----------

  /** 一张表的授权现状 + 可授权名单（旗下成员）。只有归属账号能看。 */
  async listGrants(user: CurrentUser, tableId: number) {
    const access = await this.access(user, tableId);
    this.requireOwner(access);
    const [candidates, grants] = await Promise.all([
      this.grantCandidates(user),
      this.prisma.dataTableGrant.findMany({
        where: { tableId },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      candidates,
      grants: grants.map(decorateGrant),
    };
  }

  /**
   * 保存授权：整张表的授权一次全量覆盖，四种操作各自独立；
   * 四项都不勾＝收回该成员的全部权限（不落库）。
   */
  async saveGrants(user: CurrentUser, tableId: number, rows: unknown) {
    const access = await this.access(user, tableId);
    this.requireOwner(access);
    // 授权是全量覆盖语义：载荷不是数组＝请求发歪了，绝不能当成「清空授权」
    if (!Array.isArray(rows)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请提交授权名单（grants 数组；要收回全部权限请提交空数组）',
      );
    }
    const list = rows;
    const allowed = new Set(
      (await this.grantCandidates(user)).map((item) => item.userId),
    );
    const data: Prisma.DataTableGrantCreateManyInput[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '授权项必须是对象（成员 + 四个权限位）',
        );
      }
      const body = item as Record<string, unknown>;
      const grantee = text(body.user_id || body.userId).trim();
      if (!grantee)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少成员账号');
      if (grantee === user.userId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '表本来就是本人归属的，无需给自己授权',
        );
      }
      if (seen.has(grantee)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `成员「${grantee}」重复提交`,
        );
      }
      seen.add(grantee);
      if (!allowed.has(grantee)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '只能授权给旗下成员（本企业的其他账号或已绑定的职员）',
        );
      }
      const bits = grantBits(body);
      if (
        !bits.canRead &&
        !bits.canCreate &&
        !bits.canUpdate &&
        !bits.canDelete
      )
        continue;
      data.push({
        tableId,
        granteeUserId: grantee,
        grantedBy: user.userId,
        ...bits,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.dataTableGrant.deleteMany({ where: { tableId } });
      if (data.length) await tx.dataTableGrant.createMany({ data });
    });
    await this.identity.audit(
      user.userId,
      '多维表格授权',
      `#${tableId} ${access.table.name} · ${data.length} 人`,
    );
    return this.listGrants(user, tableId);
  }

  // ---------- 列 ----------

  /** 建列入参校验：单列与批量共用同一份口径，报错文案同源。 */
  private fieldInput(body: Record<string, unknown>) {
    const name = text(body.name).trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写列名');
    const fieldKey = text(body.field_key || body.fieldKey).trim();
    if (!FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '列键只能用小写字母、数字与下划线（如 order_no）',
      );
    }
    if (fieldKey.length > FIELD_KEY_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `列键太长了（最多 ${FIELD_KEY_MAX} 个字符）`,
      );
    }
    const fieldType = (text(body.field_type || body.fieldType) || 'text')
      .trim()
      .toLowerCase();
    if (!isFieldType(fieldType)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `列类型不合法（${FIELD_TYPES.join(' / ')}）`,
      );
    }
    const choices = choiceList(body);
    if (fieldType === 'select' && !choices.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单选列请填写候选项（逗号分隔）',
      );
    }
    return {
      name: name.slice(0, 200),
      fieldKey,
      fieldType,
      choices,
      required: truthy(body.required),
    };
  }

  async addField(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
  ) {
    const [field] = await this.addFields(user, tableId, [body]);
    return field;
  }

  /**
   * 批量建列：模板类建表（一次给 10 列）走这里。
   * 逐列调用只查一次归属权、一次已有列键、一次列序末尾，写入合并成一条 createMany；
   * 按列往返时远端库建一张模板表要十几次来回、界面等到超时。
   */
  async addFields(
    user: CurrentUser,
    tableId: number,
    bodies: Record<string, unknown>[],
  ) {
    if (!bodies.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少提交一列');
    }
    const access = await this.access(user, tableId);
    this.requireOwner(access);
    const inputs = bodies.map((body) => this.fieldInput(body));
    const keys = inputs.map((item) => item.fieldKey);
    const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (repeated.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `同一次提交里列键重复：${[...new Set(repeated)].join('、')}`,
      );
    }
    const exists = await this.prisma.dataTableField.findMany({
      where: { tableId, fieldKey: { in: keys } },
      select: { fieldKey: true },
    });
    if (exists.length) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `列键「${exists[0].fieldKey}」已存在，请换一个`,
      );
    }
    const last = await this.prisma.dataTableField.findFirst({
      where: { tableId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const base = (last?.sortOrder ?? -1) + 1;
    try {
      await this.prisma.dataTableField.createMany({
        data: inputs.map((item, index) => ({
          tableId,
          name: item.name,
          fieldKey: item.fieldKey,
          fieldType: item.fieldType,
          sortOrder: base + index,
          options: item.fieldType === 'select' ? { choices: item.choices } : {},
          required: item.required,
        })),
      });
    } catch (error) {
      // 上面的「已存在」检查与写入之间有并发窗口（界面双开、机器通道同时建列）：
      // 唯一键冲突是「列键重了」，不是服务故障，不能让它变成 500。
      if (isUniqueViolation(error)) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `列键「${keys.join('、')}」与其他提交冲突，请刷新后重试`,
        );
      }
      throw error;
    }
    const rows = await this.prisma.dataTableField.findMany({
      where: { tableId, fieldKey: { in: keys } },
      orderBy: { sortOrder: 'asc' },
    });
    await this.identity.audit(
      user.userId,
      '多维表格加列',
      `#${tableId} ${access.table.name} · ${keys.join('、')}`,
    );
    return rows.map(decorateField);
  }

  /** 改列：列名 / 类型 / 必填 / 候选项可改，列键建列后不可改（它是已存行数据的键）。 */
  async updateField(
    user: CurrentUser,
    tableId: number,
    fieldId: number,
    body: Record<string, unknown>,
  ) {
    this.requireOwner(await this.access(user, tableId));
    const field = await this.prisma.dataTableField.findFirst({
      where: { id: fieldId, tableId },
    });
    if (!field) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该列不存在');
    }
    const nextKey = text(body.field_key || body.fieldKey).trim();
    if (nextKey && nextKey !== field.fieldKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '列键建列后不可修改（已存行数据以它为键），要换键请删列重建',
      );
    }
    const data: {
      name?: string;
      fieldType?: string;
      sortOrder?: number;
      options?: Prisma.InputJsonObject;
      required?: boolean;
    } = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim();
      if (!name)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '列名不能为空');
      data.name = name.slice(0, 200);
    }
    const typeInput = body.field_type ?? body.fieldType;
    let fieldType = field.fieldType;
    if (typeInput !== undefined) {
      fieldType = text(typeInput).trim().toLowerCase();
      if (!isFieldType(fieldType)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列类型不合法（${FIELD_TYPES.join(' / ')}）`,
        );
      }
      data.fieldType = fieldType;
    }
    if (body.sort_order !== undefined || body.sortOrder !== undefined) {
      const sort = Number(body.sort_order ?? body.sortOrder);
      if (!Number.isInteger(sort) || sort < 0) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '列序不合法');
      }
      data.sortOrder = sort;
    }
    if (body.required !== undefined) data.required = truthy(body.required);
    if (fieldType === 'select') {
      // 没给候选项时沿用已有候选项，两边都没有才拒绝
      const choices = choiceList(body);
      const kept = choices.length
        ? choices
        : choiceList({ choices: field.options });
      if (!kept.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '单选列请填写候选项（逗号分隔）',
        );
      }
      data.options = { choices: kept };
    } else if (typeInput !== undefined) {
      data.options = {};
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const row = await this.prisma.dataTableField.update({
      where: { id: fieldId },
      data,
    });
    await this.identity.audit(
      user.userId,
      '多维表格改列',
      `#${tableId} ${field.fieldKey}`,
    );
    return decorateField(row);
  }

  /** 删列：已存行里该键的值一并失效（不再出现在列表与详情中）。 */
  async deleteField(user: CurrentUser, tableId: number, fieldId: number) {
    this.requireOwner(await this.access(user, tableId));
    const field = await this.prisma.dataTableField.findFirst({
      where: { id: fieldId, tableId },
      select: { id: true, fieldKey: true },
    });
    if (!field) throw new BusinessException(ErrorCode.NOT_FOUND, '该列不存在');
    await this.prisma.dataTableField.delete({ where: { id: fieldId } });
    await this.identity.audit(
      user.userId,
      '多维表格删列',
      `#${tableId} ${field.fieldKey}`,
    );
    return { id: fieldId, deleted: true };
  }

  /** 列排序：必须提交该表全部列键的一次完整排列，避免半量提交把列序打乱。 */
  async reorderFields(user: CurrentUser, tableId: number, keys: string[]) {
    this.requireOwner(await this.access(user, tableId));
    const list = Array.isArray(keys) ? keys.map((key) => text(key)) : [];
    if (!list.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提交全部列的排列');
    }
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
    const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
    const submitted = new Set(list);
    if (
      list.length !== fields.length ||
      submitted.size !== list.length ||
      list.some((key) => !byKey.has(key))
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '列排序必须包含该表全部列各一次',
      );
    }
    await this.prisma.$transaction(
      list.map((key, index) =>
        this.prisma.dataTableField.update({
          where: { id: byKey.get(key)?.id as number },
          data: { sortOrder: index },
        }),
      ),
    );
    await this.identity.audit(user.userId, '多维表格列排序', `#${tableId}`);
    return list.map((key, index) => ({
      fieldKey: key,
      sortOrder: index,
    }));
  }

  // ---------- 行 ----------

  async listRows(user: CurrentUser, tableId: number, page = 1, pageSize = 20) {
    this.requireBit(await this.access(user, tableId), 'read');
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
    const pageNo = Math.max(Number(page) || 1, 1);
    const [list, total] = await Promise.all([
      this.prisma.dataTableRow.findMany({
        where: { tableId },
        orderBy: { id: 'desc' },
        skip: (pageNo - 1) * size,
        take: size,
      }),
      this.prisma.dataTableRow.count({ where: { tableId } }),
    ]);
    return { list: list.map(decorateRow), total, page: pageNo, pageSize: size };
  }

  /** 机器通道分页（照搬参考实现：limit/offset，取满 limit 即可能有下一页）。 */
  async listRowsByOffset(
    user: CurrentUser,
    tableId: number,
    limit = 100,
    offset = 0,
  ) {
    this.requireBit(await this.access(user, tableId), 'read');
    const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const from = Math.max(Number(offset) || 0, 0);
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId },
      orderBy: { id: 'desc' },
      skip: from,
      take: size,
    });
    return rows.map(decorateRow);
  }

  async createRow(user: CurrentUser, tableId: number, data: unknown) {
    const fields = await this.requireFields(user, tableId, 'create');
    const values = this.normalizeData(fields, data);
    const row = await this.prisma.dataTableRow.create({
      data: {
        tableId,
        createdBy: user.userId,
        data: values as Prisma.InputJsonObject,
      },
    });
    this.notifyRow(tableId, 'create', row.id);
    return decorateRow(row);
  }

  async createRows(user: CurrentUser, tableId: number, rows: unknown) {
    const fields = await this.requireFields(user, tableId, 'create');
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提交要写入的行');
    }
    if (list.length > BATCH_ROW_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单次最多写入 ${BATCH_ROW_LIMIT} 行`,
      );
    }
    const values = list.map((item) => this.normalizeData(fields, item));
    const created = await this.prisma.$transaction(
      values.map((item) =>
        this.prisma.dataTableRow.create({
          data: {
            tableId,
            createdBy: user.userId,
            data: item as Prisma.InputJsonObject,
          },
        }),
      ),
    );
    await this.identity.audit(
      user.userId,
      '多维表格批量写行',
      `#${tableId} ${created.length} 行`,
    );
    for (const row of created) this.notifyRow(tableId, 'create', row.id);
    return created.map(decorateRow);
  }

  async updateRow(
    user: CurrentUser,
    tableId: number,
    rowId: number,
    data: unknown,
  ) {
    const fields = await this.requireFields(user, tableId, 'update');
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    const values = this.normalizeData(fields, data);
    const updated = await this.prisma.dataTableRow.update({
      where: { id: rowId },
      data: { data: values as Prisma.InputJsonObject },
    });
    this.notifyRow(tableId, 'update', rowId);
    return decorateRow(updated);
  }

  /**
   * 批量改行：整批只做一次权限与列校验、一次行存在性查询，写入放进一个事务。
   * 与逐行 updateRow 相比少了 O(n) 次远端往返；不存在的行直接跳过（调用方按返回数记账）。
   */
  async updateRows(
    user: CurrentUser,
    tableId: number,
    updates: { id: number; data: unknown }[],
  ) {
    const ids = [
      ...new Set(
        updates
          .map((item) => Number(item.id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (!ids.length) return { updated: 0 };
    const fields = await this.requireFields(user, tableId, 'update');
    const existing = await this.prisma.dataTableRow.findMany({
      where: { tableId, id: { in: ids } },
      select: { id: true },
    });
    const present = new Set(existing.map((row) => row.id));
    const operations = updates
      .filter((item) => present.has(item.id))
      .map((item) =>
        this.prisma.dataTableRow.update({
          where: { id: item.id },
          data: {
            data: this.normalizeData(
              fields,
              item.data,
            ) as Prisma.InputJsonObject,
          },
        }),
      );
    if (!operations.length) return { updated: 0 };
    await this.prisma.$transaction(operations);
    for (const id of present) this.notifyRow(tableId, 'update', id);
    return { updated: operations.length };
  }

  async deleteRow(user: CurrentUser, tableId: number, rowId: number) {
    this.requireBit(await this.access(user, tableId), 'delete');
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId },
      select: { id: true },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    await this.prisma.dataTableRow.delete({ where: { id: rowId } });
    this.notifyRow(tableId, 'delete', rowId);
    return { id: rowId, deleted: true };
  }

  /** 导出整张表为 CSV（UTF-8 + BOM，Excel 直接打开不乱码）。 */
  async exportCsv(user: CurrentUser, tableId: number) {
    const access = await this.access(user, tableId);
    this.requireBit(access, 'read');
    const [fields, rows] = await Promise.all([
      this.prisma.dataTableField.findMany({
        where: { tableId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.dataTableRow.findMany({
        where: { tableId },
        orderBy: { id: 'desc' },
        // 多取一行只用来判断「是不是被封顶了」；整表一次性进内存会让进程直接爆掉。
        take: EXPORT_ROW_LIMIT + 1,
      }),
    ]);
    if (!fields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该表还没有列，无法导出',
      );
    }
    const truncated = rows.length > EXPORT_ROW_LIMIT;
    const headers = fields.map((field) => field.name);
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of truncated ? rows.slice(0, EXPORT_ROW_LIMIT) : rows) {
      const data =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as RowValue)
          : {};
      const values = fields.map((field) => {
        const value = data[field.fieldKey];
        return csvEscape(formatCellValue(field.fieldType, value));
      });
      lines.push(values.join(','));
    }
    if (truncated) {
      // 不静默给出半份文件：缺多少行写进文件本身，重新导入时它只是一行普通数据。
      lines.push(
        csvEscape(
          `注意：本表数据超过 ${EXPORT_ROW_LIMIT} 行，此处仅导出最近 ${EXPORT_ROW_LIMIT} 行（按新建时间倒序）。`,
        ),
      );
    }
    const csv = '\ufeff' + lines.join('\r\n');
    return {
      filename: `${access.table.name}.csv`,
      content: csv,
    };
  }

  // ---------- 判定与校验 ----------

  /**
   * 一张表对当前账号的判定（只看库里的归属与授权，不看前端切到的身份）。
   * 三种结果：本人归属（四权全有 + 结构与授权）／被授权成员（按权限位）／平台管理员（全见只读）。
   * 其余账号一律 20002：连"这张表存在"都不透露给外人之前先按 id 查，
   * 表不存在才报 404，避免拿别人的表 id 试探。
   */
  private async access(user: CurrentUser, id: number): Promise<TableAccess> {
    const table = await this.prisma.dataTable.findUnique({ where: { id } });
    if (!table)
      throw new BusinessException(ErrorCode.NOT_FOUND, '多维表格不存在');
    if (table.createdBy === user.userId) {
      return { table, owner: true, can: ALL_BITS_ON };
    }
    if (this.identity.isPlatformAdmin(user)) {
      return { table, owner: false, can: READ_ONLY };
    }
    const grant = await this.prisma.dataTableGrant.findUnique({
      where: {
        tableId_granteeUserId: { tableId: id, granteeUserId: user.userId },
      },
    });
    if (!grant) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该多维表格归他人所有，未获授权',
      );
    }
    // 授权随成员关系失效：职员解绑后 grant 自动失效
    const staffBind = await this.prisma.providerStaff.findFirst({
      where: {
        staffUserId: user.userId,
        providerUserId: table.createdBy,
        status: 'ACTIVE',
      },
    });
    const enterprisePeer = await this.prisma.enterpriseProfile.findFirst({
      where: {
        userId: user.userId,
        status: 'APPROVED',
        uscc: {
          in: (
            await this.prisma.enterpriseProfile.findMany({
              where: { userId: table.createdBy, status: 'APPROVED' },
              select: { uscc: true },
            })
          )
            .map((e) => e.uscc)
            .filter(Boolean),
        },
      },
    });
    if (!staffBind && !enterprisePeer) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '授权已随成员关系失效',
      );
    }
    return { table, owner: false, can: bitsOf(grant) };
  }

  /** 权限位判定：缺哪一位就报哪一位，四种操作互不牵连。 */
  private requireBit(access: TableAccess, bit: PermissionBit) {
    if (access.can[bit]) return access;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      `没有该表的${BIT_LABEL[bit]}权限`,
    );
  }

  /** 表结构与授权只归归属账号管（被授权成员即便有修改权也不能改列）。 */
  private requireOwner(access: TableAccess) {
    if (access.owner) return access;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '只有表归属账号可以改表结构或调整授权',
    );
  }

  /** 当前账号被授权的表 → 权限位（列表页一次取全，避免按行 N 次查询）。 */
  private async grantMap(user: CurrentUser) {
    const rows = await this.prisma.dataTableGrant.findMany({
      where: { granteeUserId: user.userId },
    });
    return new Map(rows.map((row) => [row.tableId, bitsOf(row)]));
  }

  /** 有列可写才算能录行；行操作各自的权限位由调用方指定（改行要 update 权，不是 read 权）。 */
  private async requireFields(
    user: CurrentUser,
    tableId: number,
    bit: PermissionBit,
  ) {
    this.requireBit(await this.access(user, tableId), bit);
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
    if (!fields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该表还没有列，请先添加列',
      );
    }
    return fields;
  }

  /**
   * 可授权名单＝该账号名下的「旗下成员」，两处来源：
   * 企业侧＝以同一统一社会信用代码认证通过的其他账号；服务商侧＝已确认绑定的职员。
   * 两个来源都按账号查，与当前切换的身份无关（身份只是前端视角），
   * 所以既没有企业也没有绑定职员的账号看不到任何可授权对象。
   */
  private async grantCandidates(user: CurrentUser): Promise<GrantCandidate[]> {
    const enterprise = new Set<string>();
    const staff = new Set<string>();
    const mine = await this.identity.myEnterprises(user.userId);
    const usccs = mine.map((item) => item.uscc.trim()).filter(Boolean);
    if (usccs.length) {
      const peers = await this.prisma.enterpriseProfile.findMany({
        where: { uscc: { in: usccs }, status: 'APPROVED' },
        select: { userId: true },
      });
      for (const peer of peers) enterprise.add(peer.userId);
    }
    const binds = await this.prisma.providerStaff.findMany({
      where: { providerUserId: user.userId, status: 'ACTIVE' },
      select: { staffUserId: true },
    });
    for (const bind of binds) staff.add(bind.staffUserId);
    const ids = [...new Set([...enterprise, ...staff])].filter(
      (id) => id && id !== user.userId,
    );
    if (!ids.length) return [];
    const names = await this.users.displayNames(ids);
    return ids.sort().map((id) => ({
      userId: id,
      name: names.get(id) || id,
      sources: [
        ...(enterprise.has(id) ? ['ENTERPRISE'] : []),
        ...(staff.has(id) ? ['PROVIDER_STAFF'] : []),
      ],
    }));
  }

  /**
   * 行数据校验：只认已存在的列键，必填列必须有值，值按列类型归一。
   * 请求体的值是 unknown，对象/数组直接进文本列会写成 [object Object]，故文本类走 text()。
   */
  private normalizeData(
    fields: DataFieldRow[],
    raw: unknown,
  ): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '行数据必须是对象（列键 → 值）',
      );
    }
    const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
    const input = raw as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const field = byKey.get(key);
      if (!field) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列键「${key}」不属于该表，请先添加该列`,
        );
      }
      data[key] = coerce(field, value);
    }
    for (const field of fields) {
      if (!field.required) continue;
      const value = data[field.fieldKey];
      if (value === undefined || value === null || value === '') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请填写必填列「${field.name}」`,
        );
      }
    }
    return data;
  }
}

function isFieldType(value: string) {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * 单选候选项：请求体给数组或逗号分隔文本均可；
 * 已存的 options 是 `{ choices: [...] }`，故对象要再剥一层（asJsonArray 认对象会得空数组，
 * 那样校验会静默失效：越界取值被写进库、改列时还会误判成「没填候选项」）。
 */
function parseChoices(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return parseChoices((value as Record<string, unknown>).choices);
  }
  // 剥完对象只剩数组 / 文本 / 标量，toJsonArray 这三种输入一律返数组。
  const items = toJsonArray(value);
  if (!Array.isArray(items)) return [];
  return items.map((item) => text(item).trim()).filter(Boolean);
}

function choiceList(body: Record<string, unknown>): string[] {
  return parseChoices(
    body.choices ??
      (body.options as Record<string, unknown> | undefined)?.choices,
  );
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text2 = text(value).trim().toLowerCase();
  return text2 === 'true' || text2 === '1' || text2 === 'on';
}

/** 库里一行授权 → 四个权限位（缺列按 false 处理，不给默认放行）。 */
function bitsOf(row: {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}): TablePermissions {
  return {
    read: row.canRead,
    create: row.canCreate,
    update: row.canUpdate,
    delete: row.canDelete,
  };
}

/** 请求体 → 四个权限位；四种操作各读自己的键，互不牵连。 */
function grantBits(body: Record<string, unknown>) {
  return {
    canRead: truthy(body.can_read ?? body.canRead),
    canCreate: truthy(body.can_create ?? body.canCreate),
    canUpdate: truthy(body.can_update ?? body.canUpdate),
    canDelete: truthy(body.can_delete ?? body.canDelete),
  };
}

/** 列表项的权限标记：本人归属＝四权全有，否则用授权行；管理员只见非本人表时只读。 */
function permissionOf(
  user: CurrentUser,
  createdBy: string,
  grant: TablePermissions | undefined,
): { owner: boolean; can: TablePermissions } {
  if (createdBy === user.userId) return { owner: true, can: ALL_BITS_ON };
  if (grant) return { owner: false, can: grant };
  return { owner: false, can: READ_ONLY };
}

function decorateGrant(row: {
  id: number;
  tableId: number;
  granteeUserId: string;
  grantedBy: string;
  createdAt: Date;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return {
    id: row.id,
    tableId: row.tableId,
    userId: row.granteeUserId,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
    can: bitsOf(row),
  };
}

/** 未填的值统一存 null，必填校验在 normalizeData 里做。 */
function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '';
}

function coerce(field: DataFieldRow, value: unknown): unknown {
  if (isEmpty(value)) return null;
  switch (field.fieldType) {
    case 'number': {
      const num = Number(typeof value === 'string' ? value.trim() : value);
      if (!Number.isFinite(num)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列「${field.name}」要填数字`,
        );
      }
      return num;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const flag = text(value).trim().toLowerCase();
      if (['true', '1', 'yes', '是'].includes(flag)) return true;
      if (['false', '0', 'no', '否'].includes(flag)) return false;
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `列「${field.name}」只能填 是/否`,
      );
    }
    case 'date': {
      const raw = text(value).trim();
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列「${field.name}」要填合法日期（如 2026-01-15）`,
        );
      }
      return parsed.toISOString();
    }
    case 'url': {
      const raw = text(value).trim();
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `列「${field.name}」只允许 http(s) 链接`,
          );
        }
        return u.toString();
      } catch (err) {
        if (err instanceof BusinessException) throw err;
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列「${field.name}」要填合法网址`,
        );
      }
    }
    case 'email': {
      const raw = text(value).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列「${field.name}」要填合法邮箱`,
        );
      }
      return raw;
    }
    case 'json':
      return value;
    case 'select': {
      const text2 = text(value).trim();
      const choices = choiceList({ choices: field.options });
      if (choices.length && !choices.includes(text2)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `列「${field.name}」只能选：${choices.join(' / ')}`,
        );
      }
      return text2;
    }
    default:
      return text(value).trim();
  }
}

function decorateField(field: DataFieldRow) {
  const choices = choiceList({ choices: field.options });
  return {
    id: field.id,
    tableId: field.tableId,
    name: field.name,
    fieldKey: field.fieldKey,
    fieldType: field.fieldType,
    sortOrder: field.sortOrder,
    options: {
      ...(field.options && typeof field.options === 'object'
        ? (field.options as Record<string, unknown>)
        : {}),
      ...(choices.length ? { choices } : {}),
    },
    required: field.required,
    createdAt: field.createdAt,
  };
}

function decorateRow(row: {
  id: number;
  tableId: number;
  data: Prisma.JsonValue;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tableId: row.tableId,
    data:
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as RowValue)
        : {},
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Prisma 唯一键冲突（库里的约束挡住了并发写入，不是代码缺陷）。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * CSV 转义：含逗号 / 双引号 / 换行的值用双引号包起来，内部双引号 doubled。
 * 以 = / + / @ / Tab / CR 开头（或以 - 开头但不是纯数字）的值会被 Excel、Sheets
 * 当公式执行——导出文件在本机就能弹命令，故加前导单引号强制成文本。
 * 纯数字（含 -100）不加前缀，否则数值列导出后就成了文本。
 */
const FORMULA_LIKE = /^(?:[=+@\t\r]|-(?!\d+(?:\.\d+)?$))/;

function csvEscape(value: string): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (FORMULA_LIKE.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 单元格值 → 文本：与前端 cellText 同口径，空值返空串。 */
function formatCellValue(fieldType: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (fieldType === 'boolean') {
    if (typeof value === 'boolean') return value ? '是' : '否';
    const flag = text(value).trim().toLowerCase();
    if (['true', '1', 'yes', '是'].includes(flag)) return '是';
    if (['false', '0', 'no', '否'].includes(flag)) return '否';
    return text(value);
  }
  if (fieldType === 'json' || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return text(value);
}
