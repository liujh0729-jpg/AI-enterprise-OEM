import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { IpService } from './ip.service';
export class IpController {
  constructor(private readonly ip: IpService) {}
  async listPage(
    user: CurrentUser,
    query: Parameters<IpService['listPage']>[1],
  ) {
    return ok(await this.ip.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.ip.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.ip.detail(user, parseId(id)));
  }

  async agencies(
    kind?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(await this.ip.agencies({ kind, province, city, keyword }));
  }
  async createAgency(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.ip.createAgency(user, body));
  }
  async updateAgency(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.ip.updateAgency(user, parseId(id), body));
  }
  async removeAgency(user: CurrentUser, id: string) {
    return ok(await this.ip.removeAgency(user, parseId(id)));
  }
  async list(user: CurrentUser, province?: string, city?: string) {
    return ok(await this.ip.list(user, { province, city }));
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.ip.create(user, 'BIZ', body, token));
  }
  async consult(
    user: CurrentUser,
    token: string,
    body: Record<string, string>,
  ) {
    return ok(await this.ip.create(user, 'CONSULT', body, token));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.ip.messages(user, parseId(id), token));
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
      await this.ip.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  async publish(user: CurrentUser, token: string, id: string) {
    return ok(await this.ip.publish(user, parseId(id), token));
  }
  /** 改联系方式（临时换人）：企业当事人 / 承办人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.ip.updateContacts(user, parseId(id), body));
  }
  async updateRequest(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.ip.updateRequest(user, parseId(id), body));
  }
  async removeRequest(user: CurrentUser, id: string) {
    return ok(await this.ip.removeRequest(user, parseId(id)));
  }
}
