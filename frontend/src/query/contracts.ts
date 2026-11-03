"use client";
import { contractsApi } from "@/api/contracts";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";
import { workspaceState } from "./workspace-state";

export function useContractOptions(enabled = true) {
  return useBusinessQuery("contracts", "options", {}, signal => contractsApi.options({}, { signal }), "all", enabled);
}

export function useProviderDirectory(
  types: string[],
  province: string,
  city: string,
) {
  const contracts = useContractOptions();
  const groups = useBusinessQuery(
    "contracts",
    "provider-directory",
    { types, province, city },
    async (signal) => {
      const options = { signal };
      const lists = await Promise.all(
          types.map((serviceType) =>
            contractsApi.providers(
              { query: { serviceType, province, city } },
              options,
            ),
          ),
        );
      return Object.fromEntries(
          types.map((type, index) => [type, lists[index] ?? []]),
        );
    },
  );
  return workspaceState({ groups: groups.data ?? {}, contracts: contracts.data ?? [] }, [groups, contracts]);
}

export function useRequestContract() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    (body: { provider_id: string; service_type: string; note: string }) =>
      contractsApi.create({ body }),
    [
      [...scope, "contracts"],
      [...scope, "dashboard"],
    ],
  );
}
