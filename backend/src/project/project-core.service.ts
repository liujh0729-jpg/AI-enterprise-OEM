import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { num } from './project.shared';
import type { PageQuery, Row } from './project.shared';
import { ProjectBase } from './project.base';
import type { HrmOrg } from '../hrm/hrm.scope';
import { toJsonInput } from '../common/json-input';

/** 项目主档与成员。 */
export class ProjectCoreService extends ProjectBase {
  async listProjects(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q } },
              { code: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjProject.count({ where }),
      this.prisma.pjProject.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const { members, tasks } = await this.countMaps(
      org,
      rows.map((row) => row.id),
    );
    const ownerNames = await this.names(rows.map((row) => row.ownerId));
    return {
      list: rows.map((row) =>
        this.projectView(
          row,
          {
            memberCount: members.get(row.id),
            taskTotal: tasks.get(row.id)?.total,
            taskDone: tasks.get(row.id)?.done,
          },
          ownerNames.get(row.ownerId) || '',
        ),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getProject(user: CurrentUser, idRaw: string) {
    const org = await this.org(user);
    const row = await this.requireProject(org, Number(idRaw));
    const [members, milestones, counts] = await Promise.all([
      this.prisma.pjProjectMember.findMany({
        where: { projectId: row.id },
        orderBy: { id: 'asc' },
      }),
      this.prisma.pjMilestone.findMany({
        where: { projectId: row.id },
        orderBy: { dueDate: 'asc' },
      }),
      this.countMaps(org, [row.id]),
    ]);
    const names = await this.names([
      row.ownerId,
      ...members.map((m) => m.principalId),
    ]);
    return {
      ...this.projectView(
        row,
        {
          memberCount: counts.members.get(row.id),
          taskTotal: counts.tasks.get(row.id)?.total,
          taskDone: counts.tasks.get(row.id)?.done,
        },
        names.get(row.ownerId) || '',
      ),
      members: members.map((m) => ({
        id: m.id,
        principalType: m.principalType,
        principalId: m.principalId,
        name: names.get(m.principalId) || m.principalId,
        role: m.role,
        allocationPct: m.allocationPct,
        createdAt: m.createdAt.toISOString(),
      })),
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        dueDate: m.dueDate,
        status: m.status,
        deliverable: m.deliverable,
        acceptanceNote: m.acceptanceNote,
      })),
    };
  }

  async saveProject(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const data = {
      code: clip(body.code, 32),
      name: clip(body.name, 120),
      description: clip(body.description, 20000),
      source: body.source === 'CRM_ORDER' ? 'CRM_ORDER' : 'MANUAL',
      sourceRef: clip(body.sourceRef, 64),
      customerName: clip(body.customerName, 120),
      contractId: num(body.contractId),
      ownerId: clip(body.ownerId, 64),
      status: clip(body.status, 16) || 'PLANNING',
      startDate: clip(body.startDate, 16),
      endDate: clip(body.endDate, 16),
      budgetAmount: num(body.budgetAmount),
      budgetHours: num(body.budgetHours),
      currency: clip(body.currency, 8) || 'CNY',
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写项目名称');
    if (id) {
      await this.requireProject(org, id);
      const row = await this.prisma.pjProject.update({ where: { id }, data });
      const names = await this.names([row.ownerId]);
      this.emit(org, 'project.updated', {
        projectId: row.id,
        name: row.name,
        status: row.status,
      });
      return this.projectView(row, {}, names.get(row.ownerId) || '');
    }
    const row = await this.prisma.pjProject.create({
      data: { ...orgKey(org), ...data, createdBy: org.actorId },
    });
    if (data.ownerId) {
      await this.prisma.pjProjectMember.upsert({
        where: {
          projectId_principalType_principalId: {
            projectId: row.id,
            principalType: 'STAFF',
            principalId: data.ownerId,
          },
        },
        create: {
          ...orgKey(org),
          projectId: row.id,
          principalType: 'STAFF',
          principalId: data.ownerId,
          role: 'OWNER',
        },
        update: { role: 'OWNER' },
      });
    }
    const names = await this.names([row.ownerId]);
    this.emit(org, 'project.created', {
      projectId: row.id,
      name: row.name,
      status: row.status,
    });
    return this.projectView(row, {}, names.get(row.ownerId) || '');
  }

  /**
   * 合同签约 → 履约计划（设计方案 §5.3 第一个闭环）：一份已签合同生成一个履约项目，
   * 交付物按合同明细落成项目交付项，回款计划按合同额生成应收（同合同 + 同来源只生成一次）。
   * 已生成过（项目 source=CUSTOMER_CONTRACT 且 sourceRef 指同一合同）直接返回原项目，天然幂等。
   */
  async createFromContract(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const contractId = num(body.contractId);
    if (contractId <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择合同');
    const contract = await this.prisma.crmContract.findFirst({
      where: {
        id: contractId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        deletedAt: null,
      },
    });
    if (!contract)
      throw new BusinessException(ErrorCode.NOT_FOUND, '合同不存在');
    if (contract.voidReason)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已作废合同不能生成履约计划',
      );
    const existed = await this.prisma.pjProject.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        contractId,
        source: 'CUSTOMER_CONTRACT',
      },
      orderBy: { id: 'asc' },
    });
    if (existed) {
      await this.ensureContractReceivable(org, contract);
      const names = await this.names([existed.ownerId]);
      return this.projectView(existed, {}, names.get(existed.ownerId) || '');
    }
    const customer = await this.prisma.crmCustomer.findFirst({
      where: { id: contract.customerId, deletedAt: null },
      select: { name: true },
    });
    const items = await this.prisma.crmContractItem.findMany({
      where: { contractId },
      select: { nameSnapshot: true, qty: true, amount: true },
    });
    const deliverables = items.map((item) => ({
      name: item.nameSnapshot || '交付项',
      qty: num(item.qty),
      amount: num(item.amount),
      accepted: false,
    }));
    const row = await this.prisma.pjProject.create({
      data: {
        ...orgKey(org),
        name: clip(contract.name, 120),
        description: clip(
          `由合同 ${contract.number || `#${contract.id}`} 生成的履约计划`,
          20000,
        ),
        source: 'CUSTOMER_CONTRACT',
        sourceRef: String(contract.id),
        customerName: clip(customer?.name || '', 120),
        contractId: contract.id,
        targetOutcome: clip(
          typeof body.targetOutcome === 'string' ? body.targetOutcome : '',
          20000,
        ),
        deliverables: toJsonInput(deliverables),
        budgetAmount: contract.amount,
        startDate: contract.startAt
          ? contract.startAt.toISOString().slice(0, 10)
          : '',
        endDate: contract.endAt
          ? contract.endAt.toISOString().slice(0, 10)
          : '',
        ownerId: clip(body.ownerId, 64) || contract.ownerId,
        createdBy: org.actorId,
      },
    });
    if (row.ownerId) {
      await this.prisma.pjProjectMember.upsert({
        where: {
          projectId_principalType_principalId: {
            projectId: row.id,
            principalType: 'STAFF',
            principalId: row.ownerId,
          },
        },
        create: {
          ...orgKey(org),
          projectId: row.id,
          principalType: 'STAFF',
          principalId: row.ownerId,
          role: 'OWNER',
        },
        update: { role: 'OWNER' },
      });
    }
    await this.ensureContractReceivable(org, contract);
    this.emit(org, 'project.created', {
      projectId: row.id,
      name: row.name,
      status: row.status,
      contractId: contract.id,
    });
    const names = await this.names([row.ownerId]);
    return this.projectView(row, {}, names.get(row.ownerId) || '');
  }

  /** 合同回款计划 → 应收（来源 CONTRACT，同合同只挂一张，重复调用只补金额不重置回款进度）。 */
  private async ensureContractReceivable(
    org: HrmOrg,
    contract: {
      id: number;
      amount: unknown;
      customerId: number;
      number: string;
    },
  ) {
    const amount = num(contract.amount);
    if (amount <= 0) return;
    const customer = await this.prisma.crmCustomer.findFirst({
      where: { id: contract.customerId, deletedAt: null },
      select: { name: true },
    });
    const existing = await this.prisma.erpReceivable.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        sourceType: 'CONTRACT',
        sourceId: contract.id,
      },
    });
    if (existing) {
      if (existing.status === 'CANCELED') return;
      await this.prisma.erpReceivable.update({
        where: { id: existing.id },
        data: { amount, customerName: customer?.name || existing.customerName },
      });
      return;
    }
    await this.prisma.erpReceivable.create({
      data: {
        ...orgKey(org),
        customerName: customer?.name || '未命名客户',
        customerId: contract.customerId,
        contractId: contract.id,
        sourceType: 'CONTRACT',
        sourceId: contract.id,
        amount,
        note: `合同 ${contract.number || `#${contract.id}`} 回款计划`,
      },
    });
  }

  async removeProject(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.requireProject(org, id);
    this.scope.requireAdmin(org);
    await this.prisma.$transaction([
      this.prisma.pjTaskRelation.deleteMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.pjTask.deleteMany({ where: { projectId: id } }),
      this.prisma.pjMilestone.deleteMany({ where: { projectId: id } }),
      this.prisma.pjSprint.deleteMany({ where: { projectId: id } }),
      this.prisma.pjProjectMember.deleteMany({ where: { projectId: id } }),
      this.prisma.pjTimeLog.deleteMany({ where: { projectId: id } }),
      this.prisma.pjTimesheet.deleteMany({ where: { projectId: id } }),
      this.prisma.pjCostItem.deleteMany({ where: { projectId: id } }),
      this.prisma.pjEngagement.deleteMany({ where: { projectId: id } }),
      this.prisma.pjProject.delete({ where: { id } }),
    ]);
    this.emit(org, 'project.removed', { projectId: id, name: row.name });
    return { id };
  }

  async saveMember(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    const principalType =
      body.principalType === 'ASSIGNMENT' ? 'ASSIGNMENT' : 'STAFF';
    const principalId = clip(body.principalId, 64);
    if (!principalId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择成员');
    if (principalType === 'STAFF')
      await this.scope.requireStaff(org, principalId, false);
    const data = {
      principalType,
      principalId,
      role: ['OWNER', 'MEMBER', 'APPROVER'].includes(String(body.role))
        ? String(body.role)
        : 'MEMBER',
      allocationPct: Math.min(
        100,
        Math.max(0, Math.trunc(num(body.allocationPct, 100))),
      ),
    };
    const id = num(body.id);
    if (id) {
      const existing = await this.prisma.pjProjectMember.findFirst({
        where: { id, projectId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
      const row = await this.prisma.pjProjectMember.update({
        where: { id },
        data,
      });
      return {
        id: row.id,
        principalType: row.principalType,
        principalId: row.principalId,
        role: row.role,
        allocationPct: row.allocationPct,
      };
    }
    const row = await this.prisma.pjProjectMember.upsert({
      where: {
        projectId_principalType_principalId: {
          projectId,
          principalType,
          principalId,
        },
      },
      create: { ...orgKey(org), projectId, ...data },
      update: { role: data.role, allocationPct: data.allocationPct },
    });
    return {
      id: row.id,
      principalType: row.principalType,
      principalId: row.principalId,
      role: row.role,
      allocationPct: row.allocationPct,
    };
  }

  async removeMember(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjProjectMember.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    await this.prisma.pjProjectMember.delete({ where: { id } });
    return { id };
  }
}
