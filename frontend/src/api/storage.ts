import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 存储底座（积分/OSS 方案 §2）：台账概览与存量 AIPDD→OSS 迁移。 */
export const storageApi = {
  overview: endpoint(endpoints.Storage_overview),
  migrate: endpoint(endpoints.Storage_migrate),
};

export type StorageOverview = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Storage_overview">["data"]
>;
export type StorageMigrationResult = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Storage_migrate">["data"]
>;
