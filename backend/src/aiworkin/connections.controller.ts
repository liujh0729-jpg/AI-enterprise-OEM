import { ok } from '../common/api';
import { ConnectionsService } from './connections.service';
/**
 * 达人建联（建联资源）端点：转发 AIworkin `connections/*` 契约。
 * 所有请求携带当前用户令牌；通道关闭或调用失败时明确返回错误。
 */
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}
  async resources(token: string, query: Record<string, unknown>) {
    return ok(await this.connections.listResources(token, query));
  }
  async locations(token: string) {
    return ok(await this.connections.locations(token));
  }
  async contact(token: string, sourceType: string, resourceId: string) {
    return ok(await this.connections.contact(token, sourceType, resourceId));
  }
  async dictionary(token: string, code: string) {
    return ok(await this.connections.dictionary(token, code));
  }
  async favorites(token: string, page?: string, pageSize?: string) {
    return ok(await this.connections.favoriteList(token, { page, pageSize }));
  }
  async profileFavorites(token: string, query: Record<string, unknown>) {
    return ok(await this.connections.profileFavoriteList(token, query));
  }
  async addFavorite(token: string, resourceId: string) {
    return ok(await this.connections.setFavorite(token, resourceId, true));
  }
  async removeFavorite(token: string, resourceId: string) {
    return ok(await this.connections.setFavorite(token, resourceId, false));
  }
  async addProfileFavorite(token: string, resourceId: string) {
    return ok(
      await this.connections.setFavorite(token, resourceId, true, 'profile'),
    );
  }
  async removeProfileFavorite(token: string, resourceId: string) {
    return ok(
      await this.connections.setFavorite(token, resourceId, false, 'profile'),
    );
  }
}
