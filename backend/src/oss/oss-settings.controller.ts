import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { IdentityService } from '../identity/identity.service';
import { OssService } from './oss.service';
import { OssSettingsService } from './oss-settings.service';

/** 平台管理员：OSS 文件存储配置（加密保存，仅回显掩码）。 */
export class OssSettingsController {
  constructor(
    private readonly settings: OssSettingsService,
    private readonly identity: IdentityService,
    private readonly oss: OssService,
  ) {}

  async view(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return ok(await this.settings.status());
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    this.identity.requireAdmin(user);
    return ok(await this.settings.save(body ?? {}));
  }

  async test(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return ok(await this.oss.testConnection());
  }
}
