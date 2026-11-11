import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;

/** 平台审核：仅平台管理员可见的服务商备案 / 发布审核待办队列。 */
export function platformSource(prisma: PrismaService): TaskSource {
  return {
    key: 'platform',
    label: '平台审核',
    category: 'audit',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      if (!user.isAdmin()) return [];
      const take = options?.full ? undefined : LIMIT;
      const [applications, workflows] = await Promise.all([
        prisma.providerApplication.findMany({
          where: { status: 'PENDING' },
          orderBy: { id: 'desc' },
          take,
        }),
        prisma.communityWorkflow.findMany({
          where: { status: 'PENDING' },
          orderBy: { id: 'desc' },
          take,
        }),
      ]);
      const drafts: TaskDraft[] = applications.map((row) => ({
        assigneeUserId: user.userId,
        source: 'platform',
        sourceId: `pa-${row.id}`,
        title: `服务商备案待审核：${row.orgName}`,
        description: `${row.providerType} · ${row.contactName || row.contactPhone}`,
        link: '/admin/provider-applications',
        category: 'audit',
        createdBy: row.userId,
        sourceStatus: row.status,
        sourceStatusLabel: '待审核',
      }));
      drafts.push(
        ...workflows.map((row) => ({
          assigneeUserId: user.userId,
          source: 'platform',
          sourceId: `cw-${row.id}`,
          title: `发布审核待处理：${row.title}`,
          description: `${row.ownerName || row.ownerUserId} · ${row.category}`,
          link: '/admin/community',
          category: 'audit',
          createdBy: row.ownerUserId,
          sourceStatus: row.status,
          sourceStatusLabel: '待审核',
        })),
      );
      return drafts;
    },
  };
}
