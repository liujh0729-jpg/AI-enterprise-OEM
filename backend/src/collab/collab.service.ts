import {
  sanitizeRichTextHtml,
  plainTextToRichHtml,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { NotificationService } from '../notifications/notification.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageParam, pageOf, text } from '../common/api';
import { clip, iso } from '../hrm/hrm.helpers';

type Row = Record<string, unknown>;
type TargetQuery = { targetType: string; targetId: string };

const DEFAULT_COMMENT_LIMIT = 4000;
const MENTION_LIMIT = 20;

/** 评论富文本落库前统一清洗：只留白名单标签，纯文本转义后包成段落。 */
export function commentHtmlOf(content: string, contentHtml: string): string {
  const raw = String(contentHtml || '').trim();
  if (!raw) return plainTextToRichHtml(content);
  return sanitizeRichTextHtml(raw);
}

/** 只收 http(s)：javascript:/data: 之类的链接不允许进入协作卡片。 */
export function safeLinkUrl(raw: unknown): string {
  const value = text(raw).trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().slice(0, 500);
  } catch {
    return '';
  }
}

/** 通知跳转：能定位到模块的按模块走（带上具体页签），未知对象回落到协作入口。 */
export function collabLinkOf(targetType: string, targetId: string): string {
  const anchor = `type=${encodeURIComponent(targetType)}&id=${encodeURIComponent(targetId)}`;
  switch (targetType) {
    case 'TASK':
      return `/project?tab=tasks&${anchor}`;
    case 'PROJECT':
      return `/project?tab=projects&${anchor}`;
    case 'MILESTONE':
      return `/project?tab=projects&${anchor}`;
    case 'ORDER':
    case 'INVOICE':
      return `/erp?${anchor}`;
    case 'CANDIDATE':
      return `/recruit?${anchor}`;
    case 'CUSTOMER':
      return `/crm?${anchor}`;
    default:
      return `/collab?${anchor}`;
  }
}

/**
 * 通用协作底座（方案 §5.2）：评论 / @提及 / 标签 / 收藏 / 资源链接。
 * 所有行按 (orgType, orgUserId) 组织键隔离；多态目标只校验非空，不反向依赖业务表，
 * 因此任意模块接入只需传 targetType + targetId。对外分享复用 `Share_*`（PublicShare）。
 */
export class CollabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly notifications: NotificationService,
  ) {}

  private async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private targetOf(body: Row): TargetQuery {
    const targetType = clip(body.targetType, 16).toUpperCase();
    const targetId = clip(body.targetId, 64);
    if (!targetType || !targetId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少协作对象标识');
    }
    return { targetType, targetId };
  }

  // ---------- 评论 / @ ----------

  async comments(
    user: CurrentUser,
    query: TargetQuery & { page?: number; pageSize?: number },
  ) {
    const org = await this.org(user);
    const target = this.targetOf(query);
    const args = pageParam(query.page, query.pageSize);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      targetType: target.targetType,
      targetId: target.targetId,
      deleted: false,
    };
    const [total, rows] = await Promise.all([
      this.prisma.collabComment.count({ where }),
      this.prisma.collabComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.pageSize,
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const [names, mentions] = await Promise.all([
      this.scope.names(rows.map((row) => row.authorId)),
      ids.length
        ? this.prisma.collabMention.findMany({
            where: { commentId: { in: ids } },
            select: { commentId: true, mentionedUserId: true },
          })
        : Promise.resolve([]),
    ]);
    const mentionMap = new Map<number, string[]>();
    for (const row of mentions) {
      const list = mentionMap.get(row.commentId) || [];
      list.push(row.mentionedUserId);
      mentionMap.set(row.commentId, list);
    }
    const list = rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      parentId: row.parentId,
      content: row.content,
      contentHtml: row.contentHtml,
      authorId: row.authorId,
      authorName: names.get(row.authorId) || row.authorId,
      mentions: mentionMap.get(row.id) || [],
      canDelete: org.isAdmin || row.authorId === org.actorId,
      createdAt: iso(row.createdAt),
    }));
    return pageOf(list, total, args.page, args.pageSize);
  }

  async createComment(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const target = this.targetOf(body);
    const content = clip(body.content, DEFAULT_COMMENT_LIMIT).trim();
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '评论内容不能为空');
    }
    const parentId = Math.max(0, Math.trunc(Number(body.parentId) || 0));
    if (parentId) {
      const parent = await this.prisma.collabComment.findFirst({
        where: {
          id: parentId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          targetType: target.targetType,
          targetId: target.targetId,
          deleted: false,
        },
        select: { id: true, authorId: true },
      });
      if (!parent) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '被回复的评论不存在或已删除',
        );
      }
    }

    const members = new Set(await this.scope.memberUserIds(org));
    const requested = Array.isArray(body.mentions)
      ? body.mentions.map((id) => clip(id, 64)).filter(Boolean)
      : [];
    const mentioned = [...new Set(requested)]
      .filter((id) => id !== org.actorId && members.has(id))
      .slice(0, MENTION_LIMIT);

    const row = await this.prisma.collabComment.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        targetType: target.targetType,
        targetId: target.targetId,
        parentId,
        content,
        contentHtml: commentHtmlOf(content, text(body.contentHtml)),
        authorId: org.actorId,
      },
    });
    if (mentioned.length) {
      await this.prisma.collabMention.createMany({
        data: mentioned.map((mentionedUserId) => ({
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          commentId: row.id,
          targetType: target.targetType,
          targetId: target.targetId,
          mentionedUserId,
          authorId: org.actorId,
        })),
        skipDuplicates: true,
      });
      // 通知是辅助链路：失败不影响评论本身，被提及人仍能在协作面板看到未读。
      await this.notifications
        .notifyMany(mentioned, {
          category: 'collab',
          level: 'info',
          title: '有人 @ 了你',
          body: content.slice(0, 200),
          link: collabLinkOf(target.targetType, target.targetId),
          entityType: 'collab_comment',
          entityId: row.id,
        })
        .catch(() => 0);
    }
    if (parentId) {
      const parent = await this.prisma.collabComment.findUnique({
        where: { id: parentId },
        select: { authorId: true },
      });
      const replyTo = parent?.authorId || '';
      if (replyTo && replyTo !== org.actorId && !mentioned.includes(replyTo)) {
        await this.notifications
          .notify(replyTo, {
            category: 'collab',
            level: 'info',
            title: '你的评论有了回复',
            body: content.slice(0, 200),
            link: collabLinkOf(target.targetType, target.targetId),
            entityType: 'collab_comment',
            entityId: row.id,
          })
          .catch(() => null);
      }
    }

    const names = await this.scope.names([org.actorId]);
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      parentId: row.parentId,
      content: row.content,
      contentHtml: row.contentHtml,
      authorId: row.authorId,
      authorName: names.get(row.authorId) || row.authorId,
      mentions: mentioned,
      canDelete: true,
      createdAt: iso(row.createdAt),
    };
  }

  async removeComment(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Math.trunc(Number(body.id) || 0);
    const row = await this.prisma.collabComment.findFirst({
      where: {
        id,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        deleted: false,
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '评论不存在或已删除');
    if (!org.isAdmin && row.authorId !== org.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己发表的评论',
      );
    }
    await this.prisma.collabComment.update({
      where: { id },
      data: { deleted: true, deletedBy: org.actorId },
    });
    // 提及收件箱只展示有效评论：软删后同步清掉该评论的提及，避免点开是空内容。
    await this.prisma.collabMention.deleteMany({ where: { commentId: id } });
    return { id };
  }

  async mentions(
    user: CurrentUser,
    query: { page?: number; pageSize?: number; unreadOnly?: string },
  ) {
    const org = await this.org(user);
    const args = pageParam(query.page, query.pageSize);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      mentionedUserId: org.actorId,
      ...(String(query.unreadOnly || '') === '1' ? { read: false } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.collabMention.count({ where }),
      this.prisma.collabMention.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.pageSize,
      }),
    ]);
    const commentIds = rows.map((row) => row.commentId);
    const comments = commentIds.length
      ? await this.prisma.collabComment.findMany({
          where: { id: { in: commentIds }, deleted: false },
          select: { id: true, content: true, authorId: true },
        })
      : [];
    const byId = new Map(comments.map((row) => [row.id, row]));
    const authorNames = await this.scope.names([
      ...rows.map((row) => row.authorId),
      ...comments.map((row) => row.authorId),
    ]);
    const list = rows
      .filter((row) => byId.has(row.commentId))
      .map((row) => {
        const comment = byId.get(row.commentId)!;
        return {
          id: row.id,
          commentId: row.commentId,
          targetType: row.targetType,
          targetId: row.targetId,
          content: clip(comment.content, 300),
          authorId: comment.authorId,
          authorName: authorNames.get(comment.authorId) || comment.authorId,
          read: row.read,
          createdAt: iso(row.createdAt),
        };
      });
    return pageOf(list, total, args.page, args.pageSize);
  }

  async readMention(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const all = body.all === true;
    const id = Math.trunc(Number(body.id) || 0);
    if (!all && !id) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请指定要标记的提及或选择全部',
      );
    }
    const result = await this.prisma.collabMention.updateMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        mentionedUserId: org.actorId,
        read: false,
        ...(all ? {} : { id }),
      },
      data: { read: true },
    });
    return { updated: result.count };
  }

  // ---------- 标签 ----------

  async tags(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.collabTag.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: iso(row.createdAt),
    }));
  }

  async saveTag(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Math.trunc(Number(body.id) || 0);
    const name = clip(body.name, 32).trim();
    const color = clip(body.color, 16).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '标签名不能为空');
    if (id) {
      const owned = await this.prisma.collabTag.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        select: { id: true },
      });
      if (!owned)
        throw new BusinessException(ErrorCode.NOT_FOUND, '标签不存在');
    }
    const duplicate = await this.prisma.collabTag.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        name,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同名标签已存在');
    }
    const row = id
      ? await this.prisma.collabTag.update({
          where: { id },
          data: { name, color },
        })
      : await this.prisma.collabTag.create({
          data: { orgType: org.orgType, orgUserId: org.orgUserId, name, color },
        });
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: iso(row.createdAt),
    };
  }

  async removeTag(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Math.trunc(Number(body.id) || 0);
    const row = await this.prisma.collabTag.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      select: { id: true },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '标签不存在');
    await this.prisma.collabTaggable.deleteMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, tagId: id },
    });
    await this.prisma.collabTag.delete({ where: { id } });
    return { id };
  }

  async objectTags(user: CurrentUser, query: TargetQuery) {
    const org = await this.org(user);
    const target = this.targetOf(query);
    const links = await this.prisma.collabTaggable.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        targetType: target.targetType,
        targetId: target.targetId,
      },
      select: { tagId: true },
    });
    const ids = links.map((row) => row.tagId);
    if (!ids.length) return [];
    const tags = await this.prisma.collabTag.findMany({
      where: {
        id: { in: ids },
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
      orderBy: { id: 'asc' },
    });
    return tags.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: iso(row.createdAt),
    }));
  }

  async attachTag(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const target = this.targetOf(body);
    const tagId = Math.trunc(Number(body.tagId) || 0);
    const tag = await this.prisma.collabTag.findFirst({
      where: { id: tagId, orgType: org.orgType, orgUserId: org.orgUserId },
      select: { id: true },
    });
    if (!tag) throw new BusinessException(ErrorCode.NOT_FOUND, '标签不存在');
    const result = await this.prisma.collabTaggable.createMany({
      data: [
        {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          tagId,
          targetType: target.targetType,
          targetId: target.targetId,
        },
      ],
      skipDuplicates: true,
    });
    return { attached: result.count };
  }

  async detachTag(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const target = this.targetOf(body);
    const tagId = Math.trunc(Number(body.tagId) || 0);
    const result = await this.prisma.collabTaggable.deleteMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        tagId,
        targetType: target.targetType,
        targetId: target.targetId,
      },
    });
    return { detached: result.count };
  }

  // ---------- 收藏 ----------

  async favorites(
    user: CurrentUser,
    query: { page?: number; pageSize?: number },
  ) {
    const org = await this.org(user);
    const args = pageParam(query.page, query.pageSize);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      userId: org.actorId,
    };
    const [total, rows] = await Promise.all([
      this.prisma.collabFavorite.count({ where }),
      this.prisma.collabFavorite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.pageSize,
      }),
    ]);
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        title: row.title,
        createdAt: iso(row.createdAt),
      })),
      total,
      args.page,
      args.pageSize,
    );
  }

  async toggleFavorite(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const target = this.targetOf(body);
    const existing = await this.prisma.collabFavorite.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        userId: org.actorId,
        targetType: target.targetType,
        targetId: target.targetId,
      },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.collabFavorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.collabFavorite.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        userId: org.actorId,
        targetType: target.targetType,
        targetId: target.targetId,
        title: clip(body.title, 120).trim(),
      },
    });
    return { favorited: true };
  }

  // ---------- 资源链接 ----------

  async links(user: CurrentUser, query: TargetQuery) {
    const org = await this.org(user);
    const target = this.targetOf(query);
    const rows = await this.prisma.collabResourceLink.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        targetType: target.targetType,
        targetId: target.targetId,
      },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.scope.names(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      url: row.url,
      title: row.title,
      kind: row.kind,
      createdBy: names.get(row.createdBy) || row.createdBy,
      createdAt: iso(row.createdAt),
    }));
  }

  async addLink(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const target = this.targetOf(body);
    const url = safeLinkUrl(body.url);
    if (!url) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入 http(s) 链接');
    }
    const kind = ['LINK', 'DOC', 'FILE', 'EXTERNAL'].includes(String(body.kind))
      ? String(body.kind)
      : 'LINK';
    const row = await this.prisma.collabResourceLink.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        targetType: target.targetType,
        targetId: target.targetId,
        url,
        title: clip(body.title, 120).trim(),
        kind,
        createdBy: org.actorId,
      },
    });
    const names = await this.scope.names([org.actorId]);
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      url: row.url,
      title: row.title,
      kind: row.kind,
      createdBy: names.get(row.createdBy) || row.createdBy,
      createdAt: iso(row.createdAt),
    };
  }

  async removeLink(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Math.trunc(Number(body.id) || 0);
    const row = await this.prisma.collabResourceLink.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      select: { id: true },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '链接不存在');
    await this.prisma.collabResourceLink.delete({ where: { id } });
    return { id };
  }
}
