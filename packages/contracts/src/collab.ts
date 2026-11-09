import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 通用协作底座契约（方案 §5.2）：comment / mention / tag / favorite / resource-link。
 * 多态挂载任意业务对象（`targetType + targetId`），组织键沿用 (orgType, orgUserId)；
 * 对外分享复用 §5.8 的 PublicShare（`Share_*`），本域不另建分享表。
 */
export const COLLAB_TARGET_TYPES = [
  "TASK",
  "PROJECT",
  "MILESTONE",
  "INVOICE",
  "ORDER",
  "CANDIDATE",
  "CUSTOMER",
  "CONTRACT",
  "ASSET",
  "PAGE",
  "TICKET",
  "OTHER",
] as const;
export type CollabTargetType = (typeof COLLAB_TARGET_TYPES)[number];

export const COLLAB_LINK_KINDS = ["LINK", "DOC", "FILE", "EXTERNAL"] as const;

export const collabTargetQuerySchema = z.object({
  targetType: z.enum(COLLAB_TARGET_TYPES),
  targetId: z.string().min(1).max(64),
});

export const collabCommentSchema = z.object({
  id: z.number(),
  targetType: z.string(),
  targetId: z.string(),
  parentId: z.number(),
  content: z.string(),
  contentHtml: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  mentions: z.array(z.string()),
  canDelete: z.boolean(),
  createdAt: z.string(),
});

export const createCollabCommentBodySchema = collabTargetQuerySchema.extend({
  content: z.string().min(1).max(4000),
  contentHtml: z.string().max(20000).default(""),
  parentId: z.number().int().min(0).default(0),
  /** 被 @ 的组织成员账号 ID；服务端只保留本组织在册成员。 */
  mentions: z.array(z.string().max(64)).max(20).default([]),
});

export const collabTagSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
});

export const saveCollabTagBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(32),
  color: z.string().max(16).default(""),
});

export const attachCollabTagBodySchema = collabTargetQuerySchema.extend({
  tagId: z.number().int().positive(),
});

export const collabFavoriteSchema = z.object({
  id: z.number(),
  targetType: z.string(),
  targetId: z.string(),
  title: z.string(),
  createdAt: z.string(),
});

export const toggleCollabFavoriteBodySchema = collabTargetQuerySchema.extend({
  title: z.string().max(120).default(""),
});

export const collabLinkSchema = z.object({
  id: z.number(),
  targetType: z.string(),
  targetId: z.string(),
  url: z.string(),
  title: z.string(),
  kind: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const addCollabLinkBodySchema = collabTargetQuerySchema.extend({
  url: z.string().url().max(500),
  title: z.string().max(120).default(""),
  kind: z.enum(COLLAB_LINK_KINDS).default("LINK"),
});

export const collabMentionSchema = z.object({
  id: z.number(),
  commentId: z.number(),
  targetType: z.string(),
  targetId: z.string(),
  content: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
});

export const collabEndpoints = {
  // ---------- 评论 / @ ----------
  Collab_comments: {
    method: "get" as const,
    path: "/enterprise/collab/comments",
    params: z.object({}),
    query: pageQuerySchema.extend({
      targetType: z.enum(COLLAB_TARGET_TYPES),
      targetId: z.string().min(1).max(64),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(collabCommentSchema)),
  },
  Collab_createComment: {
    method: "post" as const,
    path: "/enterprise/collab/comments",
    params: z.object({}),
    query: emptyQuery,
    body: createCollabCommentBodySchema,
    response: envelope(collabCommentSchema),
  },
  Collab_removeComment: {
    method: "post" as const,
    path: "/enterprise/collab/comments/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Collab_mentions: {
    method: "get" as const,
    path: "/enterprise/collab/mentions",
    params: z.object({}),
    query: pageQuerySchema.extend({ unreadOnly: z.enum(["0", "1"]).optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(collabMentionSchema)),
  },
  Collab_readMention: {
    method: "post" as const,
    path: "/enterprise/collab/mentions/read",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive().optional(), all: z.boolean().default(false) }),
    response: envelope(z.object({ updated: z.number() })),
  },
  // ---------- 标签 ----------
  Collab_tags: {
    method: "get" as const,
    path: "/enterprise/collab/tags",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(collabTagSchema)),
  },
  Collab_saveTag: {
    method: "post" as const,
    path: "/enterprise/collab/tags/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveCollabTagBodySchema,
    response: envelope(collabTagSchema),
  },
  Collab_removeTag: {
    method: "post" as const,
    path: "/enterprise/collab/tags/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Collab_objectTags: {
    method: "get" as const,
    path: "/enterprise/collab/tags/object",
    params: z.object({}),
    query: collabTargetQuerySchema,
    body: z.undefined(),
    response: envelope(z.array(collabTagSchema)),
  },
  Collab_attachTag: {
    method: "post" as const,
    path: "/enterprise/collab/tags/attach",
    params: z.object({}),
    query: emptyQuery,
    body: attachCollabTagBodySchema,
    response: envelope(z.object({ attached: z.number() })),
  },
  Collab_detachTag: {
    method: "post" as const,
    path: "/enterprise/collab/tags/detach",
    params: z.object({}),
    query: emptyQuery,
    body: attachCollabTagBodySchema,
    response: envelope(z.object({ detached: z.number() })),
  },
  // ---------- 收藏 ----------
  Collab_favorites: {
    method: "get" as const,
    path: "/enterprise/collab/favorites",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(collabFavoriteSchema)),
  },
  Collab_toggleFavorite: {
    method: "post" as const,
    path: "/enterprise/collab/favorites/toggle",
    params: z.object({}),
    query: emptyQuery,
    body: toggleCollabFavoriteBodySchema,
    response: envelope(z.object({ favorited: z.boolean() })),
  },
  // ---------- 资源链接 ----------
  Collab_links: {
    method: "get" as const,
    path: "/enterprise/collab/links",
    params: z.object({}),
    query: collabTargetQuerySchema,
    body: z.undefined(),
    response: envelope(z.array(collabLinkSchema)),
  },
  Collab_addLink: {
    method: "post" as const,
    path: "/enterprise/collab/links",
    params: z.object({}),
    query: emptyQuery,
    body: addCollabLinkBodySchema,
    response: envelope(collabLinkSchema),
  },
  Collab_removeLink: {
    method: "post" as const,
    path: "/enterprise/collab/links/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
};
