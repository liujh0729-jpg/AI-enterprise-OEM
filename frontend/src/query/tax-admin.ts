"use client";
import { capabilityAdminApi } from "@/api/capability-admin";
import { qxyAccountsApi, type QxyAccountDraft } from "@/api/qxy-accounts";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";

/** 平台「财税管理」账号池：列表 + 增删改 + 税号匹配（保存后刷新能力矩阵与申请列表）。 */
const RESOURCE = "qxy-accounts";

export const useQxyAccounts = () =>
  useBusinessQuery("admin", RESOURCE, {}, (signal) =>
    qxyAccountsApi.list({ signal }),
  );

/** 已开通的自动化能力（按能力维度，带开通时间与匹配账号）。 */
export const useOpenedCapabilities = (page: number) =>
  useBusinessQuery(
    "admin",
    "capability-opened",
    { page },
    (signal) => capabilityAdminApi.openedPage({ page }, { signal }),
  );

function useAccountsMutation<T>(action: (input: T) => Promise<unknown>) {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(action, [[...scope, "admin", RESOURCE]]);
}

export function useSaveQxyAccount() {
  return useAccountsMutation((body: QxyAccountDraft) =>
    qxyAccountsApi.save(body),
  );
}

export function useRemoveQxyAccount() {
  return useAccountsMutation((id: string) => qxyAccountsApi.remove(id));
}

export function useBindQxyTaxNo() {
  return useAccountsMutation((input: { id: string; taxNo: string }) =>
    qxyAccountsApi.bind(input.id, input.taxNo),
  );
}

export function useUnbindQxyTaxNo() {
  return useAccountsMutation((input: { id: string; taxNo: string }) =>
    qxyAccountsApi.unbind(input.id, input.taxNo),
  );
}