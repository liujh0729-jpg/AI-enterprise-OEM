import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { AgentMemoryService } from './agent-memory.service';

/** 智能体记忆（「工作台」栏目组）界面侧接口：记忆概览、操作流、清空我的记忆，一律按登录账号隔离。 */
export class AgentMemoryController {
  constructor(private readonly memory: AgentMemoryService) {}

  async overview(user: CurrentUser) {
    return ok(await this.memory.overview(user.userId));
  }

  async events(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.memory.events(user.userId, query));
  }

  async grants(user: CurrentUser) {
    return ok(await this.memory.grants(user.userId));
  }

  async saveGrants(user: CurrentUser, body: Record<string, unknown>) {
    const actions = Array.isArray(body.actions)
      ? body.actions.filter((item): item is string => typeof item === 'string')
      : [];
    // 新增授权要验本站登录密码（服务端判定，不信界面上的预检）
    return ok(
      await this.memory.saveGrants(user.userId, actions, body.password),
    );
  }

  async clear(user: CurrentUser) {
    return ok(await this.memory.clear(user.userId));
  }
}
