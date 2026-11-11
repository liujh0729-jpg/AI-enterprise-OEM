import type { CurrentUser } from '../../auth/current-user';
import type { TaskCollectOptions, TaskDraft, TaskSource } from '../task-source';
import type { ChromeAgentService } from '../../rpa/chrome-agent.service';

/**
 * 浏览器代理（docs §8.4）：待确认/需登录的待办由会话引擎主动 push，
 * 这里只提供关闭前复核——确认类看会话是否已离开等待确认，
 * 登录类看之后有没有真正跑通的会话，不以点完成为准。
 */
export function rpaBrowserSource(
  chrome: () => ChromeAgentService | undefined,
): TaskSource {
  return {
    key: 'rpa',
    label: '浏览器代理',
    category: 'matter',
    push: true,
    async collect(
      _user: CurrentUser,
      _options?: TaskCollectOptions,
    ): Promise<TaskDraft[]> {
      return [];
    },
    async recheck(draft) {
      const service = chrome();
      if (!service) return { cleared: true, reason: '' };
      return service.recheckBrowserTask({
        assigneeUserId: draft.assigneeUserId,
        sourceId: draft.sourceId,
      });
    },
  };
}
