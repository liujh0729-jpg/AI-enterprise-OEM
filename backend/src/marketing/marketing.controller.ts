import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { MarketingService } from './marketing.service';
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<MarketingService['listPage']>[1],
  ) {
    return ok(await this.marketing.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.marketing.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.marketing.detail(user, parseId(id)));
  }

  async list(user: CurrentUser, as?: string, province?: string, city?: string) {
    return ok(
      await this.marketing.list(user, as === 'provider', { province, city }),
    );
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.marketing.create(user, body, token));
  }
  async accept(user: CurrentUser, id: string) {
    return ok(await this.marketing.accept(user, parseId(id)));
  }
  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.marketing.update(user, parseId(id), body));
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.marketing.remove(user, parseId(id)));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.marketing.messages(user, parseId(id), token));
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
      await this.marketing.postMessage(
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
    return ok(await this.marketing.updateContacts(user, parseId(id), body));
  }
  async confirm(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.marketing.confirm(user, parseId(id), body));
  }
}
