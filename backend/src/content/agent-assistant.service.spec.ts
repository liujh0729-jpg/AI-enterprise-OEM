import { CurrentUser } from '../auth/current-user';
import { ContentAgentAssistantService } from './agent-assistant.service';
import { AgentAssistantCrypto } from './agent-assistant-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { ContentAgentService } from './agent.service';
import { stub } from '../../test/doubles';

/**
 * 助理执行渠道规则：渠道 0（AIPDD）用本人绑定的 Key，可直接选，不必查渠道归属；
 * 自建渠道（>0）必须属于本人且启用；负数非法；模型必须定死。
 */
const user = new CurrentUser('9200', 'tester', 'user');

const stored = {
  id: 1,
  userId: '9200',
  kind: 'wecom_bot',
  name: '群机器人',
  webhookToken: 'tok',
  configCipher: '{}',
  personaId: 0,
  channelId: 0,
  model: 'gpt-test',
  allowedUsers: '',
  enabled: true,
  lastEventAt: null,
  lastError: '',
  eventCount: 0,
  createdAt: new Date('2026-11-12T00:00:00Z'),
  updatedAt: new Date('2026-11-12T00:00:00Z'),
};

function build(channel: unknown = null) {
  const create = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data }));
  const findFirst = jest.fn().mockResolvedValue(channel);
  const prisma = stub<PrismaService>({
    contentAgentAssistantChannel: { create },
    contentModelChannel: { findFirst },
  });
  const identity = stub<IdentityService>({ audit: jest.fn() });
  const crypto = stub<AgentAssistantCrypto>({
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  });
  return {
    service: new ContentAgentAssistantService(
      prisma,
      identity,
      stub<ContentAgentService>(),
      crypto,
    ),
    create,
    findFirst,
  };
}

const body = (extra: Record<string, unknown>) => ({
  kind: 'wecom_bot',
  name: '群机器人',
  config: { webhookKey: 'key-1' },
  channelId: 0,
  model: 'gpt-test',
  ...extra,
});

describe('ContentAgentAssistantService.save 的执行渠道规则', () => {
  it('AIPDD 渠道（0）可直接保存，不去查渠道归属', async () => {
    const { service, create, findFirst } = build();
    await service.save(user, body({ channelId: 0 }));
    expect(create.mock.calls[0][0].data.channelId).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('自建渠道（>0）：属于本人且启用才保存', async () => {
    const { service, create, findFirst } = build({ id: 7, enabled: true });
    await service.save(user, body({ channelId: 7 }));
    expect(findFirst).toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.channelId).toBe(7);
  });

  it('自建渠道不存在：拒绝且不落库', async () => {
    const { service, create } = build(null);
    await expect(service.save(user, body({ channelId: 7 }))).rejects.toThrow(
      '模型渠道不存在',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('自建渠道已停用：拒绝', async () => {
    const { service } = build({ id: 7, enabled: false });
    await expect(service.save(user, body({ channelId: 7 }))).rejects.toThrow(
      '该模型渠道已停用',
    );
  });

  it('负数渠道非法', async () => {
    const { service } = build();
    await expect(service.save(user, body({ channelId: -1 }))).rejects.toThrow(
      '请选择助理执行用的模型渠道',
    );
  });

  it('没选模型：拒绝', async () => {
    const { service } = build();
    await expect(service.save(user, body({ model: '' }))).rejects.toThrow(
      '助理执行要选定具体模型',
    );
  });
});
