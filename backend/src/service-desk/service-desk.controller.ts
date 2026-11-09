import { ok } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { ServiceDeskService } from './service-desk.service';

export class ServiceDeskController {
  constructor(private readonly service: ServiceDeskService) {}

  async overview(user: CurrentUser) {
    return ok(await this.service.overview(user));
  }

  async settings(user: CurrentUser) {
    return ok(await this.service.settings(user));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveSettings(user, body));
  }

  async sites(user: CurrentUser) {
    return ok(await this.service.sites(user));
  }

  async saveSite(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveSite(user, body));
  }

  async removeSite(user: CurrentUser, id: string) {
    return ok(await this.service.removeSite(user, Number(id)));
  }

  async rotateSiteKey(user: CurrentUser, id: string) {
    return ok(await this.service.rotateSiteKey(user, Number(id)));
  }

  async uploadIcon(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.uploadIcon(user, body));
  }

  async channels(user: CurrentUser) {
    return ok(await this.service.channels(user));
  }

  async saveChannel(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveChannel(user, body));
  }

  async removeChannel(user: CurrentUser, id: string) {
    return ok(await this.service.removeChannel(user, Number(id)));
  }

  async testChannel(user: CurrentUser, id: string) {
    return ok(await this.service.testChannel(user, Number(id)));
  }

  async receiveChannel(
    token: string,
    request: {
      method: 'GET' | 'POST';
      query: Record<string, string>;
      headers: Record<string, string>;
      rawBody: string;
    },
  ) {
    return this.service.receiveChannel(token, request);
  }

  async groups(user: CurrentUser) {
    return ok(await this.service.groups(user));
  }

  async saveGroup(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveGroup(user, body));
  }

  async removeGroup(user: CurrentUser, id: string) {
    return ok(await this.service.removeGroup(user, Number(id)));
  }

  async agents(user: CurrentUser) {
    return ok(await this.service.agents(user));
  }

  async saveAgent(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveAgent(user, body));
  }

  async removeAgent(user: CurrentUser, id: string) {
    return ok(await this.service.removeAgent(user, Number(id)));
  }

  async setStatus(user: CurrentUser, body: Record<string, unknown>) {
    const owner = await this.service.workOwner(user);
    return ok(
      await this.service.setStatus(
        user,
        owner,
        typeof body.status === 'string' ? body.status : 'OFFLINE',
      ),
    );
  }

  async conversations(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.conversations(user, {
        page: query.page as number | undefined,
        pageSize: query.pageSize as number | undefined,
        status: typeof query.status === 'string' ? query.status : undefined,
        mine: query.mine as boolean | undefined,
      }),
    );
  }

  async conversation(user: CurrentUser, id: string) {
    const owner = await this.service.workOwner(user);
    return ok(await this.service.conversation(user, owner, Number(id)));
  }

  async convertToCrm(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const owner = await this.service.workOwner(user);
    return ok(await this.service.convertToCrm(user, owner, Number(id), body));
  }

  async send(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const owner = await this.service.workOwner(user);
    return ok(await this.service.send(user, owner, Number(id), body));
  }

  async claim(user: CurrentUser, id: string) {
    return ok(await this.service.claim(user, Number(id)));
  }

  async transfer(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.service.transfer(
        user,
        Number(id),
        typeof body.toUserId === 'string' ? body.toUserId : '',
        typeof body.note === 'string' ? body.note : '',
      ),
    );
  }

  async close(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.service.close(user, Number(id), body.inviteRating !== false),
    );
  }

  async aiSuggest(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const owner = await this.service.workOwner(user);
    return ok(
      await this.service.aiSuggest(
        user,
        owner,
        Number(id),
        typeof body.instruction === 'string' ? body.instruction : '',
      ),
    );
  }

  async canned(user: CurrentUser) {
    return ok(await this.service.canned(user));
  }

  async saveCanned(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveCanned(user, body));
  }

  async removeCanned(user: CurrentUser, id: string) {
    return ok(await this.service.removeCanned(user, Number(id)));
  }

  async faqs(user: CurrentUser) {
    return ok(await this.service.faqs(user));
  }

  async saveFaq(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveFaq(user, body));
  }

  async removeFaq(user: CurrentUser, id: string) {
    return ok(await this.service.removeFaq(user, Number(id)));
  }

  async stats(user: CurrentUser, query: Record<string, unknown>) {
    const owner = await this.service.workOwner(user);
    const days = Number(query.days || 7);
    return ok(
      await this.service.stats(user, owner, Math.min(90, Math.max(1, days))),
    );
  }

  /** 公开访客通道（不登录）：站点密钥 + 访客令牌。 */
  async publicSite(siteKey: string) {
    return this.service.publicSite(siteKey);
  }

  async openSession(body: Record<string, unknown>, origin: string, ua: string) {
    return this.service.openSession({
      siteKey: typeof body.siteKey === 'string' ? body.siteKey : '',
      token: typeof body.token === 'string' ? body.token : undefined,
      nickname: typeof body.nickname === 'string' ? body.nickname : '',
      contact: typeof body.contact === 'string' ? body.contact : '',
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
      userAgent: ua,
      origin,
    });
  }

  async openMessages(token: string, conversationId: number, afterId = 0) {
    return this.service.openMessages(token, conversationId, afterId);
  }

  async openSend(
    token: string,
    conversationId: number,
    body: Record<string, unknown>,
  ) {
    return this.service.openSend(token, conversationId, body);
  }

  async openRate(
    token: string,
    conversationId: number,
    body: Record<string, unknown>,
  ) {
    return this.service.openRate(
      token,
      conversationId,
      Number(body.rating || 5),
      typeof body.comment === 'string' ? body.comment : '',
    );
  }

  stream(
    ownerUserId: string,
    conversationId: number | null,
    emit: (
      event: string,
      data: Record<string, unknown>,
    ) => void | Promise<void>,
  ) {
    return this.service.stream(ownerUserId, conversationId, emit);
  }

  async workOwner(user: CurrentUser) {
    return this.service.workOwner(user);
  }
}
