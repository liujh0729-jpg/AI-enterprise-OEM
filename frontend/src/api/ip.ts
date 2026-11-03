import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const ipApi = {
  page: endpoint(endpoints.Ip_page),
  stats: endpoint(endpoints.Ip_stats),
  detail: endpoint(endpoints.Ip_detail),
  agencies: endpoint(endpoints.Ip_agencies),
  createAgency: endpoint(endpoints.Ip_createAgency),
  updateAgency: endpoint(endpoints.Ip_updateAgency),
  removeAgency: endpoint(endpoints.Ip_removeAgency),
  list: endpoint(endpoints.Ip_list),
  create: endpoint(endpoints.Ip_create),
  consult: endpoint(endpoints.Ip_consult),
  messages: endpoint(endpoints.Ip_messages),
  postMessage: endpoint(endpoints.Ip_postMessage),
  publish: endpoint(endpoints.Ip_publish),
  updateContacts: endpoint(endpoints.Ip_updateContacts),
  updateRequest: endpoint(endpoints.Ip_updateRequest),
  removeRequest: endpoint(endpoints.Ip_removeRequest),
};
