import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const thinkTankApi = {
  page: endpoint(endpoints.ThinkTank_page),
  stats: endpoint(endpoints.ThinkTank_stats),
  detail: endpoint(endpoints.ThinkTank_detail),
  experts: endpoint(endpoints.ThinkTank_experts),
  createExpert: endpoint(endpoints.ThinkTank_createExpert),
  updateExpert: endpoint(endpoints.ThinkTank_updateExpert),
  removeExpert: endpoint(endpoints.ThinkTank_removeExpert),
  create: endpoint(endpoints.ThinkTank_create),
  messages: endpoint(endpoints.ThinkTank_messages),
  postMessage: endpoint(endpoints.ThinkTank_postMessage),
  publish: endpoint(endpoints.ThinkTank_publish),
  updateContacts: endpoint(endpoints.ThinkTank_updateContacts),
  updateRequest: endpoint(endpoints.ThinkTank_update),
  removeRequest: endpoint(endpoints.ThinkTank_remove),
};
