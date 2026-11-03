"use client";
import { contractsApi } from "@/api/contracts";
import { identityApi } from "@/api/identity";
import { useSession } from "@/lib/session";
import { useBusinessMutation } from "./business";

/** 签约写操作统一刷新列表、统计和相关业务权限。 */
export function useContractActions() {
  const { me } = useSession();
  const invalidations = [
    ["private", me?.userId ?? "", me?.currentIdentity ?? ""],
  ];
  return {
    assign: useBusinessMutation(identityApi.assign, invalidations),
    create: useBusinessMutation(contractsApi.create, invalidations),
    updateTerms: useBusinessMutation(contractsApi.updateTerms, invalidations),
    remove: useBusinessMutation(contractsApi.remove, invalidations),
    updateContacts: useBusinessMutation(
      contractsApi.updateContacts,
      invalidations,
    ),
    confirm: useBusinessMutation(contractsApi.confirm, invalidations),
    terminate: useBusinessMutation(contractsApi.terminate, invalidations),
    staff: useBusinessMutation(contractsApi.staff, invalidations),
    agent: useBusinessMutation(contractsApi.agent, invalidations),
  };
}
