import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { RpaAccountService } from './rpa-account.service';
import { RpaLlmService } from './rpa-llm.service';
import { RpaScriptService } from './rpa-script.service';
import { RpaTaskService } from './rpa-task.service';

/**
 * RPA 机器通道（x-api-key）：本地比特浏览器执行端与 MCP 工具都走这里。
 *
 * Key 属于哪个账号，就只能看到并认领那个账号的脚本 / 账号 / 任务；
 * 认领报文里会带上前台从来不回传的账号口令明文（已解密），
 * 因为执行端要在比特浏览器窗口 / 云手机环境里真的登录目标平台。
 *
 * 脚本与任务都带 `deviceType`（pc / android / iphone）：一台只装了 PC 比特浏览器的执行端
 * 不该领到云手机任务，认领时同样按声明的设备过滤待办。
 */
export class RpaOpenController {
  constructor(
    private readonly scripts: RpaScriptService,
    private readonly accounts: RpaAccountService,
    private readonly tasks: RpaTaskService,
    private readonly llm: RpaLlmService,
  ) {}

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

  async getScript(user: CurrentUser, id: string) {
    return ok(await this.scripts.get(user, parseId(id, '脚本 ID')));
  }

  /** AI 写脚本：需求 + 设备（pc / android / iphone）+ 类型（automa_json / python / js）→ 正文，只回预览不落库。 */
  async generate(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.llm.generate(user, body, token));
  }

  async createScript(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.scripts.create(user, body));
  }

  async listAccounts(user: CurrentUser, query: { keyword?: string }) {
    return ok(await this.accounts.list(user, query));
  }

  async listTasks(
    user: CurrentUser,
    query: { status?: string; deviceType?: string; limit?: number },
  ) {
    return ok(
      await this.tasks.openTasks(user, {
        status: query.status,
        deviceType: query.deviceType,
        limit: query.limit === undefined ? undefined : String(query.limit),
      }),
    );
  }

  async getTask(user: CurrentUser, id: string) {
    return ok(await this.tasks.get(user, parseId(id, '任务 ID')));
  }

  /** 建任务：云端一次绑定「脚本 + 账号 + 参数」，之后由本地执行端认领。 */
  async createTask(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.tasks.create(user, body));
  }

  async listExecutions(
    user: CurrentUser,
    query: { taskId?: number; limit?: number },
  ) {
    return ok(
      await this.tasks.listExecutions(user, query.taskId, query.limit ?? 50),
    );
  }

  /**
   * 领任务：不带 taskId 时按排队顺序原子抢一个；带 taskId 时只抢那一个。
   * body 里可带 deviceType 声明执行端自己是什么设备（只装了 PC 比特浏览器就别领云手机任务），
   * 定向认领跨设备任务会被拒。
   */
  async claim(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.tasks.claim(user, body));
  }

  /** 回传结果：success / failed / cancelled，失败且还有重试次数时任务自动退回待执行。 */
  async finish(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.tasks.finish(user, parseId(id, '执行 ID'), body));
  }
}
