import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const servicesApi = {
  page: endpoint(endpoints.Services_page),
  detail: endpoint(endpoints.Services_detail),
  list: endpoint(endpoints.Services_list),
  create: endpoint(endpoints.Services_create),
  update: endpoint(endpoints.Services_update),
  publish: endpoint(endpoints.Services_publish),
  remove: endpoint(endpoints.Services_remove),
};
