import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { GeoSettingsService } from './geo-settings.service';
import { GeoService } from './geo.service';
/**
 * GEO 分析（营销服务板块）：品牌项目 / 监控问题库 / 采集批次 / 观测记录 / 差距选题。
 * 指标口径见 geo 技能包（提及率 / 上榜率 / 平均排名 / 引用质量得分 / 曝光效果分数）。
 * 采集平台 Key 按账号归属：每个账号只能读写自己的 Key。
 */
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly settings: GeoSettingsService,
  ) {}
  async meta(user: CurrentUser) {
    return ok(await this.geo.meta(user));
  }
  async settingsList(user: CurrentUser) {
    return ok(await this.settings.list(user.userId));
  }
  async saveSettings(
    user: CurrentUser,
    code: string,
    body: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    },
  ) {
    return ok(await this.settings.save(user, code, body));
  }
  async clearSettings(user: CurrentUser, code: string) {
    return ok(await this.settings.clear(user, code));
  }
  async testSettings(user: CurrentUser, code: string) {
    return ok(await this.settings.test(user, code));
  }
  async projects(user: CurrentUser) {
    return ok(await this.geo.listProjects(user));
  }
  async createProject(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.geo.createProject(user, body));
  }
  async updateProject(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.updateProject(user, parseId(id), body));
  }
  async removeProject(user: CurrentUser, id: string) {
    return ok(await this.geo.removeProject(user, parseId(id)));
  }
  async report(user: CurrentUser, id: string, batchId?: string) {
    return ok(await this.geo.report(user, parseId(id), Number(batchId || 0)));
  }
  /** 自动采集开关状态：本期任务进度 + 下一个窗口（周日 02:00–06:00，未跑完顺延次日）。 */
  async autoCollect(user: CurrentUser, id: string) {
    return ok(await this.geo.autoCollectStatus(user, parseId(id)));
  }
  async setAutoCollect(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.setAutoCollect(user, parseId(id), body));
  }
  async questions(user: CurrentUser, id: string) {
    return ok(await this.geo.listQuestions(user, parseId(id)));
  }
  async createQuestion(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.saveQuestion(user, parseId(id), body));
  }
  async updateQuestion(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const projectId = Number(body.project_id || 0);
    return ok(await this.geo.saveQuestion(user, projectId, body, parseId(id)));
  }
  async removeQuestion(user: CurrentUser, id: string) {
    return ok(await this.geo.removeQuestion(user, parseId(id)));
  }
  async batches(user: CurrentUser, id: string) {
    return ok(await this.geo.listBatches(user, parseId(id)));
  }
  async createBatch(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.saveBatch(user, parseId(id), body));
  }
  async updateBatch(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const projectId = Number(body.project_id || 0);
    return ok(await this.geo.saveBatch(user, projectId, body, parseId(id)));
  }
  async removeBatch(user: CurrentUser, id: string) {
    return ok(await this.geo.removeBatch(user, parseId(id)));
  }
  async observations(user: CurrentUser, id: string) {
    return ok(await this.geo.listObservations(user, parseId(id)));
  }
  async createObservation(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.saveObservation(user, parseId(id), body));
  }
  async updateObservation(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const batchId = Number(body.batch_id || 0);
    return ok(await this.geo.saveObservation(user, batchId, body, parseId(id)));
  }
  async removeObservation(user: CurrentUser, id: string) {
    return ok(await this.geo.removeObservation(user, parseId(id)));
  }
  async topics(user: CurrentUser, id: string) {
    return ok(await this.geo.listTopics(user, parseId(id)));
  }
  async createTopic(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.geo.saveTopic(user, parseId(id), body));
  }
  async updateTopic(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const projectId = Number(body.project_id || 0);
    return ok(await this.geo.saveTopic(user, projectId, body, parseId(id)));
  }
  async removeTopic(user: CurrentUser, id: string) {
    return ok(await this.geo.removeTopic(user, parseId(id)));
  }
}
