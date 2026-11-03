import type {
  OaField,
  OaFlowNode,
  OaLinkageRule,
  OaTemplate,
  OaTemplateSummary,
} from '@enterprise/contracts';
import { OA_TEMPLATE_CATEGORY_LABELS } from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import type { OaContext } from './oa.scope';
import {
  asFields,
  asFlowNodes,
  asLinkageRules,
  asString,
  int,
  iso,
  statusLabel,
} from './oa.helpers';

type TemplateRow = {
  id: number;
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  numberPrefix: string;
  fieldsSchema: unknown;
  flowSchema: unknown;
  linkageSchema: unknown;
  version: number;
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const field = (row: OaField): OaField => row;
const node = (row: Partial<OaFlowNode> & { name: string }): OaFlowNode => ({
  name: row.name,
  approverType: row.approverType || 'MEMBER',
  userIds: row.userIds || [],
  roles: row.roles || [],
  department: row.department || '',
  positions: row.positions || [],
  aiPreReview: row.aiPreReview || {
    enabled: false,
    personaId: 0,
    principles: '',
    personaName: '',
    personaStyle: '',
    personaText: '',
  },
  mode: row.mode || 'ANY',
  condition: row.condition || null,
  emptyAction: row.emptyAction || 'SKIP',
  ccUserIds: row.ccUserIds || [],
  remindAfterHours: row.remindAfterHours ?? 24,
});

const APPROVED_LOG: OaLinkageRule[] = [
  { on: 'APPROVED', target: 'LINKED', action: 'LOG', params: {} },
];

const DEPT_HEAD = (name = '部门负责人审批'): OaFlowNode =>
  node({ name, approverType: 'DEPT_HEAD', emptyAction: 'SKIP' });

const ORG_OWNER = (name = '组织管理员审批'): OaFlowNode =>
  node({ name, approverType: 'OWNER', emptyAction: 'ERROR' });

/**
 * 内置六类模板：只是预填，落库后管理员可自由改字段与流程；内置模板可停用不可删。
 * 无财务业务板块，付款的「财务审批」节点用 ROLE + TAX（财税板块成员）。
 */
export const BUILTIN_TEMPLATES: {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  numberPrefix: string;
  sortOrder: number;
  fields: OaField[];
  flow: OaFlowNode[];
  linkage: OaLinkageRule[];
}[] = [
  {
    key: 'leave',
    name: '请假申请',
    category: 'LEAVE',
    description: '年假、事假、病假、调休；部门负责人审核后由组织管理员确认。',
    icon: 'CalendarOutlined',
    numberPrefix: 'QJ',
    sortOrder: 10,
    fields: [
      field({
        key: 'leaveType',
        label: '请假类型',
        type: 'select',
        required: true,
        placeholder: '',
        help: '',
        default: '年假',
        options: ['年假', '事假', '病假', '调休'].map((item) => ({
          label: item,
          value: item,
        })),
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'startDate',
        label: '开始日期',
        type: 'date',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'endDate',
        label: '结束日期',
        type: 'date',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'days',
        label: '请假时长（天）',
        type: 'number',
        required: true,
        placeholder: '按 0.5 天为单位填写',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'reason',
        label: '请假事由',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'attachments',
        label: '证明附件',
        type: 'attachment',
        required: false,
        placeholder: '',
        help: '病假可上传就诊证明',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
    ],
    flow: [DEPT_HEAD(), ORG_OWNER()],
    linkage: APPROVED_LOG,
  },
  {
    key: 'expense',
    name: '费用报销',
    category: 'EXPENSE',
    description:
      '明细逐条添加；金额 2000 元以下部门负责人审批即可，以上加组织管理员。',
    icon: 'AccountBookOutlined',
    numberPrefix: 'BX',
    sortOrder: 20,
    fields: [
      field({
        key: 'items',
        label: '费用明细',
        type: 'list',
        required: true,
        placeholder: '',
        help: '逐条添加每笔费用',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [
          {
            key: 'expenseType',
            label: '费用类型',
            type: 'select',
            required: true,
            options: ['差旅', '交通', '餐饮', '办公', '其他'].map((item) => ({
              label: item,
              value: item,
            })),
          },
          {
            key: 'date',
            label: '发生日期',
            type: 'date',
            required: true,
            options: [],
          },
          {
            key: 'amount',
            label: '金额（元）',
            type: 'amount',
            required: true,
            options: [],
          },
          {
            key: 'note',
            label: '说明',
            type: 'text',
            required: false,
            options: [],
          },
        ],
      }),
      field({
        key: 'reason',
        label: '报销说明',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'receipts',
        label: '票据附件',
        type: 'attachment',
        required: false,
        placeholder: '',
        help: '发票、行程单等，逐张上传到数字资产',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'bankAccount',
        label: '收款账户',
        type: 'text',
        required: false,
        placeholder: '开户行 + 账号',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
    ],
    flow: [
      DEPT_HEAD(),
      node({
        name: '组织管理员审批',
        approverType: 'OWNER',
        emptyAction: 'ERROR',
        condition: { field: 'amount', op: 'gte', value: 2000 },
      }),
    ],
    linkage: APPROVED_LOG,
  },
  {
    key: 'payment',
    name: '付款申请',
    category: 'PAYMENT',
    description: '可挂 CRM 合同或回款计划；5 万元以上需组织管理员二次确认。',
    icon: 'BankOutlined',
    numberPrefix: 'FK',
    sortOrder: 30,
    fields: [
      field({
        key: 'payee',
        label: '收款方',
        type: 'text',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'amount',
        label: '付款金额（元）',
        type: 'amount',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'dueDate',
        label: '期望付款日期',
        type: 'date',
        required: false,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'reason',
        label: '付款事由',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'contract',
        label: '关联合同',
        type: 'ref',
        required: false,
        placeholder: '',
        help: '可选 CRM 合同或签约管理合同',
        options: [],
        visibleWhen: null,
        refTarget: 'CRM_CONTRACT',
        columns: [],
      }),
    ],
    flow: [
      DEPT_HEAD(),
      node({
        name: '财务审批',
        approverType: 'ROLE',
        roles: ['TAX'],
        emptyAction: 'SKIP',
      }),
      ORG_OWNER(),
      node({
        name: '大额付款二次确认',
        approverType: 'OWNER',
        emptyAction: 'ERROR',
        condition: { field: 'amount', op: 'gte', value: 50000 },
      }),
    ],
    linkage: APPROVED_LOG,
  },
  {
    key: 'purchase',
    name: '采购申请',
    category: 'PURCHASE',
    description: '物品或服务采购，填数量与预估金额。',
    icon: 'ShoppingCartOutlined',
    numberPrefix: 'CG',
    sortOrder: 40,
    fields: [
      field({
        key: 'subject',
        label: '采购物品/服务',
        type: 'text',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'quantity',
        label: '数量',
        type: 'number',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'amount',
        label: '预估金额（元）',
        type: 'amount',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'supplier',
        label: '供应商',
        type: 'text',
        required: false,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'purpose',
        label: '采购用途',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
    ],
    flow: [DEPT_HEAD(), ORG_OWNER()],
    linkage: APPROVED_LOG,
  },
  {
    key: 'seal',
    name: '用章申请',
    category: 'SEAL',
    description: '公章、合同章、财务章、法人章使用登记。',
    icon: 'SafetyOutlined',
    numberPrefix: 'YZ',
    sortOrder: 50,
    fields: [
      field({
        key: 'sealType',
        label: '用章类型',
        type: 'select',
        required: true,
        placeholder: '',
        help: '',
        default: '公章',
        options: ['公章', '合同章', '财务章', '法人章'].map((item) => ({
          label: item,
          value: item,
        })),
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'fileName',
        label: '文件名称',
        type: 'text',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'purpose',
        label: '用章用途',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'copies',
        label: '份数',
        type: 'number',
        required: true,
        placeholder: '',
        help: '',
        default: 1,
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'contract',
        label: '关联合同',
        type: 'ref',
        required: false,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
    ],
    flow: [ORG_OWNER('组织管理员审批')],
    linkage: APPROVED_LOG,
  },
  {
    key: 'general',
    name: '通用申请',
    category: 'GENERAL',
    description: '其他需要留痕的申请，管理员可自行加字段。',
    icon: 'FormOutlined',
    numberPrefix: 'OA',
    sortOrder: 60,
    fields: [
      field({
        key: 'reason',
        label: '申请事由',
        type: 'textarea',
        required: true,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'expectDate',
        label: '期望完成日期',
        type: 'date',
        required: false,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
      field({
        key: 'attachments',
        label: '相关材料',
        type: 'attachment',
        required: false,
        placeholder: '',
        help: '',
        options: [],
        visibleWhen: null,
        refTarget: '',
        columns: [],
      }),
    ],
    flow: [ORG_OWNER()],
    linkage: APPROVED_LOG,
  },
];

export const OPEN_STATUSES = ['DRAFT', 'APPROVING', 'RETURNED'];

/** 模板库：首次进入按组织懒建内置六套，之后版本随保存递增，单据提交时冻结快照。 */
export class OaTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSeeded(ctx: OaContext) {
    const existing = await this.prisma.oaTemplate.findMany({
      where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
      select: { key: true },
    });
    const keys = new Set(existing.map((row) => row.key));
    const missing = BUILTIN_TEMPLATES.filter((item) => !keys.has(item.key));
    if (!missing.length) return;
    await this.prisma.oaTemplate.createMany({
      data: missing.map(
        (item) =>
          ({
            orgType: ctx.orgType,
            orgUserId: ctx.orgUserId,
            key: item.key,
            name: item.name,
            category: item.category,
            description: item.description,
            icon: item.icon,
            numberPrefix: item.numberPrefix,
            fieldsSchema: item.fields,
            flowSchema: item.flow,
            linkageSchema: item.linkage,
            version: 1,
            builtin: true,
            enabled: true,
            sortOrder: item.sortOrder,
            createdBy: ctx.actorId,
          }) as unknown as Prisma.OaTemplateCreateManyInput,
      ),
    });
  }

  async list(
    ctx: OaContext,
    options: { category?: string; enabledOnly?: boolean } = {},
  ): Promise<OaTemplateSummary[]> {
    await this.ensureSeeded(ctx);
    const rows = (await this.prisma.oaTemplate.findMany({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        ...(options.category ? { category: options.category } : {}),
        ...(options.enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })) as TemplateRow[];
    const open = await this.prisma.oaApplication.groupBy({
      by: ['templateId'],
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        status: { in: OPEN_STATUSES },
      },
      _count: { _all: true },
    });
    const openMap = new Map(
      open.map((row) => [row.templateId, row._count?._all ?? 0]),
    );
    return rows.map((row) => this.toSummary(row, openMap.get(row.id) || 0));
  }

  async detail(ctx: OaContext, id: number): Promise<OaTemplate> {
    const row = await this.find(ctx, id);
    return this.toTemplate(row);
  }

  async find(ctx: OaContext, id: number): Promise<TemplateRow> {
    const row = (await this.prisma.oaTemplate.findFirst({
      where: { id, orgType: ctx.orgType, orgUserId: ctx.orgUserId },
    })) as TemplateRow | null;
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模板不存在');
    }
    return row;
  }

  async save(
    ctx: OaContext,
    body: Record<string, unknown>,
  ): Promise<OaTemplate> {
    await this.ensureSeeded(ctx);
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织管理员可以维护模板与流程',
      );
    }
    const id = int(body.id, 0);
    const fields = this.validateFields(asFields(body.fields));
    const flow = this.validateFlow(asFlowNodes(body.flow));
    const linkage = asLinkageRules(body.linkage);
    const name = asString(body.name, 40);
    const key = asString(body.key, 40);
    const current = id ? await this.find(ctx, id) : null;
    const finalKey = current ? current.key : key;
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模板名称');
    if (!finalKey) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模板标识');
    }
    if (!current) {
      const duplicated = await this.prisma.oaTemplate.findFirst({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.orgUserId,
          key: finalKey,
        },
        select: { id: true },
      });
      if (duplicated) {
        throw new BusinessException(ErrorCode.CONFLICT, '模板标识已存在');
      }
    }
    const payload = {
      name,
      category: asString(body.category, 20) || 'GENERAL',
      description: asString(body.description, 200),
      icon: asString(body.icon, 40),
      numberPrefix: (asString(body.numberPrefix, 8) || 'OA').toUpperCase(),
      fieldsSchema: fields as unknown as object,
      flowSchema: flow as unknown as object,
      linkageSchema: linkage as unknown as object,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      sortOrder: int(body.sortOrder, 0),
    };
    if (current) {
      const changed = this.hasChanged(current, payload);
      const row = (await this.prisma.oaTemplate.update({
        where: { id: current.id },
        data: {
          ...payload,
          ...(changed ? { version: current.version + 1 } : {}),
        },
      })) as TemplateRow;
      return this.toTemplate(row);
    }
    const row = (await this.prisma.oaTemplate.create({
      data: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        key: finalKey,
        builtin: false,
        createdBy: ctx.actorId,
        ...payload,
      },
    })) as TemplateRow;
    return this.toTemplate(row);
  }

  async toggle(ctx: OaContext, id: number, enabled: boolean) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织管理员可以启停模板',
      );
    }
    const current = await this.find(ctx, id);
    if (!enabled) {
      await this.assertNoOpen(ctx, current.id, '停用');
    }
    const row = (await this.prisma.oaTemplate.update({
      where: { id: current.id },
      data: { enabled },
    })) as TemplateRow;
    return this.toTemplate(row);
  }

  async copy(ctx: OaContext, id: number, key: string, name: string) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织管理员可以复制模板',
      );
    }
    const source = await this.find(ctx, id);
    const finalKey = asString(key, 40);
    const finalName = asString(name, 40) || `${source.name} 副本`;
    if (!finalKey) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写新模板标识');
    }
    const duplicated = await this.prisma.oaTemplate.findFirst({
      where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId, key: finalKey },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ErrorCode.CONFLICT, '模板标识已存在');
    }
    const row = (await this.prisma.oaTemplate.create({
      data: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        key: finalKey,
        name: finalName,
        category: source.category,
        description: source.description,
        icon: source.icon,
        numberPrefix: source.numberPrefix,
        fieldsSchema: source.fieldsSchema as object,
        flowSchema: source.flowSchema as object,
        linkageSchema: source.linkageSchema as object,
        version: 1,
        builtin: false,
        enabled: true,
        sortOrder: source.sortOrder + 1,
        createdBy: ctx.actorId,
      },
    })) as TemplateRow;
    return this.toTemplate(row);
  }

  /** 内置模板只能停用；自定义模板有在途单据时不能删。 */
  async remove(ctx: OaContext, id: number) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织管理员可以删除模板',
      );
    }
    const row = await this.find(ctx, id);
    if (row.builtin) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '内置模板只能停用，不能删除',
      );
    }
    await this.assertNoOpen(ctx, row.id, '删除');
    await this.prisma.oaTemplate.delete({ where: { id: row.id } });
    return { removed: true };
  }

  private async assertNoOpen(
    ctx: OaContext,
    templateId: number,
    action: string,
  ) {
    const open = await this.prisma.oaApplication.count({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        templateId,
        status: { in: OPEN_STATUSES },
      },
    });
    if (open) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `该模板还有 ${open} 张在途单据，不能${action}`,
      );
    }
  }

  private hasChanged(
    row: TemplateRow,
    payload: {
      fieldsSchema: unknown;
      flowSchema: unknown;
      linkageSchema: unknown;
      name: string;
      numberPrefix: string;
    },
  ) {
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return (
      row.name !== payload.name ||
      row.numberPrefix !== payload.numberPrefix ||
      !same(asFields(row.fieldsSchema), payload.fieldsSchema) ||
      !same(asFlowNodes(row.flowSchema), payload.flowSchema) ||
      !same(asLinkageRules(row.linkageSchema), payload.linkageSchema)
    );
  }

  validateFields(fields: OaField[]) {
    if (!fields.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模板至少要有一个字段',
      );
    }
    const keys = new Set<string>();
    for (const item of fields) {
      if (keys.has(item.key)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `字段标识重复：${item.key}`,
        );
      }
      keys.add(item.key);
      if (item.type === 'list' && !item.columns.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `明细子表「${item.label}」需要配置列`,
        );
      }
      if (
        ['select', 'radio', 'multiSelect'].includes(item.type) &&
        !item.options.length
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `选项字段「${item.label}」需要配置选项`,
        );
      }
    }
    return fields;
  }

  validateFlow(flow: OaFlowNode[]) {
    if (!flow.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少配置一个审批节点',
      );
    }
    if (flow.length > 10) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '审批流程最多 10 个节点',
      );
    }
    flow.forEach((item, index) => {
      if (item.approverType === 'MEMBER' && !item.userIds.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `第 ${index + 1} 个节点没有指定审批人`,
        );
      }
      if (item.approverType === 'ROLE' && !item.roles.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `第 ${index + 1} 个节点没有选择业务板块`,
        );
      }
      if (item.approverType === 'DEPT_POSITION' && !item.department) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `第 ${index + 1} 个节点没有选择部门`,
        );
      }
      if (item.aiPreReview.enabled && !item.aiPreReview.principles.trim()) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `第 ${index + 1} 个节点启用了 AI 预审，请填写审核原则`,
        );
      }
    });
    return flow;
  }

  toTemplate(row: TemplateRow): OaTemplate {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      category: row.category,
      categoryLabel: statusLabel(OA_TEMPLATE_CATEGORY_LABELS, row.category),
      description: text(row.description),
      icon: text(row.icon),
      numberPrefix: row.numberPrefix,
      fields: asFields(row.fieldsSchema),
      flow: asFlowNodes(row.flowSchema),
      linkage: asLinkageRules(row.linkageSchema),
      version: row.version,
      builtin: row.builtin,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  toSummary(row: TemplateRow, openCount: number): OaTemplateSummary {
    const flow = asFlowNodes(row.flowSchema);
    const linkage = asLinkageRules(row.linkageSchema);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      category: row.category,
      categoryLabel: statusLabel(OA_TEMPLATE_CATEGORY_LABELS, row.category),
      description: text(row.description),
      icon: text(row.icon),
      numberPrefix: row.numberPrefix,
      version: row.version,
      builtin: row.builtin,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      nodeCount: flow.length,
      linkageCount: linkage.length,
      openCount,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}
