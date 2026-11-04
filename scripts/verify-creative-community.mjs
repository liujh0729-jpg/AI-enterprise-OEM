import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * 创意社区（Comfy Cloud 工作流市场）的安全与业务不变量守卫。
 *
 * 与 verify-agent-security.mjs 同风格：只做静态断言，盯「这道闸还在不在、默认是不是最严那一档」，
 * 不盯排版与行号。这个模块的泄漏面比一般业务大——它会带着用户凭据往外部域名发请求、
 * 还会把用户提交的图 JSON 当作可执行的工作流交给上游，所以以下每一条都是当年刻意收紧的结果，
 * 要放宽必须显式改本脚本并在 PR 里说清为什么。
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
  assert.ok(pattern.test(source(file)), `${file} 闸门缺失：${message}`);
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
/** 取两个标记之间的片段，用来盯「某个载荷里有没有某几列」这种局部约束。 */
function between(file, start, end, message) {
  const text = source(file);
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${file} 找不到片段起点：${message}（起点 ${start}）`);
  const to = text.indexOf(end, from);
  assert.ok(to > from, `${file} 找不到片段终点：${message}（终点 ${end}）`);
  return text.slice(from, to);
}
/** 目录里所有实现文件（跳过单测：单测允许出现被禁写法的反面样本）。 */
function implementations(dir) {
  const abs = join(root, dir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const name = join(dir, entry.name);
    if (entry.isDirectory()) return implementations(name);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.spec.ts')
      ? [name]
      : [];
  });
}

const CLIENT = 'backend/src/community/comfy.client.ts';
const CRYPTO = 'backend/src/community/comfy-crypto.ts';
const REGISTRY = 'backend/src/community/community-workflow-registry.ts';
const SERVICE = 'backend/src/community/community.service.ts';
const AWARD = 'backend/src/community/community-award.service.ts';
const SCHEDULER = 'backend/src/community/community-run.scheduler.ts';
const CONTROLLER = 'backend/src/community/community.controller.ts';
const SERVICES = 'backend/src/http/services.ts';
const HANDLERS = 'backend/src/http/automation-routes.ts';
const MAIN = 'backend/src/main.ts';
const APP = 'backend/src/http/app.ts';
const LOGGER = 'backend/src/common/logger.ts';
const CONTRACT = 'packages/contracts/src/community.ts';
const ENDPOINTS = 'packages/contracts/src/endpoints.ts';
const SCHEMA = 'backend/prisma/schema.prisma';
const SCHEMA_PG = 'backend/prisma/schema.postgres.prisma';
/** PostgreSQL 版是 `pnpm db:gen:pg` 从 schema.prisma 派生的生产物、按约定不入库；本地存在时顺带校验，CI 只验事实源。 */
const SCHEMA_TARGETS = [SCHEMA, SCHEMA_PG].filter((file) => existsSync(join(root, file)));
const MIGRATION = 'backend/prisma/migrations/0012_creative_community/migration.sql';
const SEED = 'backend/prisma/seed-creative-community.ts';
const SEED_ENTRY = 'backend/prisma/seed.ts';
const FRONT_API = 'frontend/src/api/community.ts';
const ROUTES = 'frontend/src/config/routes.ts';
const MESSAGES = 'frontend/src/lib/i18n/messages.ts';
const ADMIN_PAGE = 'frontend/src/app/admin/[section]/page.tsx';
const CONNECT = 'frontend/src/app/community/_components/comfy-connect-modal.tsx';
const PUBLISH = 'frontend/src/app/community/_components/publish-modal.tsx';
const IMPORT_SERVICE = 'backend/src/community/community-import.service.ts';
const CONVERT = 'backend/src/community/community-comfy-convert.ts';

test('出站只经统一传输层，社区模块里不许自己 fetch', () => {
  for (const file of implementations('backend/src/community')) {
    lacks(
      file,
      /(?<![\w.$])fetch\s*\(/,
      '所有出站要走 http/transport.ts（并发、超时、字节上限、日志才统一生效）',
    );
  }
  has(CLIENT, /httpRequest/, '上游唯一出口');
  has(CLIENT, /const COMFY_ORIGIN = 'https:\/\/cloud\.comfy\.org'/, 'Base URL 是官方 Comfy Cloud');
  has(CLIENT, /x-api-key/, 'v1 接口（object_info）用 X-API-Key 头');
  has(CLIENT, /authorization: `Bearer \$\{apiKey\}`/, 'v2 接口用 Bearer');
});

test('下载逐跳校验主机白名单，禁自动跟随跳转，正文一律限字节', () => {
  has(CLIENT, /downloadHostAllowed/, '跳转目标必须逐跳过白名单');
  has(CLIENT, /\.storage\.googleapis\.com/, '官方 GCS 签名域');
  has(CLIENT, /\.amazonaws\.com/, '官方 S3 签名域');
  has(CLIENT, /OSS_HOST/, '本站桶域也在白名单内');
  assert.ok(count(CLIENT, /assertOutboundUrl/) >= 4, '每个出站分支都要过 DNS 级守卫');
  assert.ok(
    count(CLIENT, /redirect: 'manual'/) >= 3,
    '请求/上传/下载三处都要显式 manual',
  );
  lacks(CLIENT, /redirect:\s*['"]follow['"]/, '禁止自动跟随跳转');
  has(
    CLIENT,
    /MAX_DOWNLOAD_BYTES = \{[\s\S]{0,240}video: 500 \* 1024 \* 1024/,
    '视频转存上限 500MB',
  );
  has(CLIENT, /image: 50 \* 1024 \* 1024/, '图片上限 50MB（与上游图片输入上限一致）');
  assert.ok(count(CLIENT, /maxBytes/) >= 4, '每个请求都要带字节上限');
  has(CLIENT, /MAX_OBJECT_INFO_BYTES/, 'object_info 也要限大小');
});

test('纯 BYOK：平台不留兜底 Key，未绑定就不许运行', () => {
  // 兜底 Key 一旦进代码，「跑的是自己的订阅积分」这条承诺就假了
  for (const file of implementations('backend/src')) {
    lacks(file, /COMFY_API_KEY/, '后端不接受平台侧 Comfy Key 环境变量');
  }
  has(SERVICE, /KEY_UNBOUND_MESSAGE/, '未绑 Key 要有可执行的引导文案');
  has(
    SERVICE,
    /throw new BusinessException\(\s*ErrorCode\.VALIDATION_ERROR,\s*KEY_UNBOUND_MESSAGE\s*,?\s*\)/,
    '取不到 Key 必须抛，而不是静默降级',
  );
  has(SERVICE, /本站不代付|自己的 Comfy Cloud 账号与订阅积分/, '文案要说清算力归属');
  // 浏览型卡片（UI 格式）不许假装能跑
  has(SERVICE, /row\.format !== 'api'/, '非 API 格式一律拒绝运行');
  has(SERVICE, /runnable: row\.format === 'api'/, '列表按格式标注可直接运行');
});

test('Key 密文入库、独立加密域、永不回显、不进日志', () => {
  has(CRYPTO, /createCipheriv\(\s*'aes-256-gcm'/, 'AES-256-GCM');
  has(CRYPTO, /EXTERNAL_CRED_KEY/, '密钥源沿用外部凭据主密钥');
  has(CRYPTO, /aiworkin-comfy-community/, '独立的加密上下文（一处泄漏不解开别的域）');
  has(CRYPTO, /getAuthTag\(\)/, 'GCM 认证标签要落进密文');
  has(CRYPTO, /export function maskComfyKey/, '掩码口径在社区域内可用');
  // 契约层是对外形状：只允许掩码，出现密文列就是泄漏面
  has(CONTRACT, /keyMask: z\.string\(\)/, '状态端点回掩码');
  lacks(CONTRACT, /keyCipher/, '密文绝不能出现在响应契约里');
  has(LOGGER, /key\[-_\]\?cipher\|comfy\[-_\]\?api\[-_\]\?key/, '密文与 Key 都要在日志脱敏名单里');
  lacks(SERVICE, /logger\.[\w.]+\([^)]*apiKey/, '日志里不许拼明文 Key');
});

test('发布校验：只收 API 格式，节点数/体积/槽位数封顶，危险节点与凭据字段拒收', () => {
  has(REGISTRY, /COMMUNITY_NODE_LIMIT = 120/, '节点数上限');
  has(REGISTRY, /COMMUNITY_JSON_LIMIT = 2 \* 1024 \* 1024/, '序列化体积上限');
  has(REGISTRY, /COMMUNITY_SLOT_LIMIT = 40/, '槽位数上限');
  has(REGISTRY, /const UI_FORMAT_KEYS = \['nodes', 'links'/, 'UI/save 格式特征键');
  const dangerous = between(
    REGISTRY,
    'const DANGEROUS_NODE_NAMES = new Set([',
    ']);',
    '危险节点名单',
  );
  const names = dangerous.match(/^\s*'[^']+',/gm) || [];
  assert.ok(names.length >= 20, `危险节点名单太短（${names.length} 项），不能空转`);
  for (const name of ['SubprocessNode', 'AnyCodeExecution', 'ShellCommand', 'HttpRequest']) {
    assert.ok(names.some((line) => line.includes(name)), `危险节点必须覆盖 ${name}`);
  }
  has(REGISTRY, /DANGEROUS_WORD_SEGMENTS/, '名字表覆盖不到的按语义片段兜底');
  assert.ok(count(REGISTRY, /CREDENTIAL_KEY_PATTERN/g) >= 2, '凭据字段要粗筛 + 精确键名复核');
  has(REGISTRY, /partnerPrefixes\(\)/, 'partner 前缀只在环境变量显式放开时放行');
  lacks(REGISTRY, /COMMUNITY_NODE_PREFIX_ALLOWLIST \|\| '[A-Za-z]/, '默认不许内置放行前缀');
  has(REGISTRY, /object_info/, 'class_type 必须在册（未知节点直接拒）');
});

test('运行期槽位封闭覆盖：越界键直接拒，图片走本站换资产', () => {
  has(REGISTRY, /const declared = new Map\(slots\.map/, '以声明槽位为唯一白名单');
  has(REGISTRY, /不在这份工作流允许修改的范围内/, '越界参数要拒');
  has(REGISTRY, /slot\.type === 'image'[\s\S]{0,120}assetReference\(/, '图片槽换成 Comfy 资产引用');
  has(REGISTRY, /function assetReference/, '资产引用形状');
  has(SERVICE, /buildRunGraph\(/, '运行必须经建图函数，不许把用户 inputs 直接并进图');
  has(REGISTRY, /function coerce/, '数值/枚举槽位要收敛到允许区间与候选集');
});

test('提交运行、发布、验密、收藏与上传全部限流', () => {
  assert.ok(
    count(CONTROLLER, /new RateWindow\(/) >= 5,
    '五类动作各自独立窗口（运行/发布/验密/社交/上传）',
  );
  has(CONTROLLER, /new RateWindow\(20, 60_000\)/, '提交运行 20 次/分钟/人');
  has(CONTROLLER, /new RateWindow\(10, 24 \* 60 \* 60_000\)/, '发布 10 条/天/人');
  has(CONTROLLER, /new RateWindow\(10, 60_000\)/, 'Key 校验 10 次/分钟/人（每次都真打上游）');
  has(CONTROLLER, /new RateWindow\(60, 60_000\)/, '收藏点赞 60 次/分钟/人');
  assert.ok(
    count(CONTROLLER, /this\.limit\(/) >= 9,
    '每个写动作入口都要先过限流，不能只装在几个上',
  );
  has(CONTROLLER, /import.*RateWindow/, '限流用共用的 RateWindow，不是自己数数');
});

test('运行输入图上传走本站通道，体积上限与上游图片输入一致', () => {
  has(APP, /'\/enterprise\/community\/uploads'\) return 50 \* 1024 \* 1024/, 'body 上限 50MB');
  has(HANDLERS, /registerCommunityInputUpload\(/, '上传路由要挂载');
  has(HANDLERS, /communityController\.uploadInput/, '上传落进控制器（限流与审计都在那里）');
  has(FRONT_API, /enterprise\/community\/uploads/, '前端上传打本站端点');
  // 浏览器端不许直连上游：签名 URL 短命且需要 Key，只有后端能取
  for (const file of implementations('frontend/src/app/community')) {
    lacks(file, /cloud\.comfy\.org/, '前端不直接请求 Comfy Cloud');
  }
  lacks(FRONT_API, /https?:\/\/[\w.-]*comfy[\w.-]*\/api/, '前端 API 层不嵌上游地址');
});

test('契约端点与 handler 挂载两处一致，后台端点齐全', () => {
  for (const op of [
    'categories',
    'list',
    'detail',
    'favorite',
    'unfavorite',
    'like',
    'connectStatus',
    'saveCredential',
    'testCredential',
    'clearCredential',
    'run',
    'runStatus',
    'cancelRun',
    'myRuns',
    'myDrafts',
    'publish',
    'updateWorkflow',
    'unpublish',
  ]) {
    has(CONTRACT, new RegExp(`Community_${op}: \\{`), `Community_${op} 要在契约登记`);
  }
  for (const op of ['pending', 'decide', 'stats', 'settings', 'saveSettings']) {
    has(CONTRACT, new RegExp(`CommunityAdmin_${op}: \\{`), `CommunityAdmin_${op} 要在契约登记`);
    has(SERVICE, /requireAdmin\(/, '后台动作要校验平台管理员身份');
  }
  has(CONTRACT, /action: z\.enum\(\["approve", "reject", "recommend", "remove"\]\)/, '审核动作是封闭枚举');
  has(CONTRACT, /path: "\/enterprise\/admin\/community/, '后台端点走 admin 路径');
  has(ENDPOINTS, /import \{ communityEndpoints, communityAdminEndpoints \} from "\.\/community"/, 'endpoints 要 import 社区模块');
  has(ENDPOINTS, /\.\.\.communityEndpoints,/, 'endpoints 要 spread 社区端点');
  has(ENDPOINTS, /\.\.\.communityAdminEndpoints,/, 'endpoints 要 spread 社区后台端点');
  has(HANDLERS, /'Community_',/, '运行端点挂到控制器');
  has(HANDLERS, /'CommunityAdmin_',/, '后台端点挂到控制器');
  assert.ok(count(SERVICE, /identity\.audit\(/) >= 6, '发布/下架/审核/连解 Key 都要留审计');
});

test('数据模型双方言一致，唯一约束随迁移落库', () => {
  for (const file of SCHEMA_TARGETS) {
    for (const model of [
      'CommunityWorkflow',
      'CommunityRun',
      'CommunityRunOutput',
      'CommunityFavorite',
      'CommunityLike',
      'ComfyCredential',
    ]) {
      has(file, new RegExp(`model ${model} \\{`), `${file} 缺 ${model}`);
    }
    has(file, /keyCipher\s+String\s+@map\("key_cipher"\)\s+@db\.Text/, `${file} 的 Key 列必须是密文列`);
  }
  has(SCHEMA, /userId\s+String\s+@unique\s+@map\("user_id"\)/, '一人一把 Key');
  const sql = source(MIGRATION);
  const tables = [...sql.matchAll(/CREATE TABLE `(\w+)`/g)].map((m) => m[1]);
  for (const table of [
    'community_workflows',
    'community_runs',
    'community_run_outputs',
    'community_favorites',
    'community_likes',
    'comfy_credentials',
  ]) {
    assert.ok(tables.includes(table), `迁移缺表 ${table}`);
  }
  assert.ok(/UNIQUE INDEX `community_workflows_code_key`/.test(sql), 'code 必须唯一（幂等重导入的键）');
  assert.ok(/UNIQUE INDEX `community_favorites_user_id_workflow_id_key`/.test(sql), '收藏按 [人,工作流] 唯一');
  assert.ok(/UNIQUE INDEX `community_likes_user_id_workflow_id_key`/.test(sql), '点踩赞按 [人,工作流] 唯一');
});

test('运行调度器：轮询上游、超 30 分钟主动取消、产物转存并登记数字资产', () => {
  has(SCHEDULER, /const DEFAULT_TICK_MS = 20_000/, '默认 20 秒一轮');
  has(SCHEDULER, /COMMUNITY_SCHEDULER_TICK_MS/, '间隔可调但下限 5 秒');
  has(SCHEDULER, /COMMUNITY_SCHEDULER_DISABLED/, '可显式禁用（禁用时要 WARN 留痕）');
  has(SCHEDULER, /const BATCH = 20/, '单轮批量封顶，别占满上游连接池');
  has(SCHEDULER, /const OUTPUT_LIMIT = 20/, '单条运行转存个数封顶');
  has(SCHEDULER, /const RUN_TIMEOUT_MS = 30 \* 60 \* 1000/, '超时上限 30 分钟');
  has(SCHEDULER, /cancelJob\(/, '超时要替用户取消');
  has(SCHEDULER, /getJob\(/, '轮询上游作业状态');
  has(SCHEDULER, /fetchOutputBytes\(/, '产物由后端下载（浏览器直挂必 401）');
  has(SCHEDULER, /registerDeliverable\(/, '转存后登记进本账号数字资产');
  has(SCHEDULER, /ossKey: entry\?\.ossKey \|\| ''/, '产物落本站对象键');
  has(MAIN, /communityScheduler\.onModuleInit\(\)/, '调度器随进程启动');
  assert.ok(count(MAIN, /communityScheduler\.onModuleDestroy\(\)/) >= 2, '异常与退出路径都要停表');
  has(SERVICES, /new CommunityRunScheduler\(/, '调度器进 DI 容器');
});

test('推荐发奖：官方条目不发、终身幂等、双帽兜底、未配置保留默认', () => {
  has(AWARD, /workflow\.source === 'OFFICIAL'/, '官方模板没有站内作者，一律不发奖');
  has(AWARD, /pointTransaction\.count\(\{[\s\S]{0,80}refType: REF_TYPE, refId \}/, '幂等按积分流水判定，不只看状态字段');
  has(AWARD, /`\$\{kind\}:\$\{code\}`\.slice\(0, 64\)/, 'refId 要带动作类型并截到列宽 64');
  has(AWARD, /this\.points\.credit\(owner, 'EARN', amount/, '发奖走积分既有口径');
  has(AWARD, /refType: REF_TYPE/, '流水带 refType 便于对账');
  has(AWARD, /rewardedAt: new Date\(\)/, '推荐后写幂等标记');
  has(AWARD, /perUserDailyCap > 0/, '单人当日帽');
  has(AWARD, /siteDailyCap > 0/, '全站当日预算帽');
  // 后台从没配过时 flag 回空串：当成 0 会让默认 200 分静默变成不发分
  has(AWARD, /if \(!stored\) continue;/, '空串＝未配置，必须保留默认值');
});

test('官方模板种子：≥120 条内容，按 code 幂等，重跑不抹热度', () => {
  const dir = join(root, 'backend', 'prisma', 'data', 'comfy-templates');
  const metas = readdirSync(dir).filter((name) => name.endsWith('.meta.json'));
  assert.ok(metas.length >= 120, `种子条目只有 ${metas.length} 份，低于「首屏 ≥120 条」的验收线`);
  has(SEED, /where: \{ code: row\.code \}/, '按 code 查存量（upsert 的幂等键）');
  has(
    SEED,
    /communityWorkflow\.update\(\{\s*where: \{ id: existing\.id \},\s*data: content,\s*\}\)/,
    '存量走更新',
  );
  has(SEED, /OFFICIAL_REWARDED_AT = new Date\('2020-01-01/, '官方条目预先占住发奖幂等标记');
  has(SEED, /auditNote: '官方模板导入'/, '导入条目的审核留痕');
  // 计数列只在首次创建置 0：更新载荷里出现它们，重跑 seed 就会把真实热度抹平
  const content = between(SEED, 'const content = {', 'const existing = await', 'upsert 的更新载荷');
  for (const column of ['runCount', 'favoriteCount', 'likeCount', 'viewCount']) {
    assert.ok(
      !content.includes(column),
      `更新载荷不许带出 ${column}（重跑 seed 会把线上热度归零）`,
    );
    assert.ok(
      source(SEED).includes(`${column}: 0,`),
      `${column} 要在首次创建时置 0`,
    );
  }
  has(SEED_ENTRY, /await seedCreativeCommunity\(prisma\)/, '接入现有 pnpm prisma:seed');
  has(SEED_ENTRY, /import \{ seedCreativeCommunity \} from '\.\/seed-creative-community'/, 'seed 入口要引模块');
});

test('迁移 Comfy Cloud 工作流：验 Key 与存储渠道先行，作者挂管理员，媒体转存走 OSS', () => {
  for (const op of ['importPreview', 'importStart', 'importStatus']) {
    has(CONTRACT, new RegExp(`CommunityAdmin_${op}: \\{`), `CommunityAdmin_${op} 要在契约登记`);
  }
  has(CONTRACT, /path: "\/enterprise\/admin\/community\/import/, '迁移端点走 admin 路径');
  has(IMPORT_SERVICE, /this\.identity\.requireAdmin\(/, '迁移只允许平台管理员');
  has(IMPORT_SERVICE, /await this\.comfy\.verifyKey\(apiKey\)/, '点击迁移时必须先验证 Key');
  has(IMPORT_SERVICE, /await this\.oss\.testConnection\(\)/, '媒体落库前必须验证后台存储渠道');
  has(IMPORT_SERVICE, /ownerUserId: user\.userId/, '作者挂在管理员账号名下');
  has(IMPORT_SERVICE, /this\.oss\.upload\(/, '图片视频转存走后台上传渠道');
  has(IMPORT_SERVICE, /coverKeys: coverKeys\.slice\(0, 8\)/, '封面与示例图写进 coverKeys');
  has(IMPORT_SERVICE, /comfy-cloud:\/\/job\//, '历史任务来源可追溯（幂等键）');
  has(IMPORT_SERVICE, /comfy-cloud:\/\/workflow\//, '已保存工作流来源可追溯（幂等键）');
  has(IMPORT_SERVICE, /status: 'APPROVED'/, '管理员自己迁移的内容直接审核通过');
  has(IMPORT_SERVICE, /identity\.audit\(/, '迁移结束要留审计');
  lacks(IMPORT_SERVICE, /logger\.[\w.]+\([^)]*apiKey/, '日志里不许拼明文 Key');
  has(CONVERT, /DANGEROUS_NODE_NAMES/, '迁移期也要拦危险节点');
  has(CONVERT, /CORE_WIDGETS/, 'UI 图只按核心表机械转换，表外一律失败');
  has(CONVERT, /子图|subgraphs/, '含 subgraph 的图不硬转');
  has(FRONT_API, /importPreview: endpoint\(endpoints\.CommunityAdmin_importPreview/, '前端接线迁移预览');
  has(FRONT_API, /importStatus: endpoint\(endpoints\.CommunityAdmin_importStatus\)/, '前端接线迁移进度');
});

test('前端接线：社区挂在「内容创作」板块，后台审核 tab 与八语言菜单都在', () => {
  has(ROUTES, /\{ path: "\/community", name: "创意社区", icon: "apps" \}/, '板块叶子');
  has(ROUTES, /"\/community": \{\s*\n\s*title: "创意社区"/, 'PAGE_META 要有标题与说明');
  has(ROUTES, /key: "community"[\s\S]{0,160}name: "创意社区"/, 'ADMIN_SECTIONS 要有创意社区');
  has(ADMIN_PAGE, /section === "community" \? <CommunityAdminTab/, '后台 tab 挂载');
  assert.ok(
    count(MESSAGES, /"创意社区":/g) >= 7,
    '菜单名要在各语言里都有（中文原样 + 至少 7 种译文）',
  );
  has(CONNECT, /platform\.comfy\.org/, '引导要给出建 Key 的站点');
  has(CONNECT, /comfy\.org\/pricing/, '引导要明说需要付费订阅并附定价页');
  has(CONNECT, /只在创建成功那一刻显示一次/, 'Key 只显示一次的提醒');
  has(SERVICE, /COMFY_PRICING_URL = 'https:\/\/www\.comfy\.org\/pricing'/, '定价地址由后端下发，前端文案不硬编码上游 API 域');
});

test('发布表单支持直接上传 JSON 文件：与粘贴共用校验，超限先在本地拦住', () => {
  has(PUBLISH, /function readGraph\(raw: string\)/, '上传与粘贴共用同一套校验');
  has(PUBLISH, /JSON_FILE_MAX_BYTES = 2 \* 1024 \* 1024/, '与后端 2MB 同口径');
  has(PUBLISH, /<Upload[\s\S]{0,240}accept="\.json,application\/json"/, '上传控件只收 .json');
  has(PUBLISH, /await file\.text\(\)/, '直接读文件内容');
  has(
    PUBLISH,
    /form\.setFieldValue\("workflowText", JSON\.stringify\(result\.graph, null, 2\)\)/,
    '解析后格式化填入 JSON 输入框',
  );
});
