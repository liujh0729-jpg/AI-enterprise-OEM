import { endpoints, z } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

export const notificationsApi = {
  list: endpoint(endpoints.Notifications_list),
  unread: endpoint(endpoints.Notifications_unread),
  get: endpoint(endpoints.Notifications_get),
  read: endpoint(endpoints.Notifications_read),
  readSns: endpoint(endpoints.Notifications_readSns),
  readAll: endpoint(endpoints.Notifications_readAll),
};

/** AIworkin 社交（SNS）私信：发信走 SNS 自己的站内信接口。 */
export const snsApi = {
  sendMessage: endpoint(endpoints.Sns_sendMessage),
};

export const orgStaffApi = {
  workspace: endpoint(endpoints.OrgStaff_workspace),
  search: endpoint(endpoints.OrgStaff_search),
  invite: endpoint(endpoints.OrgStaff_invite),
  update: endpoint(endpoints.OrgStaff_update),
  remove: endpoint(endpoints.OrgStaff_remove),
  decide: endpoint(endpoints.OrgStaff_decide),
  functions: endpoint(endpoints.OrgStaff_functions),
  saveDepartment: endpoint(endpoints.OrgStaff_saveDepartment),
  removeDepartment: endpoint(endpoints.OrgStaff_removeDepartment),
  savePosition: endpoint(endpoints.OrgStaff_savePosition),
  removePosition: endpoint(endpoints.OrgStaff_removePosition),
  assignFunctions: endpoint(endpoints.OrgStaff_assignFunctions),
};

export const serviceDeskApi = {
  overview: endpoint(endpoints.ServiceDesk_overview),
  settings: endpoint(endpoints.ServiceDesk_settings),
  saveSettings: endpoint(endpoints.ServiceDesk_saveSettings),
  sites: endpoint(endpoints.ServiceDesk_sites),
  saveSite: endpoint(endpoints.ServiceDesk_saveSite),
  removeSite: endpoint(endpoints.ServiceDesk_removeSite),
  rotateSiteKey: endpoint(endpoints.ServiceDesk_rotateSiteKey),
  uploadIcon: endpoint(endpoints.ServiceDesk_uploadIcon),
  channels: endpoint(endpoints.ServiceDesk_channels),
  saveChannel: endpoint(endpoints.ServiceDesk_saveChannel),
  removeChannel: endpoint(endpoints.ServiceDesk_removeChannel),
  testChannel: endpoint(endpoints.ServiceDesk_testChannel),
  groups: endpoint(endpoints.ServiceDesk_groups),
  saveGroup: endpoint(endpoints.ServiceDesk_saveGroup),
  removeGroup: endpoint(endpoints.ServiceDesk_removeGroup),
  agents: endpoint(endpoints.ServiceDesk_agents),
  saveAgent: endpoint(endpoints.ServiceDesk_saveAgent),
  removeAgent: endpoint(endpoints.ServiceDesk_removeAgent),
  setStatus: endpoint(endpoints.ServiceDesk_setStatus),
  conversations: endpoint(endpoints.ServiceDesk_conversations),
  conversation: endpoint(endpoints.ServiceDesk_conversation),
  send: endpoint(endpoints.ServiceDesk_send),
  claim: endpoint(endpoints.ServiceDesk_claim),
  transfer: endpoint(endpoints.ServiceDesk_transfer),
  close: endpoint(endpoints.ServiceDesk_close),
  convertToCrm: endpoint(endpoints.ServiceDesk_convertToCrm),
  createTask: endpoint(endpoints.ServiceDesk_createTask),
  draftSolution: endpoint(endpoints.ServiceDesk_draftSolution),
  aiSuggest: endpoint(endpoints.ServiceDesk_aiSuggest),
  canned: endpoint(endpoints.ServiceDesk_canned),
  saveCanned: endpoint(endpoints.ServiceDesk_saveCanned),
  removeCanned: endpoint(endpoints.ServiceDesk_removeCanned),
  faqs: endpoint(endpoints.ServiceDesk_faqs),
  saveFaq: endpoint(endpoints.ServiceDesk_saveFaq),
  removeFaq: endpoint(endpoints.ServiceDesk_removeFaq),
  stats: endpoint(endpoints.ServiceDesk_stats),
};

export const livecodeApi = {
  domains: endpoint(endpoints.MarketingQr_domains),
  domainCreate: endpoint(endpoints.MarketingQr_domainCreate),
  domainCheck: endpoint(endpoints.MarketingQr_domainCheck),
  domainUpdate: endpoint(endpoints.MarketingQr_domainUpdate),
  domainRemove: endpoint(endpoints.MarketingQr_domainRemove),
  list: endpoint(endpoints.MarketingQr_list),
  create: endpoint(endpoints.MarketingQr_create),
  get: endpoint(endpoints.MarketingQr_get),
  update: endpoint(endpoints.MarketingQr_update),
  remove: endpoint(endpoints.MarketingQr_remove),
  entry: endpoint(endpoints.MarketingQr_entry),
  switchDomain: endpoint(endpoints.MarketingQr_switchDomain),
  childCreate: endpoint(endpoints.MarketingQr_childCreate),
  childUpdate: endpoint(endpoints.MarketingQr_childUpdate),
  childRemove: endpoint(endpoints.MarketingQr_childRemove),
  stats: endpoint(endpoints.MarketingQr_stats),
  scans: endpoint(endpoints.MarketingQr_scans),
  adminList: endpoint(endpoints.AdminMarketingQr_list),
  adminDisable: endpoint(endpoints.AdminMarketingQr_disable),
};

const publicEnvelope = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().nullable(),
});

/** 访客客服窗口的公开接口：不需要登录，只认 siteKey + 访客令牌。 */
export const publicDeskApi = {
  session: (body: Record<string, unknown>) =>
    http("/api/public/service-desk/open/session", publicEnvelope, {
      method: "POST",
      body,
    }).then((result) => result.data.data),
  messages: (conversationId: number, token: string, afterId = 0) =>
    http(
      `/api/public/service-desk/open/messages/${conversationId}?token=${encodeURIComponent(
        token,
      )}&afterId=${afterId}`,
      publicEnvelope,
    ).then((result) => result.data.data),
  send: (conversationId: number, body: Record<string, unknown>) =>
    http(`/api/public/service-desk/open/messages/${conversationId}`, publicEnvelope, {
      method: "POST",
      body,
    }).then((result) => result.data.data),
  rate: (conversationId: number, body: Record<string, unknown>) =>
    http(`/api/public/service-desk/open/rate/${conversationId}`, publicEnvelope, {
      method: "POST",
      body,
    }).then((result) => result.data.data),
};
