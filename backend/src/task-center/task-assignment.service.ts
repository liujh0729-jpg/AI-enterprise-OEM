import {
  TASK_ASSIGN_STRATEGY_LABELS,
  TASK_CATEGORIES,
  type TaskAssignmentRuleInput,
  type TaskAssignmentRuleRow,
} from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma, TaskAssignmentRule } from '../../generated/prisma';

function jsonIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * 派单规则维护（决策 D5=A）：服务商负责人自助；平台管理员只有 Audit 只读入口，
 * 没有任何平台侧写入路径，避免平台替机构决定承办人。
 */
export class TaskAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private async orgName(orgUserId: string): Promise<string> {
    const row = await this.prisma.providerApplication.findFirst({
      where: { userId: orgUserId },
      orderBy: { id: 'desc' },
      select: { orgName: true },
    });
    return row?.orgName || orgUserId;
  }

  private async requireOwner(user: CurrentUser, orgUserId: string) {
    if (!orgUserId || orgUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护本机构的派单规则',
      );
    }
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
  }

  private async verifyTargets(
    orgUserId: string,
    strategy: string,
    targets: string[],
  ) {
    if (strategy === 'DIRECT' && targets.length !== 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '「指定承办人」需要且只能选择 1 名职员',
      );
    }
    if (!targets.length) return;
    const binds = await this.prisma.providerStaff.findMany({
      where: {
        providerUserId: orgUserId,
        staffUserId: { in: targets },
        status: 'ACTIVE',
      },
      select: { staffUserId: true },
    });
    const allowed = new Set(binds.map((row) => row.staffUserId));
    if (targets.some((id) => !allowed.has(id))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标职员未绑定本机构或已离职',
      );
    }
  }

  private toRow(
    rule: TaskAssignmentRule,
    orgName: string,
  ): TaskAssignmentRuleRow {
    return {
      id: rule.id,
      orgType: rule.orgType,
      orgUserId: rule.orgUserId,
      orgName,
      source: rule.source,
      category: rule.category,
      region: rule.region,
      strategy: rule.strategy,
      strategyLabel:
        TASK_ASSIGN_STRATEGY_LABELS[rule.strategy] || rule.strategy,
      targets: jsonIds(rule.targets),
      priority: rule.priority,
      enabled: rule.enabled,
      createdAt: rule.createdAt.toISOString(),
    };
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const orgUserId = text(query.orgUserId).trim() || user.userId;
    await this.requireOwner(user, orgUserId);
    const [rows, orgName] = await Promise.all([
      this.prisma.taskAssignmentRule.findMany({
        where: { orgType: 'PROVIDER', orgUserId },
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      }),
      this.orgName(orgUserId),
    ]);
    return rows.map((row) => this.toRow(row, orgName));
  }

  async create(user: CurrentUser, body: TaskAssignmentRuleInput) {
    const orgUserId = text(body.orgUserId).trim() || user.userId;
    await this.requireOwner(user, orgUserId);
    const category = text(body.category).trim() || '*';
    if (category !== '*' && !TASK_CATEGORIES.find((key) => key === category)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知任务类目');
    }
    const targets = [...new Set(body.targets || [])];
    await this.verifyTargets(orgUserId, body.strategy, targets);
    const rule = await this.prisma.taskAssignmentRule.create({
      data: {
        orgType: 'PROVIDER',
        orgUserId,
        source: text(body.source).trim() || '*',
        category,
        region: text(body.region).trim().slice(0, 32),
        strategy: body.strategy,
        targets,
        priority: body.priority ?? 0,
        enabled: body.enabled ?? true,
      },
    });
    return this.toRow(rule, await this.orgName(orgUserId));
  }

  async update(
    user: CurrentUser,
    id: string,
    body: Partial<TaskAssignmentRuleInput>,
  ) {
    const rule = await this.findRule(id);
    await this.requireOwner(user, rule.orgUserId);
    const strategy = text(body.strategy) || rule.strategy;
    const targets = body.targets
      ? [...new Set(body.targets)]
      : jsonIds(rule.targets);
    await this.verifyTargets(rule.orgUserId, strategy, targets);
    const category = text(body.category).trim() || rule.category;
    if (category !== '*' && !TASK_CATEGORIES.find((key) => key === category)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知任务类目');
    }
    const updated = await this.prisma.taskAssignmentRule.update({
      where: { id: rule.id },
      data: {
        source: text(body.source).trim() || rule.source,
        category,
        region:
          body.region === undefined
            ? rule.region
            : text(body.region).trim().slice(0, 32),
        strategy,
        targets,
        priority: body.priority ?? rule.priority,
        enabled: body.enabled ?? rule.enabled,
      },
    });
    return this.toRow(updated, await this.orgName(rule.orgUserId));
  }

  async remove(user: CurrentUser, id: string) {
    const rule = await this.findRule(id);
    await this.requireOwner(user, rule.orgUserId);
    await this.prisma.taskAssignmentRule.delete({ where: { id: rule.id } });
    return { id: rule.id };
  }

  async audit(user: CurrentUser, query: Record<string, unknown>) {
    if (!user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅平台管理员可审计派单规则',
      );
    }
    const page = pageParam(
      query.page as string | number,
      query.pageSize as string | number,
    );
    const orgUserId = text(query.orgUserId).trim();
    const keyword = text(query.keyword).trim();
    const where: Prisma.TaskAssignmentRuleWhereInput = {
      ...(orgUserId ? { orgUserId } : {}),
      ...(keyword
        ? {
            OR: [
              { source: { contains: keyword } },
              { category: { contains: keyword } },
              { orgUserId: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.taskAssignmentRule.count({ where }),
      this.prisma.taskAssignmentRule.findMany({
        where,
        orderBy: [{ orgUserId: 'asc' }, { priority: 'desc' }, { id: 'asc' }],
        skip: page.offset,
        take: page.pageSize,
      }),
    ]);
    const orgIds = [...new Set(rows.map((row) => row.orgUserId))];
    const profiles = orgIds.length
      ? await this.prisma.providerApplication.findMany({
          where: { userId: { in: orgIds } },
          orderBy: { id: 'desc' },
          select: { userId: true, orgName: true },
        })
      : [];
    const names = new Map<string, string>();
    for (const profile of profiles) {
      if (!names.has(profile.userId))
        names.set(profile.userId, profile.orgName);
    }
    const list = rows.map((row) =>
      this.toRow(row, names.get(row.orgUserId) || row.orgUserId),
    );
    return pageOf(list, total, page.page, page.pageSize);
  }

  private async findRule(id: string): Promise<TaskAssignmentRule> {
    const ruleId = Number(id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '派单规则不存在');
    }
    const rule = await this.prisma.taskAssignmentRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '派单规则不存在');
    }
    return rule;
  }
}
