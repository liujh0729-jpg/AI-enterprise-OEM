import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DataTableService } from '../data-table/data-table.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { LowCodeAccessService } from './lowcode.access.service';
import {
  type LowCodeProjectRow,
  ownerUser,
  rowAllowed,
} from './lowcode.shared';

type NodeInput = {
  type: string;
  name: string;
  assigneeType: 'USER' | 'MANAGER' | 'DEPT_LEADER';
  userIds: string[];
  mode: 'ALL' | 'ANY';
};

const STATUS_TEXT = {
  running: '审批中',
  approved: '已通过',
  rejected: '已驳回',
};

/**
 * 审批引擎：流（含版本）→ 实例 → 节点任务 → 记录。
 *
 * 版本化：改节点只新增版本，已发出的实例仍按提交时的版本跑完，不会中途改口径。
 * 指派：`USER` 取节点上的人；`MANAGER` / `DEPT_LEADER` 需要员工模块的上下级关系，
 * 当前 `org_staff` 只有部门与岗位、没有主管字段，故一律落到组织账号（缺失时项目所有者）。
 */
export class LowCodeApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LowCodeAccessService,
    private readonly dataTables: DataTableService,
    private readonly notifications: NotificationService,
    private readonly users: UserLookupService,
    private readonly identity: IdentityService,
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

  private async nodesOf(flowId: number, version: number): Promise<NodeInput[]> {
    if (!version) return [];
    const row = await this.prisma.lowCodeApprovalFlowVersion.findFirst({
      where: { flowId, version },
    });
    if (!row) return [];
    const nodes = Array.isArray(row.nodes) ? row.nodes : [];
    return nodes.map((item) => {
      const node = (item || {}) as Record<string, unknown>;
      const assigneeType = text(node.assigneeType) as NodeInput['assigneeType'];
      return {
        type: 'APPROVE',
        name: text(node.name) || '审批',
        assigneeType:
          assigneeType === 'MANAGER' || assigneeType === 'DEPT_LEADER'
            ? assigneeType
            : 'USER',
        userIds: Array.isArray(node.userIds)
          ? node.userIds.map((id) => text(id)).filter(Boolean)
          : [],
        mode: text(node.mode) === 'ALL' ? 'ALL' : 'ANY',
      };
    });
  }

  private async flowView(flow: {
    id: number;
    projectId: number;
    entityId: number;
    name: string;
    status: string;
    version: number;
    updatedAt: Date;
  }) {
    return {
      id: flow.id,
      projectId: flow.projectId,
      entityId: flow.entityId,
      name: flow.name,
      status: flow.status,
      version: flow.version,
      nodes: await this.nodesOf(flow.id, flow.version),
      updatedAt: flow.updatedAt,
    };
  }

  async flows(user: CurrentUser, raw: unknown, query: { entityId?: number }) {
    const access = await this.access.resolve(user, raw);
    const entityId = Number(query.entityId) || 0;
    if (entityId > 0) await this.entityOf(access.project.id, entityId);
    const rows = await this.prisma.lowCodeApprovalFlow.findMany({
      where: {
        projectId: access.project.id,
        ...(entityId > 0 ? { entityId } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return Promise.all(rows.map((flow) => this.flowView(flow)));
  }

  async flowSave(
    user: CurrentUser,
    raw: unknown,
    body: {
      id: number;
      entityId: number;
      name: string;
      status: string;
      nodes: NodeInput[];
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const entity = await this.entityOf(projectId, body.entityId);
    const name = text(body.name).trim().slice(0, 50);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写审批流名称');
    }
    const nodes = body.nodes.map((node, index) => ({
      type: 'APPROVE',
      name: text(node.name).trim().slice(0, 50) || `审批节点 ${index + 1}`,
      assigneeType: node.assigneeType,
      userIds: (node.userIds || []).map((id) => text(id)).filter(Boolean),
      mode: node.mode === 'ALL' ? 'ALL' : 'ANY',
    }));
    if (
      nodes.some((node) => node.assigneeType === 'USER' && !node.userIds.length)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '指定审批人节点必须选择至少一名审批人',
      );
    }

    let flowId = body.id;
    if (flowId > 0) {
      const flow = await this.prisma.lowCodeApprovalFlow.findFirst({
        where: { id: flowId, projectId },
      });
      if (!flow) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '审批流不存在');
      }
      const current = await this.nodesOf(flow.id, flow.version);
      const same = JSON.stringify(current) === JSON.stringify(nodes);
      const nextVersion = same ? flow.version : flow.version + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.lowCodeApprovalFlow.update({
          where: { id: flow.id },
          data: {
            entityId: entity.id,
            name,
            status: body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
            version: nextVersion,
          },
        });
        if (!same) {
          await tx.lowCodeApprovalFlowVersion.create({
            data: {
              flowId: flow.id,
              version: nextVersion,
              nodes: nodes,
              createdBy: user.userId,
            },
          });
        }
      });
      flowId = flow.id;
    } else {
      const created = await this.prisma.$transaction(async (tx) => {
        const flow = await tx.lowCodeApprovalFlow.create({
          data: {
            projectId,
            entityId: entity.id,
            name,
            status: body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
            version: 1,
          },
        });
        await tx.lowCodeApprovalFlowVersion.create({
          data: {
            flowId: flow.id,
            version: 1,
            nodes: nodes,
            createdBy: user.userId,
          },
        });
        return flow;
      });
      flowId = created.id;
      await this.identity.audit(
        user.userId,
        '内建应用新建审批流',
        `#${created.id} ${created.name}`,
      );
    }
    const saved = await this.prisma.lowCodeApprovalFlow.findUnique({
      where: { id: flowId },
    });
    return this.flowView(saved!);
  }

  async flowDelete(user: CurrentUser, raw: unknown, flowIdRaw: unknown) {
    const access = await this.access.requireManage(user, raw);
    const flowId = Number(flowIdRaw);
    const flow = await this.prisma.lowCodeApprovalFlow.findFirst({
      where: { id: flowId, projectId: access.project.id },
    });
    if (!flow) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '审批流不存在');
    }
    const running = await this.prisma.lowCodeApprovalInstance.count({
      where: {
        projectId: access.project.id,
        flowId: flow.id,
        status: 'RUNNING',
      },
    });
    if (running) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该审批流还有进行中的审批，不能删除',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.lowCodeApprovalFlowVersion.deleteMany({
        where: { flowId: flow.id },
      });
      await tx.lowCodeApprovalFlow.delete({ where: { id: flow.id } });
    });
    await this.identity.audit(
      user.userId,
      '内建应用删除审批流',
      `#${flow.id} ${flow.name}`,
    );
    return { removed: true };
  }

  /** 节点上的审批人：USER 直取；MANAGER / DEPT_LEADER 落到组织账号。 */
  private assigneesOf(node: NodeInput, project: LowCodeProjectRow): string[] {
    if (node.assigneeType === 'USER') return node.userIds;
    return [project.orgUserId || project.ownerUserId].filter(Boolean);
  }

  private titleOf(entityName: string, rowId: number, data: unknown) {
    const values = (data || {}) as Record<string, unknown>;
    const first = Object.values(values).find(
      (value) => typeof value === 'string' && value.trim(),
    );
    return `${entityName} · ${text(first).slice(0, 80) || `记录 #${rowId}`}`.slice(
      0,
      200,
    );
  }

  async submit(
    user: CurrentUser,
    raw: unknown,
    body: { entityId: number; rowId: number; flowId: number; comment: string },
  ) {
    const access = await this.access.resolve(user, raw);
    const project = access.project;
    const entity = await this.entityOf(project.id, body.entityId);
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: body.rowId, tableId: entity.dataTableId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    }
    if (
      !rowAllowed(access, entity.id, {
        data: row.data,
        createdBy: row.createdBy,
      })
    ) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    }
    const flow = body.flowId
      ? await this.prisma.lowCodeApprovalFlow.findFirst({
          where: {
            id: body.flowId,
            projectId: project.id,
            entityId: entity.id,
          },
        })
      : await this.prisma.lowCodeApprovalFlow.findFirst({
          where: {
            projectId: project.id,
            entityId: entity.id,
            status: 'ACTIVE',
          },
          orderBy: { id: 'asc' },
        });
    if (!flow) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该实体还没有可用的审批流',
      );
    }
    if (flow.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该审批流已停用');
    }
    const nodes = await this.nodesOf(flow.id, flow.version);
    if (!nodes.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '审批流还没有配置节点',
      );
    }
    const running = await this.prisma.lowCodeApprovalInstance.findFirst({
      where: { entityId: entity.id, rowId: row.id, status: 'RUNNING' },
      select: { id: true },
    });
    if (running) {
      throw new BusinessException(ErrorCode.CONFLICT, '该记录已有进行中的审批');
    }
    const assignees = this.assigneesOf(nodes[0], project);
    if (!assignees.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '第一个审批节点没有可用审批人',
      );
    }

    const instance = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lowCodeApprovalInstance.create({
        data: {
          projectId: project.id,
          flowId: flow.id,
          version: flow.version,
          entityId: entity.id,
          rowId: row.id,
          title: this.titleOf(entity.name, row.id, row.data),
          status: 'RUNNING',
          applicantUserId: user.userId,
          nodeIndex: 0,
        },
      });
      await tx.lowCodeApprovalTask.createMany({
        data: assignees.map((assignee) => ({
          instanceId: created.id,
          projectId: project.id,
          nodeIndex: 0,
          nodeName: nodes[0].name,
          assigneeUserId: assignee,
          status: 'PENDING',
        })),
      });
      await tx.lowCodeApprovalRecord.create({
        data: {
          instanceId: created.id,
          action: 'SUBMIT',
          actorUserId: user.userId,
          comment: text(body.comment).slice(0, 500),
        },
      });
      return created;
    });
    await this.syncRowStatus(
      project,
      entity.dataTableId,
      row.id,
      STATUS_TEXT.running,
    );
    await this.notifications.notifyMany(assignees, {
      category: 'automation',
      title: '内建应用审批待办',
      body: `${instance.title} 等待你审批`,
      link: `/lowcode/p/${project.id}`,
      entityType: 'lowcode_approval',
      entityId: instance.id,
    });
    return { instanceId: instance.id, status: instance.status };
  }

  async act(
    user: CurrentUser,
    raw: unknown,
    body: { taskId: number; action: 'APPROVE' | 'REJECT'; comment: string },
  ) {
    const access = await this.access.resolve(user, raw);
    const project = access.project;
    const task = await this.prisma.lowCodeApprovalTask.findFirst({
      where: { id: body.taskId, projectId: project.id },
    });
    if (!task || task.assigneeUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '这不是你的审批任务',
      );
    }
    if (task.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该审批任务已处理');
    }
    const instance = await this.prisma.lowCodeApprovalInstance.findUnique({
      where: { id: task.instanceId },
    });
    if (!instance || instance.status !== 'RUNNING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该审批已结束');
    }
    const nodes = await this.nodesOf(instance.flowId, instance.version);
    const node = nodes[task.nodeIndex];
    const comment = text(body.comment).slice(0, 500);
    const approved = body.action === 'APPROVE';

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.lowCodeApprovalTask.update({
        where: { id: task.id },
        data: {
          status: approved ? 'APPROVED' : 'REJECTED',
          comment,
          actedAt: new Date(),
        },
      });
      await tx.lowCodeApprovalRecord.create({
        data: {
          instanceId: instance.id,
          taskId: task.id,
          action: approved ? 'APPROVE' : 'REJECT',
          actorUserId: user.userId,
          comment,
        },
      });

      if (!approved) {
        await tx.lowCodeApprovalTask.updateMany({
          where: { instanceId: instance.id, status: 'PENDING' },
          data: { status: 'CANCELED' },
        });
        await tx.lowCodeApprovalInstance.update({
          where: { id: instance.id },
          data: { status: 'REJECTED', finishedAt: new Date() },
        });
        return { status: 'REJECTED', instanceStatus: 'REJECTED' };
      }

      const pendingInNode = await tx.lowCodeApprovalTask.count({
        where: {
          instanceId: instance.id,
          nodeIndex: task.nodeIndex,
          status: 'PENDING',
        },
      });
      // ANY：一人通过即可推进；ALL：本节点全部通过才推进
      const nodeDone = node?.mode === 'ALL' ? pendingInNode === 0 : true;
      if (!nodeDone) {
        return { status: 'APPROVED', instanceStatus: 'RUNNING' };
      }
      if (node?.mode === 'ALL') {
        await tx.lowCodeApprovalTask.updateMany({
          where: {
            instanceId: instance.id,
            nodeIndex: task.nodeIndex,
            status: 'PENDING',
          },
          data: { status: 'CANCELED' },
        });
      }
      const nextIndex = task.nodeIndex + 1;
      if (nextIndex < nodes.length) {
        const assignees = this.assigneesOf(nodes[nextIndex], project);
        if (!assignees.length) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `审批节点「${nodes[nextIndex].name}」没有可用审批人`,
          );
        }
        await tx.lowCodeApprovalTask.createMany({
          data: assignees.map((assignee) => ({
            instanceId: instance.id,
            projectId: project.id,
            nodeIndex: nextIndex,
            nodeName: nodes[nextIndex].name,
            assigneeUserId: assignee,
            status: 'PENDING',
          })),
        });
        await tx.lowCodeApprovalInstance.update({
          where: { id: instance.id },
          data: { nodeIndex: nextIndex },
        });
        return { status: 'APPROVED', instanceStatus: 'RUNNING' };
      }
      await tx.lowCodeApprovalInstance.update({
        where: { id: instance.id },
        data: { status: 'APPROVED', finishedAt: new Date() },
      });
      return { status: 'APPROVED', instanceStatus: 'APPROVED' };
    });

    if (result.instanceStatus === 'APPROVED') {
      await this.syncRowStatus(
        project,
        await this.tableOfEntity(instance.entityId),
        instance.rowId,
        STATUS_TEXT.approved,
      );
    } else if (result.instanceStatus === 'REJECTED') {
      await this.syncRowStatus(
        project,
        await this.tableOfEntity(instance.entityId),
        instance.rowId,
        STATUS_TEXT.rejected,
      );
    }
    await this.notifications.notify(instance.applicantUserId, {
      category: 'automation',
      title: '内建应用审批结果',
      body: `${instance.title}：${
        result.instanceStatus === 'APPROVED'
          ? '已通过'
          : result.instanceStatus === 'REJECTED'
            ? '已驳回'
            : `「${task.nodeName}」已审批，进入下一环节`
      }`,
      link: `/lowcode/p/${project.id}`,
      entityType: 'lowcode_approval',
      entityId: instance.id,
    });
    return result;
  }

  private async tableOfEntity(entityId: number) {
    const entity = await this.prisma.lowCodeEntity.findUnique({
      where: { id: entityId },
      select: { dataTableId: true },
    });
    return entity?.dataTableId || 0;
  }

  /**
   * 把审批状态写回行上的 `status` 列（模板约定）。
   * 该列不存在、不是单选、或候选项里没有这个值时不写：审批本身不能因为回写失败而失败。
   */
  private async syncRowStatus(
    project: LowCodeProjectRow,
    dataTableId: number,
    rowId: number,
    statusText: string,
  ) {
    if (!dataTableId) return;
    const field = await this.prisma.dataTableField.findFirst({
      where: { tableId: dataTableId, fieldKey: 'status' },
    });
    if (!field || field.fieldType !== 'select') return;
    const options = (field.options || {}) as Record<string, unknown>;
    const choices = Array.isArray(options.choices)
      ? (options.choices as unknown[]).map((item) => text(item))
      : [];
    if (choices.length && !choices.includes(statusText)) return;
    const row = await this.prisma.dataTableRow.findUnique({
      where: { id: rowId },
    });
    if (!row) return;
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    try {
      await this.dataTables.updateRow(ownerUser(project), dataTableId, rowId, {
        ...data,
        status: statusText,
      });
    } catch {
      // 回写失败不影响审批结果
    }
  }

  async tasks(
    user: CurrentUser,
    raw: unknown,
    query: { page?: number; pageSize?: number; status?: 'PENDING' | 'DONE' },
  ) {
    const access = await this.access.resolve(user, raw);
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 200);
    const where: Prisma.LowCodeApprovalTaskWhereInput = {
      projectId: access.project.id,
      assigneeUserId: user.userId,
      ...(query.status === 'DONE'
        ? { status: { in: ['APPROVED', 'REJECTED', 'CANCELED'] } }
        : { status: 'PENDING' }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lowCodeApprovalTask.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lowCodeApprovalTask.count({ where }),
    ]);
    const instances = rows.length
      ? await this.prisma.lowCodeApprovalInstance.findMany({
          where: {
            id: { in: [...new Set(rows.map((row) => row.instanceId))] },
          },
        })
      : [];
    const instanceMap = new Map(instances.map((item) => [item.id, item]));
    const names = await this.users.displayNames([
      ...new Set([
        ...rows.map((row) => row.assigneeUserId),
        ...instances.map((item) => item.applicantUserId),
      ]),
    ]);
    return {
      list: rows.map((row) => {
        const instance = instanceMap.get(row.instanceId);
        return {
          id: row.id,
          instanceId: row.instanceId,
          projectId: row.projectId,
          entityId: instance?.entityId || 0,
          rowId: instance?.rowId || 0,
          nodeIndex: row.nodeIndex,
          nodeName: row.nodeName,
          assigneeUserId: row.assigneeUserId,
          assigneeName: names.get(row.assigneeUserId) || row.assigneeUserId,
          applicantUserId: instance?.applicantUserId || '',
          applicantName:
            names.get(instance?.applicantUserId || '') ||
            instance?.applicantUserId ||
            '',
          title: instance?.title || '',
          status: row.status,
          comment: row.comment,
          actedAt: row.actedAt,
          createdAt: row.createdAt,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async recordForRow(projectId: number, entityId: number, rowId: number) {
    const instance = await this.prisma.lowCodeApprovalInstance.findFirst({
      where: { projectId, entityId, rowId },
      orderBy: { id: 'desc' },
    });
    return this.detailOf(instance?.id || 0);
  }

  async recordApproval(
    user: CurrentUser,
    raw: unknown,
    entityIdRaw: unknown,
    rowIdRaw: unknown,
  ) {
    const access = await this.access.resolve(user, raw);
    const entity = await this.entityOf(access.project.id, entityIdRaw);
    const rowId = Number(rowIdRaw);
    const row = await this.prisma.dataTableRow.findFirst({
      where: { id: rowId, tableId: entity.dataTableId },
      select: { id: true, data: true, createdBy: true },
    });
    if (
      !row ||
      !rowAllowed(access, entity.id, {
        data: row.data,
        createdBy: row.createdBy,
      })
    ) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该数据行不存在');
    }
    return this.recordForRow(access.project.id, entity.id, row.id);
  }

  /** 详情：实例 + 各节点任务 + 操作记录（列表与详情页共用一份形状）。 */
  private async detailOf(instanceId: number) {
    if (!instanceId) {
      return { instance: null, tasks: [], records: [] };
    }
    const instance = await this.prisma.lowCodeApprovalInstance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) {
      return { instance: null, tasks: [], records: [] };
    }
    const [tasks, records] = await Promise.all([
      this.prisma.lowCodeApprovalTask.findMany({
        where: { instanceId },
        orderBy: [{ nodeIndex: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.lowCodeApprovalRecord.findMany({
        where: { instanceId },
        orderBy: { id: 'asc' },
      }),
    ]);
    const names = await this.users.displayNames([
      ...new Set([
        instance.applicantUserId,
        ...tasks.map((task) => task.assigneeUserId),
        ...records.map((record) => record.actorUserId),
      ]),
    ]);
    return {
      instance: {
        id: instance.id,
        status: instance.status,
        title: instance.title,
        applicantUserId: instance.applicantUserId,
        applicantName:
          names.get(instance.applicantUserId) || instance.applicantUserId,
        nodeIndex: instance.nodeIndex,
        createdAt: instance.createdAt,
        finishedAt: instance.finishedAt,
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        instanceId: task.instanceId,
        projectId: task.projectId,
        entityId: instance.entityId,
        rowId: instance.rowId,
        nodeIndex: task.nodeIndex,
        nodeName: task.nodeName,
        assigneeUserId: task.assigneeUserId,
        assigneeName: names.get(task.assigneeUserId) || task.assigneeUserId,
        applicantUserId: instance.applicantUserId,
        applicantName:
          names.get(instance.applicantUserId) || instance.applicantUserId,
        title: instance.title,
        status: task.status,
        comment: task.comment,
        actedAt: task.actedAt,
        createdAt: task.createdAt,
      })),
      records: records.map((record) => ({
        id: record.id,
        action: record.action,
        actorUserId: record.actorUserId,
        actorName: names.get(record.actorUserId) || record.actorUserId,
        comment: record.comment,
        createdAt: record.createdAt,
      })),
    };
  }
}
