import { kbChatMulti, resolveKbLlm } from '../kb/kb-llm';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import { clip, ds, iso } from './hrm.helpers';
import { classifyTier } from '../talent-match/talent-match.rubric';
import type { HrmScopeService } from './hrm.scope';

/**
 * 招聘底座（§5.1 双表模型）：
 * HrmJob（对内主体：JD 单一数据源、审批/评估/投递都挂这张表）
 * ↔ HiringPost（sns_hiring_posts，对外渠道：发布时按 JD 裁剪生成，回流候选人落 HrmCandidate）。
 * 用人申请（HC）批准后自动生成职位，避免「先开职位再补审批」的顺序漏洞。
 */

const JOB_STATUSES = ['OPEN', 'CLOSED', 'FILLED', 'CANCELED'] as const;

export type CreateHiringRequestInput = {
  department?: string;
  position: string;
  headCount?: number;
  expectedTier?: string;
  budgetMonthly?: number;
  reason?: string;
};
export type DecideHiringRequestInput = {
  id: number;
  decision: 'approve' | 'reject';
  note?: string;
};
export type CreateJobInput = {
  title: string;
  department?: string;
  headCount?: number;
  tier?: string;
  jd?: string;
  minScore?: number;
  hiringRequestId?: number;
};
export type UpdateJobInput = {
  id: number;
  title?: string;
  department?: string;
  headCount?: number;
  tier?: string;
  jd?: string;
  status?: string;
  minScore?: number;
};
export type GenerateJdInput = {
  title: string;
  tier?: string;
  points: string[];
};

export class HrmRecruitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly aiEval: AiEvalService,
  ) {}

  // ---------- 用人申请（HC） ----------

  async createHiringRequest(body: CreateHiringRequestInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.hrmHiringRequest.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        department: clip(body.department, 64),
        position: clip(body.position, 120),
        headCount: Math.min(500, Math.max(1, Math.floor(body.headCount || 1))),
        expectedTier: clip(body.expectedTier, 24),
        budgetMonthly: body.budgetMonthly ?? 0,
        reason: clip(body.reason, 500),
        status: 'PENDING',
        applicantUserId: org.actorId,
      },
    });
    return this.requestView(row);
  }

  async listHiringRequests(
    query: { status?: string; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      // 非管理员只看自己提的申请（HC 台账对全员开放会泄露薪酬预算）。
      ...(org.isAdmin ? {} : { applicantUserId: org.actorId }),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmHiringRequest.count({ where }),
      this.prisma.hrmHiringRequest.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.requestView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 批准即开位：同事务落 HrmJob，申请单回填 jobId（未批准的申请不得有职位）。 */
  async decideHiringRequest(body: DecideHiringRequestInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const row = await this.prisma.hrmHiringRequest.findFirst({
      where: { id: body.id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '用人申请不存在');
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该用人申请已处理');
    }
    if (body.decision === 'reject') {
      const rejected = await this.prisma.hrmHiringRequest.update({
        where: { id: row.id },
        data: {
          status: 'REJECTED',
          approverUserId: org.actorId,
          decidedAt: new Date(),
          reason:
            `${row.reason}${row.reason ? ' / ' : ''}驳回：${clip(body.note, 200)}`.slice(
              0,
              500,
            ),
        },
      });
      return this.requestView(rejected);
    }
    const jobId = await this.prisma.$transaction(async (tx) => {
      const job = await tx.hrmJob.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          title: row.position,
          department: row.department,
          headCount: row.headCount,
          tier: row.expectedTier,
          jd: this.seedJd(
            row.position,
            row.department,
            row.expectedTier,
            row.reason,
          ),
          status: 'OPEN',
          hiringRequestId: row.id,
          ownerId: row.applicantUserId || org.actorId,
          createdBy: org.actorId,
        },
      });
      await tx.hrmHiringRequest.update({
        where: { id: row.id },
        data: {
          status: 'APPROVED',
          approverUserId: org.actorId,
          decidedAt: new Date(),
          jobId: job.id,
        },
      });
      return job.id;
    });
    return this.requestView({ ...row, status: 'APPROVED', jobId });
  }

  // ---------- 职位（对内主体） ----------

  async listJobs(
    query: { status?: string; q?: string; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const q = String(query.q || '').trim();
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.status ? { status: query.status } : {}),
      ...(q ? { title: { contains: q } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmJob.count({ where }),
      this.prisma.hrmJob.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.jobView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getJob(id: number, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.hrmJob.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '职位不存在');
    return this.jobView(row);
  }

  async createJob(body: CreateJobInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    if (body.hiringRequestId) {
      const request = await this.prisma.hrmHiringRequest.findFirst({
        where: {
          id: body.hiringRequestId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      });
      if (!request) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '关联的用人申请不存在',
        );
      }
      if (request.status !== 'APPROVED') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '用人申请未批准，不能开设职位',
        );
      }
    }
    const row = await this.prisma.hrmJob.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        title: clip(body.title, 120),
        department: clip(body.department, 64),
        headCount: Math.min(500, Math.max(1, Math.floor(body.headCount || 1))),
        tier: clip(body.tier, 24),
        jd: String(body.jd || '').slice(0, 20000),
        status: 'OPEN',
        hiringRequestId: body.hiringRequestId ?? 0,
        minScore: body.minScore ?? 4.0,
        ownerId: org.actorId,
        createdBy: org.actorId,
      },
    });
    return this.jobView(row);
  }

  async updateJob(body: UpdateJobInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const current = await this.prisma.hrmJob.findFirst({
      where: { id: body.id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!current)
      throw new BusinessException(ErrorCode.NOT_FOUND, '职位不存在');
    if (body.status && !JOB_STATUSES.find((item) => item === body.status)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的职位状态');
    }
    const row = await this.prisma.hrmJob.update({
      where: { id: current.id },
      data: {
        ...(body.title ? { title: clip(body.title, 120) } : {}),
        ...(body.department !== undefined
          ? { department: clip(body.department, 64) }
          : {}),
        ...(body.headCount
          ? {
              headCount: Math.min(500, Math.max(1, Math.floor(body.headCount))),
            }
          : {}),
        ...(body.tier !== undefined ? { tier: clip(body.tier, 24) } : {}),
        ...(body.jd !== undefined
          ? { jd: String(body.jd).slice(0, 20000) }
          : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.minScore ? { minScore: body.minScore } : {}),
      },
    });
    return this.jobView(row);
  }

  /** JD 草稿生成：LLM 可用则按要点成文，未配 Key 走模板拼装（确定性回落）；按 jd_generate 科目出账。 */
  async generateJd(body: GenerateJdInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const tier =
      (body.tier || '').trim() ||
      classifyTier(`${body.title}${body.points.join(' ')}`);
    const ruleJd = this.renderJd(body.title, tier, body.points);
    const channel = await resolveKbLlm(this.prisma, org.actorId);
    if (!channel) {
      return { jd: ruleJd, mode: 'rule' as const };
    }
    const messages = [
      {
        role: 'system' as const,
        content: [
          '你是招聘 JD 撰写助手。只依据给定的岗位名与职责要点成文，不得编造未提供的薪资、股权或资质承诺。',
          '输出纯文本 markdown，包含「岗位职责」「任职要求」两节，任职要求逐条短句（每行一条，便于机器抽取）。',
        ].join('\n'),
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          title: body.title,
          tier,
          points: body.points,
        }),
      },
    ];
    const reply = await kbChatMulti(channel, messages, org.actorId, 1200);
    const draft = String(reply?.reply || '').trim();
    await this.charge(user, {
      call: 1,
      tokenIn: reply?.promptTokens || undefined,
      tokenOut: reply?.completionTokens || undefined,
    });
    if (!draft) return { jd: ruleJd, mode: 'rule' as const };
    return { jd: draft.slice(0, 20000), mode: 'llm' as const };
  }

  /** 发布到对外渠道：JD 裁剪为 description，同职位重复发布只更新不新建。 */
  async publishJob(id: number, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const job = await this.prisma.hrmJob.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '职位不存在');
    if (job.status !== 'OPEN') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '只有进行中的职位可以发布',
      );
    }
    const description = this.channelDescription(job.jd, job.tier);
    const tags = [job.department, job.tier].filter(Boolean).slice(0, 10);
    const post =
      job.hiringPostId > 0
        ? await this.prisma.hiringPost.update({
            where: { id: job.hiringPostId },
            data: {
              title: clip(job.title, 100),
              description,
              headCount: job.headCount,
              tags,
            },
          })
        : await this.prisma.hiringPost.create({
            data: {
              userId: org.orgUserId,
              type: 'FULL_TIME',
              title: clip(job.title, 100),
              description,
              headCount: job.headCount,
              currency: 'AWCOIN',
              tags,
              status: 'LOCAL_PUBLISHED',
            },
          });
    const row = await this.prisma.hrmJob.update({
      where: { id: job.id },
      data: { hiringPostId: post.id },
    });
    return this.jobView(row);
  }

  // ---------- 内部工具 ----------

  private requestView(row: {
    id: number;
    department: string;
    position: string;
    headCount: number;
    expectedTier: string;
    budgetMonthly: unknown;
    reason: string;
    status: string;
    applicantUserId: string;
    approverUserId: string;
    jobId: number;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      department: row.department,
      position: row.position,
      headCount: row.headCount,
      expectedTier: row.expectedTier,
      budgetMonthly: ds(row.budgetMonthly),
      reason: row.reason,
      status: row.status,
      applicantUserId: row.applicantUserId,
      approverUserId: row.approverUserId,
      jobId: row.jobId,
      createdAt: iso(row.createdAt),
    };
  }

  private jobView(row: {
    id: number;
    title: string;
    department: string;
    headCount: number;
    tier: string;
    jd: string;
    status: string;
    hiringRequestId: number;
    hiringPostId: number;
    minScore: unknown;
    ownerId: string;
    createdBy: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      title: row.title,
      department: row.department,
      headCount: row.headCount,
      tier: row.tier,
      jd: row.jd,
      status: row.status,
      hiringRequestId: row.hiringRequestId,
      hiringPostId: row.hiringPostId,
      minScore: ds(row.minScore, 1),
      ownerId: row.ownerId,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
    };
  }

  private seedJd(
    position: string,
    department: string,
    tier: string,
    reason: string,
  ): string {
    return [
      `# ${position}`,
      department ? `所属部门：${department}` : '',
      tier ? `职级带：${tier}` : '',
      reason ? `用人理由：${reason}` : '',
      '',
      '## 岗位职责',
      `- 负责 ${position} 相关日常工作`,
      '- 与上下游协作推进既定目标',
      '',
      '## 任职要求',
      `- 具备 ${position} 所需的专业能力与经验`,
      '- 要求良好的沟通与协作能力',
      '- 要求较强的责任心与学习能力',
      '- 有相关项目经验者优先',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private renderJd(title: string, tier: string, points: string[]): string {
    const requirements = points
      .map((p) => clip(p, 200))
      .filter(Boolean)
      .map((p) => `- 要求 ${p}`)
      .join('\n');
    return [
      `# ${title}${tier ? `（${tier}）` : ''}`,
      '',
      '## 岗位职责',
      points.map((p) => `- ${clip(p, 200)}`).join('\n'),
      '',
      '## 任职要求',
      requirements || '- 要求具备岗位所需的专业能力',
    ].join('\n');
  }

  /** 对外渠道正文：只保留要点段，隐去内部预算/理由，避免对内信息外泄。 */
  private channelDescription(jd: string, tier: string): string {
    const lines = String(jd || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !/用人理由|预算|内部|薪酬带宽/.test(line) &&
          !line.startsWith('#'),
      );
    const body = lines.join('\n').slice(0, 4000);
    return tier ? `${body}\n\n职级带：${tier}`.slice(0, 4000) : body;
  }

  private async charge(
    user: CurrentUser,
    usage: { call: number; tokenIn?: number; tokenOut?: number },
  ) {
    try {
      await this.aiEval.chargeByUsage(
        user.userId,
        'jd_generate',
        usage,
        'hrm-jd:generate',
      );
    } catch {
      /* 计费失败不阻断生成 */
    }
  }
}
