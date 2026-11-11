import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;

/** 客服：指派给我、或排队待认领（waiting）的访客会话。 */
export function deskSource(prisma: PrismaService): TaskSource {
  return {
    key: 'desk',
    label: '客服',
    category: 'matter',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const rows = await prisma.serviceDeskConversation.findMany({
        where: {
          status: { not: 'closed' },
          OR: [{ assigneeUserId: user.userId }, { status: 'waiting' }],
        },
        orderBy: { lastMessageAt: 'asc' },
        take: options?.full ? undefined : LIMIT,
      });
      return rows.map((row) => ({
        assigneeUserId: user.userId,
        source: 'desk',
        sourceId: `desk-${row.id}`,
        title: row.subject || row.externalUserName || `访客会话 #${row.id}`,
        description:
          row.status === 'waiting'
            ? '访客会话排队中，尚未认领。'
            : '访客会话待回复。',
        link: '/service-desk',
        category: 'matter',
        priority: row.unreadForAgent > 0 ? 'HIGH' : 'NORMAL',
        sourceStatus: row.status,
        sourceStatusLabel: row.status === 'waiting' ? '待认领' : '服务中',
      }));
    },
  };
}
