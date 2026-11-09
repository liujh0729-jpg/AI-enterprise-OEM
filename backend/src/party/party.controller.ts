import type { CurrentUser } from '../auth/current-user';
import { PartyService } from './party.service';

/** 统一外部主体：与契约 Party_* 一一对应。 */
export class PartyController {
  constructor(private readonly service: PartyService) {}

  list(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.list(user, query);
  }

  save(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.save(user, body);
  }

  remove(user: CurrentUser, id: string) {
    return this.service.remove(user, id);
  }
}
