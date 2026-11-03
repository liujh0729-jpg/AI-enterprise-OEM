import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const aiworkinApi = {
  status: endpoint(endpoints.Aiworkin_status),
  categories: endpoint(endpoints.Aiworkin_categories),
  myDemands: endpoint(endpoints.Aiworkin_myDemands),
  marketListings: endpoint(endpoints.Aiworkin_marketListings),
  demandDetail: endpoint(endpoints.Aiworkin_demandDetail),
  publishDemand: endpoint(endpoints.Aiworkin_publishDemand),
  removeDemand: endpoint(endpoints.Aiworkin_removeDemand),
  demandConversations: endpoint(endpoints.Aiworkin_demandConversations),
  conversations: endpoint(endpoints.Aiworkin_conversations),
  conversation: endpoint(endpoints.Aiworkin_conversation),
  reply: endpoint(endpoints.Aiworkin_reply),
  profile: endpoint(endpoints.Aiworkin_profile),
  saveProfile: endpoint(endpoints.Aiworkin_saveProfile),
  // 代 AIworkin 平台签发 sk- Key 的 listApiKeys / createApiKey 已随该板块下线（设计 3.5）：
  // 上游 Key 只在 AIPDD 平台签发后由用户自行绑定（见 /developer/keys 的 AIPDD API Key 绑定）。
};
