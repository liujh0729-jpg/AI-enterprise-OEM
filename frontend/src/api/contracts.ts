import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const contractsApi = {
  options: endpoint(endpoints.Contracts_options),
  stats: endpoint(endpoints.Contracts_stats),
  list: endpoint(endpoints.Contracts_list),
  candidates: endpoint(endpoints.Contracts_candidates),
  providers: endpoint(endpoints.Contracts_providers),
  enterprises: endpoint(endpoints.Contracts_enterprises),
  create: endpoint(endpoints.Contracts_create),
  updateTerms: endpoint(endpoints.Contracts_updateTerms),
  remove: endpoint(endpoints.Contracts_remove),
  updateContacts: endpoint(endpoints.Contracts_updateContacts),
  confirm: endpoint(endpoints.Contracts_confirm),
  terminate: endpoint(endpoints.Contracts_terminate),
  staff: endpoint(endpoints.Contracts_staff),
  agent: endpoint(endpoints.Contracts_agent),
};
