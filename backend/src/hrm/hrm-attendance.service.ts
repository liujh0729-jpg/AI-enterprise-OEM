import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import {
  clip,
  clockMark,
  cursorKey,
  dayStart,
  ds,
  iso,
  workdaysBetween,
} from './hrm.helpers';
import type { HrmOrg, HrmScopeService } from './hrm.scope';

/**
 * 假勤底座（§5.1）：政策（年度额度）→ 余额（首次懒建）→ 申请（工作日扣节假日）→ 审批（通过即扣减、销假退回）。
 * 打卡与补卡走同一条流水（source=WEB|REMEDY），迟到/早退按上班时间基线标记；
 * 节假日含平台全局行（orgUserId=''）与本组织自定义行，工作日计算两者合并生效。
 */

const TIME_OFF_TYPES = [
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'MARRY',
  'BEREAVEMENT',
  'UNPAID',
] as const;
type TimeOffType = (typeof TIME_OFF_TYPES)[number];

/** 内置默认额度（政策未给该假别时回落，天）。 */
export const DEFAULT_QUOTAS: Record<string, number> = {
  ANNUAL: 5,
  SICK: 10,
  PERSONAL: 3,
  MARRY: 3,
  BEREAVEMENT: 3,
  UNPAID: 0,
};

export type SavePolicyInput = {
  year: number;
  name?: string;
  quotas?: Record<string, number>;
  isDefault?: boolean;
};
export type CreateTimeOffInput = {
  type: string;
  startDate: string;
  endDate: string;
  reason?: string;
};
export type DecideTimeOffInput = {
  id: number;
  decision: 'approve' | 'reject' | 'revoke' | 'cancel';
  note?: string;
};
export type RemedyClockInput = {
  logDate: string;
  checkType: 'CLOCK_IN' | 'CLOCK_OUT';
  at: string;
  reason: string;
};
export type AddHolidayInput = {
  holidayDate: string;
  name: string;
  days?: number;
};

export class HrmAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  // ---------- 政策与余额 ----------

  async listPolicies(query: { year?: number }, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const year = query.year ?? new Date().getFullYear();
    const rows = await this.prisma.hrmAttendancePolicy.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, year },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.policyView(row));
  }

  async savePolicy(body: SavePolicyInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const name = clip(body.name || '默认', 64);
    const quotas = this.mergeQuotas(body.quotas);
    if (body.isDefault !== false) {
      await this.prisma.hrmAttendancePolicy.updateMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          year: body.year,
        },
        data: { isDefault: false },
      });
    }
    const row = await this.prisma.hrmAttendancePolicy.upsert({
      where: {
        orgType_orgUserId_year_name: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          year: body.year,
          name,
        },
      },
      create: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        year: body.year,
        name,
        quotas,
        isDefault: body.isDefault !== false,
        updatedBy: org.actorId,
      },
      update: {
        quotas,
        isDefault: body.isDefault !== false,
        updatedBy: org.actorId,
      },
    });
    return this.policyView(row);
  }

  async listBalances(
    query: { year: number; staffUserId?: string },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const staffUserId = await this.scope.requireStaff(
      org,
      query.staffUserId || org.actorId,
      true,
    );
    await this.ensureBalances(org, staffUserId, query.year);
    const rows = await this.prisma.hrmTimeOffBalance.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId,
        year: query.year,
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      staffUserId: row.staffUserId,
      year: row.year,
      type: row.type as TimeOffType,
      totalDays: ds(row.totalDays),
      usedDays: ds(row.usedDays),
    }));
  }

  // ---------- 请假申请与审批 ----------

  async createTimeOff(body: CreateTimeOffInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    if (!TIME_OFF_TYPES.includes(body.type as TimeOffType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的假别');
    }
    const holidays = await this.holidayMap(org, body.startDate, body.endDate);
    const days = workdaysBetween(body.startDate, body.endDate, holidays);
    if (days < 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请假日期区间不合法');
    }
    if (days === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '所选区间全是周末或节假日，无需请假',
      );
    }
    const row = await this.prisma.hrmTimeOffRequest.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: org.actorId,
        type: body.type,
        startDate: clip(body.startDate, 16),
        endDate: clip(body.endDate, 16),
        days,
        reason: clip(body.reason, 500),
        status: 'PENDING',
      },
    });
    return this.timeOffView(row);
  }

  async listTimeOff(
    query: {
      staffUserId?: string;
      status?: string;
      page: number;
      pageSize: number;
    },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const staffFilter = org.isAdmin
      ? query.staffUserId
        ? { staffUserId: query.staffUserId }
        : {}
      : { staffUserId: org.actorId };
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...staffFilter,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmTimeOffRequest.count({ where }),
      this.prisma.hrmTimeOffRequest.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.timeOffView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 审批：approve 才扣余额（额度不足直接拒），revoke 销假退回，cancel 仅本人撤 PENDING。
   * 自批口径收口：申请人本人不得审批自己的单，组织主账号/平台管理员除外（小微组织只有一个人）。
   */
  async decideTimeOff(body: DecideTimeOffInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.hrmTimeOffRequest.findFirst({
      where: { id: body.id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '请假申请不存在');
    this.scope.requireAdmin(org);
    if (row.staffUserId === org.actorId && !org.isOwner && !user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '不能审批本人的请假申请',
      );
    }
    if (body.decision === 'cancel') {
      if (row.staffUserId !== org.actorId) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '只有申请人本人可以撤销自己的申请',
        );
      }
      if (row.status !== 'PENDING') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '已处理的申请不能再撤销',
        );
      }
      const updated = await this.prisma.hrmTimeOffRequest.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', note: clip(body.note, 500) },
      });
      return this.timeOffView(updated);
    }
    if (body.decision === 'approve') {
      if (row.status !== 'PENDING') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '只有待审批的申请可以放行',
        );
      }
      const year =
        Number(String(row.startDate).slice(0, 4)) || new Date().getFullYear();
      await this.ensureBalances(org, row.staffUserId, year, row.type);
      const balance = await this.loadBalance(
        org,
        row.staffUserId,
        year,
        row.type,
      );
      if (!balance) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '余额行初始化失败，请重试',
        );
      }
      const remaining = Number(balance.totalDays) - Number(balance.usedDays);
      if (row.type !== 'UNPAID' && remaining + 1e-9 < Number(row.days)) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `${row.type} 假期余额不足（剩余 ${remaining.toFixed(2)} 天，申请 ${ds(row.days)} 天）`,
        );
      }
      await this.prisma.hrmTimeOffBalance.update({
        where: { id: balance.id },
        data: { usedDays: { increment: Number(row.days) } },
      });
      const updated = await this.prisma.hrmTimeOffRequest.update({
        where: { id: row.id },
        data: {
          status: 'APPROVED',
          approverUserId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500),
        },
      });
      return this.timeOffView(updated);
    }
    if (body.decision === 'reject') {
      if (row.status !== 'PENDING') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '只有待审批的申请可以驳回',
        );
      }
      const updated = await this.prisma.hrmTimeOffRequest.update({
        where: { id: row.id },
        data: {
          status: 'REJECTED',
          approverUserId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500),
        },
      });
      return this.timeOffView(updated);
    }
    // revoke：已批准的单子销假退回额度
    if (row.status !== 'APPROVED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '只有已批准的申请可以销假',
      );
    }
    const year =
      Number(String(row.startDate).slice(0, 4)) || new Date().getFullYear();
    const balance = await this.loadBalance(
      org,
      row.staffUserId,
      year,
      row.type,
    );
    if (!balance) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '找不到该假别的余额行，无法销假',
      );
    }
    await this.prisma.hrmTimeOffBalance.update({
      where: { id: balance.id },
      data: {
        usedDays: {
          decrement: Math.min(Number(balance.usedDays), Number(row.days)),
        },
      },
    });
    const updated = await this.prisma.hrmTimeOffRequest.update({
      where: { id: row.id },
      data: {
        status: 'REVOKED',
        approverUserId: org.actorId,
        decidedAt: new Date(),
        note: clip(body.note, 500),
      },
    });
    return this.timeOffView(updated);
  }

  // ---------- 打卡与节假日 ----------

  /** 自助打卡：当日没有上班卡则记 CLOCK_IN，否则记 CLOCK_OUT（一天一进一出）。 */
  async clock(body: { note?: string }, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const now = new Date();
    const logDate = cursorKey(now);
    const hasIn = await this.prisma.hrmAttendanceLog.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: org.actorId,
        logDate,
        checkType: 'CLOCK_IN',
      },
      select: { id: true },
    });
    const hasOut = await this.prisma.hrmAttendanceLog.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: org.actorId,
        logDate,
        checkType: 'CLOCK_OUT',
      },
      select: { id: true },
    });
    const checkType = hasIn && !hasOut ? 'CLOCK_OUT' : 'CLOCK_IN';
    if (hasIn && hasOut) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '今日上下班卡都已打完，如需修正请走补卡',
      );
    }
    const row = await this.prisma.hrmAttendanceLog.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: org.actorId,
        logDate,
        checkType,
        at: now,
        source: 'WEB',
        mark: clockMark(now, checkType === 'CLOCK_IN' ? 'in' : 'out'),
        note: clip(body.note, 500),
      },
    });
    return this.attendanceView(row);
  }

  /** 补卡：必须写原因，落 REMEDY 流水且标记为正常（迟到/早退不再重算）。 */
  async remedyClock(body: RemedyClockInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    if (!dayStart(body.logDate)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '补卡日期格式应为 YYYY-MM-DD',
      );
    }
    const at = new Date(body.at);
    if (!Number.isFinite(at.getTime())) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '补卡时间格式不合法');
    }
    const row = await this.prisma.hrmAttendanceLog.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: org.actorId,
        logDate: clip(body.logDate, 16),
        checkType: 'REMEDY',
        at,
        source: 'REMEDY',
        mark: 'NORMAL',
        note: `${clip(body.reason, 400)}（补 ${body.checkType}）`.slice(0, 500),
      },
    });
    return this.attendanceView(row);
  }

  async listAttendance(
    query: {
      staffUserId?: string;
      startDate?: string;
      endDate?: string;
      page: number;
      pageSize: number;
    },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const staffFilter = org.isAdmin
      ? query.staffUserId
        ? { staffUserId: query.staffUserId }
        : {}
      : { staffUserId: org.actorId };
    const logDate: Record<string, string> = {};
    if (query.startDate) logDate.gte = query.startDate;
    if (query.endDate) logDate.lte = query.endDate;
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...staffFilter,
      ...(Object.keys(logDate).length ? { logDate } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmAttendanceLog.count({ where }),
      this.prisma.hrmAttendanceLog.findMany({
        where,
        orderBy: [{ logDate: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.attendanceView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listHolidays(query: { year: number }, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const prefix = String(query.year);
    const rows = await this.prisma.hrmHoliday.findMany({
      where: {
        orgUserId: { in: [org.orgUserId, ''] },
        holidayDate: { startsWith: prefix },
      },
      orderBy: { holidayDate: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      holidayDate: row.holidayDate,
      name: row.name,
      days: ds(row.days, 1),
    }));
  }

  async addHoliday(body: AddHolidayInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    if (!dayStart(body.holidayDate)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '节假日日期格式应为 YYYY-MM-DD',
      );
    }
    const row = await this.prisma.hrmHoliday.upsert({
      where: {
        orgType_orgUserId_holidayDate: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          holidayDate: clip(body.holidayDate, 16),
        },
      },
      create: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        holidayDate: clip(body.holidayDate, 16),
        name: clip(body.name, 64),
        days: body.days ?? 1,
      },
      update: { name: clip(body.name, 64), days: body.days ?? 1 },
    });
    return {
      id: row.id,
      holidayDate: row.holidayDate,
      name: row.name,
      days: ds(row.days, 1),
    };
  }

  // ---------- 内部工具 ----------

  private policyView(row: {
    id: number;
    year: number;
    name: string;
    quotas: unknown;
    isDefault: boolean;
    updatedAt: Date;
  }) {
    const quotas: Record<string, number> = {};
    if (
      row.quotas &&
      typeof row.quotas === 'object' &&
      !Array.isArray(row.quotas)
    ) {
      for (const [key, value] of Object.entries(
        row.quotas as Record<string, unknown>,
      )) {
        const n = Number(value);
        if (Number.isFinite(n)) quotas[key] = n;
      }
    }
    return {
      id: row.id,
      year: row.year,
      name: row.name,
      quotas,
      isDefault: row.isDefault,
      updatedAt: iso(row.updatedAt),
    };
  }

  private timeOffView(row: {
    id: number;
    staffUserId: string;
    type: string;
    startDate: string;
    endDate: string;
    days: unknown;
    reason: string;
    status: string;
    approverUserId: string;
    decidedAt: Date | null;
    note: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      staffUserId: row.staffUserId,
      type: row.type as TimeOffType,
      startDate: row.startDate,
      endDate: row.endDate,
      days: ds(row.days),
      reason: row.reason,
      status: row.status,
      approverUserId: row.approverUserId,
      decidedAt: iso(row.decidedAt),
      note: row.note,
      createdAt: iso(row.createdAt),
    };
  }

  private attendanceView(row: {
    id: number;
    staffUserId: string;
    logDate: string;
    checkType: string;
    at: Date;
    source: string;
    mark: string;
    note: string;
  }) {
    return {
      id: row.id,
      staffUserId: row.staffUserId,
      logDate: row.logDate,
      checkType: row.checkType as 'CLOCK_IN' | 'CLOCK_OUT' | 'REMEDY',
      at: iso(row.at),
      source: row.source,
      mark: row.mark as 'NORMAL' | 'LATE' | 'EARLY' | 'ABSENT',
      note: row.note,
    };
  }

  private mergeQuotas(input?: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = { ...DEFAULT_QUOTAS };
    for (const [key, value] of Object.entries(input || {})) {
      if (!TIME_OFF_TYPES.includes(key as TimeOffType)) continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) out[key] = Math.min(365, n);
    }
    return out;
  }

  /** 生效政策：指定 name 缺省取该年 isDefault 行，再无则内置默认额度。 */
  private async quotaOf(
    org: HrmOrg,
    year: number,
  ): Promise<Record<string, number>> {
    const row = await this.prisma.hrmAttendancePolicy.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        year,
        isDefault: true,
      },
    });
    if (!row) return { ...DEFAULT_QUOTAS };
    return this.mergeQuotas(this.policyView(row).quotas);
  }

  /** 余额懒建：按政策额度补齐该人该年假别的行（已存在的不覆盖 totalDays）。 */
  private async ensureBalances(
    org: HrmOrg,
    staffUserId: string,
    year: number,
    onlyType?: string,
  ) {
    const quotas = await this.quotaOf(org, year);
    const types = onlyType ? [onlyType] : [...TIME_OFF_TYPES];
    for (const type of types) {
      const total = quotas[type] ?? 0;
      await this.prisma.hrmTimeOffBalance.upsert({
        where: {
          orgType_orgUserId_staffUserId_year_type: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            staffUserId,
            year,
            type,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          staffUserId,
          year,
          type,
          totalDays: total,
          usedDays: 0,
        },
        update: {},
      });
    }
  }

  private async loadBalance(
    org: HrmOrg,
    staffUserId: string,
    year: number,
    type: string,
  ) {
    return this.prisma.hrmTimeOffBalance.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId,
        year,
        type,
      },
    });
  }

  /** 区间内生效节假日表（本组织 + 平台全局）：date → days。 */
  private async holidayMap(
    org: HrmOrg,
    startDate: string,
    endDate: string,
  ): Promise<Map<string, number>> {
    const start = dayStart(startDate);
    const end = dayStart(endDate);
    const map = new Map<string, number>();
    if (!start || !end) return map;
    const rows = await this.prisma.hrmHoliday.findMany({
      where: {
        orgUserId: { in: [org.orgUserId, ''] },
        holidayDate: { gte: startDate, lte: endDate },
      },
    });
    for (const row of rows) map.set(row.holidayDate, Number(row.days) || 1);
    return map;
  }
}
