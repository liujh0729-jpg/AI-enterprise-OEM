import type { CurrentUser } from '../auth/current-user';
import { ScrmSettingsService } from './scrm-settings.service';
import { ScrmSyncService } from './scrm-sync.service';
import { ScrmContactService } from './scrm-contact.service';
import { ScrmChatService } from './scrm-chat.service';
import { ScrmCodeService } from './scrm-code.service';
import { ScrmMassService } from './scrm-mass.service';
import { ScrmTransferService } from './scrm-transfer.service';
import { ScrmSopService } from './scrm-sop.service';
import { ScrmComplianceService } from './scrm-compliance';
import { ScrmStatsService } from './scrm-stats.service';
import { ScrmMaterialService } from './scrm-material.service';
import { ScrmSidebarService } from './scrm-sidebar.service';

/**
 * 企业微信 SCRM（营销工具）：接入 / 客户 / 资料卡 / 标签 / 活码 / 客户群 /
 * 群发 / 分配继承 / SOP / 合规质检 / 统计 / 素材 / 员工侧边栏。
 * 返回裸数据，信封由 moduleHandlers 统一包；方法名按 Scrm_ 后缀自动映射。
 */
export class ScrmController {
  constructor(
    private readonly settingsService: ScrmSettingsService,
    private readonly syncService: ScrmSyncService,
    private readonly contactService: ScrmContactService,
    private readonly chatService: ScrmChatService,
    private readonly codeService: ScrmCodeService,
    private readonly mass: ScrmMassService,
    private readonly transferService: ScrmTransferService,
    private readonly sopService: ScrmSopService,
    private readonly compliance: ScrmComplianceService,
    private readonly stats: ScrmStatsService,
    private readonly materialService: ScrmMaterialService,
    private readonly sidebarService: ScrmSidebarService,
  ) {}

  // ---------- 接入与概览 ----------

  async settings(user: CurrentUser) {
    return this.settingsService.settings(user);
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveSettings(user, body);
  }

  async testConnection(user: CurrentUser) {
    return this.settingsService.testConnection(user);
  }

  async sync(user: CurrentUser, body: Record<string, unknown>) {
    return this.syncService.sync(user, body);
  }

  async overview(user: CurrentUser) {
    return this.stats.overview(user);
  }

  // ---------- 客户 ----------

  async contacts(user: CurrentUser, query: Record<string, unknown>) {
    return this.contactService.list(user, query);
  }

  async contact(user: CurrentUser, query: Record<string, unknown>) {
    return this.contactService.contact(user, query);
  }

  async updateContact(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.updateContact(user, body);
  }

  async promoteContact(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.promoteContact(user, body);
  }

  async assignContact(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.assignContact(user, body);
  }

  async batchTag(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.batchTag(user, body);
  }

  async batchTagByFilter(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.batchTagByFilter(user, body);
  }

  // ---------- 资料卡 ----------

  async fields(user: CurrentUser) {
    return this.contactService.fields(user);
  }

  async saveField(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.saveField(user, body);
  }

  async removeField(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.removeField(user, body);
  }

  async saveContactFields(user: CurrentUser, body: Record<string, unknown>) {
    return this.contactService.saveContactFields(user, body);
  }

  // ---------- 标签 ----------

  async tagGroups(user: CurrentUser) {
    return this.contactService.tagGroups(user);
  }

  async syncTags(user: CurrentUser) {
    return this.syncService.syncTags(user);
  }

  async autoTagRules(user: CurrentUser) {
    return this.codeService.autoTagRules(user);
  }

  async saveAutoTagRule(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.saveAutoTagRule(user, body);
  }

  async removeAutoTagRule(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.removeAutoTagRule(user, body);
  }

  // ---------- 活码与欢迎语 ----------

  async codes(user: CurrentUser, query: Record<string, unknown>) {
    return this.codeService.codes(user, query);
  }

  async saveCode(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.saveCode(user, body);
  }

  async removeCode(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.removeCode(user, body);
  }

  async codeStats(user: CurrentUser, query: Record<string, unknown>) {
    return this.codeService.codeStats(user, query);
  }

  async welcomes(user: CurrentUser) {
    return this.codeService.welcomes(user);
  }

  async saveWelcome(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.saveWelcome(user, body);
  }

  async removeWelcome(user: CurrentUser, body: Record<string, unknown>) {
    return this.codeService.removeWelcome(user, body);
  }

  // ---------- 客户群 ----------

  async chats(user: CurrentUser, query: Record<string, unknown>) {
    return this.chatService.chats(user, query);
  }

  async chat(user: CurrentUser, query: Record<string, unknown>) {
    return this.chatService.chat(user, query);
  }

  async chatGroups(user: CurrentUser) {
    return this.chatService.chatGroups(user);
  }

  async saveChatGroup(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.saveChatGroup(user, body);
  }

  async moveChats(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.moveChats(user, body);
  }

  async roomPulls(user: CurrentUser) {
    return this.chatService.roomPulls(user);
  }

  async saveRoomPull(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.saveRoomPull(user, body);
  }

  async runRoomPull(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.runRoomPull(user, body);
  }

  // ---------- 群发 ----------

  async massTasks(user: CurrentUser, query: Record<string, unknown>) {
    return this.mass.tasks(user, query);
  }

  async saveMassTask(user: CurrentUser, body: Record<string, unknown>) {
    return this.mass.saveTask(user, body);
  }

  async requestMassReview(user: CurrentUser, body: Record<string, unknown>) {
    return this.mass.requestReview(user, body);
  }

  async reviewMassTask(user: CurrentUser, body: Record<string, unknown>) {
    return this.mass.reviewTask(user, body);
  }

  async submitMassTask(user: CurrentUser, body: Record<string, unknown>) {
    return this.mass.submitTask(user, body);
  }

  async massTargets(user: CurrentUser, query: Record<string, unknown>) {
    return this.mass.targets(user, query);
  }

  // ---------- 分配与继承 ----------

  async unassigned(user: CurrentUser) {
    return this.transferService.unassigned(user);
  }

  async transfers(user: CurrentUser, query: Record<string, unknown>) {
    return this.transferService.transfers(user, query);
  }

  async createTransfer(user: CurrentUser, body: Record<string, unknown>) {
    return this.transferService.createTransfer(user, body);
  }

  async refreshTransfer(user: CurrentUser, body: Record<string, unknown>) {
    return this.transferService.refreshTransfer(user, body);
  }

  // ---------- SOP ----------

  async sops(user: CurrentUser) {
    return this.sopService.sops(user);
  }

  async saveSop(user: CurrentUser, body: Record<string, unknown>) {
    return this.sopService.saveSop(user, body);
  }

  async removeSop(user: CurrentUser, body: Record<string, unknown>) {
    return this.sopService.removeSop(user, body);
  }

  async runSop(user: CurrentUser, body: Record<string, unknown>) {
    return this.sopService.runSop(user, body);
  }

  async sopTasks(user: CurrentUser, query: Record<string, unknown>) {
    return this.sopService.sopTasks(user, query);
  }

  async completeSopTask(user: CurrentUser, body: Record<string, unknown>) {
    return this.sopService.completeSopTask(user, body);
  }

  // ---------- 合规与质检 ----------

  async sensitiveWords(user: CurrentUser) {
    return this.compliance.words(user);
  }

  async saveSensitiveWord(user: CurrentUser, body: Record<string, unknown>) {
    return this.compliance.saveWord(user, body);
  }

  async removeSensitiveWord(user: CurrentUser, body: Record<string, unknown>) {
    return this.compliance.removeWord(user, body);
  }

  async sensitiveHits(user: CurrentUser, query: Record<string, unknown>) {
    return this.compliance.hits(user, query);
  }

  async checkText(user: CurrentUser, body: Record<string, unknown>) {
    return this.compliance.checkText(user, body);
  }

  async qc(user: CurrentUser, body: Record<string, unknown>) {
    return this.compliance.qc(user, body);
  }

  // ---------- 统计 ----------

  async statsTrend(user: CurrentUser, query: Record<string, unknown>) {
    return this.stats.trend(user, query);
  }

  async statsStaff(user: CurrentUser, query: Record<string, unknown>) {
    return this.stats.staff(user, query);
  }

  async exportStats(user: CurrentUser, body: Record<string, unknown>) {
    return this.stats.export(user, body);
  }

  // ---------- 素材 ----------

  async materials(user: CurrentUser) {
    return this.materialService.list(user);
  }

  async saveMaterial(user: CurrentUser, body: Record<string, unknown>) {
    return this.materialService.save(user, body);
  }

  async removeMaterial(user: CurrentUser, body: Record<string, unknown>) {
    return this.materialService.remove(user, body);
  }

  // ---------- 员工侧边栏 ----------

  async sidebarTicket(user: CurrentUser) {
    return this.sidebarService.ticket(user);
  }

  async sidebar(user: CurrentUser, query: Record<string, unknown>) {
    const contactId = Number(query.contactId || 0);
    return this.sidebarService.viewForUser(
      user,
      Number.isFinite(contactId) ? Math.trunc(contactId) : 0,
    );
  }
}
