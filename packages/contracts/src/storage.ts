import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 存储底座契约（积分/OSS 方案 §2）：
 * 数字资产字节统一落本站 OSS；后台可查看台账占用，并把历史 AIPDD 托管资产分批转存。
 * 管理动作由处理器内 `requireAdmin` 收口。
 */

export const storageOverviewSchema = z.object({
  totalAssets: z.number().int(),
  /** 字节已在本站 OSS 的资产数 */
  localAssets: z.number().int(),
  /** 仍托管在 AIPDD、待迁移的资产数 */
  legacyAssets: z.number().int(),
  /** migratedFrom=aipdd 的历史迁移数 */
  migratedAssets: z.number().int(),
  storageMb: z.number(),
  storageBytes: z.number(),
  lastSnapshot: z
    .object({
      at: z.string(),
      bytes: z.number(),
      assets: z.number().int(),
    })
    .nullable(),
  pricing: z
    .object({
      unit: z.string(),
      unitPriceAmount: z.string(),
      enabled: z.boolean(),
    })
    .nullable(),
});

export const storageMigrationBodySchema = z.object({
  /** 单批条数，默认 20，最大 100 */
  limit: z.number().int().min(1).max(100).default(20),
  /** 上一批返回的 nextCursor；从头重跑传 0 可重试失败项 */
  cursor: z.number().int().min(0).default(0),
});

export const storageMigrationResultSchema = z.object({
  processed: z.number().int(),
  migrated: z.number().int(),
  failed: z.number().int(),
  nextCursor: z.number().int(),
  remaining: z.number().int(),
  results: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      status: z.enum(["migrated", "failed"]),
      reason: z.string(),
    }),
  ),
});

export const storageEndpoints = {
  Storage_overview: {
    method: "get" as const,
    path: "/enterprise/admin/storage/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(storageOverviewSchema),
  },
  /** 存量 AIPDD 资产 → 本站 OSS：按 id 游标分批，可中断续跑，失败项下次重跑会再试。 */
  Storage_migrate: {
    method: "post" as const,
    path: "/enterprise/admin/storage/migrate",
    params: z.object({}),
    query: emptyQuery,
    body: storageMigrationBodySchema,
    response: envelope(storageMigrationResultSchema),
  },
};
