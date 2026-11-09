import type { CurrentUser } from '../auth/current-user';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { Row } from './mechanism.shared';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AccountCrypto } from '../account/account-crypto';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FeishuClient, WecomClient } from '../im/im.clients';
import { ImCrypto } from '../im/im.crypto';

/** §5.8 横切机制公共依赖：各子服务继承后只写自己的动作。 */
export abstract class MechanismBase {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly scope: HrmScopeService,
    protected readonly crypto: AccountCrypto,
    protected readonly storage: StorageService,
    protected readonly notifications: NotificationService,
    protected readonly requirePlatformAdmin: (user: CurrentUser) => void,
  ) {}

  protected readonly feishu = new FeishuClient();

  protected readonly wecom = new WecomClient();

  protected readonly imCrypto = new ImCrypto();

  protected readonly discoveryCache = new Map<
    string,
    { at: number; value: Row }
  >();

  protected async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }
}
