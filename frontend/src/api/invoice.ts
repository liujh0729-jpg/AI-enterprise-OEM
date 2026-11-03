import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const invoiceApi = {
  page: endpoint(endpoints.Invoice_page),
  stats: endpoint(endpoints.Invoice_stats),
  create: endpoint(endpoints.Invoice_create),
  list: endpoint(endpoints.Invoice_list),
  detail: endpoint(endpoints.Invoice_detail),
  approve: endpoint(endpoints.Invoice_approve),
  reject: endpoint(endpoints.Invoice_reject),
  updateContacts: endpoint(endpoints.Invoice_updateContacts),
  cancel: endpoint(endpoints.Invoice_cancel),
};
