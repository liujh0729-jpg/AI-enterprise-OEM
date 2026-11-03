import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const assetApi = {
  page: endpoint(endpoints.Asset_page),
  stats: endpoint(endpoints.Asset_stats),
  detail: endpoint(endpoints.Asset_detail),
  list: endpoint(endpoints.Asset_list),
  create: endpoint(endpoints.Asset_create),
  accept: endpoint(endpoints.Asset_accept),
  update: endpoint(endpoints.Asset_update),
  remove: endpoint(endpoints.Asset_remove),
  messages: endpoint(endpoints.Asset_messages),
  postMessage: endpoint(endpoints.Asset_postMessage),
  updateContacts: endpoint(endpoints.Asset_updateContacts),
};
