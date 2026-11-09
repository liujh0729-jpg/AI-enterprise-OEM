import type {
  OaLinkageRule,
  OaLinkSearchItem,
  OaLinkTarget,
} from '@enterprise/contracts';
import {
  OA_LINKAGE_ACTION_LABELS,
  OA_LINK_TARGET_LABELS,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { CATEGORY_LABELS } from '../common/constants';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { toJsonInput } from '../common/json-input';
import { ContractsService } from '../contracts/contracts.service';
import { CrmScopeService, type CrmContext } from '../crm/crm.scope';
import { CrmSettingsService } from '../crm/crm.settings.service';
import { DataTableService } from '../data-table/data-table.service';
import { IdentityService } from '../identity/identity.service';
import { LowCodeAccessService } from '../lowcode/lowcode.access.service';
import {
  hasEntityAction,
  rowAllowed,
  type AccessContext,
} from '../lowcode/lowcode.shared';
import { PrismaService } from '../prisma/prisma.service';
import { asId, jsonArray, jsonObject, num, statusLabel } from './oa.helpers';

export const OA_LINK_STATUS_LABELS: Record<string, string> = {
  PENDING: '待执行',
  DONE: '已执行',
  FAILED: '执行失败',
  SKIPPED: '已跳过',
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '生效中',
  TERMINATED: '已取消',
  EXPIRED: '已到期',
};

/** 一次搜索最多返回多少条候选（选择器是输入框，不需要全量）。 */
const SEARCH_LIMIT = 20;
/** 内建应用与多维表格按行搜索：项目／表最多扫几张，单表最多读几行。 */
const PROJECT_SCAN_LIMIT = 8;
const ROW_SCAN_LIMIT = 200;

/** CRM 六类目标的回执落点（crm_change_logs.target_type）。 */
const CRM_LOG_TARGET_TYPES: Record<string, string> = {
  CRM_CUSTOMER: 'CUSTOMER',
  CRM_OPPORTUNITY: 'OPPORTUNITY',
  CRM_CONTRACT: 'CONTRACT',
  CRM_PAYMENT_PLAN: 'PAYMENT_PLAN',
  CRM_ORDER: 'ORDER',
  CRM_INVOICE: 'INVOICE',
};

const TARGET_DEFS: OaLinkTarget[] = [
  {
    key: 'CRM_CUSTOMER',
    label: 'CRM 客户',
    module: 'CRM',
    detailPath: '/crm?tab=customers&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CRM_OPPORTUNITY',
    label: 'CRM 商机',
    module: 'CRM',
    detailPath: '/crm?tab=opportunities&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CRM_CONTRACT',
    label: 'CRM 合同',
    module: 'CRM',
    detailPath: '/crm?tab=contracts&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CRM_PAYMENT_PLAN',
    label: 'CRM 回款计划',
    module: 'CRM',
    detailPath: '/crm?tab=payments&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CRM_ORDER',
    label: 'CRM 订单',
    module: 'CRM',
    detailPath: '/crm?tab=orders&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CRM_INVOICE',
    label: 'CRM 发票',
    module: 'CRM',
    detailPath: '/crm?tab=invoices&id={0}',
    searchEnabled: true,
  },
  {
    key: 'CONTRACT',
    label: '签约管理合同',
    module: '签约管理',
    detailPath: '/contracts?id={0}',
    searchEnabled: true,
  },
  {
    key: 'LOWCODE_ROW',
    label: '内建应用行',
    module: '内建应用',
    detailPath: '/lowcode/p/{0}?entity={1}&row={2}',
    searchEnabled: true,
  },
  {
    key: 'DATA_TABLE_ROW',
    label: '多维表格行',
    module: '多维表格',
    detailPath: '/data-table?tableId={0}&rowId={1}',
    searchEnabled: true,
  },
];

const targetDef = (key: string) =>
  TARGET_DEFS.find((item) => item.key === key) || null;

export const linkTargetLabel = (key: string) =>
  text(OA_LINK_TARGET_LABELS[key]) || key;

export const linkActionLabel = (action: string) =>
  text(OA_LINKAGE_ACTION_LABELS[action]) || action;

/** 目标记录的展示快照：列表与详情卡片用它，历史标题不随源记录改名而变。 */
export type OaRefSnapshot = {
  targetType: string;
  targetId: string;
  title: string;
  subtitle: string;
  amount: number;
};

/** 联动执行时需要的最小上下文（组织用于 CRM 归属校验）。 */
export type OaOrgRef = { orgType: string; orgUserId: string };

export type OaLinkExecution = {
  org: OaOrgRef;
  /** 关联由发起人建立，执行时的可见性与写入也按发起人视角复核。 */
  applicantId: string;
  applicantName: string;
  actor: CurrentUser;
  actorName: string;
  number: string;
  title: string;
  comment: string;
  outcome: string;
};

type LinkRow = {
  id: number;
  targetType: string;
  targetId: string;
  action: string;
  status: string;
  result: unknown;
  error: string;
  executedAt: Date | null;
};

type ExecutedLink = {
  status: 'DONE' | 'FAILED' | 'SKIPPED';
  error: string;
  result: Record<string, unknown>;
};

/** 行数据的关键字匹配：把 JSON 里的文本值拼成一段小写字符串。 */
const rowKeyword = (data: Record<string, unknown>) =>
  Object.values(data)
    .map((value) =>
      Array.isArray(value)
        ? value.map((item) => text(item)).join(' ')
        : text(value),
    )
    .join(' ')
    .toLowerCase();

const firstTextValue = (
  data: Record<string, unknown>,
  keys: string[],
  fallback: string,
) => {
  for (const key of keys) {
    const value = text(data[key]).trim();
    if (value) return value.slice(0, 120);
  }
  return fallback;
};

/**
 * OA 联动层：把单据挂到 CRM / 签约 / 内建应用 / 多维表格的具体记录上，
 * 审批结束后按模板规则执行「写审批回执」或「改写目标字段」。
 *
 * 数据范围一律复用目标模块自己的读取口径（CRM 的 scopeWhereAsync、签约的
 * listWhere、内建应用的 resolve、多维表格的 list），看不到的记录既搜不出来
 * 也存不进单据；执行时再校验一次。
 */
export class OaLinkageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmScope: CrmScopeService,
    private readonly crmSettings: CrmSettingsService,
    private readonly contractsService: ContractsService,
    private readonly identity: IdentityService,
    private readonly dataTables: DataTableService,
    private readonly lowcodeAccess: LowCodeAccessService,
  ) {}

  targets(): OaLinkTarget[] {
    return TARGET_DEFS.map((item) => ({ ...item }));
  }

  /** 搜索候选：目标模块取数失败时该类型返回空清单，不挡住整个选择器。 */
  async search(
    org: OaOrgRef,
    user: CurrentUser,
    targetType: string,
    keyword: string,
  ): Promise<OaLinkSearchItem[]> {
    const word = text(keyword).trim().toLowerCase();
    const target = targetDef(targetType);
    if (!target || !target.searchEnabled) return [];
    try {
      if (targetType.startsWith('CRM_')) {
        const ctx = await this.crmContext(org, user);
        if (!ctx) return [];
        return await this.searchCrm(ctx, targetType, word);
      }
      if (targetType === 'CONTRACT')
        return await this.searchContract(user, word);
      if (targetType === 'LOWCODE_ROW') {
        return await this.searchLowcode(org, user, word);
      }
      return await this.searchDataTable(user, word);
    } catch {
      return [];
    }
  }

  /** 按 id 精确回查一条：业务侧「发起 OA 审批」深链预填关联对象用。 */
  async searchOne(
    org: OaOrgRef,
    user: CurrentUser,
    targetType: string,
    targetId: string,
  ): Promise<OaLinkSearchItem[]> {
    try {
      const snapshot = await this.resolve(org, user, targetType, targetId);
      if (!snapshot) return [];
      return [
        {
          targetType: snapshot.targetType,
          id: snapshot.targetId,
          title: snapshot.title,
          subtitle: snapshot.subtitle,
          amount: snapshot.amount,
        },
      ];
    } catch {
      return [];
    }
  }

  /** 校验单条引用是否仍在目标模块的数据范围内，并取回展示快照。 */
  async resolve(
    org: OaOrgRef,
    user: CurrentUser,
    targetType: string,
    targetId: string,
  ): Promise<OaRefSnapshot | null> {
    const id = text(targetId).trim();
    if (!id || !targetDef(targetType)) return null;
    if (targetType.startsWith('CRM_')) {
      const ctx = await this.crmContext(org, user);
      if (!ctx) return null;
      return await this.crmSnapshot(ctx, targetType, id);
    }
    if (targetType === 'CONTRACT') {
      return await this.contractSnapshot(user, id);
    }
    if (targetType === 'LOWCODE_ROW') {
      return await this.lowcodeSnapshot(org, user, id);
    }
    return await this.dataTableSnapshot(user, id);
  }

  /** 批量校验：把存不进单据的目标名挑出来给一次明确报错。 */
  async collect(
    org: OaOrgRef,
    user: CurrentUser,
    refs: { targetType: string; targetId: string }[],
  ): Promise<OaRefSnapshot[]> {
    const unique = new Map<string, { targetType: string; targetId: string }>();
    for (const item of refs) {
      const targetType = text(item.targetType).trim();
      const targetId = text(item.targetId).trim();
      if (!targetType || !targetId) continue;
      unique.set(`${targetType}:${targetId}`, { targetType, targetId });
    }
    const snapshots: OaRefSnapshot[] = [];
    const missing: string[] = [];
    for (const item of unique.values()) {
      const snapshot = await this.resolve(
        org,
        user,
        item.targetType,
        item.targetId,
      );
      if (snapshot) snapshots.push(snapshot);
      else missing.push(linkTargetLabel(item.targetType));
    }
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `以下关联对象你已看不到，无法存入单据：${[...new Set(missing)].join('、')}`,
      );
    }
    return snapshots;
  }

  /**
   * 提交时按「规则 × 关联对象」展开执行台账。
   * 触发条件与写入参数存进 result，管理员一键重试时按原样再跑一次。
   */
  async createLinks(
    applicationId: number,
    rules: OaLinkageRule[],
    snapshots: OaRefSnapshot[],
  ) {
    const rows: Prisma.OaLinkCreateManyInput[] = [];
    for (const rule of rules) {
      const action = text(rule.action) || 'LOG';
      if (action === 'SUBMIT_FLOW') continue;
      const targets =
        text(rule.target) === 'LINKED'
          ? snapshots
          : snapshots.filter((item) => item.targetType === text(rule.target));
      for (const item of targets) {
        rows.push({
          applicationId,
          targetType: item.targetType,
          targetId: item.targetId,
          action,
          status: 'PENDING',
          result: toJsonInput({
            on: text(rule.on) || 'APPROVED',
            params: jsonObject(rule.params),
            title: item.title,
            subtitle: item.subtitle,
          }),
        });
      }
    }
    if (!rows.length) return [];
    await this.prisma.oaLink.createMany({ data: rows });
    return this.prisma.oaLink.findMany({
      where: { applicationId },
      orderBy: { id: 'asc' },
    });
  }

  /** 终局后执行：条件未命中的行标 SKIPPED，其余逐条跑，失败只记录不抛出。 */
  async run(
    links: LinkRow[],
    execution: OaLinkExecution,
  ): Promise<{ id: number; status: string; error: string }[]> {
    const done: { id: number; status: string; error: string }[] = [];
    for (const link of links) {
      if (link.status !== 'PENDING') continue;
      const result = jsonObject(link.result);
      const on = text(result.on) || 'APPROVED';
      if (on !== execution.outcome) {
        const skipped = await this.finish(link, {
          status: 'SKIPPED',
          error: '',
          result: { ...result, reason: '触发条件未命中' },
        });
        done.push(skipped);
        continue;
      }
      let outcome: ExecutedLink;
      try {
        outcome = await this.execute(link, execution);
      } catch (error) {
        outcome = {
          status: 'FAILED',
          error:
            text(
              error instanceof BusinessException
                ? error.message
                : (error as Error)?.message,
            ).slice(0, 200) || '联动执行失败',
          result: { ...result },
        };
      }
      done.push(
        await this.finish(link, { ...outcome, result: outcome.result }),
      );
    }
    return done;
  }

  /** 管理员一键重试：只重跑失败行，仍按发起人视角复核可见性。 */
  async retry(
    link: LinkRow,
    execution: OaLinkExecution,
  ): Promise<{ id: number; status: string; error: string }> {
    const result = jsonObject(link.result);
    const on = text(result.on) || 'APPROVED';
    if (on !== execution.outcome) {
      return this.finish(link, {
        status: 'SKIPPED',
        error: '',
        result: { ...result, reason: '触发条件未命中' },
      });
    }
    try {
      const outcome = await this.execute(link, execution);
      return this.finish(link, outcome);
    } catch (error) {
      return this.finish(link, {
        status: 'FAILED',
        error:
          text(
            error instanceof BusinessException
              ? error.message
              : (error as Error)?.message,
          ).slice(0, 200) || '联动执行失败',
        result: { ...result },
      });
    }
  }

  dtoOf(row: LinkRow) {
    const result = jsonObject(row.result);
    return {
      id: row.id,
      targetType: row.targetType,
      targetLabel: linkTargetLabel(row.targetType),
      targetId: row.targetId,
      targetTitle: text(result.title),
      action: row.action,
      actionLabel: linkActionLabel(row.action),
      status: row.status,
      statusLabel: statusLabel(OA_LINK_STATUS_LABELS, row.status),
      error: row.error,
      executedAt: row.executedAt ? row.executedAt.toISOString() : '',
    };
  }

  // ---------- 执行 ----------

  private async execute(
    link: LinkRow,
    execution: OaLinkExecution,
  ): Promise<ExecutedLink> {
    const result = jsonObject(link.result);
    const params = jsonObject(result.params);
    const actorUser = new CurrentUser(execution.applicantId, '', '');
    if (link.targetType.startsWith('CRM_')) {
      const ctx = await this.crmContext(execution.org, actorUser);
      if (!ctx)
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '关联人已看不到该 CRM 记录',
        );
      return await this.executeCrm(link, ctx, params, execution);
    }
    if (link.targetType === 'CONTRACT') {
      return await this.executeContract(link, actorUser, params, execution);
    }
    if (link.targetType === 'LOWCODE_ROW') {
      return await this.executeLowcode(link, actorUser, params, execution);
    }
    return await this.executeDataTable(link, actorUser, params, execution);
  }

  private async executeCrm(
    link: LinkRow,
    ctx: CrmContext,
    params: Record<string, unknown>,
    execution: OaLinkExecution,
  ): Promise<ExecutedLink> {
    const snapshot = await this.crmSnapshot(
      ctx,
      link.targetType,
      link.targetId,
    );
    if (!snapshot)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '关联人已看不到该 CRM 记录',
      );
    const id = asId(link.targetId);
    if (id <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '关联记录 id 无效');
    if (link.action === 'SET_FIELD') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'CRM 记录只支持写审批回执，不支持改写字段',
      );
    }
    if (link.action !== 'LOG') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该联动动作暂不支持');
    }
    const payload = {
      number: execution.number,
      title: execution.title,
      applicant: execution.applicantName,
      comment: execution.comment,
      action: linkActionLabel(link.action),
      fieldKey: text(params.fieldKey),
    };
    await this.crmSettings.log(
      ctx.ownerUserId,
      CRM_LOG_TARGET_TYPES[link.targetType] || 'CUSTOMER',
      id,
      `OA_${execution.outcome}`,
      {},
      payload,
      execution.actorName || execution.actor.userId,
      'oa',
    );
    return {
      status: 'DONE',
      error: '',
      result: { ...jsonObject(link.result), written: payload },
    };
  }

  private async executeContract(
    link: LinkRow,
    actorUser: CurrentUser,
    params: Record<string, unknown>,
    execution: OaLinkExecution,
  ): Promise<ExecutedLink> {
    const snapshot = await this.contractSnapshot(actorUser, link.targetId);
    if (!snapshot)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '关联人已看不到该签约合同',
      );
    if (link.action === 'SET_FIELD') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '签约合同不支持改写字段，只支持留痕',
      );
    }
    const detail = this.receiptText(link, snapshot, execution, params);
    await this.identity.audit(execution.actor.userId, 'oa_link_log', detail);
    return {
      status: 'DONE',
      error: '',
      result: { ...jsonObject(link.result), written: { detail } },
    };
  }

  private async executeLowcode(
    link: LinkRow,
    actorUser: CurrentUser,
    params: Record<string, unknown>,
    execution: OaLinkExecution,
  ): Promise<ExecutedLink> {
    const snapshot = await this.lowcodeSnapshot(
      execution.org,
      actorUser,
      link.targetId,
    );
    if (!snapshot)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '关联人已看不到该内建应用记录',
      );
    const parts = link.targetId.split(':');
    const projectId = asId(parts[0]);
    const entityId = asId(parts[1]);
    const rowId = asId(parts[2]);
    const project = await this.prisma.lowCodeProject.findFirst({
      where: { id: projectId },
    });
    if (!project)
      throw new BusinessException(ErrorCode.NOT_FOUND, '内建应用项目不存在');
    const entity = await this.prisma.lowCodeEntity.findFirst({
      where: { id: entityId, projectId },
    });
    if (!entity)
      throw new BusinessException(ErrorCode.NOT_FOUND, '内建应用实体不存在');
    if (link.action === 'LOG') {
      await this.identity.audit(
        execution.actor.userId,
        'oa_link_log',
        this.receiptText(link, snapshot, execution, params),
      );
      return {
        status: 'DONE',
        error: '',
        result: { ...jsonObject(link.result) },
      };
    }
    if (link.action !== 'SET_FIELD') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该联动动作暂不支持');
    }
    await this.writeRowField(entity.dataTableId, rowId, params);
    return {
      status: 'DONE',
      error: '',
      result: {
        ...jsonObject(link.result),
        written: { fieldKey: text(params.fieldKey), value: text(params.value) },
      },
    };
  }

  private async executeDataTable(
    link: LinkRow,
    actorUser: CurrentUser,
    params: Record<string, unknown>,
    execution: OaLinkExecution,
  ): Promise<ExecutedLink> {
    const snapshot = await this.dataTableSnapshot(actorUser, link.targetId);
    if (!snapshot)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '关联人已看不到该多维表格记录',
      );
    if (link.action === 'LOG') {
      await this.identity.audit(
        execution.actor.userId,
        'oa_link_log',
        this.receiptText(link, snapshot, execution, params),
      );
      return {
        status: 'DONE',
        error: '',
        result: { ...jsonObject(link.result) },
      };
    }
    if (link.action !== 'SET_FIELD') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该联动动作暂不支持');
    }
    const parts = link.targetId.split(':');
    const tableId = asId(parts[0]);
    const rowId = asId(parts[1]);
    await this.writeRowField(tableId, rowId, params);
    return {
      status: 'DONE',
      error: '',
      result: {
        ...jsonObject(link.result),
        written: { fieldKey: text(params.fieldKey), value: text(params.value) },
      },
    };
  }

  /**
   * SET_FIELD 的唯一写入实现：只允许改写「下拉且值在选项内」或「文本」列，
   * 与内建应用审批回写的校验口径一致；写入走目标模块自己的 updateRow。
   */
  private async writeRowField(
    tableId: number,
    rowId: number,
    params: Record<string, unknown>,
  ) {
    const fieldKey = text(params.fieldKey).trim();
    const value = text(params.value);
    if (!fieldKey)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '联动未配置目标字段');
    if (tableId <= 0 || rowId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '关联记录 id 无效');
    }
    const [field, row] = await Promise.all([
      this.prisma.dataTableField.findFirst({ where: { tableId, fieldKey } }),
      this.prisma.dataTableRow.findFirst({ where: { id: rowId, tableId } }),
    ]);
    if (!field)
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标字段不存在');
    if (field.fieldType !== 'select' && field.fieldType !== 'text') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `字段「${field.name}」不是下拉或文本列，联动不支持改写`,
      );
    }
    if (field.fieldType === 'select') {
      const choices = jsonArray(jsonObject(field.options).choices).map((item) =>
        text(item),
      );
      if (choices.length && !choices.includes(value)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `值「${value}」不在字段「${field.name}」的选项内`,
        );
      }
    }
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    const data = jsonObject(row.data);
    const table = await this.prisma.dataTable.findFirst({
      where: { id: tableId },
    });
    if (!table)
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标表不存在');
    // 回写以表归属账号执行：审批人通常不是该表的成员，校验已在上面按关联人做完。
    const owner = new CurrentUser(table.createdBy, '', '');
    await this.dataTables.updateRow(owner, tableId, rowId, {
      ...data,
      [fieldKey]: value,
    });
  }

  private receiptText(
    link: LinkRow,
    snapshot: OaRefSnapshot,
    execution: OaLinkExecution,
    params: Record<string, unknown>,
  ) {
    const head = `单据 ${execution.number}（${execution.applicantName}）`;
    const outcome = execution.outcome === 'REJECTED' ? '已驳回' : '已通过';
    const comment = text(execution.comment);
    const detail =
      `${head} ${outcome} · 关联 ${linkTargetLabel(link.targetType)}「${snapshot.title}」` +
      `${comment ? ` · 审批意见：${comment}` : ''}` +
      `${text(params.fieldKey) ? ` · 改写 ${text(params.fieldKey)}=${text(params.value)}` : ''}`;
    return detail.slice(0, 480);
  }

  private async finish(
    link: LinkRow,
    outcome: ExecutedLink,
  ): Promise<{ id: number; status: string; error: string }> {
    const updated = await this.prisma.oaLink.update({
      where: { id: link.id },
      data: {
        status: outcome.status,
        error: outcome.error.slice(0, 500),
        result: toJsonInput(outcome.result),
        executedAt:
          outcome.status === 'DONE' || outcome.status === 'FAILED'
            ? new Date()
            : link.executedAt,
      },
    });
    return { id: updated.id, status: updated.status, error: updated.error };
  }

  // ---------- 目标模块取数 ----------

  /** CRM 归属校验：OA 组织必须与 CRM 的归属账号同一个，否则跨组织记录不可见。 */
  private async crmContext(
    org: OaOrgRef,
    user: CurrentUser,
  ): Promise<CrmContext | null> {
    try {
      const ctx = await this.crmScope.context(user);
      if (!ctx.isMember) return null;
      if (org.orgUserId && ctx.ownerUserId !== org.orgUserId) return null;
      return ctx;
    } catch {
      return null;
    }
  }

  private async searchCrm(
    ctx: CrmContext,
    targetType: string,
    keyword: string,
  ): Promise<OaLinkSearchItem[]> {
    const contains = keyword ? { contains: keyword } : undefined;
    if (targetType === 'CRM_CUSTOMER') {
      const base = await this.crmScope.scopeWhereAsync(ctx, 'CORE');
      const rows = await this.prisma.crmCustomer.findMany({
        where: {
          ...base,
          deletedAt: null,
          ...(contains ? { name: contains } : {}),
        },
        orderBy: { id: 'desc' },
        take: SEARCH_LIMIT,
      });
      return rows.map((row) => ({
        targetType,
        id: String(row.id),
        title: row.name,
        subtitle: [
          row.industry,
          `${row.province}${row.city}`.trim()
            ? `${row.province}${row.city}`
            : '',
        ]
          .filter(Boolean)
          .join(' / '),
        amount: 0,
      }));
    }
    if (targetType === 'CRM_OPPORTUNITY') {
      const base = await this.crmScope.scopeWhereAsync(ctx, 'CORE');
      const rows = await this.prisma.crmOpportunity.findMany({
        where: {
          ...base,
          deletedAt: null,
          ...(contains ? { name: contains } : {}),
        },
        orderBy: { id: 'desc' },
        take: SEARCH_LIMIT,
        select: {
          id: true,
          name: true,
          amount: true,
          expectedEndAt: true,
        },
      });
      return rows.map((row) => ({
        targetType,
        id: String(row.id),
        title: row.name,
        subtitle: row.expectedEndAt
          ? `预计 ${row.expectedEndAt.toISOString().slice(0, 10)}`
          : '',
        amount: num(row.amount),
      }));
    }
    if (targetType === 'CRM_CONTRACT') {
      const base = await this.crmScope.scopeWhereAsync(ctx, 'FINANCE');
      const rows = await this.prisma.crmContract.findMany({
        where: {
          ...base,
          deletedAt: null,
          ...(contains
            ? { OR: [{ name: contains }, { number: contains }] }
            : {}),
        },
        orderBy: { id: 'desc' },
        take: SEARCH_LIMIT,
        select: { id: true, name: true, number: true, amount: true },
      });
      return rows.map((row) => ({
        targetType,
        id: String(row.id),
        title: row.name,
        subtitle: row.number,
        amount: num(row.amount),
      }));
    }
    if (targetType === 'CRM_ORDER') {
      const base = await this.crmScope.scopeWhereAsync(ctx, 'FINANCE');
      const rows = await this.prisma.crmOrder.findMany({
        where: {
          ...base,
          deletedAt: null,
          ...(contains
            ? { OR: [{ name: contains }, { number: contains }] }
            : {}),
        },
        orderBy: { id: 'desc' },
        take: SEARCH_LIMIT,
        select: { id: true, name: true, number: true, amount: true },
      });
      return rows.map((row) => ({
        targetType,
        id: String(row.id),
        title: row.name,
        subtitle: row.number,
        amount: num(row.amount),
      }));
    }
    // 回款计划与发票挂在合同下：先用合同范围裁出可见合同，再取子记录。
    const contractBase = await this.crmScope.scopeWhereAsync(ctx, 'FINANCE');
    const parentWhere = {
      ownerUserId: ctx.ownerUserId,
      contractId: await this.scopedContractIds(contractBase),
    };
    if (targetType === 'CRM_PAYMENT_PLAN') {
      const rows = await this.prisma.crmPaymentPlan.findMany({
        where: { ...parentWhere, ...(contains ? { name: contains } : {}) },
        orderBy: { id: 'desc' },
        take: SEARCH_LIMIT,
        select: { id: true, name: true, planAmount: true, contractId: true },
      });
      const names = await this.contractNames(rows.map((row) => row.contractId));
      return rows.map((row) => ({
        targetType,
        id: String(row.id),
        title: row.name,
        subtitle: names.get(row.contractId) || '',
        amount: num(row.planAmount),
      }));
    }
    const rows = await this.prisma.crmInvoice.findMany({
      where: {
        ...parentWhere,
        ...(contains ? { OR: [{ name: contains }, { remark: contains }] } : {}),
      },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMIT,
      select: { id: true, name: true, amount: true, contractId: true },
    });
    const names = await this.contractNames(rows.map((row) => row.contractId));
    return rows.map((row) => ({
      targetType,
      id: String(row.id),
      title: row.name || `发票 #${row.id}`,
      subtitle: names.get(row.contractId) || '',
      amount: num(row.amount),
    }));
  }

  private async scopedContractIds(base: Record<string, unknown>) {
    const contracts = await this.prisma.crmContract.findMany({
      where: { ...base, deletedAt: null },
      select: { id: true },
      take: 2000,
    });
    return contracts.length
      ? { in: contracts.map((row) => row.id) }
      : { in: [-1] };
  }

  private async contractNames(ids: number[]) {
    const unique = [...new Set(ids.filter((id) => id > 0))];
    if (!unique.length) return new Map<number, string>();
    const rows = await this.prisma.crmContract.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async crmSnapshot(
    ctx: CrmContext,
    targetType: string,
    targetId: string,
  ): Promise<OaRefSnapshot | null> {
    const id = asId(targetId);
    if (id <= 0) return null;
    const items = await this.searchCrmByIds(ctx, targetType, id);
    const item = items.find((row) => row.id === String(id));
    return item
      ? {
          targetType,
          targetId: item.id,
          title: item.title,
          subtitle: item.subtitle,
          amount: item.amount,
        }
      : null;
  }

  /** 单条可见性校验：与搜索同一套范围条件，避免两处口径漂移。 */
  private async searchCrmByIds(
    ctx: CrmContext,
    targetType: string,
    id: number,
  ): Promise<OaLinkSearchItem[]> {
    const all = await this.searchCrm(ctx, targetType, '');
    if (all.some((item) => item.id === String(id))) return all;
    // 关键词命中上限之外的记录：按同范围直接取这一条。
    const base = await this.crmScope.scopeWhereAsync(
      ctx,
      targetType === 'CRM_CUSTOMER' || targetType === 'CRM_OPPORTUNITY'
        ? 'CORE'
        : 'FINANCE',
    );
    if (targetType === 'CRM_CUSTOMER') {
      const row = await this.prisma.crmCustomer.findFirst({
        where: { ...base, id, deletedAt: null },
      });
      return row
        ? [
            {
              targetType,
              id: String(row.id),
              title: row.name,
              subtitle: [row.industry, `${row.province}${row.city}`.trim()]
                .filter(Boolean)
                .join(' / '),
              amount: 0,
            },
          ]
        : [];
    }
    if (targetType === 'CRM_OPPORTUNITY') {
      const row = await this.prisma.crmOpportunity.findFirst({
        where: { ...base, id, deletedAt: null },
      });
      return row
        ? [
            {
              targetType,
              id: String(row.id),
              title: row.name,
              subtitle: row.expectedEndAt
                ? `预计 ${row.expectedEndAt.toISOString().slice(0, 10)}`
                : '',
              amount: num(row.amount),
            },
          ]
        : [];
    }
    if (targetType === 'CRM_CONTRACT') {
      const row = await this.prisma.crmContract.findFirst({
        where: { ...base, id, deletedAt: null },
      });
      return row
        ? [
            {
              targetType,
              id: String(row.id),
              title: row.name,
              subtitle: row.number,
              amount: num(row.amount),
            },
          ]
        : [];
    }
    if (targetType === 'CRM_ORDER') {
      const row = await this.prisma.crmOrder.findMany({
        where: { ...base, id, deletedAt: null },
      });
      const first = row[0];
      return first
        ? [
            {
              targetType,
              id: String(first.id),
              title: first.name,
              subtitle: first.number,
              amount: num(first.amount),
            },
          ]
        : [];
    }
    if (targetType === 'CRM_PAYMENT_PLAN') {
      const parentWhere = {
        ownerUserId: ctx.ownerUserId,
        contractId: await this.scopedContractIds(base),
      };
      const row = await this.prisma.crmPaymentPlan.findFirst({
        where: { ...parentWhere, id },
      });
      if (!row) return [];
      const names = await this.contractNames([row.contractId]);
      return [
        {
          targetType,
          id: String(row.id),
          title: row.name,
          subtitle: names.get(row.contractId) || '',
          amount: num(row.planAmount),
        },
      ];
    }
    const parentWhere = {
      ownerUserId: ctx.ownerUserId,
      contractId: await this.scopedContractIds(base),
    };
    const row = await this.prisma.crmInvoice.findFirst({
      where: { ...parentWhere, id },
    });
    if (!row) return [];
    const names = await this.contractNames([row.contractId]);
    return [
      {
        targetType,
        id: String(row.id),
        title: row.name || `发票 #${row.id}`,
        subtitle: names.get(row.contractId) || '',
        amount: num(row.amount),
      },
    ];
  }

  private contractTitle(row: {
    enterpriseName: string;
    providerOrg: string;
    serviceType: string;
  }) {
    const subject = row.enterpriseName || row.providerOrg || '签约合同';
    const category = text(CATEGORY_LABELS[row.serviceType]) || row.serviceType;
    return `${subject} · ${category}`;
  }

  private contractSubtitle(row: { contractNo: string; status: string }) {
    return `${row.contractNo} ${statusLabel(CONTRACT_STATUS_LABELS, row.status)}`;
  }

  private async searchContract(
    user: CurrentUser,
    keyword: string,
  ): Promise<OaLinkSearchItem[]> {
    const where = await this.contractsService.listWhere(user);
    const rows = await this.prisma.contract.findMany({
      where: {
        ...where,
        ...(keyword
          ? {
              OR: [
                { contractNo: { contains: keyword } },
                { enterpriseName: { contains: keyword } },
                { providerOrg: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMIT,
    });
    return rows.map((row) => ({
      targetType: 'CONTRACT',
      id: String(row.id),
      title: this.contractTitle(row),
      subtitle: this.contractSubtitle(row),
      amount: 0,
    }));
  }

  private async contractSnapshot(
    user: CurrentUser,
    targetId: string,
  ): Promise<OaRefSnapshot | null> {
    const id = asId(targetId);
    if (id <= 0) return null;
    const where = await this.contractsService.listWhere(user);
    const row = await this.prisma.contract.findFirst({
      where: { ...where, id },
    });
    if (!row) return null;
    return {
      targetType: 'CONTRACT',
      targetId: String(row.id),
      title: this.contractTitle(row),
      subtitle: this.contractSubtitle(row),
      amount: 0,
    };
  }

  /** 内建应用行：只扫发起人参与、且属于当前 OA 组织的项目；读权限与行级数据规则都走低代码自己的口径。 */
  private async lowcodeProjects(org: OaOrgRef, user: CurrentUser) {
    const memberships = await this.prisma.lowCodeProjectMember.findMany({
      where: { memberUserId: user.userId, status: 'ACTIVE' },
      select: { projectId: true },
    });
    const ids = memberships.map((row) => row.projectId);
    const readable: Record<string, unknown>[] = [
      { ownerUserId: user.userId },
      { id: { in: ids.length ? ids : [-1] } },
    ];
    const scoped: Record<string, unknown>[] = org.orgUserId
      ? [
          { orgType: org.orgType, orgUserId: org.orgUserId },
          // 个人项目（未选组织）只算本人创建的那份
          { ownerUserId: user.userId, orgUserId: '' },
        ]
      : [{ ownerUserId: user.userId }];
    return this.prisma.lowCodeProject.findMany({
      where: { status: 'ACTIVE', AND: [{ OR: readable }, { OR: scoped }] },
      orderBy: { updatedAt: 'desc' },
      take: PROJECT_SCAN_LIMIT,
    });
  }

  private async searchLowcode(
    org: OaOrgRef,
    user: CurrentUser,
    keyword: string,
  ): Promise<OaLinkSearchItem[]> {
    const out: OaLinkSearchItem[] = [];
    for (const project of await this.lowcodeProjects(org, user)) {
      let access: AccessContext;
      try {
        access = await this.lowcodeAccess.resolve(user, project.id);
      } catch {
        continue;
      }
      const entities = await this.prisma.lowCodeEntity.findMany({
        where: { projectId: project.id },
        orderBy: { sort: 'asc' },
        take: 30,
      });
      const readable = entities.filter((entity) =>
        hasEntityAction(access, entity.id, 'read'),
      );
      if (!readable.length) continue;
      const tableIds = readable.map((entity) => entity.dataTableId);
      const [fields, rows] = await Promise.all([
        this.prisma.dataTableField.findMany({
          where: { tableId: { in: tableIds } },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.dataTableRow.findMany({
          where: { tableId: { in: tableIds } },
          orderBy: { id: 'desc' },
          take: ROW_SCAN_LIMIT,
        }),
      ]);
      const entityByTable = new Map(
        readable.map((entity) => [entity.dataTableId, entity]),
      );
      const keysByTable = new Map<number, string[]>();
      for (const field of fields) {
        const list = keysByTable.get(field.tableId) || [];
        list.push(field.fieldKey);
        keysByTable.set(field.tableId, list);
      }
      for (const row of rows) {
        const entity = entityByTable.get(row.tableId);
        if (!entity) continue;
        const data = jsonObject(row.data);
        if (
          !rowAllowed(access, entity.id, { data, createdBy: row.createdBy })
        ) {
          continue;
        }
        if (keyword && !rowKeyword(data).includes(keyword)) continue;
        out.push({
          targetType: 'LOWCODE_ROW',
          id: `${project.id}:${entity.id}:${row.id}`,
          title: firstTextValue(
            data,
            keysByTable.get(row.tableId) || [],
            `记录 #${row.id}`,
          ),
          subtitle: `${project.name} / ${entity.name}`,
          amount: 0,
        });
        if (out.length >= SEARCH_LIMIT) return out;
      }
    }
    return out;
  }

  private async lowcodeSnapshot(
    org: OaOrgRef,
    user: CurrentUser,
    targetId: string,
  ): Promise<OaRefSnapshot | null> {
    const parts = targetId.split(':');
    if (parts.length !== 3) return null;
    const projectId = asId(parts[0]);
    const entityId = asId(parts[1]);
    const rowId = asId(parts[2]);
    if (projectId <= 0 || entityId <= 0 || rowId <= 0) return null;
    const project = await this.prisma.lowCodeProject.findFirst({
      where: { id: projectId, status: 'ACTIVE' },
    });
    if (!project) return null;
    let access: AccessContext;
    try {
      access = await this.lowcodeAccess.resolve(user, projectId);
    } catch {
      return null;
    }
    const entity = await this.prisma.lowCodeEntity.findFirst({
      where: { id: entityId, projectId },
    });
    if (!entity) return null;
    if (!hasEntityAction(access, entity.id, 'read')) return null;
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId: entity.dataTableId },
    });
    if (!row) return null;
    const data = jsonObject(row.data);
    if (!rowAllowed(access, entity.id, { data, createdBy: row.createdBy })) {
      return null;
    }
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId: entity.dataTableId },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      targetType: 'LOWCODE_ROW',
      targetId,
      title: firstTextValue(
        data,
        fields.map((field) => field.fieldKey),
        `记录 #${row.id}`,
      ),
      subtitle: `${project.name} / ${entity.name}`,
      amount: 0,
    };
  }

  /** 多维表格目标只看独立表：内建应用的表走 LOWCODE_ROW，避免同一行两套口径。 */
  private async readableTableIds(user: CurrentUser) {
    const tables = await this.dataTables.list(user);
    return tables.filter((table) => table.can.read && !table.projectId);
  }

  private async searchDataTable(
    user: CurrentUser,
    keyword: string,
  ): Promise<OaLinkSearchItem[]> {
    const tables = (await this.readableTableIds(user)).slice(
      0,
      PROJECT_SCAN_LIMIT,
    );
    if (!tables.length) return [];
    const ids = tables.map((table) => table.id);
    const [fields, rows] = await Promise.all([
      this.prisma.dataTableField.findMany({
        where: { tableId: { in: ids } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.dataTableRow.findMany({
        where: { tableId: { in: ids } },
        orderBy: { id: 'desc' },
        take: ROW_SCAN_LIMIT,
      }),
    ]);
    const nameByTable = new Map(tables.map((table) => [table.id, table.name]));
    const keysByTable = new Map<number, string[]>();
    for (const field of fields) {
      const list = keysByTable.get(field.tableId) || [];
      list.push(field.fieldKey);
      keysByTable.set(field.tableId, list);
    }
    const out: OaLinkSearchItem[] = [];
    for (const row of rows) {
      if (keyword && !rowKeyword(jsonObject(row.data)).includes(keyword))
        continue;
      out.push({
        targetType: 'DATA_TABLE_ROW',
        id: `${row.tableId}:${row.id}`,
        title: firstTextValue(
          jsonObject(row.data),
          keysByTable.get(row.tableId) || [],
          `记录 #${row.id}`,
        ),
        subtitle: nameByTable.get(row.tableId) || '',
        amount: 0,
      });
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }

  private async dataTableSnapshot(
    user: CurrentUser,
    targetId: string,
  ): Promise<OaRefSnapshot | null> {
    const parts = targetId.split(':');
    if (parts.length !== 2) return null;
    const tableId = asId(parts[0]);
    const rowId = asId(parts[1]);
    if (tableId <= 0 || rowId <= 0) return null;
    const readable = await this.readableTableIds(user);
    const table = readable.find((item) => item.id === tableId);
    if (!table) return null;
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId },
    });
    if (!row) return null;
    return {
      targetType: 'DATA_TABLE_ROW',
      targetId,
      title: firstTextValue(
        jsonObject(row.data),
        table.fields.map((field) => field.fieldKey),
        `记录 #${row.id}`,
      ),
      subtitle: table.name,
      amount: 0,
    };
  }

  /** ref 字段的表单值 → 关联对象（单值或数组）。 */
  refsOfField(fieldValue: unknown, targetType: string) {
    const list = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    return list
      .map((item) => {
        const row = jsonObject(item);
        if (Object.keys(row).length) {
          const type = text(row.targetType) || targetType;
          const id = text(row.id ?? row.targetId);
          return type && id ? { targetType: type, targetId: id } : null;
        }
        const id = text(item);
        return targetType && id ? { targetType, targetId: id } : null;
      })
      .filter((item): item is { targetType: string; targetId: string } =>
        Boolean(item),
      );
  }
}
