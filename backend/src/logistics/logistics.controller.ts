import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { LogisticsService } from './logistics.service';
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<LogisticsService['listPage']>[1],
  ) {
    return ok(await this.logistics.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.logistics.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.logistics.detail(user, parseId(id)));
  }

  async list(user: CurrentUser, as?: string, province?: string, city?: string) {
    return ok(
      await this.logistics.list(user, as === 'provider', { province, city }),
    );
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.logistics.create(user, body, token));
  }
  async accept(user: CurrentUser, id: string) {
    return ok(await this.logistics.accept(user, parseId(id)));
  }
  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.logistics.update(user, parseId(id), body));
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.logistics.remove(user, parseId(id)));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.logistics.messages(user, parseId(id), token));
  }
  async postMessage(
    user: CurrentUser,
    token: string,
    id: string,
    body: {
      text?: string;
      conversation_id?: string;
    },
  ) {
    return ok(
      await this.logistics.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  /** 改联系方式（临时换人）：企业当事人 / 承运人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.logistics.updateContacts(user, parseId(id), body));
  }
  async advance(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.logistics.advance(
        user,
        parseId(id),
        text(body.action || ''),
        body.text === undefined ? '' : text(body.text),
        body,
      ),
    );
  }
}
