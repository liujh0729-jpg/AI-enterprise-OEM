import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { clip, ds, gridCellOf, iso } from './hrm.helpers';
import type { HrmScopeService } from './hrm.scope';
import { startOnboardingForOffer } from '../gaps/onboarding.service';
import {
  DEFAULT_RUBRIC_SEED,
  ensureActiveRubric,
  rubricView,
} from '../talent-match/talent-match.rubric';

/**
 * HRM 后半段（§5.1/§12.9）：Offer 接受即打通入转调离、述职九宫格、rubric 模板版本化。
 * Offer 只做「候选人 → 在职员工」的档案落地；薪酬发放仍走既有发薪通道，不在本模块重复。
 */

type OfferRow = {
  id: number;
  applicationId: number;
  candidateId: number;
  jobId: number;
  salaryMonthly: unknown;
  startAt: string;
  status: string;
  memberUserId: string;
  orgStaffId: number;
  note: string;
  createdAt: Date;
};

type ReviewRow = {
  id: number;
  staffUserId: string;
  period: string;
  kind: string;
  performanceScore: unknown;
  potentialScore: unknown;
  gridCell: number;
  summary: string;
  status: string;
  reviewerUserId: string;
  updatedAt: Date;
};

export type CreateOfferInput = {
  applicationId: number;
  salaryMonthly: number;
  startAt: string;
  note?: string;
};

export type DecideOfferInput = {
  id: number;
  decision: 'accept' | 'decline';
  memberUserId?: string;
};

export type UpsertReviewInput = {
  staffUserId: string;
  period: string;
  kind?: string;
  performanceScore: number;
  potentialScore: number;
  summary?: string;
  status?: string;
};

export type SaveRubricInput = {
  code?: string;
  dimensions: { key: string; label: string; description?: string }[];
  weights: Record<string, number>;
  thresholds?: Record<string, number>;
  tierLexicon?: string[];
  promptDigest?: string;
};

export class HrmLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  // ---------- Offer ----------

  async createOffer(body: CreateOfferInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const application = await this.prisma.hrmApplication.findFirst({
      where: {
        id: body.applicationId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!application) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.hrmOffer.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          applicationId: application.id,
          candidateId: application.candidateId,
          jobId: application.jobId,
          salaryMonthly: body.salaryMonthly,
          startAt: clip(body.startAt, 16),
          note: clip(body.note, 500),
          createdBy: org.actorId,
        },
      });
      await tx.hrmApplication.update({
        where: { id: application.id },
        data: { status: 'OFFER', decidedBy: org.actorId },
      });
      return offer;
    });
    return this.offerView(created);
  }

  async decideOffer(body: DecideOfferInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const offer = await this.prisma.hrmOffer.findFirst({
      where: { id: body.id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!offer)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'Offer 不存在');
    if (offer.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该 Offer 已处理');
    }
    if (body.decision === 'decline') {
      const updated = await this.prisma.hrmOffer.update({
        where: { id: offer.id },
        data: { status: 'DECLINED' },
      });
      return this.offerView(updated);
    }
    const memberUserId = clip(body.memberUserId, 64);
    const accountId = Number(memberUserId);
    if (!memberUserId || !Number.isInteger(accountId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '接受 Offer 需指定入职成员账号',
      );
    }
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '入职成员账号不存在');
    }
    const [job, candidate] = await Promise.all([
      this.prisma.hrmJob.findUnique({ where: { id: offer.jobId } }),
      this.prisma.hrmCandidate.findUnique({ where: { id: offer.candidateId } }),
    ]);
    const department = job?.department || '';
    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.orgStaff.upsert({
        where: {
          orgType_orgUserId_memberUserId: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            memberUserId,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
          memberKind: 'STAFF',
          roles: ['STAFF'],
          department,
          status: 'ACTIVE',
          invitedBy: org.actorId,
          confirmedAt: new Date(),
        },
        update: { status: 'ACTIVE', department },
      });
      // 再入职（上一次离职已清空角色）时补回基础职员角色，保留已有的其它角色。
      const roles = Array.isArray(staff.roles) ? (staff.roles as unknown[]) : [];
      if (!roles.length) {
        await tx.orgStaff.update({
          where: { id: staff.id },
          data: { roles: ['STAFF'] },
        });
      }
      await tx.hrmEmployeeProfile.upsert({
        where: {
          orgType_orgUserId_memberUserId: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            memberUserId,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
          employmentType: 'FULL_TIME',
          department,
          skills: candidate?.skills ?? [],
          status: 'PROBATION',
          joinedAt: clip(offer.startAt, 16),
          note: clip(candidate?.name, 500),
        },
        update: {
          status: 'PROBATION',
          joinedAt: clip(offer.startAt, 16),
          department,
        },
      });
      return tx.hrmOffer.update({
        where: { id: offer.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          memberUserId,
          orgStaffId: staff.id,
        },
      });
    });
    await startOnboardingForOffer(this.prisma, org, {
      offerId: updated.id,
      staffUserId: memberUserId,
      memberUserId,
      positionName: job?.title || '',
    });
    return this.offerView(updated);
  }

  async listOffers(
    query: { status?: string; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    // 到岗日期已过仍未处理的 Offer 视为过期，避免待处理清单长期挂着无效 Offer。
    const todayStr = new Date().toISOString().slice(0, 10);
    await this.prisma.hrmOffer.updateMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'PENDING',
        startAt: { lt: todayStr, not: '' },
      },
      data: { status: 'EXPIRED' },
    });
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmOffer.count({ where }),
      this.prisma.hrmOffer.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.offerView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ---------- 述职 / 转正评估 ----------

  async upsertReview(body: UpsertReviewInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const staffUserId = await this.scope.requireStaff(
      org,
      body.staffUserId,
      false,
    );
    const period = clip(body.period, 32);
    if (!period)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写评估周期');
    const kind = body.kind || 'YEAR';
    const data = {
      performanceScore: body.performanceScore,
      potentialScore: body.potentialScore,
      gridCell: gridCellOf(body.performanceScore, body.potentialScore),
      summary: clip(body.summary, 5000),
      status: body.status || 'DRAFT',
      reviewerUserId: org.actorId,
    };
    const row = await this.prisma.hrmReview.upsert({
      where: {
        orgType_orgUserId_staffUserId_period_kind: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          staffUserId,
          period,
          kind,
        },
      },
      create: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId,
        period,
        kind,
        ...data,
      },
      update: data,
    });
    return this.reviewView(row);
  }

  async listReviews(
    query: {
      staffUserId?: string;
      period?: string;
      page: number;
      pageSize: number;
    },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.staffUserId ? { staffUserId: query.staffUserId } : {}),
      ...(query.period ? { period: query.period } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmReview.count({ where }),
      this.prisma.hrmReview.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.reviewView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ---------- rubric 模板 ----------

  async getRubric(code: string | undefined) {
    return ensureActiveRubric(
      this.prisma,
      clip(code, 32) || DEFAULT_RUBRIC_SEED.code,
    );
  }

  async saveRubric(body: SaveRubricInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const code = clip(body.code, 32) || DEFAULT_RUBRIC_SEED.code;
    const latest = await this.prisma.hrmRubricTemplate.findFirst({
      where: { code },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.hrmRubricTemplate.updateMany({
        where: { code, active: true },
        data: { active: false },
      });
      return tx.hrmRubricTemplate.create({
        data: {
          code,
          version,
          dimensions: body.dimensions,
          weights: body.weights,
          thresholds: body.thresholds ?? {},
          tierLexicon: body.tierLexicon ?? [],
          promptDigest: clip(
            body.promptDigest || DEFAULT_RUBRIC_SEED.promptDigest,
            20000,
          ),
          active: true,
          updatedBy: org.actorId,
        },
      });
    });
    return rubricView(row);
  }

  // ---------- 视图 ----------

  private offerView(row: OfferRow) {
    return {
      id: row.id,
      applicationId: row.applicationId,
      candidateId: row.candidateId,
      jobId: row.jobId,
      salaryMonthly: ds(row.salaryMonthly),
      startAt: row.startAt,
      status: row.status,
      memberUserId: row.memberUserId,
      orgStaffId: row.orgStaffId,
      note: row.note,
      createdAt: iso(row.createdAt),
    };
  }

  private reviewView(row: ReviewRow) {
    return {
      id: row.id,
      staffUserId: row.staffUserId,
      period: row.period,
      kind: row.kind,
      performanceScore: ds(row.performanceScore, 1),
      potentialScore: ds(row.potentialScore, 1),
      gridCell: row.gridCell,
      summary: row.summary,
      status: row.status,
      reviewerUserId: row.reviewerUserId,
      updatedAt: iso(row.updatedAt),
    };
  }
}
