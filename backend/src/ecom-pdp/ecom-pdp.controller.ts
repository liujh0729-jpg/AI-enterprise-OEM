import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { EcomPdpService } from './ecom-pdp.service';

/**
 * 跨境电商商品页优化（内容创作）：图包台账 → 规划 → 逐张改词出图。
 * 所有方法返回统一信封；文本与图片调用都在 Service 里走本系统模型网关。
 */
export class EcomPdpController {
  constructor(private readonly pdp: EcomPdpService) {}

  async meta(user: CurrentUser, token?: string) {
    return ok(await this.pdp.meta(user, token));
  }

  async list(user: CurrentUser, query: { page?: number; pageSize?: number }) {
    return ok(await this.pdp.list(user, query));
  }

  async detail(user: CurrentUser, id: string) {
    return ok(await this.pdp.detail(user, parseId(id, '图包 ID')));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.pdp.create(user, body));
  }

  async plan(user: CurrentUser, id: string, token?: string) {
    return ok(await this.pdp.plan(user, token, parseId(id, '图包 ID')));
  }

  async updateAsset(
    user: CurrentUser,
    id: string,
    assetId: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.pdp.updateAsset(
        user,
        parseId(id, '图包 ID'),
        parseId(assetId, '图片 ID'),
        body,
      ),
    );
  }

  async generate(
    user: CurrentUser,
    id: string,
    assetId: string,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(
      await this.pdp.generate(
        user,
        token,
        parseId(id, '图包 ID'),
        parseId(assetId, '图片 ID'),
        body,
      ),
    );
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.pdp.remove(user, parseId(id, '图包 ID')));
  }
}
