import { CurrentUser } from '../auth/current-user';
import { runWithAgentScope } from './agent-scope';
import { runAgentTool, type AgentToolContext } from './agent-tools';
import { stub } from '../../test/doubles';

/**
 * run_plugin_command 的工具接线：模型展开插件命令时，读的是哪几个插件、
 * 正文怎么回给它、越界调用怎么挡——这几条都靠作用域与围栏文案兜住，所以单独验。
 * 插件服务用桩替掉：真实取数已在 agent-plugins.service.spec.ts 与联调脚本里覆盖。
 */
type RunInput = {
  plugin: string;
  command: string;
  args: string;
  ids?: number[];
};

function buildContext(runCommand: jest.Mock) {
  const plugins = stub<AgentToolContext['plugins']>({
    runCommand,
    read: jest.fn(),
  });
  return stub<AgentToolContext>({ plugins });
}

const actor = {
  user: new CurrentUser('u1', 'dave', 'user'),
  token: undefined,
};

describe('runAgentTool run_plugin_command', () => {
  it('缺 plugin 或 command 时回可读文案，不去查库', async () => {
    const runCommand = jest.fn();
    const result = await runAgentTool(
      'run_plugin_command',
      { plugin: '测试插件' },
      buildContext(runCommand),
      actor,
    );
    expect(result.text).toContain('缺少 plugin 或 command');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('展开成功时把正文包进围栏，并交代只能用站内工具干活', async () => {
    const runCommand = jest.fn().mockResolvedValue({
      found: true as const,
      plugin: '测试插件',
      command: 'build',
      path: 'commands/build.md',
      content: '针对 促销海报 拆解步骤。',
      hint: '',
    });
    const result = await runAgentTool(
      'run_plugin_command',
      { plugin: '测试插件', command: '/build', arguments: '促销海报' },
      buildContext(runCommand),
      actor,
    );
    expect(result.text).toContain('【插件命令 /build】来自插件「测试插件」');
    expect(result.text).toContain('--- 命令正文开始 ---');
    expect(result.text).toContain('针对 促销海报 拆解步骤。');
    expect(result.text).toContain('--- 命令正文结束 ---');
    expect(result.text).toContain('执行本地脚本');
  });

  it('没勾插件时按全部启用中的插件跑（ids 传空）', async () => {
    const runCommand = jest.fn().mockResolvedValue({
      found: false as const,
      command: '',
      hint: '可用插件：',
    });
    const result = await runAgentTool(
      'run_plugin_command',
      { plugin: '测试插件', command: 'build' },
      buildContext(runCommand),
      actor,
    );
    const input: RunInput = runCommand.mock.calls[0][1];
    expect(input.ids).toEqual([]);
    expect(result.text).toContain('没能展开插件命令「测试插件 · build」');
  });

  it('本轮勾了插件就只在这些 id 里找，越界插件回「找不到」', async () => {
    const runCommand = jest
      .fn()
      .mockImplementation((_userId: string, input: RunInput) =>
        Promise.resolve({
          found: input.plugin === '测试插件' && input.ids?.length === 1,
          plugin: input.plugin,
          command: 'build',
          path: 'commands/build.md',
          content: '',
          hint: input.ids?.join(',') || '',
        }),
      );
    const scoped = await runWithAgentScope(
      { connectorIds: [], mailboxIds: [], pluginIds: [7], trigger: 'chat' },
      () =>
        runAgentTool(
          'run_plugin_command',
          { plugin: '测试插件', command: 'build' },
          buildContext(runCommand),
          actor,
        ),
    );
    expect(runCommand.mock.calls[0][1].ids).toEqual([7]);
    expect(scoped.text).toContain('【插件命令 /build】');

    const missed = await runWithAgentScope(
      { connectorIds: [], mailboxIds: [], pluginIds: [7], trigger: 'chat' },
      () =>
        runAgentTool(
          'run_plugin_command',
          { plugin: '别人的插件', command: 'build' },
          buildContext(runCommand),
          actor,
        ),
    );
    expect(missed.text).toContain('没能展开插件命令');
  });

  it('作用域同样管 load_plugin：勾选后只读这几个插件', async () => {
    const read = jest.fn().mockResolvedValue({
      found: true as const,
      name: '测试插件',
      content: '正文',
      file: '',
    });
    const context = stub<AgentToolContext>({
      plugins: { read, runCommand: jest.fn() },
    });
    await runWithAgentScope(
      { connectorIds: [], mailboxIds: [], pluginIds: [3, 4], trigger: 'chat' },
      () => runAgentTool('load_plugin', { name: '测试插件' }, context, actor),
    );
    expect(read).toHaveBeenCalledWith('u1', '测试插件', undefined, [3, 4]);
  });
});
