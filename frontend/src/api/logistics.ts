import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const logisticsApi = {
  page: endpoint(endpoints.Logistics_page),
  stats: endpoint(endpoints.Logistics_stats),
  detail: endpoint(endpoints.Logistics_detail),
  list: endpoint(endpoints.Logistics_list),
  create: endpoint(endpoints.Logistics_create),
  accept: endpoint(endpoints.Logistics_accept),
  update: endpoint(endpoints.Logistics_update),
  remove: endpoint(endpoints.Logistics_remove),
  messages: endpoint(endpoints.Logistics_messages),
  postMessage: endpoint(endpoints.Logistics_postMessage),
  updateContacts: endpoint(endpoints.Logistics_updateContacts),
  advance: endpoint(endpoints.Logistics_advance),
};
