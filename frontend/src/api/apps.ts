import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const appsApi = {
  list: endpoint(endpoints.Apps_list),
  detail: endpoint(endpoints.Apps_detail),
  reviews: endpoint(endpoints.Apps_reviews),
};
