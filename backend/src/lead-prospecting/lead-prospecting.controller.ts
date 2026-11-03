import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { LeadProspectingService } from './lead-prospecting.service';

/**
 * Google 潜客线索挖掘界面侧接口（登录态）。
 * 设置 → 意图对话 → 任务：三段动作与 /marketing 页「Google潜客」页签一一对应。
 */
export class LeadProspectingController {
  constructor(private readonly leads: LeadProspectingService) {}

  async settings(user: CurrentUser, token?: string) {
    return ok(await this.leads.getSettings(user, token));
  }

  async saveSettings(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.leads.save(user, body, token));
  }

  async removeSerperKey(user: CurrentUser, token?: string) {
    return ok(await this.leads.removeSerperKey(user, token));
  }

  async createTable(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.leads.createDataTable(user, body));
  }

  async tables(user: CurrentUser) {
    return ok(await this.leads.resultTableOptions(user));
  }

  async models(user: CurrentUser, token?: string) {
    return ok(await this.leads.models(user, token));
  }

  async chat(user: CurrentUser, body: Record<string, unknown>, token?: string) {
    return ok(await this.leads.chat(user, body, token));
  }

  async messages(user: CurrentUser) {
    return ok(await this.leads.listMessages(user));
  }

  async createTask(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.leads.createTask(user, body, token));
  }

  async listTasks(
    user: CurrentUser,
    query: { page?: number; pageSize?: number },
  ) {
    return ok(await this.leads.listTasks(user, query));
  }

  async task(user: CurrentUser, id: string) {
    return ok(await this.leads.getTask(user, parseId(id, '任务 ID')));
  }

  async startTask(user: CurrentUser, id: string, token?: string) {
    return ok(await this.leads.start(user, parseId(id, '任务 ID'), token));
  }

  async updateTaskTable(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.leads.updateTaskTable(
        user,
        parseId(id, '任务 ID'),
        body.dataTableId,
      ),
    );
  }

  async removeTask(user: CurrentUser, id: string) {
    return ok(await this.leads.removeTask(user, parseId(id, '任务 ID')));
  }
}
