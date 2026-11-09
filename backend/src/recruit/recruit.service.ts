import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import type { Prisma } from '../../generated/prisma';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };
const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

const STATUS_FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['SUBMITTED', 'WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};
const OPEN_JOB_EXCLUDE = ['CLOSED', 'OFFLINE', 'CANCELED', 'DELETED'];

const salaryText = (row: {
  salaryMode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
}) => {
  if (!row.salaryMin && !row.salaryMax) return '面议';
  const min = row.salaryMin ? `${Math.round(row.salaryMin / 1000)}k` : '';
  const max = row.salaryMax ? `${Math.round(row.salaryMax / 1000)}k` : '';
  if (min && max) return `${min}-${max} ${row.currency}`;
  return `${min || max} ${row.currency}`;
};

const tokensOf = (text: string): string[] => {
  const lower = String(text || '').toLowerCase();
  const ascii = lower.match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  const cjk = lower.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set([...ascii.filter((w) => w.length >= 2), ...cjk])].slice(
    0,
    80,
  );
};

/**
 * AI 简历代投（求职者视角，§5.6）：资料/简历复用 sns_resumes，岗位来自 HiringPost；
 * 评估/匹配/简历定制走统一 LLM 通道（缺 Key 回落规则式），投递确认只由界面触发（MCP 禁用）。
 */
export class RecruitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
    private readonly aiEval: AiEvalService,
  ) {}

  private async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private emit(org: HrmOrg, event: string, payload: Row) {
    void this.mechanisms.dispatch(org, event, payload).catch(() => undefined);
  }

  private async ensureResume(
    org: HrmOrg,
    profile: {
      fullName: string;
      headline: string;
      city: string;
      summary: string;
      objectiveRole: string;
    },
  ) {
    const existing = await this.prisma.resume.findUnique({
      where: { userId: org.actorId },
    });
    if (existing) {
      const data: Prisma.ResumeUpdateInput = {};
      if (!existing.headline && profile.headline)
        data.headline = profile.headline;
      if (!existing.location && profile.city) data.location = profile.city;
      if (!existing.summary && profile.summary) data.summary = profile.summary;
      if (!existing.objectiveRole && profile.objectiveRole)
        data.objectiveRole = profile.objectiveRole;
      if (Object.keys(data).length) {
        return this.prisma.resume.update({ where: { id: existing.id }, data });
      }
      return existing;
    }
    return this.prisma.resume.create({
      data: {
        userId: org.actorId,
        headline: profile.headline,
        location: profile.city,
        summary: profile.summary,
        objectiveRole: profile.objectiveRole,
      },
    });
  }

  private async profileRow(org: HrmOrg) {
    return (
      (await this.prisma.recruitProfile.findUnique({
        where: { userId: org.actorId },
      })) || {
        id: 0,
        userId: org.actorId,
        fullName: '',
        headline: '',
        years: 0,
        city: '',
        expectedSalary: '',
        objectiveRole: '',
        skills: [],
        experiences: [],
        educations: [],
        summary: '',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }
    );
  }

  private profileView(
    row: {
      id: number;
      fullName: string;
      headline: string;
      years: number;
      city: string;
      expectedSalary: string;
      objectiveRole: string;
      skills: unknown;
      experiences: unknown;
      educations: unknown;
      summary: string;
      updatedAt: Date;
    },
    resumeId: number | null,
  ) {
    const experiences = Array.isArray(row.experiences)
      ? (row.experiences as Row[]).map((item) => ({
          company: clip(item.company, 80),
          title: clip(item.title, 80),
          start: clip(item.start, 20),
          end: clip(item.end, 20),
          summary: clip(item.summary, 1000),
        }))
      : [];
    const educations = Array.isArray(row.educations)
      ? (row.educations as Row[]).map((item) => ({
          school: clip(item.school, 80),
          degree: clip(item.degree, 40),
          major: clip(item.major, 60),
          start: clip(item.start, 20),
          end: clip(item.end, 20),
        }))
      : [];
    return {
      id: row.id || null,
      fullName: row.fullName,
      headline: row.headline,
      years: row.years,
      city: row.city,
      expectedSalary: row.expectedSalary,
      objectiveRole: row.objectiveRole,
      skills: strArr(row.skills),
      experiences,
      educations,
      summary: row.summary,
      resumeId,
      updatedAt: row.updatedAt.getTime() > 0 ? row.updatedAt.toISOString() : '',
    };
  }

  async getProfile(user: CurrentUser) {
    const org = await this.org(user);
    const row = await this.profileRow(org);
    const resume = await this.prisma.resume.findUnique({
      where: { userId: org.actorId },
    });
    return this.profileView(row, resume?.id ?? null);
  }

  async saveProfile(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const data = {
      fullName: clip(body.fullName, 60),
      headline: clip(body.headline, 120),
      years: Math.max(0, Math.min(60, Math.trunc(num(body.years)))),
      city: clip(body.city, 60),
      expectedSalary: clip(body.expectedSalary, 60),
      objectiveRole: clip(body.objectiveRole, 120),
      skills: json(
        strArr(body.skills)
          .slice(0, 40)
          .map((item) => clip(item, 40)),
      ),
      experiences: json(
        (Array.isArray(body.experiences) ? (body.experiences as Row[]) : [])
          .slice(0, 20)
          .map((item) => ({
            company: clip(item.company, 80),
            title: clip(item.title, 80),
            start: clip(item.start, 20),
            end: clip(item.end, 20),
            summary: clip(item.summary, 1000),
          })),
      ),
      educations: json(
        (Array.isArray(body.educations) ? (body.educations as Row[]) : [])
          .slice(0, 10)
          .map((item) => ({
            school: clip(item.school, 80),
            degree: clip(item.degree, 40),
            major: clip(item.major, 60),
            start: clip(item.start, 20),
            end: clip(item.end, 20),
          })),
      ),
      summary: clip(body.summary, 2000),
    };
    if (!data.fullName)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写姓名');
    const row = await this.prisma.recruitProfile.upsert({
      where: { userId: org.actorId },
      create: { userId: org.actorId, ...data },
      update: data,
    });
    const resume = await this.ensureResume(org, {
      fullName: data.fullName,
      headline: data.headline,
      city: data.city,
      summary: data.summary,
      objectiveRole: data.objectiveRole,
    });
    return this.profileView(row, resume.id);
  }

  private async companyNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return new Map();
    const numeric = unique.map((v) => Number(v)).filter(Number.isInteger);
    const rows = await this.prisma.account.findMany({
      where: { id: { in: numeric } },
      select: { id: true, username: true },
    });
    const byId = new Map(rows.map((row) => [String(row.id), row.username]));
    return new Map(unique.map((id) => [id, byId.get(id) || id]));
  }

  private jobView(
    row: {
      id: number;
      userId: string;
      title: string;
      description: string;
      tags: unknown;
      city: string;
      salaryMode: string | null;
      salaryMin: number | null;
      salaryMax: number | null;
      currency: string;
      status: string;
      createdAt: Date;
    },
    company: string,
  ) {
    return {
      id: row.id,
      title: row.title,
      company,
      city: row.city,
      salary: salaryText(row),
      tags: strArr(row.tags).slice(0, 12),
      description: row.description,
      status: row.status,
      postedAt: row.createdAt.toISOString(),
    };
  }

  private async openJobs() {
    return this.prisma.hiringPost.findMany({
      where: { status: { notIn: OPEN_JOB_EXCLUDE } },
      orderBy: { id: 'desc' },
      take: 300,
    });
  }

  async listJobs(
    user: CurrentUser,
    query: PageQuery & { q?: string; city?: string },
  ) {
    await this.org(user);
    const where: Prisma.HiringPostWhereInput = {
      status: { notIn: OPEN_JOB_EXCLUDE },
    };
    if (query.city) where.city = { contains: query.city };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q } },
        { description: { contains: query.q } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.hiringPost.count({ where }),
      this.prisma.hiringPost.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const companies = await this.companyNames(rows.map((row) => row.userId));
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) =>
        this.jobView(row, companies.get(row.userId) || ''),
      ),
    };
  }

  private scoreJob(
    profile: {
      fullName: string;
      headline: string;
      years: number;
      city: string;
      objectiveRole: string;
      skills: string[];
      summary: string;
      experiences: Array<{ company: string; title: string; summary: string }>;
    },
    job: { title: string; description: string; city: string; tags: unknown },
  ) {
    const jobText = `${job.title}\n${job.description}\n${strArr(job.tags).join(' ')}`;
    const jobTokens = tokensOf(jobText);
    const profileTokens = new Set(
      tokensOf(
        [
          profile.headline,
          profile.objectiveRole,
          profile.summary,
          profile.skills.join(' '),
          profile.experiences.map((e) => `${e.title} ${e.summary}`).join(' '),
        ].join(' '),
      ),
    );
    const hits = jobTokens.filter((token) => profileTokens.has(token));
    const overlap = jobTokens.length ? hits.length / jobTokens.length : 0;
    const titleHit =
      job.title &&
      (profile.objectiveRole.includes(job.title) ||
        job.title.includes(profile.objectiveRole));
    const cityHit = !job.city || !profile.city || job.city === profile.city;
    const yearNeed = Number(
      (job.description.match(/(\d+)\s*年/) || [])[1] || 0,
    );
    const yearsOk = !yearNeed || profile.years >= yearNeed;
    const score = Math.max(
      20,
      Math.min(
        98,
        Math.round(
          35 +
            overlap * 45 +
            (titleHit ? 10 : 0) +
            (cityHit ? 6 : 0) +
            (yearsOk ? 4 : -8),
        ),
      ),
    );
    const reasons = [
      titleHit
        ? `目标岗位与「${job.title}」方向一致`
        : `岗位「${job.title}」与当前目标岗位有一定差异`,
      hits.length
        ? `简历命中岗位关键词 ${hits.length} 个：${hits.slice(0, 8).join('、')}`
        : '简历与岗位描述的共同关键词较少',
      cityHit
        ? job.city
          ? `城市匹配：${job.city}`
          : '岗位未限制城市'
        : `岗位城市「${job.city}」与期望「${profile.city}」不一致`,
      yearsOk
        ? `工作年限满足要求${yearNeed ? `（要求 ${yearNeed} 年）` : ''}`
        : `岗位要求 ${yearNeed} 年经验，当前填写 ${profile.years} 年`,
    ];
    const gaps = [
      ...(hits.length < 5 ? ['补充岗位描述中的关键技能与项目成果'] : []),
      ...(cityHit ? [] : ['确认是否接受异地（或远程）机会']),
      ...(yearsOk ? [] : ['突出可替代经验与快速上手证据']),
      ...(titleHit ? [] : ['在简历摘要中明确与该岗位的转岗理由']),
    ];
    return { score, reasons, gaps, hits };
  }

  private async requireJob(jobId: number) {
    const job = await this.prisma.hiringPost.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '岗位不存在');
    return job;
  }

  async evaluatePost(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const job = await this.requireJob(num(body.jobId));
    const profile = await this.profileRow(org);
    const experiences = Array.isArray(profile.experiences)
      ? (profile.experiences as Row[]).map((item) => ({
          company: clip(item.company, 80),
          title: clip(item.title, 80),
          summary: clip(item.summary, 1000),
        }))
      : [];
    const baseline = this.scoreJob(
      {
        fullName: profile.fullName,
        headline: profile.headline,
        years: profile.years,
        city: profile.city,
        objectiveRole: profile.objectiveRole,
        skills: strArr(profile.skills),
        summary: profile.summary,
        experiences,
      },
      job,
    );
    let mode: 'llm' | 'rule' = 'rule';
    let score = baseline.score;
    let strengths = baseline.reasons.filter((_, index) => index !== 2);
    let risks = baseline.gaps;
    let suggestions = [
      '投递前按岗位关键词重写简历摘要',
      '补充与岗位最相关的 2 个项目成果',
    ];
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是求职顾问。评估候选人与岗位匹配度，只输出 JSON：{"score":0-100,"strengths":[""],"risks":[""],"suggestions":[""]}。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            job: {
              title: job.title,
              description: job.description,
              city: job.city,
              tags: job.tags,
            },
            profile: {
              fullName: profile.fullName,
              headline: profile.headline,
              years: profile.years,
              city: profile.city,
              objectiveRole: profile.objectiveRole,
              skills: profile.skills,
              summary: profile.summary,
              experiences,
            },
            baseline: {
              score: baseline.score,
              reasons: baseline.reasons,
              gaps: baseline.gaps,
            },
          }),
        },
      ],
      user.userId,
      800,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      if (parsed) {
        mode = 'llm';
        if (Number.isFinite(Number(parsed.score))) {
          score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
        }
        const s = strArr(parsed.strengths)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        const r = strArr(parsed.risks)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        const g = strArr(parsed.suggestions)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        if (s.length) strengths = s;
        if (r.length) risks = r;
        if (g.length) suggestions = g;
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'recruit_job_eval',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `recruit-eval:${job.id}`,
          )
          .catch(() => undefined);
      }
    }
    await this.prisma.recruitJobEval.create({
      data: {
        userId: org.actorId,
        jobId: job.id,
        mode,
        score,
        strengths: json(strengths),
        risks: json(risks),
        suggestions: json(suggestions),
      },
    });
    return {
      mode,
      jobId: job.id,
      score,
      strengths,
      risks,
      suggestions,
      generatedAt: new Date().toISOString(),
    };
  }

  async matchJobs(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const profile = await this.profileRow(org);
    const limit = Math.min(50, Math.max(1, Math.trunc(num(body.limit, 10))));
    const jobs = await this.openJobs();
    const experiences = Array.isArray(profile.experiences)
      ? (profile.experiences as Row[]).map((item) => ({
          company: clip(item.company, 80),
          title: clip(item.title, 80),
          summary: clip(item.summary, 1000),
        }))
      : [];
    const input = {
      fullName: profile.fullName,
      headline: profile.headline,
      years: profile.years,
      city: profile.city,
      objectiveRole: profile.objectiveRole,
      skills: strArr(profile.skills),
      summary: profile.summary,
      experiences,
    };
    const companies = await this.companyNames(jobs.map((row) => row.userId));
    return jobs
      .map((job) => {
        const scored = this.scoreJob(input, job);
        return {
          job: this.jobView(job, companies.get(job.userId) || ''),
          score: scored.score,
          reasons: scored.reasons,
          gaps: scored.gaps,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private resumeText(
    profile: {
      fullName: string;
      headline: string;
      years: number;
      city: string;
      expectedSalary: string;
      objectiveRole: string;
      skills: string[];
      experiences: Array<{
        company: string;
        title: string;
        start: string;
        end: string;
        summary: string;
      }>;
      educations: Array<{
        school: string;
        degree: string;
        major: string;
        start: string;
        end: string;
      }>;
      summary: string;
    },
    job?: { title: string; description: string; tags: unknown; city: string },
  ) {
    const keyword = job
      ? tokensOf(
          `${job.title} ${job.description} ${strArr(job.tags).join(' ')}`,
        )
      : [];
    const skills = [...profile.skills].sort((a, b) => {
      const aHit = keyword.some((token) => a.toLowerCase().includes(token));
      const bHit = keyword.some((token) => b.toLowerCase().includes(token));
      return Number(bHit) - Number(aHit);
    });
    const lines = [
      `# ${profile.fullName || '求职者'}`,
      profile.headline ? `> ${profile.headline}` : '',
      '',
      '## 求职意向',
      `- 目标岗位：${profile.objectiveRole || '待补充'}`,
      `- 城市：${profile.city || '待补充'} 期望薪资：${profile.expectedSalary || '面议'}`,
      `- 工作年限：${profile.years} 年`,
      '',
      '## 个人简介',
      profile.summary || '待补充',
      '',
      '## 核心技能',
      ...(skills.length ? skills.map((item) => `- ${item}`) : ['- 待补充']),
      '',
      '## 工作经历',
      ...(profile.experiences.length
        ? profile.experiences.flatMap((item) => [
            `### ${item.company || '公司'} · ${item.title || '岗位'}`,
            item.start || item.end
              ? `${item.start || ''} ~ ${item.end || '至今'}`
              : '',
            item.summary || '',
            '',
          ])
        : ['待补充', '']),
      '## 教育经历',
      ...(profile.educations.length
        ? profile.educations.map((item) =>
            `- ${item.school || ''} ${item.degree || ''} ${item.major || ''} ${item.start || ''}${item.end ? ` ~ ${item.end}` : ''}`.trim(),
          )
        : ['- 待补充']),
      '',
    ];
    if (job) {
      lines.push(
        '## 岗位匹配说明',
        `针对「${job.title}」岗位，优先呈现与该岗位最相关的技能与经历；面试前请按岗位描述补充量化成果。`,
        '',
      );
    }
    return lines.filter((line) => line !== undefined).join('\n');
  }

  async optimizeResume(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const job = await this.requireJob(num(body.jobId));
    const profile = await this.profileRow(org);
    const resume = await this.ensureResume(org, {
      fullName: profile.fullName,
      headline: profile.headline,
      city: profile.city,
      summary: profile.summary,
      objectiveRole: profile.objectiveRole,
    });
    const experiences = Array.isArray(profile.experiences)
      ? (profile.experiences as Row[]).map((item) => ({
          company: clip(item.company, 80),
          title: clip(item.title, 80),
          start: clip(item.start, 20),
          end: clip(item.end, 20),
          summary: clip(item.summary, 1000),
        }))
      : [];
    const educations = Array.isArray(profile.educations)
      ? (profile.educations as Row[]).map((item) => ({
          school: clip(item.school, 80),
          degree: clip(item.degree, 40),
          major: clip(item.major, 60),
          start: clip(item.start, 20),
          end: clip(item.end, 20),
        }))
      : [];
    const input = {
      fullName: profile.fullName,
      headline: profile.headline,
      years: profile.years,
      city: profile.city,
      expectedSalary: profile.expectedSalary,
      objectiveRole: profile.objectiveRole,
      skills: strArr(profile.skills),
      experiences,
      educations,
      summary: profile.summary,
    };
    let bodyText = this.resumeText(input, job);
    let suggestions = [
      '用岗位描述中的关键词替换简历里的泛化表达',
      '为最近一段经历补充可量化成果（指标、规模、结果）',
      '摘要控制在 3~4 句，直接说明与该岗位的匹配点',
    ];
    let mode: 'llm' | 'rule' = 'rule';
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是简历优化顾问。基于候选人资料与目标岗位，输出针对性简历正文（Markdown）与改进建议，只输出 JSON：{"title":"","body":"","suggestions":[""]}。不得编造未提供的经历。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            job: {
              title: job.title,
              description: job.description,
              city: job.city,
              tags: job.tags,
            },
            profile: input,
          }),
        },
      ],
      user.userId,
      1600,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      if (
        parsed &&
        typeof parsed.body === 'string' &&
        parsed.body.trim().length > 50
      ) {
        mode = 'llm';
        bodyText = clip(parsed.body, 20000);
        const list = strArr(parsed.suggestions)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        if (list.length) suggestions = list;
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'recruit_resume_tailor',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `recruit-resume:${job.id}`,
          )
          .catch(() => undefined);
      }
    }
    const title = clip(
      parsedTitle(llm?.reply) ||
        `${profile.fullName || '求职者'} · ${job.title}`,
      120,
    );
    const variant = await this.prisma.recruitResumeVariant.create({
      data: {
        userId: org.actorId,
        jobId: job.id,
        resumeId: resume.id,
        title,
        body: bodyText,
        suggestions: json(suggestions),
        mode,
      },
    });
    return {
      resumeId: variant.resumeId,
      title: variant.title,
      body: variant.body,
      suggestions,
      mode,
      generatedAt: variant.createdAt.toISOString(),
    };
  }

  private async applicationView(row: {
    id: number;
    jobId: number;
    jobTitle: string;
    company: string;
    resumeId: number | null;
    resumeTitle: string;
    status: string;
    channel: string;
    note: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const events = await this.prisma.recruitApplicationEvent.findMany({
      where: { applicationId: row.id },
      orderBy: { id: 'asc' },
    });
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      company: row.company,
      resumeId: row.resumeId,
      resumeTitle: row.resumeTitle,
      status: row.status,
      channel: row.channel,
      note: row.note,
      timeline: events.map((event) => ({
        id: event.id,
        applicationId: event.applicationId,
        status: event.status,
        note: event.note,
        at: event.at.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireApplication(org: HrmOrg, id: number) {
    const row = await this.prisma.recruitApplication.findFirst({
      where: { id, userId: org.actorId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    return row;
  }

  async createApplication(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const job = await this.requireJob(num(body.jobId));
    const profile = await this.profileRow(org);
    const resume = await this.ensureResume(org, {
      fullName: profile.fullName,
      headline: profile.headline,
      city: profile.city,
      summary: profile.summary,
      objectiveRole: profile.objectiveRole,
    });
    const resumeId = num(body.resumeId) || resume.id;
    const resumeRow = await this.prisma.resume.findFirst({
      where: { id: resumeId, userId: org.actorId },
    });
    if (!resumeRow)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '简历不存在或不属于当前账号',
      );
    const companies = await this.companyNames([job.userId]);
    const row = await this.prisma.recruitApplication.create({
      data: {
        ...orgKey(org),
        userId: org.actorId,
        jobId: job.id,
        jobTitle: job.title,
        company: companies.get(job.userId) || '',
        resumeId,
        resumeTitle:
          clip(resumeRow.headline, 120) || `${profile.fullName || '我的'}简历`,
        status: 'DRAFT',
        channel: clip(body.channel, 24) || 'AI',
        note: clip(body.note, 500),
      },
    });
    await this.prisma.recruitApplicationEvent.create({
      data: {
        applicationId: row.id,
        status: 'DRAFT',
        note: '已创建投递草稿，等待确认',
      },
    });
    this.emit(org, 'recruit.application.created', {
      applicationId: row.id,
      jobId: job.id,
      jobTitle: job.title,
    });
    return this.applicationView(row);
  }

  async confirmApplication(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const row = await this.requireApplication(org, num(body.id));
    if (row.status !== 'DRAFT')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅待确认的投递可确认',
      );
    const next = await this.prisma.recruitApplication.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', note: '已确认投递' },
    });
    await this.prisma.recruitApplicationEvent.create({
      data: {
        applicationId: row.id,
        status: 'SUBMITTED',
        note: '本人确认投递',
      },
    });
    this.emit(org, 'recruit.application.confirmed', {
      applicationId: row.id,
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      company: row.company,
    });
    return this.applicationView(next);
  }

  async updateApplicationStatus(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const row = await this.requireApplication(org, num(body.id));
    const status = typeof body.status === 'string' ? body.status : '';
    const allowed = STATUS_FLOW[row.status] || [];
    if (!allowed.includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前状态不可变更为 ${status}`,
      );
    }
    const next = await this.prisma.recruitApplication.update({
      where: { id: row.id },
      data: { status, note: clip(body.note, 500) || row.note },
    });
    await this.prisma.recruitApplicationEvent.create({
      data: { applicationId: row.id, status, note: clip(body.note, 500) },
    });
    this.emit(org, 'recruit.application.status', {
      applicationId: row.id,
      from: row.status,
      to: status,
    });
    return this.applicationView(next);
  }

  async listApplications(
    user: CurrentUser,
    query: PageQuery & { status?: string; jobId?: number },
  ) {
    const org = await this.org(user);
    const where: Prisma.RecruitApplicationWhereInput = { userId: org.actorId };
    if (query.status) where.status = query.status;
    if (query.jobId) where.jobId = query.jobId;
    const [total, rows] = await Promise.all([
      this.prisma.recruitApplication.count({ where }),
      this.prisma.recruitApplication.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const list = [];
    for (const row of rows) list.push(await this.applicationView(row));
    return { total, page: query.page, pageSize: query.pageSize, list };
  }

  async funnelStats(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.recruitApplication.groupBy({
      by: ['status'],
      where: { userId: org.actorId },
      _count: { _all: true },
    });
    const counts = new Map(rows.map((row) => [row.status, row._count._all]));
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    const submitted = total - (counts.get('DRAFT') || 0);
    const interview =
      (counts.get('INTERVIEW') || 0) + (counts.get('OFFER') || 0);
    const offer = counts.get('OFFER') || 0;
    const rejected = counts.get('REJECTED') || 0;
    const order = [
      'DRAFT',
      'SUBMITTED',
      'SCREENING',
      'INTERVIEW',
      'OFFER',
      'REJECTED',
      'WITHDRAWN',
    ];
    return {
      total,
      byStatus: order
        .filter((status) => counts.has(status))
        .map((status) => ({ status, count: counts.get(status) || 0 })),
      submitted,
      interview,
      offer,
      rejected,
      interviewRate: submitted ? Math.round((interview / submitted) * 100) : 0,
      offerRate: interview ? Math.round((offer / interview) * 100) : 0,
    };
  }

  async patternInsights(user: CurrentUser) {
    const org = await this.org(user);
    const [funnel, applications, evals] = await Promise.all([
      this.funnelStats(user),
      this.prisma.recruitApplication.findMany({
        where: { userId: org.actorId },
      }),
      this.prisma.recruitJobEval.findMany({
        where: { userId: org.actorId },
        orderBy: { id: 'desc' },
        take: 50,
      }),
    ]);
    const rejected = applications.filter((row) => row.status === 'REJECTED');
    const risks = new Map<string, number>();
    for (const row of evals) {
      for (const risk of strArr(row.risks)) {
        risks.set(risk, (risks.get(risk) || 0) + 1);
      }
    }
    const topRisks = [...risks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const insights = [
      {
        title: '投递转化',
        detail: `已投递 ${funnel.submitted} 次，进入面试 ${funnel.interview} 次，获得 Offer ${funnel.offer} 次。`,
        evidence: `面试率 ${funnel.interviewRate}%，Offer 率 ${funnel.offerRate}%`,
        advice:
          funnel.interviewRate < 20
            ? '简历初筛通过率偏低：按岗位关键词重写摘要与技能排序，再集中投递。'
            : funnel.offerRate < 30
              ? '面试转化仍有空间：准备 3 个与岗位强相关的项目故事（背景-动作-结果）。'
              : '当前转化高于常规水平，保持定向投递节奏。',
      },
      {
        title: '被拒分布',
        detail: `${rejected.length} 次投递未通过${rejected.length ? `，最近一次为「${rejected[0].jobTitle}」` : ''}。`,
        evidence: rejected.length ? '基于投递状态统计' : '暂无未通过记录',
        advice: rejected.length
          ? '复盘未通过岗位的 JD 与简历差异，避免同类型岗位重复投递。'
          : '继续保持，关注面试反馈。',
      },
      {
        title: '评估风险项',
        detail: topRisks.length
          ? `历史岗位评估中高频风险：${topRisks.map(([text]) => text).join('；')}`
          : '暂无历史岗位评估记录。',
        evidence: `参考最近 ${evals.length} 次岗位评估`,
        advice: topRisks.length
          ? '针对高频风险补充证据材料（项目数据、作品集、证书）。'
          : '先对 2~3 个目标岗位做一次匹配评估，形成可复用的优化清单。',
      },
    ];
    return {
      mode: 'rule' as const,
      insights,
      generatedAt: new Date().toISOString(),
    };
  }

  async events(user: CurrentUser, query: { applicationId: number }) {
    const org = await this.org(user);
    await this.requireApplication(org, query.applicationId);
    const rows = await this.prisma.recruitApplicationEvent.findMany({
      where: { applicationId: query.applicationId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      applicationId: row.applicationId,
      status: row.status,
      note: row.note,
      at: row.at.toISOString(),
    }));
  }
}

/** 从 LLM 回复中取标题（失败返回空串，由调用方兜底）。 */
function parsedTitle(reply?: string): string {
  if (!reply) return '';
  const parsed = parseJsonObject(reply);
  return parsed && typeof parsed.title === 'string' ? parsed.title : '';
}
