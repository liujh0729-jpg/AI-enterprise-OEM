import { CurrentUser } from '../auth/current-user';
import { TencentQidianService } from './tp.service';

type Row = Record<string, unknown>;

/**
 * 腾讯企点控制器：与契约 Tp_* 一一对应，只做参数透传。
 * 返回值由路由层统一包成 { code, message, data }，这里不再自己包壳。
 */
export class TencentQidianController {
  constructor(private readonly service: TencentQidianService) {}

  // ---------- 凭据 ----------

  accounts(user: CurrentUser) {
    return this.service.accounts(user);
  }

  saveAccount(user: CurrentUser, body: Row) {
    return this.service.saveAccount(user, body);
  }

  deleteAccount(user: CurrentUser, id: string) {
    return this.service.deleteAccount(user, id);
  }

  testAccount(user: CurrentUser, id: string) {
    return this.service.testAccount(user, id);
  }

  // ---------- 客户数据平台 CDP ----------

  cdpProperties(user: CurrentUser, query: Row) {
    return this.service.cdpProperties(user, query);
  }

  cdpCustomerDetail(user: CurrentUser, body: Row) {
    return this.service.cdpCustomerDetail(user, body);
  }

  cdpCustomerTrace(user: CurrentUser, body: Row) {
    return this.service.cdpCustomerTrace(user, body);
  }

  cdpCustomerTags(user: CurrentUser, body: Row) {
    return this.service.cdpCustomerTags(user, body);
  }

  cdpImportCustomers(user: CurrentUser, body: Row) {
    return this.service.cdpImportCustomers(user, body);
  }

  cdpCreateTag(user: CurrentUser, body: Row) {
    return this.service.cdpCreateTag(user, body);
  }

  cdpApplyTags(user: CurrentUser, body: Row) {
    return this.service.cdpApplyTags(user, body);
  }

  cdpSegments(user: CurrentUser, query: Row) {
    return this.service.cdpSegments(user, query);
  }

  cdpSegmentDetail(user: CurrentUser, id: string, query: Row) {
    return this.service.cdpSegmentDetail(user, id, query);
  }

  cdpExportSegment(user: CurrentUser, id: string, body: Row) {
    return this.service.cdpExportSegment(user, id, body);
  }

  cdpCreateSegment(user: CurrentUser, body: Row) {
    return this.service.cdpCreateSegment(user, body);
  }

  cdpTaskRecord(user: CurrentUser, taskId: string, query: Row) {
    return this.service.cdpTaskRecord(user, taskId, query);
  }

  // ---------- 企点客户写入本系统 CRM ----------

  crmImport(user: CurrentUser, body: Row) {
    return this.service.crmImport(user, body);
  }

  // ---------- 融合分析 FA ----------

  faBoards(user: CurrentUser, query: Row) {
    return this.service.faBoards(user, query);
  }

  faCards(user: CurrentUser, id: string, query: Row) {
    return this.service.faCards(user, id, query);
  }

  faCardResult(user: CurrentUser, body: Row) {
    return this.service.faCardResult(user, body);
  }

  faAsyncResult(user: CurrentUser, body: Row) {
    return this.service.faAsyncResult(user, body);
  }

  // ---------- 企微互动 SCRM ----------

  scrmCodes(user: CurrentUser, query: Row) {
    return this.service.scrmCodes(user, query);
  }

  scrmSaveCode(user: CurrentUser, body: Row) {
    return this.service.scrmSaveCode(user, body);
  }

  scrmDeleteCode(user: CurrentUser, body: Row) {
    return this.service.scrmDeleteCode(user, body);
  }

  scrmWelcome(user: CurrentUser, body: Row) {
    return this.service.scrmWelcome(user, body);
  }

  scrmOrgs(user: CurrentUser, body: Row) {
    return this.service.scrmOrgs(user, body);
  }

  scrmMassTasks(user: CurrentUser, query: Row) {
    return this.service.scrmMassTasks(user, query);
  }

  scrmMassTaskStats(user: CurrentUser, body: Row) {
    return this.service.scrmMassTaskStats(user, body);
  }

  scrmMassTaskExecution(user: CurrentUser, body: Row) {
    return this.service.scrmMassTaskExecution(user, body);
  }

  scrmSaveMassTask(user: CurrentUser, body: Row) {
    return this.service.scrmSaveMassTask(user, body);
  }

  scrmControlMassTask(user: CurrentUser, body: Row) {
    return this.service.scrmControlMassTask(user, body);
  }

  scrmFollowups(user: CurrentUser, query: Row) {
    return this.service.scrmFollowups(user, query);
  }

  scrmFollowupCustomers(user: CurrentUser, body: Row) {
    return this.service.scrmFollowupCustomers(user, body);
  }

  scrmFollowupDone(user: CurrentUser, body: Row) {
    return this.service.scrmFollowupDone(user, body);
  }

  // ---------- 会话分析 CA ----------

  caMessages(user: CurrentUser, body: Row) {
    return this.service.caMessages(user, body);
  }

  caTagTasks(user: CurrentUser, query: Row) {
    return this.service.caTagTasks(user, query);
  }

  caTagDetail(user: CurrentUser, id: string, query: Row) {
    return this.service.caTagDetail(user, id, query);
  }

  caResponseStats(user: CurrentUser, query: Row) {
    return this.service.caResponseStats(user, query);
  }

  // ---------- 客户忠诚度 LM ----------

  lmPrograms(user: CurrentUser, query: Row) {
    return this.service.lmPrograms(user, query);
  }

  lmMembers(user: CurrentUser, body: Row) {
    return this.service.lmMembers(user, body);
  }

  lmSaveMember(user: CurrentUser, body: Row) {
    return this.service.lmSaveMember(user, body);
  }

  lmMemberStatus(user: CurrentUser, body: Row) {
    return this.service.lmMemberStatus(user, body);
  }

  lmPoints(user: CurrentUser, body: Row) {
    return this.service.lmPoints(user, body);
  }

  lmIssuePoints(user: CurrentUser, body: Row) {
    return this.service.lmIssuePoints(user, body);
  }

  lmCoupons(user: CurrentUser, query: Row) {
    return this.service.lmCoupons(user, query);
  }

  lmCouponIssue(user: CurrentUser, body: Row) {
    return this.service.lmCouponIssue(user, body);
  }

  // ---------- 营销自动化 MA ----------

  maChannels(user: CurrentUser, query: Row) {
    return this.service.maChannels(user, query);
  }

  maSenders(user: CurrentUser, query: Row) {
    return this.service.maSenders(user, query);
  }

  maTemplates(user: CurrentUser, query: Row) {
    return this.service.maTemplates(user, query);
  }

  maCreateTemplate(user: CurrentUser, body: Row) {
    return this.service.maCreateTemplate(user, body);
  }

  maShortLinks(user: CurrentUser, query: Row) {
    return this.service.maShortLinks(user, query);
  }

  maSaveShortLink(user: CurrentUser, body: Row) {
    return this.service.maSaveShortLink(user, body);
  }

  maDeleteShortLink(user: CurrentUser, body: Row) {
    return this.service.maDeleteShortLink(user, body);
  }

  maMassSend(user: CurrentUser, body: Row) {
    return this.service.maMassSend(user, body);
  }

  // ---------- 广告分析 RTA ----------

  rtaUploadAudience(user: CurrentUser, body: Row) {
    return this.service.rtaUploadAudience(user, body);
  }

  // ---------- 任务台账与列映射 ----------

  tasks(user: CurrentUser, query: Row) {
    return this.service.tasks(user, query);
  }

  taskDetail(user: CurrentUser, id: string) {
    return this.service.taskDetail(user, id);
  }

  retryTask(user: CurrentUser, id: string) {
    return this.service.retryTask(user, id);
  }

  mappings(user: CurrentUser) {
    return this.service.mappings(user);
  }

  saveMapping(user: CurrentUser, body: Row) {
    return this.service.saveMapping(user, body);
  }
}
