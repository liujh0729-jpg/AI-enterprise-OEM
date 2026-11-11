import * as bcrypt from 'bcryptjs';
import { CurrentUser } from '../auth/current-user';
import { ContentAgentScheduleService } from './agent-schedule.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { HrmScopeService } from '../hrm/hrm.scope';
import { ContentAgentService } from './agent.service';
import { ContentAgentExpertService } from './agent-experts.service';
import { stub } from '../../test/doubles';

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
  const prisma = stub<PrismaService>({
    account: { findUnique },
    contentAgentSchedule: { create },
    contentAgentMcpConnector: { count: jest.fn() },
    mailAccount: { count: jest.fn() },
  });
  const identity = stub<IdentityService>({ audit: jest.fn() });
  const experts = stub<ContentAgentExpertService>({ bindable: jest.fn() });
  const scope = stub<HrmScopeService>({
    isStanding: jest.fn(async () => true),
  });
  return {
    service: new ContentAgentScheduleService(
      prisma,
      identity,
      stub<UserLookupService>(),
      scope,
      stub<ContentAgentService>(),
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

describe('定时执行前的在册复核', () => {
  function buildDue(standing: boolean) {
    const update = jest.fn().mockResolvedValue({});
    const prisma = stub<PrismaService>({
      contentAgentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...stored, status: 'enabled' }]),
        update,
      },
    });
    const users = stub<UserLookupService>({
      lookup: jest.fn().mockResolvedValue([{ id: '9200', username: 'tester' }]),
    });
    const service = new ContentAgentScheduleService(
      prisma,
      stub<IdentityService>({ audit: jest.fn() }),
      users,
      stub<HrmScopeService>({
        isStanding: jest.fn().mockResolvedValue(standing),
      }),
      stub<ContentAgentService>({}),
      stub<ContentAgentExpertService>({}),
    );
    const execute = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { execute });
    return { service, update, execute };
  }

  it('账号已停用：不执行，任务自动暂停并清空下次时间', async () => {
    const { service, update, execute } = buildDue(false);
    await service.advanceDue();
    expect(execute).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'paused',
        scheduledAt: null,
        lastStatus: 'skipped',
      }),
    });
  });

  it('账号在册：照常安排下一轮并执行', async () => {
    const { service, execute } = buildDue(true);
    await service.advanceDue();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
