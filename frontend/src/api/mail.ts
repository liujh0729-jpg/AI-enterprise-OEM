import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** AI邮箱服务：多邮箱收信、草稿与自动回复、场景话术、处理台账。 */
export const mailApi = {
  accounts: endpoint(endpoints.Mail_accounts),
  saveAccount: endpoint(endpoints.Mail_saveAccount),
  updateAccount: endpoint(endpoints.Mail_updateAccount),
  removeAccount: endpoint(endpoints.Mail_removeAccount),
  testAccount: endpoint(endpoints.Mail_testAccount),
  messages: endpoint(endpoints.Mail_messages),
  message: endpoint(endpoints.Mail_message),
  drafts: endpoint(endpoints.Mail_drafts),
  saveDraft: endpoint(endpoints.Mail_saveDraft),
  sendReply: endpoint(endpoints.Mail_sendReply),
  scripts: endpoint(endpoints.Mail_scripts),
  saveScript: endpoint(endpoints.Mail_saveScript),
  updateScript: endpoint(endpoints.Mail_updateScript),
  removeScript: endpoint(endpoints.Mail_removeScript),
  ledger: endpoint(endpoints.Mail_ledger),
};