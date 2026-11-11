import type { CurrentUser } from '../../auth/current-user';
import type { IdentityService } from '../../identity/identity.service';
import type { TaxService } from '../../tax/tax.service';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';

const LIMIT = 200;
/** 非终态即待办：与驾驶舱「我的待办」申报卡同一口径（FILED/PAID/REJECTED 为终态）。 */
const PENDING = ['DRAFT', 'SUBMITTED', 'CHECKING'];
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿填写',
  SUBMITTED: 'AI处理完成 · 待财务专员确认',
  CHECKING: '待财务专员审核',
};

/**
 * 财税服务：复用申报单身份域列表（`listDeclarations` 与统计卡 `declarationStats`
 * 同一 `scope`），未终态申报单即当前账号的待办。申报计划（DUE）在财税页办理，不计入此卡。
 */
export function taxSource(
  tax: TaxService,
  identity: IdentityService,
): TaskSource {
  return {
    key: 'tax',
    label: '财税服务',
    category: 'matter',
    async collect(
      user: CurrentUser,
      options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      if ((await identity.currentIdentity(user)) === 'PLATFORM_ADMIN') {
        return [];
      }
      const rows = await tax.listDeclarations(user);
      const pending = rows.filter((row) => PENDING.includes(row.status));
      const limited = options?.full ? pending : pending.slice(0, LIMIT);
      return limited.map((row) => ({
        assigneeUserId: user.userId,
        source: 'tax',
        sourceId: `tax-${row.id}`,
        title: row.title || row.declNo || `申报单 #${row.id}`,
        description: [row.declNo, row.period ? `所属期 ${row.period}` : '']
          .filter(Boolean)
          .join(' · '),
        link: '/tax',
        category: 'matter',
        sourceStatus: row.status,
        sourceStatusLabel: STATUS_LABELS[row.status] || row.status,
      }));
    },
  };
}
