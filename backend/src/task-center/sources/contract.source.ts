import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;

/** 签约：服务商侧「待确认」的合同（确认动作在 providerUserId 名下）。 */
export function contractSource(prisma: PrismaService): TaskSource {
  return {
    key: 'contract',
    label: '签约',
    category: 'matter',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const rows = await prisma.contract.findMany({
        where: { providerUserId: user.userId, status: 'PENDING' },
        orderBy: { id: 'desc' },
        take: options?.full ? undefined : LIMIT,
      });
      return rows.map((row) => ({
        assigneeUserId: user.userId,
        source: 'contract',
        sourceId: `ct-${row.id}`,
        title: `${row.enterpriseName || row.providerOrg || '合同'} 签约待确认`,
        description: `${row.contractNo} · ${row.serviceType}`,
        link: '/contracts',
        category: 'matter',
        priority: 'HIGH',
        sourceStatus: row.status,
        sourceStatusLabel: '待确认',
      }));
    },
  };
}
