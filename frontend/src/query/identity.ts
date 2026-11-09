"use client";
import { contractsApi } from "@/api/contracts";
import { identityApi } from "@/api/identity";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";

export function useApiKeys() {
  return useBusinessQuery("identity", "api-keys", {}, (signal) =>
    identityApi.apiKeys({}, { signal }),
  );
}
export function useApiKeyUsage(id?: number) {
  return useBusinessQuery(
    "identity",
    "api-key-usage",
    { id },
    (signal) =>
      identityApi.keyUsage({ params: { id: String(id) } }, { signal }),
    "all",
    id !== undefined,
  );
}
export function useApiKeyActions() {
  const { me } = useSession();
  const keys = [
    ...queryKeys.scope(me?.userId || "", me?.currentIdentity || ""),
    "identity",
  ];
  return {
    create: useBusinessMutation(() => identityApi.createKey(), [keys]),
    reset: useBusinessMutation(
      (id: number) => identityApi.resetKey({ params: { id: String(id) } }),
      [keys],
    ),
    revoke: useBusinessMutation(
      (id: number) => identityApi.revokeKey({ params: { id: String(id) } }),
      [keys],
    ),
    quota: useBusinessMutation(
      ({ id, pointsQuota }: { id: number; pointsQuota: number | null }) =>
        identityApi.updateKeyQuota({
          params: { id: String(id) },
          body: { pointsQuota },
        }),
      [keys],
    ),
    reveal: useBusinessMutation(
      (id: number) => identityApi.revealKey({ params: { id: String(id) } }),
      [keys],
    ),
  };
}

export const useEnterpriseProfile = () =>
  useBusinessQuery("identity", "enterprise", {}, (signal) =>
    identityApi.enterprise({}, { signal }),
  );
export const useStaffProfile = () =>
  useBusinessQuery("identity", "staff-profile", {}, (signal) =>
    identityApi.staffProfile({}, { signal }),
  );
export const useProviderApplication = () =>
  useBusinessQuery("identity", "provider-application", {}, (signal) =>
    identityApi.providerApplication({}, { signal }),
  );

type EnterpriseBody = NonNullable<
  Parameters<typeof identityApi.submitEnterprise>[0]
>["body"];
type StaffBody = NonNullable<
  Parameters<typeof identityApi.submitStaff>[0]
>["body"];
type ProviderBody = NonNullable<
  Parameters<typeof identityApi.submitProvider>[0]
>["body"];
type ProviderUpdateBody = NonNullable<
  Parameters<typeof identityApi.updateProvider>[0]
>["body"];
export function useIdentityActions() {
  const { me } = useSession();
  const privateScope = [
    ["private", me?.userId ?? "", me?.currentIdentity ?? ""],
  ];
  return {
    createEnterprise: useBusinessMutation(
      (body: EnterpriseBody) => identityApi.submitEnterprise({ body }),
      privateScope,
    ),
    updateEnterprise: useBusinessMutation(
      (body: EnterpriseBody) => identityApi.updateEnterprise({ body }),
      privateScope,
    ),
    removeEnterprise: useBusinessMutation(
      () => identityApi.removeEnterprise(),
      privateScope,
    ),
    saveStaff: useBusinessMutation(
      (body: StaffBody) => identityApi.submitStaff({ body }),
      privateScope,
    ),
    submitProvider: useBusinessMutation(
      (body: ProviderBody) => identityApi.submitProvider({ body }),
      privateScope,
    ),
    updateProvider: useBusinessMutation(
      ({ id, body }: { id: number; body: ProviderUpdateBody }) =>
        identityApi.updateProvider({ params: { id: String(id) }, body }),
      privateScope,
    ),
    removeProvider: useBusinessMutation(
      (id: number) =>
        identityApi.removeProvider({ params: { id: String(id) } }),
      privateScope,
    ),
  };
}

/** 本人发起的加入申请（职员/个人用户视角的「我的加入申请」）。 */
export function useMyAffiliations(enabled: boolean) {
  return useBusinessQuery(
    "identity",
    "my-affiliations",
    {},
    (signal) => identityApi.myAffiliations({}, { signal }),
    "all",
    enabled,
  );
}

/** 按本人申报板块可申请加入的服务商名录。 */
export function useJoinableProviders(enabled: boolean) {
  return useBusinessQuery(
    "identity",
    "joinable",
    {},
    (signal) => identityApi.joinable({}, { signal }),
    "all",
    enabled,
  );
}

export function useStaffWorkspace(enabled: boolean) {
  return useBusinessQuery(
    "identity",
    "staff-workspace",
    {},
    async (signal) => {
      const [staff, affiliations, enterprises] = await Promise.all([
        identityApi.staff({}, { signal }),
        identityApi.inbox({}, { signal }),
        contractsApi.enterprises({}, { signal }),
      ]);
      return {
        staff: staff ?? [],
        affiliations: affiliations ?? [],
        enterprises: enterprises ?? [],
      };
    },
    "all",
    enabled,
  );
}
export const useStaffRoles = (open: boolean) =>
  useBusinessQuery(
    "identity",
    "staff-roles",
    {},
    (signal) => identityApi.roles({}, { signal }),
    "all",
    open,
    { staleTime: 60 * 60 * 1000 },
  );
export const useStaffSearch = (keyword: string, open: boolean) =>
  useBusinessQuery(
    "identity",
    "staff-search",
    { keyword },
    (signal) => identityApi.search({ query: { q: keyword } }, { signal }),
    "all",
    open && keyword.length >= 2,
  );
