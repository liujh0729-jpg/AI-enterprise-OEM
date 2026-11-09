import { PARTY_KIND_LABELS } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';
import { clip, ds, orgKey } from '../hrm/hrm.helpers';
import type { Prisma } from '../../generated/prisma';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

const COST_KINDS = ['LABOR', 'MATERIAL', 'EQUIPMENT', 'EXTERNAL', 'OTHER'];
const COST_KIND_LABELS: Record<string, string> = {
  LABOR: '人工',
  MATERIAL: '物料',
  EQUIPMENT: '设备',
  EXTERNAL: '外部服务',
  OTHER: '其他',
};
const COST_SOURCE_LABELS: Record<string, string> = {
  MANUAL: '手工登记',
  TIMESHEET: '工时审批',
  ERP_PO: '采购单',
  ENGAGEMENT: '外部合作',
};
const ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '履约中',
  ACCEPTING: '待验收',
  SETTLED: '已结算',
  CANCELED: '已取消',
};
const RATE_TYPES = ['STAFF', 'ASSIGNMENT', 'PARTY'];

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round = (value: number, digits = 2) => {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
};
const today = () => new Date().toISOString().slice(0, 10);
const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * 项目成本与外部协作：费率表、成本台账、外部合作全流程。
 * 人工成本按「已审批工时 × 有效期费率」计算，不再重复登记人工台账；
 * 外部合作验收时自动落一条 EXTERNAL 成本项，保证账实一致。
 */
export class ProjectCostService {
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

  private async requireProject(org: HrmOrg, id: number) {
    const row = await this.prisma.pjProject.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
    return row;
  }

  private async requireParty(org: HrmOrg, id: number) {
    const row = await this.prisma.bizParty.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
    return row;
  }

  private async principalNames(
    org: HrmOrg,
    rows: Array<{ principalType: string; principalId: string }>,
  ) {
    const staffIds = rows
      .filter((row) => row.principalType !== 'PARTY')
      .map((row) => row.principalId);
    const partyIds = rows
      .filter((row) => row.principalType === 'PARTY')
      .map((row) => Number(row.principalId))
      .filter((id) => Number.isInteger(id) && id > 0);
    const [staff, parties] = await Promise.all([
      this.scope.names(staffIds),
      partyIds.length
        ? this.prisma.bizParty.findMany({
            where: {
              id: { in: partyIds },
              orgType: org.orgType,
              orgUserId: org.orgUserId,
            },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const partyNames = new Map(
      parties.map((party) => [String(party.id), party.name]),
    );
    return (principalType: string, principalId: string) =>
      principalType === 'PARTY'
        ? partyNames.get(principalId) || ''
        : staff.get(principalId) || '';
  }

  // ------------------------------------------------------------------
  // 费率
  // ------------------------------------------------------------------

  async listCostRates(
    user: CurrentUser,
    query: PageQuery & { principalType?: string; q?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.PjCostRateWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.principalType ? { principalType: query.principalType } : {}),
    };
    const keyword = (query.q || '').trim().toLowerCase();
    // 关键词匹配的是跨表解析出来的姓名，只能在取数后过滤，因此带关键词时先全量再分页。
    const rows = await this.prisma.pjCostRate.findMany({
      where,
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      ...(keyword
        ? {}
        : { skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    });
    const nameOf = await this.principalNames(org, rows);
    const mapped = rows.map((row) => ({
      id: row.id,
      principalType: row.principalType,
      principalId: row.principalId,
      principalName:
        nameOf(row.principalType, row.principalId) || row.principalId,
      role: row.role,
      hourlyRate: ds(row.hourlyRate),
      dailyRate: ds(row.dailyRate),
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
    if (!keyword) {
      const total = await this.prisma.pjCostRate.count({ where });
      return {
        list: mapped,
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }
    const filtered = mapped.filter(
      (row) =>
        row.principalName.toLowerCase().includes(keyword) ||
        row.role.toLowerCase().includes(keyword),
    );
    return {
      list: filtered.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      ),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveCostRate(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const principalType = text(body.principalType) || 'STAFF';
    if (!RATE_TYPES.includes(principalType))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '费率主体类型不合法');
    const principalId = clip(body.principalId, 64);
    if (!principalId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择费率主体');
    if (principalType === 'PARTY') {
      await this.requireParty(org, Number(principalId));
    } else {
      await this.scope.requireStaff(org, principalId, false);
    }
    const data = {
      principalType,
      principalId,
      role: clip(body.role, 64),
      hourlyRate: num(body.hourlyRate),
      dailyRate: num(body.dailyRate),
      currency: clip(body.currency, 8) || 'CNY',
      effectiveFrom: clip(body.effectiveFrom, 16) || today(),
      effectiveTo: clip(body.effectiveTo, 16),
    };
    if (data.effectiveTo && data.effectiveTo < data.effectiveFrom)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '生效止日期不能早于生效起日期',
      );
    const id = num(body.id);
    if (id) {
      const existing = await this.prisma.pjCostRate.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        select: { id: true },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '费率不存在');
    }
    const duplicate = await this.prisma.pjCostRate.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        principalType,
        principalId,
        effectiveFrom: data.effectiveFrom,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该主体在此生效日已有费率',
      );
    const row = id
      ? await this.prisma.pjCostRate.update({ where: { id }, data })
      : await this.prisma.pjCostRate.create({
          data: { ...orgKey(org), ...data },
        });
    const nameOf = await this.principalNames(org, [row]);
    return {
      id: row.id,
      principalType: row.principalType,
      principalId: row.principalId,
      principalName:
        nameOf(row.principalType, row.principalId) || row.principalId,
      role: row.role,
      hourlyRate: ds(row.hourlyRate),
      dailyRate: ds(row.dailyRate),
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async removeCostRate(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = num(body.id);
    const row = await this.prisma.pjCostRate.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '费率不存在');
    const used = await this.prisma.pjTimeLog.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        principalType: row.principalType,
        principalId: row.principalId,
        status: 'APPROVED',
        workDate: { gte: row.effectiveFrom || '' },
      },
      select: { id: true },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该费率已参与已审批工时的成本计算，不能删除；请新增费率覆盖后续期间',
      );
    await this.prisma.pjCostRate.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  // ------------------------------------------------------------------
  // 成本台账
  // ------------------------------------------------------------------

  private costItemView(
    row: {
      id: number;
      projectId: number;
      kind: string;
      title: string;
      qty: unknown;
      unit: string;
      unitCost: unknown;
      amount: unknown;
      currency: string;
      sourceType: string;
      sourceId: string;
      occurredAt: string;
      note: string;
      createdBy: string;
      createdAt: Date;
    },
    projectName: string,
  ) {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      kind: row.kind,
      kindLabel: COST_KIND_LABELS[row.kind] || row.kind,
      title: row.title,
      qty: ds(row.qty),
      unit: row.unit,
      unitCost: ds(row.unitCost),
      amount: ds(row.amount),
      currency: row.currency,
      sourceType: row.sourceType,
      sourceTypeLabel: COST_SOURCE_LABELS[row.sourceType] || row.sourceType,
      sourceId: row.sourceId,
      occurredAt: row.occurredAt,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async projectNames(projectIds: number[]) {
    const rows = projectIds.length
      ? await this.prisma.pjProject.findMany({
          where: { id: { in: [...new Set(projectIds)] } },
          select: { id: true, name: true },
        })
      : [];
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async listCostItems(
    user: CurrentUser,
    query: PageQuery & { projectId?: number; kind?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.PjCostItemWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjCostItem.count({ where }),
      this.prisma.pjCostItem.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const names = await this.projectNames(rows.map((row) => row.projectId));
    return {
      list: rows.map((row) =>
        this.costItemView(row, names.get(row.projectId) || ''),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveCostItem(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const project = await this.requireProject(org, num(body.projectId));
    const kind = text(body.kind) || 'OTHER';
    if (!COST_KINDS.includes(kind))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '成本科目不合法');
    if (kind === 'LABOR')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '人工成本由已审批工时 × 费率自动计算，请维护工时与费率',
      );
    const qty = num(body.qty, 1);
    const unitCost = num(body.unitCost);
    const data = {
      projectId: project.id,
      kind,
      title: clip(body.title, 120) || COST_KIND_LABELS[kind],
      qty,
      unit: clip(body.unit, 16),
      unitCost,
      amount: round(qty * unitCost),
      currency: clip(body.currency, 8) || project.currency,
      sourceType: 'MANUAL',
      sourceId: '',
      occurredAt: clip(body.occurredAt, 16) || today(),
      note: clip(body.note, 500),
    };
    const id = num(body.id);
    let row;
    if (id) {
      const existing = await this.prisma.pjCostItem.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '成本项不存在');
      if (existing.sourceType !== 'MANUAL')
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '系统归集的成本项不能直接修改',
        );
      row = await this.prisma.pjCostItem.update({ where: { id }, data });
    } else {
      row = await this.prisma.pjCostItem.create({
        data: { ...orgKey(org), ...data, createdBy: org.actorId },
      });
    }
    this.emit(org, 'project.cost.updated', {
      projectId: project.id,
      costItemId: row.id,
      kind: row.kind,
      amount: ds(row.amount),
    });
    return this.costItemView(row, project.name);
  }

  async removeCostItem(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjCostItem.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成本项不存在');
    if (row.sourceType !== 'MANUAL')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '系统归集的成本项不能直接删除；请取消对应外部合作',
      );
    await this.prisma.pjCostItem.delete({ where: { id: row.id } });
    this.emit(org, 'project.cost.updated', {
      projectId: row.projectId,
      costItemId: row.id,
      removed: true,
    });
    return { id: row.id };
  }

  /**
   * 按有效期匹配费率：同一主体取 effectiveFrom ≤ 工时日期的最新一条，
   * 且 effectiveTo 未过期；只填日薪时按标准工时折算小时费率。
   */
  private async laborAmount(
    org: HrmOrg,
    projectId: number,
    standardHoursPerDay: number,
  ) {
    const logs = await this.prisma.pjTimeLog.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        projectId,
        status: 'APPROVED',
      },
      select: {
        principalType: true,
        principalId: true,
        workDate: true,
        durationMinutes: true,
      },
    });
    if (!logs.length) return { amount: 0, minutes: 0, missingMinutes: 0 };
    const rates = await this.prisma.pjCostRate.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        principalId: { in: [...new Set(logs.map((log) => log.principalId))] },
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    const byPrincipal = new Map<string, typeof rates>();
    for (const rate of rates) {
      const key = `${rate.principalType}:${rate.principalId}`;
      const list = byPrincipal.get(key) || [];
      list.push(rate);
      byPrincipal.set(key, list);
    }
    let amount = 0;
    let minutes = 0;
    let missingMinutes = 0;
    for (const log of logs) {
      minutes += log.durationMinutes;
      const candidates = (
        byPrincipal.get(`${log.principalType}:${log.principalId}`) || []
      ).filter(
        (rate) =>
          (!rate.effectiveFrom || rate.effectiveFrom <= log.workDate) &&
          (!rate.effectiveTo || rate.effectiveTo >= log.workDate),
      );
      const rate = candidates[candidates.length - 1];
      if (!rate) {
        missingMinutes += log.durationMinutes;
        continue;
      }
      const hourly =
        num(rate.hourlyRate) > 0
          ? num(rate.hourlyRate)
          : num(rate.dailyRate) / Math.max(1, standardHoursPerDay);
      if (hourly <= 0) {
        missingMinutes += log.durationMinutes;
        continue;
      }
      amount += (log.durationMinutes / 60) * hourly;
    }
    return {
      amount: round(amount),
      minutes,
      missingMinutes,
    };
  }

  async projectCost(user: CurrentUser, rawId: string) {
    const org = await this.org(user);
    const project = await this.requireProject(org, Number(rawId));
    const [settings, items, engagements] = await Promise.all([
      this.prisma.pjSettings.findUnique({
        where: {
          orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
        },
        select: { standardHoursPerDay: true },
      }),
      this.prisma.pjCostItem.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          projectId: project.id,
        },
        select: { kind: true, amount: true },
      }),
      this.prisma.pjEngagement.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          projectId: project.id,
        },
        select: { amount: true, status: true },
      }),
    ]);
    const standardHours = settings?.standardHoursPerDay || 8;
    const labor = await this.laborAmount(org, project.id, standardHours);
    const totals: Record<string, { amount: number; items: number }> = {};
    for (const kind of COST_KINDS) totals[kind] = { amount: 0, items: 0 };
    for (const item of items) {
      const bucket = totals[item.kind] || totals.OTHER;
      bucket.amount += num(item.amount);
      bucket.items += 1;
    }
    totals.LABOR = { amount: labor.amount, items: labor.minutes > 0 ? 1 : 0 };
    const costTotal = round(
      COST_KINDS.reduce((sum, kind) => sum + totals[kind].amount, 0),
    );
    const budgetAmount = num(project.budgetAmount);
    return {
      projectId: project.id,
      currency: project.currency,
      budgetAmount: ds(project.budgetAmount),
      budgetHours: ds(project.budgetHours),
      costTotal: ds(costTotal),
      budgetUtilizationPct: budgetAmount
        ? Math.round((costTotal / budgetAmount) * 100)
        : 0,
      laborAmount: ds(totals.LABOR.amount),
      materialAmount: ds(totals.MATERIAL.amount),
      equipmentAmount: ds(totals.EQUIPMENT.amount),
      externalAmount: ds(totals.EXTERNAL.amount),
      otherAmount: ds(totals.OTHER.amount),
      timeLogMinutes: labor.minutes,
      timeLogHours: ds(round(labor.minutes / 60)),
      missingRateMinutes: labor.missingMinutes,
      engagementAmount: engagements
        .reduce((sum, row) => sum + num(row.amount), 0)
        .toFixed(2),
      engagementCount: engagements.length,
      settledEngagementCount: engagements.filter(
        (row) => row.status === 'SETTLED',
      ).length,
      costItemCount: items.length,
      byKind: COST_KINDS.map((kind) => ({
        kind,
        label: COST_KIND_LABELS[kind],
        amount: ds(totals[kind].amount),
        items: totals[kind].items,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 外部合作
  // ------------------------------------------------------------------

  private engagementView(
    row: {
      id: number;
      projectId: number;
      partyId: number;
      scope: string;
      contractId: number;
      amount: unknown;
      currency: string;
      paymentTerms: string;
      acceptance: unknown;
      startDate: string;
      endDate: string;
      status: string;
      createdBy: string;
      createdAt: Date;
      updatedAt: Date;
    },
    projectName: string,
    party: { name: string; kind: string } | undefined,
  ) {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      partyId: row.partyId,
      partyName: party?.name || '',
      partyKind: party?.kind || '',
      partyKindLabel: party ? PARTY_KIND_LABELS[party.kind] || party.kind : '',
      scope: row.scope,
      contractId: row.contractId,
      amount: ds(row.amount),
      currency: row.currency,
      paymentTerms: row.paymentTerms,
      acceptance: jsonObject(row.acceptance),
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      statusLabel: ENGAGEMENT_STATUS_LABELS[row.status] || row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async engagementContext(
    rows: Array<{ projectId: number; partyId: number }>,
  ) {
    const [projects, parties] = await Promise.all([
      this.prisma.pjProject.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.projectId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.bizParty.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.partyId))] } },
        select: { id: true, name: true, kind: true },
      }),
    ]);
    return {
      projectNames: new Map(projects.map((row) => [row.id, row.name])),
      parties: new Map(parties.map((row) => [row.id, row])),
    };
  }

  async listEngagements(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      partyId?: number;
      status?: string;
    },
  ) {
    const org = await this.org(user);
    const where: Prisma.PjEngagementWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjEngagement.count({ where }),
      this.prisma.pjEngagement.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const { projectNames, parties } = await this.engagementContext(rows);
    return {
      list: rows.map((row) =>
        this.engagementView(
          row,
          projectNames.get(row.projectId) || '',
          parties.get(row.partyId),
        ),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveEngagement(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const project = await this.requireProject(org, num(body.projectId));
    const party = await this.requireParty(org, num(body.partyId));
    const id = num(body.id);
    const existing = id
      ? await this.prisma.pjEngagement.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部合作不存在');
    if (existing?.status === 'SETTLED' || existing?.status === 'CANCELED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已结算或已取消的合作不能修改',
      );
    const data = {
      projectId: project.id,
      partyId: party.id,
      scope: clip(body.scope, 500),
      contractId: num(body.contractId),
      amount: num(body.amount),
      currency: clip(body.currency, 8) || project.currency,
      paymentTerms: clip(body.paymentTerms, 200),
      acceptance: jsonObject(body.acceptance) as Prisma.InputJsonValue,
      startDate: clip(body.startDate, 16),
      endDate: clip(body.endDate, 16),
    };
    const row = existing
      ? await this.prisma.pjEngagement.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.pjEngagement.create({
          data: { ...orgKey(org), ...data, createdBy: org.actorId },
        });
    this.emit(org, id ? 'engagement.updated' : 'engagement.created', {
      engagementId: row.id,
      projectId: row.projectId,
      partyId: row.partyId,
      amount: ds(row.amount),
    });
    return this.engagementView(row, project.name, {
      name: party.name,
      kind: party.kind,
    });
  }

  async decideEngagement(user: CurrentUser, rawId: string, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = Number(rawId);
    const row = await this.prisma.pjEngagement.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部合作不存在');
    const decision = text(body.decision);
    const next =
      decision === 'start'
        ? 'ACTIVE'
        : decision === 'submit'
          ? 'ACCEPTING'
          : decision === 'accept'
            ? 'SETTLED'
            : decision === 'cancel'
              ? 'CANCELED'
              : '';
    if (!next)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持的流转动作');
    const allowed: Record<string, string[]> = {
      ACTIVE: ['DRAFT'],
      ACCEPTING: ['ACTIVE'],
      SETTLED: ['ACCEPTING'],
      CANCELED: ['DRAFT', 'ACTIVE', 'ACCEPTING'],
    };
    if (!allowed[next].includes(row.status))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前状态（${ENGAGEMENT_STATUS_LABELS[row.status] || row.status}）不能执行该动作`,
      );
    const acceptance =
      next === 'SETTLED'
        ? {
            ...jsonObject(row.acceptance),
            acceptedAt: today(),
            acceptedBy: org.actorId,
            note: clip(body.note, 500),
          }
        : jsonObject(row.acceptance);
    const saved = await this.prisma.pjEngagement.update({
      where: { id: row.id },
      data: {
        status: next,
        acceptance: acceptance as Prisma.InputJsonValue,
      },
    });
    if (next === 'SETTLED') {
      const existingItem = await this.prisma.pjCostItem.findFirst({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          sourceType: 'ENGAGEMENT',
          sourceId: String(row.id),
        },
      });
      const party = await this.requireParty(org, row.partyId);
      const itemData = {
        projectId: row.projectId,
        kind: 'EXTERNAL',
        title: `外部合作：${party.name}`.slice(0, 120),
        qty: 1,
        unit: '项',
        unitCost: row.amount,
        amount: row.amount,
        currency: row.currency,
        occurredAt: today(),
        note: clip(body.note, 500) || `合作 #${row.id} 验收通过`,
      };
      if (existingItem) {
        await this.prisma.pjCostItem.update({
          where: { id: existingItem.id },
          data: itemData,
        });
      } else {
        await this.prisma.pjCostItem.create({
          data: {
            ...orgKey(org),
            ...itemData,
            sourceType: 'ENGAGEMENT',
            sourceId: String(row.id),
            createdBy: org.actorId,
          },
        });
      }
    }
    if (next === 'CANCELED') {
      await this.prisma.pjCostItem.deleteMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          sourceType: 'ENGAGEMENT',
          sourceId: String(row.id),
        },
      });
    }
    this.emit(org, `engagement.${next.toLowerCase()}`, {
      engagementId: saved.id,
      projectId: saved.projectId,
      partyId: saved.partyId,
      amount: ds(saved.amount),
    });
    const project = await this.requireProject(org, saved.projectId);
    const party = await this.requireParty(org, saved.partyId);
    return this.engagementView(saved, project.name, {
      name: party.name,
      kind: party.kind,
    });
  }

  async removeEngagement(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = num(body.id);
    const row = await this.prisma.pjEngagement.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外部合作不存在');
    if (row.status === 'SETTLED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已结算的合作不能删除；如需终止请先撤销验收',
      );
    await this.prisma.$transaction([
      this.prisma.pjCostItem.deleteMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          sourceType: 'ENGAGEMENT',
          sourceId: String(row.id),
        },
      }),
      this.prisma.pjEngagement.delete({ where: { id: row.id } }),
    ]);
    return { id: row.id };
  }
}
