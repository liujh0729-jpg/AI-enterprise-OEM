import type { CurrentUser } from '../auth/current-user';
import { runWithAgentScope } from './agent-scope';
import {
  runBusinessTool,
  type AgentBusinessContext,
} from './agent-business-tools';
import { parseCopilot } from './agent.service';
import { stub } from '../../test/doubles';

/**
 * P2-A 嵌入式副驾：页面上下文只进提示词；业务写动作由作用域 allowWrite 把关，
 * 只读模式（副驾未打开写开关 / 定时任务未授权）不能改数据。
 */

const user = stub<CurrentUser>({ userId: 'u1', username: '测试用户' });
const actor = { user, token: undefined };

describe('parseCopilot 页面上下文', () => {
  it('缺模块标识时不注入任何内容', () => {
    expect(parseCopilot(null)).toBeNull();
    expect(parseCopilot({ recordLabel: '张三' })).toBeNull();
  });

  it('拼出模块、记录与页面摘要，写开关只认显式 true', () => {
    const parsed = parseCopilot({
      module: 'crm',
      moduleLabel: 'CRM',
      recordId: '12',
      recordLabel: '张三',
      context: '当前页签：客户',
      allowWrite: 'yes',
    });
    expect(parsed?.allowWrite).toBe(false);
    expect(parsed?.block).toContain('「CRM」工作区');
    expect(parsed?.block).toContain('正在看：张三（编号 12）');
    expect(parsed?.block).toContain('当前页签：客户');
    expect(parseCopilot({ module: 'crm', allowWrite: true })?.allowWrite).toBe(
      true,
    );
  });
});

describe('副驾只读模式下不执行写动作', () => {
  const create = jest.fn().mockResolvedValue({ id: 1 });
  const business = stub<AgentBusinessContext>({ crmLeads: { create } });

  it('allowWrite 未放开时拒绝建线索', async () => {
    const result = await runWithAgentScope(
      { connectorIds: [], mailboxIds: [], trigger: 'chat', allowWrite: false },
      () =>
        runBusinessTool(
          'crm_create_lead',
          { name: '华南客户' },
          business,
          actor,
        ),
    );
    expect(result?.text).toContain('只读模式');
    expect(create).not.toHaveBeenCalled();
  });

  it('allowWrite=true 时按用户身份落到 CRM 服务', async () => {
    const result = await runWithAgentScope(
      { connectorIds: [], mailboxIds: [], trigger: 'chat', allowWrite: true },
      () =>
        runBusinessTool(
          'crm_create_lead',
          { name: '华南客户' },
          business,
          actor,
        ),
    );
    expect(create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ name: '华南客户' }),
    );
    expect(result?.text).toContain('线索已创建');
  });
});
