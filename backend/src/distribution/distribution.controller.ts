import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { DistributionService } from './distribution.service';

/**
 * 多平台内容分发（营销工具）：内容台账 CRUD + 插件推送标记 + 逐平台结果回写。
 * 实际发布由 AIPDD Enterprise 浏览器插件在本地完成，这里只做台账与结果落库。
 */
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  async meta(user: CurrentUser) {
    return ok(await this.distribution.meta(user));
  }

  async list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      mediaType?: string;
      status?: string;
      keyword?: string;
    },
  ) {
    return ok(await this.distribution.list(user, query));
  }

  async detail(user: CurrentUser, id: string) {
    return ok(await this.distribution.detail(user, parseId(id, '内容 ID')));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.distribution.create(user, body));
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.distribution.update(user, parseId(id, '内容 ID'), body));
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.distribution.remove(user, parseId(id, '内容 ID')));
  }

  async mark(user: CurrentUser, id: string) {
    return ok(await this.distribution.mark(user, parseId(id, '内容 ID')));
  }

  async reportLogs(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.distribution.reportLogs(user, parseId(id, '内容 ID'), body),
    );
  }
}
