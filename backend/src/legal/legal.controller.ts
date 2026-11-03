import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { LegalService } from './legal.service';
export class LegalController {
  constructor(private readonly legal: LegalService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<LegalService['listPage']>[1],
  ) {
    return ok(await this.legal.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.legal.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.legal.detail(user, parseId(id)));
  }

  async lawyers(
    kind?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(await this.legal.lawyers({ kind, province, city, keyword }));
  }
  async createLawyer(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.legal.createLawFirm(user, body));
  }
  async updateLawyer(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.legal.updateLawyer(user, parseId(id), body));
  }
  async removeLawyer(user: CurrentUser, id: string) {
    return ok(await this.legal.removeLawyer(user, parseId(id)));
  }
  async list(user: CurrentUser, province?: string, city?: string) {
    return ok(await this.legal.list(user, { province, city }));
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.legal.createRequest(user, body, token));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.legal.messages(user, parseId(id), token));
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
      await this.legal.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  async publish(user: CurrentUser, token: string, id: string) {
    return ok(await this.legal.publish(user, parseId(id), token));
  }
  /** 改联系方式（临时换人）：企业当事人 / 承办人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.legal.updateContacts(user, parseId(id), body));
  }
  async updateRequest(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.legal.updateRequest(user, parseId(id), body));
  }
  async removeRequest(user: CurrentUser, id: string) {
    return ok(await this.legal.removeRequest(user, parseId(id)));
  }
}
