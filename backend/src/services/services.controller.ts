import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { ServicesService } from './services.service';
/** 服务商发布服务：六个业务域共用（domain 区分）。 */
export class ServicesController {
  constructor(private readonly services: ServicesService) {}
  async list(user: CurrentUser, domain?: string) {
    return ok(await this.services.list(user, domain));
  }
  async page(
    user: CurrentUser,
    query: { domain?: string; page: number; pageSize: number },
  ) {
    return ok(await this.services.page(user, query));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.services.detail(user, parseId(id)));
  }
  async create(
    user: CurrentUser,
    token: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.services.create(user, body, token));
  }
  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.services.update(user, parseId(id), body));
  }
  /** 草稿转发布态；已发布的服务改动后再次调用即重新同步。 */
  async publish(user: CurrentUser, token: string, id: string) {
    return ok(await this.services.publish(user, parseId(id), token));
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.services.remove(user, parseId(id)));
  }
}
