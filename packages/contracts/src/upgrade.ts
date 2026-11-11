import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * 平台升级：升级包 → 智能分析 → 执行（强制备份）→ 备份与还原。
 * 执行器是独立于 API 的 runner 进程；这里的 DTO 只描述平台后台看到的状态。
 */

export const upgradeJobTypeSchema = z.enum([
  "ANALYSIS",
  "UPGRADE",
  "RESTORE",
  "CODE_EDIT",
]);
export type UpgradeJobType = z.infer<typeof upgradeJobTypeSchema>;

export const upgradeJobStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
  "ROLLED_BACK",
]);
export type UpgradeJobStatus = z.infer<typeof upgradeJobStatusSchema>;

export const upgradeStepStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
]);
export type UpgradeStepStatus = z.infer<typeof upgradeStepStatusSchema>;

export const upgradePackageSourceSchema = z.enum(["GITHUB_RELEASE", "GITHUB_SOURCE", "UPLOAD"]);
export type UpgradePackageSource = z.infer<typeof upgradePackageSourceSchema>;

export const upgradePackageStatusSchema = z.enum([
  "DOWNLOADING",
  "VERIFIED",
  "EXTRACTED",
  "INVALID",
]);
export type UpgradePackageStatus = z.infer<typeof upgradePackageStatusSchema>;

export const upgradeRiskSchema = z.enum(["low", "medium", "high", "blocked"]);
export type UpgradeRisk = z.infer<typeof upgradeRiskSchema>;

export const upgradeAnalysisSchema = z.object({
  risk: upgradeRiskSchema,
  summary: z.string(),
  modules: z.array(z.string()).default([]),
  migrations: z
    .array(
      z.object({
        name: z.string(),
        risk: upgradeRiskSchema,
        note: z.string().default(""),
      }),
    )
    .default([]),
  dependencies: z
    .array(
      z.object({
        name: z.string(),
        from: z.string().default(""),
        to: z.string().default(""),
        change: z.string().default(""),
      }),
    )
    .default([]),
  envChanges: z
    .object({
      added: z.array(z.string()).default([]),
      removed: z.array(z.string()).default([]),
      changed: z.array(z.string()).default([]),
    })
    .default({ added: [], removed: [], changed: [] }),
  conflicts: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  downtime: z.string().default(""),
  strategy: z.array(z.string()).default([]),
  preChecks: z.array(z.string()).default([]),
  postChecks: z.array(z.string()).default([]),
  rollback: z.array(z.string()).default([]),
  evidence: z
    .array(z.object({ file: z.string(), reason: z.string() }))
    .default([]),
  /** agent＝平台模型生成；rules＝规则降级，模型不可用时仍能给出结论 */
  source: z.enum(["agent", "rules"]).default("agent"),
  model: z.string().default(""),
  notice: z.string().default(""),
});
export type UpgradeAnalysis = z.infer<typeof upgradeAnalysisSchema>;

export const upgradePackageSchema = z.object({
  id: z.number().int(),
  source: upgradePackageSourceSchema,
  status: upgradePackageStatusSchema,
  version: z.string(),
  tag: z.string(),
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  releaseNotes: z.string().default(""),
  publishedAt: z.string().default(""),
  extracted: z.boolean(),
  invalidReason: z.string().default(""),
  createdAt: z.string(),
});
export type UpgradePackage = z.infer<typeof upgradePackageSchema>;

export const upgradeBackupSchema = z.object({
  id: z.number().int(),
  jobId: z.number().int(),
  kind: z.enum(["DATABASE", "CODE"]),
  version: z.string(),
  dialect: z.string(),
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  verified: z.boolean(),
  locked: z.boolean(),
  createdAt: z.string(),
});
export type UpgradeBackup = z.infer<typeof upgradeBackupSchema>;

export const upgradeStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: upgradeStepStatusSchema,
  startedAt: z.string().default(""),
  finishedAt: z.string().default(""),
  message: z.string().default(""),
});
export type UpgradeStep = z.infer<typeof upgradeStepSchema>;

export const upgradeJobSchema = z.object({
  id: z.number().int(),
  type: upgradeJobTypeSchema,
  status: upgradeJobStatusSchema,
  packageId: z.number().int(),
  fromVersion: z.string(),
  toVersion: z.string(),
  currentStep: z.string(),
  progress: z.number().int().min(0).max(100),
  error: z.string().default(""),
  /** 任务来源：升级包 / 还原 / AI 编程改码；`sourceRefId` 为 AI 编程会话 id */
  sourceKind: z.enum(["UPGRADE", "RESTORE", "CODE_EDIT"]).default("UPGRADE"),
  sourceRefId: z.number().int().nullable().default(null),
  analysis: upgradeAnalysisSchema.nullable(),
  options: z
    .object({
      backupDatabase: z.boolean().default(false),
      backupCode: z.boolean().default(false),
      autoRollback: z.boolean().default(false),
      conflictStrategy: z.enum(["overwrite", "abort"]).default("overwrite"),
      /** 还原任务的还原范围；升级任务为空 */
      mode: z.enum(["FULL", "DATABASE"]).optional(),
    })
    .nullable(),
  steps: z.array(upgradeStepSchema),
  createdAt: z.string(),
  startedAt: z.string().default(""),
  finishedAt: z.string().default(""),
});
export type UpgradeJob = z.infer<typeof upgradeJobSchema>;

export const upgradeOverviewSchema = z.object({
  currentVersion: z.string(),
  currentCommit: z.string(),
  deployment: z.object({
    mode: z.enum(["dev", "pm2", "systemd", "command", "docker"]),
    autoRestart: z.boolean(),
    hostUpgradeRequired: z.boolean(),
    hostCommand: z.string().default(""),
    updateDir: z.string(),
  }),
  latestPackage: upgradePackageSchema.nullable(),
  activeJob: upgradeJobSchema.nullable(),
  maintenance: z.boolean(),
  backupCount: z.number().int().nonnegative(),
  diskFreeBytes: z.number().int().nonnegative(),
  tools: z.object({
    dump: z.string(),
    restore: z.string(),
    archive: z.string(),
    available: z.boolean(),
    dumpAvailable: z.boolean().default(false),
    archiveAvailable: z.boolean().default(false),
    dialect: z.enum(["mysql", "postgresql"]).default("mysql"),
  }),
  analysisModel: z.string().default(""),
});
export type UpgradeOverview = z.infer<typeof upgradeOverviewSchema>;

export const upgradeCheckResultSchema = z.object({
  tag: z.string(),
  name: z.string(),
  version: z.string(),
  publishedAt: z.string(),
  releaseNotes: z.string(),
  assetName: z.string(),
  assetBytes: z.number().int().nonnegative(),
  downloadUrl: z.string(),
  sourceUrl: z.string(),
});
export type UpgradeCheckResult = z.infer<typeof upgradeCheckResultSchema>;

export const upgradeUploadResultSchema = upgradePackageSchema;

export const upgradeJobsQuerySchema = emptyQuery;

export const upgradeEndpoints = {
  AdminUpgrade_overview: {
    method: "get" as const,
    path: "/enterprise/admin/upgrade/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(upgradeOverviewSchema),
  },
  AdminUpgrade_packages: {
    method: "get" as const,
    path: "/enterprise/admin/upgrade/packages",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ list: z.array(upgradePackageSchema) })),
  },
  AdminUpgrade_check: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/check",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(upgradeCheckResultSchema),
  },
  AdminUpgrade_download: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/download",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      mode: z.enum(["release", "source"]).default("release"),
      tag: z.string().trim().max(64).default(""),
    }),
    response: envelope(upgradePackageSchema),
  },
  AdminUpgrade_removePackage: {
    method: "delete" as const,
    path: "/enterprise/admin/upgrade/packages/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number().int() })),
  },
  AdminUpgrade_analyze: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/analyze",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ packageId: z.coerce.number().int().positive() }),
    response: envelope(upgradeJobSchema),
  },
  AdminUpgrade_job: {
    method: "get" as const,
    path: "/enterprise/admin/upgrade/jobs/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(upgradeJobSchema),
  },
  AdminUpgrade_logs: {
    method: "get" as const,
    path: "/enterprise/admin/upgrade/jobs/:id/logs",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ text: z.string(), updatedAt: z.string() }),
    ),
  },
  AdminUpgrade_execute: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/jobs",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      packageId: z.coerce.number().int().positive(),
      /** 数据库备份是硬性要求，只接受 true */
      backupDatabase: z.boolean().refine((value) => value, "升级前必须备份数据库"),
      backupCode: z.boolean().default(true),
      autoRollback: z.boolean().default(true),
      conflictStrategy: z.enum(["overwrite", "abort"]).default("overwrite"),
      /** 重复确认：必须输入目标版本号 */
      confirmation: z.string().trim().min(1),
    }),
    response: envelope(upgradeJobSchema),
  },
  AdminUpgrade_cancel: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/jobs/:id/cancel",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(upgradeJobSchema),
  },
  AdminUpgrade_backups: {
    method: "get" as const,
    path: "/enterprise/admin/upgrade/backups",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        list: z.array(upgradeBackupSchema),
        totalBytes: z.number().int().nonnegative(),
      }),
    ),
  },
  AdminUpgrade_restore: {
    method: "post" as const,
    path: "/enterprise/admin/upgrade/restores",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      backupId: z.coerce.number().int().positive(),
      mode: z.enum(["FULL", "DATABASE"]).default("FULL"),
      /** 重复确认：完整还原输入 RESTORE，仅数据库输入 RESTORE-DB */
      confirmation: z.string().trim().min(1),
    }),
    response: envelope(upgradeJobSchema),
  },
  AdminUpgrade_removeBackup: {
    method: "delete" as const,
    path: "/enterprise/admin/upgrade/backups/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number().int() })),
  },
};
