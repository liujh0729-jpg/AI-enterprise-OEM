import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { AiCallAccountService } from './ai-call-account.service';

/**
 * AI 调用账号界面侧接口（登录态）：Workbuddy 企业云页内的「AI 调用账号」页签用。
 * 每个账号只看到自己的凭据；平台管理员也不代看他人明文。
 */
export class AiCallController {
  constructor(private readonly accounts: AiCallAccountService) {}

  async list(user: CurrentUser, query: { keyword?: string }) {
    return ok(await this.accounts.list(user, query));
  }

  async get(user: CurrentUser, id: string) {
    return ok(await this.accounts.get(user, parseId(id, '账号 ID')));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.accounts.create(user, body));
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.accounts.update(user, parseId(id, '账号 ID'), body));
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.accounts.remove(user, parseId(id, '账号 ID')));
  }
}
