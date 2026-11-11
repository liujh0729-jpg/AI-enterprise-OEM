import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;
const TERMINAL = ['DONE', 'CANCELED'];
const STATUS_LABELS: Record<string, string> = {
  TODO: '待开始',
  DOING: '进行中',
  REVIEW: '待验收',
};
/** 项目的中档叫 MEDIUM，任务中心统一叫 NORMAL，避免列表出现裸枚举。 */
const PRIORITY_MAP: Record<string, string> = {
  LOW: 'LOW',
  MEDIUM: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
};

/** 项目管理：指派给本人且未终态的 PjTask。 */
export function projectSource(prisma: PrismaService): TaskSource {
  return {
    key: 'pj',
    label: '项目管理',
    category: 'task',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const rows = await prisma.pjTask.findMany({
        where: {
          assigneeId: user.userId,
          status: { notIn: TERMINAL },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'desc' }],
        take: options?.full ? undefined : LIMIT,
      });
      return rows.map((row) => ({
        assigneeUserId: user.userId,
        source: 'pj',
        sourceId: `pj-${row.id}`,
        title: row.title,
        description: row.description.slice(0, 500),
        link: '/project',
        category: 'task',
        priority: PRIORITY_MAP[row.priority] || 'NORMAL',
        dueAt: row.dueDate || null,
        createdBy: row.createdBy,
        sourceStatus: row.status,
        sourceStatusLabel: STATUS_LABELS[row.status] || row.status,
      }));
    },
  };
}
