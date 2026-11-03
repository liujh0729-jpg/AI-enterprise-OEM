"use client";
import { aipddPlatformKeyApi } from "@/api/aipdd-platform-key";
import { ossSettingsApi } from "@/api/oss-settings";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";
export const useOssSettings = () =>
  useBusinessQuery("admin", "oss-settings", {}, (signal) =>
    ossSettingsApi.view({}, { signal }),
  );
/** 保存留空的字段由后端沿用已存值（密钥不回显）。 */
export type OssSettingsDraft = {
  bucket?: string;
  endpoint?: string;
  region?: string;
  dir?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
};
export function useSaveOssSettings() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    (body: OssSettingsDraft) => ossSettingsApi.save({ body }),
    [[...scope, "admin", "oss-settings"]],
  );
}
export function useTestOssSettings() {
  return useBusinessMutation(() => ossSettingsApi.test(), []);
}
/** 平台级 AIPDD APIKey（基础数据通道）：只回掩码，保存后需重新输入才能更换。 */
export const useAipddPlatformKey = () =>
  useBusinessQuery("admin", "aipdd-platform-key", {}, (signal) =>
    aipddPlatformKeyApi.view({ signal }),
  );
export function useSaveAipddPlatformKey() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    (key: string) => aipddPlatformKeyApi.save(key),
    [[...scope, "admin", "aipdd-platform-key"]],
  );
}
export function useClearAipddPlatformKey() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    () => aipddPlatformKeyApi.clear(),
    [[...scope, "admin", "aipdd-platform-key"]],
  );
}
