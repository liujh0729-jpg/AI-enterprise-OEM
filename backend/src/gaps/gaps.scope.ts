import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';

/**
 * 附录 B 补齐项的组织口径：一律复用 HRM 的 (orgType, orgUserId) 归属，
 * 平台管理员操作目录类数据（套餐、条款、更新日志），组织管理员操作本组织数据。
 */
export class GapScopeService {
  constructor(private readonly hrm: HrmScopeService) {}

  resolve(user: CurrentUser): Promise<HrmOrg> {
    return this.hrm.resolve(user);
  }

  async requireAdmin(user: CurrentUser): Promise<HrmOrg> {
    const org = await this.hrm.resolve(user);
    this.hrm.requireAdmin(org);
    return org;
  }

  /** 平台级目录（套餐 / 条款 / 更新日志）：仅平台管理员可写。 */
  platformAdmin(user: CurrentUser): boolean {
    return user.isAdmin();
  }

  /** 已解析组织上下文的管理员校验（需要先拿到 org 再做权限判断的场景）。 */
  requireAdminFor(org: HrmOrg): void {
    this.hrm.requireAdmin(org);
  }

  requirePlatformAdmin(user: CurrentUser): void {
    if (!this.platformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该操作需要平台管理员权限',
      );
    }
  }

  memberIds(org: HrmOrg): Promise<string[]> {
    return this.hrm.memberUserIds(org);
  }

  names(ids: string[]): Promise<Map<string, string>> {
    return this.hrm.names(ids);
  }

  requireMember(org: HrmOrg, staffUserId: string): Promise<string> {
    return this.hrm.requireStaff(org, staffUserId, false);
  }
}
