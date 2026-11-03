import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 专题大厅：登录账号发起「企业内」或「公开」的专题讨论，受众可发言（可用数字分身署名）；
 * 发起人随时结案（AI 对全部楼层出总结，可反复重新结案），关闭后不再展示，删除仅发起人与管理员。
 */

export const QUESTION_HALL_SCOPES = ["ENTERPRISE", "PUBLIC"] as const;
export type QuestionHallScope = (typeof QUESTION_HALL_SCOPES)[number];
export const QUESTION_HALL_SCOPE_LABELS: Record<string, string> = {
  ENTERPRISE: "企业内",
  PUBLIC: "公开",
};

export const QUESTION_HALL_STATUSES = ["OPEN", "RESOLVED", "CLOSED"] as const;
export type QuestionHallStatus = (typeof QUESTION_HALL_STATUSES)[number];
export const QUESTION_HALL_STATUS_LABELS: Record<string, string> = {
  OPEN: "进行中",
  RESOLVED: "已结案",
  CLOSED: "已关闭",
};

/** 发言人：真实个人 / 数字分身（分身只决定署名与口吻，内容由本人写）。 */
export const QUESTION_HALL_AUTHOR_KINDS = ["PERSON", "AVATAR"] as const;
export const QUESTION_HALL_AUTHOR_KIND_LABELS: Record<string, string> = {
  PERSON: "本人",
  AVATAR: "数字分身",
};

export const questionHallQuestionSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  scope: z.string(),
  scopeLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  /** 发布人昵称快照；公开问题不展示所属组织 */
  authorName: z.string(),
  replyCount: z.number(),
  lastReplyAt: z.string(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 我是不是发布者 */
  mine: z.boolean(),
  /** 我是否在这个问题的受众里且问题未关闭（决定是否渲染发言框） */
  canReply: z.boolean(),
  /** 发布者或平台管理员（结案 / 关闭 / 重新开放 / 删除） */
  canManage: z.boolean(),
});
export type QuestionHallQuestion = z.infer<typeof questionHallQuestionSchema>;

export const questionHallMessageSchema = z.object({
  id: z.number(),
  questionId: z.number(),
  /** 0＝顶层回复；>0＝回复的回复（挂在顶层下，只做两层） */
  parentId: z.number(),
  body: z.string(),
  authorKind: z.string(),
  personaId: z.number(),
  /** 昵称；用分身时为「昵称 · 分身名」 */
  authorLabel: z.string(),
  createdAt: z.string(),
  mine: z.boolean(),
  /** 作者本人、问题发布者或平台管理员 */
  canDelete: z.boolean(),
});
export type QuestionHallMessage = z.infer<typeof questionHallMessageSchema>;

export const questionHallSummarySchema = z.object({
  id: z.number(),
  questionId: z.number(),
  /** 第几次结案（1 起）；重新结案不覆盖历史 */
  seq: z.number(),
  content: z.string(),
  messageCount: z.number(),
  truncated: z.boolean(),
  model: z.string(),
  createdAt: z.string(),
});
export type QuestionHallSummary = z.infer<typeof questionHallSummarySchema>;

export const questionHallDetailSchema = z.object({
  question: questionHallQuestionSchema,
  /** 按时间正序的两层楼层 */
  messages: z.array(questionHallMessageSchema),
  /** 结案记录（最新在前） */
  summaries: z.array(questionHallSummarySchema),
});
export type QuestionHallDetail = z.infer<typeof questionHallDetailSchema>;

/** 提问弹窗与发言框要用的账号级选项：可选分身 + 我发布企业内问题时归属的组织。 */
export const questionHallConfigSchema = z.object({
  personas: z.array(z.object({ id: z.number(), name: z.string() })),
  /** 我发布「企业内」问题时的组织名；空串＝没有组织成员，只有自己可见 */
  orgName: z.string(),
});
export type QuestionHallConfig = z.infer<typeof questionHallConfigSchema>;

export const QUESTION_HALL_TITLE_MAX = 200;
export const QUESTION_HALL_BODY_MAX = 4000;

export const questionHallEndpoints = {
  QuestionHall_questions: {
    method: "get" as const,
    path: "/enterprise/question-hall/questions",
    params: z.object({}),
    query: pageQuerySchema.extend({
      scope: z.enum(QUESTION_HALL_SCOPES).optional(),
      status: z.enum(QUESTION_HALL_STATUSES).optional(),
      keyword: z.string().max(120).optional(),
      /** created＝我发布的；joined＝我参与过的 */
      mine: z.enum(["created", "joined"]).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(questionHallQuestionSchema)),
  },
  QuestionHall_questionDetail: {
    method: "get" as const,
    path: "/enterprise/question-hall/questions/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(questionHallDetailSchema),
  },
  QuestionHall_createQuestion: {
    method: "post" as const,
    path: "/enterprise/question-hall/questions",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      title: z.string().min(1).max(QUESTION_HALL_TITLE_MAX),
      body: z.string().min(1).max(QUESTION_HALL_BODY_MAX),
      scope: z.enum(QUESTION_HALL_SCOPES).default("ENTERPRISE"),
    }),
    response: envelope(questionHallQuestionSchema),
  },
  QuestionHall_reply: {
    method: "post" as const,
    path: "/enterprise/question-hall/questions/:id/replies",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({
      content: z.string().min(1).max(QUESTION_HALL_BODY_MAX),
      /** 0＝回复问题；>0＝回复该顶层楼层 */
      parentId: z.number().int().nonnegative().default(0),
      /** 0＝以本人发言；>0＝用该数字分身署名 */
      personaId: z.number().int().nonnegative().default(0),
    }),
    response: envelope(questionHallDetailSchema),
  },
  QuestionHall_resolve: {
    method: "post" as const,
    path: "/enterprise/question-hall/questions/:id/resolve",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(questionHallDetailSchema),
  },
  QuestionHall_close: {
    method: "post" as const,
    path: "/enterprise/question-hall/questions/:id/close",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(questionHallQuestionSchema),
  },
  QuestionHall_reopen: {
    method: "post" as const,
    path: "/enterprise/question-hall/questions/:id/reopen",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(questionHallQuestionSchema),
  },
  QuestionHall_deleteQuestion: {
    method: "delete" as const,
    path: "/enterprise/question-hall/questions/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  QuestionHall_deleteReply: {
    method: "delete" as const,
    path: "/enterprise/question-hall/replies/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  QuestionHall_config: {
    method: "get" as const,
    path: "/enterprise/question-hall/config",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(questionHallConfigSchema),
  },
};
