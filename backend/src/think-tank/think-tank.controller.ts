import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { ThinkTankService } from './think-tank.service';
export class ThinkTankController {
  constructor(private readonly thinkTank: ThinkTankService) {}
  async experts(query: Parameters<ThinkTankService['experts']>[0]) {
    return ok(await this.thinkTank.experts(query));
  }
  async createExpert(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.thinkTank.createExpert(user, body));
  }
  async updateExpert(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.thinkTank.updateExpert(user, parseId(id), body));
  }
  async removeExpert(user: CurrentUser, id: string) {
    return ok(await this.thinkTank.removeExpert(user, parseId(id)));
  }
  async listPage(
    user: CurrentUser,
    query: Parameters<ThinkTankService['listPage']>[1],
  ) {
    return ok(await this.thinkTank.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.thinkTank.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.thinkTank.detail(user, parseId(id)));
  }
  async create(user: CurrentUser, token: string, body: Record<string, string>) {
    return ok(await this.thinkTank.create(user, body, token));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.thinkTank.messages(user, parseId(id), token));
  }
  async postMessage(
    user: CurrentUser,
    token: string,
    id: string,
    body: { text?: string; conversation_id?: string },
  ) {
    return ok(
      await this.thinkTank.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  async publish(user: CurrentUser, token: string, id: string) {
    return ok(await this.thinkTank.publish(user, parseId(id), token));
  }
  async updateRequest(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.thinkTank.updateRequest(user, parseId(id), body));
  }
  /** 改联系方式（临时换人）：企业当事人 / 承办人 / 平台管理员，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.thinkTank.updateContacts(user, parseId(id), body));
  }
  async removeRequest(user: CurrentUser, id: string) {
    return ok(await this.thinkTank.removeRequest(user, parseId(id)));
  }
}
