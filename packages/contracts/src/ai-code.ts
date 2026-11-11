import { z } from "zod";
import { upgradeJobSchema } from "./upgrade";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * AI 编程（平台后台自助改码）：管理员选模型后对话改码 → 暂存区差异 → 人工审阅 →
 * 导出补丁（默认）或「备份并执行」（高危，复用平台升级执行器）。
 *
 * 口径（2026-11-11 确认）：模型只写 `update/ai-code/<sessionId>/` 暂存区，绝不直接改线上源码；
 * 应用时新建 `CODE_EDIT` 类型升级任务，备份 / 维护模式 / 构建 / 迁移 / 重启 / 回滚全部沿用
 * 「平台升级与一键还原」，不另造第二套部署链。
 */

export const aiCodeSessionStatusSchema = z.enum([
  "ACTIVE",
  "APPLIED",
  "ARCHIVED",
]);
export type AiCodeSessionStatus = z.infer<typeof aiCodeSessionStatusSchema>;

export const aiCodeMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type AiCodeMessageRole = z.infer<typeof aiCodeMessageRoleSchema>;

export const aiCodeMessageStatusSchema = z.enum([
  "STREAMING",
  "DONE",
  "ERROR",
]);
export type AiCodeMessageStatus = z.infer<typeof aiCodeMessageStatusSchema>;

export const aiCodeChangeTypeSchema = z.enum(["added", "modified", "deleted"]);
export type AiCodeChangeType = z.infer<typeof aiCodeChangeTypeSchema>;

export const aiCodeEditStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "applied",
]);
export type AiCodeEditStatus = z.infer<typeof aiCodeEditStatusSchema>;

/** 对话里上传的参考图 / 文件：落到消息上，供模型读取。 */
export const aiCodeReferenceSchema = z.object({
  name: z.string(),
  url: z.string().default(""),
  mime: z.string().default(""),
  bytes: z.number().int().nonnegative().default(0),
});
export type AiCodeReference = z.infer<typeof aiCodeReferenceSchema>;

/** 一次工具调用留痕：模型读了哪些文件、写了哪些文件都可见。 */
export const aiCodeToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.string().default(""),
  status: z.enum(["running", "success", "error"]).default("success"),
  startedAt: z.string().default(""),
  finishedAt: z.string().default(""),
});
export type AiCodeToolCall = z.infer<typeof aiCodeToolCallSchema>;

export const aiCodeMessageSchema = z.object({
  id: z.number().int(),
  sessionId: z.number().int(),
  role: aiCodeMessageRoleSchema,
  content: z.string(),
  model: z.string().default(""),
  references: z.array(aiCodeReferenceSchema).default([]),
  toolCalls: z.array(aiCodeToolCallSchema).default([]),
  status: aiCodeMessageStatusSchema,
  error: z.string().default(""),
  createdAt: z.string(),
});
export type AiCodeMessage = z.infer<typeof aiCodeMessageSchema>;

export const aiCodeSessionSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  model: z.string(),
  status: aiCodeSessionStatusSchema,
  ownerId: z.number().int(),
  ownerName: z.string().default(""),
  messageCount: z.number().int().nonnegative(),
  editCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  /** 最近一次「备份并执行」产生的升级任务 id */
  jobId: z.number().int().nullable().default(null),
  lastMessage: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiCodeSession = z.infer<typeof aiCodeSessionSchema>;

export const aiCodeSessionDetailSchema = aiCodeSessionSchema.extend({
  stagingDir: z.string().default(""),
  messages: z.array(aiCodeMessageSchema).default([]),
});
export type AiCodeSessionDetail = z.infer<typeof aiCodeSessionDetailSchema>;

export const aiCodeEditSchema = z.object({
  id: z.number().int(),
  sessionId: z.number().int(),
  path: z.string(),
  changeType: aiCodeChangeTypeSchema,
  oldSha: z.string().default(""),
  newSha: z.string().default(""),
  bytes: z.number().int().nonnegative().default(0),
  /** unified diff 文本；新增文件为全量 + 行，删除文件为全量 - 行 */
  diff: z.string().default(""),
  status: aiCodeEditStatusSchema,
  appliedJobId: z.number().int().nullable().default(null),
  updatedAt: z.string(),
});
export type AiCodeEdit = z.infer<typeof aiCodeEditSchema>;

export const aiCodeEditsResultSchema = z.object({
  list: z.array(aiCodeEditSchema),
  summary: z.object({
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  }),
  /** 是否触及高风险面：schema.prisma / 迁移 / 依赖，前端据此强提示 */
  risky: z.object({
    schema: z.boolean().default(false),
    migrations: z.boolean().default(false),
    dependencies: z.boolean().default(false),
  }),
});
export type AiCodeEditsResult = z.infer<typeof aiCodeEditsResultSchema>;

export const aiCodeToolInfoSchema = z.object({
  dump: z.string(),
  restore: z.string(),
  archive: z.string(),
  available: z.boolean(),
  dumpAvailable: z.boolean().default(false),
  archiveAvailable: z.boolean().default(false),
  dialect: z.enum(["mysql", "postgresql"]).default("mysql"),
});

export const aiCodeOverviewSchema = z.object({
  enabled: z.boolean(),
  allowApply: z.boolean(),
  unlocked: z.boolean(),
  unlockExpiresAt: z.string().default(""),
  workspace: z.object({
    root: z.string(),
    updateDir: z.string(),
    version: z.string(),
    commit: z.string().default(""),
    branch: z.string().default(""),
    deploymentMode: z.enum(["dev", "pm2", "systemd", "command", "docker"]),
    autoRestart: z.boolean(),
    hostUpgradeRequired: z.boolean(),
    hostCommand: z.string().default(""),
  }),
  activeJob: upgradeJobSchema.nullable(),
  diskFreeBytes: z.number().int().nonnegative(),
  tools: aiCodeToolInfoSchema,
  /** 当前默认（平台文本模型槽位） */
  model: z.string().default(""),
  limits: z.object({
    maxFiles: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
  }),
});
export type AiCodeOverview = z.infer<typeof aiCodeOverviewSchema>;

export const aiCodeUnlockResultSchema = z.object({
  unlocked: z.boolean(),
  expiresAt: z.string(),
  ttlMinutes: z.number().int().positive(),
});
export type AiCodeUnlockResult = z.infer<typeof aiCodeUnlockResultSchema>;

export const aiCodeModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string().default(""),
  capabilities: z.array(z.string()).default([]),
  current: z.boolean().default(false),
});
export type AiCodeModel = z.infer<typeof aiCodeModelSchema>;

export const aiCodeExportResultSchema = z.object({
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  /** 同源下载地址（带解锁校验） */
  url: z.string(),
});
export type AiCodeExportResult = z.infer<typeof aiCodeExportResultSchema>;

/** 确认文本：在线应用必须手动输入，避免误触。 */
export const AI_CODE_CONFIRM_TEXT = "确认改码";

export const aiCodeEndpoints = {
  AdminAiCode_overview: {
    method: "get" as const,
    path: "/enterprise/admin/ai-code/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiCodeOverviewSchema),
  },
  AdminAiCode_unlock: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/unlock",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      password: z.string().min(1).max(200),
    }),
    response: envelope(aiCodeUnlockResultSchema),
  },
  AdminAiCode_models: {
    method: "get" as const,
    path: "/enterprise/admin/ai-code/models",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        list: z.array(aiCodeModelSchema),
        current: z.string().default(""),
      }),
    ),
  },
  AdminAiCode_sessions: {
    method: "get" as const,
    path: "/enterprise/admin/ai-code/sessions",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ list: z.array(aiCodeSessionSchema) })),
  },
  AdminAiCode_createSession: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/sessions",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      title: z.string().trim().max(120).default(""),
      model: z.string().trim().max(200).default(""),
    }),
    response: envelope(aiCodeSessionDetailSchema),
  },
  AdminAiCode_session: {
    method: "get" as const,
    path: "/enterprise/admin/ai-code/sessions/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiCodeSessionDetailSchema),
  },
  AdminAiCode_edits: {
    method: "get" as const,
    path: "/enterprise/admin/ai-code/sessions/:id/edits",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiCodeEditsResultSchema),
  },
  AdminAiCode_approve: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/sessions/:id/approve",
    params: idParams,
    query: emptyQuery,
    body: z.object({
      path: z.string().trim().min(1).max(400),
      status: z.enum(["approved", "rejected"]),
    }),
    response: envelope(aiCodeEditsResultSchema),
  },
  AdminAiCode_revert: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/sessions/:id/revert",
    params: idParams,
    query: emptyQuery,
    body: z.object({
      /** 空＝全部弃用 */
      path: z.string().trim().max(400).default(""),
    }),
    response: envelope(
      z.object({
        reverted: z.number().int().nonnegative(),
        list: z.array(aiCodeEditSchema),
      }),
    ),
  },
  AdminAiCode_export: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/sessions/:id/export",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiCodeExportResultSchema),
  },
  AdminAiCode_apply: {
    method: "post" as const,
    path: "/enterprise/admin/ai-code/apply",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      sessionId: z.coerce.number().int().positive(),
      /** 数据库备份是硬性要求，只接受 true */
      backupDatabase: z
        .boolean()
        .refine((value) => value, "应用前必须备份数据库"),
      backupCode: z.boolean().default(true),
      autoRollback: z.boolean().default(true),
      conflictStrategy: z.enum(["overwrite", "abort"]).default("overwrite"),
      /** 重复确认：必须手动输入「确认改码」 */
      confirmation: z
        .string()
        .trim()
        .refine(
          (value) => value === AI_CODE_CONFIRM_TEXT,
          `确认文本不正确，请输入「${AI_CODE_CONFIRM_TEXT}」`,
        ),
    }),
    response: envelope(upgradeJobSchema),
  },
};
