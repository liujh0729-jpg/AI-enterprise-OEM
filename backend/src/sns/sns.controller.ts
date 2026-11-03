import { ok } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { SnsService } from './sns.service';

type Row = Record<string, unknown>;

/** SNS 私信：方法名与契约 Sns_* / Notifications_* 去掉前缀后一致。 */
export class SnsController {
  constructor(private readonly service: SnsService) {}

  async sendMessage(user: CurrentUser, body: Row) {
    return ok(await this.service.send(user, body));
  }

  async readSns(user: CurrentUser, id: string) {
    return ok(await this.service.read(user.userId, id));
  }
}
