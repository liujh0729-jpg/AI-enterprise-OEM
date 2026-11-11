import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;
const KIND_LABELS: Record<string, string> = { DAILY: '日报', WEEKLY: '周报' };

/** OKR：待提交汇报、待承接目标、待打分，三者都是「他人/系统指派到本人」的待办。 */
export function okrSource(prisma: PrismaService): TaskSource {
  return {
    key: 'okr',
    label: 'OKR',
    category: 'report',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const take = options?.full ? undefined : LIMIT;
      const [reports, scores, objectives] = await Promise.all([
        prisma.okrReport.findMany({
          where: { memberUserId: user.userId, status: 'DRAFT' },
          orderBy: { id: 'desc' },
          take,
        }),
        prisma.okrScore.findMany({
          where: { reviewerUserId: user.userId, status: 'DRAFT' },
          orderBy: { id: 'desc' },
          take,
        }),
        prisma.okrObjective.findMany({
          where: {
            ownerMemberUserId: user.userId,
            status: 'ACTIVE',
            assignerUserId: { not: '' },
            progress: { lte: 0 },
          },
          orderBy: { id: 'desc' },
          take,
        }),
      ]);
      const drafts: TaskDraft[] = reports.map((row) => ({
        assigneeUserId: user.userId,
        source: 'okr',
        sourceId: `rep-${row.id}`,
        title: `${KIND_LABELS[row.kind] || '汇报'}待提交 · ${row.periodKey}`,
        description: '按周期填写并提交汇报，未提交不会计入考核。',
        link: '/okr?tab=reports',
        category: 'report',
        createdBy: row.ownerUserId,
        dueAt: null,
        sourceStatus: row.status,
        sourceStatusLabel: '待提交',
      }));
      drafts.push(
        ...scores.map((row) => ({
          assigneeUserId: user.userId,
          source: 'okr',
          sourceId: `score-${row.id}`,
          title: 'OKR 评分待完成',
          description: `周期 #${row.cycleId} 的成员评分尚未提交。`,
          link: '/okr?tab=stats',
          category: 'report',
          sourceStatus: row.status,
          sourceStatusLabel: '待打分',
        })),
      );
      drafts.push(
        ...objectives.map((row) => ({
          assigneeUserId: user.userId,
          source: 'okr',
          sourceId: `obj-${row.id}`,
          title: `目标待承接：${row.title}`,
          description: row.description.slice(0, 500),
          link: '/okr?tab=objectives',
          category: 'task',
          createdBy: row.assignerUserId,
          sourceStatus: row.status,
          sourceStatusLabel: '待承接',
        })),
      );
      return drafts;
    },
  };
}
