import type { CurrentUser } from '../auth/current-user';
import { runWithAgentScope } from './agent-scope';
import { runAgentTool, type AgentToolContext } from './agent-tools';
import { stub } from '../../test/doubles';

/**
 * save_to_kb：会话沉淀到知识库的写闸与空间选择。
 * 无人值守（allowWrite 未放开）必须拒绝；空间优先级 = 显式 space_id > 分身绑定空间 > 账号默认。
 */

const user = stub<CurrentUser>({ userId: 'u1', username: '测试用户' });
const actor = { user, token: undefined };

function buildContext(writeKbPage: jest.Mock) {
  return stub<AgentToolContext>({ writeKbPage });
}

function scoped<T>(
  extra: { allowWrite?: boolean; spaceId?: number; personaId?: number },
  run: () => Promise<T>,
) {
  return runWithAgentScope(
    {
      connectorIds: [],
      mailboxIds: [],
      pluginIds: [],
      trigger: 'chat',
      ...extra,
    },
    run,
  );
}

describe('runAgentTool save_to_kb', () => {
  it('无人值守回合直接拒绝，不写知识库', async () => {
    const writeKbPage = jest.fn();
    const result = await scoped({ allowWrite: false }, () =>
      runAgentTool(
        'save_to_kb',
        { title: '周会纪要', content: '# 周会' },
        buildContext(writeKbPage),
        actor,
      ),
    );
    expect(result.text).toContain('不允许写知识库');
    expect(writeKbPage).not.toHaveBeenCalled();
  });

  it('缺标题或正文时回可读提示', async () => {
    const writeKbPage = jest.fn();
    const missingTitle = await scoped({ allowWrite: true }, () =>
      runAgentTool(
        'save_to_kb',
        { content: '# 正文' },
        buildContext(writeKbPage),
        actor,
      ),
    );
    expect(missingTitle.text).toContain('缺少 title');
    const missingBody = await scoped({ allowWrite: true }, () =>
      runAgentTool(
        'save_to_kb',
        { title: '纪要' },
        buildContext(writeKbPage),
        actor,
      ),
    );
    expect(missingBody.text).toContain('缺少 content');
    expect(writeKbPage).not.toHaveBeenCalled();
  });

  it('不传 space_id 时用分身绑定的空间', async () => {
    const writeKbPage = jest
      .fn()
      .mockResolvedValue({ id: 31, spaceId: 12, title: '周会纪要' });
    const result = await scoped(
      { allowWrite: true, spaceId: 12, personaId: 5 },
      () =>
        runAgentTool(
          'save_to_kb',
          { title: '周会纪要', content: '# 周会' },
          buildContext(writeKbPage),
          actor,
        ),
    );
    expect(writeKbPage).toHaveBeenCalledWith(user, {
      title: '周会纪要',
      content: '# 周会',
      spaceId: 12,
    });
    expect(result.text).toContain('页面编号 31');
  });

  it('显式 space_id 优先于分身空间', async () => {
    const writeKbPage = jest
      .fn()
      .mockResolvedValue({ id: 32, spaceId: 20, title: '对外口径' });
    await scoped({ allowWrite: true, spaceId: 12 }, () =>
      runAgentTool(
        'save_to_kb',
        { title: '对外口径', content: '# 正文', space_id: 20 },
        buildContext(writeKbPage),
        actor,
      ),
    );
    expect(writeKbPage).toHaveBeenCalledWith(user, {
      title: '对外口径',
      content: '# 正文',
      spaceId: 20,
    });
  });
});
