import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 营销问卷与调研（营销工具）：题目设计在本系统落库，回收数据写入账号自己的多维表格。
 * 公开分享走 `/survey/:code`（免登录），答案只在服务端校验后写进回收表；
 * 已发布且已有回收的问卷锁定题目，复制为新问卷才能改结构，避免旧数据对不上题。
 */

export const SURVEY_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];
export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "收集中",
  CLOSED: "已结束",
};

export const SURVEY_QUESTION_TYPES = [
  "single",
  "multiple",
  "short_text",
  "long_text",
  "number",
  "date",
  "rating",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];
export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  single: "单选",
  multiple: "多选",
  short_text: "填空（短）",
  long_text: "填空（长）",
  number: "数字",
  date: "日期",
  rating: "评分",
};

export const SURVEY_TITLE_MAX = 120;
export const SURVEY_DESCRIPTION_MAX = 500;
export const SURVEY_QUESTION_MAX = 50;
export const SURVEY_OPTION_MAX = 30;
export const SURVEY_QUESTION_LABEL_MAX = 200;
export const SURVEY_OPTION_LABEL_MAX = 100;
export const SURVEY_TEXT_ANSWER_MAX = 2000;
export const SURVEY_THANK_YOU_MAX = 500;
export const SURVEY_MULTIPLE_JOINER = "、";

/** 题目编号：q1 / q2 …；同时是回收表里的列键，建好后不可改。 */
export const SURVEY_QUESTION_ID_PATTERN = /^q[1-9][0-9]{0,2}$/;

export const surveyQuestionSchema = z.object({
  id: z.string().regex(SURVEY_QUESTION_ID_PATTERN),
  label: z.string().min(1).max(SURVEY_QUESTION_LABEL_MAX),
  type: z.enum(SURVEY_QUESTION_TYPES),
  required: z.boolean().default(false),
  /** 单选题的候选（写入回收表的 select 列）；多选也用同一份候选做校验。 */
  options: z.array(z.string().min(1).max(SURVEY_OPTION_LABEL_MAX)).max(SURVEY_OPTION_MAX).default([]),
  /** 评分题的起止档位，默认 1–5。 */
  min: z.number().int().min(1).max(10).default(1),
  max: z.number().int().min(1).max(10).default(5),
});
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

export const surveyQuestionInputSchema = z.object({
  /** 已有题目回传 id；新增题目不带，由后端按 q1、q2 … 顺延分配。 */
  id: z.string().regex(SURVEY_QUESTION_ID_PATTERN).optional(),
  label: z.string().trim().min(1).max(SURVEY_QUESTION_LABEL_MAX),
  type: z.enum(SURVEY_QUESTION_TYPES),
  required: z.boolean().default(false),
  options: z
    .array(z.string().trim().min(1).max(SURVEY_OPTION_LABEL_MAX))
    .max(SURVEY_OPTION_MAX)
    .default([]),
  min: z.number().int().min(1).max(10).default(1),
  max: z.number().int().min(1).max(10).default(5),
});
export type SurveyQuestionInput = z.infer<typeof surveyQuestionInputSchema>;

export const surveySettingsSchema = z.object({
  /** 是否允许同一浏览器重复提交（关闭后按 cookie 判定）。 */
  allowMultiple: z.boolean().default(true),
  thankYouText: z.string().max(SURVEY_THANK_YOU_MAX).default("感谢你的参与，问卷已提交。"),
});
export type SurveySettings = z.infer<typeof surveySettingsSchema>;

export const surveySchema = z.object({
  id: z.number(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(SURVEY_STATUSES),
  questions: z.array(surveyQuestionSchema),
  settings: surveySettingsSchema,
  /** 回收数据落库的多维表格（/data-table?table=）。 */
  tableId: z.number(),
  /** 对外分享路径，前端按当前站点 origin 拼绝对地址。 */
  sharePath: z.string(),
  responseCount: z.number(),
  publishedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Survey = z.infer<typeof surveySchema>;

export const surveyResultOptionSchema = z.object({
  label: z.string(),
  count: z.number(),
  percent: z.number(),
});
export type SurveyResultOption = z.infer<typeof surveyResultOptionSchema>;
export const surveyResultQuestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(SURVEY_QUESTION_TYPES),
  answered: z.number(),
  skipped: z.number(),
  /** 单选 / 多选：逐项票数。 */
  options: z.array(surveyResultOptionSchema).optional(),
  /** 数字 / 评分：均值、最小、最大。 */
  average: z.number().nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  /** 填空：最近几条回答样本。 */
  samples: z.array(z.string()).optional(),
});
export type SurveyResultQuestion = z.infer<typeof surveyResultQuestionSchema>;
export const surveyResultRowSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export const surveyResultsSchema = z.object({
  total: z.number(),
  questions: z.array(surveyResultQuestionSchema),
  rows: z.array(surveyResultRowSchema),
  page: z.number(),
  pageSize: z.number(),
  tableId: z.number(),
});
export type SurveyResults = z.infer<typeof surveyResultsSchema>;

/** 公开填写页读到的问卷（不含内部字段）。 */
export const surveyPublicViewSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["PUBLISHED", "CLOSED"]),
  questions: z.array(surveyQuestionSchema),
  allowMultiple: z.boolean(),
  thankYouText: z.string(),
});
export type SurveyPublicView = z.infer<typeof surveyPublicViewSchema>;

export const surveySubmitBodySchema = z.object({
  answers: z.record(z.string().max(64), z.unknown()).default({}),
});
export const surveySubmitResultSchema = z.object({
  submitted: z.boolean(),
  responseId: z.number(),
  thankYouText: z.string(),
});

export const surveyCreateBodySchema = z.object({
  title: z.string().trim().min(1).max(SURVEY_TITLE_MAX),
  description: z.string().trim().max(SURVEY_DESCRIPTION_MAX).default(""),
  questions: z.array(surveyQuestionInputSchema).min(1).max(SURVEY_QUESTION_MAX),
  settings: surveySettingsSchema.partial().optional(),
});

export const surveyUpdateBodySchema = z.object({
  title: z.string().trim().min(1).max(SURVEY_TITLE_MAX).optional(),
  description: z.string().trim().max(SURVEY_DESCRIPTION_MAX).optional(),
  questions: z.array(surveyQuestionInputSchema).min(1).max(SURVEY_QUESTION_MAX).optional(),
  settings: surveySettingsSchema.partial().optional(),
});

export const surveyEndpoints = {
  Survey_page: {
    method: "get" as const,
    path: "/enterprise/surveys",
    params: emptyQuery,
    query: pageQuerySchema.extend({
      status: z.enum(SURVEY_STATUSES).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(surveySchema)),
  },
  Survey_create: {
    method: "post" as const,
    path: "/enterprise/surveys",
    params: emptyQuery,
    query: emptyQuery,
    body: surveyCreateBodySchema,
    response: envelope(surveySchema),
  },
  Survey_detail: {
    method: "get" as const,
    path: "/enterprise/surveys/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(surveySchema),
  },
  Survey_update: {
    method: "put" as const,
    path: "/enterprise/surveys/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: surveyUpdateBodySchema,
    response: envelope(surveySchema),
  },
  Survey_publish: {
    method: "post" as const,
    path: "/enterprise/surveys/:id/publish",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(surveySchema),
  },
  Survey_close: {
    method: "post" as const,
    path: "/enterprise/surveys/:id/close",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(surveySchema),
  },
  Survey_reopen: {
    method: "post" as const,
    path: "/enterprise/surveys/:id/reopen",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(surveySchema),
  },
  Survey_remove: {
    method: "delete" as const,
    path: "/enterprise/surveys/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean(), tableId: z.number() })),
  },
  Survey_results: {
    method: "get" as const,
    path: "/enterprise/surveys/:id/results",
    params: z.object({ id: z.string().min(1) }),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(surveyResultsSchema),
  },
};
