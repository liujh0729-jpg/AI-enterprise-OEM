import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import {
  asDate,
  asInt,
  asNum,
  asText,
  clip,
  iso,
  periodOf,
  Row,
} from './gaps.helpers';

const AUDIENCE_LABELS: Record<string, string> = {
  USER: '个人版',
  ENTERPRISE: '企业版',
  PROVIDER: '服务商版',
};

type PlanRow = {
  id: number;
  code: string;
  name: string;
  audience: string;
  description: string;
  priceMonthly: unknown;
  status: string;
  updatedAt: Date;
};

type QuotaRow = {
  planCode: string;
  featureCode: string;
  access: string;
  limitCount: number;
  unit: string;
  note: string;
};

/**
 * B1#2 权益配额目录：套餐目录由平台维护，组织挂套餐后按 featureCode 校验可用性与月度上限。
 * 未配置任何套餐时不做限制（不凭空给组织设一个假的付费墙）。
 */
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private planView(plan: PlanRow, quotas: QuotaRow[]) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      audience: plan.audience,
      audienceLabel: AUDIENCE_LABELS[plan.audience] || plan.audience,
      description: plan.description,
      priceMonthly: asNum(plan.priceMonthly),
      status: plan.status,
      quotas: quotas
        .filter((q) => q.planCode === plan.code)
        .map((q) => ({
          featureCode: q.featureCode,
          access: q.access,
          limitCount: q.limitCount,
          unit: q.unit,
          note: q.note,
        })),
      updatedAt: iso(plan.updatedAt),
    };
  }

  async listPlans(user: CurrentUser) {
    await this.scope.resolve(user);
    const [plans, quotas] = await Promise.all([
      this.prisma.entitlementPlan.findMany({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: [{ audience: 'asc' }, { priceMonthly: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.entitlementQuota.findMany(),
    ]);
    return plans.map((plan) => this.planView(plan, quotas));
  }

  async savePlan(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const id = asInt(body.id);
    const code = asText(body.code).trim().toUpperCase().slice(0, 32);
    if (code.length < 2) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写套餐编码（至少 2 位）',
      );
    }
    const name = asText(body.name).trim().slice(0, 64);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写套餐名称');
    const data = {
      code,
      name,
      audience: ['USER', 'ENTERPRISE', 'PROVIDER'].includes(
        asText(body.audience),
      )
        ? asText(body.audience)
        : 'ENTERPRISE',
      description: clip(body.description, 500),
      priceMonthly: Math.max(0, asNum(body.priceMonthly)),
      status: asText(body.status) === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    };
    const existing = id
      ? await this.prisma.entitlementPlan.findUnique({ where: { id } })
      : await this.prisma.entitlementPlan.findUnique({ where: { code } });
    const plan = existing
      ? await this.prisma.entitlementPlan.update({
          where: { id: existing.id },
          data: { ...data, code: existing.code },
        })
      : await this.prisma.entitlementPlan.create({ data });
    const quotas = Array.isArray(body.quotas) ? body.quotas : [];
    await this.prisma.$transaction([
      this.prisma.entitlementQuota.deleteMany({
        where: { planCode: plan.code },
      }),
      ...quotas.slice(0, 300).map((raw) => {
        const quota = raw as Row;
        return this.prisma.entitlementQuota.create({
          data: {
            planCode: plan.code,
            featureCode: clip(quota.featureCode, 64) || 'unknown',
            access: asText(quota.access) === 'denied' ? 'denied' : 'allowed',
            limitCount: Math.max(-1, asInt(quota.limitCount, -1)),
            unit: clip(quota.unit, 16),
            note: clip(quota.note, 200),
          },
        });
      }),
    ]);
    const fresh = await this.prisma.entitlementQuota.findMany({
      where: { planCode: plan.code },
    });
    return this.planView(plan, fresh);
  }

  async removePlan(user: CurrentUser, idRaw: number) {
    this.scope.requirePlatformAdmin(user);
    const plan = await this.prisma.entitlementPlan.findUnique({
      where: { id: idRaw },
    });
    if (!plan) throw new BusinessException(ErrorCode.NOT_FOUND, '套餐不存在');
    const used = await this.prisma.orgEntitlement.count({
      where: { planCode: plan.code, status: 'ACTIVE' },
    });
    if (used > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `仍有 ${used} 个组织使用该套餐，请先改派后再删除`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.entitlementQuota.deleteMany({
        where: { planCode: plan.code },
      }),
      this.prisma.entitlementPlan.delete({ where: { id: plan.id } }),
    ]);
    return { removed: true };
  }

  /** 手工指定组织套餐；分配前校验套餐存在且启用。 */
  async assign(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const orgUserId = asText(body.orgUserId).trim() || String(user.userId);
    const planCode = asText(body.planCode).trim();
    const plan = await this.prisma.entitlementPlan.findUnique({
      where: { code: planCode },
    });
    if (!plan || plan.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐不存在或已归档');
    }
    const expiresAt = asDate(body.expiresAt);
    await this.prisma.orgEntitlement.upsert({
      where: { orgType_orgUserId: { orgType: 'ENTERPRISE', orgUserId } },
      create: {
        orgType: 'ENTERPRISE',
        orgUserId,
        planCode,
        source: 'MANUAL',
        expiresAt,
        updatedBy: user.userId,
      },
      update: {
        planCode,
        source: 'MANUAL',
        status: 'ACTIVE',
        expiresAt,
        updatedBy: user.userId,
      },
    });
    return this.orgPlan(user, { orgUserId });
  }

  /** 组织当前套餐：手工指定优先，否则按主体类型取平台默认（价格最低的启用套餐）。 */
  async orgPlan(user: CurrentUser, query: Row = {}) {
    const own = await this.scope.resolve(user);
    const orgType = asText(query.orgType) || own.orgType;
    const orgUserId = asText(query.orgUserId) || own.orgUserId;
    if (orgUserId !== own.orgUserId && !user.isAdmin()) {
      const member = await this.prisma.orgStaff.findFirst({
        where: {
          orgType,
          orgUserId,
          memberUserId: user.userId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!member) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '无权查看其他组织的套餐',
        );
      }
    }
    const row = await this.prisma.orgEntitlement.findUnique({
      where: { orgType_orgUserId: { orgType, orgUserId } },
    });
    const expired = row?.expiresAt
      ? row.expiresAt.getTime() < Date.now()
      : false;
    const manual =
      row && row.status === 'ACTIVE' && !expired
        ? await this.prisma.entitlementPlan.findUnique({
            where: { code: row.planCode },
          })
        : null;
    const plan =
      manual ||
      (await this.prisma.entitlementPlan.findFirst({
        where: { audience: orgType, status: 'ACTIVE' },
        orderBy: [{ priceMonthly: 'asc' }, { id: 'asc' }],
      }));
    const period = periodOf();
    const quotas = plan
      ? await this.prisma.entitlementQuota.findMany({
          where: { planCode: plan.code },
        })
      : [];
    const usage = plan
      ? await this.prisma.entitlementUsage.findMany({
          where: {
            orgType,
            orgUserId,
            period,
            featureCode: { in: quotas.map((q) => q.featureCode) },
          },
        })
      : [];
    const usedOf = new Map(usage.map((u) => [u.featureCode, u.usedCount]));
    return {
      orgType,
      orgUserId,
      planCode: plan?.code || '',
      planName: plan?.name || '未配置套餐',
      audience: plan?.audience || orgType,
      source: manual ? 'MANUAL' : 'DEFAULT',
      status: manual ? 'ACTIVE' : plan ? 'DEFAULT' : 'NONE',
      startedAt: iso(row?.startedAt),
      expiresAt: iso(row?.expiresAt),
      quotas: quotas.map((q) => ({
        featureCode: q.featureCode,
        access: q.access,
        limitCount: q.limitCount,
        unit: q.unit,
        note: q.note,
        usedCount: usedOf.get(q.featureCode) || 0,
        period,
      })),
    };
  }

  /**
   * 写操作前的配额校验 + 计数：denied 直接拒绝，limitCount>=0 时按月累计并比较。
   * 未配置该 featureCode 视为不限制（只记用量，不拦业务）。
   */
  async consume(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    const featureCode = asText(body.featureCode).trim().slice(0, 64);
    const quantity = Math.max(1, asInt(body.quantity, 1));
    if (!featureCode) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定功能编码');
    }
    return this.check(org.orgType, org.orgUserId, featureCode, quantity);
  }

  async check(
    orgType: string,
    orgUserId: string,
    featureCode: string,
    quantity = 1,
  ): Promise<{ allowed: boolean; used: number; limit: number }> {
    const period = periodOf();
    const orgView = { orgType, orgUserId };
    const row = await this.prisma.orgEntitlement.findUnique({
      where: { orgType_orgUserId: orgView },
    });
    const manual =
      row &&
      row.status === 'ACTIVE' &&
      !(row.expiresAt && row.expiresAt.getTime() < Date.now())
        ? await this.prisma.entitlementPlan.findUnique({
            where: { code: row.planCode },
          })
        : null;
    const plan =
      manual ||
      (await this.prisma.entitlementPlan.findFirst({
        where: { audience: orgType, status: 'ACTIVE' },
        orderBy: [{ priceMonthly: 'asc' }, { id: 'asc' }],
      }));
    if (!plan) return { allowed: true, used: 0, limit: -1 };
    const quota = await this.prisma.entitlementQuota.findUnique({
      where: { planCode_featureCode: { planCode: plan.code, featureCode } },
    });
    const usage = await this.prisma.entitlementUsage.findUnique({
      where: {
        orgType_orgUserId_featureCode_period: {
          ...orgView,
          featureCode,
          period,
        },
      },
    });
    const used = usage?.usedCount || 0;
    if (quota?.access === 'denied') {
      return { allowed: false, used, limit: quota.limitCount };
    }
    const limit = quota?.limitCount ?? -1;
    if (limit >= 0 && used + quantity > limit) {
      return { allowed: false, used, limit };
    }
    await this.prisma.entitlementUsage.upsert({
      where: {
        orgType_orgUserId_featureCode_period: {
          ...orgView,
          featureCode,
          period,
        },
      },
      create: { ...orgView, featureCode, period, usedCount: quantity },
      update: { usedCount: { increment: quantity } },
    });
    return { allowed: true, used: used + quantity, limit };
  }

  /** 业务写入口使用：超限直接 403，错误信息能直接展示给用户。 */
  async require(
    orgType: string,
    orgUserId: string,
    featureCode: string,
    quantity = 1,
  ): Promise<void> {
    const result = await this.check(orgType, orgUserId, featureCode, quantity);
    if (!result.allowed) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        result.limit >= 0
          ? `本月「${featureCode}」额度已用完（${result.used}/${result.limit}），请升级套餐或联系管理员`
          : `当前套餐未开放「${featureCode}」`,
      );
    }
  }
}
