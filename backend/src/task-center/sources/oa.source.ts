import type { CurrentUser } from '../../auth/current-user';
import { text } from '../../common/api';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

/** 单源单次最多拉这么多，其余到 OA / 内建应用里看完整清单。 */
const LIMIT = 200;

/** OA 审批单 + 内建应用审批：都按「审批人是本人」聚合，账号级不看组织上下文。 */
export function oaSource(prisma: PrismaService): TaskSource {
  return {
    key: 'oa',
    label: 'OA 审批',
    category: 'approval',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const take = options?.full ? undefined : LIMIT;
      const [oaTasks, lcTasks] = await Promise.all([
        prisma.oaTask.findMany({
          where: { approverId: user.userId, status: 'PENDING' },
          orderBy: { id: 'asc' },
          take,
        }),
        prisma.lowCodeApprovalTask.findMany({
          where: { assigneeUserId: user.userId, status: 'PENDING' },
          orderBy: { id: 'asc' },
          take,
        }),
      ]);
      const apps = oaTasks.length
        ? await prisma.oaApplication.findMany({
            where: {
              id: {
                in: [...new Set(oaTasks.map((task) => task.applicationId))],
              },
            },
            select: {
              id: true,
              number: true,
              title: true,
              applicantId: true,
              applicantName: true,
            },
          })
        : [];
      const appMap = new Map(apps.map((app) => [app.id, app]));
      const drafts: TaskDraft[] = oaTasks.map((task) => {
        const app = appMap.get(task.applicationId);
        return {
          assigneeUserId: user.userId,
          source: 'oa',
          sourceId: `oa-${task.id}`,
          title: text(app?.title) || task.nodeName || 'OA 审批单',
          description: [
            `${text(app?.number)} ${task.nodeName || '待审批'}`.trim(),
            app?.applicantName ? `申请人：${app.applicantName}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          link: `/oa?tab=todo&id=${task.applicationId}`,
          category: 'approval',
          createdBy: text(app?.applicantId),
          sourceStatus: task.status,
          sourceStatusLabel: task.nodeName || '待审批',
        };
      });

      if (lcTasks.length) {
        const projects = await prisma.lowCodeProject.findMany({
          where: {
            id: { in: [...new Set(lcTasks.map((task) => task.projectId))] },
          },
          select: { id: true, name: true },
        });
        const nameMap = new Map(projects.map((p) => [p.id, p.name]));
        drafts.push(
          ...lcTasks.map((task) => ({
            assigneeUserId: user.userId,
            source: 'oa',
            sourceId: `lc-${task.id}`,
            title: task.nodeName || '内建应用审批',
            description:
              nameMap.get(task.projectId) || `项目 #${task.projectId}`,
            link: `/lowcode/p/${task.projectId}`,
            category: 'approval',
            sourceStatus: task.status,
            sourceStatusLabel: task.nodeName || '待审批',
          })),
        );
      }
      return drafts;
    },
  };
}
