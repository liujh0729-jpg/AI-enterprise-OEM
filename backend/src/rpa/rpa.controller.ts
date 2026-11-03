import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { RpaAccountService } from './rpa-account.service';
import { RpaLlmService } from './rpa-llm.service';
import { RpaScriptService } from './rpa-script.service';
import { RpaTaskService } from './rpa-task.service';
import { RpaSettingService } from './rpa-setting.service';

/**
 * RPA 界面侧接口（登录态）。三块内容与 /rpa 页面的三个页签一一对应：
 * RPA 任务 / RPA 账号 / RPA 脚本，另加「AI 写脚本」用的模型配置与生成端点。
 * 本地执行端走的机器通道在 rpa-open.controller（x-api-key），不从这里出。
 */
export class RpaController {
  constructor(
    private readonly scripts: RpaScriptService,
    private readonly accounts: RpaAccountService,
    private readonly tasks: RpaTaskService,
    private readonly llm: RpaLlmService,
    private readonly settings: RpaSettingService,
  ) {}

  // ---------- RPA 脚本 ----------

  async listScripts(
    user: CurrentUser,
    query: {
      status?: string;
      deviceType?: string;
      fileType?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return ok(await this.scripts.list(user, query));
  }

  async generate(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.generate(user, body, token));
  }

  async getScript(user: CurrentUser, id: string) {
    return ok(await this.scripts.get(user, parseId(id, '脚本 ID')));
  }

  async createScript(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.scripts.create(user, body));
  }

  async updateScript(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.scripts.update(user, parseId(id, '脚本 ID'), body));
  }

  async deleteScript(user: CurrentUser, id: string) {
    return ok(await this.scripts.remove(user, parseId(id, '脚本 ID')));
  }

  // ---------- RPA 账号 ----------

  async listAccounts(user: CurrentUser, query: { keyword?: string }) {
    return ok(await this.accounts.list(user, query));
  }

  async createAccount(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.accounts.create(user, body));
  }

  async updateAccount(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.accounts.update(user, parseId(id, '账号 ID'), body));
  }

  async deleteAccount(user: CurrentUser, id: string) {
    return ok(await this.accounts.remove(user, parseId(id, '账号 ID')));
  }

  // ---------- RPA 任务 ----------

  async listTasks(
    user: CurrentUser,
    query: {
      status?: string;
      deviceType?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return ok(
      await this.tasks.list(user, {
        status: query.status,
        deviceType: query.deviceType,
        keyword: query.keyword,
        page: query.page === undefined ? undefined : String(query.page),
        pageSize:
          query.pageSize === undefined ? undefined : String(query.pageSize),
      }),
    );
  }

  async createTask(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.tasks.create(user, body));
  }

  /** 批量建任务：每个账号一个独立任务，脚本 / 参数 / 排期共用。 */
  async createBatch(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.tasks.createBatch(user, body));
  }

  async listExecutions(
    user: CurrentUser,
    query: { taskId?: number; limit?: number },
  ) {
    return ok(
      await this.tasks.listExecutions(user, query.taskId, query.limit ?? 50),
    );
  }

  async getTask(user: CurrentUser, id: string) {
    return ok(await this.tasks.get(user, parseId(id, '任务 ID')));
  }

  async updateTask(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.tasks.update(user, parseId(id, '任务 ID'), body));
  }

  async deleteTask(user: CurrentUser, id: string) {
    return ok(await this.tasks.remove(user, parseId(id, '任务 ID')));
  }

  async cancelTask(user: CurrentUser, id: string) {
    return ok(await this.tasks.cancel(user, parseId(id, '任务 ID')));
  }

  async requeueTask(user: CurrentUser, id: string) {
    return ok(await this.tasks.requeue(user, parseId(id, '任务 ID')));
  }

  async taskExecutions(user: CurrentUser, id: string) {
    return ok(await this.tasks.listExecutions(user, parseId(id, '任务 ID')));
  }

  // ---------- AI 写脚本用的模型配置 ----------

  async llmSetting(user: CurrentUser, token?: string) {
    return ok(await this.llm.setting(user, token));
  }

  async saveLlm(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.save(user, body, token));
  }

  async deleteLlm(user: CurrentUser) {
    return ok(await this.llm.remove(user));
  }

  async llmModels(user: CurrentUser, token?: string) {
    return ok(await this.llm.models(user, token));
  }

  /** 参数填写 Chat：用户描述意图 → AI 按脚本 paramsSchema 引导补全 → 提取参数值。 */
  async paramsChat(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.chatParams(user, body, token));
  }

  // ---------- RPA 设置（每个租户的比特浏览器实例配置） ----------

  async getSettings(user: CurrentUser) {
    return ok(await this.settings.get(user));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.settings.upsert(user, body));
  }
}
