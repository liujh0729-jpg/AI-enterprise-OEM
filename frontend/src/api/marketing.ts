import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const marketingApi = {
  page: endpoint(endpoints.Marketing_page),
  stats: endpoint(endpoints.Marketing_stats),
  detail: endpoint(endpoints.Marketing_detail),
  list: endpoint(endpoints.Marketing_list),
  create: endpoint(endpoints.Marketing_create),
  accept: endpoint(endpoints.Marketing_accept),
  update: endpoint(endpoints.Marketing_update),
  remove: endpoint(endpoints.Marketing_remove),
  messages: endpoint(endpoints.Marketing_messages),
  postMessage: endpoint(endpoints.Marketing_postMessage),
  updateContacts: endpoint(endpoints.Marketing_updateContacts),
  confirm: endpoint(endpoints.Marketing_confirm),
};
