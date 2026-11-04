import { CurrentUser } from '../auth/current-user';
import type { AgentCallContext } from './agent-context';
import { unattendedDenialOf } from './mcp.service';

/**
 * 无人值守写动作的闸门判定：定时任务半夜跑的那一轮，
 * 不能被远端内容里藏的一句指令驱动着改数据、发消息。
 */
const call = (input: {
  trigger?: 'chat' | 'schedule';
  allowWrite?: boolean;
}): AgentCallContext => ({
  user: new CurrentUser('1', 'tester', 'user'),
  requestId: 'req-1',
  ...input,
});

describe('unattendedDenialOf', () => {
  it('对话里用户就在屏幕前，不受无人值守这一层约束', () => {
    expect(unattendedDenialOf('Crm_leadSave', call({ trigger: 'chat' }))).toBe(
      '',
    );
    expect(
      unattendedDenialOf('Okr_objectiveSave', call({ trigger: 'chat' })),
    ).toBe('');
  });

  it('外部 MCP 客户端没有无人值守上下文：只按本人勾选的授权放行', () => {
    expect(unattendedDenialOf('Crm_leadSave', call({}))).toBe('');
    expect(unattendedDenialOf('Crm_leadSave', undefined)).toBe('');
  });

  it('定时任务默认拒绝全部写动作，只出草案', () => {
    expect(
      unattendedDenialOf('Crm_leadSave', call({ trigger: 'schedule' })),
    ).toMatchInlineSnapshot(
      `"无人值守任务默认不执行写动作，只出草案；要自动执行请在该定时任务里勾选「允许自动执行写动作」，或在本人的对话里确认后执行。"`,
    );
    // 没显式 true 一律当关：漏传、传字符串、传 0 都不算放开
    expect(
      unattendedDenialOf(
        'Crm_leadSave',
        call({ trigger: 'schedule', allowWrite: undefined }),
      ),
    ).toContain('无人值守');
    expect(
      unattendedDenialOf(
        'Crm_leadSave',
        call({ trigger: 'schedule', allowWrite: false }),
      ),
    ).toContain('无人值守');
  });

  it('任务勾选放开后普通写动作可执行，但 OKR 口径类仍然拒', () => {
    const open = call({ trigger: 'schedule', allowWrite: true });
    expect(unattendedDenialOf('Crm_leadSave', open)).toBe('');
    expect(unattendedDenialOf('Okr_objectiveSave', open)).toContain(
      '对话里确认',
    );
    expect(unattendedDenialOf('Okr_objectiveAssign', open)).not.toBe('');
    expect(unattendedDenialOf('Okr_krSave', open)).not.toBe('');
    expect(unattendedDenialOf('Okr_planSave', open)).not.toBe('');
  });
});
