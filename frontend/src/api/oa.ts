import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const oaApi = {
  // ---------- 工作区 ----------
  workspace: endpoint(endpoints.Oa_workspace),
  overview: endpoint(endpoints.Oa_overview),

  // ---------- 模板 ----------
  templates: endpoint(endpoints.Oa_templates),
  templateDetail: endpoint(endpoints.Oa_templateDetail),
  saveTemplate: endpoint(endpoints.Oa_saveTemplate),
  deleteTemplate: endpoint(endpoints.Oa_deleteTemplate),
  toggleTemplate: endpoint(endpoints.Oa_toggleTemplate),
  copyTemplate: endpoint(endpoints.Oa_copyTemplate),

  // ---------- 单据 ----------
  applications: endpoint(endpoints.Oa_applications),
  applicationDetail: endpoint(endpoints.Oa_applicationDetail),
  saveDraft: endpoint(endpoints.Oa_saveDraft),
  submit: endpoint(endpoints.Oa_submit),
  withdraw: endpoint(endpoints.Oa_withdraw),
  deleteDraft: endpoint(endpoints.Oa_deleteDraft),
  preReview: endpoint(endpoints.Oa_preReview),
  exportCsv: endpoint(endpoints.Oa_export),

  // ---------- 审批 ----------
  tasks: endpoint(endpoints.Oa_tasks),
  done: endpoint(endpoints.Oa_done),
  approve: endpoint(endpoints.Oa_approve),
  reject: endpoint(endpoints.Oa_reject),
  return: endpoint(endpoints.Oa_return),
  transfer: endpoint(endpoints.Oa_transfer),
  addSign: endpoint(endpoints.Oa_addSign),

  // ---------- 抄送 / 评论 ----------
  cc: endpoint(endpoints.Oa_cc),
  readCc: endpoint(endpoints.Oa_readCc),
  records: endpoint(endpoints.Oa_records),
  comment: endpoint(endpoints.Oa_comment),

  // ---------- 联动 ----------
  linkTargets: endpoint(endpoints.Oa_linkTargets),
  linkSearch: endpoint(endpoints.Oa_linkSearch),
  retryLink: endpoint(endpoints.Oa_retryLink),

  // ---------- 聚合 ----------
  approvalInbox: endpoint(endpoints.Oa_approvalInbox),

  // ---------- 设置 ----------
  settings: endpoint(endpoints.Oa_settings),
  saveSettings: endpoint(endpoints.Oa_saveSettings),
};
