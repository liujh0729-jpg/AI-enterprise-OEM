import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import { classifyTier } from '../talent-match/talent-match.rubric';
import { tierMismatch } from '../talent-match/talent-match.scoring';
import type { TalentMatchService } from '../talent-match/talent-match.service';
import type { TalentEvalResult } from '../talent-match/talent-match.scoring';
import { asResumeItems, asStringArray, clip, ds, iso } from './hrm.helpers';
import type { HrmOrg, HrmScopeService } from './hrm.scope';

/**
 * 候选人 / 投递 / 面试 / 评分（§5.1 + §12.9）：
 * 候选人只存结构化事实（items），评估链路一律走 talent-match 单一实现点；
 * 参考分不做录用决策——状态推进必须是人工动作并留 decidedBy（人在环收口）。
 */

const ADVANCE_TARGET: Record<string, string> = {
  NEW: 'SCREENING',
  SCREENING: 'INTERVIEWING',
  INTERVIEWING: 'INTERVIEWING',
};
const DIMENSIONS = [
  'HARD_SKILL',
  'SOFT',
  'EXPERIENCE',
  'STABILITY',
  'CULTURE',
  'WILL',
] as const;

export type UpsertCandidateInput = {
  id?: number;
  name: string;
  phone?: string;
  email?: string;
  source?: string;
  resumeText?: string;
  items?: {
    id: string;
    kind: string;
    title: string;
    detail?: string;
    period?: string;
  }[];
  skills?: string[];
  tier?: string;
  note?: string;
};
export type CreateApplicationInput = {
  jobId: number;
  candidateId: number;
  channel?: string;
};
export type DecideApplicationInput = {
  id: number;
  decision: 'advance' | 'reject' | 'withdraw';
  note?: string;
};
export type ScheduleInterviewInput = {
  applicationId: number;
  interviewerUserId: string;
  mode?: string;
  scheduledAt: string;
  durationMin?: number;
};
export type RateInterviewInput = {
  interviewId: number;
  ratings: { dimension: string; score: number; note?: string }[];
};

export class HrmTalentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly talentMatch: TalentMatchService,
    private readonly aiEval: AiEvalService,
  ) {}

  // ---------- 候选人 ----------

  async listCandidates(
    query: { q?: string; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const q = String(query.q || '').trim();
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmCandidate.count({ where }),
      this.prisma.hrmCandidate.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.candidateView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 候选人建档：HR 权限；未给 items 时按简历原文做确定性分段抽取（保证证据可回指）。 */
  async upsertCandidate(body: UpsertCandidateInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const resumeText = String(body.resumeText || '').slice(0, 100_000);
    const items = body.items?.length
      ? asResumeItems(body.items)
      : this.parseResumeItems(resumeText);
    const skills = (body.skills || []).map((s) => clip(s, 32)).slice(0, 50);
    const tier =
      (body.tier || '').trim() ||
      classifyTier(
        `${resumeText} ${skills.join(' ')} ${items.map((i) => `${i.title} ${i.detail}`).join(' ')}`,
      );
    const data = {
      name: clip(body.name, 64),
      phone: clip(body.phone, 32),
      email: clip(body.email, 120),
      source: body.source || 'UPLOAD',
      resumeText,
      items,
      skills,
      tier,
      note: clip(body.note, 500),
    };
    const row = body.id
      ? await this.prisma.hrmCandidate.update({
          where: { id: await this.candidateId(org, body.id) },
          data,
        })
      : await this.prisma.hrmCandidate.create({
          data: {
            ...data,
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdBy: org.actorId,
          },
        });
    return this.candidateView(row);
  }

  // ---------- 投递与评估 ----------

  async createApplication(body: CreateApplicationInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const job = await this.prisma.hrmJob.findFirst({
      where: { id: body.jobId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '职位不存在');
    if (job.status !== 'OPEN') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '职位已关闭，不再接收投递',
      );
    }
    const candidate = await this.prisma.hrmCandidate.findFirst({
      where: {
        id: body.candidateId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!candidate)
      throw new BusinessException(ErrorCode.NOT_FOUND, '候选人不存在');
    const existing = await this.prisma.hrmApplication.findUnique({
      where: {
        jobId_candidateId: { jobId: job.id, candidateId: candidate.id },
      },
    });
    if (existing) return this.applicationView(existing);
    const row = await this.prisma.hrmApplication.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        jobId: job.id,
        candidateId: candidate.id,
        channel: body.channel || 'LOCAL',
        status: 'NEW',
        createdBy: org.actorId,
      },
    });
    return this.applicationView(row);
  }

  async listApplications(
    query: { jobId?: number; status?: string; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmApplication.count({ where }),
      this.prisma.hrmApplication.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.applicationView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 人岗匹配评估：只喂结构化事实，落库参考分与 rubric 版本（可追溯当时口径）。 */
  async evaluateApplication(id: number, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const application = await this.prisma.hrmApplication.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!application)
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    const [job, candidate] = await Promise.all([
      this.prisma.hrmJob.findFirst({
        where: {
          id: application.jobId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      }),
      this.prisma.hrmCandidate.findFirst({
        where: {
          id: application.candidateId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      }),
    ]);
    if (!job || !candidate) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '职位或候选人已不存在，无法评估',
      );
    }
    const items = asResumeItems(candidate.items);
    const skills = asStringArray(candidate.skills);
    const { result, usage } = await this.talentMatch.evaluate(
      {
        personSide: {
          items,
          skills,
          summary: clip(candidate.resumeText, 2000),
        },
        positionSide: { title: job.title, jd: job.jd, tier: job.tier },
      },
      org.actorId,
    );
    // 职级错位预警（§12.9.4）：代码侧补充提示，不改模型给的分数与分档。
    const mismatch = tierMismatch(
      `${candidate.tier} ${candidate.resumeText}`,
      job.tier,
    );
    const finalResult: TalentEvalResult = mismatch
      ? {
          ...result,
          recommendation: `${result.recommendation}；${mismatch}`,
        }
      : result;
    await this.charge(user, usage);
    const row = await this.prisma.hrmApplication.update({
      where: { id: application.id },
      data: {
        matchScore: Number(finalResult.score),
        matchTier: finalResult.tier,
        evalResult: finalResult,
        rubricCode: finalResult.rubricCode,
        rubricVersion: finalResult.rubricVersion,
        status: application.status === 'NEW' ? 'SCREENING' : application.status,
      },
    });
    return {
      ...this.applicationView(row),
      evalResult: finalResult,
    };
  }

  /** 状态推进/淘汰：参考分不做决策，人工动作留痕 decidedBy。 */
  async decideApplication(body: DecideApplicationInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const row = await this.prisma.hrmApplication.findFirst({
      where: { id: body.id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    if (row.status === 'REJECTED' || row.status === 'WITHDRAWN') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已终结的投递不能再次决策',
      );
    }
    let status = row.status;
    if (body.decision === 'advance') {
      status = ADVANCE_TARGET[row.status] || row.status;
    } else if (body.decision === 'reject') {
      status = 'REJECTED';
    } else {
      status = 'WITHDRAWN';
    }
    const updated = await this.prisma.hrmApplication.update({
      where: { id: row.id },
      data: {
        status,
        decidedBy: org.actorId,
        ...(body.note
          ? {
              evalResult: {
                ...(row.evalResult as Record<string, unknown>),
                lastNote: clip(body.note, 500),
              },
            }
          : {}),
      },
    });
    return this.applicationView(updated);
  }

  // ---------- 面试与评分 ----------

  async scheduleInterview(body: ScheduleInterviewInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const application = await this.prisma.hrmApplication.findFirst({
      where: {
        id: body.applicationId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!application)
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    if (
      application.status === 'REJECTED' ||
      application.status === 'WITHDRAWN'
    ) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已终结的投递不能安排面试',
      );
    }
    const interviewerUserId = await this.scope.requireStaff(
      org,
      body.interviewerUserId,
      false,
    );
    const scheduledAt = new Date(body.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime())) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '面试时间格式不合法');
    }
    const row = await this.prisma.hrmInterview.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        applicationId: application.id,
        interviewerUserId,
        mode: body.mode || 'ONSITE',
        scheduledAt,
        durationMin: Math.min(
          240,
          Math.max(15, Math.floor(body.durationMin || 60)),
        ),
        status: 'SCHEDULED',
        createdBy: org.actorId,
      },
    });
    await this.prisma.hrmApplication.update({
      where: { id: application.id },
      data: { status: 'INTERVIEWING' },
    });
    return this.interviewView(row);
  }

  async listInterviews(
    query: {
      applicationId?: number;
      status?: string;
      page: number;
      pageSize: number;
    },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmInterview.count({ where }),
      this.prisma.hrmInterview.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.interviewView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 维度评分：只有指定面试官（或 HR 管理员）能记分，重复记分覆盖同一维度。 */
  async rateInterview(body: RateInterviewInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const interview = await this.prisma.hrmInterview.findFirst({
      where: {
        id: body.interviewId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!interview)
      throw new BusinessException(ErrorCode.NOT_FOUND, '面试不存在');
    if (interview.interviewerUserId !== org.actorId && !org.isAdmin) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有该场的面试官或 HR 管理员可以记分',
      );
    }
    for (const rating of body.ratings) {
      if (!DIMENSIONS.find((item) => item === rating.dimension)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的评分维度');
      }
      await this.prisma.hrmInterviewRating.upsert({
        where: {
          interviewId_raterUserId_dimension: {
            interviewId: interview.id,
            raterUserId: org.actorId,
            dimension: rating.dimension,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          interviewId: interview.id,
          raterUserId: org.actorId,
          dimension: rating.dimension,
          score: rating.score,
          note: clip(rating.note, 500),
        },
        update: { score: rating.score, note: clip(rating.note, 500) },
      });
    }
    const row = await this.prisma.hrmInterview.update({
      where: { id: interview.id },
      data: { status: 'DONE' },
    });
    return this.interviewView(row);
  }

  /** 宽严校准：按记分人聚合给分均值与相对组织均值的偏移（±0.3 记为明显偏宽/偏严）。 */
  async calibration(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.hrmInterviewRating.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!rows.length) {
      return {
        raters: [],
        note: '暂无面试评分数据：完成面试记分后本视图自动产出宽严校准参考。',
      };
    }
    const byRater = new Map<string, number[]>();
    for (const row of rows) {
      const list = byRater.get(row.raterUserId) || [];
      list.push(Number(row.score));
      byRater.set(row.raterUserId, list);
    }
    const orgAvg =
      rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length;
    const raters = [...byRater.entries()]
      .map(([raterUserId, scores]) => {
        const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        const bias = avg - orgAvg;
        return {
          raterUserId,
          ratedCount: scores.length,
          avgScore: avg.toFixed(2),
          bias: bias.toFixed(2),
        };
      })
      .sort((a, b) => Number(b.bias) - Number(a.bias));
    const widest = raters[0];
    const note = widest
      ? `组织均值 ${orgAvg.toFixed(2)}；${
          Number(widest.bias) >= 0.3
            ? `最宽记分人 ${widest.raterUserId}（+${widest.bias}），建议复核评分口径`
            : Number(widest.bias) <= -0.3
              ? `各记分人整体偏严，均值差 ${widest.bias}`
              : '各记分人宽严基本一致'
        }`.slice(0, 500)
      : '';
    return { raters, note };
  }

  // ---------- 视图与内部工具 ----------

  private async candidateId(org: HrmOrg, id: number) {
    const row = await this.prisma.hrmCandidate.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      select: { id: true },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '候选人不存在');
    return row.id;
  }

  /** 简历原文分段：空行/换行切块，最多 20 条，条目 id 稳定（r-序号）供证据回指。 */
  private parseResumeItems(resumeText: string) {
    const blocks = String(resumeText || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block.length >= 4);
    return blocks.slice(0, 20).map((block, index) => ({
      id: `r-${index + 1}`,
      kind: /项目|负责|主导|开发|设计|运营/.test(block) ? 'PROJECT' : 'WORK',
      title: block.split('\n')[0].slice(0, 60),
      detail: block.slice(0, 2000),
      period: '',
    }));
  }

  private candidateView(row: {
    id: number;
    name: string;
    phone: string;
    email: string;
    source: string;
    resumeAssetId: number;
    items: unknown;
    skills: unknown;
    tier: string;
    note: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      source: row.source,
      resumeAssetId: row.resumeAssetId,
      items: asResumeItems(row.items),
      skills: asStringArray(row.skills),
      tier: row.tier,
      note: row.note,
      createdAt: iso(row.createdAt),
    };
  }

  private applicationView(row: {
    id: number;
    jobId: number;
    candidateId: number;
    channel: string;
    status: string;
    matchScore: unknown;
    matchTier: string;
    evalResult: unknown;
    rubricCode: string;
    rubricVersion: number;
    decidedBy: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      jobId: row.jobId,
      candidateId: row.candidateId,
      channel: row.channel,
      status: row.status,
      matchScore: ds(row.matchScore, 1),
      matchTier: row.matchTier,
      evalResult:
        row.evalResult &&
        typeof row.evalResult === 'object' &&
        !Array.isArray(row.evalResult)
          ? (row.evalResult as Record<string, unknown>)
          : {},
      rubricCode: row.rubricCode,
      rubricVersion: row.rubricVersion,
      decidedBy: row.decidedBy,
      createdAt: iso(row.createdAt),
    };
  }

  private interviewView(row: {
    id: number;
    applicationId: number;
    interviewerUserId: string;
    mode: string;
    scheduledAt: Date;
    durationMin: number;
    status: string;
    notes: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      applicationId: row.applicationId,
      interviewerUserId: row.interviewerUserId,
      mode: row.mode as 'ONSITE' | 'VIDEO' | 'PHONE',
      scheduledAt: iso(row.scheduledAt),
      durationMin: row.durationMin,
      status: row.status as 'SCHEDULED' | 'DONE' | 'CANCELED',
      notes: row.notes,
      createdAt: iso(row.createdAt),
    };
  }

  private async charge(
    user: CurrentUser,
    usage: { call: number; tokenIn?: number; tokenOut?: number },
  ) {
    try {
      await this.aiEval.chargeByUsage(
        user.userId,
        'hrm_resume_score',
        usage,
        'hrm-talent-match',
      );
    } catch {
      /* 计费失败不阻断评估 */
    }
  }
}
