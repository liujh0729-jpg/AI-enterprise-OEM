import type { CurrentUser } from '../../auth/current-user';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';
import type { OperationRiskService } from '../../growth/operation-risk.service';

/**
 * 经营异常（P4-6）：任务不由源 collect，而是扫描后 push 派发（幂等锚＝异常实体）；
 * 这里只提供「关闭前复核」：办结时按当前库表再扫一次，异常还在就拒绝关闭。
 */
export function riskSource(
  risks: () => OperationRiskService | undefined,
): TaskSource {
  return {
    key: 'risk',
    label: '经营异常',
    category: 'matter',
    push: true,
    async collect(
      _user: CurrentUser,
      _options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      return [];
    },
    async recheck(draft) {
      const service = risks();
      if (!service) return { cleared: true, reason: '' };
      return service.recheck(
        { orgType: draft.orgType, orgUserId: draft.orgUserId },
        draft.sourceId,
      );
    },
  };
}
