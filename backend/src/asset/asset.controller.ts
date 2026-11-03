import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { AssetService } from './asset.service';
export class AssetController {
  constructor(private readonly asset: AssetService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<AssetService['listPage']>[1],
  ) {
    return ok(await this.asset.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.asset.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.asset.detail(user, parseId(id)));
  }

  async list(user: CurrentUser, province?: string, city?: string) {
    return ok(await this.asset.list(user, { province, city }));
  }
  async create(
    user: CurrentUser,
    token: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.asset.create(user, body, token));
  }
  async accept(user: CurrentUser, id: string) {
    return ok(await this.asset.accept(user, parseId(id)));
  }
  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.asset.update(user, parseId(id), body));
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.asset.remove(user, parseId(id)));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.asset.messages(user, parseId(id), token));
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
      await this.asset.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  /** 改联系方式（临时换人）：需求用户 / 居间承办人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.asset.updateContacts(user, parseId(id), body));
  }
}
