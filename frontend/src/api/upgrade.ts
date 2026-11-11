import {
  apiEnvelope,
  endpoints,
  z,
  type UpgradeAnalysis,
  type UpgradeBackup,
  type UpgradeCheckResult,
  type UpgradeJob,
  type UpgradeOverview,
  type UpgradePackage,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/**
 * 平台升级 API：概览 / 升级包 / 分析任务 / 执行与还原。
 * 上传走 multipart（zip 二进制），其余全部经契约端点。
 */

export type {
  UpgradeAnalysis,
  UpgradeBackup,
  UpgradeCheckResult,
  UpgradeJob,
  UpgradeOverview,
  UpgradePackage,
};

export const upgradeApi = {
  overview: endpoint(endpoints.AdminUpgrade_overview),
  packages: endpoint(endpoints.AdminUpgrade_packages),
  check: endpoint(endpoints.AdminUpgrade_check),
  download: endpoint(endpoints.AdminUpgrade_download),
  removePackage: endpoint(endpoints.AdminUpgrade_removePackage),
  analyze: endpoint(endpoints.AdminUpgrade_analyze),
  job: endpoint(endpoints.AdminUpgrade_job),
  logs: endpoint(endpoints.AdminUpgrade_logs),
  execute: endpoint(endpoints.AdminUpgrade_execute),
  cancel: endpoint(endpoints.AdminUpgrade_cancel),
  backups: endpoint(endpoints.AdminUpgrade_backups),
  restore: endpoint(endpoints.AdminUpgrade_restore),
  removeBackup: endpoint(endpoints.AdminUpgrade_removeBackup),
};

/** 手动上传升级包（zip + 可选版本号）；打包与校验完成后立即解压。 */
export async function uploadUpgradePackage(file: File, version = "") {
  const form = new FormData();
  form.append("file", file);
  if (version.trim()) form.append("version", version.trim());
  const result = await http(
    "/api/backend/enterprise/admin/upgrade/upload",
    apiEnvelope(
      z.object({
        id: z.number().int(),
        version: z.string(),
        fileName: z.string(),
        status: z.string(),
        extracted: z.boolean(),
        invalidReason: z.string(),
      }).passthrough(),
    ),
    { method: "POST", body: form, timeoutMs: 600000 },
  );
  return result.data.data;
}
