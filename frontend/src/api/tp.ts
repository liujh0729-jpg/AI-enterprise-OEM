import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 腾讯企点营销云（营销工具）。
 * 凭据按登录账号配置、一个产品一套；读接口只做一次外呼，写接口按是否花钱走「同步返回」或「任务台账」。
 * 路径前缀 /api/backend 由 endpoint() 统一加，SSE 之外的全部动作都在契约里。
 */
export const tpApi = {
  // ---------- 企点连接设置（凭据） ----------
  accounts: endpoint(endpoints.Tp_accounts),
  saveAccount: endpoint(endpoints.Tp_saveAccount),
  deleteAccount: endpoint(endpoints.Tp_deleteAccount),
  testAccount: endpoint(endpoints.Tp_testAccount, { timeoutMs: 60000 }),

  // ---------- 客户数据平台 CDP ----------
  cdpProperties: endpoint(endpoints.Tp_cdpProperties),
  cdpCustomerDetail: endpoint(endpoints.Tp_cdpCustomerDetail, {
    timeoutMs: 60000,
  }),
  cdpCustomerTrace: endpoint(endpoints.Tp_cdpCustomerTrace, {
    timeoutMs: 60000,
  }),
  cdpCustomerTags: endpoint(endpoints.Tp_cdpCustomerTags, { timeoutMs: 60000 }),
  cdpImportCustomers: endpoint(endpoints.Tp_cdpImportCustomers, {
    timeoutMs: 120000,
  }),
  cdpCreateTag: endpoint(endpoints.Tp_cdpCreateTag, { timeoutMs: 60000 }),
  cdpApplyTags: endpoint(endpoints.Tp_cdpApplyTags, { timeoutMs: 120000 }),
  cdpSegments: endpoint(endpoints.Tp_cdpSegments),
  cdpSegmentDetail: endpoint(endpoints.Tp_cdpSegmentDetail, {
    timeoutMs: 60000,
  }),
  cdpExportSegment: endpoint(endpoints.Tp_cdpExportSegment, {
    timeoutMs: 120000,
  }),
  cdpCreateSegment: endpoint(endpoints.Tp_cdpCreateSegment, {
    timeoutMs: 120000,
  }),
  cdpTaskRecord: endpoint(endpoints.Tp_cdpTaskRecord, { timeoutMs: 60000 }),

  // ---------- 写入本系统 CRM（不出网，整表读取 + 分批校验建档） ----------
  crmImport: endpoint(endpoints.Tp_crmImport, { timeoutMs: 300000 }),

  // ---------- 融合分析 FA（看板取数，只读） ----------
  faBoards: endpoint(endpoints.Tp_faBoards),
  faCards: endpoint(endpoints.Tp_faCards, { timeoutMs: 60000 }),
  faCardResult: endpoint(endpoints.Tp_faCardResult, { timeoutMs: 60000 }),
  faAsyncResult: endpoint(endpoints.Tp_faAsyncResult, { timeoutMs: 60000 }),

  // ---------- 企微互动 SCRM ----------
  scrmCodes: endpoint(endpoints.Tp_scrmCodes),
  scrmSaveCode: endpoint(endpoints.Tp_scrmSaveCode, { timeoutMs: 60000 }),
  scrmDeleteCode: endpoint(endpoints.Tp_scrmDeleteCode, { timeoutMs: 60000 }),
  scrmWelcome: endpoint(endpoints.Tp_scrmWelcome, { timeoutMs: 60000 }),
  scrmOrgs: endpoint(endpoints.Tp_scrmOrgs, { timeoutMs: 60000 }),
  scrmMassTasks: endpoint(endpoints.Tp_scrmMassTasks),
  scrmMassTaskStats: endpoint(endpoints.Tp_scrmMassTaskStats, {
    timeoutMs: 60000,
  }),
  scrmMassTaskExecution: endpoint(endpoints.Tp_scrmMassTaskExecution, {
    timeoutMs: 60000,
  }),
  scrmSaveMassTask: endpoint(endpoints.Tp_scrmSaveMassTask, {
    timeoutMs: 60000,
  }),
  scrmControlMassTask: endpoint(endpoints.Tp_scrmControlMassTask, {
    timeoutMs: 60000,
  }),
  scrmFollowups: endpoint(endpoints.Tp_scrmFollowups),
  scrmFollowupCustomers: endpoint(endpoints.Tp_scrmFollowupCustomers, {
    timeoutMs: 60000,
  }),
  scrmFollowupDone: endpoint(endpoints.Tp_scrmFollowupDone, {
    timeoutMs: 60000,
  }),

  // ---------- 会话分析 CA ----------
  caMessages: endpoint(endpoints.Tp_caMessages, { timeoutMs: 60000 }),
  caTagTasks: endpoint(endpoints.Tp_caTagTasks),
  caTagDetail: endpoint(endpoints.Tp_caTagDetail, { timeoutMs: 60000 }),
  caResponseStats: endpoint(endpoints.Tp_caResponseStats),

  // ---------- 会员忠诚度 LM ----------
  lmPrograms: endpoint(endpoints.Tp_lmPrograms),
  lmMembers: endpoint(endpoints.Tp_lmMembers, { timeoutMs: 60000 }),
  lmSaveMember: endpoint(endpoints.Tp_lmSaveMember, { timeoutMs: 60000 }),
  lmMemberStatus: endpoint(endpoints.Tp_lmMemberStatus, { timeoutMs: 60000 }),
  lmPoints: endpoint(endpoints.Tp_lmPoints, { timeoutMs: 60000 }),
  lmIssuePoints: endpoint(endpoints.Tp_lmIssuePoints, { timeoutMs: 120000 }),
  lmCoupons: endpoint(endpoints.Tp_lmCoupons),
  lmCouponIssue: endpoint(endpoints.Tp_lmCouponIssue, { timeoutMs: 120000 }),

  // ---------- 营销自动化 MA ----------
  maChannels: endpoint(endpoints.Tp_maChannels),
  maSenders: endpoint(endpoints.Tp_maSenders),
  maTemplates: endpoint(endpoints.Tp_maTemplates),
  maCreateTemplate: endpoint(endpoints.Tp_maCreateTemplate, {
    timeoutMs: 60000,
  }),
  maShortLinks: endpoint(endpoints.Tp_maShortLinks),
  maSaveShortLink: endpoint(endpoints.Tp_maSaveShortLink, { timeoutMs: 60000 }),
  maDeleteShortLink: endpoint(endpoints.Tp_maDeleteShortLink, {
    timeoutMs: 60000,
  }),
  maMassSend: endpoint(endpoints.Tp_maMassSend, { timeoutMs: 120000 }),

  // ---------- 广告分析 RTA ----------
  rtaUploadAudience: endpoint(endpoints.Tp_rtaUploadAudience, {
    timeoutMs: 120000,
  }),

  // ---------- 任务台账与列映射 ----------
  tasks: endpoint(endpoints.Tp_tasks),
  taskDetail: endpoint(endpoints.Tp_taskDetail, { timeoutMs: 60000 }),
  retryTask: endpoint(endpoints.Tp_retryTask, { timeoutMs: 60000 }),
  mappings: endpoint(endpoints.Tp_mappings),
  saveMapping: endpoint(endpoints.Tp_saveMapping),

  // ---------- 多维表格（名单来源，复用既有实现；列表已带回列与行数） ----------
  tables: endpoint(endpoints.DataTable_list),
};
