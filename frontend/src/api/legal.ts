import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const legalApi = {
  page: endpoint(endpoints.Legal_page),
  stats: endpoint(endpoints.Legal_stats),
  detail: endpoint(endpoints.Legal_detail),
  lawyers: endpoint(endpoints.Legal_lawyers),
  createLawyer: endpoint(endpoints.Legal_createLawyer),
  updateLawyer: endpoint(endpoints.Legal_updateLawyer),
  removeLawyer: endpoint(endpoints.Legal_removeLawyer),
  list: endpoint(endpoints.Legal_list),
  create: endpoint(endpoints.Legal_create),
  messages: endpoint(endpoints.Legal_messages),
  postMessage: endpoint(endpoints.Legal_postMessage),
  publish: endpoint(endpoints.Legal_publish),
  updateContacts: endpoint(endpoints.Legal_updateContacts),
  updateRequest: endpoint(endpoints.Legal_updateRequest),
  removeRequest: endpoint(endpoints.Legal_removeRequest),
};
