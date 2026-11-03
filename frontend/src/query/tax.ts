"use client";
import { externalApi } from "@/api/external";
import { invoiceApi } from "@/api/invoice";
import { taxApi } from "@/api/tax";
import { capabilityApi } from "@/api/capability";
import { contractsApi } from "@/api/contracts";
import { qxyApi } from "@/api/qxy";
import { useBusinessQuery, useOperationMutation } from "./business";
export const useCurrentMaterialPack = (period: string) =>
  useBusinessQuery("tax", "current-material", { period }, (signal) =>
    taxApi.currentMaterialPack({ query: { period } }, { signal }),
  );
export const useMaterialDetail = (id: number) =>
  useBusinessQuery(
    "tax",
    "material-detail",
    { id },
    (signal) =>
      taxApi.materialPackDetail({ params: { id: String(id) } }, { signal }),
    "all",
    id > 0,
  );
export const useTaxBoard = (period: string, page: number) =>
  useBusinessQuery("tax", "board", { period, page }, async (signal) => {
    const options = { signal };
    const [current, history] = await Promise.all([
      taxApi.currentMaterialPack({ query: { period } }, options),
      taxApi.materialPage({ query: { page, pageSize: 20 } }, options),
    ]);
    const pack = current
      ? await taxApi.materialPackDetail(
          { params: { id: String(current.id) } },
          options,
        )
      : null;
    return { pack, history: history?.list ?? [], total: history?.total ?? 0 };
  });
export const useTaxCapabilities = (enterpriseId: number) =>
  useBusinessQuery(
    "tax",
    "capabilities",
    { enterpriseId },
    (signal) =>
      capabilityApi.mine(
        { query: { enterpriseId: String(enterpriseId) } },
        { signal },
      ),
    enterpriseId,
    enterpriseId > 0,
  );
export const useServedCapabilities = () =>
  useBusinessQuery("tax", "served-capabilities", {}, (signal) =>
    capabilityApi.served({}, { signal }),
  );
export const useTaxOptions = () =>
  useBusinessQuery(
    "tax",
    "options",
    {},
    (signal) => qxyApi.options({}, { signal }),
    "all",
    true,
    { staleTime: 60 * 60 * 1000 },
  );
export const useServedEnterprises = (enabled: boolean) =>
  useBusinessQuery(
    "tax",
    "served-enterprises",
    {},
    (signal) => contractsApi.enterprises({}, { signal }),
    "all",
    enabled,
  );

export const useTaxMeta = () =>
  useBusinessQuery(
    "tax",
    "meta",
    {},
    (signal) => taxApi.meta({}, { signal }),
    "all",
    true,
    { staleTime: 60 * 60 * 1000 },
  );
export const useTaxRecords = (kind: string, page: number) =>
  useBusinessQuery("tax", "records", { kind, page }, (signal) =>
    taxApi.recordPage(
      { query: { kind: kind || undefined, page, pageSize: 20 } },
      { signal },
    ),
  );
export const useInvoiceRequests = (
  page: number,
  status: string,
  enterpriseId?: number,
) =>
  useBusinessQuery(
    "invoice",
    "requests",
    { page, status, enterpriseId },
    (signal) =>
      invoiceApi.page(
        {
          query: {
            page,
            pageSize: 20,
            status: status || undefined,
            enterpriseId,
          },
        },
        { signal },
      ),
  );
export const useInvoiceStats = (enterpriseId?: number) =>
  useBusinessQuery("invoice", "stats", { enterpriseId }, (signal) =>
    invoiceApi.stats({ query: { enterpriseId } }, { signal }),
  );
export const useExternalDeclaration = (id: number) =>
  useBusinessQuery("external", "declaration", { id }, async (signal) => {
    const rows = await externalApi.byRef(
      { query: { refType: "TAX_DECLARATION", refId: String(id) } },
      { signal },
    );
    const preview = rows?.length
      ? null
      : await externalApi.preview(
          { params: { declId: String(id) } },
          { signal },
        );
    return { rows: rows ?? [], preview };
  });
export const useQxyInvoices = (
  id: number,
  range: { start: string; end: string } | null,
) =>
  useBusinessQuery(
    "tax",
    "issued-invoices",
    { id, range },
    (signal) => qxyApi.invoiceList(id, range ?? { start: "", end: "" }, signal),
    id,
    id > 0 && range !== null,
  );

export const useTaxDeclarations = (
  enterpriseId: number,
  page: number,
  enabled = true,
) =>
  useBusinessQuery(
    "tax",
    "declarations",
    { enterpriseId, page },
    (signal) =>
      taxApi.declarationPage(
        { query: { enterpriseId, page, pageSize: 20 } },
        { signal },
      ),
    enterpriseId,
    enabled && enterpriseId > 0,
  );

export const useMaterialPacks = (page: number, enabled = true) =>
  useBusinessQuery(
    "tax",
    "material-packs",
    { page },
    (signal) =>
      taxApi.materialPage({ query: { page, pageSize: 20 } }, { signal }),
    "all",
    enabled,
  );
export const useTaxSets = (page: number, enabled = true) =>
  useBusinessQuery(
    "tax",
    "account-sets",
    { page },
    (signal) => taxApi.setPage({ query: { page, pageSize: 20 } }, { signal }),
    "all",
    enabled,
  );
export const useTaxSet = (id: number | null) =>
  useBusinessQuery(
    "tax",
    "account-set",
    { id },
    (signal) => taxApi.setDetail({ params: { id: String(id) } }, { signal }),
    "all",
    id !== null,
  );

export const useTaxTrial = (
  taxType: string,
  form: Record<string, number>,
  enabled: boolean,
) =>
  useBusinessQuery(
    "tax",
    "trial",
    { taxType, form },
    (signal) => taxApi.trial({ body: { tax_type: taxType, form } }, { signal }),
    "all",
    enabled,
  );
export function useSaveTaxRecord() {
  const mutation = useOperationMutation(taxApi.saveTrial, ["tax"]);
  return {
    ...mutation,
    save: (
      kind: string,
      title: string,
      summary: string,
      snapshot: Record<string, unknown>,
    ) =>
      mutation.mutateAsync({
        body: { kind, title, snapshot: { ...snapshot, summary } },
      }),
  };
}

type ExternalAction = {
  action:
    "create" | "retry" | "cancel" | "submit" | "receipt" | "pay" | "reject";
  id: number;
  body: Record<string, string>;
};
export function useExternalAction() {
  return useOperationMutation(
    async ({ action, id, body }: ExternalAction) => {
      if (action === "create")
        return externalApi.create({ params: { declId: String(id) } });
      if (action === "retry" || action === "cancel")
        return externalApi[action]({ params: { id: String(id) } });
      return externalApi[action]({ params: { id: String(id) }, body });
    },
    ["external", "tax"],
  );
}
