import type {
  OaApplication,
  OaApplicationSummary,
  OaCc,
  OaField,
  OaInbox,
  OaLink,
  OaLinkageRule,
  OaLinkSearchItem,
  OaLinkTarget,
  OaOrg,
  OaOverview,
  OaRecord,
  OaSettings,
  OaTask,
  OaTemplate,
  OaTemplateSummary,
  OaWorkspace,
} from '@enterprise/contracts';
import {
  OA_APPLICATION_STATUS_LABELS,
  OA_APPROVAL_MODE_LABELS,
  OA_RECORD_ACTION_LABELS,
  OA_TASK_STATUS_LABELS,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CurrentUser } from '../auth/current-user';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { allocateNo } from '../common/document-number';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContentMediaService } from '../content/content-media.service';
import { asFrozenNodes, OaFlowService, type OaFrozenNode } from './oa.flow';
import {
  amountOf,
  asArray,
  asFields,
  asFlowNodes,
  asId,
  asLinkageRules,
  asString,
  conditionHit,
  csvLine,
  dateEdge,
  EXPORT_LIMIT,
  int,
  iso,
  jsonArray,
  jsonObject,
  missingRequired,
  num,
  round,
  statusLabel,
} from './oa.helpers';
import { OaInboxService } from './oa.inbox';
import {
  OaLinkageService,
  type OaLinkExecution,
  type OaRefSnapshot,
} from './oa.linkage';
import { defaultSettings, OaScopeService, type OaContext } from './oa.scope';
import { OaTemplateService } from './oa.templates';

/** 单人待办／已办／抄送的扫描上限：先按人取（有索引），再按组织过滤，避免整组织全扫。 */
const PERSON_SCAN_LIMIT = 2000;
/** 统计与超时扫描一次最多读多少张在途单据。 */
const APP_SCAN_LIMIT = 2000;
const ACTED_TASK_STATUSES = ['APPROVED', 'REJECTED', 'TRANSFERRED'];
/** 已删除模板的历史单据仍要能列出来，模板名给固定中文而不是裸 id。 */
const GONE_TEMPLATE_NAME = '已删除模板';

/** 单据级关联对象与模板联动规则一起冻结在 linkageSnapshot 里。 */
type OaLinkState = { rules: OaLinkageRule[]; targets: OaRefSnapshot[] };

const asLinkState = (value: unknown): OaLinkState => {
  const row = jsonObject(value);
  return {
    rules: asLinkageRules(row.rules),
    targets: jsonArray(row.targets)
      .map((item) => {
        const ref = jsonObject(item);
        const targetType = asString(ref.targetType, 32);
        const targetId = asString(ref.targetId, 64);
        if (!targetType || !targetId) return null;
        return {
          targetType,
          targetId,
          title: asString(ref.title, 120),
          subtitle: asString(ref.subtitle, 200),
          amount: round(num(ref.amount, 0)),
        } satisfies OaRefSnapshot;
      })
      .filter((item): item is OaRefSnapshot => Boolean(item)),
  };
};

const linkState = (rules: OaLinkageRule[], targets: OaRefSnapshot[]) =>
  toJsonInput({
    rules,
    targets,
  });

type AppRow = {
  id: number;
  number: string;
  orgType: string;
  orgUserId: string;
  templateId: number;
  templateVersion: number;
  title: string;
  applicantId: string;
  applicantName: string;
  department: string;
  formData: unknown;
  fieldsSnapshot: unknown;
  flowSnapshot: unknown;
  linkageSnapshot: unknown;
  ccUserIds: unknown;
  attachments: unknown;
  amount: Prisma.Decimal | null;
  status: string;
  currentNode: number;
  submittedAt: Date | null;
  finishedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TaskRow = {
  id: number;
  applicationId: number;
  nodeIndex: number;
  nodeName: string;
  approverId: string;
  mode: string;
  status: string;
  action: string;
  comment: string;
  actedAt: Date | null;
  delegatedFrom: string;
  remindedAt: Date | null;
  preReview: unknown;
  createdAt: Date;
};

type CcRow = {
  id: number;
  applicationId: number;
  userId: string;
  readAt: Date | null;
  createdAt: Date;
};

type RecordRow = {
  id: number;
  applicationId: number;
  nodeIndex: number;
  action: string;
  operatorId: string;
  operatorName: string;
  comment: string;
  attachments: unknown;
  createdAt: Date;
};

type TemplateName = { id: number; key: string; name: string };

/**
 * OA 单据与流程引擎。
 *
 * 流程语义：提交时把整条流程冻结成快照并建好首节点任务，之后只看快照与任务；
 * 或签一人同意即推进（其余任务记 SKIPPED），会签全员同意才推进，依次审批按名单顺序
 * 一人批完才建下一人的任务。模板改动只影响新单据，在途单据照快照走完。
 */
export class OaService {
  /** 单据提交成功后的计费钩子（services.ts 装配）：扣费失败不影响提交结果。 */
  pointsChargeSafely?: (
    userId: string,
    code: string,
    quantity: number,
    refId?: string,
  ) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OaScopeService,
    private readonly templates: OaTemplateService,
    private readonly flowEngine: OaFlowService,
    private readonly linkage: OaLinkageService,
    private readonly inbox: OaInboxService,
    private readonly notifications: NotificationService,
    private readonly media: ContentMediaService,
  ) {}

  // =================== 工作区 ===================

  async workspace(user: CurrentUser, query: Record<string, unknown>) {
    const orgs = await this.scope.organizations(user);
    const ctx = await this.scope.resolve(user, query);
    if (!ctx) {
      // 没有可用组织时契约仍要求 current，给一个空组织；界面按 orgs.length 出引导空状态。
      const empty: OaOrg = {
        orgType: '',
        orgUserId: '',
        name: '',
        role: 'MEMBER',
        roleLabel: '',
      };
      return {
        orgs,
        current: empty,
        isAdmin: false,
        canApproveCount: 0,
        unreadCcCount: 0,
      } satisfies OaWorkspace;
    }
    const pending = await this.pendingOf(user, ctx);
    const cc = await this.ccOf(user, ctx);
    return {
      orgs,
      current: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        name: ctx.name,
        role: ctx.role,
        roleLabel: ctx.roleLabel,
      },
      isAdmin: ctx.isAdmin,
      canApproveCount: pending.tasks.length,
      unreadCcCount: cc.rows.filter((row) => !row.readAt).length,
    } satisfies OaWorkspace;
  }

  async overview(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Promise<OaOverview> {
    const ctx = await this.scope.context(user, query);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const org = { orgType: ctx.orgType, orgUserId: ctx.orgUserId };
    const pending = await this.pendingOf(user, ctx);
    const cc = await this.ccOf(user, ctx);
    const [myApproving, doneRows] = await Promise.all([
      this.prisma.oaApplication.count({
        where: { ...org, applicantId: ctx.actorId, status: 'APPROVING' },
      }),
      this.prisma.oaApplication.findMany({
        where: {
          ...org,
          status: { in: ['APPROVED', 'REJECTED'] },
          finishedAt: { gte: monthStart },
        },
        select: { submittedAt: true, finishedAt: true },
        orderBy: { finishedAt: 'desc' },
        take: APP_SCAN_LIMIT,
      }),
    ]);
    const overdue = this.overdueTasks(ctx, pending);
    const handled = doneRows.filter((row) => row.submittedAt && row.finishedAt);
    const avgHandleHours = handled.length
      ? round(
          handled.reduce(
            (sum, row) =>
              sum +
              (row.finishedAt!.getTime() - row.submittedAt!.getTime()) /
                3600000,
            0,
          ) / handled.length,
          1,
        )
      : 0;
    const inboxView = await this.inbox.inbox(user, ctx);
    const otherPendingCount = inboxView.groups
      .filter((group) => group.source !== 'OA')
      .reduce((sum, group) => sum + group.count, 0);
    return {
      todoCount: pending.tasks.length,
      myApprovingCount: myApproving,
      monthDoneCount: doneRows.length,
      avgHandleHours,
      overdueCount: overdue.length,
      unreadCcCount: cc.rows.filter((row) => !row.readAt).length,
      otherPendingCount,
    };
  }

  // =================== 模板 ===================

  async templateList(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Promise<OaTemplateSummary[]> {
    const ctx = await this.scope.context(user, query);
    return this.templates.list(ctx, {
      category: asString(query.category, 16),
      enabledOnly: query.enabledOnly === true,
    });
  }

  async templateDetail(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ): Promise<OaTemplate> {
    const ctx = await this.scope.context(user, query);
    return this.templates.detail(ctx, asId(id));
  }

  async templateSave(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<OaTemplate> {
    const ctx = await this.scope.context(user, body);
    return this.templates.save(ctx, body);
  }

  async templateDelete(user: CurrentUser, id: string) {
    const ctx = await this.templateOrg(user, asId(id));
    await this.templates.remove(ctx, asId(id));
    return { removed: true };
  }

  async templateToggle(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<OaTemplate> {
    const ctx = await this.templateOrg(user, asId(id));
    await this.templates.toggle(ctx, asId(id), body.enabled === true);
    return this.templates.detail(ctx, asId(id));
  }

  async templateCopy(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<OaTemplate> {
    const ctx = await this.templateOrg(user, asId(id));
    return this.templates.copy(
      ctx,
      asId(id),
      asString(body.key, 40),
      asString(body.name, 40),
    );
  }

  // =================== 单据 ===================

  async applications(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user, query);
    const scope = asString(query.scope, 8) || 'MINE';
    const where = await this.appWhere(ctx, query, scope);
    if (!where) {
      const { page, pageSize } = pageParam(
        int(query.page),
        int(query.pageSize),
      );
      return pageOf([], 0, page, pageSize);
    }
    const { page, pageSize, offset } = pageParam(
      int(query.page),
      int(query.pageSize),
    );
    const [rows, total] = await Promise.all([
      this.prisma.oaApplication.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.oaApplication.count({ where }),
    ]);
    const list = await this.summaries(rows, ctx);
    return pageOf(list, total, page, pageSize);
  }

  async applicationDetail(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ): Promise<OaApplication> {
    const { row, ctx } = await this.loadApp(user, id, query);
    await this.assertVisible(ctx, row);
    return this.detailOf(row, ctx);
  }

  async saveDraft(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<OaApplication> {
    const ctx = await this.scope.context(user, body);
    const templateId = int(body.templateId, 0);
    const id = int(body.id, 0);
    const template = id
      ? await this.editableDraft(user, id, ctx)
      : await this.templates.find(ctx, templateId);
    if (!template.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该模板已停用，不能继续填写',
      );
    }
    const fields = asFields(template.fieldsSchema);
    const formData = jsonObject(body.formData);
    const clean: Record<string, unknown> = {};
    for (const field of fields) {
      if (formData[field.key] === undefined) continue;
      clean[field.key] = formData[field.key];
    }
    const docTargets = jsonArray(body.linkTargets)
      .map((item) => {
        const row = jsonObject(item);
        return {
          targetType: asString(row.targetType, 32),
          targetId: asString(row.targetId, 64),
        };
      })
      .filter((item) => item.targetType && item.targetId)
      .slice(0, 20);
    // 关联对象（单据级 + ref 字段）按发起人视角校验：看不到的存不进单据。
    const snapshots = await this.linkage.collect(
      { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
      user,
      this.refsOf(fields, clean, docTargets),
    );
    const ccUserIds = await this.resolveCc(ctx, asArray(body.ccUserIds));
    const attachments = await this.withAssetUrls(
      user,
      jsonArray(body.attachments)
        .map((item) => {
          const row = jsonObject(item);
          const assetId = text(row.id).trim();
          return assetId
            ? {
                id: assetId,
                name: text(row.name).trim().slice(0, 200) || assetId,
                size: Math.max(0, num(row.size, 0)),
              }
            : null;
        })
        .filter((item): item is { id: string; name: string; size: number } =>
          Boolean(item),
        )
        .slice(0, 20),
    );
    const amount = amountOf(clean, fields);
    const title = asString(body.title, 200) || template.name;
    const names = await this.scope.names([ctx.actorId]);
    const data = {
      templateId: template.id,
      templateVersion: template.version,
      title,
      formData: clean as Prisma.InputJsonValue,
      fieldsSnapshot: toJsonInput(fields),
      flowSnapshot: toJsonInput(asFlowNodes(template.flowSchema)),
      linkageSnapshot: linkState(
        asLinkageRules(template.linkageSchema),
        snapshots,
      ),
      ccUserIds: toJsonInput(ccUserIds),
      attachments: toJsonInput(attachments),
      amount: amount || null,
    };
    let applicationId = id;
    if (id) {
      await this.prisma.oaApplication.update({ where: { id }, data });
    } else {
      const number = await allocateNo(
        this.prisma,
        template.numberPrefix || 'OA',
        new Date(),
        { table: 'oa_applications', column: 'number' },
      );
      const created = await this.prisma.oaApplication.create({
        data: {
          ...data,
          number,
          orgType: ctx.orgType,
          orgUserId: ctx.orgUserId,
          applicantId: ctx.actorId,
          applicantName: names.get(ctx.actorId) || ctx.actorId,
          department: ctx.department,
        },
      });
      applicationId = created.id;
      await this.prisma.oaRecord.create({
        data: {
          applicationId: created.id,
          nodeIndex: 0,
          action: 'SYSTEM',
          operatorId: ctx.actorId,
          operatorName: names.get(ctx.actorId) || ctx.actorId,
          comment: '创建草稿',
        },
      });
    }
    const row = (await this.prisma.oaApplication.findUnique({
      where: { id: applicationId },
    })) as AppRow | null;
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '单据不存在');
    return this.detailOf(row, ctx);
  }

  async submit(user: CurrentUser, id: string): Promise<OaApplication> {
    const { row, ctx } = await this.loadApp(user, id);
    if (row.applicantId !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能提交自己发起的单据',
      );
    }
    if (row.status !== 'DRAFT' && row.status !== 'RETURNED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有草稿或已退回的单据可以提交',
      );
    }
    const template = await this.templates.find(ctx, row.templateId);
    const fields = asFields(template.fieldsSchema);
    const rules = asLinkageRules(template.linkageSchema);
    const formData = jsonObject(row.formData);
    const amount = amountOf(formData, fields);
    const missing = missingRequired(fields, formData, amount);
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写必填字段：${missing.join('、')}`,
      );
    }
    const state = asLinkState(row.linkageSnapshot);
    const snapshots = await this.linkage.collect(
      { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
      user,
      this.refsOf(fields, formData, state.targets),
    );
    const frozen = await this.flowEngine.freeze(
      ctx,
      asFlowNodes(template.flowSchema),
      {
        userId: row.applicantId,
        name: row.applicantName,
        department: row.department,
      },
      (node) => conditionHit(node.condition, (name) => formData[name], amount),
    );
    if (frozen.blocking.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `以下审批节点当前无人可派，请先在「OA 设置」补齐：${frozen.blocking.join('、')}`,
      );
    }
    const nodes = frozen.nodes;
    const ccIds = await this.resolveCc(ctx, [
      ...asArray(row.ccUserIds),
      ...nodes.flatMap((node) => node.ccUserIds),
    ]);
    const firstIndex = nodes.findIndex((node) => node.userIds.length);
    const terminal = firstIndex < 0;
    const now = new Date();
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    const opened = terminal ? [] : this.openTasks(row.id, nodes, firstIndex);
    await this.prisma.$transaction(async (tx) => {
      await tx.oaApplication.update({
        where: { id: row.id },
        data: {
          status: terminal ? 'APPROVED' : 'APPROVING',
          currentNode: terminal ? row.currentNode : firstIndex,
          amount: amount || null,
          templateVersion: template.version,
          fieldsSnapshot: fields,
          flowSnapshot: nodes,
          linkageSnapshot: linkState(rules, snapshots),
          submittedAt: row.submittedAt || now,
          finishedAt: terminal ? now : null,
          withdrawnAt: null,
        },
      });
      if (opened.length) {
        await tx.oaTask.createMany({ data: opened });
      }
      if (ccIds.length) {
        await tx.oaCc.createMany({
          data: ccIds.map((userId) => ({ applicationId: row.id, userId })),
          skipDuplicates: true,
        });
      }
      await tx.oaRecord.create({
        data: {
          applicationId: row.id,
          nodeIndex: terminal ? row.currentNode : firstIndex,
          action: 'SUBMIT',
          operatorId: ctx.actorId,
          operatorName: actorName,
          comment: '',
        },
      });
      if (terminal) {
        await tx.oaRecord.create({
          data: {
            applicationId: row.id,
            nodeIndex: row.currentNode,
            action: 'SYSTEM',
            operatorId: ctx.actorId,
            operatorName: actorName,
            comment: '流程无审批节点，提交即通过',
          },
        });
      }
    });
    // 重提按最新规则重建执行台账；已写入的回执留在审计日志里。
    await this.prisma.oaLink.deleteMany({ where: { applicationId: row.id } });
    await this.linkage.createLinks(row.id, rules, snapshots);
    if (this.pointsChargeSafely) {
      await this.pointsChargeSafely(
        row.applicantId,
        'oa',
        1,
        String(row.id),
      ).catch(() => undefined);
    }
    const fresh = (await this.prisma.oaApplication.findUnique({
      where: { id: row.id },
    })) as AppRow;
    if (terminal) {
      await this.notifyOutcome(fresh, 'APPROVED', '');
      await this.runLinks(fresh, ctx, user, 'APPROVED', '');
    } else {
      await this.notifyTasks(fresh, opened);
      if (ccIds.length) {
        await this.notifyOnce(ccIds, {
          title: '抄送你一张 OA 单据',
          body: `${fresh.number} ${fresh.title || ''}`.trim(),
          link: `/oa?tab=cc&id=${fresh.id}`,
          entityType: 'oa_cc_app',
          entityId: fresh.id,
        });
      }
    }
    return this.detailOf(fresh, ctx);
  }

  /**
   * 节点级 AI 预审：只对当前审批人自己这一环跑，用本人「模型设置」里的文本模型，
   * 按节点保存的分身快照与审核原则给建议；结果缓存在 oa_tasks.pre_review。
   * 模型没配好也不挡审批：失败结果原样返回，审批按钮照常可用。
   */
  async preReview(user: CurrentUser, id: string, token?: string) {
    const { row, ctx } = await this.loadApp(user, id);
    if (row.status !== 'APPROVING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单据不在审批中，不需要预审',
      );
    }
    const task = await this.prisma.oaTask.findFirst({
      where: {
        applicationId: row.id,
        approverId: ctx.actorId,
        status: 'PENDING',
      },
      orderBy: { id: 'asc' },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '当前没有轮到你审批');
    }
    const nodes = asFrozenNodes(row.flowSnapshot);
    const node = nodes[task.nodeIndex];
    const config = node?.aiPreReview;
    if (!config?.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个审批节点没有启用 AI 预审',
      );
    }
    const principles = text(config.principles).trim();
    if (!principles) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个审批节点没有填写 AI 预审原则',
      );
    }
    const fields = asFields(row.fieldsSnapshot);
    const formData = jsonObject(row.formData);
    const lines = fields
      .map((field) => {
        const value = formData[field.key];
        const shown = Array.isArray(value)
          ? value
              .map((item) =>
                item && typeof item === 'object'
                  ? text((item as Record<string, unknown>).label) ||
                    text((item as Record<string, unknown>).value)
                  : text(item),
              )
              .filter(Boolean)
              .join('、')
          : text(value);
        return shown ? `${field.label}：${shown}` : '';
      })
      .filter(Boolean);
    const attachments = jsonArray(row.attachments)
      .map((item) => text(jsonObject(item).name))
      .filter(Boolean);
    const persona = text(config.personaText).trim();
    const system = [
      '你是 OA 审批的 AI 预审助手，只给审批人提供参考意见，不替审批人做决定。',
      config.personaName
        ? `语气与表达请遵循数字分身「${config.personaName}」${persona ? `：${persona}` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    const prompt = [
      '请按下面的审核原则预审这笔 OA 单据，输出三段：',
      '1）建议（通过 / 需补充材料 / 驳回）；',
      '2）关键风险与疑点；',
      '3）需要审批人核对的事项。',
      '只依据单据内容与审核原则判断，信息不足时明确写“需补充”。',
      '',
      `单据：${row.title}`,
      `模板：${node?.name || ''}`,
      `申请人：${row.applicantName}${row.department ? `（${row.department}）` : ''}`,
      '',
      '表单内容：',
      lines.length ? lines.join('\n') : '（无）',
      '',
      `附件：${attachments.length ? attachments.join('、') : '无'}`,
      '',
      '审核原则：',
      principles,
    ].join('\n');
    let result;
    try {
      const content = await this.media.chat(
        user,
        token,
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        'text',
      );
      result = {
        status: 'DONE' as const,
        content: content.text.trim().slice(0, 4000),
        personaName: config.personaName,
        model: '',
        generatedAt: new Date().toISOString(),
        error: '',
      };
    } catch (error) {
      result = {
        status: 'FAILED' as const,
        content: '',
        personaName: config.personaName,
        model: '',
        generatedAt: new Date().toISOString(),
        error:
          error instanceof BusinessException
            ? error.message
            : 'AI 预审失败，可稍后重试或直接审批',
      };
    }
    await this.prisma.oaTask.update({
      where: { id: task.id },
      data: { preReview: result },
    });
    return result;
  }

  async withdraw(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const { row, ctx } = await this.loadApp(user, id);
    if (row.applicantId !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能撤销自己发起的单据',
      );
    }
    if (row.status !== 'APPROVING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有审批中的单据可以撤销',
      );
    }
    if (!ctx.settings.allowWithdraw) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '本组织已关闭「审批中允许撤销」，请联系管理员',
      );
    }
    const comment = asString(body.comment, 500);
    const now = new Date();
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    const updated = await this.prisma.oaApplication.updateMany({
      where: { id: row.id, status: 'APPROVING' },
      data: { status: 'WITHDRAWN', withdrawnAt: now, finishedAt: null },
    });
    if (!updated.count) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该单据状态已变化，请刷新后重试',
      );
    }
    await this.prisma.$transaction([
      this.prisma.oaTask.updateMany({
        where: { applicationId: row.id, status: 'PENDING' },
        data: { status: 'SKIPPED', action: 'WITHDRAW' },
      }),
      this.prisma.oaRecord.create({
        data: {
          applicationId: row.id,
          nodeIndex: row.currentNode,
          action: 'WITHDRAW',
          operatorId: ctx.actorId,
          operatorName: actorName,
          comment,
        },
      }),
    ]);
    const approvers = await this.prisma.oaTask.findMany({
      where: { applicationId: row.id },
      select: { approverId: true },
    });
    await this.notifyOnce(
      [...new Set(approvers.map((item) => item.approverId))],
      {
        title: '一张 OA 单据已撤销',
        body: `${row.number} ${row.title || ''} 已由发起人撤销`.trim(),
        link: `/oa?tab=my&id=${row.id}`,
        entityType: 'oa_withdraw',
        entityId: row.id,
      },
    );
    const fresh = (await this.prisma.oaApplication.findUnique({
      where: { id: row.id },
    })) as AppRow;
    return this.detailOf(fresh, ctx);
  }

  async deleteDraft(user: CurrentUser, id: string) {
    const { row, ctx } = await this.loadApp(user, id);
    if (row.applicantId !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己发起的草稿',
      );
    }
    if (row.status !== 'DRAFT') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有草稿可以删除，提交后的单据只留痕',
      );
    }
    await this.prisma.$transaction([
      this.prisma.oaTask.deleteMany({ where: { applicationId: row.id } }),
      this.prisma.oaRecord.deleteMany({ where: { applicationId: row.id } }),
      this.prisma.oaCc.deleteMany({ where: { applicationId: row.id } }),
      this.prisma.oaLink.deleteMany({ where: { applicationId: row.id } }),
      this.prisma.oaApplication.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  async export(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user, query);
    this.scope.requireAdmin(ctx);
    const where = await this.appWhere(ctx, query, 'ALL');
    const rows = where
      ? ((await this.prisma.oaApplication.findMany({
          where,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          take: EXPORT_LIMIT + 1,
        })) as AppRow[])
      : [];
    const truncated = rows.length > EXPORT_LIMIT;
    const list = rows.slice(0, EXPORT_LIMIT);
    const summaries = await this.summaries(list, ctx);
    const lines = [
      csvLine([
        '单号',
        '模板',
        '标题',
        '申请人',
        '部门',
        '金额',
        '状态',
        '当前节点',
        '提交时间',
        '完成时间',
      ]),
    ];
    for (const item of summaries) {
      lines.push(
        csvLine([
          item.number,
          item.templateName,
          item.title,
          item.applicantName,
          item.department,
          item.amount,
          item.statusLabel,
          [
            item.currentNodeName,
            item.currentApprovers.map((approver) => approver.name).join('、'),
          ]
            .filter(Boolean)
            .join(' · ') || (item.status === 'DRAFT' ? '未提交' : '已结束'),
          item.submittedAt,
          item.finishedAt,
        ]),
      );
    }
    if (truncated) {
      lines.push(
        csvLine([`仅导出前 ${EXPORT_LIMIT} 条，请缩小筛选范围后再次导出`]),
      );
    }
    return {
      filename: `OA-单据-${new Date().toISOString().slice(0, 10)}.csv`,
      content: `\uFEFF${lines.join('\r\n')}`,
      rows: list.length,
      truncated,
    };
  }

  // =================== 审批 ===================

  async tasks(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user, query);
    const pending = await this.pendingOf(user, ctx);
    const matched = this.filterByApp(pending.tasks, pending.apps, query);
    return this.taskPage(matched, pending.apps, ctx, query);
  }

  async done(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user, query);
    const mine = (await this.prisma.oaTask.findMany({
      where: { approverId: user.userId, status: { in: ACTED_TASK_STATUSES } },
      orderBy: { id: 'desc' },
      take: PERSON_SCAN_LIMIT,
    })) as TaskRow[];
    const apps = await this.appsOf(mine, ctx, false);
    const matched = this.filterByApp(mine, apps, query).sort(
      (a, b) => (b.actedAt?.getTime() || 0) - (a.actedAt?.getTime() || 0),
    );
    return this.taskPage(matched, apps, ctx, query);
  }

  async approve(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.actOnTask(user, id, 'APPROVE', asString(body.comment, 500));
  }

  async reject(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const comment = asString(body.comment, 500);
    if (!comment) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '驳回必须填写审批意见',
      );
    }
    return this.actOnTask(user, id, 'REJECT', comment);
  }

  async returnTask(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const comment = asString(body.comment, 500);
    if (!comment) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '退回必须填写退回原因',
      );
    }
    return this.actOnTask(user, id, 'RETURN', comment);
  }

  async transfer(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<OaApplication> {
    const { task, row, ctx } = await this.loadTask(user, id);
    this.assertActionable(task, row, ctx);
    const target = await this.scope.requireOrgMember(
      ctx,
      asString(body.targetUserId, 64),
    );
    if (target === ctx.actorId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能转交给自己');
    }
    const comment = asString(body.comment, 500);
    const now = new Date();
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    const guard = await this.prisma.oaTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: {
        status: 'TRANSFERRED',
        action: 'TRANSFER',
        comment,
        actedAt: now,
      },
    });
    if (!guard.count) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务已处理，请刷新后重试',
      );
    }
    const created = await this.prisma.oaTask.create({
      data: {
        applicationId: row.id,
        nodeIndex: task.nodeIndex,
        nodeName: task.nodeName,
        approverId: target,
        mode: task.mode,
        status: 'PENDING',
        delegatedFrom: ctx.actorId,
      },
    });
    await this.prisma.oaRecord.create({
      data: {
        applicationId: row.id,
        nodeIndex: task.nodeIndex,
        action: 'TRANSFER',
        operatorId: ctx.actorId,
        operatorName: actorName,
        comment: [
          `转交给 ${(await this.names([target])).get(target) || target}`,
          comment,
        ]
          .filter(Boolean)
          .join('：'),
      },
    });
    await this.notifications.notify(target, {
      category: 'oa',
      title: '一张 OA 单据转交给你',
      body: `${row.number} ${row.title || ''}`.trim(),
      link: `/oa?tab=todo&id=${row.id}`,
      entityType: 'oa_task',
      entityId: created.id,
    });
    return this.detailOf(row, ctx);
  }

  async addSign(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<OaApplication> {
    const { task, row, ctx } = await this.loadTask(user, id);
    this.assertActionable(task, row, ctx);
    const targets: string[] = [];
    for (const item of asArray(body.userIds).slice(0, 10)) {
      targets.push(await this.scope.requireOrgMember(ctx, item));
    }
    const roster = [...new Set(targets)].filter((item) => item !== ctx.actorId);
    if (!roster.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要加签的审批人',
      );
    }
    const comment = asString(body.comment, 500);
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    const existing = await this.prisma.oaTask.findMany({
      where: { applicationId: row.id, nodeIndex: task.nodeIndex },
      select: { approverId: true },
    });
    const covered = new Set(existing.map((item) => item.approverId));
    const added = roster.filter((item) => !covered.has(item));
    const nodes = asFrozenNodes(row.flowSnapshot);
    if (nodes[task.nodeIndex]) {
      nodes[task.nodeIndex] = {
        ...nodes[task.nodeIndex],
        userIds: [...nodes[task.nodeIndex].userIds, ...added],
        mode: 'ALL',
      };
    }
    await this.prisma.$transaction([
      this.prisma.oaApplication.update({
        where: { id: row.id },
        data: { flowSnapshot: nodes },
      }),
      this.prisma.oaTask.updateMany({
        where: { applicationId: row.id, nodeIndex: task.nodeIndex },
        data: { mode: 'ALL' },
      }),
      this.prisma.oaTask.createMany({
        data: added.map((approverId) => ({
          applicationId: row.id,
          nodeIndex: task.nodeIndex,
          nodeName: task.nodeName,
          approverId,
          mode: 'ALL',
          status: 'PENDING',
        })),
      }),
      this.prisma.oaRecord.create({
        data: {
          applicationId: row.id,
          nodeIndex: task.nodeIndex,
          action: 'ADD_SIGN',
          operatorId: ctx.actorId,
          operatorName: actorName,
          comment: [`加签 ${added.length} 人，本节点改为会签`, comment]
            .filter(Boolean)
            .join('：'),
        },
      }),
    ]);
    await this.notifyTasks(
      row,
      added.map((approverId) => ({ approverId })),
      '有人申请你加签审批',
    );
    return this.detailOf(row, ctx);
  }

  // =================== 抄送 / 流水 / 评论 ===================

  async cc(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user, query);
    const { rows, apps } = await this.ccOf(user, ctx);
    const keyword = asString(query.keyword, 60).toLowerCase();
    const matched = rows.filter((row) => {
      const app = apps.find((item) => item.id === row.applicationId);
      if (!app) return false;
      if (!keyword) return true;
      return `${app.number} ${app.title} ${app.applicantName}`
        .toLowerCase()
        .includes(keyword);
    });
    const { page, pageSize, offset } = pageParam(
      int(query.page),
      int(query.pageSize),
    );
    const slice = matched.slice(offset, offset + pageSize);
    const names = await this.names([
      ...new Set(slice.map((row) => row.userId).filter(Boolean)),
    ]);
    const list: OaCc[] = slice.map((row) => {
      const app = apps.find((item) => item.id === row.applicationId)!;
      return {
        id: row.id,
        applicationId: row.applicationId,
        number: app.number,
        title: app.title,
        applicantName: app.applicantName,
        department: app.department,
        amount: round(num(app.amount, 0)),
        status: app.status,
        statusLabel: statusLabel(OA_APPLICATION_STATUS_LABELS, app.status),
        readAt: iso(row.readAt),
        createdAt: iso(row.createdAt),
        userId: row.userId,
        userName: names.get(row.userId) || row.userId,
      };
    });
    return pageOf(list, matched.length, page, pageSize);
  }

  async readCc(user: CurrentUser, id: string) {
    const row = await this.prisma.oaCc.findUnique({ where: { id: asId(id) } });
    if (!row || row.userId !== user.userId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '抄送记录不存在');
    }
    if (!row.readAt) {
      await this.prisma.oaCc.update({
        where: { id: row.id },
        data: { readAt: new Date() },
      });
    }
    return { read: true };
  }

  async records(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ): Promise<OaRecord[]> {
    const { row, ctx } = await this.loadApp(user, id, query);
    await this.assertVisible(ctx, row);
    return this.recordsOf(row.id);
  }

  async comment(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<OaRecord[]> {
    const { row, ctx } = await this.loadApp(user, id);
    await this.assertVisible(ctx, row);
    const comment = asString(body.comment, 1000);
    if (!comment) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写评论内容');
    }
    const attachments = await this.withAssetUrls(
      user,
      jsonArray(body.attachments)
        .map((item) => {
          const row2 = jsonObject(item);
          return {
            id: asString(row2.id, 120),
            name: asString(row2.name, 200),
            // 附件大小以 MB 记（数字资产的 fileSize），取整会把不足 1 MB 的附件显示成「大小未知」。
            size: round(num(row2.size, 0), 2),
          };
        })
        .filter((item) => item.id)
        .slice(0, 20),
    );
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    await this.prisma.oaRecord.create({
      data: {
        applicationId: row.id,
        nodeIndex: row.currentNode,
        action: 'COMMENT',
        operatorId: ctx.actorId,
        operatorName: actorName,
        comment,
        attachments: attachments,
      },
    });
    return this.recordsOf(row.id);
  }

  // =================== 联动 ===================

  linkTargets(): OaLinkTarget[] {
    return this.linkage.targets();
  }

  async linkSearch(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Promise<OaLinkSearchItem[]> {
    const ctx = await this.scope.context(user, query);
    const org = { orgType: ctx.orgType, orgUserId: ctx.orgUserId };
    const targetType = asString(query.targetType, 32);
    const targetId = asString(query.targetId, 120);
    if (targetId) {
      return this.linkage.searchOne(org, user, targetType, targetId);
    }
    return this.linkage.search(
      org,
      user,
      targetType,
      asString(query.keyword, 60),
    );
  }

  async retryLink(
    user: CurrentUser,
    id: string,
    linkId: string,
  ): Promise<OaLink[]> {
    const { row, ctx } = await this.loadApp(user, id);
    this.scope.requireAdmin(ctx);
    const link = await this.prisma.oaLink.findFirst({
      where: { id: asId(linkId), applicationId: row.id },
    });
    if (!link) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '联动记录不存在');
    }
    if (link.status !== 'FAILED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有执行失败的联动可以重试',
      );
    }
    const outcome = row.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    const names = await this.names([row.applicantId, ctx.actorId]);
    await this.linkage.retry(
      link,
      this.executionOf(row, ctx, user, outcome, '', names),
    );
    return this.linksOf(row.id);
  }

  async approvalInbox(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Promise<OaInbox> {
    const ctx = await this.scope.context(user, query);
    return this.inbox.inbox(user, ctx);
  }

  // =================== 设置 ===================

  async settings(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Promise<OaSettings> {
    const ctx = await this.scope.context(user, query);
    const members = await this.scope.members(ctx);
    const [departments, positions, personas] = await Promise.all([
      this.prisma.orgDepartment.findMany({
        where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true, description: true },
      }),
      this.prisma.orgPosition.findMany({
        where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true, description: true },
      }),
      this.prisma.contentAgentPersona.findMany({
        where: { userId: ctx.actorId },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, style: true, persona: true },
      }),
    ]);
    return {
      adminUserIds: ctx.settings.adminUserIds,
      deptHeads: ctx.settings.deptHeads,
      remindAfterHours: ctx.settings.remindAfterHours,
      allowWithdraw: ctx.settings.allowWithdraw,
      members,
      departments,
      positions,
      personas,
      isOwner: ctx.isOwner,
    };
  }

  async saveSettings(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<OaSettings> {
    const ctx = await this.scope.context(user, body);
    this.scope.requireAdmin(ctx);
    const current = ctx.settings;
    const adminUserIds =
      body.adminUserIds === undefined
        ? current.adminUserIds
        : await Promise.all(
            asArray(body.adminUserIds).map((id) =>
              this.scope.requireOrgMember(ctx, id),
            ),
          );
    const deptHeads = await this.readDeptHeads(
      ctx,
      body.deptHeads,
      current.deptHeads,
    );
    const remindAfterHours =
      body.remindAfterHours === undefined
        ? current.remindAfterHours
        : Math.min(Math.max(int(body.remindAfterHours, 24), 0), 720);
    const allowWithdraw =
      body.allowWithdraw === undefined
        ? current.allowWithdraw
        : Boolean(body.allowWithdraw);
    await this.scope.saveSettings(ctx.orgType, ctx.orgUserId, {
      adminUserIds: [...new Set(adminUserIds.filter(Boolean))],
      deptHeads,
      remindAfterHours,
      allowWithdraw,
    });
    return this.settings(user, {
      orgType: ctx.orgType,
      orgUserId: ctx.orgUserId,
    });
  }

  // =================== 超时提醒（调度器调用） ===================

  /** 节点阈值优先，节点缺失时回落到组织设置；0＝不提醒。 */
  private remindSpan(node: OaFrozenNode | undefined, fallbackHours: number) {
    const hours = node ? node.remindAfterHours : fallbackHours;
    return hours > 0 ? hours * 3600000 : 0;
  }

  /** 我已停留超时的待办任务，用于统计条「今日超时提醒 n 条」。 */
  private overdueTasks(
    ctx: OaContext,
    pending: { tasks: TaskRow[]; apps: AppRow[] },
  ): TaskRow[] {
    const apps = new Map(pending.apps.map((row) => [row.id, row]));
    const now = Date.now();
    return pending.tasks.filter((task) => {
      const app = apps.get(task.applicationId);
      if (!app || task.nodeIndex !== app.currentNode) return false;
      const span = this.remindSpan(
        asFrozenNodes(app.flowSnapshot)[task.nodeIndex],
        ctx.settings.remindAfterHours,
      );
      return span > 0 && now - task.createdAt.getTime() >= span;
    });
  }

  /** 节点停留超过阈值的在途任务给当前处理人推一次提醒；返回提醒条数。 */
  async runReminders() {
    const apps = (await this.prisma.oaApplication.findMany({
      where: { status: 'APPROVING' },
      orderBy: { id: 'desc' },
      take: APP_SCAN_LIMIT,
    })) as AppRow[];
    if (!apps.length) return 0;
    const tasks = (await this.prisma.oaTask.findMany({
      where: {
        applicationId: { in: apps.map((row) => row.id) },
        status: 'PENDING',
        remindedAt: null,
      },
      orderBy: { id: 'asc' },
      take: PERSON_SCAN_LIMIT,
    })) as TaskRow[];
    const appMap = new Map(apps.map((row) => [row.id, row]));
    const settingsCache = new Map<string, number>();
    const now = Date.now();
    let sent = 0;
    for (const task of tasks) {
      const app = appMap.get(task.applicationId);
      if (!app || task.nodeIndex !== app.currentNode) continue;
      const node = asFrozenNodes(app.flowSnapshot)[task.nodeIndex];
      const key = `${app.orgType}:${app.orgUserId}`;
      if (!settingsCache.has(key)) {
        const settings = await this.scope.settings(app.orgType, app.orgUserId);
        settingsCache.set(key, settings.remindAfterHours);
      }
      const span = this.remindSpan(
        node,
        settingsCache.get(key) ?? defaultSettings().remindAfterHours,
      );
      if (!span || now - task.createdAt.getTime() < span) continue;
      const hours = Math.round(span / 3600000);
      await this.notifications.notify(task.approverId, {
        category: 'oa',
        level: 'warning',
        title: 'OA 审批超时提醒',
        body: `${app.number} ${app.title || ''}「${task.nodeName}」已停留超过 ${hours} 小时`.trim(),
        link: `/oa?tab=todo&id=${app.id}`,
        entityType: 'oa_remind',
        entityId: task.id,
      });
      await this.prisma.oaTask.update({
        where: { id: task.id },
        data: { remindedAt: new Date() },
      });
      sent += 1;
    }
    return sent;
  }

  // =================== 内部：读取与校验 ===================

  private async names(ids: string[]) {
    return this.scope.names(ids);
  }

  /** 单据在哪个组织就在哪个组织下鉴权；非成员按 404，不泄露存在性。 */
  private async orgOf(
    user: CurrentUser,
    row: { orgType: string; orgUserId: string },
    message: string,
  ): Promise<OaContext> {
    if (!row.orgType || !row.orgUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, message);
    }
    const ctx = await this.scope.resolve(user, {
      orgType: row.orgType,
      orgUserId: row.orgUserId,
    });
    if (!ctx) throw new BusinessException(ErrorCode.NOT_FOUND, message);
    return ctx;
  }

  private async loadApp(
    user: CurrentUser,
    id: string,
    query?: Record<string, unknown>,
  ): Promise<{ row: AppRow; ctx: OaContext }> {
    const row = (await this.prisma.oaApplication.findFirst({
      where: query
        ? { id: asId(id), ...this.orgOfQuery(query) }
        : { id: asId(id) },
    })) as AppRow | null;
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '单据不存在');
    // 授权上下文一律以单据所属组织为准（设计方案 §四）：query 里的组织只用来收窄查找，
    // 不能拿调用者默认组织的管理员身份去判断别家组织的单据。非成员按 404，不泄露存在性。
    const ctx = await this.orgOf(user, row, '单据不存在');
    return { row, ctx };
  }

  private orgOfQuery(query: Record<string, unknown>) {
    const orgType = asString(query.orgType, 16).toUpperCase();
    const orgUserId = asString(query.orgUserId, 64);
    return orgType && orgUserId ? { orgType, orgUserId } : {};
  }

  private async loadTask(
    user: CurrentUser,
    id: string,
  ): Promise<{ task: TaskRow; row: AppRow; ctx: OaContext }> {
    const task = await this.prisma.oaTask.findUnique({
      where: { id: asId(id) },
    });
    if (!task)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批任务不存在');
    const row = (await this.prisma.oaApplication.findUnique({
      where: { id: task.applicationId },
    })) as AppRow | null;
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批任务不存在');
    const ctx = await this.orgOf(user, row, '审批任务不存在');
    return { task, row, ctx };
  }

  private async templateOrg(user: CurrentUser, id: number) {
    const row = await this.prisma.oaTemplate.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模板不存在');
    }
    return this.orgOf(user, row, '模板不存在');
  }

  private async assertVisible(ctx: OaContext, row: AppRow) {
    if (ctx.isAdmin || row.applicantId === ctx.actorId) return;
    const [task, cc] = await Promise.all([
      this.prisma.oaTask.count({
        where: { applicationId: row.id, approverId: ctx.actorId },
      }),
      this.prisma.oaCc.count({
        where: { applicationId: row.id, userId: ctx.actorId },
      }),
    ]);
    if (task || cc) return;
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      '这张单据与你无关，只有发起人、审批人、抄送人和组织管理员可以查看',
    );
  }

  private assertActionable(task: TaskRow, row: AppRow, ctx: OaContext) {
    if (task.approverId !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有该任务的审批人可以操作，管理员不代批（卡住请用转交或加签）',
      );
    }
    if (task.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该任务已处理');
    }
    if (row.status !== 'APPROVING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该单据当前不在审批中',
      );
    }
  }

  /** 或签/会签看本人任务，依次审批只有排在最前面的人才轮到。 */
  private actionable(
    row: AppRow,
    tasks: TaskRow[],
    actorId: string,
  ): TaskRow | null {
    if (row.status !== 'APPROVING') return null;
    const pending = tasks
      .filter(
        (task) =>
          task.status === 'PENDING' && task.nodeIndex === row.currentNode,
      )
      .sort((a, b) => a.id - b.id);
    const mine = pending.filter((task) => task.approverId === actorId);
    if (!mine.length) return null;
    if (mine[0].mode === 'SEQUENTIAL') {
      return pending[0].approverId === actorId ? pending[0] : null;
    }
    return mine[0];
  }

  // =================== 内部：动作 ===================

  private async actOnTask(
    user: CurrentUser,
    id: string,
    intent: 'APPROVE' | 'REJECT' | 'RETURN',
    comment: string,
  ): Promise<OaApplication> {
    const { task, row, ctx } = await this.loadTask(user, id);
    this.assertActionable(task, row, ctx);
    const nodes = asFrozenNodes(row.flowSnapshot);
    const node = nodes[task.nodeIndex];
    if (!node) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '流程快照缺少该节点，请联系管理员',
      );
    }
    if (task.nodeIndex !== row.currentNode) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该节点已不是当前处理节点',
      );
    }
    const actorName =
      (await this.names([ctx.actorId])).get(ctx.actorId) || ctx.actorId;
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.oaTask.updateMany({
        where: { id: task.id, status: 'PENDING' },
        data: {
          status: intent === 'APPROVE' ? 'APPROVED' : 'SKIPPED',
          action: intent,
          comment,
          actedAt: now,
        },
      });
      if (!guard.count) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该任务已处理，请刷新后重试',
        );
      }
      const others = (await tx.oaTask.findMany({
        where: {
          applicationId: row.id,
          nodeIndex: task.nodeIndex,
          status: 'PENDING',
        },
      })) as TaskRow[];
      let next: number | null = null;
      let opened: Prisma.OaTaskCreateManyInput[] = [];
      let finished: string | null = null;
      if (intent === 'REJECT') {
        finished = 'REJECTED';
      } else if (intent === 'RETURN') {
        finished = 'RETURNED';
      } else {
        let held = false;
        if (node.mode === 'ANY') {
          await tx.oaTask.updateMany({
            where: {
              applicationId: row.id,
              nodeIndex: task.nodeIndex,
              status: 'PENDING',
            },
            data: { status: 'SKIPPED', action: 'SYSTEM' },
          });
        } else if (node.mode === 'ALL') {
          held = others.length > 0;
        } else {
          held = others.length > 0;
          if (!held) {
            const covered = new Set(
              (
                await tx.oaTask.findMany({
                  where: { applicationId: row.id, nodeIndex: task.nodeIndex },
                  select: { approverId: true },
                })
              ).map((item) => item.approverId),
            );
            const successor = node.userIds.find((uid) => !covered.has(uid));
            if (successor) {
              opened = this.openTasks(row.id, nodes, task.nodeIndex, successor);
            }
          }
        }
        if (!held && !opened.length) {
          next = this.nextNode(nodes, task.nodeIndex);
          opened = this.openTasks(row.id, nodes, next);
        }
        if (!held && next === null && !opened.length) {
          finished = 'APPROVED';
        } else if (next !== null) {
          const moved = await tx.oaApplication.updateMany({
            where: {
              id: row.id,
              status: 'APPROVING',
              currentNode: row.currentNode,
            },
            data: { currentNode: next },
          });
          if (!moved.count) {
            throw new BusinessException(
              ErrorCode.CONFLICT,
              '流程已推进，请刷新后重试',
            );
          }
        }
      }
      if (finished) {
        await tx.oaTask.updateMany({
          where: { applicationId: row.id, status: 'PENDING' },
          data: { status: 'SKIPPED', action: 'SYSTEM' },
        });
        await tx.oaApplication.update({
          where: { id: row.id },
          data: {
            status: finished,
            finishedAt: finished === 'RETURNED' ? null : now,
          },
        });
      }
      await tx.oaRecord.create({
        data: {
          applicationId: row.id,
          nodeIndex: task.nodeIndex,
          action: intent,
          operatorId: ctx.actorId,
          operatorName: actorName,
          comment,
        },
      });
      return { finished, opened, next };
    });
    const fresh = (await this.prisma.oaApplication.findUnique({
      where: { id: row.id },
    })) as AppRow;
    if (outcome.opened.length) {
      await this.notifyTasks(fresh, outcome.opened);
    }
    if (outcome.finished) {
      await this.notifyOutcome(
        fresh,
        outcome.finished,
        intent === 'RETURN' ? comment : '',
      );
    }
    if (outcome.finished === 'APPROVED' || outcome.finished === 'REJECTED') {
      await this.runLinks(
        fresh,
        ctx,
        user,
        outcome.finished,
        intent === 'REJECT' ? comment : '',
      );
    }
    return this.detailOf(fresh, ctx);
  }

  /** 下一个有人的节点序号；没有则 null＝整单通过。 */
  private nextNode(nodes: OaFrozenNode[], from: number): number | null {
    for (let index = from + 1; index < nodes.length; index += 1) {
      if (nodes[index].userIds.length) return index;
    }
    return null;
  }

  /** 建某节点的任务：依次审批只建排在最前面那一位。 */
  private openTasks(
    applicationId: number,
    nodes: OaFrozenNode[],
    index: number | null,
    only?: string,
  ): Prisma.OaTaskCreateManyInput[] {
    if (index === null) return [];
    const node = nodes[index];
    if (!node || !node.userIds.length) return [];
    const roster = only
      ? [only]
      : node.mode === 'SEQUENTIAL'
        ? node.userIds.slice(0, 1)
        : node.userIds;
    return roster.map((approverId) => ({
      applicationId,
      nodeIndex: index,
      nodeName: node.name,
      approverId,
      mode: node.mode,
      status: 'PENDING',
    }));
  }

  // =================== 内部：通知 ===================

  private async notifyTasks(
    row: AppRow,
    tasks: { approverId: string }[],
    title = '待你审批的 OA 单据',
  ) {
    const ids = [
      ...new Set(tasks.map((task) => task.approverId).filter(Boolean)),
    ];
    if (!ids.length) return;
    await this.notifications.notifyMany(ids, {
      category: 'oa',
      title,
      body: `${row.number} ${row.title || ''}（${row.applicantName || row.applicantId}）`.trim(),
      link: `/oa?tab=todo&id=${row.id}`,
      entityType: 'oa_application_todo',
      entityId: row.id,
      level: 'info',
    });
  }

  private async notifyOutcome(row: AppRow, outcome: string, comment: string) {
    const map: Record<string, { title: string; level: 'info' | 'warning' }> = {
      APPROVED: { title: '你的 OA 申请已通过', level: 'info' },
      REJECTED: { title: '你的 OA 申请被驳回', level: 'warning' },
      RETURNED: { title: '你的 OA 申请被退回，请修改后重提', level: 'warning' },
    };
    const view = map[outcome];
    if (!view) return;
    await this.notifications.notify(row.applicantId, {
      category: 'oa',
      title: view.title,
      body: [`${row.number} ${row.title || ''}`.trim(), comment]
        .filter(Boolean)
        .join(' · '),
      link: `/oa?tab=my&id=${row.id}`,
      entityType: `oa_${outcome.toLowerCase()}`,
      entityId: row.id,
      level: view.level,
    });
  }

  private async notifyOnce(
    userIds: string[],
    input: {
      title: string;
      body: string;
      link: string;
      entityType: string;
      entityId: string | number;
    },
  ) {
    for (const userId of [...new Set(userIds.filter(Boolean))]) {
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId,
          entityType: input.entityType,
          entityId: String(input.entityId),
        },
        select: { id: true },
      });
      if (exists) continue;
      await this.notifications.notify(userId, { category: 'oa', ...input });
    }
  }

  // =================== 内部：联动 ===================

  private executionOf(
    row: AppRow,
    ctx: OaContext,
    actor: CurrentUser,
    outcome: string,
    comment: string,
    names: Map<string, string>,
  ): OaLinkExecution {
    return {
      org: { orgType: row.orgType, orgUserId: row.orgUserId },
      applicantId: row.applicantId,
      applicantName:
        names.get(row.applicantId) || row.applicantName || row.applicantId,
      actor,
      actorName: names.get(ctx.actorId) || ctx.actorId,
      number: row.number,
      title: row.title,
      comment,
      outcome,
    };
  }

  /** 审批结果先落库并通知，联动失败只记 FAILED，不回滚主链路。 */
  private async runLinks(
    row: AppRow,
    ctx: OaContext,
    actor: CurrentUser,
    outcome: 'APPROVED' | 'REJECTED',
    comment: string,
  ) {
    const links = await this.prisma.oaLink.findMany({
      where: { applicationId: row.id, status: 'PENDING' },
      orderBy: { id: 'asc' },
    });
    if (!links.length) return;
    const names = await this.names([row.applicantId, ctx.actorId]);
    await this.linkage.run(
      links,
      this.executionOf(row, ctx, actor, outcome, comment, names),
    );
  }

  private refsOf(
    fields: OaField[],
    formData: Record<string, unknown>,
    docTargets: { targetType: string; targetId: string }[],
  ) {
    const refs = [...docTargets];
    for (const field of fields) {
      if (field.type !== 'ref') continue;
      refs.push(
        ...this.linkage.refsOfField(formData[field.key], field.refTarget),
      );
    }
    return refs;
  }

  // =================== 内部：查询与视图 ===================

  private async appWhere(
    ctx: OaContext,
    query: Record<string, unknown>,
    scope: string,
  ): Promise<Prisma.OaApplicationWhereInput | null> {
    const where: Prisma.OaApplicationWhereInput = {
      orgType: ctx.orgType,
      orgUserId: ctx.orgUserId,
    };
    if (scope === 'ALL') this.scope.requireAdmin(ctx);
    if (scope === 'CC') {
      const rows = await this.prisma.oaCc.findMany({
        where: { userId: ctx.actorId },
        select: { applicationId: true },
        take: PERSON_SCAN_LIMIT,
        orderBy: { id: 'desc' },
      });
      if (!rows.length) return null;
      where.id = { in: [...new Set(rows.map((row) => row.applicationId))] };
    }
    if (scope === 'MINE') where.applicantId = ctx.actorId;
    const status = asString(query.status, 16);
    if (status) where.status = status;
    const templateId = int(query.templateId, 0);
    if (templateId > 0) where.templateId = templateId;
    const department = asString(query.department, 64);
    if (department) where.department = department;
    const keyword = asString(query.keyword, 60);
    if (keyword) {
      where.OR = [
        { number: { contains: keyword } },
        { title: { contains: keyword } },
        { applicantName: { contains: keyword } },
      ];
    }
    const from = dateEdge(query.from, false);
    const to = dateEdge(query.to, true);
    if (from || to) {
      const range = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
      where.AND = [
        {
          OR: [{ submittedAt: range }, { submittedAt: null, createdAt: range }],
        },
      ];
    }
    return where;
  }

  /** 当前人的在途任务：先按人取（有索引），再收口到当前组织且在审批中的单据。 */
  private async pendingOf(
    user: CurrentUser,
    ctx: OaContext,
  ): Promise<{ tasks: TaskRow[]; apps: AppRow[] }> {
    const mine = (await this.prisma.oaTask.findMany({
      where: { approverId: user.userId, status: 'PENDING' },
      orderBy: { id: 'desc' },
      take: PERSON_SCAN_LIMIT,
    })) as TaskRow[];
    const apps = await this.appsOf(mine, ctx, true);
    const allowed = new Set(apps.map((row) => row.id));
    return {
      tasks: mine.filter((task) => allowed.has(task.applicationId)),
      apps,
    };
  }

  private async appsOf(
    tasks: { applicationId: number }[],
    ctx: OaContext,
    approvingOnly: boolean,
  ): Promise<AppRow[]> {
    const ids = [...new Set(tasks.map((task) => task.applicationId))];
    if (!ids.length) return [];
    return await this.prisma.oaApplication.findMany({
      where: {
        id: { in: ids },
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        ...(approvingOnly ? { status: 'APPROVING' } : {}),
      },
    });
  }

  private async ccOf(
    user: CurrentUser,
    ctx: OaContext,
  ): Promise<{ rows: CcRow[]; apps: AppRow[] }> {
    const rows = (await this.prisma.oaCc.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
      take: PERSON_SCAN_LIMIT,
    })) as CcRow[];
    const apps = (await this.prisma.oaApplication.findMany({
      where: {
        id: { in: [...new Set(rows.map((row) => row.applicationId))] },
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
      },
    })) as AppRow[];
    const allowed = new Set(apps.map((row) => row.id));
    return { rows: rows.filter((row) => allowed.has(row.applicationId)), apps };
  }

  private filterByApp(
    tasks: TaskRow[],
    apps: AppRow[],
    query: Record<string, unknown>,
  ): TaskRow[] {
    const keyword = asString(query.keyword, 60).toLowerCase();
    const templateId = int(query.templateId, 0);
    const appMap = new Map(apps.map((row) => [row.id, row]));
    return tasks.filter((task) => {
      const app = appMap.get(task.applicationId);
      if (!app) return false;
      if (templateId > 0 && app.templateId !== templateId) return false;
      if (!keyword) return true;
      return `${app.number} ${app.title} ${app.applicantName}`
        .toLowerCase()
        .includes(keyword);
    });
  }

  private async taskPage(
    tasks: TaskRow[],
    apps: AppRow[],
    ctx: OaContext,
    query: Record<string, unknown>,
  ) {
    const { page, pageSize, offset } = pageParam(
      int(query.page),
      int(query.pageSize),
    );
    const slice = tasks.slice(offset, offset + pageSize);
    const appMap = new Map(apps.map((row) => [row.id, row]));
    const names = await this.names([
      ...new Set([
        ...slice.map((task) => task.approverId),
        ...slice
          .map((task) => appMap.get(task.applicationId)?.applicantId || '')
          .filter(Boolean),
      ]),
    ]);
    const templates = await this.templateNames(ctx);
    const list: OaTask[] = slice.map((task) => {
      const app = appMap.get(task.applicationId);
      return {
        id: task.id,
        applicationId: task.applicationId,
        number: app?.number || '',
        title: app?.title || '',
        templateName:
          templates.get(app?.templateId || 0)?.name || GONE_TEMPLATE_NAME,
        applicantName:
          names.get(app?.applicantId || '') ||
          app?.applicantName ||
          app?.applicantId ||
          '',
        department: app?.department || '',
        amount: round(num(app?.amount, 0)),
        nodeIndex: task.nodeIndex,
        nodeName: task.nodeName,
        mode: task.mode,
        modeLabel: statusLabel(OA_APPROVAL_MODE_LABELS, task.mode),
        status: task.status,
        statusLabel: statusLabel(OA_TASK_STATUS_LABELS, task.status),
        submittedAt: iso(app?.submittedAt),
        createdAt: iso(task.createdAt),
        remindedAt: iso(task.remindedAt),
      };
    });
    return pageOf(list, tasks.length, page, pageSize);
  }

  private async templateNames(ctx: OaContext) {
    const rows = await this.prisma.oaTemplate.findMany({
      where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId },
      select: { id: true, key: true, name: true },
    });
    return new Map<number, TemplateName>(rows.map((row) => [row.id, row]));
  }

  private async summaries(
    rows: AppRow[],
    ctx: OaContext,
  ): Promise<OaApplicationSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [templates, pending] = await Promise.all([
      this.templateNames(ctx),
      this.prisma.oaTask.findMany({
        where: { applicationId: { in: ids }, status: 'PENDING' },
        orderBy: { id: 'asc' },
      }),
    ]);
    const names = await this.names([
      ...new Set([
        ...rows.map((row) => row.applicantId),
        ...(pending as TaskRow[]).map((task) => task.approverId),
      ]),
    ]);
    const byApp = new Map<number, TaskRow[]>();
    for (const task of pending as TaskRow[]) {
      const bucket = byApp.get(task.applicationId) || [];
      bucket.push(task);
      byApp.set(task.applicationId, bucket);
    }
    return rows.map((row) => {
      const approvers = (byApp.get(row.id) || []).map((task) => ({
        userId: task.approverId,
        name: names.get(task.approverId) || task.approverId,
      }));
      const template = templates.get(row.templateId);
      return {
        id: row.id,
        number: row.number,
        templateId: row.templateId,
        templateKey: template?.key || '',
        templateName: template?.name || GONE_TEMPLATE_NAME,
        title: row.title,
        applicantId: row.applicantId,
        applicantName:
          names.get(row.applicantId) || row.applicantName || row.applicantId,
        department: row.department,
        amount: round(num(row.amount, 0)),
        status: row.status,
        statusLabel: statusLabel(OA_APPLICATION_STATUS_LABELS, row.status),
        currentNode: row.currentNode,
        currentNodeName:
          row.status === 'APPROVING'
            ? asFrozenNodes(row.flowSnapshot)[row.currentNode]?.name || ''
            : '',
        currentApprovers: row.status === 'APPROVING' ? approvers : [],
        submittedAt: iso(row.submittedAt),
        finishedAt: iso(row.finishedAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };
    });
  }

  private preReviewOf(value: unknown): OaApplication['myPreReview'] {
    const row = jsonObject(value);
    const status = text(row.status);
    const allowed = ['NONE', 'RUNNING', 'DONE', 'FAILED'];
    return {
      status: (allowed.includes(status)
        ? status
        : 'NONE') as OaApplication['myPreReview']['status'],
      content: text(row.content),
      personaName: text(row.personaName),
      model: text(row.model),
      generatedAt: text(row.generatedAt),
      error: text(row.error),
    };
  }

  /**
   * 附件直链由服务端从**上传人自己的**数字资产台账取，随单据一起落库：
   * 审批人、抄送人回看时用的就是这个值，不再依赖他们自己的资产列表（他们查不到发起人的资产）。
   * 台账里找不到（历史数据、外部伪造 id）就留空，界面按「未找到」提示。
   */
  private async withAssetUrls<T extends { id: string }>(
    user: CurrentUser,
    items: T[],
  ) {
    const ids = items
      .map((item) => Number(item.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const urls = new Map<string, string>();
    if (ids.length) {
      const entries = await this.prisma.digitalAssetEntry.findMany({
        where: { userId: user.userId, aipddAssetId: { in: ids } },
        select: { aipddAssetId: true, url: true },
      });
      for (const entry of entries) {
        urls.set(String(entry.aipddAssetId), text(entry.url).slice(0, 2000));
      }
    }
    return items.map((item) => ({ ...item, url: urls.get(item.id) || '' }));
  }

  private async detailOf(row: AppRow, ctx: OaContext): Promise<OaApplication> {
    const fields = asFields(row.fieldsSnapshot);
    const nodes = asFrozenNodes(row.flowSnapshot);
    const [taskRows, ccs, linkRows, templates] = await Promise.all([
      this.prisma.oaTask.findMany({
        where: { applicationId: row.id },
        orderBy: { id: 'asc' },
      }),
      this.prisma.oaCc.findMany({
        where: { applicationId: row.id },
        orderBy: { id: 'asc' },
      }),
      this.prisma.oaLink.findMany({
        where: { applicationId: row.id },
        orderBy: { id: 'asc' },
      }),
      this.templateNames(ctx),
    ]);
    const tasks = taskRows as TaskRow[];
    const actorTask = this.actionable(row, tasks, ctx.actorId);
    const ids = [
      row.applicantId,
      ...tasks.map((task) => task.approverId),
      ...(ccs as CcRow[]).map((item) => item.userId),
      ctx.actorId,
    ];
    const names = await this.names([...new Set(ids.filter(Boolean))]);
    const template = templates.get(row.templateId);
    const finished = row.status !== 'APPROVING';
    const state = asLinkState(row.linkageSnapshot);
    return {
      id: row.id,
      number: row.number,
      templateId: row.templateId,
      templateKey: template?.key || '',
      templateName: template?.name || GONE_TEMPLATE_NAME,
      title: row.title,
      applicantId: row.applicantId,
      applicantName:
        names.get(row.applicantId) || row.applicantName || row.applicantId,
      department: row.department,
      amount: round(num(row.amount, 0)),
      status: row.status,
      statusLabel: statusLabel(OA_APPLICATION_STATUS_LABELS, row.status),
      currentNode: row.currentNode,
      currentNodeName: finished ? '' : nodes[row.currentNode]?.name || '',
      currentApprovers: finished
        ? []
        : tasks
            .filter(
              (task) =>
                task.status === 'PENDING' && task.nodeIndex === row.currentNode,
            )
            .map((task) => ({
              userId: task.approverId,
              name: names.get(task.approverId) || task.approverId,
            })),
      submittedAt: iso(row.submittedAt),
      finishedAt: iso(row.finishedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      formData: jsonObject(row.formData),
      fields,
      attachments: jsonArray(row.attachments)
        .map((item) => {
          const entry = jsonObject(item);
          const assetId = text(entry.id).trim();
          return assetId
            ? {
                id: assetId,
                name: text(entry.name).trim() || assetId,
                size: Math.max(0, num(entry.size, 0)),
                url: text(entry.url).slice(0, 2000),
              }
            : null;
        })
        .filter(
          (
            item,
          ): item is {
            id: string;
            name: string;
            size: number;
            url: string;
          } => Boolean(item),
        ),
      targets: state.targets.map((item) => ({
        targetType: item.targetType,
        id: item.targetId,
        title: item.title,
        subtitle: item.subtitle,
        amount: round(num(item.amount, 0)),
      })),
      cc: (ccs as CcRow[]).map((item) => ({
        id: item.id,
        applicationId: row.id,
        number: row.number,
        title: row.title,
        applicantName: row.applicantName,
        department: row.department,
        amount: round(num(row.amount, 0)),
        status: row.status,
        statusLabel: statusLabel(OA_APPLICATION_STATUS_LABELS, row.status),
        readAt: iso(item.readAt),
        createdAt: iso(item.createdAt),
        userId: item.userId,
        userName: names.get(item.userId) || item.userId,
      })),
      flow: this.flowEngine.steps(
        nodes,
        tasks.map((task) => ({
          nodeIndex: task.nodeIndex,
          approverId: task.approverId,
          status: task.status,
          comment: task.comment,
          actedAt: task.actedAt,
        })),
        names,
        row.currentNode,
        finished,
      ),
      records: await this.recordsOf(row.id),
      links: await this.linksOf(row.id, linkRows),
      myTaskId: actorTask?.id || 0,
      myPreReview: this.preReviewOf(actorTask?.preReview),
      canApprove: Boolean(actorTask),
      canWithdraw:
        row.applicantId === ctx.actorId &&
        row.status === 'APPROVING' &&
        ctx.settings.allowWithdraw,
      canEdit:
        row.applicantId === ctx.actorId &&
        (row.status === 'DRAFT' || row.status === 'RETURNED'),
      canDelete: row.applicantId === ctx.actorId && row.status === 'DRAFT',
    };
  }

  private async recordsOf(applicationId: number): Promise<OaRecord[]> {
    const rows = (await this.prisma.oaRecord.findMany({
      where: { applicationId },
      orderBy: { id: 'asc' },
    })) as RecordRow[];
    return rows.map((row) => ({
      id: row.id,
      nodeIndex: row.nodeIndex,
      action: row.action,
      actionLabel: text(OA_RECORD_ACTION_LABELS[row.action]) || row.action,
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      comment: row.comment,
      attachments: jsonArray(row.attachments).map((item) => {
        const row2 = jsonObject(item);
        return {
          id: text(row2.id),
          name: text(row2.name),
          size: num(row2.size, 0),
          url: text(row2.url).slice(0, 2000),
        };
      }),
      createdAt: iso(row.createdAt),
    }));
  }

  private async linksOf(
    applicationId: number,
    rows?: unknown[],
  ): Promise<OaLink[]> {
    const list =
      rows ||
      (await this.prisma.oaLink.findMany({
        where: { applicationId },
        orderBy: { id: 'asc' },
      }));
    return list.map((item) =>
      this.linkage.dtoOf(item as Parameters<typeof this.linkage.dtoOf>[0]),
    );
  }

  /** 抄送人只保留仍在本组织的成员：人员调动不挡提交，与审批人解析同一口径。 */
  private async resolveCc(ctx: OaContext, ids: string[]) {
    const unique = [...new Set(ids.filter((id) => id && id !== ctx.actorId))];
    if (!unique.length) return [];
    const members = await this.scope.members(ctx);
    const active = new Set(members.map((row) => row.userId));
    active.add(ctx.orgUserId);
    return unique.filter((id) => active.has(id));
  }

  private async editableDraft(user: CurrentUser, id: number, ctx: OaContext) {
    const row = (await this.prisma.oaApplication.findUnique({
      where: { id },
    })) as AppRow | null;
    if (
      !row ||
      row.orgType !== ctx.orgType ||
      row.orgUserId !== ctx.orgUserId
    ) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '单据不存在');
    }
    if (row.applicantId !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能修改自己发起的草稿',
      );
    }
    if (row.status !== 'DRAFT' && row.status !== 'RETURNED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单据已提交，不能修改表单内容',
      );
    }
    return this.templates.find(ctx, row.templateId);
  }

  private async readDeptHeads(
    ctx: OaContext,
    value: unknown,
    current: Record<string, string>,
  ) {
    if (value === undefined) return current;
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(jsonObject(value))) {
      const name = asString(key, 64);
      const userId = asString(raw, 64);
      if (!name) continue;
      if (!userId) continue;
      out[name] = await this.scope.requireOrgMember(ctx, userId);
    }
    return out;
  }
}
