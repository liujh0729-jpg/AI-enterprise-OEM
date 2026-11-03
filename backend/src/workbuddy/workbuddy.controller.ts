import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { WorkbuddyAccountService } from './workbuddy-account.service';
import { WorkbuddyAgentService } from './workbuddy-agent.service';
import { WorkbuddyLlmService } from './workbuddy-llm.service';
import { WorkbuddyPlanService } from './workbuddy-plan.service';

/**
 * Workbuddy 企业云界面侧接口（登录态）。三块与 /workbuddy 的三个页签一一对应：
 * Workbuddy 账号（腾讯云凭据）/ Agent（远端清单与版本）/ 计划任务（澄清 → 拆解 → 派发 → 同步）。
 * 每个用户只用自己的凭据与自己的计划，管理员也不代看他人密钥。
 */
export class WorkbuddyController {
  constructor(
    private readonly accounts: WorkbuddyAccountService,
    private readonly agents: WorkbuddyAgentService,
    private readonly llm: WorkbuddyLlmService,
    private readonly plans: WorkbuddyPlanService,
  ) {}

  // ---------- Workbuddy 账号（腾讯云凭据） ----------

  async listAccounts(user: CurrentUser) {
    return ok(await this.accounts.list(user));
  }

  async createAccount(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.accounts.create(user, body));
  }

  async updateAccount(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.accounts.update(user, parseId(id, '凭据 ID'), body));
  }

  async removeAccount(user: CurrentUser, id: string) {
    return ok(await this.accounts.remove(user, parseId(id, '凭据 ID')));
  }

  async verifyAccount(user: CurrentUser, id: string) {
    return ok(await this.accounts.verify(user, parseId(id, '凭据 ID')));
  }

  // ---------- 模型配置（澄清用） ----------

  async setting(user: CurrentUser, token?: string) {
    return ok(await this.llm.setting(user, token));
  }

  async saveSetting(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.save(user, body, token));
  }

  async removeSetting(user: CurrentUser) {
    return ok(await this.llm.remove(user));
  }

  async models(user: CurrentUser, token?: string) {
    return ok(await this.llm.models(user, token));
  }

  // ---------- Agent ----------

  async listAgents(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.list(user, query));
  }

  async agentDetail(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.detail(user, query));
  }

  async createAgent(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agents.create(user, body));
  }

  async updateAgent(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agents.update(user, body));
  }

  async removeAgent(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agents.remove(user, body));
  }

  async agentVersions(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.versions(user, query));
  }

  async createAgentVersion(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agents.createVersion(user, body));
  }

  async builtinModels(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.models(user, query));
  }

  async skills(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.skills(user, query));
  }

  async experts(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.experts(user, query));
  }

  async connectors(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.agents.connectors(user, query));
  }

  // ---------- 计划任务 ----------

  async listPlans(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.plans.list(user, query));
  }

  async createPlan(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.plans.create(user, body));
  }

  async updatePlan(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.plans.update(user, parseId(id, '计划 ID'), body));
  }

  async removePlan(user: CurrentUser, id: string) {
    return ok(await this.plans.remove(user, parseId(id, '计划 ID')));
  }

  async getPlan(user: CurrentUser, id: string) {
    return ok(await this.plans.get(user, parseId(id, '计划 ID')));
  }

  async clarify(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.clarify(user, body, token));
  }

  async materialize(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.plans.materialize(user, parseId(id, '计划 ID'), body));
  }

  async addTask(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.plans.addTask(user, parseId(id, '计划 ID'), body));
  }

  async dispatch(user: CurrentUser, id: string) {
    return ok(await this.plans.dispatch(user, parseId(id, '计划 ID')));
  }

  async sync(user: CurrentUser, id: string) {
    return ok(await this.plans.sync(user, parseId(id, '计划 ID')));
  }

  async updateTask(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.plans.updateTask(user, parseId(id, '任务 ID'), body));
  }

  async removeTask(user: CurrentUser, id: string) {
    return ok(await this.plans.removeTask(user, parseId(id, '任务 ID')));
  }

  async taskEvents(user: CurrentUser, id: string) {
    return ok(await this.plans.events(user, parseId(id, '任务 ID')));
  }

  async followUp(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.plans.followUp(user, parseId(id, '任务 ID'), body));
  }

  async cancelTask(user: CurrentUser, id: string) {
    return ok(await this.plans.cancelTask(user, parseId(id, '任务 ID')));
  }
}
