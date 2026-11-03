/**
 * 账号自建模块（多维表格 / RPA / AI 调用账号）复核批次的接口层实测。
 *
 * 覆盖本轮 code review 改掉的机械类问题：
 * 1) 模板建表一次批量建列：`POST /enterprise/data-tables/:id/fields/batch` 一趟写完全部列
 *    （此前只有 service 里的批量方法，没有任何 HTTP 入口，界面只能逐列往返十几次）；
 * 2) 批量建列的批次校验：空清单、同批重复列键、与已有列键冲突、单选列缺候选项，
 *    都要报出来且不写一半（校验全在写入之前）；
 * 3) RPA 周期排期的号数 / 分钟超出取值直接报错，不再静默收口成 0
 *    （0 号、0 分永远匹配不上，任务会一次都不跑）；界面提交形态是字符串，落库要仍是原值；
 * 4) RPA 账号接口只回「存过没有」，登录口令与代理口令的明文、密文都不出现在响应里；
 * 5) AI 调用账号接口同样不回凭据明文，且「其他字段」夹带 token/password 这类键直接拒。
 *
 * 口径：
 * - 打在开发实例（默认 1690，见 [[project-local-runtime]]）。测试主体用 seed 账号 demo_user，
 *   本次创建的表格 / 脚本 / 账号 / 任务在收尾全部删除，账号回到初始状态。
 * - RPA 任务只创建不派发：本地比特浏览器执行端不在线，pending 不会被认领；也不发起真外呼。
 * - 假凭据明文只在本进程内存里，不打印、不落盘。
 *
 * 用法：node scripts/verify-automation-hardening.mjs [BASE_URL]
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({ base: process.argv[2] || "http://127.0.0.1:1690" });
const { call, assert, base } = suite;

const stamp = Date.now().toString(36);
const FAKE_RPA_PASSWORD = `rpa-pw-${stamp}-SECRET`;
const FAKE_RPA_PROXY_PASSWORD = `rpa-proxy-${stamp}-SECRET`;
const FAKE_AI_API_KEY = `ai-key-${stamp}-SECRET`;

/** 本轮创建的测试数据，收尾逐个删除。 */
const cleanup = [];
const TABLE_NAME = `复核批次-批量建列-${stamp}`;
const SCRIPT_NAME = `复核批次-脚本-${stamp}`;
const ACCOUNT_PLATFORM = `复核批次平台-${stamp}`;
const AI_ACCOUNT_NAME = `复核批次AI账号-${stamp}`;

console.log(`目标实例：${base}`);

const ACCOUNT = "demo_user";
const me = await call("GET", "/enterprise/me", ACCOUNT);
if (me.code !== 0) {
  console.log(`FAIL 测试主体不可用（${me.message}），中止且不写入`);
  process.exit(1);
}

// ---------- 1) 多维表格：模板建表一次批量建列 ----------
const table = await call("POST", "/enterprise/data-tables", ACCOUNT, {
  name: TABLE_NAME,
  description: "复核批次实测：模板建表走批量建列",
});
assert(table.code === 0 && table.data?.id, "建表成功", table.message);
const tableId = table.data?.id;
if (tableId) cleanup.push(["表格", `/enterprise/data-tables/${tableId}`]);

const TEMPLATE_FIELDS = [
  { name: "公司名称", fieldKey: "company_name", fieldType: "text", required: true },
  { name: "注册资本", fieldKey: "reg_capital", fieldType: "number" },
  { name: "在营", fieldKey: "in_business", fieldType: "boolean" },
  { name: "成立日期", fieldKey: "found_date", fieldType: "date" },
  {
    name: "所属行业",
    fieldKey: "industry",
    fieldType: "select",
    options: { choices: ["制造", "贸易", "服务"] },
  },
];

const batch = await call(
  "POST",
  `/enterprise/data-tables/${tableId}/fields/batch`,
  ACCOUNT,
  { fields: TEMPLATE_FIELDS },
);
assert(batch.code === 0, "批量建列一次返回成功", batch.message);
assert(Array.isArray(batch.data) && batch.data.length === 5, "一次建 5 列全部落库");

const detail = await call("GET", `/enterprise/data-tables/${tableId}`, ACCOUNT);
const fields = detail.data?.fields || [];
assert(fields.length === 5, "表详情读到 5 列", `code=${detail.code} ${detail.message ?? ""}`);
assert(
  fields.map((f) => f.sortOrder).join(",") === "0,1,2,3,4",
  "列序按提交顺序连续",
  fields.map((f) => f.sortOrder).join(","),
);
assert(
  fields.find((f) => f.fieldKey === "industry")?.options?.choices?.length === 3,
  "单选列候选项随批量写入落库",
);

// ---------- 2) 批量建列的批次校验：报出来且不写一半 ----------
const emptyBatch = await call(
  "POST",
  `/enterprise/data-tables/${tableId}/fields/batch`,
  ACCOUNT,
  { fields: [] },
);
assert(emptyBatch.code === 400, "空列清单直接拒绝", emptyBatch.message);
assert(
  (emptyBatch.message || "").includes("至少提交一列"),
  "空列清单给出「请至少提交一列」",
);

const duplicated = await call(
  "POST",
  `/enterprise/data-tables/${tableId}/fields/batch`,
  ACCOUNT,
  {
    fields: [
      { name: "新列甲", fieldKey: "new_a", fieldType: "text" },
      { name: "新列乙", fieldKey: "new_a", fieldType: "number" },
    ],
  },
);
assert(duplicated.code === 400, "同批重复列键直接拒绝", duplicated.message);

const conflicted = await call(
  "POST",
  `/enterprise/data-tables/${tableId}/fields/batch`,
  ACCOUNT,
  {
    fields: [
      { name: "新列丙", fieldKey: "new_c", fieldType: "text" },
      { name: "撞已有列", fieldKey: "company_name", fieldType: "text" },
    ],
  },
);
assert(conflicted.code === 409, "列键撞已有列报 409", conflicted.message);

const noChoices = await call(
  "POST",
  `/enterprise/data-tables/${tableId}/fields/batch`,
  ACCOUNT,
  { fields: [{ name: "缺候选项", fieldKey: "no_choice", fieldType: "select" }] },
);
assert(noChoices.code === 400, "单选列缺候选项直接拒绝", noChoices.message);

const afterBadBatches = await call(
  "GET",
  `/enterprise/data-tables/${tableId}`,
  ACCOUNT,
);
assert(
  (afterBadBatches.data?.fields || []).length === 5,
  "被拒的批次一列都没写进去（仍是 5 列）",
  `读到 ${afterBadBatches.data?.fields?.length} 列`,
);

// ---------- 3) RPA：脚本 + 账号 + 排期校验 ----------
const script = await call("POST", "/enterprise/rpa/scripts", ACCOUNT, {
  name: SCRIPT_NAME,
  deviceType: "pc",
  fileType: "javascript",
  content: "console.log('review-batch');",
  paramsSchema: {},
});
assert(script.code === 0 && script.data?.id, "建 RPA 脚本成功", script.message);
const scriptId = script.data?.id;
if (scriptId) cleanup.push(["脚本", `/enterprise/rpa/scripts/${scriptId}`]);

const account = await call("POST", "/enterprise/rpa/accounts", ACCOUNT, {
  platform: ACCOUNT_PLATFORM,
  username: `rpa-user-${stamp}`,
  password: FAKE_RPA_PASSWORD,
  envType: 0,
  proxyMethod: 2,
  proxyType: "http",
  proxyHost: "127.0.0.1",
  proxyPort: 8888,
  proxyUserName: "proxy-user",
  proxyPassword: FAKE_RPA_PROXY_PASSWORD,
});
assert(account.code === 0 && account.data?.id, "登记 RPA 账号成功", account.message);
const accountId = account.data?.id;
if (accountId) cleanup.push(["账号", `/enterprise/rpa/accounts/${accountId}`]);
assert(account.data?.hasPassword === true, "建号响应只回 hasPassword 布尔");
assert(account.data?.hasProxyPassword === true, "建号响应只回 hasProxyPassword 布尔");

const scheduleTask = (config) =>
  call("POST", "/enterprise/rpa/tasks", ACCOUNT, {
    name: `复核批次-任务-${stamp}`,
    scriptId,
    accountIds: [accountId],
    scheduleType: "recurring",
    scheduleConfig: config,
  });

const badDay = await scheduleTask({ freq: "monthly", time: "02:00", day: "99" });
assert(badDay.code === 400, "每月执行日 99 被拒", badDay.message);
assert(
  (badDay.message || "").includes("1-31"),
  "号数越界给出取值范围文案",
);

const badMinute = await scheduleTask({ freq: "hourly", minute: 75 });
assert(badMinute.code === 400, "每小时分钟 75 被拒", badMinute.message);
assert(
  (badMinute.message || "").includes("0-59"),
  "分钟越界给出取值范围文案",
);

const junkDay = await scheduleTask({ freq: "monthly", day: "12a" });
assert(junkDay.code === 400, "号数写成「12a」被拒（不再当成没填）", junkDay.message);

const goodTask = await scheduleTask({ freq: "monthly", time: "02:00", day: "15" });
assert(goodTask.code === 0, "界面提交形态（字符串号数）建任务成功", goodTask.message);
assert(
  goodTask.data?.scheduleConfig?.day === 15,
  "号数落库后仍是 15（不是 0，也不是 null）",
  JSON.stringify(goodTask.data?.scheduleConfig),
);
const taskId = goodTask.data?.id;
if (taskId) cleanup.push(["任务", `/enterprise/rpa/tasks/${taskId}`]);

// ---------- 4) 账号类接口不外泄凭据 ----------
const wb = await call("POST", "/enterprise/workbuddy/accounts", ACCOUNT, {
  name: `复核批次-腾讯云凭据-${stamp}`,
  secretId: `AKIDfake${stamp}`,
  secretKey: `fakeSecret${stamp}`,
});
assert(wb.code === 0 && wb.data?.id, "建 Workbuddy 凭据成功（AI 账号要绑定它）", wb.message);
const wbId = wb.data?.id;
if (wbId) cleanup.push(["Workbuddy 凭据", `/enterprise/workbuddy/accounts/${wbId}`]);
const wbBody = JSON.stringify(wb.data ?? {});
assert(!wbBody.includes(`fakeSecret${stamp}`), "Workbuddy 清单不含 SecretKey 明文");

const rpaAccounts = await call("GET", "/enterprise/rpa/accounts", ACCOUNT);
const rpaBody = JSON.stringify(rpaAccounts.data ?? {});
assert(rpaAccounts.code === 0, "RPA 账号清单读取成功", rpaAccounts.message);
assert(!rpaBody.includes(FAKE_RPA_PASSWORD), "账号清单不含登录口令明文");
assert(!rpaBody.includes(FAKE_RPA_PROXY_PASSWORD), "账号清单不含代理口令明文");
assert(!/keyCipher|proxyPasswordCipher/.test(rpaBody), "账号清单不含密文列");

const aiBadExtra = await call("POST", "/enterprise/ai-call/accounts", ACCOUNT, {
  name: AI_ACCOUNT_NAME,
  platform: `ai-platform-${stamp}`,
  apiKey: FAKE_AI_API_KEY,
  workbuddyAccountIds: [wbId],
  extra: { token: "should-be-rejected" },
});
assert(aiBadExtra.code === 400, "AI 账号「其他字段」夹带 token 被拒", aiBadExtra.message);

const aiAccount = await call("POST", "/enterprise/ai-call/accounts", ACCOUNT, {
  name: AI_ACCOUNT_NAME,
  platform: `ai-platform-${stamp}`,
  apiKey: FAKE_AI_API_KEY,
  workbuddyAccountIds: [wbId],
  extra: { 店铺编号: `shop-${stamp}` },
});
assert(aiAccount.code === 0, "AI 账号建号成功", aiAccount.message);
const aiId = aiAccount.data?.id;
if (aiId) cleanup.push(["AI 账号", `/enterprise/ai-call/accounts/${aiId}`]);

const aiList = await call("GET", "/enterprise/ai-call/accounts", ACCOUNT);
const aiBody = JSON.stringify(aiList.data ?? {});
assert(!aiBody.includes(FAKE_AI_API_KEY), "AI 账号清单不含 API Key 明文");
assert(!/apiKeyCipher|passwordCipher|cookieCipher/.test(aiBody), "AI 账号清单不含密文列");

// ---------- 收尾：本次创建的测试数据全部删除 ----------
console.log("清理测试数据：");
// 后建的先删：脚本/账号被任务引用时禁止删除，倒序才一次删干净。
for (const [label, path] of cleanup.toReversed()) {
  const removed = await call("DELETE", path, ACCOUNT);
  assert(removed.code === 0, `删除${label}`, removed.message);
}

const finalTable = await call("GET", `/enterprise/data-tables/${tableId}`, ACCOUNT);
assert(
  finalTable.code !== 0,
  "表格已删除（再读读不到）",
  `code=${finalTable.code}`,
);

const counts = suite.counts();
console.log(`\n${suite.summary()}`);
if (counts.failed) process.exit(1);
