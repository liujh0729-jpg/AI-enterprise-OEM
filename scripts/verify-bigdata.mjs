/**
 * 大数据查询（营销工具五个数据集）：接口层实测。
 *
 * 口径：
 * - 必须打在「开发实例」上（默认 1690）：这个模块的执行链路要真连
 *   https://bigdata.aiworkin.com，被 ISOLATED_TEST 护栏拦住的回归实例跑不了出站查询。
 * - 测试主体从种子账号里选一个「五个数据集设置全空」的账号；跑完把本次产生的
 *   结果表／模型设置全部清掉，账号回到初始状态。
 * - 上游查询只做 2 行小样本真连（验证契约与筛选生效），不批量捞数。
 * - 门槛分两段：「建任务 → 开始查询 → 写结果表」只要求结果表，脚本必须真跑通并把
 *   行落到表里；「AI 把自然语言解析成查询参数」额外要模型 + 平台 sk- Key。
 * - 该账号在「API Key 管理」没有平台 sk- Key 时，chat 这一腿如实 SKIP 并说明缺什么，
 *   不用假断言充数（见 [[feedback-test-honesty]]）。
 *
 * 用法：node scripts/verify-bigdata.mjs [BASE_URL]
 */
import { createRequire } from "node:module";
import { createSuite } from "./harness.mjs";

const require = createRequire(import.meta.url);
const { BIGDATA_DATASETS, BIGDATA_DATASET_KEYS } = require(
  "../packages/contracts/dist/automation.js",
);

const suite = createSuite({ base: process.argv[2] || "http://127.0.0.1:1690" });
const { call, assert, base } = suite;

/**
 * 每个数据集用小样本真连上游时用的筛选条件（都是实测命中量很大的稳定条件）。
 * 注意 buyer / person 库里存英文：`紧固件`（fastener）实测 0 命中，`kitchen` 有 3.5 万。
 */
const PROBE_FILTERS = {
  enterprise: { city: "广州" },
  buyer: { industry: "kitchen" },
  person: { country: "United States" },
  kol: { channel: "抖音" },
  poi: { city: "广州" },
};

const TABLES_ENDPOINT = "/enterprise/data-tables";

console.log(`目标实例：${base}`);
console.log(`数据集：${BIGDATA_DATASET_KEYS.join(" / ")}`);

// ---------- 选测试主体：五个数据集都干净的种子账号 ----------
const CANDIDATES = [
  "demo_user",
  "demo_tax3",
  "demo_overseas3",
  "demo_logistics3",
  "demo_marketing3",
];
let account = "";
for (const name of CANDIDATES) {
  const readings = await Promise.all(
    BIGDATA_DATASET_KEYS.map((dataset) =>
      call("GET", `/enterprise/bigdata/${dataset}/settings`, name),
    ),
  );
  const clean =
    readings.every((res) => res.code === 0 && res.data) &&
    readings.every((res) => !res.data.model && !res.data.dataTableId);
  if (clean) {
    account = name;
    break;
  }
}
if (!account) {
  console.log("FAIL 找不到干净测试主体（候选账号都已有大数据查询设置），中止且不写入");
  process.exit(1);
}
console.log(`测试主体：${account}（userId=${suite.users[account].userId}）`);

// ---------- 1) 数据集白名单：只放开用户点名的五个 ----------
for (const raw of ["supply_chain", "enterpris", " "]) {
  const res = await call(
    "GET",
    `/enterprise/bigdata/${encodeURIComponent(raw)}/settings`,
    account,
  );
  assert(
    res.code !== 0 && /未知的大数据数据集/.test(String(res.message || "")),
    `数据集「${raw.trim() || "（空白）"}」不在白名单：400 拒收`,
    `code=${res.code} message=${res.message}`,
  );
}

// ---------- 2) 五个数据集的初始形态（彼此独立，各自一份设置） ----------
for (const dataset of BIGDATA_DATASET_KEYS) {
  const definition = BIGDATA_DATASETS[dataset];
  const res = await call("GET", `/enterprise/bigdata/${dataset}/settings`, account);
  assert(res.code === 0, `${dataset}：settings 可读`, `message=${res.message}`);
  const d = res.data || {};
  assert(d.dataset === dataset, `${dataset}：settings.dataset 回显`);
  assert(d.label === definition.label, `${dataset}：settings.label＝${definition.label}`);
  assert(d.tableName === definition.tableName, `${dataset}：结果表名＝${definition.tableName}`);
  assert(d.dataTableExists === false, `${dataset}：初始无结果表`);
  assert(d.dataTableId === 0, `${dataset}：初始 dataTableId=0`);
  assert(d.columnCount === 0, `${dataset}：未建表时 columnCount=0`);
  assert(d.model === "", `${dataset}：初始模型为空`);
  assert(d.ready === false, `${dataset}：初始 ready=false`);
  assert(typeof d.keyConfigured === "boolean", `${dataset}：keyConfigured 是布尔`);
}

// ---------- 3) 模型 Key 统一收口：带 apiKey 一律拒 ----------
const withApiKey = await call("PUT", `/enterprise/bigdata/enterprise/settings`, account, {
  apiKey: "sk-fake-should-be-rejected",
  model: "doubao-pro-32k",
});
assert(
  withApiKey.code !== 0 && /API Key 管理/.test(String(withApiKey.message || "")),
  "save 携带 apiKey 被拒并指路「API Key 管理」",
  `code=${withApiKey.code} message=${withApiKey.message}`,
);
const nothingToSave = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {});
assert(
  nothingToSave.code !== 0 && /没有需要保存的设置/.test(String(nothingToSave.message || "")),
  "save 空载荷拒收（没有需要保存的设置）",
  `message=${nothingToSave.message}`,
);

// ---------- 4) 未建表／未配模型时：chat 与 createTask 各自撞自己的门槛 ----------
const chatBlocked = await call("POST", "/enterprise/bigdata/enterprise/chat", account, {
  messages: [{ role: "user", content: "找广州做精密机械的中小企业，取 5 家" }],
});
assert(
  chatBlocked.code !== 0 && /请先完成设置/.test(String(chatBlocked.message || "")),
  "未就绪时 chat 被 requireReady 拒绝",
  `message=${chatBlocked.message}`,
);
const taskBlocked = await call("POST", "/enterprise/bigdata/enterprise/tasks", account, {
  spec: { filters: { city: "广州" }, limit: 5, scene: "门槛验证" },
});
assert(
  taskBlocked.code !== 0 &&
    /请先在「企业数据」里生成结果表/.test(String(taskBlocked.message || "")),
  "未建表时 createTask 只缺结果表，文案点名去建表",
  `message=${taskBlocked.message}`,
);

// ---------- 5) 参数校验先于结果表门槛（两条规则各判各的） ----------
const BAD_SPECS = [
  ["没有任何筛选条件", { filters: {}, limit: 5, scene: "" }],
  ["只有未知键", { filters: { website_zz: "x" }, limit: 5, scene: "" }],
  ["limit=0", { filters: { city: "广州" }, limit: 0, scene: "" }],
  ["limit=2001（超上游上限）", { filters: { city: "广州" }, limit: 2001, scene: "" }],
  ["limit 非数字", { filters: { city: "广州" }, limit: "五", scene: "" }],
];
for (const [label, spec] of BAD_SPECS) {
  const res = await call("POST", "/enterprise/bigdata/enterprise/tasks", account, { spec });
  assert(
    res.code !== 0 && /任务参数不合法/.test(String(res.message || "")),
    `非法 spec（${label}）由参数校验拒掉，不是被门槛掩盖`,
    `message=${res.message}`,
  );
}
// 此刻仍未建表：合法 spec 只能撞上「缺结果表」这道门（说明它已通过参数校验）
const kolLegalButNoTable = await call("POST", "/enterprise/bigdata/kol/tasks", account, {
  spec: { filters: { followers_min: "500000", channel: "抖音" }, limit: 10, scene: "数值筛选归一" },
});
assert(
  kolLegalButNoTable.code !== 0 &&
    /请先在「全球达人大数据」里生成结果表/.test(String(kolLegalButNoTable.message || "")),
  "kol 数值筛选字符串通过校验（合法 spec 才走到结果表门槛）",
  `message=${kolLegalButNoTable.message}`,
);

// ---------- 6) 生成结果表：列模版逐字对齐契约注册表，且幂等 ----------
const createdTables = [];
for (const dataset of BIGDATA_DATASET_KEYS) {
  const definition = BIGDATA_DATASETS[dataset];
  const expectedKeys = definition.columns.map((column) => column.fieldKey);
  const res = await call("POST", `/enterprise/bigdata/${dataset}/data-table`, account);
  assert(res.code === 0, `${dataset}：建表 code=0`, `message=${res.message}`);
  const d = res.data || {};
  assert(d.created === true, `${dataset}：首次建表 created=true`);
  assert(d.name === definition.tableName, `${dataset}：表名＝${definition.tableName}`);
  assert(
    JSON.stringify(d.fields) === JSON.stringify(expectedKeys),
    `${dataset}：${expectedKeys.length} 列与注册表 fieldKey 逐字一致`,
  );
  if (d.dataTableId) createdTables.push({ dataset, id: d.dataTableId });
  const again = await call("POST", `/enterprise/bigdata/${dataset}/data-table`, account);
  assert(
    again.code === 0 && again.data.created === false && again.data.dataTableId === d.dataTableId,
    `${dataset}：重复建表幂等（created=false 且同一张表）`,
    `created=${again.data?.created} id=${again.data?.dataTableId}`,
  );
  const settings = await call("GET", `/enterprise/bigdata/${dataset}/settings`, account);
  assert(
    settings.data?.dataTableExists === true &&
      settings.data?.dataTableId === d.dataTableId &&
      settings.data?.columnCount === expectedKeys.length,
    `${dataset}：设置回显已建表（columnCount=${expectedKeys.length}）`,
    `columnCount=${settings.data?.columnCount}`,
  );
  // 列类型：数值列必须是 number，否则写行时 coerce() 会 400
  const detail = await call("GET", `${TABLES_ENDPOINT}/${d.dataTableId}`, account);
  const fieldByKeys = Object.fromEntries(
    (detail.data?.fields || []).map((field) => [field.fieldKey, field.fieldType]),
  );
  const typeMismatch = definition.columns.filter(
    (column) => fieldByKeys[column.fieldKey] !== column.fieldType,
  );
  assert(
    typeMismatch.length === 0,
    `${dataset}：列类型与注册表一致（number/text）`,
    `不符：${typeMismatch.map((c) => `${c.fieldKey}:${fieldByKeys[c.fieldKey]}`).join(",")}`,
  );
  assert(
    (detail.data?.fields || []).length === expectedKeys.length,
    `${dataset}：多维表格实际列数＝${expectedKeys.length}`,
    `实际=${detail.data?.fields?.length}`,
  );
}

// ---------- 6.4) 结果表＝选已有 或 按用户填的名字新建（判定与写行同源，以 enterprise 为例） ----------
const entKeys = BIGDATA_DATASETS.enterprise.columns.map((column) => column.fieldKey);
const entDefaultId =
  createdTables.find((item) => item.dataset === "enterprise")?.id || 0;
const optionsRes = await call("GET", "/enterprise/bigdata/enterprise/tables", account);
assert(optionsRes.code === 0 && !!optionsRes.data, "enterprise：候选结果表接口 code=0", `message=${optionsRes.message}`);
const options = optionsRes.data || {};
assert(
  JSON.stringify(options.requiredColumns) === JSON.stringify(entKeys),
  `enterprise：必备列＝注册表 ${entKeys.length} 列`,
);
assert(
  (options.columnLabels || []).length === entKeys.length,
  "enterprise：中文列名与注册表一一对应",
);
assert(
  (options.tables || []).some((item) => item.id === entDefaultId),
  "enterprise：本次生成的结果表在候选里",
);
assert(
  options.defaultTable?.id === entDefaultId,
  "enterprise：默认结果表＝生成那张",
  `defaultTable=${JSON.stringify(options.defaultTable)}`,
);

// 用户填名字新建：表名逐字采用，列照样建满该数据集模板
const entNamedName = `大数据-命名实测-${Date.now().toString(36)}`;
const entNamedRes = await call("POST", "/enterprise/bigdata/enterprise/data-table", account, {
  name: entNamedName,
});
assert(
  entNamedRes.code === 0 &&
    entNamedRes.data?.created === true &&
    entNamedRes.data?.name === entNamedName,
  "enterprise：传 name 按用户填的表名新建",
  `message=${entNamedRes.message} data=${JSON.stringify(entNamedRes.data)}`,
);
assert(
  JSON.stringify(entNamedRes.data?.fields) === JSON.stringify(entKeys),
  "enterprise：命名新建同样建满注册表列",
);
const entNamedId = Number(entNamedRes.data?.dataTableId || 0);
if (entNamedId) createdTables.push({ dataset: "enterprise", id: entNamedId });
const afterEntNamed = await call("GET", "/enterprise/bigdata/enterprise/settings", account);
assert(
  afterEntNamed.data?.dataTableId === entDefaultId,
  "enterprise：命名新建未带 setDefault 不顶掉默认结果表",
  `dataTableId=${afterEntNamed.data?.dataTableId}`,
);
const optionsWithEntNamed = await call("GET", "/enterprise/bigdata/enterprise/tables", account);
assert(
  (optionsWithEntNamed.data?.tables || []).some((item) => item.id === entNamedId),
  "enterprise：命名新建的表立刻进候选（下拉可直接选中）",
);

// 把默认结果表改选成另一张已有表
const entSwitched = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  dataTableId: entNamedId,
});
assert(
  entSwitched.code === 0 && entSwitched.data?.dataTableId === entNamedId,
  "enterprise：save 携带 dataTableId 即改选默认结果表",
  `message=${entSwitched.message} dataTableId=${entSwitched.data?.dataTableId}`,
);
const optionsAfterSwitch = await call("GET", "/enterprise/bigdata/enterprise/tables", account);
assert(
  optionsAfterSwitch.data?.defaultTable?.id === entNamedId,
  "enterprise：候选接口的默认表跟着改选结果",
);

// 非法/不合格的表都不许成为默认
const entZeroSave = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  dataTableId: 0,
});
assert(
  entZeroSave.code !== 0 && /请选择一张结果表/.test(String(entZeroSave.message)),
  "enterprise：dataTableId=0 被拒",
  `message=${entZeroSave.message}`,
);
const blankName = `大数据-缺列实测-${Date.now().toString(36)}`;
const blankRes = await call("POST", TABLES_ENDPOINT, account, {
  name: blankName,
  description: "只有表没有模板列，用来验证选不进来",
});
assert(blankRes.code === 0 && !!blankRes.data?.id, "另建一张无模板列的空白多维表格", `message=${blankRes.message}`);
const blankId = Number(blankRes.data?.id || 0);
if (blankId) createdTables.push({ dataset: "enterprise（缺列实测表）", id: blankId });
const optionsWithBlank = await call("GET", "/enterprise/bigdata/enterprise/tables", account);
assert(
  !(optionsWithBlank.data?.tables || []).some((item) => item.id === blankId),
  "enterprise：列不齐的表不进候选（选了也写不进去）",
);
const entBlankSave = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  dataTableId: blankId,
});
assert(
  entBlankSave.code !== 0 &&
    /缺少列/.test(String(entBlankSave.message)) &&
    String(entBlankSave.message).includes(blankName),
  "enterprise：硬把缺列的表设为默认被拒，且点名表与缺的列",
  `message=${entBlankSave.message}`,
);
const entStill = await call("GET", "/enterprise/bigdata/enterprise/settings", account);
assert(
  entStill.data?.dataTableId === entNamedId,
  "enterprise：被拒的改选不覆盖原默认结果表",
  `dataTableId=${entStill.data?.dataTableId}`,
);
const ghostPatch = await call(
  "PATCH",
  "/enterprise/bigdata/enterprise/tasks/99999999/table",
  account,
  { dataTableId: entNamedId },
);
assert(
  ghostPatch.code !== 0 && /不存在或不属于你/.test(String(ghostPatch.message)),
  "改不存在的任务的目标表被拒",
  `message=${ghostPatch.message}`,
);

// ---------- 6.5) 建表后：取数主链路不依赖模型与平台 Key，数值筛选归一为整数 ----------
const normalized = await call("POST", "/enterprise/bigdata/kol/tasks", account, {
  spec: { filters: { followers_min: "500000", channel: "抖音" }, limit: 10, scene: "数值筛选归一" },
});
assert(
  normalized.code === 0 && Number(normalized.data?.spec?.filters?.followers_min) === 500000,
  "建表后 kol 建任务成功，且 followers_min「500000」归一为整数 500000",
  `code=${normalized.code} message=${normalized.message} spec=${JSON.stringify(normalized.data?.spec)}`,
);
assert(
  normalized.code === 0 && normalized.data?.status === "pending",
  "新建任务初始状态为 pending",
  `status=${normalized.data?.status}`,
);
const normalizedId = Number(normalized.data?.id);
if (normalizedId) {
  // 待执行任务可逐条改选目标表：新建一张 kol 命名表作为新目标（列照样建满 kol 模板）
  const kolKeys = BIGDATA_DATASETS.kol.columns.map((column) => column.fieldKey);
  const kolNamedName = `大数据-kol命名实测-${Date.now().toString(36)}`;
  const kolNamedRes = await call("POST", "/enterprise/bigdata/kol/data-table", account, {
    name: kolNamedName,
  });
  assert(
    kolNamedRes.code === 0 &&
      kolNamedRes.data?.created === true &&
      kolNamedRes.data?.name === kolNamedName,
    "kol：传 name 按用户填的表名新建",
    `message=${kolNamedRes.message} data=${JSON.stringify(kolNamedRes.data)}`,
  );
  assert(
    JSON.stringify(kolNamedRes.data?.fields) === JSON.stringify(kolKeys),
    "kol：命名新建的列＝kol 注册表模板",
  );
  const kolNamedId = Number(kolNamedRes.data?.dataTableId || 0);
  if (kolNamedId) createdTables.push({ dataset: "kol", id: kolNamedId });
  const retabled = await call(
    "PATCH",
    `/enterprise/bigdata/kol/tasks/${normalizedId}/table`,
    account,
    { dataTableId: kolNamedId },
  );
  assert(
    retabled.code === 0 &&
      retabled.data?.dataTableId === kolNamedId &&
      retabled.data?.dataTableName === kolNamedName &&
      retabled.data?.status === "pending",
    "kol：待执行任务改选结果表成功且表名跟着变",
    `message=${retabled.message} data=${JSON.stringify(retabled.data)}`,
  );
  const retabledBad = await call(
    "PATCH",
    `/enterprise/bigdata/kol/tasks/${normalizedId}/table`,
    account,
    { dataTableId: blankId },
  );
  assert(
    retabledBad.code !== 0 && /缺少列/.test(String(retabledBad.message)),
    "kol：任务也不许改到缺列的表",
    `message=${retabledBad.message}`,
  );
  const removed = await call("DELETE", `/enterprise/bigdata/kol/tasks/${normalizedId}`, account);
  assert(
    removed.code === 0 && removed.data?.deleted === true,
    `清理归一验证任务 #${normalizedId}（未执行也可删）`,
    `message=${removed.message}`,
  );
}

// ---------- 7) 模型设置只存字符串（平台 Key 由「API Key 管理」代持） ----------
const savedModel = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  model: "doubao-pro-32k",
});
assert(
  savedModel.code === 0 && savedModel.data.model === "doubao-pro-32k",
  "模型名保存并回显",
  `message=${savedModel.message}`,
);

// ---------- 7b) 设置页签「保存设置」＝一个 PUT 同时改默认表与模型 ----------
// 界面把草稿收成一个提交动作、且只发改动过的键，所以多项改动必须在同一次请求里全部生效。
const combinedSave = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  dataTableId: entDefaultId,
  model: "doubao-pro-128k",
});
assert(
  combinedSave.code === 0 &&
    combinedSave.data?.dataTableId === entDefaultId &&
    combinedSave.data?.model === "doubao-pro-128k",
  "enterprise：一个 PUT 同时改默认结果表与模型，两项都立即生效",
  `message=${combinedSave.message} dataTableId=${combinedSave.data?.dataTableId} model=${combinedSave.data?.model}`,
);
const combinedRead = await call("GET", "/enterprise/bigdata/enterprise/settings", account);
assert(
  combinedRead.data?.dataTableId === entDefaultId &&
    combinedRead.data?.model === "doubao-pro-128k",
  "enterprise：改后重读默认表与模型都已落库（不存在只落一半）",
  `dataTableId=${combinedRead.data?.dataTableId} model=${combinedRead.data?.model}`,
);
const restoreSave = await call("PUT", "/enterprise/bigdata/enterprise/settings", account, {
  dataTableId: entNamedId,
  model: "doubao-pro-32k",
});
assert(
  restoreSave.code === 0 &&
    restoreSave.data?.dataTableId === entNamedId &&
    restoreSave.data?.model === "doubao-pro-32k",
  "enterprise：再一次合并保存把默认表与模型改回上一张（同样只发一个 PUT）",
  `message=${restoreSave.message}`,
);

// ---------- 8) 上游契约真连：五个数据集各取 2 行 ----------
for (const dataset of BIGDATA_DATASET_KEYS) {
  const definition = BIGDATA_DATASETS[dataset];
  const url = `https://bigdata.aiworkin.com${definition.upstreamPath}`;
  let payload = null;
  let failure = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...PROBE_FILTERS[dataset], page: 1, limit: 2 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) failure = `HTTP ${response.status}`;
    else payload = await response.json();
  } catch (error) {
    failure = (error && error.message) || "请求失败";
  }
  assert(
    !failure && payload?.status === "ok",
    `${dataset}：上游 ${definition.upstreamPath} 返回 status=ok`,
    failure || `status=${payload?.status} error_message=${payload?.error_message || payload?.error || ""}`,
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  assert(
    Array.isArray(payload?.data) && rows.length <= 2 && rows.length >= 1,
    `${dataset}：limit=2 生效（返回 1-2 行，命中样本非空）`,
    `rows=${rows.length} total=${payload?.total}`,
  );
  assert(
    Number(payload?.total) > 0,
    `${dataset}：筛选条件在上游真有命中（total>0）`,
    `total=${payload?.total} 筛选=${JSON.stringify(PROBE_FILTERS[dataset])}`,
  );
  assert(
    rows.every((row) => String(row?.id ?? "").length > 0),
    `${dataset}：每行都带上游主键 id（source_id 去重依赖它）`,
  );
}

// ---------- 9) 列表形态 + 归属隔离 ----------
const messages = await call("GET", "/enterprise/bigdata/enterprise/messages", account);
assert(messages.code === 0 && Array.isArray(messages.data), "messages 返回数组");
const tasksPage = await call(
  "GET",
  "/enterprise/bigdata/enterprise/tasks?page=1&pageSize=50",
  account,
);
assert(
  tasksPage.code === 0 && Array.isArray(tasksPage.data?.list),
  "tasks 分页返回 list",
  `message=${tasksPage.message}`,
);
const other = CANDIDATES.find((name) => name !== account);
const foreignTables = await call("GET", TABLES_ENDPOINT, other);
const mine = new Set(createdTables.map((item) => item.id));
const leaked = (foreignTables.data?.list || foreignTables.data || []).filter(
  (table) => mine.has(Number(table.id)),
);
assert(
  foreignTables.code === 0 && leaked.length === 0,
  `结果表按账号归属：${other} 看不到 ${account} 建的表`,
  `泄露=${leaked.map((table) => table.id).join(",")}`,
);

// ---------- 10) 任务详情的越权与缺行 ----------
const ghostTask = await call("GET", "/enterprise/bigdata/enterprise/tasks/99999999", account);
assert(
  ghostTask.code !== 0 && /该任务不存在或不属于你/.test(String(ghostTask.message || "")),
  "不存在的任务详情 404（含越权同一口径）",
  `code=${ghostTask.code} message=${ghostTask.message}`,
);
const ghostStart = await call("POST", "/enterprise/bigdata/enterprise/tasks/99999999/start", account);
assert(
  ghostStart.code !== 0 && /该任务不存在或不属于你/.test(String(ghostStart.message || "")),
  "不存在的任务不可开始",
  `code=${ghostStart.code} message=${ghostStart.message}`,
);

/** 轮询到任务离开 running（上游查询 + 分批写表在后台跑），返回最后一次详情。 */
async function waitTask(dataset, id) {
  let status = (
    await call("GET", `/enterprise/bigdata/${dataset}/tasks/${id}`, account)
  ).data?.status;
  for (let i = 0; i < 60 && status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    status = (
      await call("GET", `/enterprise/bigdata/${dataset}/tasks/${id}`, account)
    ).data?.status;
  }
  return call("GET", `/enterprise/bigdata/${dataset}/tasks/${id}`, account);
}

// ---------- 11) 取数主链路真跑：建任务 → 执行 → 写结果表 → 跨任务去重 ----------
for (const dataset of BIGDATA_DATASET_KEYS) {
  const settings = await call("GET", `/enterprise/bigdata/${dataset}/settings`, account);
  const definition = BIGDATA_DATASETS[dataset];
  // 11.1 用可控的确定性参数建任务并执行（落库口径由脚本决定，不依赖模型与平台 Key）
  const spec = {
    filters: PROBE_FILTERS[dataset],
    limit: 2,
    scene: "接口实测：小样本落库与去重",
  };
  const task = await call("POST", `/enterprise/bigdata/${dataset}/tasks`, account, {
    spec,
    rawIntent: "接口实测：verify-bigdata",
  });
  assert(
    task.code === 0 && task.data?.status === "pending",
    `${dataset}：有结果表即可 createTask，落库 pending（不要求模型与平台 Key）`,
    `code=${task.code} message=${task.message}`,
  );
  assert(
    task.code === 0 && task.data?.dataTableId === settings.data?.dataTableId,
    `${dataset}：任务绑定到本数据集的结果表 #${settings.data?.dataTableId}`,
    `taskTable=${task.data?.dataTableId} settingsTable=${settings.data?.dataTableId}`,
  );
  const taskId = Number(task.data?.id);
  const started = await call("POST", `/enterprise/bigdata/${dataset}/tasks/${taskId}/start`, account);
  assert(
    started.code === 0 && started.data?.status === "running",
    `${dataset}：start 通过校验并进入 running`,
    `code=${started.code} message=${started.message} status=${started.data?.status}`,
  );
  const finished = await waitTask(dataset, taskId);
  assert(
    finished.code === 0 && finished.data?.status === "success",
    `${dataset}：任务收敛为 success`,
    `status=${finished.data?.status} error=${finished.data?.error}`,
  );
  const saved = Number(finished.data?.totalSaved) || 0;
  assert(
    saved > 0 && saved <= spec.limit,
    `${dataset}：结果真的写进行（1-${spec.limit} 条）`,
    `totalSaved=${saved} totalFound=${finished.data?.totalFound}`,
  );
  // 11.2 同参数第二轮：去重不变量＝表里 source_id 不重复，且 已存+跳过=取到
  const second = await call("POST", `/enterprise/bigdata/${dataset}/tasks`, account, {
    spec,
    rawIntent: "接口实测：跨任务去重",
  });
  const secondId = Number(second.data?.id);
  await call("POST", `/enterprise/bigdata/${dataset}/tasks/${secondId}/start`, account);
  const secondDone = await waitTask(dataset, secondId);
  assert(
    secondDone.data?.status === "success",
    `${dataset}：第二轮任务也收敛为 success`,
    `status=${secondDone.data?.status} error=${secondDone.data?.error}`,
  );
  assert(
    Number(secondDone.data?.totalSaved) + Number(secondDone.data?.totalSkipped) ===
      Number(secondDone.data?.totalFound),
    `${dataset}：已存 + 跳过 ＝ 取到（第二轮计数自洽）`,
    `saved=${secondDone.data?.totalSaved} skipped=${secondDone.data?.totalSkipped} found=${secondDone.data?.totalFound}`,
  );
  // 11.3 表内核对：行数＝两轮已存之和、每行都有源数据ID 且不重复、字段有真实内容
  // 读行的 pageSize 上限是 200（contracts 的 pageQuery 校验），超了直接 422，别写 500。
  const rowsRes = await call(
    "GET",
    `/enterprise/data-tables/${settings.data.dataTableId}/rows?page=1&pageSize=200`,
    account,
  );
  const rows = rowsRes.data?.list || [];
  const sourceIds = rows.map((row) => String(row.data?.source_id ?? "")).filter(Boolean);
  assert(
    rows.length > 0,
    `${dataset}：结果表里有行（界面「查看结果」有数据）`,
    `rows=${rows.length} code=${rowsRes.code} message=${rowsRes.message}`,
  );
  assert(
    rows.length === saved + Number(secondDone.data?.totalSaved || 0),
    `${dataset}：表内行数＝第一轮已存 ${saved} ＋第二轮已存 ${secondDone.data?.totalSaved}`,
    `rows=${rows.length} total=${rowsRes.data?.total} code=${rowsRes.code} message=${rowsRes.message}`,
  );
  assert(
    rows.length > 0 &&
      sourceIds.length === rows.length &&
      new Set(sourceIds).size === sourceIds.length,
    `${dataset}：跨任务去重生效（每行都有源数据ID 且不重复）`,
    `rows=${rows.length} 有ID=${sourceIds.length} distinct=${new Set(sourceIds).size}`,
  );
  const businessKeys = definition.columns
    .map((column) => column.fieldKey)
    .filter((key) => key !== "source_id");
  const thinRows = rows.filter(
    (row) =>
      businessKeys.filter((key) => String(row.data?.[key] ?? "").trim()).length < 2,
  );
  assert(
    rows.length > 0 && thinRows.length === 0,
    `${dataset}：每行至少 2 个业务列有内容（不是空壳行）`,
    `空壳行=${thinRows.length} 样例=${JSON.stringify(thinRows[0]?.data || rows[0]?.data || {}).slice(0, 200)}`,
  );
  const removeGuard = await call(
    "DELETE",
    `/enterprise/bigdata/${dataset}/tasks/${taskId}`,
    account,
  );
  assert(
    removeGuard.code === 0 && removeGuard.data?.deleted === true,
    `${dataset}：已完成任务可删除`,
    `message=${removeGuard.message}`,
  );
  if (secondId) {
    await call("DELETE", `/enterprise/bigdata/${dataset}/tasks/${secondId}`, account);
  }
}

// ---------- 12) AI 解析需求这一腿：额外要「模型 + 平台 sk- Key」，缺就如实 SKIP ----------
let chatLegs = 0;
for (const dataset of BIGDATA_DATASET_KEYS) {
  const definition = BIGDATA_DATASETS[dataset];
  const settings = await call("GET", `/enterprise/bigdata/${dataset}/settings`, account);
  if (!settings.data?.ready) {
    const missing = [];
    if (!settings.data?.dataTableExists) missing.push("结果表");
    if (!settings.data?.model) missing.push("文字模型");
    if (!settings.data?.keyConfigured) missing.push("平台 sk- Key");
    const blocked = await call("POST", `/enterprise/bigdata/${dataset}/chat`, account, {
      messages: [{ role: "user", content: definition.example }],
    });
    assert(
      blocked.code !== 0 && /请先完成设置/.test(String(blocked.message || "")),
      `${dataset}：模型/Key 没配齐时只有 chat 被拦，文案点名缺哪一项`,
      `code=${blocked.code} message=${blocked.message}`,
    );
    console.log(
      `SKIP ${dataset} AI 解析实弹（该账号缺：${missing.join("、")}）；取数→落表那一腿已真跑`,
    );
    continue;
  }
  chatLegs += 1;
  const chat = await call("POST", `/enterprise/bigdata/${dataset}/chat`, account, {
    messages: [
      { role: "user", content: `${definition.example} 场景：接口实测取一小批数据看看。` },
    ],
  });
  assert(chat.code === 0, `${dataset}：chat 成功`, `message=${chat.message}`);
  assert(chat.data?.done === true, `${dataset}：一句话已说清，AI 直接给出 QUERY_JSON`);
  const parsed = chat.data?.spec;
  const allowedKeys = new Set(definition.filters.map((field) => field.key));
  const invented = Object.keys(parsed?.filters || {}).filter((key) => !allowedKeys.has(key));
  assert(
    invented.length === 0,
    `${dataset}：AI 没有编造字段（限 ${allowedKeys.size} 个可筛选字段）`,
    `编造：${invented.join(",")}`,
  );
  assert(
    parsed && parsed.limit >= 1 && parsed.limit <= 2000,
    `${dataset}：AI 给出的条数在 1-2000`,
    `limit=${parsed?.limit}`,
  );
  if (definition.valueLanguage === "en") {
    const chineseValued = Object.entries(parsed?.filters || {}).filter(([key, value]) =>
      definition.filters.some((field) => field.key === key) &&
      /[一-龥]/.test(String(value ?? "")),
    );
    assert(
      chineseValued.length === 0,
      `${dataset}：英文库的筛选值没有直接填中文`,
      `中文值：${chineseValued.map(([key, value]) => `${key}=${value}`).join(",")}`,
    );
  }
}
if (!chatLegs) {
  console.log(
    "注意：本轮「自然语言→AI 解析成查询参数」五个数据集全部没实弹，缺的是账号在「API Key 管理」的平台 sk- Key（见任务 #380）；不是代码通过。",
  );
}

// ---------- 清理 ----------
console.log("— 清理本次产生的数据 —");
const leftover = await call("GET", "/enterprise/bigdata/enterprise/messages", account);
if ((leftover.data || []).length) {
  console.log(
    `注意：账号 ${account} 有 ${(leftover.data || []).length} 条对话记录（chat 只在真就绪的数据集上发起，属本次实测留痕，界面「重新聊」可另起一轮）`,
  );
}
for (const item of createdTables) {
  // 删表偶发 500（开发库连接池抖动）会漏一张结果表在共享库里，重试一次再判失败。
  let del = await call("DELETE", `${TABLES_ENDPOINT}/${item.id}`, account);
  const attempts = [`${del.code}/${del.message}`];
  if (del.code !== 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    del = await call("DELETE", `${TABLES_ENDPOINT}/${item.id}`, account);
    attempts.push(`${del.code}/${del.message}`);
  }
  assert(
    del.code === 0,
    `删除本次创建的结果表 #${item.id}（${item.dataset}）`,
    `两次尝试 code/message=${attempts.join(" → ")}`,
  );
}
await call("PUT", "/enterprise/bigdata/enterprise/settings", account, { model: "" });
const afterClear = await call("GET", "/enterprise/bigdata/enterprise/settings", account);
assert(
  afterClear.code === 0 && !afterClear.data.model,
  "模型设置已清空",
  `model=${afterClear.data?.model}`,
);
assert(
  afterClear.data?.dataTableExists === false && afterClear.data?.ready === false,
  "删表后回到「未建表」形态（界面引导重新生成）",
  `dataTableExists=${afterClear.data?.dataTableId}`,
);

console.log(suite.summary());
process.exit(suite.counts().failed ? 1 : 0);
