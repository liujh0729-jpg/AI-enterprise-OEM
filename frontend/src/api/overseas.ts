import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const overseasApi = {
  claimPage: endpoint(endpoints.Overseas_claimPage),
  claimStats: endpoint(endpoints.Overseas_claimStats),
  claimDetail: endpoint(endpoints.Overseas_claimDetail),

  catalog: endpoint(endpoints.Overseas_catalog),
  list: endpoint(endpoints.Overseas_list),
  create: endpoint(endpoints.Overseas_create),
  advance: endpoint(endpoints.Overseas_advance),
  updateContacts: endpoint(endpoints.Overseas_updateContacts),
};
