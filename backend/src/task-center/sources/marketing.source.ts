import type { CurrentUser } from '../../auth/current-user';
import type { IdentityService } from '../../identity/identity.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;
/** 非终态即待办：与驾驶舱「我的待办」营销卡同一口径（DONE 为终态）。 */
const PENDING = ['OPEN', 'MATCHED', 'CONNECTED'];
const STATUS_LABELS: Record<string, string> = {
  OPEN: '已发布 · 待对接',
  MATCHED: '已匹配 · 对接中',
  CONNECTED: '已对接',
};

/**
 * 营销服务：直接复用板块的身份域列表（`list` 与统计卡 `listStats` 同一 `listScope`），
 * 未终态需求即当前账号的待办，保证驾驶舱板块卡与 `/tasks` 的 `bySource` 数字一致。
 */
export function marketingSource(
  marketing: MarketingService,
  identity: IdentityService,
): TaskSource {
  return {
    key: 'marketing',
    label: '营销服务',
    category: 'matter',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      // 平台管理员不承办业务板块（驾驶舱也不渲染板块卡），避免把全量单据灌进个人任务。
      if ((await identity.currentIdentity(user)) === 'PLATFORM_ADMIN') {
        return [];
      }
      const rows = await marketing.list(user);
      const pending = rows.filter((row) => PENDING.includes(row.status));
      const limited = options?.full ? pending : pending.slice(0, LIMIT);
      return limited.map((row) => ({
        assigneeUserId: user.userId,
        source: 'marketing',
        sourceId: `mkt-${row.id}`,
        title: row.title || `营销需求 #${row.id}`,
        description: [row.orderNo, row.deadline ? `截止 ${row.deadline}` : '']
          .filter(Boolean)
          .join(' · '),
        link: '/marketing',
        category: 'matter',
        createdBy: row.createdBy,
        dueAt: row.deadline || null,
        sourceStatus: row.status,
        sourceStatusLabel: STATUS_LABELS[row.status] || row.status,
      }));
    },
  };
}
