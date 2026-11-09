import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  FORM_TYPE_LABELS,
  int,
  iso,
  jsonArray,
  jsonObject,
  statusLabel,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';
import type { MechanismService } from '../mechanisms/mechanism.service';

type NodeConfig = {
  type?: string;
  name?: string;
  approverType?: string;
  approverIds?: string[];
  role?: string;
  mode?: string;
  condition?: { field?: string; operator?: string; value?: unknown };
  cc?: string[];
  emptyAction?: string;
};

const OPERATORS: Record<string, (left: unknown, right: unknown) => boolean> = {
  eq: (a, b) => String(a) === String(b),
  neq: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a).includes(String(b)),
};

export class CrmApprovalService {
  private mechanisms?: MechanismService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  /** 审批域发出业务事件（订单通过等）；机制服务在装配期后注入，避免构造顺序耦合。 */
  attachMechanisms(mechanisms: MechanismService) {
    this.mechanisms = mechanisms;
  }

  async flows(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmApprovalFlow.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    const versions = await this.prisma.crmApprovalFlowVersion.findMany({
      where: { flowId: { in: rows.map((row) => row.id) } },
    });
    const versionMap = new Map(
      versions.map((row) => [`${row.flowId}:${row.version}`, row]),
    );
    return rows.map((row) => {
      const version = versionMap.get(`${row.id}:${row.currentVersion}`);
      return {
        id: row.id,
        formType: row.formType,
        formTypeLabel: FORM_TYPE_LABELS[row.formType] || row.formType,
        name: row.name,
        enabled: row.enabled,
        currentVersion: row.currentVersion,
        nodes: jsonArray(version?.nodes),
        updatedAt: iso(row.updatedAt),
      };
    });
  }

  async flow(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.prisma.crmApprovalFlow.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '审批流不存在');
    const version = await this.prisma.crmApprovalFlowVersion.findFirst({
      where: { flowId: row.id, version: row.currentVersion },
    });
    return {
      id: row.id,
      formType: row.formType,
      formTypeLabel: FORM_TYPE_LABELS[row.formType] || row.formType,
      name: row.name,
      enabled: row.enabled,
      currentVersion: row.currentVersion,
      nodes: jsonArray(version?.nodes),
      updatedAt: iso(row.updatedAt),
    };
  }

  async saveFlow(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const formType = text(body.formType, 'CONTRACT');
    if (!FORM_TYPE_LABELS[formType]) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '单据类型不正确');
    }
    const nodes = jsonArray(body.nodes);
    if (nodes.length) {
      for (const node of nodes) {
        const config = node as NodeConfig;
        const type = text(config.type, 'APPROVER');
        if (type === 'APPROVER') {
          const approvers = Array.isArray(config.approverIds)
            ? config.approverIds.map((item) => text(item)).filter(Boolean)
            : [];
          const role = text(config.role);
          const approverType = text(config.approverType, 'MEMBER');
          if (approverType === 'MEMBER' && !approvers.length) {
            throw new BusinessException(
              ErrorCode.BAD_REQUEST,
              '审批节点至少选一个审批人',
            );
          }
          if (approverType === 'ROLE' && !role) {
            throw new BusinessException(
              ErrorCode.BAD_REQUEST,
              '按角色审批时请选择角色',
            );
          }
        }
      }
    }
    const name =
      text(body.name).trim().slice(0, 80) ||
      `${FORM_TYPE_LABELS[formType]}审批`;
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const id = int(body.id);
    let flowId = id;
    if (id) {
      const existing = await this.prisma.crmApprovalFlow.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '审批流不存在');
      const updated = await this.prisma.crmApprovalFlow.update({
        where: { id },
        data: {
          formType,
          name,
          enabled,
          currentVersion: existing.currentVersion + 1,
        },
      });
      await this.prisma.crmApprovalFlowVersion.create({
        data: {
          flowId: id,
          version: updated.currentVersion,
          nodes: toJsonInput(nodes),
        },
      });
    } else {
      const created = await this.prisma.crmApprovalFlow.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          formType,
          name,
          enabled,
          currentVersion: 1,
        },
      });
      flowId = created.id;
      await this.prisma.crmApprovalFlowVersion.create({
        data: { flowId, version: 1, nodes: toJsonInput(nodes) },
      });
    }
    return this.flow(user, String(flowId));
  }

  async removeFlow(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmApprovalFlow.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '审批流不存在');
    await this.prisma.crmApprovalFlowVersion.deleteMany({
      where: { flowId: id },
    });
    await this.prisma.crmApprovalFlow.delete({ where: { id } });
    return { removed: true };
  }

  private async targetOf(
    ownerUserId: string,
    formType: string,
    targetId: number,
  ) {
    if (formType === 'LEAD') {
      const row = await this.prisma.crmLead.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? { title: row.name, approvalStatus: row.approvalStatus }
        : null;
    }
    if (formType === 'CUSTOMER') {
      const row = await this.prisma.crmCustomer.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? { title: row.name, approvalStatus: row.approvalStatus }
        : null;
    }
    if (formType === 'OPPORTUNITY') {
      const row = await this.prisma.crmOpportunity.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? { title: row.name, approvalStatus: row.approvalStatus }
        : null;
    }
    if (formType === 'QUOTATION') {
      const row = await this.prisma.crmQuotation.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? { title: row.name, approvalStatus: row.approvalStatus }
        : null;
    }
    if (formType === 'CONTRACT') {
      const row = await this.prisma.crmContract.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? {
            title: `${row.number} ${row.name}`,
            approvalStatus: row.approvalStatus,
          }
        : null;
    }
    if (formType === 'INVOICE') {
      const row = await this.prisma.crmInvoice.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? { title: row.name, approvalStatus: row.approvalStatus }
        : null;
    }
    if (formType === 'ORDER') {
      const row = await this.prisma.crmOrder.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row
        ? {
            title: `${row.number} ${row.name}`,
            approvalStatus: row.approvalStatus,
          }
        : null;
    }
    return null;
  }

  private async setTargetStatus(
    ctx: CrmContext,
    formType: string,
    targetId: number,
    status: string,
  ) {
    const where = { id: targetId, ownerUserId: ctx.ownerUserId };
    if (formType === 'LEAD') {
      await this.prisma.crmLead.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'CUSTOMER') {
      await this.prisma.crmCustomer.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'OPPORTUNITY') {
      await this.prisma.crmOpportunity.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'QUOTATION') {
      await this.prisma.crmQuotation.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'CONTRACT') {
      await this.prisma.crmContract.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'INVOICE') {
      await this.prisma.crmInvoice.updateMany({
        where,
        data: { approvalStatus: status },
      });
    } else if (formType === 'ORDER') {
      await this.prisma.crmOrder.updateMany({
        where,
        data: { approvalStatus: status },
      });
      if (status === 'APPROVED') await this.emitOrderApproved(ctx, targetId);
    }
  }

  /** 订单审批通过：发领域事件，由增长联动（建项目）与自动化规则消费。 */
  private async emitOrderApproved(ctx: CrmContext, orderId: number) {
    if (!this.mechanisms) return;
    const order = await this.prisma.crmOrder.findFirst({
      where: { id: orderId, ownerUserId: ctx.ownerUserId },
      select: {
        id: true,
        number: true,
        name: true,
        customerId: true,
        contractId: true,
        amount: true,
      },
    });
    if (!order) return;
    void this.mechanisms
      .dispatch(
        {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          actorId: ctx.actorId,
          isOwner: ctx.isOwner,
          isAdmin: ctx.isAdmin,
          department: ctx.department,
        },
        'crm.order.approved',
        {
          orderId: order.id,
          number: order.number,
          name: order.name,
          customerId: order.customerId,
          contractId: order.contractId,
          amount: Number(order.amount),
          source: 'crm',
          sourceId: String(order.id),
        },
      )
      .catch(() => undefined);
  }

  async submit(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const formType = text(body.formType, 'CONTRACT');
    const targetId = int(body.targetId);
    const target = await this.targetOf(ctx.ownerUserId, formType, targetId);
    if (!target) throw new BusinessException(ErrorCode.NOT_FOUND, '单据不存在');
    const running = await this.prisma.crmApprovalInstance.findFirst({
      where: {
        ownerUserId: ctx.ownerUserId,
        formType,
        targetId,
        status: { in: ['PENDING', 'APPROVING'] },
      },
    });
    if (running) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个单据已经在审批中',
      );
    }
    const flow = await this.prisma.crmApprovalFlow.findFirst({
      where: { ownerUserId: ctx.ownerUserId, formType, enabled: true },
      orderBy: { id: 'asc' },
    });
    if (!flow) {
      const instance = await this.prisma.crmApprovalInstance.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          formType,
          targetId,
          status: 'APPROVED',
          submitter: ctx.actorId,
          submittedAt: new Date(),
          finishedAt: new Date(),
          snapshot: toJsonInput({ title: target.title, auto: true }),
        },
      });
      await this.setTargetStatus(ctx, formType, targetId, 'APPROVED');
      return this.instanceView(instance, target.title, new Map(), ctx);
    }
    const version = await this.prisma.crmApprovalFlowVersion.findFirst({
      where: { flowId: flow.id, version: flow.currentVersion },
    });
    const nodes = jsonArray(version?.nodes) as NodeConfig[];
    if (!nodes.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '审批流还没有配置审批节点',
      );
    }
    const instance = await this.prisma.crmApprovalInstance.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        formType,
        targetId,
        flowId: flow.id,
        flowVersionId: version?.id || 0,
        status: 'APPROVING',
        submitter: ctx.actorId,
        currentNode: 0,
        submittedAt: new Date(),
        snapshot: toJsonInput({
          title: target.title,
          nodes,
          submittedBy: ctx.actorId,
        }),
      },
    });
    await this.setTargetStatus(ctx, formType, targetId, 'APPROVING');
    const values = await this.valuesOf(ctx.ownerUserId, formType, targetId);
    await this.activateNode(instance.id, 0, nodes, ctx, values);
    await this.settings.log(
      ctx.ownerUserId,
      formType,
      targetId,
      'SUBMIT_APPROVAL',
      {},
      { instanceId: instance.id },
      ctx.actorId,
    );
    return this.instanceView(instance, target.title, new Map(), ctx);
  }

  private async activateNode(
    instanceId: number,
    nodeIndex: number,
    nodes: NodeConfig[],
    ctx: CrmContext,
    values: Record<string, unknown> = {},
  ) {
    let index = nodeIndex;
    const creator = await this.prisma.crmApprovalInstance.findUnique({
      where: { id: instanceId },
      select: { submitter: true },
    });
    const creatorId = creator?.submitter || ctx.actorId;
    while (index < nodes.length) {
      const node = nodes[index];
      if (!this.match(node, values)) {
        index += 1;
        continue;
      }
      const approvers = await this.resolveApprovers(node, ctx, creatorId);
      if (!approvers.length) {
        const action = text(node.emptyAction, 'SKIP');
        if (action === 'ERROR') {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `审批节点「${text(node.name, '审批')}」没有可用审批人`,
          );
        }
        index += 1;
        continue;
      }
      const mode = text(node.mode, 'ALL');
      for (let i = 0; i < approvers.length; i++) {
        await this.prisma.crmApprovalTask.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            instanceId,
            nodeIndex: index,
            nodeName: text(node.name, `第 ${index + 1} 步审批`),
            approverId: approvers[i],
            status: mode === 'SEQUENTIAL' && i > 0 ? 'WAITING' : 'PENDING',
          },
        });
      }
      for (const userId of node.cc || []) {
        if (!userId) continue;
        await this.prisma.crmApprovalCc.upsert({
          where: { instanceId_userId: { instanceId, userId } },
          create: { instanceId, userId },
          update: {},
        });
      }
      await this.prisma.crmApprovalInstance.update({
        where: { id: instanceId },
        data: { currentNode: index, status: 'APPROVING' },
      });
      return;
    }
    await this.prisma.crmApprovalInstance.update({
      where: { id: instanceId },
      data: { status: 'APPROVED', finishedAt: new Date() },
    });
  }

  private async valuesOf(
    ownerUserId: string,
    formType: string,
    targetId: number,
  ) {
    if (formType === 'CONTRACT') {
      const row = await this.prisma.crmContract.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row ? { amount: Number(row.amount), stageId: row.stageId } : {};
    }
    if (formType === 'OPPORTUNITY') {
      const row = await this.prisma.crmOpportunity.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row ? { amount: Number(row.amount), stageId: row.stageId } : {};
    }
    if (formType === 'ORDER') {
      const row = await this.prisma.crmOrder.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row ? { amount: Number(row.amount), stageId: row.stageId } : {};
    }
    if (formType === 'QUOTATION') {
      const row = await this.prisma.crmQuotation.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row ? { amount: Number(row.amount) } : {};
    }
    if (formType === 'LEAD') {
      const row = await this.prisma.crmLead.findFirst({
        where: { id: targetId, ownerUserId },
      });
      return row ? { stage: row.stage } : {};
    }
    return {};
  }

  private match(node: NodeConfig, values: Record<string, unknown>) {
    const condition = node.condition;
    if (!condition?.field) return true;
    const operator = OPERATORS[text(condition.operator, 'eq')];
    if (!operator) return true;
    return operator(values[condition.field], condition.value);
  }

  private async resolveApprovers(
    node: NodeConfig,
    ctx: CrmContext,
    creatorId: string,
  ) {
    const type = text(node.approverType, 'MEMBER');
    if (type === 'CREATOR') return [creatorId];
    if (type === 'ROLE') {
      const rows = await this.prisma.crmMember.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          role: text(node.role),
          status: 'ACTIVE',
        },
      });
      return rows.map((row) => row.memberUserId);
    }
    if (type === 'DEPT_HEAD') {
      const rows = await this.prisma.crmMember.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          department: ctx.department,
          role: { in: ['MANAGER', 'ADMIN'] },
          status: 'ACTIVE',
        },
      });
      return rows.length
        ? rows.map((row) => row.memberUserId)
        : [ctx.ownerUserId];
    }
    const ids = Array.isArray(node.approverIds)
      ? node.approverIds.map((item) => text(item)).filter(Boolean)
      : [];
    if (!ids.length) return [];
    const staff = await this.scope.accountStaff(ctx.ownerUserId);
    const allowed = new Set([
      ctx.ownerUserId,
      ...staff.map((row) => row.memberUserId),
    ]);
    return [...new Set(ids)].filter((id) => allowed.has(id));
  }

  private instanceView(
    row: {
      id: number;
      formType: string;
      targetId: number;
      status: string;
      submitter: string;
      currentNode: number;
      submittedAt: Date | null;
      finishedAt: Date | null;
      createdAt: Date;
      snapshot: unknown;
    },
    title: string,
    names: Map<string, string>,
    ctx: CrmContext,
  ) {
    return {
      id: row.id,
      formType: row.formType,
      formTypeLabel: FORM_TYPE_LABELS[row.formType] || row.formType,
      targetId: row.targetId,
      title,
      status: row.status,
      statusLabel: statusLabel(row.status),
      submitter: row.submitter,
      submitterName:
        names.get(row.submitter) || (row.submitter === ctx.actorId ? '我' : ''),
      currentNode: row.currentNode,
      submittedAt: iso(row.submittedAt),
      finishedAt: iso(row.finishedAt),
      createdAt: iso(row.createdAt),
    };
  }

  private async titlesOf(
    ownerUserId: string,
    rows: Array<{ formType: string; targetId: number }>,
  ) {
    const map = new Map<string, string>();
    for (const row of rows) {
      const target = await this.targetOf(
        ownerUserId,
        row.formType,
        row.targetId,
      );
      map.set(`${row.formType}:${row.targetId}`, target?.title || '');
    }
    return map;
  }

  async instances(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const view = text(query.view, 'all');
    const where: Prisma.CrmApprovalInstanceWhereInput = {
      ownerUserId: ctx.ownerUserId,
    };
    if (query.status) where.status = text(query.status);
    if (view === 'submitted') where.submitter = ctx.actorId;
    if (view === 'mine' || view === 'cc') {
      const [tasks, ccs] = await Promise.all([
        this.prisma.crmApprovalTask.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            approverId: ctx.actorId,
            status:
              view === 'mine' ? 'PENDING' : { in: ['APPROVED', 'REJECTED'] },
          },
          select: { instanceId: true },
        }),
        view === 'cc'
          ? this.prisma.crmApprovalCc.findMany({
              where: { userId: ctx.actorId },
              select: { instanceId: true },
            })
          : Promise.resolve([]),
      ]);
      where.id = {
        in: [...new Set([...tasks, ...ccs].map((row) => row.instanceId))],
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmApprovalInstance.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmApprovalInstance.count({ where }),
    ]);
    const [names, titles] = await Promise.all([
      this.scope.names(rows.map((row) => row.submitter)),
      this.titlesOf(ctx.ownerUserId, rows),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        formType: row.formType,
        formTypeLabel: FORM_TYPE_LABELS[row.formType] || row.formType,
        targetId: row.targetId,
        title: titles.get(`${row.formType}:${row.targetId}`) || '',
        status: row.status,
        statusLabel: statusLabel(row.status),
        submitter: row.submitter,
        submitterName: names.get(row.submitter) || '',
        currentNode: row.currentNode,
        submittedAt: iso(row.submittedAt),
        finishedAt: iso(row.finishedAt),
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async instance(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    const [tasks, records, titles] = await Promise.all([
      this.prisma.crmApprovalTask.findMany({
        where: { instanceId: row.id },
        orderBy: [{ nodeIndex: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.crmApprovalRecord.findMany({
        where: { instanceId: row.id },
        orderBy: { id: 'asc' },
      }),
      this.titlesOf(ctx.ownerUserId, [row]),
    ]);
    const names = await this.scope.names([
      row.submitter,
      ...tasks.map((item) => item.approverId),
      ...records.map((item) => item.operator),
    ]);
    const title = titles.get(`${row.formType}:${row.targetId}`) || '';
    return {
      instance: this.instanceView(row, title, names, ctx),
      tasks: tasks.map((item) => ({
        id: item.id,
        instanceId: item.instanceId,
        nodeIndex: item.nodeIndex,
        nodeName: item.nodeName,
        approverId: item.approverId,
        approverName: names.get(item.approverId) || '',
        status: item.status,
        action: item.action,
        comment: item.comment,
        actedAt: iso(item.actedAt),
        formType: row.formType,
        formTypeLabel: FORM_TYPE_LABELS[row.formType] || row.formType,
        targetId: row.targetId,
        title,
        submitterName: names.get(row.submitter) || '',
        submittedAt: iso(row.submittedAt),
        instanceStatus: row.status,
      })),
      records: records.map((item) => ({
        id: item.id,
        nodeIndex: item.nodeIndex,
        action: item.action,
        operator: item.operator,
        operatorName: names.get(item.operator) || '',
        comment: item.comment,
        attachments: jsonArray(item.attachments),
        createdAt: iso(item.createdAt),
      })),
      snapshot: jsonObject(row.snapshot),
    };
  }

  private async taskOf(
    ctx: CrmContext,
    instanceId: number,
    taskId: number,
    allowAdmin = true,
  ) {
    const task = taskId
      ? await this.prisma.crmApprovalTask.findFirst({
          where: { id: taskId, instanceId, ownerUserId: ctx.ownerUserId },
        })
      : await this.prisma.crmApprovalTask.findFirst({
          where: {
            instanceId,
            ownerUserId: ctx.ownerUserId,
            approverId: ctx.actorId,
            status: 'PENDING',
          },
          orderBy: { id: 'asc' },
        });
    if (!task)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批任务不存在');
    if (task.status !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个审批任务已经处理过',
      );
    }
    if (task.approverId !== ctx.actorId) {
      if (!(allowAdmin && ctx.isAdmin)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '只有审批人可以处理这个任务',
        );
      }
    }
    return task;
  }

  private async nodesOf(instance: {
    snapshot: unknown;
    flowVersionId: number;
  }): Promise<NodeConfig[]> {
    const snapshot = jsonObject(instance.snapshot);
    if (Array.isArray(snapshot.nodes)) return snapshot.nodes as NodeConfig[];
    if (instance.flowVersionId) {
      const version = await this.prisma.crmApprovalFlowVersion.findUnique({
        where: { id: instance.flowVersionId },
      });
      return jsonArray(version?.nodes);
    }
    return [];
  }

  async approve(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    if (instance.status !== 'APPROVING') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个审批已经结束');
    }
    const task = await this.taskOf(ctx, instance.id, int(body.taskId));
    const comment = text(body.comment).slice(0, 1000);
    const acted = await this.prisma.crmApprovalTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        action: 'APPROVE',
        comment,
        actedAt: new Date(),
      },
    });
    if (acted.count !== 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个审批任务已经处理过',
      );
    }
    await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex: task.nodeIndex,
        action: 'APPROVE',
        operator: ctx.actorId,
        comment,
      },
    });
    const nodes = await this.nodesOf(instance);
    const node = nodes[task.nodeIndex] || {};
    const mode = text(node.mode, 'ALL');
    const values = await this.valuesOf(
      ctx.ownerUserId,
      instance.formType,
      instance.targetId,
    );
    if (mode === 'SEQUENTIAL') {
      const next = await this.prisma.crmApprovalTask.findFirst({
        where: {
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          status: 'WAITING',
        },
        orderBy: { id: 'asc' },
      });
      if (next) {
        await this.prisma.crmApprovalTask.update({
          where: { id: next.id },
          data: { status: 'PENDING' },
        });
        return { advanced: false, status: 'APPROVING' };
      }
      await this.activateNode(
        instance.id,
        task.nodeIndex + 1,
        nodes,
        ctx,
        values,
      );
    } else if (mode === 'ANY') {
      await this.prisma.crmApprovalTask.updateMany({
        where: {
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          status: 'PENDING',
        },
        data: { status: 'SKIPPED' },
      });
      await this.activateNode(
        instance.id,
        task.nodeIndex + 1,
        nodes,
        ctx,
        values,
      );
    } else {
      const remaining = await this.prisma.crmApprovalTask.count({
        where: {
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          status: 'PENDING',
        },
      });
      const skipped = await this.prisma.crmApprovalTask.count({
        where: {
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          status: 'SKIPPED',
        },
      });
      if (remaining === 0 || skipped > 0) {
        await this.activateNode(
          instance.id,
          task.nodeIndex + 1,
          nodes,
          ctx,
          values,
        );
      }
    }
    const current = await this.prisma.crmApprovalInstance.findUnique({
      where: { id: instance.id },
    });
    if (current?.status === 'APPROVED') {
      await this.setTargetStatus(
        ctx,
        current.formType,
        current.targetId,
        'APPROVED',
      );
      await this.settings.log(
        ctx.ownerUserId,
        current.formType,
        current.targetId,
        'APPROVAL_APPROVED',
        {},
        { instanceId: current.id },
        ctx.actorId,
      );
    }
    return {
      advanced: true,
      status: current?.status || 'APPROVING',
    };
  }

  async reject(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    if (instance.status !== 'APPROVING') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个审批已经结束');
    }
    const task = await this.taskOf(ctx, instance.id, int(body.taskId));
    const comment = text(body.comment).trim().slice(0, 1000);
    if (!comment)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写驳回原因');
    const acted = await this.prisma.crmApprovalTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        action: 'REJECT',
        comment,
        actedAt: new Date(),
      },
    });
    if (acted.count !== 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个审批任务已经处理过',
      );
    }
    await this.prisma.crmApprovalTask.updateMany({
      where: { instanceId: instance.id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    await this.prisma.crmApprovalInstance.update({
      where: { id: instance.id },
      data: { status: 'UNAPPROVED', finishedAt: new Date() },
    });
    await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex: task.nodeIndex,
        action: 'REJECT',
        operator: ctx.actorId,
        comment,
      },
    });
    await this.setTargetStatus(
      ctx,
      instance.formType,
      instance.targetId,
      'UNAPPROVED',
    );
    return { status: 'UNAPPROVED' };
  }

  async addSign(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    if (instance.status !== 'APPROVING') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个审批已经结束');
    }
    const userId = text(body.userId);
    if (!userId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择加签人');
    const staff = await this.scope.accountStaff(ctx.ownerUserId);
    if (
      userId !== ctx.ownerUserId &&
      !staff.some((row) => row.memberUserId === userId)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '加签人必须是本账号的职员或代理人',
      );
    }
    const pending = await this.prisma.crmApprovalTask.findFirst({
      where: {
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        approverId: ctx.actorId,
        status: 'PENDING',
      },
    });
    if (!pending) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '当前节点没有你的待办，不能加签',
      );
    }
    const duplicated = await this.prisma.crmApprovalTask.findFirst({
      where: {
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        approverId: userId,
        status: 'PENDING',
      },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该审批人已在当前节点，无需重复加签',
      );
    }
    await this.prisma.crmApprovalTask.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        nodeName: pending.nodeName,
        approverId: userId,
        status: 'PENDING',
      },
    });
    await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        action: 'ADD_SIGN',
        operator: ctx.actorId,
        comment:
          text(body.position, 'AFTER') === 'BEFORE' ? '前加签' : '后加签',
      },
    });
    return { added: true };
  }

  async returnBack(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    if (instance.status !== 'APPROVING') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个审批已经结束');
    }
    const nodeIndex = Math.max(0, int(body.nodeIndex));
    const nodes = await this.nodesOf(instance);
    if (nodeIndex >= instance.currentNode) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只能退回到当前审批步骤之前的节点',
      );
    }
    if (!ctx.isAdmin) {
      const pending = await this.prisma.crmApprovalTask.findFirst({
        where: {
          instanceId: instance.id,
          nodeIndex: instance.currentNode,
          approverId: ctx.actorId,
          status: 'PENDING',
        },
      });
      if (!pending) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '只有当前节点的审批人可以退回',
        );
      }
    }
    const values = await this.valuesOf(
      ctx.ownerUserId,
      instance.formType,
      instance.targetId,
    );
    await this.prisma.crmApprovalTask.updateMany({
      where: {
        instanceId: instance.id,
        status: { in: ['PENDING', 'WAITING'] },
      },
      data: { status: 'SKIPPED' },
    });
    await this.activateNode(instance.id, nodeIndex, nodes, ctx, values);
    await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex,
        action: 'RETURN',
        operator: ctx.actorId,
        comment: text(body.comment).slice(0, 1000),
      },
    });
    return { returned: true };
  }

  async revoke(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    if (instance.submitter !== ctx.actorId && !ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有发起人可以撤回审批',
      );
    }
    if (!['PENDING', 'APPROVING'].includes(instance.status)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个审批已经结束');
    }
    await this.prisma.crmApprovalTask.updateMany({
      where: { instanceId: instance.id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    await this.prisma.crmApprovalInstance.update({
      where: { id: instance.id },
      data: { status: 'REVOKED', finishedAt: new Date() },
    });
    await this.setTargetStatus(
      ctx,
      instance.formType,
      instance.targetId,
      'REVOKED',
    );
    await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        action: 'REVOKE',
        operator: ctx.actorId,
        comment: text(body.comment).slice(0, 1000),
      },
    });
    return { status: 'REVOKED' };
  }

  async todo(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where: Prisma.CrmApprovalTaskWhereInput = {
      ownerUserId: ctx.ownerUserId,
      approverId: ctx.actorId,
      status: 'PENDING',
    };
    const [tasks, total] = await Promise.all([
      this.prisma.crmApprovalTask.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmApprovalTask.count({ where }),
    ]);
    return this.taskRows(tasks, ctx, page, pageSize, total);
  }

  async done(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where: Prisma.CrmApprovalTaskWhereInput = {
      ownerUserId: ctx.ownerUserId,
      approverId: ctx.actorId,
      status: { in: ['APPROVED', 'REJECTED', 'SKIPPED'] },
    };
    const [tasks, total] = await Promise.all([
      this.prisma.crmApprovalTask.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmApprovalTask.count({ where }),
    ]);
    return this.taskRows(tasks, ctx, page, pageSize, total);
  }

  private async taskRows(
    tasks: Array<{
      id: number;
      instanceId: number;
      nodeIndex: number;
      nodeName: string;
      approverId: string;
      status: string;
      action: string;
      comment: string;
      actedAt: Date | null;
    }>,
    ctx: CrmContext,
    page: number,
    pageSize: number,
    total: number,
  ) {
    const instances = await this.prisma.crmApprovalInstance.findMany({
      where: { id: { in: [...new Set(tasks.map((row) => row.instanceId))] } },
    });
    const instanceMap = new Map(instances.map((row) => [row.id, row]));
    const titles = await this.titlesOf(ctx.ownerUserId, instances);
    const names = await this.scope.names(instances.map((row) => row.submitter));
    return {
      list: tasks.map((task) => {
        const instance = instanceMap.get(task.instanceId);
        return {
          id: task.id,
          instanceId: task.instanceId,
          nodeIndex: task.nodeIndex,
          nodeName: task.nodeName,
          approverId: task.approverId,
          approverName: '',
          status: task.status,
          action: task.action,
          comment: task.comment,
          actedAt: iso(task.actedAt),
          formType: instance?.formType || '',
          formTypeLabel: FORM_TYPE_LABELS[instance?.formType || ''] || '',
          targetId: instance?.targetId || 0,
          title:
            titles.get(`${instance?.formType}:${instance?.targetId}`) || '',
          submitterName: names.get(instance?.submitter || '') || '',
          submittedAt: iso(instance?.submittedAt || null),
          instanceStatus: instance?.status || '',
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async comments(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    const rows = await this.prisma.crmApprovalRecord.findMany({
      where: { instanceId: instance.id },
      orderBy: { id: 'asc' },
    });
    const names = await this.scope.names(rows.map((row) => row.operator));
    return rows.map((row) => ({
      id: row.id,
      nodeIndex: row.nodeIndex,
      action: row.action,
      operator: row.operator,
      operatorName: names.get(row.operator) || '',
      comment: row.comment,
      createdAt: iso(row.createdAt),
    }));
  }

  async saveComment(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    const instance = await this.prisma.crmApprovalInstance.findFirst({
      where: { id: Number(rawId), ownerUserId: ctx.ownerUserId },
    });
    if (!instance)
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批实例不存在');
    const content = text(body.content).trim().slice(0, 2000);
    if (!content)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写评论内容');
    const row = await this.prisma.crmApprovalRecord.create({
      data: {
        instanceId: instance.id,
        nodeIndex: instance.currentNode,
        action: 'COMMENT',
        operator: ctx.actorId,
        comment: content,
      },
    });
    return {
      id: row.id,
      nodeIndex: row.nodeIndex,
      action: row.action,
      operator: row.operator,
      operatorName: '我',
      comment: row.comment,
      createdAt: iso(row.createdAt),
    };
  }
}
