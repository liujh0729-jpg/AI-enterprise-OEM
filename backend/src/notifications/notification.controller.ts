import { ok } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { NotificationService } from './notification.service';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  async list(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.list(user, {
        page: query.page as number | undefined,
        pageSize: query.pageSize as number | undefined,
        category:
          typeof query.category === 'string' ? query.category : undefined,
        unreadOnly: query.unreadOnly as boolean | undefined,
      }),
    );
  }

  async unread(user: CurrentUser) {
    return ok(await this.service.unread(user));
  }

  async read(user: CurrentUser, id: string) {
    return ok(await this.service.read(user, Number(id)));
  }

  async readAll(user: CurrentUser, body: Record<string, unknown>) {
    const category =
      typeof body.category === 'string' && body.category
        ? body.category
        : undefined;
    return ok(await this.service.readAll(user, category));
  }
}
