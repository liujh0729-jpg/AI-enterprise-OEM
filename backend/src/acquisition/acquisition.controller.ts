import type { CurrentUser } from '../auth/current-user';
import { parseId } from '../common/parse-id';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import { AcquisitionRadarService } from './radar.service';
import { AcquisitionPluginBridgeService } from './plugin-bridge.service';
import { AcquisitionOutreachService } from './outreach.service';
import { AcquisitionProfileService } from './profile.service';
import { AcquisitionPlaybookService } from './playbook.service';
import { AcquisitionFollowUpService } from './follow-up.service';
import { AcquisitionQcService } from './qc.service';
import { AcquisitionDashboardService } from './dashboard.service';
import type { Row } from './acquisition.helpers';

/**
 * AI 获客（营销工具）：监控源 / 采集批次 / 线索 / 触达 / 档案 / 剧本 / 跟进 / 质检 / 看板。
 * 返回裸数据，信封由 moduleHandlers 统一包；插件 pull/report 是免登录公开路由，只认令牌不认会话。
 */
export class AcquisitionController {
  constructor(
    private readonly settingsService: AcquisitionSettingsService,
    private readonly radar: AcquisitionRadarService,
    private readonly plugin: AcquisitionPluginBridgeService,
    private readonly outreachService: AcquisitionOutreachService,
    private readonly profileService: AcquisitionProfileService,
    private readonly playbookService: AcquisitionPlaybookService,
    private readonly followUpService: AcquisitionFollowUpService,
    private readonly qcService: AcquisitionQcService,
    private readonly dashboardService: AcquisitionDashboardService,
  ) {}

  // ---------- 监控源与采集批次 ----------

  async sources(user: CurrentUser, query: Row) {
    return this.radar.sources(user, query);
  }

  async saveSource(user: CurrentUser, body: Row) {
    return this.radar.saveSource(user, body);
  }

  async removeSource(user: CurrentUser, id: string) {
    return this.radar.removeSource(user, parseId(id, '监控源 ID'));
  }

  async runSource(user: CurrentUser, id: string) {
    return this.radar.runSource(user, parseId(id, '监控源 ID'));
  }

  async runs(user: CurrentUser, query: Row) {
    return this.radar.runs(user, query);
  }

  async runDetail(user: CurrentUser, id: string) {
    return this.radar.runDetail(user, parseId(id, '采集批次 ID'));
  }

  // ---------- 线索 ----------

  async leads(user: CurrentUser, query: Row) {
    return this.radar.leads(user, query);
  }

  async leadDetail(user: CurrentUser, id: string) {
    return this.radar.leadDetail(user, parseId(id, '线索 ID'));
  }

  async updateLead(user: CurrentUser, id: string, body: Row) {
    return this.radar.updateLead(user, parseId(id, '线索 ID'), body);
  }

  async scoreLead(user: CurrentUser, id: string, body: Row, token = '') {
    return this.radar.scoreLead(user, parseId(id, '线索 ID'), body, token);
  }

  async promoteLead(user: CurrentUser, id: string, body: Row) {
    return this.profileService.promote(user, parseId(id, '线索 ID'), body);
  }

  async leadsToTable(user: CurrentUser, body: Row) {
    return this.radar.leadsToTable(user, body);
  }

  async exportLeads(user: CurrentUser, body: Row) {
    return this.radar.exportLeads(user, body);
  }

  // ---------- 触达 ----------

  async outreach(user: CurrentUser, query: Row) {
    return this.outreachService.list(user, query);
  }

  async createOutreach(user: CurrentUser, body: Row) {
    return this.outreachService.create(user, body);
  }

  async approveOutreach(user: CurrentUser, id: string, body: Row) {
    return this.outreachService.approve(user, parseId(id, '触达任务 ID'), body);
  }

  async cancelOutreach(user: CurrentUser, id: string, body: Row) {
    return this.outreachService.cancel(user, parseId(id, '触达任务 ID'), body);
  }

  async outreachLogs(user: CurrentUser, id: string) {
    return this.outreachService.logs(user, parseId(id, '触达任务 ID'));
  }

  // ---------- 客户档案 ----------

  async profiles(user: CurrentUser, query: Row) {
    return this.profileService.list(user, query);
  }

  async profileDetail(user: CurrentUser, id: string) {
    return this.profileService.detail(user, parseId(id, '客户档案 ID'));
  }

  async updateProfile(user: CurrentUser, id: string, body: Row) {
    return this.profileService.update(user, parseId(id, '客户档案 ID'), body);
  }

  async profileEvents(user: CurrentUser, id: string, query: Row) {
    return this.profileService.events(user, parseId(id, '客户档案 ID'), query);
  }

  // ---------- 销售剧本 ----------

  async playbooks(user: CurrentUser, query: Row) {
    return this.playbookService.list(user, query);
  }

  async savePlaybook(user: CurrentUser, body: Row) {
    return this.playbookService.save(user, body);
  }

  async publishPlaybook(user: CurrentUser, id: string) {
    return this.playbookService.publish(user, parseId(id, '销售剧本 ID'));
  }

  async playbookVersions(user: CurrentUser, id: string, query: Row) {
    return this.playbookService.versions(
      user,
      parseId(id, '销售剧本 ID'),
      query,
    );
  }

  async playbookPreview(user: CurrentUser, id: string, body: Row) {
    return this.playbookService.preview(user, parseId(id, '销售剧本 ID'), body);
  }

  // ---------- 跟进计划 ----------

  async followUps(user: CurrentUser, query: Row) {
    return this.followUpService.list(user, query);
  }

  async createFollowUp(user: CurrentUser, body: Row) {
    return this.followUpService.create(user, body);
  }

  async cancelFollowUp(user: CurrentUser, id: string, body: Row) {
    return this.followUpService.cancel(user, parseId(id, '跟进计划 ID'), body);
  }

  async completeFollowUp(user: CurrentUser, id: string, body: Row) {
    return this.followUpService.complete(
      user,
      parseId(id, '跟进计划 ID'),
      body,
    );
  }

  // ---------- 浏览器插件 ----------

  async pluginToken(user: CurrentUser, body: Row) {
    return this.plugin.issueToken(user, body);
  }

  async pluginPull(body: Row) {
    return this.plugin.pull(body);
  }

  async pluginReport(body: Row) {
    return this.plugin.report(body);
  }

  /** 统一回执落库（登录态）：把插件终态回执挂到浏览器任务队列，业务结果仍以 report 为准。 */
  async pluginReceipt(user: CurrentUser, body: Row) {
    return this.plugin.recordReceipt(user, body);
  }

  // ---------- 设置与元信息 ----------

  async settings(user: CurrentUser) {
    return this.settingsService.read(user);
  }

  async saveSettings(user: CurrentUser, body: Row) {
    return this.settingsService.save(user, body);
  }

  async meta(user: CurrentUser) {
    return this.settingsService.meta(user);
  }

  // ---------- 接待质检 ----------

  async qcReviews(user: CurrentUser, query: Row) {
    return this.qcService.list(user, query);
  }

  async runQc(user: CurrentUser, body: Row, token = '') {
    return this.qcService.run(user, body, token);
  }

  async qcDetail(user: CurrentUser, id: string) {
    return this.qcService.detail(user, parseId(id, '质检记录 ID'));
  }

  // ---------- 获客看板 ----------

  async dashboard(user: CurrentUser, query: Row) {
    return this.dashboardService.dashboard(user, query);
  }

  async dashboardExport(user: CurrentUser, body: Row) {
    return this.dashboardService.exportJob(user, body);
  }

  async dashboardShare(user: CurrentUser, body: Row) {
    return this.dashboardService.share(user, body);
  }
}
