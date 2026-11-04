import * as bcrypt from 'bcryptjs';
import { CurrentUser } from '../auth/current-user';
import { ContentAgentScheduleService } from './agent-schedule.service';

/**
 * 定时任务的「允许自动执行写动作」：默认关，且只有从关到开要验本站登录密码。
 * 这一层是无人值守加固的入口——开关一旦被顺手打开，半夜那轮对话就能改数据、发消息。
 */
const user = new CurrentUser('9200', 'tester', 'user');
const HASH = bcrypt.hashSync('hunter2-hunter', 4);

const stored = {
  id: 1,
  userId: '9200',
  preset: '',
  title: '每日简报',
  instruction: '每天汇总要闻',
  conversationId: 0,
  expertId: 0,
  personaId: 0,
  skillIds: [],
  pluginIds: [],
  libraryIds: [],
  connectorIds: [],
  mailboxIds: [],
  allowWrite: false,
  references: [],
  channelId: 3,
  model: 'gpt-test',
  scheduleType: 'recurring',
  scheduleConfig: { freq: 'daily', time: '09:00' },
  scheduledAt: new Date('2026-11-05T01:00:00Z'),
  status: 'enabled',
  lastRunAt: null,
  lastStatus: '',
  lastError: '',
  runCount: 0,
  createdAt: new Date('2026-11-04T00:00:00Z'),
  updatedAt: new Date('2026-11-04T00:00:00Z'),
};

function build(account: unknown = { passwordHash: HASH, status: 'ACTIVE' }) {
  const create = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data }));
  const findUnique = jest.fn().mockResolvedValue(account);
  const prisma = {
    account: { findUnique },
    contentAgentSchedule: { create },
    contentAgentMcpConnector: { count: jest.fn() },
    mailAccount: { count: jest.fn() },
  } as never;
  const identity = { audit: jest.fn() } as never;
  const experts = { bindable: jest.fn() } as never;
  return {
    service: new ContentAgentScheduleService(
      prisma,
      identity,
      {} as never,
      {} as never,
      experts,
    ),
    create,
    findUnique,
  };
}

const body = (extra: Record<string, unknown>) => ({
  title: '每日简报',
  instruction: '每天汇总要闻',
  scheduleType: 'recurring',
  scheduleConfig: { freq: 'daily', time: '09:00' },
  channelId: 3,
  model: 'gpt-test',
  ...extra,
});

describe('ContentAgentScheduleService.save 的写动作开关', () => {
  it('不带 allowWrite 时入库就是关，而且不必查密码', async () => {
    const { service, create, findUnique } = build();
    await service.save(user, body({}));
    expect(create.mock.calls[0][0].data.allowWrite).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('界面把开关传成字符串也不算放开', async () => {
    const { service, create } = build();
    await service.save(user, body({ allowWrite: 'true' }));
    expect(create.mock.calls[0][0].data.allowWrite).toBe(false);
  });

  it('要放开却没验密：直接拒，任务不落库', async () => {
    const { service, create } = build();
    await expect(
      service.save(user, body({ allowWrite: true })),
    ).rejects.toThrow('需要输入本站登录密码');
    expect(create).not.toHaveBeenCalled();
  });

  it('密码不对同样拒，不透露账号状态', async () => {
    const { service, create } = build();
    await expect(
      service.save(user, body({ allowWrite: true, password: 'wrong-pass' })),
    ).rejects.toThrow('不能开启「允许自动执行写动作」');
    expect(create).not.toHaveBeenCalled();
  });

  it('账号被封时密码对也开不了', async () => {
    const { service, create } = build({
      passwordHash: HASH,
      status: 'BANNED',
    });
    await expect(
      service.save(
        user,
        body({ allowWrite: true, password: 'hunter2-hunter' }),
      ),
    ).rejects.toThrow('不能开启「允许自动执行写动作」');
    expect(create).not.toHaveBeenCalled();
  });

  it('验密通过才把开关写成开', async () => {
    const { service, create } = build();
    await service.save(
      user,
      body({ allowWrite: true, password: 'hunter2-hunter' }),
    );
    expect(create.mock.calls[0][0].data.allowWrite).toBe(true);
  });
});
