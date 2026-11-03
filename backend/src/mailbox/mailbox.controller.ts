import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { MailboxService } from './mailbox.service';

/** AI邮箱服务界面侧接口：账号、实时读信、草稿与发送、话术、台账都按登录账号隔离。 */
export class MailboxController {
  constructor(private readonly service: MailboxService) {}

  async accounts(user: CurrentUser) {
    return ok(await this.service.listAccounts(user));
  }

  async saveAccount(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveAccount(user, body));
  }

  async updateAccount(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.updateAccount(user, id, body));
  }

  async removeAccount(user: CurrentUser, id: string) {
    return ok(await this.service.removeAccount(user, id));
  }

  async testAccount(user: CurrentUser, id: string) {
    return ok(await this.service.testAccount(user, id));
  }

  async messages(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return ok(await this.service.messages(user, id, query));
  }

  async message(
    user: CurrentUser,
    id: string,
    key: string,
    query: Record<string, unknown>,
  ) {
    return ok(await this.service.message(user, id, key, query));
  }

  async drafts(user: CurrentUser, id: string, query: Record<string, unknown>) {
    return ok(await this.service.drafts(user, id, query));
  }

  async saveDraft(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.saveDraft(user, id, body));
  }

  async sendReply(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.sendReply(user, id, body));
  }

  async scripts(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.scripts(user, query));
  }

  async saveScript(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveScript(user, body));
  }

  async updateScript(
    user: CurrentUser,
    scriptId: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.updateScript(user, scriptId, body));
  }

  async removeScript(user: CurrentUser, scriptId: string) {
    return ok(await this.service.removeScript(user, scriptId));
  }

  async ledger(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.ledger(user, query));
  }
}
