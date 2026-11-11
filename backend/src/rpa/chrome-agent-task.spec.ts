import type { PrismaService } from '../prisma/prisma.service';
import type { RpaChromeDeviceService } from './chrome-device.service';
import type { RpaTaskService } from './rpa-task.service';
import type { StorageService } from '../storage/storage.service';
import { stub } from '../../test/doubles';
import { ChromeAgentService } from './chrome-agent.service';

/**
 * docs §8.4「浏览器需要登录或确认 → 登录、发布确认」：
 * 待办的完成依据不是点完成，而是会话真的离开等待确认 / 重新登录后跑通一次。
 */

function setup(
  session: Record<string, unknown> | null,
  rerun: Record<string, unknown> | null,
) {
  const prisma = {
    rpaChromeSession: {
      // 第一次按 id 查目标会话；第二次按 id:{gt} 查之后跑通的会话
      findFirst: jest.fn(async ({ where }: { where: { id: unknown } }) =>
        typeof where.id === 'number' ? session : rerun,
      ),
    },
  };
  const service = new ChromeAgentService(
    stub<PrismaService>(prisma),
    stub<RpaChromeDeviceService>(),
    stub<StorageService>(),
    stub<RpaTaskService>(),
  );
  return { service, prisma };
}

describe('浏览器确认/登录待办关闭前复核（docs §8.4）', () => {
  it('会话仍在等待确认时不允许关闭', async () => {
    const { service } = setup({ id: 12, status: 'WAITING_CONFIRM' }, null);
    const outcome = await service.recheckBrowserTask({
      assigneeUserId: 'u-1',
      sourceId: 'confirm:12:3',
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toContain('等待你的确认');
  });

  it('确认已处理（会话离开等待态）即放行', async () => {
    const { service } = setup({ id: 12, status: 'COMPLETED' }, null);
    const outcome = await service.recheckBrowserTask({
      assigneeUserId: 'u-1',
      sourceId: 'confirm:12:3',
    });
    expect(outcome.cleared).toBe(true);
  });

  it('登录类待办要看到之后跑通的会话才放行', async () => {
    const blocked = setup({ id: 12, status: 'FAILED' }, null);
    const pending = await blocked.service.recheckBrowserTask({
      assigneeUserId: 'u-1',
      sourceId: 'login:12:3',
    });
    expect(pending.cleared).toBe(false);
    expect(pending.reason).toContain('重跑');

    const passed = setup({ id: 12, status: 'FAILED' }, { id: 13 });
    const cleared = await passed.service.recheckBrowserTask({
      assigneeUserId: 'u-1',
      sourceId: 'login:12:3',
    });
    expect(cleared.cleared).toBe(true);
  });
});
