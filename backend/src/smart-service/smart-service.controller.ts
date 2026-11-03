import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { SmartServiceService } from './smart-service.service';
export class SmartServiceController {
  constructor(private readonly smart: SmartServiceService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<SmartServiceService['listPage']>[1],
  ) {
    return ok(await this.smart.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.smart.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.smart.detail(user, parseId(id)));
  }

  async list(user: CurrentUser, as?: string, province?: string, city?: string) {
    return ok(
      await this.smart.list(user, as === 'provider', { province, city }),
    );
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.smart.create(user, body, token));
  }
  async accept(user: CurrentUser, id: string) {
    return ok(await this.smart.accept(user, parseId(id)));
  }
  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.smart.update(user, parseId(id), body));
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.smart.remove(user, parseId(id)));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.smart.messages(user, parseId(id), token));
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
      await this.smart.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  /** 改联系方式（临时换人）：企业当事人 / 承办人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.smart.updateContacts(user, parseId(id), body));
  }
  async advance(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.smart.advance(
        user,
        parseId(id),
        text(body.action || ''),
        body.text === undefined ? '' : text(body.text),
        body,
      ),
    );
  }
}
