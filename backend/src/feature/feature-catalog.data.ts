/**
 * §5.10 功能目录种子与「code → API 前缀」映射（方案设计的代码侧常量）。
 *
 * - 目录树与 frontend/src/config/routes.ts 的 enterpriseRoute 六组菜单一一对应（懒播种进 feature_catalog 表）；
 * - DB 行只存展示与状态（title/path/protected/sortOrder），API 前缀映射放这里，改映射＝发版、改状态＝后台点开关；
 * - 拦截按「最长前缀命中」：/enterprise/content/digital-assets/upload 先命中 assets，再落 content-tools 的 /enterprise/content；
 * - 不映射的共享通道（/enterprise/connections、/enterprise/market/:domain、/enterprise/external、
 *   /enterprise/services、/enterprise/capabilities 等被多板块共用）一律不拦截，避免关一个板块误伤一片；
 * - menu-only 功能（聚合页、外链、文档页）不给 apiPrefixes，只控制菜单显隐，不拦后端。
 */

export type FeatureSeedKind = 'GROUP' | 'MENU';

export interface FeatureSeedNode {
  code: string;
  kind: FeatureSeedKind;
  /** 父节点 code；顶级分组为空串 */
  parentCode: string;
  title: string;
  /** 前端路径（外链原样存）；GROUP 为空串 */
  path: string;
  /** protected＝不可关（认证会话/平台管理自身/账户计费/合规退出），求值强制 open */
  protected: boolean;
  sortOrder: number;
}

const group = (
  code: string,
  title: string,
  sortOrder: number,
  parentCode = '',
  protectedFlag = false,
): FeatureSeedNode => ({
  code,
  kind: 'GROUP',
  parentCode,
  title,
  path: '',
  protected: protectedFlag,
  sortOrder,
});
const menu = (
  code: string,
  parentCode: string,
  title: string,
  path: string,
  sortOrder: number,
  protectedFlag = false,
): FeatureSeedNode => ({
  code,
  kind: 'MENU',
  parentCode,
  title,
  path,
  protected: protectedFlag,
  sortOrder,
});

/** 与前端 enterpriseRoute 同构的种子树；ensureSeed 只补插缺失 code，不覆盖管理员改过的行。 */
export const FEATURE_SEED: FeatureSeedNode[] = [
  // ---------- 工作台 ----------
  group('workbench', '工作台', 10),
  menu('agent', 'workbench', 'Agent', '/agent', 10),
  menu('workbuddy', 'workbench', 'Workbuddy 企业云', '/workbuddy', 20),
  menu('data-table', 'workbench', '多维表格', '/data-table', 30),
  menu('rpa', 'workbench', 'RPA自动化', '/rpa', 40),
  group('content-creation', '内容创作', 50, 'workbench'),
  menu('content-tools', 'content-creation', '内容创作小工具', '/content', 10),
  menu('community', 'content-creation', '创意社区', '/community', 20),
  menu(
    'video-templates',
    'content-creation',
    '视频模版',
    '/content/video-templates',
    30,
  ),
  menu('marketing-tools', 'workbench', '营销工具', '/marketing-tools', 60),
  // 企微 SCRM 是营销工具页内的一张工具卡（8 个页签），单独建 code 以便整卡关闭
  menu(
    'wecom-scrm',
    'marketing-tools',
    '企业微信 SCRM',
    '/marketing-tools?tab=wecom-scrm',
    10,
  ),
  menu('assets', 'workbench', '数字资产管理', '/assets', 70),
  menu('mail', 'workbench', 'AI邮箱服务', '/mail', 80),
  menu('crm', 'workbench', 'CRM', '/crm', 90),
  menu('bi', 'workbench', 'BI智能分析', '/bi', 100),
  menu('oa', 'workbench', 'OA', '/oa', 110),
  menu('okr', 'workbench', 'OKR计划', '/okr', 120),
  menu('service-desk', 'workbench', 'AI客服', '/service-desk', 130),
  menu('app-center', 'workbench', '应用中心', '/app-center', 140),
  menu('question-hall', 'workbench', '专题大厅', '/question-hall', 150),
  menu('kb', 'workbench', '知识库', '/kb', 160),
  menu('hrm', 'workbench', 'HR工作台', '/hrm', 170),
  menu('project', 'workbench', '项目管理', '/project', 180),
  menu('erp', 'workbench', '进销存', '/erp', 190),
  // ---------- 业务服务 ----------
  group('business-services', '业务服务', 20),
  menu('marketing', 'business-services', '营销服务', '/marketing', 10),
  menu('supply', 'business-services', '供销网络', '/supply', 20),
  menu('tax', 'business-services', '财税服务', '/tax', 30),
  menu('overseas', 'business-services', '跨境出海', '/overseas', 40),
  menu('flex', 'business-services', '灵活用工', '/flex', 50),
  menu('logistics', 'business-services', '物流服务', '/logistics', 60),
  menu('smart', 'business-services', 'IT服务', '/smart', 70),
  menu('ip', 'business-services', '知识产权', '/ip', 80),
  menu('legal', 'business-services', '法律服务', '/legal', 90),
  menu('think-tank', 'business-services', '智库服务', '/think-tank', 100),
  menu('asset-trading', 'business-services', '资产交易', '/asset', 110),
  menu('market-hub', 'business-services', '供需市场', '/market', 120),
  // ---------- 商务人脉 ----------
  group('networking', '商务人脉', 30),
  menu('social', 'networking', '商务社交', '/social', 10),
  menu('hiring', 'networking', '招聘', '/hiring', 20),
  // ---------- 管理设置（identity/points/invite 属合规退出与账户计费，protected 不可关） ----------
  group('manage-settings', '管理设置', 40),
  menu('identity', 'manage-settings', '身份与资质', '/identity', 10, true),
  menu('staff', 'manage-settings', '职员/代理人管理', '/staff', 20),
  menu('contracts', 'manage-settings', '签约管理', '/contracts', 30),
  menu('points-center', 'manage-settings', '积分中心', '/points', 40, true),
  menu('invite', 'manage-settings', '我的邀请', '/invite', 50, true),
  // ---------- 开放集成（api-keys 是认证会话底座，protected 不可关） ----------
  group('open-integration', '开放集成', 50),
  menu(
    'developer-keys',
    'open-integration',
    'API Key 管理',
    '/developer/keys',
    10,
    true,
  ),
  menu('model-plaza', 'open-integration', '模型广场', '/model-plaza', 15),
  menu('model-settings', 'open-integration', '模型设置', '/model-settings', 20),
  // API 文档 / MCP Server / Skill 下载三页签合一，沿用原 MCP Server 的排序位置
  menu(
    'api-mcp-skill',
    'open-integration',
    'API-MCP-Skill',
    '/developer/api-mcp-skill',
    30,
  ),
  menu(
    'developer-mechanisms',
    'open-integration',
    '平台机制',
    '/developer/mechanisms',
    50,
  ),
  // ---------- 智能硬件（「开放集成」下的子分组，与前端三级菜单同构） ----------
  group('hardware', '智能硬件', 60, 'open-integration'),
  menu('hardware-plaza', 'hardware', '硬件广场', '/hardware', 10),
  menu('hardware-devices', 'hardware', '添加硬件', '/hardware/devices', 20),
  menu('hardware-mcp', 'hardware', '硬件MCP', '/hardware/mcp', 30),
  menu('hardware-api', 'hardware', '硬件API', '/hardware/api', 40),
  // ---------- AI增值服务（外链，menu-only） ----------
  group('ai-services', 'AI增值服务', 60),
  menu('ai-compute', 'ai-services', '算力服务', 'https://app.aipdd.work', 10),
  menu('ai-a2a', 'ai-services', 'A2A供需平台', 'https://www.aiworkin.com', 20),
];

/**
 * 功能 code → 后端 API 前缀（拦截口径：命中前缀即要求该 code 及其全部祖先 GROUP open）。
 * 与 packages/contracts 端点段一一对齐；hiring 前缀是 /enterprise/social/hiring（长于 social 的 /enterprise/social）。
 */
export const FEATURE_API_PREFIXES: Record<string, string[]> = {
  agent: ['/enterprise/agent', '/enterprise/skillhub'],
  workbuddy: ['/enterprise/workbuddy'],
  'data-table': ['/enterprise/data-tables'],
  rpa: ['/enterprise/rpa'],
  // 内容创作聚合页板块：PDP 详情页工具与多平台分发都归这一块；digital-assets 单独由 assets 接管（最长前缀）
  'content-tools': [
    '/enterprise/content',
    '/enterprise/distribution',
    '/enterprise/ecom-pdp',
    '/enterprise/domestic-pdp',
  ],
  assets: ['/enterprise/content/digital-assets'],
  community: ['/enterprise/community'],
  // 视频模版单独成码：前缀比 /enterprise/content 长，关闭模版不影响其它内容工具
  'video-templates': ['/enterprise/content/video-templates'],
  // 营销工具聚合页的独立后端域（达人建联走共享 connections 通道，不映射）
  'marketing-tools': [
    '/enterprise/geo',
    '/enterprise/seo',
    '/enterprise/lead-prospecting',
    '/enterprise/bigdata',
    '/enterprise/aliyun-call',
    '/enterprise/aliyun-mail',
    '/enterprise/tencent-qidian',
    '/enterprise/mkt',
    '/enterprise/acquisition',
    '/enterprise/wecom-scrm',
  ],
  mail: ['/enterprise/mail'],
  crm: ['/enterprise/crm'],
  bi: ['/enterprise/bi'],
  oa: ['/enterprise/oa'],
  okr: ['/enterprise/okr'],
  'service-desk': ['/enterprise/service-desk'],
  project: ['/enterprise/project'],
  erp: ['/enterprise/erp'],
  'app-center': ['/enterprise/apps', '/enterprise/lowcode'],
  'question-hall': ['/enterprise/question-hall'],
  hrm: ['/enterprise/hrm'],
  marketing: ['/enterprise/marketing'],
  supply: ['/enterprise/supply'],
  tax: ['/enterprise/tax', '/enterprise/invoice-requests', '/enterprise/qxy'],
  overseas: ['/enterprise/overseas'],
  flex: ['/enterprise/flex'],
  logistics: ['/enterprise/logistics'],
  smart: ['/enterprise/smart'],
  ip: ['/enterprise/ip'],
  legal: ['/enterprise/legal'],
  'think-tank': ['/enterprise/think-tank'],
  'asset-trading': ['/enterprise/asset'],
  // 供需市场读写走共享通道 /enterprise/market/:domain（与各板块同一前缀），只做菜单显隐不单独拦截
  'market-hub': [],
  social: ['/enterprise/social', '/enterprise/sns'],
  hiring: ['/enterprise/social/hiring', '/enterprise/recruit'],
  staff: ['/enterprise/staff', '/enterprise/org-staff'],
  contracts: ['/enterprise/contracts'],
  // 模型广场：站内目录/试用/用量 + 对外 OpenAI 兼容网关（/v1 在根 app 上，由网关内自行校验开关）
  'model-plaza': ['/enterprise/model-plaza'],
  // model-settings 的后端落在 /enterprise/content/* 里（与内容创作共通道），只做菜单显隐不单独拦截
  'model-settings': [],
  // API-MCP-Skill：MCP 服务端端点（contracts MCP_ENDPOINT_PATH = /api/v1/mcp）关掉即整个
  // MCP 通道 403；Skill 页签的生成包列表与下载同属该菜单开关。
  'api-mcp-skill': ['/api/v1/mcp', '/enterprise/generated-skills'],
  // 平台机制：事件与外发、批量数据、报表与规则、公开分享、身份源与 IM 同步（附件共享策略在 /enterprise/mechanisms 下）
  'developer-mechanisms': [
    '/enterprise/webhooks',
    '/enterprise/import',
    '/enterprise/export',
    '/enterprise/reports',
    '/enterprise/rules',
    '/enterprise/shares',
    '/enterprise/oidc',
    '/enterprise/im-sync',
    '/enterprise/mechanisms',
  ],
  // 智能硬件：用户侧与后台共用 /enterprise/hardware；对外机器通道 /api/v1/hardware（含 MCP 端点）。
  // 设备通道 /api/public/hardware/** 刻意不映射——关板块不能把已接入设备的心跳掐死。
  hardware: ['/enterprise/hardware', '/api/v1/hardware'],
  'hardware-plaza': [],
  'hardware-devices': [],
  'hardware-mcp': [],
  'hardware-api': [],
  'ai-compute': [],
  'ai-a2a': [],
};

/**
 * protected 基础设施前缀：中间件直接跳过（不查开关、永远不会 FEATURE_CLOSED）。
 * 覆盖方案 §5.10 四类保护组：认证会话 / 平台管理自身 / 账户计费 / 合规退出。
 */
export const PROTECTED_PATH_PREFIXES = [
  '/api/auth',
  '/api/session',
  '/api/points-config',
  '/enterprise/auth',
  '/enterprise/session',
  '/enterprise/me',
  '/enterprise/admin',
  '/enterprise/platform',
  '/enterprise/account',
  '/enterprise/identity',
  '/enterprise/points',
  '/enterprise/api-keys',
  '/enterprise/notifications',
  '/enterprise/help',
];
