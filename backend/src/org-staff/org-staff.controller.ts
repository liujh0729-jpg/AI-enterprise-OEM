import { ok } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { OrgStaffService } from './org-staff.service';

export class OrgStaffController {
  constructor(private readonly service: OrgStaffService) {}

  async workspace(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.workspace(
        user,
        typeof query.orgType === 'string' ? query.orgType : undefined,
      ),
    );
  }

  async search(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.search(
        user,
        typeof query.q === 'string' ? query.q : '',
      ),
    );
  }

  async invite(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.invite(user, body));
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.service.update(user, Number(id), body));
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.service.remove(user, Number(id)));
  }

  async decide(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.service.decide(
        user,
        Number(id),
        typeof body.action === 'string' ? body.action : '',
      ),
    );
  }

  async functions(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.functions(
        user,
        typeof query.orgType === 'string' ? query.orgType : undefined,
      ),
    );
  }

  async saveDepartment(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveDepartment(user, body));
  }

  async removeDepartment(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return ok(
      await this.service.removeDepartment(
        user,
        id,
        typeof query.orgType === 'string' ? query.orgType : undefined,
      ),
    );
  }

  async savePosition(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.savePosition(user, body));
  }

  async removePosition(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return ok(
      await this.service.removePosition(
        user,
        id,
        typeof query.orgType === 'string' ? query.orgType : undefined,
      ),
    );
  }

  async assignFunctions(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.assignFunctions(user, id, body));
  }
}
