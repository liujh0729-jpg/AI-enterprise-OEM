import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * AI 简历代投：求职者视角。资料/简历复用 sns_resumes / sns_resume_items，
 * 岗位来自 HiringPost；投递确认（Recruit_confirmApplication）只允许界面触发，对 MCP 禁用。
 */
export const RECRUIT_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
] as const;
export const RECRUIT_APPLICATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "待确认",
  SUBMITTED: "已投递",
  SCREENING: "筛选中",
  INTERVIEW: "面试中",
  OFFER: "已发 Offer",
  REJECTED: "未通过",
  WITHDRAWN: "已撤回",
};
export const RECRUIT_STATUS_FLOW: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["SCREENING", "REJECTED", "WITHDRAWN"],
  SCREENING: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["SUBMITTED", "WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
};

export const recruitExperienceSchema = z.object({
  company: z.string().max(80).default(""),
  title: z.string().max(80).default(""),
  start: z.string().max(20).default(""),
  end: z.string().max(20).default(""),
  summary: z.string().max(1000).default(""),
});
export const recruitEducationSchema = z.object({
  school: z.string().max(80).default(""),
  degree: z.string().max(40).default(""),
  major: z.string().max(60).default(""),
  start: z.string().max(20).default(""),
  end: z.string().max(20).default(""),
});

export const recruitProfileSchema = z.object({
  id: z.number().nullable(),
  fullName: z.string(),
  headline: z.string(),
  years: z.number(),
  city: z.string(),
  expectedSalary: z.string(),
  objectiveRole: z.string(),
  skills: z.array(z.string()),
  experiences: z.array(recruitExperienceSchema),
  educations: z.array(recruitEducationSchema),
  summary: z.string(),
  resumeId: z.number().nullable(),
  updatedAt: z.string(),
});

export const recruitJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  company: z.string(),
  city: z.string(),
  salary: z.string(),
  tags: z.array(z.string()),
  description: z.string(),
  status: z.string(),
  postedAt: z.string(),
});

export const recruitEvaluationSchema = z.object({
  mode: z.enum(["llm", "rule"]),
  jobId: z.number(),
  score: z.number(),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  suggestions: z.array(z.string()),
  generatedAt: z.string(),
});

export const recruitMatchSchema = z.object({
  job: recruitJobSchema,
  score: z.number(),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
});

export const recruitOptimizeResultSchema = z.object({
  resumeId: z.number(),
  title: z.string(),
  body: z.string(),
  suggestions: z.array(z.string()),
  mode: z.enum(["llm", "rule"]),
  generatedAt: z.string(),
});

export const recruitEventSchema = z.object({
  id: z.number(),
  applicationId: z.number(),
  status: z.string(),
  note: z.string(),
  at: z.string(),
});

export const recruitApplicationSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  jobTitle: z.string(),
  company: z.string(),
  resumeId: z.number().nullable(),
  resumeTitle: z.string(),
  status: z.string(),
  channel: z.string(),
  note: z.string(),
  timeline: z.array(recruitEventSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const recruitFunnelSchema = z.object({
  total: z.number(),
  byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  submitted: z.number(),
  interview: z.number(),
  offer: z.number(),
  rejected: z.number(),
  interviewRate: z.number(),
  offerRate: z.number(),
});

export const recruitPatternSchema = z.object({
  mode: z.enum(["llm", "rule"]),
  insights: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      evidence: z.string(),
      advice: z.string(),
    }),
  ),
  generatedAt: z.string(),
});

export const saveRecruitProfileBodySchema = z.object({
  fullName: z.string().max(60).default(""),
  headline: z.string().max(120).default(""),
  years: z.number().int().min(0).max(60).default(0),
  city: z.string().max(60).default(""),
  expectedSalary: z.string().max(60).default(""),
  objectiveRole: z.string().max(120).default(""),
  skills: z.array(z.string().max(40)).max(40).default([]),
  experiences: z.array(recruitExperienceSchema).max(20).default([]),
  educations: z.array(recruitEducationSchema).max(10).default([]),
  summary: z.string().max(2000).default(""),
});

export const optimizeResumeBodySchema = z.object({
  jobId: z.number().int().positive(),
});

export const matchJobsBodySchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

export const createRecruitApplicationBodySchema = z.object({
  jobId: z.number().int().positive(),
  resumeId: z.number().int().positive().optional(),
  note: z.string().max(500).default(""),
  channel: z.string().max(24).default("AI"),
});

export const updateRecruitApplicationBodySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(RECRUIT_APPLICATION_STATUSES),
  note: z.string().max(500).default(""),
});

export const recruitEndpoints = {
  Recruit_getProfile: {
    method: "get" as const,
    path: "/enterprise/recruit/profile",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(recruitProfileSchema),
  },
  Recruit_saveProfile: {
    method: "post" as const,
    path: "/enterprise/recruit/profile/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveRecruitProfileBodySchema,
    response: envelope(recruitProfileSchema),
  },
  Recruit_listJobs: {
    method: "get" as const,
    path: "/enterprise/recruit/jobs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      q: z.string().optional(),
      city: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(recruitJobSchema)),
  },
  Recruit_evaluatePost: {
    method: "post" as const,
    path: "/enterprise/recruit/jobs/evaluate",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ jobId: z.number().int().positive() }),
    response: envelope(recruitEvaluationSchema),
  },
  Recruit_matchJobs: {
    method: "post" as const,
    path: "/enterprise/recruit/jobs/match",
    params: z.object({}),
    query: emptyQuery,
    body: matchJobsBodySchema,
    response: envelope(z.array(recruitMatchSchema)),
  },
  Recruit_optimizeResume: {
    method: "post" as const,
    path: "/enterprise/recruit/resume/optimize",
    params: z.object({}),
    query: emptyQuery,
    body: optimizeResumeBodySchema,
    response: envelope(recruitOptimizeResultSchema),
  },
  Recruit_createApplication: {
    method: "post" as const,
    path: "/enterprise/recruit/applications/create",
    params: z.object({}),
    query: emptyQuery,
    body: createRecruitApplicationBodySchema,
    response: envelope(recruitApplicationSchema),
  },
  Recruit_confirmApplication: {
    method: "post" as const,
    path: "/enterprise/recruit/applications/confirm",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(recruitApplicationSchema),
  },
  Recruit_updateApplicationStatus: {
    method: "post" as const,
    path: "/enterprise/recruit/applications/status",
    params: z.object({}),
    query: emptyQuery,
    body: updateRecruitApplicationBodySchema,
    response: envelope(recruitApplicationSchema),
  },
  Recruit_listApplications: {
    method: "get" as const,
    path: "/enterprise/recruit/applications",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      jobId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(recruitApplicationSchema)),
  },
  Recruit_funnelStats: {
    method: "get" as const,
    path: "/enterprise/recruit/applications/stats",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(recruitFunnelSchema),
  },
  Recruit_patternInsights: {
    method: "get" as const,
    path: "/enterprise/recruit/insights",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(recruitPatternSchema),
  },
  Recruit_events: {
    method: "get" as const,
    path: "/enterprise/recruit/applications/events",
    params: z.object({}),
    query: z.object({ applicationId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(z.array(recruitEventSchema)),
  },
};
