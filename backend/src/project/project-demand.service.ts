import {
  PARTY_KIND_LABELS,
  PJ_DEMAND_RESPONSE_STATUS_LABELS,
  PJ_DEMAND_STATUS_LABELS,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, ds, orgKey } from '../hrm/hrm.helpers';

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 任务外发需求：任务范围的对外快照 → 外部主体响应 → 采纳后落外部合作并指派任务。
 * 链路：任务 → PjTaskDemand → PjDemandResponse → PjEngagement（Batch 3 的外部协作）。
 */
export class ProjectDemandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
  ) {}

  private async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private emit(org: HrmOrg, event: string, payload: Row) {
    void this.mechanisms.dispatch(org, event, payload).catch(() => undefined);
  }

  private async requireTask(org: HrmOrg, id: number) {
    const row = await this.prisma.pjTask.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    return row;
  }

  private async requireDemand(org: HrmOrg, id: number) {
    const row = await this.prisma.pjTaskDemand.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外发需求不存在');
    return row;
  }

  private async demandView(
    row: {
      id: number;
      orgType: string;
      orgUserId: string;
      taskId: number;
      projectId: number;
      title: string;
      scope: string;
      deliverables: string;
      acceptance: string;
      budgetAmount: unknown;
      currency: string;
      startDate: string;
      dueDate: string;
      status: string;
      publishedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    task?: { title: string; status: string } | null,
  ) {
    const [project, responses] = await Promise.all([
      row.projectId
        ? this.prisma.pjProject.findFirst({
            where: {
              id: row.projectId,
              orgType: row.orgType,
              orgUserId: row.orgUserId,
            },
          })
        : null,
      this.prisma.pjDemandResponse.findMany({
        where: {
          orgType: row.orgType,
          orgUserId: row.orgUserId,
          demandId: row.id,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const parties = responses.some((item) => item.partyId)
      ? await this.prisma.bizParty.findMany({
          where: {
            orgType: row.orgType,
            orgUserId: row.orgUserId,
            id: { in: responses.map((item) => item.partyId).filter(Boolean) },
          },
        })
      : [];
    const partyMap = new Map(parties.map((item) => [item.id, item]));
    return {
      id: row.id,
      taskId: row.taskId,
      taskTitle: task?.title || '',
      taskStatus: task?.status || '',
      projectId: row.projectId,
      projectName: project?.name || '',
      title: row.title,
      scope: row.scope,
      deliverables: row.deliverables,
      acceptance: row.acceptance,
      budgetAmount: ds(row.budgetAmount),
      currency: row.currency,
      startDate: row.startDate,
      dueDate: row.dueDate,
      status: row.status,
      statusLabel: PJ_DEMAND_STATUS_LABELS[row.status] || row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : '',
      responseCount: responses.length,
      responses: responses.map((item) => {
        const party = partyMap.get(item.partyId);
        return {
          id: item.id,
          demandId: item.demandId,
          partyId: item.partyId,
          partyName: item.partyName || party?.name || '',
          partyKind: party?.kind || '',
          partyKindLabel: party
            ? PARTY_KIND_LABELS[party.kind] || party.kind
            : '',
          contact: item.contact,
          quoteAmount: ds(item.quoteAmount),
          currency: item.currency,
          durationDays: item.durationDays,
          note: item.note,
          status: item.status,
          statusLabel:
            PJ_DEMAND_RESPONSE_STATUS_LABELS[item.status] || item.status,
          engagementId: item.engagementId,
          createdAt: item.createdAt.toISOString(),
        };
      }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDemand(user: CurrentUser, rawTaskId: string) {
    const org = await this.org(user);
    const task = await this.requireTask(org, Number(rawTaskId));
    const row = await this.prisma.pjTaskDemand.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        taskId: task.id,
      },
    });
    if (!row) return null;
    return this.demandView(row, task);
  }

  async saveDemand(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const task = await this.requireTask(org, num(body.taskId));
    const existing = await this.prisma.pjTaskDemand.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        taskId: task.id,
      },
    });
    const criteria = Array.isArray(task.acceptanceCriteria)
      ? (task.acceptanceCriteria as Array<{ label?: string }>)
          .map((item) => item?.label || '')
          .filter(Boolean)
          .join('\n')
      : '';
    const publish = Boolean(body.publish);
    const status = publish
      ? 'PUBLISHED'
      : existing?.status === 'PUBLISHED'
        ? 'PUBLISHED'
        : 'DRAFT';
    const data = {
      projectId: task.projectId,
      title: clip(body.title, 200) || task.title,
      scope: clip(body.scope, 4000) || task.description,
      deliverables: clip(body.deliverables, 4000),
      acceptance: clip(body.acceptance, 4000) || criteria,
      budgetAmount: num(body.budgetAmount),
      currency: clip(body.currency, 8) || 'CNY',
      startDate: clip(body.startDate, 16) || task.startDate,
      dueDate: clip(body.dueDate, 16) || task.dueDate,
      status,
      publishedAt:
        status === 'PUBLISHED' ? existing?.publishedAt || new Date() : null,
    };
    const saved = existing
      ? await this.prisma.pjTaskDemand.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.pjTaskDemand.create({
          data: {
            ...orgKey(org),
            taskId: task.id,
            ...data,
            createdBy: org.actorId,
          },
        });
    if (status === 'PUBLISHED' && existing?.status !== 'PUBLISHED') {
      this.emit(org, 'demand.published', {
        demandId: saved.id,
        taskId: task.id,
        projectId: saved.projectId,
        budgetAmount: ds(saved.budgetAmount),
        source: 'project',
        sourceId: String(saved.id),
      });
    }
    return this.demandView(saved, task);
  }

  async respondDemand(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const demand = await this.requireDemand(org, num(body.demandId));
    if (demand.status !== 'PUBLISHED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '需求未发布，不能录入响应',
      );
    let party = num(body.partyId)
      ? await this.prisma.bizParty.findFirst({
          where: {
            id: num(body.partyId),
            orgType: org.orgType,
            orgUserId: org.orgUserId,
          },
        })
      : null;
    if (num(body.partyId) && !party)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
    if (!party) {
      const name = clip(body.partyName, 160);
      if (!name)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择已有合作方或填写响应方名称',
        );
      party = await this.prisma.bizParty.findFirst({
        where: { orgType: org.orgType, orgUserId: org.orgUserId, name },
      });
      if (!party) {
        party = await this.prisma.bizParty.create({
          data: {
            ...orgKey(org),
            kind: 'VENDOR',
            name,
            source: 'DEMAND',
            createdBy: org.actorId,
          },
        });
      }
    }
    await this.prisma.pjDemandResponse.create({
      data: {
        ...orgKey(org),
        demandId: demand.id,
        partyId: party.id,
        partyName: party.name,
        contact: clip(body.contact, 160),
        quoteAmount: num(body.quoteAmount),
        currency: clip(body.currency, 8) || demand.currency,
        durationDays: num(body.durationDays),
        note: clip(body.note, 2000),
        createdBy: org.actorId,
      },
    });
    this.emit(org, 'demand.replied', {
      demandId: demand.id,
      taskId: demand.taskId,
      partyId: party.id,
      quoteAmount: num(body.quoteAmount),
      source: 'project',
      sourceId: String(demand.id),
    });
    return this.getDemandRecord(org, demand.id);
  }

  async acceptDemand(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const demand = await this.requireDemand(org, num(body.demandId));
    if (demand.status !== 'PUBLISHED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '需求未发布，不能采纳响应',
      );
    const response = await this.prisma.pjDemandResponse.findFirst({
      where: {
        id: num(body.responseId),
        demandId: demand.id,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!response)
      throw new BusinessException(ErrorCode.NOT_FOUND, '需求响应不存在');
    if (response.status === 'ACCEPTED' && response.engagementId)
      return this.getDemandRecord(org, demand.id);
    const party = await this.prisma.bizParty.findFirst({
      where: {
        id: response.partyId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!party)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
    const project = await this.prisma.pjProject.findFirst({
      where: {
        id: demand.projectId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!project)
      throw new BusinessException(ErrorCode.NOT_FOUND, '所属项目不存在');
    const criteria = demand.acceptance
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const engagement = await this.prisma.pjEngagement.create({
      data: {
        ...orgKey(org),
        projectId: demand.projectId,
        partyId: party.id,
        scope:
          `${demand.title}${demand.scope ? ` · ${demand.scope}` : ''}`.slice(
            0,
            500,
          ),
        amount: Number(response.quoteAmount) || Number(demand.budgetAmount),
        currency: response.currency || demand.currency,
        acceptance: {
          criteria,
          evidence: [],
          note: clip(body.note, 500),
          demandId: demand.id,
          responseId: response.id,
        },
        startDate: demand.startDate,
        endDate: demand.dueDate,
        status: 'ACTIVE',
        createdBy: org.actorId,
      },
    });
    await this.prisma.$transaction([
      this.prisma.pjDemandResponse.updateMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          demandId: demand.id,
          id: { not: response.id },
          status: { in: ['NEW', 'SHORTLISTED'] },
        },
        data: { status: 'REJECTED' },
      }),
      this.prisma.pjDemandResponse.update({
        where: { id: response.id },
        data: { status: 'ACCEPTED', engagementId: engagement.id },
      }),
      this.prisma.pjTaskDemand.update({
        where: { id: demand.id },
        data: { status: 'CLOSED' },
      }),
      this.prisma.pjTask.update({
        where: { id: demand.taskId },
        data: { assigneeType: 'PARTY', assigneeId: String(party.id) },
      }),
    ]);
    this.emit(org, 'demand.accepted', {
      demandId: demand.id,
      taskId: demand.taskId,
      projectId: demand.projectId,
      partyId: party.id,
      engagementId: engagement.id,
      amount: ds(engagement.amount),
      source: 'project',
      sourceId: String(demand.id),
    });
    this.emit(org, 'engagement.created', {
      engagementId: engagement.id,
      projectId: engagement.projectId,
      partyId: engagement.partyId,
      amount: ds(engagement.amount),
    });
    return this.getDemandRecord(org, demand.id);
  }

  async closeDemand(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const demand = await this.requireDemand(org, num(body.demandId));
    const saved = await this.prisma.pjTaskDemand.update({
      where: { id: demand.id },
      data: { status: 'CLOSED' },
    });
    this.emit(org, 'demand.closed', {
      demandId: saved.id,
      taskId: saved.taskId,
      source: 'project',
      sourceId: String(saved.id),
    });
    return this.getDemandRecord(org, saved.id);
  }

  private async getDemandRecord(org: HrmOrg, id: number) {
    const row = await this.requireDemand(org, id);
    const task = await this.prisma.pjTask.findFirst({
      where: { id: row.taskId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    return this.demandView(row, task);
  }
}
