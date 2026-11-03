import { ApiError, endpoints, z } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const qxyApi = {
  invoiceList: loadInvoiceList,
  status: endpoint(endpoints.Qxy_status),
  probe: endpoint(endpoints.Qxy_probe),
  options: endpoint(endpoints.Qxy_options),
  autoFile: endpoint(endpoints.Qxy_autoFile),
  filingResult: endpoint(endpoints.Qxy_filingResult),
  autoInvoice: endpoint(endpoints.Qxy_autoInvoice),
  invoices: endpoint(endpoints.Qxy_invoices),
};

const invoiceRows = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ invoices: z.array(z.record(z.string(), z.unknown())) }),
]);
async function loadInvoiceList(
  id: number,
  range: { start: string; end: string },
  signal: AbortSignal,
) {
  const data = await qxyApi.invoices(
    {
      params: { id: String(id) },
      query: {
        startDate: range.start || undefined,
        endDate: range.end || undefined,
      },
    },
    { signal },
  );
  const parsed = invoiceRows.safeParse(data?.list ?? []);
  if (!parsed.success) throw new ApiError("发票列表响应格式不正确", "protocol");
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.invoices;
}
