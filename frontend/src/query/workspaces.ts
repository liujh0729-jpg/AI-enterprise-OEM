"use client";
import { flexApi } from "@/api/flex";
import { overseasApi } from "@/api/overseas";
import { supplyApi } from "@/api/supply";
import { taxApi } from "@/api/tax";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";
import { useSession } from "@/lib/session";
import { externalApi } from "@/api/external";
import { identityApi } from "@/api/identity";
import { useContractOptions } from "./contracts";
import { workspaceState } from "./workspace-state";

export function useOverseasWorkspace(enabled: boolean, catalog = true) {
  const contracts = useContractOptions(enabled);
  const providers = useBusinessQuery(
    "overseas",
    "catalog",
    {},
    async (signal) => {
      return (await overseasApi.catalog({}, { signal })) ?? [];
    },
    "all",
    enabled && catalog,
  );
  return workspaceState({ providers: providers.data ?? [], contracts: contracts.data ?? [] }, enabled ? [contracts, ...(catalog ? [providers] : [])] : []);
}

export function useFlexWorkspace() {
  const contracts = useContractOptions();
  return workspaceState({ contracts: contracts.data ?? [] }, [contracts]);
}

export function useSupplyWorkspace(view: string) {
  const enabled = !["requests", "publish"].includes(view);
  const needProducts = ["stations", "products", "orders", "providers"].includes(view);
  const needServices = ["stations", "services", "bookings", "providers"].includes(view);
  const stations = useBusinessQuery("supply", "stations", {}, signal => supplyApi.stations({}, { signal }), "all", enabled);
  const products = useBusinessQuery("supply", "products", { all: "1" }, signal => supplyApi.products({ query: { all: "1" } }, { signal }), "all", enabled && needProducts);
  const services = useBusinessQuery("supply", "services", { all: "1" }, signal => supplyApi.services({ query: { all: "1" } }, { signal }), "all", enabled && needServices);
  const contracts = useContractOptions(enabled);
  return workspaceState({ stations: stations.data ?? [], products: products.data ?? [], services: services.data ?? [], contracts: contracts.data ?? [] },
    enabled ? [stations, contracts, ...(needProducts ? [products] : []), ...(needServices ? [services] : [])] : []);
}

export function useTaxWorkspace(enabled: boolean, includeProviders = true) {
  const meta = useBusinessQuery("tax", "meta", {}, signal => taxApi.meta({}, { signal }), "all", enabled, { staleTime: 60 * 60 * 1000 });
  const contracts = useContractOptions(enabled);
  const providers = useBusinessQuery("tax", "providers", {}, signal => taxApi.providers({}, { signal }), "all", enabled && includeProviders);
  return workspaceState({ meta: meta.data, contracts: contracts.data ?? [], providers: providers.data ?? [] },
    enabled ? [meta, contracts, ...(includeProviders ? [providers] : [])] : []);
}
export function useTaxDeclaration(id: number | null, enabled: boolean) {
  return useBusinessQuery(
    "tax",
    "declaration",
    { id },
    (signal) => taxApi.declDetail({ params: { id: String(id) } }, { signal }),
    "all",
    enabled && id !== null,
  );
}

export function useMobileOrderOptions() {
  const contracts = useContractOptions();
  const stations = useBusinessQuery("supply", "stations", {}, signal => supplyApi.stations({}, { signal }));
  return workspaceState({ stations: stations.data ?? [], contracts: contracts.data ?? [] }, [stations, contracts]);
}
export function useStationProducts(stationId: number) {
  return useBusinessQuery(
    "supply",
    "station-products",
    { stationId },
    (signal) =>
      supplyApi.products(
        { query: { stationId: String(stationId) } },
        { signal },
      ),
    "all",
    stationId > 0,
  );
}
export function useMobileOrders(page: number, status: string) {
  const contracts = useContractOptions();
  const orders = useBusinessQuery(
    "supply",
    "mobile-orders",
    { page, status },
    async (signal) => {
      const [orders, stats] = await Promise.all([
        supplyApi.orderPage(
          { query: { page, pageSize: 20, status: status || undefined } },
          { signal },
        ),
        supplyApi.orderStats({}, { signal }),
      ]);
      return {
        orders: orders?.list ?? [],
        total: orders?.total ?? 0,
        stats,
      };
    },
  );
  return workspaceState({ orders: orders.data?.orders ?? [], total: orders.data?.total ?? 0, stats: orders.data?.stats, contracts: contracts.data ?? [] }, [orders, contracts]);
}
export function useCreateSupplyOrder() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    (body: NonNullable<Parameters<typeof supplyApi.createOrder>[0]>["body"]) =>
      supplyApi.createOrder({ body }),
    [
      [...scope, "supply"],
      [...scope, "dashboard"],
    ],
  );
}
export function useSupplyOrderNote() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  const methods = {
    confirm: supplyApi.confirmOrder,
    return: supplyApi.returnOrder,
    veto: supplyApi.vetoOrder,
    cancel: supplyApi.cancelOrder,
  };
  return useBusinessMutation(
    ({
      id,
      action,
      note,
    }: {
      id: number;
      action: keyof typeof methods;
      note: string;
    }) => methods[action]({ params: { id: String(id) }, body: { note } }),
    [
      [...scope, "supply"],
      [...scope, "dashboard"],
    ],
  );
}
export function useFlexResources(
  recordType: "ORG" | "AGENT",
  filters: { province: string; city: string; keyword: string },
) {
  return useBusinessQuery(
    "flex",
    "resources",
    { recordType, ...filters },
    async (signal) => {
      const [rows, affiliations] = await Promise.all([
        flexApi.providers({ query: { recordType, ...filters } }, { signal }),
        identityApi.myAffiliations({}, { signal }),
      ]);
      return { rows: rows ?? [], affiliations: affiliations ?? [] };
    },
  );
}

export function useProviderStaff(enabled: boolean) {
  return useBusinessQuery(
    "identity",
    "staff",
    {},
    (signal) => identityApi.staff({}, { signal }),
    "all",
    enabled,
  );
}

export function useExternalCredentials(enterpriseId: number) {
  return useBusinessQuery(
    "external",
    "credentials",
    { enterpriseId },
    (signal) =>
      externalApi.listCredentials(
        { query: { enterpriseId: String(enterpriseId) } },
        { signal },
      ),
    enterpriseId,
    enterpriseId > 0,
  );
}

type CredentialBody = NonNullable<
  Parameters<typeof externalApi.saveCredential>[0]
>["body"];
export function useExternalCredentialActions(enterpriseId: number) {
  const { me } = useSession();
  const scope = queryKeys.scope(
    me?.userId ?? "",
    me?.currentIdentity ?? "",
    enterpriseId,
  );
  return {
    save: useBusinessMutation(
      (body: CredentialBody) => externalApi.saveCredential({ body }),
      [[...scope, "external"]],
    ),
    remove: useBusinessMutation(
      (id: number) =>
        externalApi.removeCredential({
          params: { id: String(id) },
          query: { enterpriseId: String(enterpriseId) },
        }),
      [[...scope, "external"]],
    ),
  };
}

export const useOverseasClaims = (page: number) =>
  useBusinessQuery("overseas", "claims", { page }, (signal) =>
    overseasApi.claimPage({ query: { page, pageSize: 20 } }, { signal }),
  );
export const useOverseasClaim = (id: number | null) =>
  useBusinessQuery(
    "overseas",
    "claim",
    { id },
    (signal) =>
      overseasApi.claimDetail({ params: { id: String(id) } }, { signal }),
    "all",
    id !== null,
  );
export const useFlexOnboardings = (page: number) =>
  useBusinessQuery("flex", "onboardings", { page }, (signal) =>
    flexApi.onboardingPage({ query: { page, pageSize: 20 } }, { signal }),
  );
export const useFlexPayrolls = (page: number, status: string) =>
  useBusinessQuery("flex", "payrolls", { page, status }, (signal) =>
    flexApi.payrollPage(
      { query: { page, pageSize: 20, status: status || undefined } },
      { signal },
    ),
  );
export const useFlexPayrollStats = () =>
  useBusinessQuery("flex", "payroll-stats", {}, (signal) =>
    flexApi.payrollStats({}, { signal }),
  );
export const useSupplyOrders = (page: number) =>
  useBusinessQuery("supply", "orders", { page }, (signal) =>
    supplyApi.orderPage({ query: { page, pageSize: 20 } }, { signal }),
  );
export const useSupplyBookings = (page: number) =>
  useBusinessQuery("supply", "bookings", { page }, (signal) =>
    supplyApi.bookingPage({ query: { page, pageSize: 20 } }, { signal }),
  );

export const useSupplyLogs = (kind: "orders" | "bookings", id: number | null) =>
  useBusinessQuery(
    "supply",
    "logs",
    { kind, id },
    (signal) =>
      (kind === "orders" ? supplyApi.orderLogs : supplyApi.bookingLogs)(
        { params: { id: String(id) } },
        { signal },
      ),
    "all",
    id !== null,
  );
export function useSupplyBookingNote() {
  const methods = {
    confirm: supplyApi.confirmBooking,
    return: supplyApi.returnBooking,
    veto: supplyApi.vetoBooking,
    cancel: supplyApi.cancelBooking,
  };
  return useBusinessMutation(
    ({
      id,
      action,
      note,
    }: {
      id: number;
      action: keyof typeof methods;
      note: string;
    }) => methods[action]({ params: { id: String(id) }, body: { note } }),
    ["supply", "dashboard"],
  );
}
