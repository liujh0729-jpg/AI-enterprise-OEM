import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 通用协作底座 API（方案 §5.2）：评论/@ 提及/标签/收藏/资源链接。
 * 目标用 (targetType, targetId) 多态标识，任何业务对象都能直接挂载。
 */

export type CollabComment = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Collab_comments">["data"]
>["list"][number];

export type CollabTag = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Collab_tags">["data"]
>[number];

export type CollabLink = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Collab_links">["data"]
>[number];

export type CollabFavorite = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Collab_favorites">["data"]
>["list"][number];

export type CollabMention = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Collab_mentions">["data"]
>["list"][number];

export const collabApi = {
  comments: endpoint(endpoints.Collab_comments),
  createComment: endpoint(endpoints.Collab_createComment),
  removeComment: endpoint(endpoints.Collab_removeComment),
  mentions: endpoint(endpoints.Collab_mentions),
  readMention: endpoint(endpoints.Collab_readMention),
  tags: endpoint(endpoints.Collab_tags),
  saveTag: endpoint(endpoints.Collab_saveTag),
  removeTag: endpoint(endpoints.Collab_removeTag),
  objectTags: endpoint(endpoints.Collab_objectTags),
  attachTag: endpoint(endpoints.Collab_attachTag),
  detachTag: endpoint(endpoints.Collab_detachTag),
  favorites: endpoint(endpoints.Collab_favorites),
  toggleFavorite: endpoint(endpoints.Collab_toggleFavorite),
  links: endpoint(endpoints.Collab_links),
  addLink: endpoint(endpoints.Collab_addLink),
  removeLink: endpoint(endpoints.Collab_removeLink),
};
