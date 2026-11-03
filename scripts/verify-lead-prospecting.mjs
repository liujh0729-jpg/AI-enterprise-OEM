/**
 * Google 潜客线索挖掘：接口层实测（默认打回归隔离实例 1693，见 scripts/harness.mjs）。
 *
 * 口径：
 * - 测试主体从种子账号里选一个「潜客设置行为空」的账号；跑完把本次产生的
 *   任务／线索表／Serper 密文／模型／对话记录全部清掉，账号回到初始状态。
 * - Serper Key 用假 Key（只为验证加密存储/掩码/门槛），绝不发起真实挖掘
 *   （start 要么被门槛拦住，要么后台第一跳 Serper 就失败，任务落 failed）。
 * - 假 Key 明文只在本进程内存里，不打印、不落盘。
 *
 * 用法：node scripts/verify-lead-prospecting.mjs [BASE_URL]
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({ base: process.argv[2] });
const { call, assert, base } = suite;

const FAKE_SERPER_KEY = `lead-test-key-${Date.now().toString(36)}-9012`;
const MASK_HEAD = FAKE_SERPER_KEY.slice(0, 4);
const MASK_TAIL = FAKE_SERPER_KEY.slice(-4);
const LEAD_FIELDS = [
  "company_name",
  "website",
  "contact_person",
  "primary_email",
  "phone",
  "province",
  "city",
  "industry",
  "source_url",
  "ai_reason",
];

console.log(`目标实例：${base}`);

// ---------- 选测试主体：潜客设置行为空的种子账号 ----------
let account = "";
let initial = null;
for (const name of ["demo_user", "demo_tax3", "demo_overseas3", "demo_logistics3"]) {
  const res = await call("GET", "/enterprise/lead-prospecting/settings", name);
  if (res.code !== 0 || !res.data) continue;
  const d = res.data;
  if (!d.serperConfigured && !d.model) {
    account = name;
    initial = d;
    break;
  }
}
if (!account) {
  console.log("FAIL 找不到干净的测试账号（候选账号都已有潜客设置），中止且不写入");
  process.exit(1);
}
console.log(`测试主体：${account}（userId=${suite.users[account].userId}）`);

// ---------- 1) 设置读取：未配置形态 ----------
assert(initial.ready === false, "settings.ready 初始为 false");
assert(initial.serperConfigured === false, "serperConfigured 初始为 false");
assert(Array.isArray(initial.countries) && initial.countries.length > 0, "countries 是非空支持列表");
assert(typeof initial.keyConfigured === "boolean", "keyConfigured 是布尔（平台 Key 状态透传）");

// ---------- 2) 模型 Key 统一收口：带 apiKey 一律拒 ----------
const rejected = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  apiKey: FAKE_SERPER_KEY,
});
assert(
  rejected.code !== 0 && String(rejected.message || "").includes("API Key 管理"),
  "save 携带 apiKey 被拒并指路「API Key 管理」",
  `code=${rejected.code} message=${rejected.message}`,
);

// ---------- 3) 设置未齐时的门槛：chat / createTask 拒收自然语言 ----------
const chatBlocked = await call("POST", "/enterprise/lead-prospecting/chat", account, {
  messages: [{ role: "user", content: "我想找一批小型机械加工厂的客户线索" }],
});
assert(
  chatBlocked.code !== 0 && String(chatBlocked.message || "").includes("请先完成设置"),
  "未就绪时 chat 被后端 requireReady 拒绝",
  `message=${chatBlocked.message}`,
);
const taskBlocked = await call("POST", "/enterprise/lead-prospecting/tasks", account, {
  spec: { keywords: ["润滑油 加工厂"], country: "cn", scene: "测试", num: 5 },
});
assert(
  taskBlocked.code !== 0 && String(taskBlocked.message || "").includes("请先完成设置"),
  "未就绪时 createTask 同样被拒",
  `message=${taskBlocked.message}`,
);

// ---------- 4) 生成线索表（真落库，跑完删除） ----------
const tableRes = await call("POST", "/enterprise/lead-prospecting/data-table", account);
assert(tableRes.code === 0, "建表返回 code=0", `message=${tableRes.message}`);
const tableData = tableRes.data || {};
const createdTableId = tableData.created ? tableData.dataTableId : 0;
assert(
  tableData.created === false || tableData.created === true,
  "created 标志明确（幂等语义可测）",
  `created=${tableData.created} id=${tableData.dataTableId}`,
);
assert(tableData.name === "Google潜客线索", "表名＝Google潜客线索");
assert(
  JSON.stringify(tableData.fields) === JSON.stringify(LEAD_FIELDS),
  "10 列模版与 LEAD_TABLE_FIELDS 一一对应",
);
const tableAgain = await call("POST", "/enterprise/lead-prospecting/data-table", account);
assert(
  tableAgain.code === 0 && tableAgain.data.created === false &&
    tableAgain.data.dataTableId === tableData.dataTableId,
  "重复建表幂等：created=false 且同一张表",
);

// ---------- 4b) 承载表＝选已有 或 按用户填的名字新建（默认表判定与写行同源） ----------
const generatedId = tableData.dataTableId;
const optionsRes = await call("GET", "/enterprise/lead-prospecting/tables", account);
assert(optionsRes.code === 0 && !!optionsRes.data, "候选线索表接口返回 code=0", `message=${optionsRes.message}`);
const options = optionsRes.data || {};
assert(
  JSON.stringify(options.requiredColumns) === JSON.stringify(LEAD_FIELDS),
  "候选接口回带的必备列＝10 列模板（界面据此解释「为什么选不到」）",
);
assert(
  (options.columnLabels || []).length === LEAD_FIELDS.length,
  "中文列名与模板一一对应",
);
assert(
  (options.tables || []).some((item) => item.id === generatedId),
  "本次生成的线索表在候选里（本人归属＋列齐）",
);
assert(options.defaultTable?.id === generatedId, "默认线索表＝生成那张", `defaultTable=${JSON.stringify(options.defaultTable)}`);

// 用户填名字新建：表名逐字采用，列照样建满模板
const namedName = `潜客-命名实测-${Date.now().toString(36)}`;
const namedRes = await call("POST", "/enterprise/lead-prospecting/data-table", account, {
  name: namedName,
});
assert(
  namedRes.code === 0 && namedRes.data?.created === true && namedRes.data?.name === namedName,
  "传 name 按用户填的表名新建",
  `message=${namedRes.message} data=${JSON.stringify(namedRes.data)}`,
);
const namedId = namedRes.data?.dataTableId || 0;
assert(
  JSON.stringify(namedRes.data?.fields) === JSON.stringify(LEAD_FIELDS),
  "命名新建同样建满 10 列",
);
const afterNamed = await call("GET", "/enterprise/lead-prospecting/settings", account);
assert(
  afterNamed.data?.dataTableId === generatedId,
  "命名新建未带 setDefault：不顶掉默认线索表",
  `dataTableId=${afterNamed.data?.dataTableId}`,
);
const namedInOptions = await call("GET", "/enterprise/lead-prospecting/tables", account);
assert(
  (namedInOptions.data?.tables || []).some((item) => item.id === namedId),
  "命名新建的表立刻进候选（可直接被下拉选中）",
);

// 把默认表改选成另一张已有表
const switchDefault = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  dataTableId: namedId,
});
assert(
  switchDefault.code === 0 && switchDefault.data?.dataTableId === namedId,
  "save 携带 dataTableId：默认线索表改选为已有表",
  `message=${switchDefault.message} dataTableId=${switchDefault.data?.dataTableId}`,
);
const switchedOptions = await call("GET", "/enterprise/lead-prospecting/tables", account);
assert(
  switchedOptions.data?.defaultTable?.id === namedId,
  "候选接口里的默认表跟着改选结果",
);

// 非法/不合格的表都不许成为默认
const zeroSave = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  dataTableId: 0,
});
assert(
  zeroSave.code !== 0 && /请选择一张线索表/.test(String(zeroSave.message)),
  "dataTableId=0 被拒",
  `message=${zeroSave.message}`,
);
const blankName = `潜客-缺列实测-${Date.now().toString(36)}`;
const blankRes = await call("POST", "/enterprise/data-tables", account, {
  name: blankName,
  description: "只有表头没有模板列，用来验证选不进来",
});
assert(blankRes.code === 0 && !!blankRes.data?.id, "另建一张无模板列的空白多维表格", `message=${blankRes.message}`);
const blankId = blankRes.data?.id || 0;
const blankInOptions = await call("GET", "/enterprise/lead-prospecting/tables", account);
assert(
  !(blankInOptions.data?.tables || []).some((item) => item.id === blankId),
  "列不齐的表不进候选（选了也写不进去）",
);
const blankSave = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  dataTableId: blankId,
});
assert(
  blankSave.code !== 0 &&
    /缺少列/.test(String(blankSave.message)) &&
    String(blankSave.message).includes(blankName),
  "硬把缺列的表设为默认被 assertWritable 拒，且点名表与缺的列",
  `message=${blankSave.message}`,
);
// 改选失败后默认表仍是上一张合格的表
const stillSwitched = await call("GET", "/enterprise/lead-prospecting/settings", account);
assert(
  stillSwitched.data?.dataTableId === namedId,
  "被拒的改选不覆盖原默认线索表",
  `dataTableId=${stillSwitched.data?.dataTableId}`,
);
// 逐任务改表：任务不存在先按归属拒，不许静默成功
const ghostPatch = await call("PATCH", "/enterprise/lead-prospecting/tasks/99999999/table", account, {
  dataTableId: namedId,
});
assert(
  ghostPatch.code !== 0 && /不存在或不属于你/.test(String(ghostPatch.message)),
  "改不存在的任务的目标表被拒",
  `message=${ghostPatch.message}`,
);

// ---------- 5) 保存假 Serper Key + 模型：加密回掩码 ----------
const saveRes = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  serperApiKey: FAKE_SERPER_KEY,
  model: "doubao-pro-32k",
});
assert(saveRes.code === 0, "save serperApiKey+model 成功", `message=${saveRes.message}`);
const saved = saveRes.data || {};
assert(saved.serperConfigured === true, "保存后 serperConfigured=true（密文可回解）");
assert(
  saved.serperMasked === `${MASK_HEAD}…${MASK_TAIL}`,
  "掩码＝首4…尾4",
  `serperMasked=${saved.serperMasked}`,
);
assert(
  !JSON.stringify(saveRes).includes(FAKE_SERPER_KEY),
  "响应信封不含 Key 明文",
);
assert(saved.model === "doubao-pro-32k", "模型名回显");
assert(saved.dataTableExists === true, "保存后 dataTableExists=true");

// ---------- 5b) 设置页签「保存设置」＝一个 PUT 同时改多项 ----------
// 界面把整页草稿收成一个提交动作，且只发改动过的键，所以这三项必须在同一次请求里全部生效。
const combinedSave = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  dataTableId: generatedId,
  model: "doubao-pro-128k",
  serperApiKey: FAKE_SERPER_KEY,
});
assert(
  combinedSave.code === 0 &&
    combinedSave.data?.dataTableId === generatedId &&
    combinedSave.data?.model === "doubao-pro-128k" &&
    combinedSave.data?.serperConfigured === true,
  "一个 PUT 同时改默认线索表 + 模型 + Serper Key：三项都立即生效",
  `message=${combinedSave.message} dataTableId=${combinedSave.data?.dataTableId} model=${combinedSave.data?.model}`,
);
const combinedRead = await call("GET", "/enterprise/lead-prospecting/settings", account);
assert(
  combinedRead.data?.dataTableId === generatedId &&
    combinedRead.data?.model === "doubao-pro-128k",
  "改后重读：默认表与模型都已落库（不存在只落一半）",
  `dataTableId=${combinedRead.data?.dataTableId} model=${combinedRead.data?.model}`,
);
const nothingToSave = await call("PUT", "/enterprise/lead-prospecting/settings", account, {});
assert(
  nothingToSave.code !== 0 &&
    /没有需要保存的设置/.test(String(nothingToSave.message || "")),
  "save 空载荷拒收（界面据此只在有改动时才发请求）",
  `message=${nothingToSave.message}`,
);
const restoreSave = await call("PUT", "/enterprise/lead-prospecting/settings", account, {
  dataTableId: namedId,
  model: "doubao-pro-32k",
});
assert(
  restoreSave.code === 0 &&
    restoreSave.data?.dataTableId === namedId &&
    restoreSave.data?.model === "doubao-pro-32k",
  "再一次合并保存把默认表与模型改回上一步的值（同样只发一个 PUT）",
  `message=${restoreSave.message}`,
);

// ---------- 6) 清除 Serper Key → 重新入门槛 ----------
const cleared = await call("DELETE", "/enterprise/lead-prospecting/settings/serper-key", account);
assert(
  cleared.code === 0 && cleared.data.serperConfigured === false && cleared.data.ready === false,
  "清除 Key 后回到未就绪",
  `message=${cleared.message}`,
);
const chatBlockedAgain = await call("POST", "/enterprise/lead-prospecting/chat", account, {
  messages: [{ role: "user", content: "现在能聊吗" }],
});
assert(
  chatBlockedAgain.code !== 0 && String(chatBlockedAgain.message || "").includes("Serper"),
  "清除后 chat 被拒且点名缺 Serper API Key",
  `message=${chatBlockedAgain.message}`,
);

// ---------- 7) 任务参数校验（normalizeSpec 先于就绪门槛，两条规则各自独立成立） ----------
// 此刻 Serper Key 已清除（第 6 步），所以合法 spec 只会撞上就绪门槛；
// 非法 spec 必须先被参数校验拒掉，不允许出现「因为没就绪所以看不出参数非法」。
const badCountry = await call("POST", "/enterprise/lead-prospecting/tasks", account, {
  spec: { keywords: ["test"], country: "zz", scene: "", num: 5 },
});
const badNum = await call("POST", "/enterprise/lead-prospecting/tasks", account, {
  spec: { keywords: ["test"], country: "cn", scene: "", num: 999 },
});
const goodSpecButNotReady = await call(
  "POST",
  "/enterprise/lead-prospecting/tasks",
  account,
  { spec: { keywords: ["test"], country: "cn", scene: "", num: 5 } },
);
assert(
  badCountry.code !== 0 && /任务参数不合法/.test(String(badCountry.message)),
  "非法 country 由参数校验拒掉",
  `message=${badCountry.message}`,
);
assert(
  badNum.code !== 0 && /任务参数不合法/.test(String(badNum.message)),
  "num=999 由参数校验拒掉",
  `message=${badNum.message}`,
);
assert(
  goodSpecButNotReady.code !== 0 &&
    /请先完成设置/.test(String(goodSpecButNotReady.message)),
  "合法 spec 但设置未齐：由就绪门槛拒掉（两条规则各判各的）",
  `message=${goodSpecButNotReady.message}`,
);

// ---------- 8) 列表接口形态 ----------
const msgs = await call("GET", "/enterprise/lead-prospecting/messages", account);
assert(msgs.code === 0 && Array.isArray(msgs.data), "messages 返回数组", `message=${msgs.message}`);
const tasksPage = await call("GET", "/enterprise/lead-prospecting/tasks?page=1&pageSize=50", account);
assert(
  tasksPage.code === 0 && Array.isArray(tasksPage.data?.list),
  "tasks 分页返回 list",
  `message=${tasksPage.message}`,
);

// ---------- 9) 真就绪则补验 start 门槛 + 建一个 pending 任务再删 ----------
// 假 Serper Key 先装回去；平台 sk- Key 是否存在决定 ready（不伪造、不读取）。
await call("PUT", "/enterprise/lead-prospecting/settings", account, { serperApiKey: FAKE_SERPER_KEY });
const now = await call("GET", "/enterprise/lead-prospecting/settings", account);
if (now.data?.ready) {
  const taskRes = await call("POST", "/enterprise/lead-prospecting/tasks", account, {
    spec: { keywords: ["工业润滑油 小型机械加工厂"], country: "cn", scene: "接口实测", num: 3 },
    rawIntent: "接口实测：验证 createTask→start 门槛",
  });
  assert(taskRes.code === 0 && taskRes.data.status === "pending", "就绪后 createTask 落库 pending");
  const taskId = taskRes.data?.id;
  // 待执行任务可逐条改选目标表（同一次实测里顺带覆盖），改完仍按新表执行
  const retabled = await call("PATCH", `/enterprise/lead-prospecting/tasks/${taskId}/table`, account, {
    dataTableId: namedId,
  });
  assert(
    retabled.code === 0 &&
      retabled.data?.dataTableId === namedId &&
      retabled.data?.dataTableName === namedName &&
      retabled.data?.status === "pending",
    "待执行任务改选线索表成功且表名跟着变",
    `message=${retabled.message} data=${JSON.stringify(retabled.data)}`,
  );
  const retabledBad = await call("PATCH", `/enterprise/lead-prospecting/tasks/${taskId}/table`, account, {
    dataTableId: blankId,
  });
  assert(
    retabledBad.code !== 0 && /缺少列/.test(String(retabledBad.message)),
    "任务也不许改到缺列的表",
    `message=${retabledBad.message}`,
  );
  const started = await call("POST", `/enterprise/lead-prospecting/tasks/${taskId}/start`, account);
  assert(
    started.code === 0 || String(started.message || "").includes("请先完成设置"),
    "start 通过校验或被门槛拒绝（假 Key 不发起真实搜索链路）",
    `message=${started.message}`,
  );
  if (started.code === 0) {
    // 后台第一跳 Serper 会因假 Key 失败：等它落 failed 再删，验证错误面
    let st = started.data?.status;
    for (let i = 0; i < 10 && st === "running"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      st = (await call("GET", `/enterprise/lead-prospecting/tasks/${taskId}`, account)).data?.status;
    }
    assert(st !== "running", `假 Key 任务收敛为 ${st}（不卡 running）`);
  }
  if (taskId) {
    const removed = await call("DELETE", `/enterprise/lead-prospecting/tasks/${taskId}`, account);
    assert(removed.code === 0 && removed.data?.deleted === true, "删除任务成功");
  }
} else {
  const missing = [];
  if (!now.data?.serperConfigured) missing.push("serper");
  if (!now.data?.model) missing.push("model");
  if (!now.data?.keyConfigured) missing.push("平台 sk- Key");
  console.log(`SKIP start/createTask 实弹（该账号缺：${missing.join("、")}）`);
}

// ---------- 清理 ----------
console.log("— 清理本次产生的数据 —");
const leftover = await call("GET", "/enterprise/lead-prospecting/messages", account);
if ((leftover.data || []).length) {
  console.log(`注意：账号 ${account} 有 ${(leftover.data || []).length} 条对话记录（本脚本未成功发起 chat，属历史残留，保留不删）`);
}
if (createdTableId) {
  const del = await call("DELETE", `/enterprise/data-tables/${createdTableId}`, account);
  assert(del.code === 0, `删除本次创建的线索表 #${createdTableId}`, `message=${del.message}`);
}
for (const [id, label] of [
  [namedId, "命名新建的线索表"],
  [blankId, "验证用的空白表"],
]) {
  if (!id) continue;
  const del = await call("DELETE", `/enterprise/data-tables/${id}`, account);
  assert(del.code === 0, `删除本次${label} #${id}`, `message=${del.message}`);
}
await call("PUT", "/enterprise/lead-prospecting/settings", account, { model: "" });
const afterClear = await call("DELETE", "/enterprise/lead-prospecting/settings/serper-key", account);
assert(
  afterClear.code === 0 && !afterClear.data.serperConfigured && !afterClear.data.model,
  "Serper Key 与模型已清空",
);
if (!createdTableId && initial.dataTableId) {
  console.log(`提示：账号原有线索表 #${initial.dataTableId} 未动（非本次创建）`);
}

console.log(suite.summary());
process.exit(suite.counts().failed ? 1 : 0);
