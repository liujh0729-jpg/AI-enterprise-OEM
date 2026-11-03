import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CapabilityService } from './capability.service';
/** 企业能力（电子报税 / 电子开票）：服务商按服务企业配置、查看与付费开通申请。 */
export class CapabilityController {
  constructor(private readonly capability: CapabilityService) {}
  async mine(user: CurrentUser, enterpriseId?: string) {
    return ok(
      await this.capability.mine(
        user,
        enterpriseId ? parseId(enterpriseId, '企业 ID') : undefined,
      ),
    );
  }
  /** 服务商侧：名下服务企业 × 自动化能力的配置矩阵。 */
  async served(user: CurrentUser) {
    return ok(await this.capability.servedMatrix(user));
  }
  /** 配置自动化能力（待平台审核）：开通时间为必填。 */
  async request(
    user: CurrentUser,
    code: string,
    body: {
      note?: string;
      enterpriseId?: number;
      opensAt?: string;
    },
  ) {
    return ok(
      await this.capability.request(
        user,
        code,
        text(body.note),
        body.enterpriseId ? parseId(body.enterpriseId, '企业 ID') : undefined,
        body.opensAt || '',
      ),
    );
  }
  /** 撤回待审核的配置。 */
  async cancel(
    user: CurrentUser,
    code: string,
    body: {
      enterpriseId?: number;
    },
  ) {
    return ok(
      await this.capability.cancel(
        user,
        code,
        body.enterpriseId ? parseId(body.enterpriseId, '企业 ID') : undefined,
      ),
    );
  }
}
