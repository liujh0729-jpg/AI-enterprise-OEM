import type {
  RcDeviceView,
  RcSessionView,
  RcSkillView,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { stub } from '../../test/doubles';
import type { ChromeAgentService } from './chrome-agent.service';
import type { RpaChromeDeviceService } from './chrome-device.service';
import type { RpaChromeLibraryService } from './chrome-library.service';
import { BrowserAgentToolsService } from './browser-agent-tools.service';

/**
 * MCP 语义层的判定边界：绿灯（在线）才派任务、多台要指定、技能按名/编号解析。
 * 这里只测「翻译与在线闸」，会话本身的行为由 ChromeAgentService 自己的用例覆盖。
 */

const user = new CurrentUser('u-1', 'tester', 'user');
const now = new Date('2026-11-11T08:00:00.000Z').toISOString();

function device(over: Partial<RcDeviceView>): RcDeviceView {
  return {
    clientId: 'chrome-aaaa1111',
    name: '办公室主机',
    domain: 'https://example.com',
    extensionVersion: '1.4.0',
    status: 'ONLINE',
    statusLabel: '在线',
    online: true,
    lastSeenAt: now,
    createdAt: now,
    activeSessionId: 0,
    ...over,
  };
}

function session(over: Partial<RcSessionView> = {}): RcSessionView {
  return {
    id: 7,
    clientId: 'chrome-aaaa1111',
    deviceName: '办公室主机',
    goal: '查前三名的价格',
    mode: 'act',
    modeLabel: '操作',
    status: 'RUNNING',
    statusLabel: '执行中',
    stepCount: 0,
    maxSteps: 25,
    model: '',
    stopReason: '',
    startedAt: now,
    endedAt: null,
    createdAt: now,
    ...over,
  };
}

function skill(over: Partial<RcSkillView> = {}): RcSkillView {
  return {
    id: 3,
    name: '小红书私信',
    kind: 'site',
    kindLabel: '站点技能',
    description: '私信前的准备动作',
    content: '先进入消息页，再逐个发送，注意每天不超过 20 条。',
    site: 'xiaohongshu.com',
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function build(input: {
  devices?: RcDeviceView[];
  started?: RcSessionView;
  skills?: RcSkillView[];
  viewed?: RcSessionView;
  stopped?: RcSessionView;
}) {
  const startCalls: Record<string, unknown>[] = [];
  const stopCalls: number[] = [];
  const devices = stub<RpaChromeDeviceService>({
    listDevices: async () => ({ devices: input.devices ?? [], settings: {} }),
  });
  const agent = stub<ChromeAgentService>({
    startSession: async (_user: CurrentUser, body: Record<string, unknown>) => {
      startCalls.push(body);
      return input.started ?? session();
    },
    sessionView: async () => input.viewed ?? session(),
    stopSession: async (_user: CurrentUser, id: number) => {
      stopCalls.push(id);
      return (
        input.stopped ?? session({ status: 'CANCELLED', statusLabel: '已取消' })
      );
    },
  });
  const library = stub<RpaChromeLibraryService>({
    listSkills: async () => ({ list: input.skills ?? [] }),
  });
  return {
    service: new BrowserAgentToolsService(devices, agent, library),
    startCalls,
    stopCalls,
  };
}

describe('BrowserAgentToolsService', () => {
  it('没有在线设备时拒绝派任务，并指路去插件登录', async () => {
    const { service, startCalls } = build({
      devices: [device({ online: false, status: 'OFFLINE' })],
    });
    const result = await service.run(user, 'browser_agent_start', {
      goal: '打开后台导出报表',
    });
    expect(result?.ok).toBe(false);
    expect(String(result?.message)).toContain('没有在线的本地 Chrome 设备');
    expect(startCalls).toHaveLength(0);
  });

  it('只有一台在线设备时自动选中，并把能力档透传给会话引擎', async () => {
    const { service, startCalls } = build({ devices: [device({})] });
    const result = await service.run(user, 'browser_agent_start', {
      goal: '打开后台导出报表',
      mode: 'extract',
      max_steps: 12,
    });
    expect(result?.ok).toBe(true);
    expect(result?.['sessionId']).toBe(7);
    expect(startCalls).toEqual([
      {
        clientId: 'chrome-aaaa1111',
        goal: '打开后台导出报表',
        mode: 'extract',
        maxSteps: 12,
      },
    ]);
  });

  it('多台在线而没指定 client_id 时不替用户猜，列出设备要求指定', async () => {
    const { service, startCalls } = build({
      devices: [
        device({ clientId: 'chrome-aaaa1111', name: 'A 机' }),
        device({ clientId: 'chrome-bbbb2222', name: 'B 机' }),
      ],
    });
    const result = await service.run(user, 'browser_agent_start', {
      goal: '抓下价格',
    });
    expect(result?.ok).toBe(false);
    expect(String(result?.message)).toContain('2 台在线设备');
    expect(startCalls).toHaveLength(0);
  });

  it('指定了离线设备时如实拒绝，不偷偷换一台', async () => {
    const { service, startCalls } = build({
      devices: [
        device({ clientId: 'chrome-aaaa1111', name: 'A 机' }),
        device({
          clientId: 'chrome-bbbb2222',
          name: 'B 机',
          online: false,
          status: 'OFFLINE',
        }),
      ],
    });
    const result = await service.run(user, 'browser_agent_start', {
      goal: '抓下价格',
      client_id: 'chrome-bbbb2222',
    });
    expect(result?.ok).toBe(false);
    expect(String(result?.message)).toContain('当前离线');
    expect(startCalls).toHaveLength(0);
  });

  it('抽取把能力档固定为 extract，并把字段口径拼进目标', async () => {
    const { service, startCalls } = build({ devices: [device({})] });
    const result = await service.run(user, 'browser_extract', {
      instruction: '把搜索结果抽成表格',
      schema_note: '字段：标题、价格',
    });
    expect(result?.ok).toBe(true);
    const body = startCalls[0];
    expect(body['mode']).toBe('extract');
    expect(String(body['goal'])).toContain('把搜索结果抽成表格');
    expect(String(body['goal'])).toContain('字段：标题、价格');
  });

  it('运行技能：按名称取正文当目标，站点补协议当起始地址', async () => {
    const { service, startCalls } = build({
      devices: [device({})],
      skills: [skill({})],
    });
    const result = await service.run(user, 'browser_skill_run', {
      skill: '小红书私信',
    });
    expect(result?.ok).toBe(true);
    expect(startCalls[0]).toEqual({
      clientId: 'chrome-aaaa1111',
      goal: '先进入消息页，再逐个发送，注意每天不超过 20 条。',
      mode: 'act',
      startUrl: 'https://xiaohongshu.com',
    });
  });

  it('技能用编号也能命中；找不到时把候选摆出来', async () => {
    const { service } = build({ devices: [device({})], skills: [skill({})] });
    const hit = await service.run(user, 'browser_skill_run', {
      skill: '3',
      goal: '发三条私信',
    });
    expect(hit?.ok).toBe(true);
    expect(String(hit?.['message'])).toContain('会话');
    const miss = await service.run(user, 'browser_skill_run', {
      skill: '抖音私信',
    });
    expect(miss?.ok).toBe(false);
    expect(String(miss?.message)).toContain('没有找到技能');
    expect(String(miss?.message)).toContain('小红书私信');
  });

  it('技能列表空的时候也回 ok，并说明去哪里沉淀', async () => {
    const { service } = build({ skills: [] });
    const result = await service.run(user, 'browser_skill_list', {
      kind: 'all',
    });
    expect(result?.ok).toBe(true);
    expect(result?.['total']).toBe(0);
  });

  it('状态不给 steps、结果给 steps，停止走 stopSession', async () => {
    const viewed = session({
      steps: [
        {
          id: 1,
          stepIndex: 0,
          commandCode: 'c-1',
          action: { action: 'snapshot' },
          thought: '先看页面',
          observation: { url: 'https://example.com' },
          screenshotUrl: '',
          status: 'DONE',
          elapsedMs: 120,
          errorMessage: '',
          createdAt: now,
        },
      ],
    });
    const { service, stopCalls } = build({ viewed });
    const status = await service.run(user, 'browser_agent_status', {
      session_id: 7,
    });
    expect(status?.ok).toBe(true);
    expect(status?.['steps']).toBeUndefined();
    const full = await service.run(user, 'browser_agent_result', {
      session_id: 7,
    });
    expect(Array.isArray(full?.['steps'])).toBe(true);
    const stopped = await service.run(user, 'browser_agent_stop', {
      session_id: 7,
    });
    expect(stopped?.ok).toBe(true);
    expect(stopCalls).toEqual([7]);
  });

  it('不属于这一组的工具名交回上层（返回 null）', async () => {
    const { service } = build({});
    expect(
      await service.run(user, 'read_data', { operationId: 'X' }),
    ).toBeNull();
  });
});
