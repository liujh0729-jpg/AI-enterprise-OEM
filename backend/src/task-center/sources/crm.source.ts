import { CRM_FORM_TYPE_LABELS } from '@enterprise/contracts';
import type { CurrentUser } from '../../auth/current-user';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;

/** CRM：待我审批 + 我名下逾期回款计划。 */
export function crmSource(prisma: PrismaService): TaskSource {
  return {
    key: 'crm',
    label: 'CRM',
    category: 'approval',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      const take = options?.full ? undefined : LIMIT;
      const [approvalTasks, overduePlans] = await Promise.all([
        prisma.crmApprovalTask.findMany({
          where: { approverId: user.userId, status: 'PENDING' },
          orderBy: { id: 'asc' },
          take,
        }),
        prisma.crmPaymentPlan.findMany({
          where: {
            ownerUserId: user.userId,
            status: { not: 'DONE' },
            planEndAt: { lt: new Date() },
          },
          orderBy: { planEndAt: 'asc' },
          take,
        }),
      ]);
      const instances = approvalTasks.length
        ? await prisma.crmApprovalInstance.findMany({
            where: {
              id: { in: [...new Set(approvalTasks.map((t) => t.instanceId))] },
            },
            select: {
              id: true,
              formType: true,
              targetId: true,
              submitter: true,
            },
          })
        : [];
      const instanceMap = new Map(instances.map((row) => [row.id, row]));
      const drafts: TaskDraft[] = approvalTasks.map((task) => {
        const instance = instanceMap.get(task.instanceId);
        const formTypeLabel = instance
          ? CRM_FORM_TYPE_LABELS[instance.formType] || 'CRM 审批'
          : 'CRM 审批';
        return {
          assigneeUserId: user.userId,
          source: 'crm',
          sourceId: `crm-appr-${task.id}`,
          title: `${formTypeLabel}待审批`,
          description: [
            task.nodeName || '',
            instance?.submitter ? `提交人：${instance.submitter}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          link: `/crm?tab=approvals&id=${task.instanceId}`,
          category: 'approval',
          createdBy: instance?.submitter ?? '',
          sourceStatus: task.status,
          sourceStatusLabel: task.nodeName || '待审批',
        };
      });
      drafts.push(
        ...overduePlans.map((plan) => ({
          assigneeUserId: user.userId,
          source: 'crm',
          sourceId: `crm-plan-${plan.id}`,
          title: `回款计划逾期：${plan.name}`,
          description: `计划回款 ${Number(plan.planAmount).toFixed(2)} 元，请尽快跟进。`,
          link: '/crm?tab=payments',
          category: 'matter',
          priority: 'HIGH',
          dueAt: plan.planEndAt,
          sourceStatus: plan.status,
          sourceStatusLabel: plan.status === 'PARTIAL' ? '部分回款' : '待回款',
        })),
      );
      return drafts;
    },
  };
}
