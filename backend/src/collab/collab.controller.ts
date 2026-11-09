import type { CurrentUser } from '../auth/current-user';
import type { CollabService } from './collab.service';

type Row = Record<string, unknown>;
type TargetQuery = { targetType: string; targetId: string };
type PageQuery = { page: number; pageSize: number };

/** 通用协作底座控制器：方法名与契约 `Collab_*` 后缀一一对应。 */
export class CollabController {
  constructor(private readonly service: CollabService) {}

  comments(user: CurrentUser, query: TargetQuery & PageQuery) {
    return this.service.comments(user, query);
  }

  createComment(user: CurrentUser, body: Row) {
    return this.service.createComment(user, body);
  }

  removeComment(user: CurrentUser, body: Row) {
    return this.service.removeComment(user, body);
  }

  mentions(user: CurrentUser, query: PageQuery & { unreadOnly?: string }) {
    return this.service.mentions(user, query);
  }

  readMention(user: CurrentUser, body: Row) {
    return this.service.readMention(user, body);
  }

  tags(user: CurrentUser) {
    return this.service.tags(user);
  }

  saveTag(user: CurrentUser, body: Row) {
    return this.service.saveTag(user, body);
  }

  removeTag(user: CurrentUser, body: Row) {
    return this.service.removeTag(user, body);
  }

  objectTags(user: CurrentUser, query: TargetQuery) {
    return this.service.objectTags(user, query);
  }

  attachTag(user: CurrentUser, body: Row) {
    return this.service.attachTag(user, body);
  }

  detachTag(user: CurrentUser, body: Row) {
    return this.service.detachTag(user, body);
  }

  favorites(user: CurrentUser, query: PageQuery) {
    return this.service.favorites(user, query);
  }

  toggleFavorite(user: CurrentUser, body: Row) {
    return this.service.toggleFavorite(user, body);
  }

  links(user: CurrentUser, query: TargetQuery) {
    return this.service.links(user, query);
  }

  addLink(user: CurrentUser, body: Row) {
    return this.service.addLink(user, body);
  }

  removeLink(user: CurrentUser, body: Row) {
    return this.service.removeLink(user, body);
  }
}
