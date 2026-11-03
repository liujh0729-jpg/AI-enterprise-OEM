import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { OverseasService } from './overseas.service';
export class OverseasController {
  constructor(private readonly overseas: OverseasService) {}
  async claimPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.overseas.claimPage(user, query));
  }
  async claimStats(user: CurrentUser) {
    return ok(await this.overseas.claimStats(user));
  }
  async claimDetail(user: CurrentUser, id: string) {
    return ok(await this.overseas.claimDetail(user, parseId(id)));
  }
  async catalog() {
    return ok(await this.overseas.catalog());
  }
  async list(user: CurrentUser) {
    return ok(await this.overseas.list(user));
  }
  async create(
    user: CurrentUser,
    body: import('@enterprise/contracts').EndpointInput<'Overseas_create'>['body'],
  ) {
    return ok(await this.overseas.create(user, body));
  }
  async advance(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.overseas.advance(
        user,
        parseId(id),
        text(body.action || ''),
        body,
      ),
    );
  }
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.overseas.updateContacts(user, parseId(id), body));
  }
}
