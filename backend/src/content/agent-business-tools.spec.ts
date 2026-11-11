import type { CurrentUser } from '../auth/current-user';
import {
  BUSINESS_TOOLS,
  businessToolOf,
  businessToolSpecs,
  runBusinessTool,
  type AgentBusinessContext,
} from './agent-business-tools';
import { buildAgentToolManifest } from './agent-tool-manifest';
import {
  AGENT_TOOLS,
  runAgentTool,
  type AgentToolContext,
} from './agent-tools';
import { stub } from '../../test/doubles';

/**
 * P0-4 单测：业务动作工具的参数映射 / 红线拒止 / manifest 归一注册。
 * 红线（Recruit_updateApplicationStatus）复用 MCP 永久排除清单，注册表可见但绝不执行。
 */

const user = stub<CurrentUser>({ userId: 'u1', username: '测试用户' });
const actor = { user, token: undefined };

function makeBusiness(overrides: Partial<AgentBusinessContext> = {}) {
  const crmCreate = jest.fn().mockResolvedValue({ id: 11, name: '新线索' });
  const tableList = jest.fn().mockResolvedValue([
    { id: 3, name: '发布会跟进', fields: [] },
    { id: 4, name: '发布会跟进', fields: [] },
  ]);
  const rowCreate = jest
    .fn()
    .mockResolvedValue({ id: 77, data: { title: 'x' } });
  const stockList = jest.fn().mockResolvedValue({ total: 0, list: [] });
  const draftSave = jest.fn().mockResolvedValue({ id: 901, number: 'OA-001' });
  const flowSubmit = jest
    .fn()
    .mockResolvedValue({ id: 901, status: 'APPROVING' });
  const statusUpdate = jest
    .fn()
    .mockResolvedValue({ id: 5, status: 'REJECTED' });
  const chromeDevices = jest.fn().mockResolvedValue({
    devices: [
      {
        clientId: 'c-1',
        name: '办公电脑 Chrome',
        online: true,
        statusLabel: '在线',
        activeSessionId: 0,
      },
    ],
    settings: {},
  });
  const chromeStart = jest
    .fn()
    .mockResolvedValue({ id: 31, status: 'RUNNING', goal: '比价' });
  const chromeSession = jest
    .fn()
    .mockResolvedValue({ id: 31, status: 'RUNNING', steps: [] });
  const chromePause = jest.fn().mockResolvedValue({ id: 31, status: 'PAUSED' });
  const chromeResume = jest
    .fn()
    .mockResolvedValue({ id: 31, status: 'RUNNING' });
  const chromeStop = jest
    .fn()
    .mockResolvedValue({ id: 31, status: 'CANCELLED' });
  const chromeRetry = jest
    .fn()
    .mockResolvedValue({ id: 31, status: 'RUNNING' });
  const business: AgentBusinessContext = {
    crmLeads: { create: crmCreate },
    dataTable: { list: tableList, createRow: rowCreate },
    erp: { listStock: stockList },
    oa: { saveDraft: draftSave, submit: flowSubmit },
    recruit: { updateApplicationStatus: statusUpdate },
    rpaChrome: {
      listDevices: chromeDevices,
      startSession: chromeStart,
      session: chromeSession,
      pauseSession: chromePause,
      resumeSession: chromeResume,
      stopSession: chromeStop,
      retryStep: chromeRetry,
    },
    ...overrides,
  };
  return {
    business,
    crmCreate,
    tableList,
    rowCreate,
    stockList,
    draftSave,
    flowSubmit,
    statusUpdate,
    chromeDevices,
    chromeStart,
    chromeSession,
    chromePause,
    chromeResume,
    chromeStop,
    chromeRetry,
  };
}

describe('agent-business-tools 业务动作工具', () => {
  it('crm_create_lead：snake_case 参数映射到 CRM 服务并带登录人身份', async () => {
    const { business, crmCreate } = makeBusiness();
    const result = await runBusinessTool(
      'crm_create_lead',
      { name: '华南客户', contact_name: '张三', phone: '13800000000' },
      business,
      actor,
    );
    expect(crmCreate).toHaveBeenCalledWith(user, {
      name: '华南客户',
      contactName: '张三',
      phone: '13800000000',
      email: '',
      source: '',
      stage: '',
      remark: '',
    });
    expect(result?.text).toContain('线索已创建');
  });

  it('data_table_add_row：重名表不猜，摆出候选要 table_id', async () => {
    const { business, rowCreate } = makeBusiness();
    const result = await runBusinessTool(
      'data_table_add_row',
      { table_name: '发布会跟进', values: { title: 'x' } },
      business,
      actor,
    );
    expect(rowCreate).not.toHaveBeenCalled();
    expect(result?.text).toContain('2 张同名表格');
    expect(result?.text).toContain('#3');
  });

  it('data_table_add_row：table_id 直写，values 原样进服务', async () => {
    const { business, rowCreate } = makeBusiness();
    const result = await runBusinessTool(
      'data_table_add_row',
      { table_id: 3, values: { title: 'x' } },
      business,
      actor,
    );
    expect(rowCreate).toHaveBeenCalledWith(user, 3, {
      title: 'x',
    });
    expect(result?.text).toContain('已写入表格');
  });

  it('erp_check_stock：查询参数正确映射（读操作）', async () => {
    const { business, stockList } = makeBusiness();
    await runBusinessTool(
      'erp_check_stock',
      { q: 'SKU-1', warehouse_id: 2, low_only: true },
      business,
      actor,
    );
    expect(stockList).toHaveBeenCalledWith(user, {
      page: 1,
      pageSize: 20,
      warehouseId: 2,
      q: 'SKU-1',
      lowOnly: true,
    });
  });

  it('oa_start_flow：先建草稿再提交，两步都用登录人身份', async () => {
    const { business, draftSave, flowSubmit } = makeBusiness();
    const result = await runBusinessTool(
      'oa_start_flow',
      { template_id: 6, title: '差旅报销', form_data: { amount: 1200 } },
      business,
      actor,
    );
    expect(draftSave).toHaveBeenCalledWith(user, {
      templateId: 6,
      title: '差旅报销',
      formData: { amount: 1200 },
    });
    expect(flowSubmit).toHaveBeenCalledWith(user, '901');
    expect(result?.text).toContain('审批已提交');
  });

  it('红线动作 recruit_update_application：注册表可见但拒绝执行', async () => {
    const { business, statusUpdate } = makeBusiness();
    const result = await runBusinessTool(
      'recruit_update_application',
      { id: 5, status: 'REJECTED' },
      business,
      actor,
    );
    expect(statusUpdate).not.toHaveBeenCalled();
    expect(result?.text).toContain('投递状态变更需要本人确认');
  });

  it('未知工具名返回 null，交回内置工具分流', async () => {
    const { business } = makeBusiness();
    expect(
      await runBusinessTool('generate_image', {}, business, actor),
    ).toBeNull();
  });

  it('runAgentTool 会把业务工具分流到 business 上下文', async () => {
    const { business, stockList } = makeBusiness();
    const context = stub<AgentToolContext>({
      business,
    });
    const result = await runAgentTool(
      'erp_check_stock',
      { q: 'SKU-2' },
      context,
      actor,
    );
    expect(stockList).toHaveBeenCalledWith(user, {
      page: 1,
      pageSize: 20,
      warehouseId: undefined,
      q: 'SKU-2',
      lowOnly: false,
    });
    expect(result.text).toContain('库存查询结果');
  });

  it('chrome_list_devices：设备清单按在线/离线列给人话', async () => {
    const { business, chromeDevices } = makeBusiness();
    const result = await runBusinessTool(
      'chrome_list_devices',
      {},
      business,
      actor,
    );
    expect(chromeDevices).toHaveBeenCalledWith(user);
    expect(result?.text).toContain('c-1');
    expect(result?.text).toContain('在线');
  });

  it('chrome_list_devices：没有设备时引导用户先去插件登录', async () => {
    const { business } = makeBusiness({
      rpaChrome: stub<AgentBusinessContext['rpaChrome']>({
        listDevices: jest.fn().mockResolvedValue({ devices: [] }),
        startSession: jest.fn(),
        session: jest.fn(),
        pauseSession: jest.fn(),
        resumeSession: jest.fn(),
        stopSession: jest.fn(),
        retryStep: jest.fn(),
      }),
    });
    const result = await runBusinessTool(
      'chrome_list_devices',
      {},
      business,
      actor,
    );
    expect(result?.text).toContain('插件弹窗');
  });

  it('chrome_start_session：snake_case 参数映射到会话服务', async () => {
    const { business, chromeStart } = makeBusiness();
    const result = await runBusinessTool(
      'chrome_start_session',
      {
        client_id: 'c-1',
        goal: '比价三件商品',
        start_url: 'https://example.com',
        max_steps: 12,
      },
      business,
      actor,
    );
    expect(chromeStart).toHaveBeenCalledWith(user, {
      clientId: 'c-1',
      goal: '比价三件商品',
      startUrl: 'https://example.com',
      taskId: 0,
      maxSteps: 12,
    });
    expect(result?.text).toContain('已在设备 c-1 上发起');
  });

  it('chrome_start_session：缺 client_id 时不调用服务', async () => {
    const { business, chromeStart } = makeBusiness();
    const result = await runBusinessTool(
      'chrome_start_session',
      { goal: '比价' },
      business,
      actor,
    );
    expect(chromeStart).not.toHaveBeenCalled();
    expect(result?.text).toContain('client_id');
  });

  it('chrome_stop_session：三态动作走同一分支并回最新视图', async () => {
    const { business, chromeStop } = makeBusiness();
    const result = await runBusinessTool(
      'chrome_stop_session',
      { session_id: 31 },
      business,
      actor,
    );
    expect(chromeStop).toHaveBeenCalledWith(user, 31);
    expect(result?.text).toContain('已停止会话 #31');
  });

  it('chrome_retry_step：缺 step_id 时不调用服务', async () => {
    const { business, chromeRetry } = makeBusiness();
    const result = await runBusinessTool(
      'chrome_retry_step',
      {},
      business,
      actor,
    );
    expect(chromeRetry).not.toHaveBeenCalled();
    expect(result?.text).toContain('step_id');
  });
});

describe('agent-tool-manifest 统一工具清单', () => {
  it('五类能力归一：内置 + 业务 + 连接器 + 技能 + 插件', () => {
    const rows = buildAgentToolManifest({
      connectorTools: [
        {
          name: 'mcp__c1__fetch',
          connectorId: 1,
          connectorName: '测试连接器',
          remoteName: 'fetch',
          description: '抓网页',
          inputSchema: { type: 'object' },
        },
      ],
      skills: [
        {
          name: '过审技能',
          description: 'a',
          enabled: true,
          reviewStatus: 'passed',
        },
        {
          name: '待审技能',
          description: 'b',
          enabled: true,
          reviewStatus: 'pending',
        },
      ],
      plugins: [
        {
          name: '过审插件',
          description: 'c',
          enabled: true,
          reviewStatus: 'passed',
        },
      ],
    });
    const names = new Set(rows.map((row) => row.name));
    expect(
      rows.filter((row) => row.kind === 'builtin').map((row) => row.name),
    ).toEqual(AGENT_TOOLS.map((tool) => tool.function.name));
    expect(names.has('crm_create_lead')).toBe(true);
    expect(names.has('mcp__c1__fetch')).toBe(true);
    expect(names.has('过审技能')).toBe(true);
    expect(names.has('过审插件')).toBe(true);
    // 先审后用：没过审的技能不进清单
    expect(rows.some((row) => row.name === '待审技能')).toBe(false);
    const connector = rows.find((row) => row.kind === 'connector');
    expect(connector?.source).toBe('测试连接器');
    expect(connector?.write).toBe(true);
  });

  it('业务工具带 operationId/权限人话/计量口径；红线可见', () => {
    const rows = buildAgentToolManifest({
      connectorTools: [],
      skills: [],
      plugins: [],
    });
    const lead = rows.find((row) => row.name === 'crm_create_lead');
    expect(lead?.operationId).toBe('Crm_createLead');
    expect(lead?.write).toBe(true);
    expect(lead?.permission).toBeTruthy();
    const stock = rows.find((row) => row.name === 'erp_check_stock');
    expect(stock?.write).toBe(false);
    const recruit = rows.find(
      (row) => row.name === 'recruit_update_application',
    );
    expect(recruit?.forbiddenReason).toBe('投递状态变更需要本人确认');
    const chromeStart = rows.find((row) => row.name === 'chrome_start_session');
    expect(chromeStart?.operationId).toBe('RpaChrome_startSession');
    expect(chromeStart?.permission).toBe('发起浏览器自动操作');
    expect(chromeStart?.write).toBe(true);
    const chromeList = rows.find((row) => row.name === 'chrome_list_devices');
    expect(chromeList?.write).toBe(false);
  });

  it('模型工具面排除红线动作；其余业务工具全部可调用', () => {
    const specs = businessToolSpecs();
    const names = specs.map((spec) => String(spec.function.name));
    expect(names).not.toContain('recruit_update_application');
    expect(names).toContain('crm_create_lead');
    expect(names).toContain('data_table_add_row');
    expect(names).toContain('erp_check_stock');
    expect(names).toContain('oa_start_flow');
    expect(names).toContain('chrome_list_devices');
    expect(names).toContain('chrome_start_session');
    expect(names).toContain('chrome_stop_session');
    expect(names).toHaveLength(BUSINESS_TOOLS.length - 1);
  });

  it('businessToolOf 能按名取回规格（含红线项）', () => {
    expect(businessToolOf('recruit_update_application')?.callable).toBe(false);
    expect(businessToolOf('oa_start_flow')?.operationId).toBe('Oa_submit');
    expect(businessToolOf('nope')).toBeUndefined();
  });
});
