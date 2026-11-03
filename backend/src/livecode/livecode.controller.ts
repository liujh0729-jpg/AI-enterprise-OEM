import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { LivecodeService } from './livecode.service';

export class LivecodeController {
  constructor(private readonly service: LivecodeService) {}

  async domains(user: CurrentUser) {
    return ok(await this.service.domains(user));
  }

  async domainCreate(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.domainCreate(user, body));
  }

  async domainCheck(user: CurrentUser, id: string) {
    return ok(await this.service.domainCheck(user, Number(id)));
  }

  async domainUpdate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.domainUpdate(user, Number(id), body));
  }

  async domainRemove(user: CurrentUser, id: string) {
    return ok(await this.service.domainRemove(user, Number(id)));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.list(user, {
        page: query.page as number | undefined,
        pageSize: query.pageSize as number | undefined,
        keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
        status: typeof query.status === 'string' ? query.status : undefined,
      }),
    );
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.create(user, body));
  }

  async get(user: CurrentUser, id: string) {
    return ok(await this.service.get(user, Number(id)));
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.service.update(user, Number(id), body));
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.service.remove(user, Number(id)));
  }

  async entry(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.service.entry(user, Number(id), Number(body.count || 1)),
    );
  }

  async switchDomain(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.service.switchDomain(
        user,
        Number(id),
        typeof body.domainId === 'number' ? body.domainId : undefined,
      ),
    );
  }

  async childCreate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.service.childCreate(user, Number(id), body));
  }

  async childUpdate(
    user: CurrentUser,
    id: string,
    childId: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.service.childUpdate(user, Number(id), Number(childId), body),
    );
  }

  async childRemove(user: CurrentUser, id: string, childId: string) {
    return ok(
      await this.service.childRemove(user, Number(id), Number(childId)),
    );
  }

  async stats(user: CurrentUser, id: string, query: Record<string, unknown>) {
    return ok(
      await this.service.stats(
        user,
        Number(id),
        Math.min(90, Math.max(1, Number(query.days || 30))),
      ),
    );
  }

  async scans(user: CurrentUser, id: string, query: Record<string, unknown>) {
    return ok(
      await this.service.scans(user, Number(id), {
        page: query.page as number | undefined,
        pageSize: query.pageSize as number | undefined,
      }),
    );
  }

  private requireAdmin(user: CurrentUser) {
    if (!user.isAdmin()) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '需要平台管理员');
    }
  }

  async adminList(user: CurrentUser, query: Record<string, unknown>) {
    this.requireAdmin(user);
    return ok(
      await this.service.adminList({
        page: query.page as number | undefined,
        pageSize: query.pageSize as number | undefined,
        keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
      }),
    );
  }

  async adminDisable(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    this.requireAdmin(user);
    return ok(
      await this.service.adminDisable(
        Number(id),
        typeof body.reason === 'string' ? body.reason : '',
        body.enable === true,
      ),
    );
  }
}
