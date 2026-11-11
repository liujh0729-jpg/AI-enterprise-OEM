import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { ChromeAgentService } from './chrome-agent.service';
import type { RpaChromeScheduleService } from './chrome-schedule.service';
import { RpaChromeDeviceService } from './chrome-device.service';
import { RpaChromeLibraryService } from './chrome-library.service';

/**
 * 本地 Chrome 插件 RPA 的界面侧接口（登录态）：设备清单 / 设置 / 会话引擎 / 浏览器代理台账。
 * 设备通道（插件用、免登录、只认设备令牌）在 rpa-chrome.public.ts，不从这里出。
 */
export class RpaChromeController {
  constructor(
    private readonly devices: RpaChromeDeviceService,
    private readonly agent: ChromeAgentService,
    private readonly library: RpaChromeLibraryService,
    private readonly scheduleService: RpaChromeScheduleService,
  ) {}

  async listDevices(user: CurrentUser) {
    return ok(await this.devices.listDevices(user));
  }

  async setDevice(
    user: CurrentUser,
    clientId: string,
    body: Record<string, unknown>,
  ) {
    return ok({
      device: await this.devices.setDeviceStatus(
        user,
        clientId,
        body.enabled !== false,
      ),
    });
  }

  async removeDevice(user: CurrentUser, clientId: string) {
    return ok(await this.devices.removeDevice(user, clientId));
  }

  async sessions(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agent.listSessions(user, query));
  }

  async activeSessions(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agent.activeSessions(user, text(query.clientId)));
  }

  async session(user: CurrentUser, id: string) {
    return ok({
      session: await this.agent.sessionView(user, parseId(id, '会话 ID')),
    });
  }

  async startSession(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ session: await this.agent.startSession(user, body) });
  }

  async pauseSession(user: CurrentUser, id: string) {
    return ok({
      session: await this.agent.pauseSession(user, parseId(id, '会话 ID')),
    });
  }

  async resumeSession(user: CurrentUser, id: string) {
    return ok({
      session: await this.agent.resumeSession(user, parseId(id, '会话 ID')),
    });
  }

  async stopSession(user: CurrentUser, id: string) {
    return ok({
      session: await this.agent.stopSession(user, parseId(id, '会话 ID')),
    });
  }

  async retryStep(user: CurrentUser, id: string) {
    return ok({
      session: await this.agent.retryStep(user, parseId(id, '步骤 ID')),
    });
  }

  async settings(user: CurrentUser) {
    return ok(await this.devices.settingsOf(user.userId));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.devices.saveSettings(user, body));
  }

  // ---------- 浏览器代理台账（会话 / 消息 / 技能 / 录制 / 抽取） ----------

  async agents(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.library.listAgents(user, query));
  }

  async agentDetail(user: CurrentUser, id: string) {
    return ok({
      agent: await this.library.agentView(user, parseId(id, '会话 ID')),
    });
  }

  async saveAgent(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ agent: await this.library.saveAgent(user, body) });
  }

  async appendMessage(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok({ message: await this.library.appendMessage(user, id, body) });
  }

  async skills(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.library.listSkills(user, query));
  }

  async saveSkill(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ skill: await this.library.saveSkill(user, body) });
  }

  async removeSkill(user: CurrentUser, id: string) {
    return ok(await this.library.removeSkill(user, id));
  }

  async recordings(user: CurrentUser) {
    return ok(await this.library.listRecordings(user));
  }

  async saveRecording(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ recording: await this.library.saveRecording(user, body) });
  }

  async removeRecording(user: CurrentUser, id: string) {
    return ok(await this.library.removeRecording(user, id));
  }

  async extracts(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.library.listExtracts(user, query));
  }

  async saveExtract(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ extract: await this.library.saveExtract(user, body) });
  }

  // ---------- 计划任务（浏览器代理定时） ----------

  async schedules(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.scheduleService.list(user, query));
  }

  async saveSchedule(user: CurrentUser, body: Record<string, unknown>) {
    return ok({ schedule: await this.scheduleService.save(user, body) });
  }

  async removeSchedule(user: CurrentUser, id: string) {
    return ok(await this.scheduleService.remove(user, id));
  }

  async runSchedule(user: CurrentUser, id: string) {
    return ok({ schedule: await this.scheduleService.runNow(user, id) });
  }
}
