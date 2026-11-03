import { ok } from '../common/api';
import { AppDirectoryService } from './app-directory.service';

/**
 * 应用市场（外部公开目录）三个只读接口。
 * 鉴权由 `/enterprise/*` 的统一鉴权中间件兜住，这里不再取当前用户；
 * 本站不提供上架 / 编辑 / 评价等写动作，这块也不进 `/api/v1` 与 MCP。
 */
export class AppDirectoryController {
  constructor(private readonly apps: AppDirectoryService) {}

  async list(query: {
    category?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    return ok(await this.apps.list(query));
  }

  async detail(clientId: string) {
    return ok(await this.apps.detail(clientId));
  }

  async reviews(clientId: string, page?: number, pageSize?: number) {
    return ok(await this.apps.reviews(clientId, page, pageSize));
  }
}
