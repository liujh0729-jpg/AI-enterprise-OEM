import type { CurrentUser } from '../../auth/current-user';
import type { IdentityService } from '../../identity/identity.service';
import type { LogisticsService } from '../../logistics/logistics.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;
/** 非终态即待办：与驾驶舱「我的待办」物流卡同一口径（DELIVERED 为终态）。 */
const PENDING = ['OPEN', 'PENDING', 'IN_TRANSIT', 'EXCEPTION'];
const STATUS_LABELS: Record<string, string> = {
  OPEN: '已发布 · 待接收',
  PENDING: '待揽收',
  IN_TRANSIT: '运输中',
  EXCEPTION: '异常',
};

/**
 * 物流服务：复用板块身份域列表（`list` 与统计卡 `listStats` 同一 `listScope`，
 * 含服务商公开池与 canAcceptPool 门控），未终态工单即当前账号的待办。
 */
export function logisticsSource(
  logistics: LogisticsService,
  identity: IdentityService,
): TaskSource {
  return {
    key: 'logistics',
    label: '物流服务',
    category: 'matter',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      if ((await identity.currentIdentity(user)) === 'PLATFORM_ADMIN') {
        return [];
      }
      const rows = await logistics.list(user);
      const pending = rows.filter((row) => PENDING.includes(row.status));
      const limited = options?.full ? pending : pending.slice(0, LIMIT);
      return limited.map((row) => ({
        assigneeUserId: user.userId,
        source: 'logistics',
        sourceId: `log-${row.id}`,
        title: row.title || `物流需求 #${row.id}`,
        description: [row.orderNo, row.deadline ? `截止 ${row.deadline}` : '']
          .filter(Boolean)
          .join(' · '),
        link: '/logistics',
        category: 'matter',
        createdBy: row.createdBy,
        dueAt: row.deadline || null,
        sourceStatus: row.status,
        sourceStatusLabel: STATUS_LABELS[row.status] || row.status,
      }));
    },
  };
}
