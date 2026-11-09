import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Agent 能力底座（技能 / 插件 / MCP 连接器 / 定时任务 / 授权闸）的安全不变量守卫。
 *
 * 这里只做静态断言：盯「这道闸还在不在、默认是不是最严那一档」，不盯排版与行号。
 * 目的是让后续重构不能顺手把安全默认改宽——改宽必须显式改本脚本，并在 PR 里说清为什么。
 */
const root = resolve(import.meta.dirname, '..');
const cache = new Map();
function source(file) {
  if (!cache.has(file)) {
    cache.set(file, readFileSync(join(root, file), 'utf8'));
  }
  return cache.get(file);
}
function has(file, pattern, message) {
  // 不用 assert.match：失败时它会把整份源码贴进日志，反而看不出少了哪道闸
  assert.ok(pattern.test(source(file)), `${file} 安全闸门缺失：${message}`);
}
function lacks(file, pattern, message) {
  assert.ok(
    !pattern.test(source(file)),
    `${file} 出现不该有的写法：${message}`,
  );
}
function count(file, pattern) {
  return [...source(file).matchAll(new RegExp(pattern.source, 'g'))].length;
}

const TRANSPORT = 'backend/src/http/transport.ts';
const GUARD = 'backend/src/http/outbound-guard.ts';
const MCP_CLIENT = 'backend/src/content/agent-mcp.client.ts';
const CONNECTORS = 'backend/src/content/agent-connectors.service.ts';
const SKILLS = 'backend/src/content/agent-skills.service.ts';
const PLUGINS = 'backend/src/content/agent-plugins.service.ts';
const REVISIONS = 'backend/src/content/agent-revisions.ts';
const SCHEDULE = 'backend/src/content/agent-schedule.service.ts';
const MCP_SERVICE = 'backend/src/mcp/mcp.service.ts';
const MEMORY = 'backend/src/agent-memory/agent-memory.service.ts';
const CONFIRM = 'backend/src/common/confirm-password.ts';
const TEXT_SAFETY = 'backend/src/common/text-safety.ts';
const LOGGER = 'backend/src/common/logger.ts';
const SESSION = 'backend/src/auth/session.ts';
const SCHEMA = 'backend/prisma/schema.prisma';
const SCHEMA_PG = 'backend/prisma/schema.postgres.prisma';
/** PostgreSQL 版是 `pnpm db:gen:pg` 从 schema.prisma 派生的生产物、按约定不入库；本地存在时顺带校验，CI 只验事实源。 */
const SCHEMA_TARGETS = [SCHEMA, SCHEMA_PG].filter((file) => existsSync(join(root, file)));
const MIGRATION = 'backend/prisma/migrations/0011_agent_security/migration.sql';
/** B0 连接器授权闸：授权行按「整条连接器」独立粒度，迁移必须带出 scope_type / connector_id。 */
const MIGRATION_CONNECTOR =
  'backend/prisma/migrations/0041_connector_grant/migration.sql';
const SCHEDULES_TAB = 'frontend/src/app/agent/_components/schedules-tab.tsx';
const GRANTS_PANEL = 'frontend/src/app/agent/_components/grants-panel.tsx';
const AGENT_COMMON = 'frontend/src/app/agent/_components/common.ts';
const CONTROLLER = 'backend/src/content/content.controller.ts';
const CONTRACT = 'packages/contracts/src/content.ts';
const HANDLERS = 'backend/src/http/automation-routes.ts';

test('出站守卫默认最严：内网/回环拒绝，明文 http 只在开发环境的回环放行', () => {
  for (const range of [
    '10.0.0.0',
    '127.0.0.0',
    '169.254.0.0',
    '192.168.0.0',
  ]) {
    has(
      GUARD,
      new RegExp(range.replace(/\./g, '\\.')),
      `${range} 段必须列入拒绝范围`,
    );
  }
  has(GUARD, /dev && loopback && url\.protocol === 'http:'/, '明文 http 只能开发环境 + 回环');
  lacks(GUARD, /if \(dev\) return url/, '不能「开发环境一律放行」');
  // 连接器的地址在写入与探测两处都要过守卫，不能只在界面上提示
  assert.ok(
    count(CONNECTORS, /assertOutboundUrl(Sync)?\(/) >= 3,
    `${CONNECTORS} 保存/探测/运行都要过出站守卫`,
  );
});

test('传输层不跟随跳转，响应体与 SSE 都有字节上限', () => {
  has(TRANSPORT, /maxBytes/, '传输层必须截断超大响应');
  has(TRANSPORT, /readCappedBody/, '超限要在读取阶段掐断，而不是读完再裁');
  lacks(TRANSPORT, /redirect:\s*['"]follow['"]/, '禁止自动跟随跳转');
  has(MCP_CLIENT, /assertNoRedirect/, 'MCP 客户端要显式拒绝 3xx');
  has(MCP_CLIENT, /status >= 300[\s\S]{0,32}status < 400/, '3xx 判定范围');
  has(MCP_CLIENT, /MAX_RESPONSE_BYTES/, 'JSON 响应上限');
  has(MCP_CLIENT, /MAX_SSE_BYTES/, 'SSE 缓冲上限');
  has(MCP_CLIENT, /RESULT_TEXT_LIMIT/, '工具结果文本要截断后再进上下文');
});

test('外部内容当数据块喂给模型，且不允许自己闭合围栏', () => {
  has(TEXT_SAFETY, /export function fenceExternal/, '围栏函数必须在');
  has(TEXT_SAFETY, /＜/, '正文里的尖括号要折成全角，否则外部内容能提前闭合围栏');
  has(TEXT_SAFETY, /\[\^A-Za-z0-9_-\]/, '围栏标记要白名单化');
  has(CONNECTORS, /fenceExternal\(/, '连接器返回的正文必须加围栏');
});

test('无人值守默认拒绝全部写动作，放开只能逐任务显式勾选', () => {
  has(MCP_SERVICE, /export function unattendedDenialOf/, '无人值守判定要能单测');
  has(MCP_SERVICE, /call\?\.trigger !== 'schedule'/, '只有无人值守这一层受默认拒绝约束');
  has(MCP_SERVICE, /call\.allowWrite === true/, '放开写动作只认布尔 true，字符串不算开');
  has(MCP_SERVICE, /SCHEDULE_DENIED_ACTIONS/, 'OKR 口径类动作即便放开也逐条拒');
  assert.ok(
    count(MCP_SERVICE, /Okr_/) >= 4,
    'SCHEDULE_DENIED_ACTIONS 至少覆盖 OKR 的口径类动作',
  );
  has(MCP_SERVICE, /unattendedDenialOf\(operationId, call\)/, 'writeData 必须真的调用闸门');
  has(MCP_SERVICE, /!scheduleBlocked/, '被闸门挡下时不得执行');
  has(SCHEDULE, /allowWrite: schedule\.allowWrite === true/, '执行时按任务自身开关透传，不做宽松转换');
});

test('放开权限的写入要二次验密，验密本身也被限流', () => {
  has(CONFIRM, /new RateWindow\(/, 'bcrypt 是故意的慢，入口必须限流');
  has(CONFIRM, /bcrypt\.compare\(/, '要比对哈希，不能存明文或只判非空');
  has(CONFIRM, /status !== 'ACTIVE'/, '封号账号即便密码对也不能放开权限');
  lacks(CONFIRM, /throw[\s\S]{0,120}\$\{password\}/, '异常文案里绝不能带出密码');
  has(MEMORY, /async saveGrants\([\s\S]{0,120}password\?[\s\S]{0,60}connectorIds: number\[\]/, '保存授权要收密码参数（并带连接器清单）');
  has(MEMORY, /if \(toAdd\.length \|\| connectorsToAdd\.length\)[\s\S]{0,200}assertSensitivePassword\(/, '只在新增授权（动作或连接器）时验密，收回授权不设门槛');
  has(SCHEDULE, /assertWritePassword/, '定时任务放开写动作要验密');
  has(SCHEDULE, /existing\.allowWrite !== true/, '只有「从关到开」才验密');
  has(SESSION, /VERIFY_PER_USER/, '验密端点要按账号限流');
  has(SESSION, /VERIFY_PER_IP/, '验密端点要按来源兜底限流');
  has(SESSION, /ErrorCode\.RATE_LIMITED\.code, throttled\), 429/, '超限要回 429，而不是继续比对');
});

test('技能/插件/连接器有配额与按账号限流，进提示词的摘要有条数与字符预算', () => {
  for (const [file, name] of [
    [SKILLS, 'MAX_SKILLS'],
    [PLUGINS, 'MAX_PLUGINS'],
    [CONNECTORS, 'MAX_CONNECTORS'],
    [CONNECTORS, 'MAX_TOTAL_TOOLS'],
  ]) {
    has(file, new RegExp(`const ${name} = \\d+`), `${name} 必须是个具体数字`);
    has(file, new RegExp(`${name}\\)`), `${name} 要真的用于判定超限`);
  }
  for (const file of [SKILLS, PLUGINS]) {
    has(file, /new RateWindow\(/, `${file} 上传/安装要限流`);
    has(file, /SUMMARY_MAX/, `${file} 摘要要有条数上限`);
    has(file, /SUMMARY_BUDGET/, `${file} 摘要要有字符预算`);
    has(file, /take: SUMMARY_MAX \+ 1/, `${file} 多取一条才能知道「还有没列出的」`);
    has(file, /仅列出前/, `${file} 截断时要告诉模型还有未列出的`);
    has(file, /toSingleLine/, `${file} 摘要里的名字/描述要压成一行，防止撑破提示词结构`);
  }
  has(CONNECTORS, /probeLimiter/, '连接器探测要限流');
});

test('同名覆盖前留版本快照，可查可回滚，且两种方言都建了表', () => {
  has(REVISIONS, /export (async )?function saveAgentRevision/, '快照写入入口');
  has(REVISIONS, /export (async )?function readAgentRevision/, '快照读取入口');
  has(REVISIONS, /export (async )?function listAgentRevisions/, '快照清单入口');
  for (const file of [SKILLS, PLUGINS]) {
    assert.ok(count(file, /saveAgentRevision\(/) >= 1, `${file} 覆盖前必须留快照`);
    // 回滚入口叫 restore（界面上的「回到这一版」），不能只存不取
    assert.ok(count(file, /async restore\(/) >= 1, `${file} 缺回滚入口 restore`);
    assert.ok(count(file, /async revisions\(/) >= 1, `${file} 缺快照清单入口 revisions`);
  }
  has(CONTROLLER, /restoreSkill\(/, '控制器要暴露技能回滚');
  has(CONTROLLER, /restorePlugin\(/, '控制器要暴露插件回滚');
  has(CONTRACT, /Content_restoreSkill:/, '技能回滚要在契约层登记端点');
  has(CONTRACT, /Content_restorePlugin:/, '插件回滚要在契约层登记端点');
  has(HANDLERS, /Content_restoreSkill:/, '技能回滚要接到控制器 handler');
  has(HANDLERS, /Content_restorePlugin:/, '插件回滚要接到控制器 handler');
  for (const file of SCHEMA_TARGETS) {
    has(file, /model ContentAgentRevision/, `${file} 缺 ContentAgentRevision`);
    has(file, /allowWrite\s+Boolean\s+@default\(false\)/, `${file} 的 allowWrite 默认必须是 false`);
  }
  has(MIGRATION, /ADD COLUMN `allow_write` BOOLEAN NOT NULL DEFAULT false/, '存量任务一律先收紧');
  has(MIGRATION, /CREATE TABLE `content_agent_revisions`/, '快照表要随迁移建好');
});

test('能力底座的增删改启用都留痕', () => {
  assert.ok(count(SKILLS, /identity\.audit\(/) >= 5, `${SKILLS} 技能增删改/回滚要有审计`);
  assert.ok(count(PLUGINS, /identity\.audit\(/) >= 7, `${PLUGINS} 插件增删改/安装/回滚要有审计`);
  assert.ok(count(CONNECTORS, /identity\.audit\(/) >= 3, `${CONNECTORS} 连接器增删改/启用要有审计`);
});

test('日志与审计不带出凭据', () => {
  has(LOGGER, /\|password\|/, 'password 字段要在脱敏名单里');
  has(LOGGER, /Bearer\\s\+\[/, 'Authorization 头要脱敏');
  for (const file of [CONFIRM, SCHEDULE, MEMORY]) {
    lacks(file, /\$\{password\}/, `${file} 不能把密码拼进文案`);
  }
});

test('前端不替用户默认放开写动作，放开与新增授权都要弹窗验密', () => {
  has(SCHEDULES_TAB, /allowWrite: false,/, '新建定时任务默认关写动作');
  has(SCHEDULES_TAB, /editor\.allowWrite && !editor\.originAllowWrite/, '只有「从关到开」弹窗');
  has(SCHEDULES_TAB, /usePasswordConfirm\(\)/, '定时任务用验密弹窗');
  has(GRANTS_PANEL, /usePasswordConfirm\(\)/, '授权面板用验密弹窗');
  has(GRANTS_PANEL, /if \(!addedCount && !addedConnectors\)/, '没新增授权（动作或连接器）时不打扰用户');
  has(GRANTS_PANEL, /persist\(password\)/, '验过的密码要真的传给服务端');
  has(AGENT_COMMON, /saveGrants: \(actions: string\[\], connectorIds: number\[\], password\?: string\)/, '请求体带上密码字段');
});

test('自建连接器的工具默认不执行：按整条连接器授权，未授权/无人值守只回草案并留痕', () => {
  has(CONNECTORS, /connectorGate\(/, '运行期必须有连接器授权闸');
  has(CONNECTORS, /grantedConnectors\(/, '闸门要读本人已授权的连接器 id');
  has(CONNECTORS, /工具执行失败：/, '被拦时回的文案要能被上层判为失败，不能算成功');
  has(CONNECTORS, /NOT_GRANTED/, '未授权的拦截原因要可区分');
  has(CONNECTORS, /SCHEDULE_DENIED/, '无人值守的拦截原因要可区分');
  has(MEMORY, /async grantedConnectors\(userId: string\): Promise<Set<number>>/, '授权清单要能按连接器粒度读');
  has(MEMORY, /GRANT_SCOPE_CONNECTOR/, '连接器授权行要有独立粒度，不混进契约动作');
  has(MEMORY, /connectorId,/, '连接器授权行要真的写 connector_id');
  has(MIGRATION_CONNECTOR, /`scope_type`/, '迁移要加授权粒度列');
  has(MIGRATION_CONNECTOR, /agent_action_grants_scope_key/, '唯一键要含连接器列，否则一个账号只能放开一条');
});
