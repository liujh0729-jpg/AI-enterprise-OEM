import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const smartServiceApi = {
  page: endpoint(endpoints.SmartService_page),
  stats: endpoint(endpoints.SmartService_stats),
  detail: endpoint(endpoints.SmartService_detail),
  list: endpoint(endpoints.SmartService_list),
  create: endpoint(endpoints.SmartService_create),
  accept: endpoint(endpoints.SmartService_accept),
  update: endpoint(endpoints.SmartService_update),
  remove: endpoint(endpoints.SmartService_remove),
  messages: endpoint(endpoints.SmartService_messages),
  postMessage: endpoint(endpoints.SmartService_postMessage),
  updateContacts: endpoint(endpoints.SmartService_updateContacts),
  advance: endpoint(endpoints.SmartService_advance),
};
