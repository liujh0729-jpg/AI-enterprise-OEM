import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CrmScopeService } from './crm.scope';
import {
  ROLE_LABELS,
  SCOPE_LABELS,
  asArray,
  iso,
  jsonObject,
} from './crm.helpers';

const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiselect',
  'member',
  'phone',
  'url',
  'attachment',
]);
const FORM_KEYS = new Set([
  'lead',
  'customer',
  'contact',
  'opportunity',
  'quotation',
  'contract',
  'payment',
  'invoice',
  'order',
]);

export class CrmSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
  ) {}

  async settings(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    const row = await this.prisma.crmSetting.findUnique({
      where: { ownerUserId: ctx.ownerUserId },
    });
    return {
      currency: row?.currency || 'CNY',
      maskPhone: row?.maskPhone ?? true,
      maskEmail: row?.maskEmail ?? true,
      titleFields: jsonObject(row?.titleFields),
      aiAnalysisGuide: row?.aiAnalysisGuide || '',
      role: ctx.role,
      roleLabel: ROLE_LABELS[ctx.role] || '',
      isAdmin: ctx.isAdmin,
      isMember: ctx.isMember,
      dataScope: ctx.dataScope,
      dataScopeLabel: SCOPE_LABELS[ctx.dataScope] || '',
    };
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const data = {
      currency: text(body.currency, 'CNY').slice(0, 8) || 'CNY',
      maskPhone:
        body.maskPhone === undefined ? undefined : Boolean(body.maskPhone),
      maskEmail:
        body.maskEmail === undefined ? undefined : Boolean(body.maskEmail),
      titleFields:
        body.titleFields === undefined
          ? undefined
          : jsonObject(body.titleFields),
      aiAnalysisGuide:
        body.aiAnalysisGuide === undefined
          ? undefined
          : text(body.aiAnalysisGuide).slice(0, 4000),
    };
    const row = await this.prisma.crmSetting.upsert({
      where: { ownerUserId: ctx.ownerUserId },
      create: {
        ownerUserId: ctx.ownerUserId,
        currency: data.currency,
        maskPhone: data.maskPhone ?? true,
        maskEmail: data.maskEmail ?? true,
        titleFields: (data.titleFields || {}) as never,
        aiAnalysisGuide: data.aiAnalysisGuide ?? '',
      },
      update: data as never,
    });
    return this.settings(user).then((view) => ({
      ...view,
      updatedAt: iso(row.updatedAt),
    }));
  }

  async members(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const [rows, staff] = await Promise.all([
      this.prisma.crmMember.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { id: 'asc' },
      }),
      this.scope.accountStaff(ctx.ownerUserId),
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
        roleLabel: ROLE_LABELS[row.role] || row.role,
        dataScope: row.dataScope,
        dataScopeLabel: SCOPE_LABELS[row.dataScope] || row.dataScope,
        department: row.department,
        status: row.status,
        isSelf: row.memberUserId === ctx.actorId,
        createdAt: iso(row.createdAt),
      })),
      candidates: staff
        .filter((row) => !configured.has(row.memberUserId))
        .map((row) => ({
          memberUserId: row.memberUserId,
          name: row.name,
          memberKind: row.memberKind,
          memberKindLabel: row.memberKindLabel,
          department: row.department,
          roles: row.roles,
        })),
      owner: {
        userId: ctx.ownerUserId,
        name: names.get(ctx.ownerUserId) || ctx.ownerUserId,
        isSelf: ctx.ownerUserId === ctx.actorId,
      },
      isAdmin: ctx.isAdmin,
      myRole: ctx.role,
      myRoleLabel: ROLE_LABELS[ctx.role] || '',
    };
  }

  async saveMember(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const memberUserId = text(body.memberUserId).trim();
    if (!memberUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择成员');
    }
    if (memberUserId === ctx.ownerUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '负责人不需要再分配角色',
      );
    }
    const staff = await this.scope.accountStaff(ctx.ownerUserId);
    const target = staff.find((row) => row.memberUserId === memberUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该成员不在本账号的职员与代理人中',
      );
    }
    const role = text(body.role, 'SALES');
    const dataScope = text(body.dataScope, 'SELF');
    if (!ROLE_LABELS[role] || role === '') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '角色不正确');
    }
    if (!SCOPE_LABELS[dataScope]) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '数据范围不正确');
    }
    const department = text(body.department, target.department).slice(0, 64);
    const row = await this.prisma.crmMember.upsert({
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
        dataScope,
        department,
      },
      update: { role, dataScope, department, status: 'ACTIVE' },
    });
    await this.log(
      ctx.ownerUserId,
      'MEMBER',
      row.id,
      'SAVE',
      {},
      { role, dataScope, department },
      ctx.actorId,
    );
    return {
      id: row.id,
      memberUserId: row.memberUserId,
      memberName: target.name,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role,
      dataScope: row.dataScope,
      dataScopeLabel: SCOPE_LABELS[row.dataScope] || row.dataScope,
      department: row.department,
      status: row.status,
      isSelf: row.memberUserId === ctx.actorId,
      createdAt: iso(row.createdAt),
    };
  }

  async removeMember(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmMember.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    await this.prisma.crmMember.delete({ where: { id } });
    await this.log(
      ctx.ownerUserId,
      'MEMBER',
      id,
      'REMOVE',
      { memberUserId: row.memberUserId },
      {},
      ctx.actorId,
    );
    return { removed: true };
  }

  async fieldDefs(user: CurrentUser, formKey?: string) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmFieldDef.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(formKey ? { formKey: text(formKey) } : {}),
      },
      orderBy: [{ formKey: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.fieldView(row));
  }

  private fieldView(row: {
    id: number;
    formKey: string;
    fieldKey: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
    visible: boolean;
    editable: boolean;
    sort: number;
  }) {
    return {
      id: row.id,
      formKey: row.formKey,
      fieldKey: row.fieldKey,
      name: row.name,
      type: row.type,
      required: row.required,
      options: asArray(row.options),
      visible: row.visible,
      editable: row.editable,
      sort: row.sort,
    };
  }

  async saveFieldDef(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const formKey = text(body.formKey).trim();
    if (!FORM_KEYS.has(formKey)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '模块不正确');
    }
    const fieldKey = text(body.fieldKey).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(fieldKey)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '字段标识只能由字母、数字、下划线组成，且以字母开头',
      );
    }
    const type = text(body.type, 'text');
    if (!FIELD_TYPES.has(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '字段类型不正确');
    }
    const data = {
      formKey,
      fieldKey,
      name: text(body.name).trim().slice(0, 60),
      type,
      required: Boolean(body.required),
      options: asArray(body.options) as never,
      visible: body.visible === undefined ? true : Boolean(body.visible),
      editable: body.editable === undefined ? true : Boolean(body.editable),
      sort: Number(body.sort) || 0,
    };
    if (!data.name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写字段名称');
    }
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.crmFieldDef.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    }
    const row = id
      ? await this.prisma.crmFieldDef.update({
          where: { id },
          data,
        })
      : await this.prisma.crmFieldDef.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    }
    return this.fieldView(row);
  }

  async removeFieldDef(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmFieldDef.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    await this.prisma.crmFieldDef.delete({ where: { id } });
    return { removed: true };
  }

  async customModules(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmCustomModule.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    const tables = rows.length
      ? await this.prisma.dataTable.findMany({
          where: { id: { in: rows.map((row) => row.dataTableId) } },
          select: { id: true, name: true },
        })
      : [];
    const tableNames = new Map(tables.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dataTableId: row.dataTableId,
      dataTableName: tableNames.get(row.dataTableId) || '',
      roleIds: asArray(row.roleIds),
      enabled: row.enabled,
      createdAt: iso(row.createdAt),
    }));
  }

  async saveCustomModule(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const dataTableId = Number(body.dataTableId) || 0;
    const table = await this.prisma.dataTable.findFirst({
      where: { id: dataTableId, createdBy: ctx.ownerUserId },
    });
    if (!table) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择本账号的多维表格',
      );
    }
    const data = {
      name: text(body.name).trim().slice(0, 60),
      dataTableId,
      roleIds: asArray(body.roleIds) as never,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    };
    if (!data.name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模块名称');
    }
    const id = Number(body.id) || 0;
    if (id) {
      const existing = await this.prisma.crmCustomModule.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '自定义模块不存在');
    }
    const row = id
      ? await this.prisma.crmCustomModule.update({ where: { id }, data })
      : await this.prisma.crmCustomModule.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      name: row.name,
      dataTableId: row.dataTableId,
      dataTableName: table.name,
      roleIds: asArray(row.roleIds),
      enabled: row.enabled,
      createdAt: iso(row.createdAt),
    };
  }

  async removeCustomModule(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmCustomModule.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '自定义模块不存在');
    await this.prisma.crmCustomModule.delete({ where: { id } });
    return { removed: true };
  }

  async log(
    ownerUserId: string,
    targetType: string,
    targetId: number,
    action: string,
    before: unknown,
    after: unknown,
    operator: string,
    channel = 'web',
  ) {
    await this.prisma.crmChangeLog.create({
      data: {
        ownerUserId,
        targetType,
        targetId,
        action,
        before: (before || {}) as never,
        after: (after || {}) as never,
        operator,
        channel,
      },
    });
  }

  async changeLogs(
    user: CurrentUser,
    query: {
      page?: unknown;
      pageSize?: unknown;
      targetType?: unknown;
      targetId?: unknown;
    },
  ) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where = {
      ownerUserId: ctx.ownerUserId,
      ...(query.targetType ? { targetType: text(query.targetType) } : {}),
      ...(query.targetId ? { targetId: Number(query.targetId) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.crmChangeLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmChangeLog.count({ where }),
    ]);
    const names = await this.scope.names(rows.map((row) => row.operator));
    return {
      list: rows.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        action: row.action,
        operator: row.operator,
        operatorName: names.get(row.operator) || row.operator,
        channel: row.channel,
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }
}
