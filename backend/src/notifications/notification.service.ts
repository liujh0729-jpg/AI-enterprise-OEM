import { NOTIFICATION_CATEGORY_LABELS } from '@enterprise/contracts';
import { pageOf, pageParam } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import type { SnsService } from '../sns/sns.service';

export type NotifyInput = {
  category: string;
  title: string;
  body?: string;
  link?: string;
  level?: 'info' | 'warning' | 'error';
  entityType?: string;
  entityId?: string | number;
};

const CATEGORY_SET = new Set(Object.keys(NOTIFICATION_CATEGORY_LABELS));

/** 全站系统消息：唯一写入口，业务模块只调 notify / notifyMany。 */
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    /** AIworkin 社交（SNS）通知：只读合并进铃铛，SNS 不可用时降级为本站消息。 */
    private readonly sns?: SnsService,
  ) {}

  async notify(userId: string, input: NotifyInput) {
    if (!userId) return null;
    return this.prisma.notification.create({
      data: {
        userId,
        category: CATEGORY_SET.has(input.category)
          ? input.category
          : 'platform',
        title: input.title.slice(0, 200),
        body: (input.body || '').slice(0, 4000),
        link: (input.link || '').slice(0, 500),
        level: input.level || 'info',
        entityType: (input.entityType || '').slice(0, 32),
        entityId: String(input.entityId ?? '').slice(0, 64),
      },
    });
  }

  /** 批量通知：去重、忽略空账号；单条失败不影响其他收件人。 */
  async notifyMany(userIds: string[], input: NotifyInput) {
    const unique = [...new Set(userIds.filter(Boolean))];
    await Promise.all(
      unique.map((userId) => this.notify(userId, input).catch(() => null)),
    );
    return unique.length;
  }

  private view(row: {
    id: number;
    category: string;
    level: string;
    title: string;
    body: string;
    link: string;
    entityType: string;
    entityId: string;
    readAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      category: row.category,
      categoryLabel: NOTIFICATION_CATEGORY_LABELS[row.category] || row.category,
      level: row.level,
      title: row.title,
      body: row.body,
      link: row.link,
      entityType: row.entityType,
      entityId: row.entityId,
      read: Boolean(row.readAt),
      createdAt: row.createdAt.toISOString(),
      source: 'local',
      externalId: '',
    };
  }

  /** AIworkin 社交通知：站点不可用时只降级本站消息，不把整个铃铛拖垮。 */
  private async snsRows(userId: string) {
    if (!this.sns) return null;
    try {
      return { ...(await this.sns.notifications(userId)), available: true };
    } catch {
      return { rows: [], unread: 0, available: false };
    }
  }

  async list(
    user: CurrentUser,
    query: {
      page?: number | string;
      pageSize?: number | string;
      category?: string;
      unreadOnly?: boolean | string;
    },
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const unreadOnly =
      query.unreadOnly === true ||
      query.unreadOnly === 'true' ||
      query.unreadOnly === '1';
    const where = {
      userId: user.userId,
      ...(query.category ? { category: query.category } : {}),
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const sns = await this.snsRows(user.userId);
    const snsList = (sns?.rows || []).filter((row) => !unreadOnly || !row.read);
    if (query.category === 'sns') {
      return pageOf(
        snsList.slice(offset, offset + pageSize),
        snsList.length,
        page,
        pageSize,
      );
    }
    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const local = rows.map((row) => this.view(row));
    if (query.category || page > 1 || !snsList.length) {
      return pageOf(local, total, page, pageSize);
    }
    // SNS 通知只在第一页合并：两站编号体系不同，无法做稳定的跨源游标分页。
    const merged = [...snsList, ...local]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, pageSize);
    return pageOf(merged, total + snsList.length, page, pageSize);
  }

  async unread(user: CurrentUser) {
    const [count, rows, sns] = await Promise.all([
      this.prisma.notification.count({
        where: { userId: user.userId, readAt: null },
      }),
      this.prisma.notification.findMany({
        where: { userId: user.userId, readAt: null },
        orderBy: { id: 'desc' },
        take: 8,
      }),
      this.snsRows(user.userId),
    ]);
    const local = rows.map((row) => this.view(row));
    const external = (sns?.rows || []).filter((row) => !row.read);
    const items = [...external, ...local]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 8);
    return {
      count: count + external.length,
      items,
      sns: {
        available: sns?.available ?? false,
        unread: external.length,
      },
    };
  }

  async read(user: CurrentUser, id: number) {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '消息不存在');
    const updated = row.readAt
      ? row
      : await this.prisma.notification.update({
          where: { id: row.id },
          data: { readAt: new Date() },
        });
    return this.view(updated);
  }

  async readAll(user: CurrentUser, category?: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId: user.userId,
        readAt: null,
        ...(category ? { category } : {}),
      },
      data: { readAt: new Date() },
    });
    let external = 0;
    if (this.sns && (!category || category === 'sns')) {
      try {
        external = (await this.sns.readAll(user.userId))?.updated || 0;
      } catch {
        // SNS 不可用时只清本站消息
      }
    }
    return { updated: result.count + external };
  }

  /** 清理超过保留期的消息（由列表读取时按天最多清一次，不额外起调度）。 */
  async prune(user: CurrentUser, retentionDays = 180) {
    const before = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    await this.prisma.notification.deleteMany({
      where: { userId: user.userId, createdAt: { lt: before } },
    });
  }
}
