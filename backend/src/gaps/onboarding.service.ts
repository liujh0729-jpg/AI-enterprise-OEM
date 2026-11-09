import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { GapScopeService } from './gaps.scope';
import {
  asInt,
  asText,
  clip,
  iso,
  isoOr,
  pageParams,
  Row,
  safeStatus,
} from './gaps.helpers';

const ROLE_LABELS: Record<string, string> = {
  HR: 'HR',
  IT: 'IT',
  FINANCE: '财务',
  MANAGER: '直属主管',
  STAFF: '新员工',
};
const ROLES = ['HR', 'IT', 'FINANCE', 'MANAGER', 'STAFF'] as const;
const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: '待办',
  DONE: '已完成',
  SKIPPED: '已跳过',
};
const RUN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '进行中',
  DONE: '已完成',
  CANCELED: '已取消',
};
const KINDS = ['HIRE', 'ADMIN'] as const;
const KIND_LABELS: Record<string, string> = {
  HIRE: '员工入职',
  ADMIN: '管理员开通',
};

const dueOf = (days: number): Date =>
  new Date(Date.now() + Math.max(0, days) * 86_400_000);

type TemplateRow = {
  id: number;
  name: string;
  kind: string;
  description: string;
  active: boolean;
  updatedAt: Date;
  items: {
    id: number;
    title: string;
    description: string;
    ownerRole: string;
    dueDays: number;
    sort: number;
  }[];
};

type TaskRow = {
  id: number;
  title: string;
  description: string;
  ownerRole: string;
  assigneeUserId: string;
  dueAt: Date | null;
  status: string;
  doneAt: Date | null;
  note: string;
  sort: number;
};

type RunRow = {
  id: number;
  templateId: number;
  staffUserId: string;
  memberUserId: string;
  offerId: number;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  tasks: TaskRow[];
};

/**
 * B3#27 入职引导清单：模板（角色化事项）→ 运行实例（逐条勾选）→ 全部完成自动收口。
 * Offer 接受时由 HRM 生命周期服务调用 `startOnboardingForOffer` 自动开工，也可手工发起。
 */
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private templateView(row: TemplateRow) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind] || row.kind,
      description: row.description,
      active: row.active,
      items: row.items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        ownerRole: item.ownerRole,
        ownerRoleLabel: ROLE_LABELS[item.ownerRole] || item.ownerRole,
        dueDays: item.dueDays,
        sort: item.sort,
      })),
      updatedAt: iso(row.updatedAt),
    };
  }

  private taskView(row: TaskRow) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      ownerRole: row.ownerRole,
      ownerRoleLabel: ROLE_LABELS[row.ownerRole] || row.ownerRole,
      assigneeUserId: row.assigneeUserId,
      dueAt: isoOr(row.dueAt),
      status: row.status,
      statusLabel: TASK_STATUS_LABELS[row.status] || row.status,
      doneAt: isoOr(row.doneAt),
      note: row.note,
      sort: row.sort,
    };
  }

  private runView(row: RunRow, templateName = '') {
    const done = row.tasks.filter((task) => task.status !== 'TODO').length;
    return {
      id: row.id,
      templateId: row.templateId,
      templateName,
      staffUserId: row.staffUserId,
      memberUserId: row.memberUserId,
      offerId: row.offerId,
      status: row.status,
      statusLabel: RUN_STATUS_LABELS[row.status] || row.status,
      done,
      total: row.tasks.length,
      startedAt: iso(row.startedAt),
      completedAt: isoOr(row.completedAt),
      tasks: row.tasks
        .slice()
        .sort((a, b) => a.sort - b.sort || a.id - b.id)
        .map((task) => this.taskView(task)),
    };
  }

  private async templateNameOf(id: number): Promise<string> {
    const row = await this.prisma.onboardingTemplate.findUnique({
      where: { id },
      select: { name: true },
    });
    return row?.name || '（模板已删除）';
  }

  async templates(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.onboardingTemplate.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { items: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
    });
    return rows.map((row) => this.templateView(row));
  }

  async saveTemplate(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const id = asInt(body.id);
    const name = clip(body.name, 80).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模板名称');
    const items = Array.isArray(body.items)
      ? body.items
          .map((raw) => {
            const item = raw as Row;
            return {
              title: clip(item.title, 120).trim(),
              description: clip(item.description, 500),
              ownerRole: safeStatus(item.ownerRole, ROLES, 'STAFF'),
              dueDays: Math.min(365, Math.max(0, asInt(item.dueDays, 3))),
              sort: Math.max(0, asInt(item.sort)),
            };
          })
          .filter((item) => item.title)
          .slice(0, 100)
      : [];
    if (!items.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条引导事项',
      );
    const data = {
      name,
      kind: safeStatus(body.kind, KINDS, 'HIRE'),
      description: clip(body.description, 500),
      active: body.active !== false,
      createdBy: org.actorId,
    };
    const existing = id
      ? await this.prisma.onboardingTemplate.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '入职模板不存在');
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.onboardingTemplate.update({
            where: { id: existing.id },
            data,
          })
        : await tx.onboardingTemplate.create({
            data: { ...data, orgType: org.orgType, orgUserId: org.orgUserId },
          });
      await tx.onboardingTemplateItem.deleteMany({
        where: { templateId: saved.id },
      });
      for (const item of items) {
        await tx.onboardingTemplateItem.create({
          data: { ...item, templateId: saved.id },
        });
      }
      return tx.onboardingTemplate.findUniqueOrThrow({
        where: { id: saved.id },
        include: { items: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
      });
    });
    return this.templateView(row);
  }

  async removeTemplate(user: CurrentUser, idRaw: number) {
    const org = await this.scope.requireAdmin(user);
    const row = await this.prisma.onboardingTemplate.findFirst({
      where: {
        id: asInt(idRaw),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '入职模板不存在');
    const used = await this.prisma.onboardingRun.count({
      where: { templateId: row.id },
    });
    if (used > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已有入职流程引用该模板，不能删除；请改为停用',
      );
    }
    await this.prisma.$transaction([
      this.prisma.onboardingTemplateItem.deleteMany({
        where: { templateId: row.id },
      }),
      this.prisma.onboardingTemplate.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  async runs(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(asText(query.status).trim()
        ? {
            status: safeStatus(
              query.status,
              ['ACTIVE', 'DONE', 'CANCELED'] as const,
              'ACTIVE',
            ),
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.onboardingRun.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
        include: { tasks: true },
      }),
      this.prisma.onboardingRun.count({ where }),
    ]);
    const names = await this.prisma.onboardingTemplate.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.templateId))] } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(names.map((row) => [row.id, row.name]));
    return {
      list: rows.map((row) =>
        this.runView(row, nameMap.get(row.templateId) || '（模板已删除）'),
      ),
      total,
      page,
      pageSize,
    };
  }

  private async ownedRun(user: CurrentUser, idRaw: string | number) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.onboardingRun.findFirst({
      where: {
        id: asInt(idRaw),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
      include: { tasks: true },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '入职流程不存在');
    return { org, row };
  }

  async run(user: CurrentUser, idRaw: string) {
    const { row } = await this.ownedRun(user, idRaw);
    return this.runView(row, await this.templateNameOf(row.templateId));
  }

  async startRun(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const run = await startOnboardingRun(this.prisma, org, {
      templateId: asInt(body.templateId),
      staffUserId: asText(body.staffUserId).trim(),
      memberUserId: asText(body.memberUserId).trim(),
      offerId: asInt(body.offerId),
      createdBy: org.actorId,
    });
    return this.runView(run, await this.templateNameOf(run.templateId));
  }

  async completeTask(user: CurrentUser, taskRaw: string, body: Row) {
    const org = await this.scope.resolve(user);
    const task = await this.prisma.onboardingTask.findUnique({
      where: { id: asInt(taskRaw) },
      include: { run: true },
    });
    if (
      !task ||
      task.run.orgType !== org.orgType ||
      task.run.orgUserId !== org.orgUserId
    ) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '引导事项不存在');
    }
    const mine =
      task.assigneeUserId === org.actorId ||
      task.run.staffUserId === org.actorId;
    if (!mine) this.scope.requireAdminFor(org);
    const status = safeStatus(
      body.status,
      ['TODO', 'DONE', 'SKIPPED'] as const,
      'DONE',
    );
    await this.prisma.onboardingTask.update({
      where: { id: task.id },
      data: {
        status,
        doneAt: status === 'TODO' ? null : new Date(),
        note: clip(body.note, 500) || task.note,
      },
    });
    const remaining = await this.prisma.onboardingTask.count({
      where: { runId: task.runId, status: 'TODO' },
    });
    if (remaining === 0 && task.run.status === 'ACTIVE') {
      await this.prisma.onboardingRun.update({
        where: { id: task.runId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    }
    const row = await this.prisma.onboardingRun.findUniqueOrThrow({
      where: { id: task.runId },
      include: { tasks: true },
    });
    return this.runView(row, await this.templateNameOf(row.templateId));
  }
}

/** 开工入口：手工发起与 Offer 接受共用；没有启用模板时返回 null（不阻断主链路）。 */
export async function startOnboardingRun(
  prisma: PrismaService,
  org: Pick<HrmOrg, 'orgType' | 'orgUserId' | 'actorId'>,
  input: {
    templateId: number;
    staffUserId: string;
    memberUserId?: string;
    offerId?: number;
    createdBy?: string;
  },
): Promise<RunRow & { templateName: string }> {
  const template = await prisma.onboardingTemplate.findFirst({
    where: {
      id: input.templateId,
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      active: true,
    },
    include: { items: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
  });
  if (!template) {
    throw new BusinessException(ErrorCode.NOT_FOUND, '入职模板不存在或已停用');
  }
  if (!input.staffUserId) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定入职成员');
  }
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingRun.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        templateId: template.id,
        staffUserId: input.staffUserId,
        memberUserId: input.memberUserId || '',
        offerId: input.offerId || 0,
        status: 'ACTIVE',
        createdBy: input.createdBy || org.actorId,
      },
    });
    for (const item of template.items) {
      await tx.onboardingTask.create({
        data: {
          runId: created.id,
          templateItemId: item.id,
          title: item.title,
          description: item.description,
          ownerRole: item.ownerRole,
          assigneeUserId: item.ownerRole === 'STAFF' ? input.staffUserId : '',
          dueAt: dueOf(item.dueDays),
          status: 'TODO',
          sort: item.sort,
        },
      });
    }
    return tx.onboardingRun.findUniqueOrThrow({
      where: { id: created.id },
      include: { tasks: true },
    });
  });
  return { ...run, templateName: template.name };
}

/** Offer 接受后的自动开工：有启用中的 HIRE 模板才建流程，任何异常都不影响入职主链路。 */
export async function startOnboardingForOffer(
  prisma: PrismaService,
  org: Pick<HrmOrg, 'orgType' | 'orgUserId' | 'actorId'>,
  input: { offerId: number; staffUserId: string; memberUserId: string },
): Promise<void> {
  try {
    const existing = await prisma.onboardingRun.count({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        offerId: input.offerId,
      },
    });
    if (existing > 0) return;
    const template = await prisma.onboardingTemplate.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        kind: 'HIRE',
        active: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    if (!template) return;
    await startOnboardingRun(prisma, org, {
      templateId: template.id,
      staffUserId: input.staffUserId,
      memberUserId: input.memberUserId,
      offerId: input.offerId,
      createdBy: org.actorId,
    });
  } catch {
    // 辅助链路：模板配置有误时只跳过一次自动开工，不阻断 Offer 接受。
  }
}
