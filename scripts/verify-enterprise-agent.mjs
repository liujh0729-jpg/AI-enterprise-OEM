/**
 * 智能体记忆（工作台分组）阶段 1：意图记忆实测。
 *
 * 口径：
 * - 打在开发实例（默认 1690）上，用种子账号的真实登录态走本站接口，真写数据、真落库。
 * - 测试主体＝本脚本自己建的一张多维表格 + 一把自己签发并当场吊销的平台 Key，
 *   结束时表格删除、Key 吊销、本人账号的记忆清空（基线已核对为空，清空只波及本脚本写下的事件）。
 * - 断言的是「记了什么」而不是「有没有记」：动作名、业务域、对象 id、参数脱敏、
 *   结果（成功/失败）、通道（网页/机器）逐条核对；读请求与 /enterprise/agent 自身不进记忆。
 *
 * 用法：node scripts/verify-enterprise-agent.mjs [BASE_URL]
 */
import { createPrisma, createSuite, httpJson } from "./harness.mjs";

const suite = createSuite({
  base: process.argv[2] || "http://127.0.0.1:1690",
});
const { call, assert, summary, users } = suite;

const OWNER = "demo_flex3";
const OTHER = "demo_legal";
const TABLE_NAME = `智能体实测表 ${Date.now()}`;
const PLAIN_SECRET = "must-never-be-stored-plain";

const sumOf = (tally) => Object.values(tally).reduce((a, b) => a + b, 0);
/** 删表、吊销 Key 之前应当留下的事件。 */
const BEFORE_CLEANUP = {
  DataTable_create: 1,
  DataTable_addField: 1,
  DataTable_addRow: 4,
  OpenApi_dataTableCreateRows: 1,
  Identity_createKey: 1,
};
/** 收尾两个写动作也进记忆，所以清空时的条数＝全部 10 条。 */
const ALL_EVENTS = {
  ...BEFORE_CLEANUP,
  DataTable_remove: 1,
  Identity_revokeKey: 1,
};
const BEFORE_TOTAL = sumOf(BEFORE_CLEANUP);
const ALL_TOTAL = sumOf(ALL_EVENTS);

const hasChinese = (value) => /[一-龥]/.test(String(value || ""));

/** 动作名 → 条数：把清单压成可比较的字典，避免「多记一条」被总数掩盖。 */
function tally(rows) {
  const out = {};
  for (const row of rows) out[row.action] = (out[row.action] || 0) + 1;
  return out;
}
/** 按键名排序后比较：动作条数对得上就行，不依赖对象插入顺序。 */
const sameTally = (left, right) =>
  JSON.stringify(sortedTally(left)) === JSON.stringify(sortedTally(right));
const sortedTally = (value) =>
  Object.fromEntries(
    Object.entries(value || {})
      .filter(([, count]) => count !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

const prisma = createPrisma();
let tableId = 0;
let keyId = 0;

/** 中途失败时也把业务数据收掉，凭据不留在库里。 */
async function cleanup() {
  if (tableId) {
    await call("DELETE", `/api/backend/enterprise/data-tables/${tableId}`, OWNER);
    tableId = 0;
  }
  if (keyId) {
    await call(
      "POST",
      `/api/backend/enterprise/api-keys/${keyId}/revoke`,
      OWNER,
      {},
    );
    keyId = 0;
  }
  await call("POST", "/api/backend/enterprise/agent/memory/clear", OWNER, {});
  await prisma.$disconnect();
}

async function main() {
  // ---------- 1. 地基：本人账号此刻应无记忆 ----------
  const before = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OWNER,
  );
  assert(
    before.status === 200 && before.code === 0,
    "概览接口可用",
    before.message,
  );
  assert(
    before.data?.total === 0,
    "本人账号记忆为空",
    `total=${before.data?.total}`,
  );
  const otherBefore = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OTHER,
  );
  assert(
    otherBefore.data?.total === 0,
    "别的账号不被聚合（默认禁止跨账号）",
    `total=${otherBefore.data?.total}`,
  );

  // ---------- 2. 网页通道：建表 + 建列 + 逐条写 3 行 ----------
  const created = await call(
    "POST",
    "/api/backend/enterprise/data-tables",
    OWNER,
    { name: TABLE_NAME, password: PLAIN_SECRET },
  );
  assert(created.code === 0 && created.data?.id, "建表成功", created.message);
  tableId = Number(created.data?.id);

  const field = await call(
    "POST",
    `/api/backend/enterprise/data-tables/${tableId}/fields`,
    OWNER,
    { name: "名称", fieldKey: "name" },
  );
  assert(field.code === 0, "建列成功", field.message);

  for (let index = 1; index <= 3; index += 1) {
    const row = await call(
      "POST",
      `/api/backend/enterprise/data-tables/${tableId}/rows`,
      OWNER,
      { name: `实测行 ${index}` },
    );
    assert(row.code === 0, `写第 ${index} 行`, row.message);
  }

  // ---------- 3. 失败也要留痕：往不存在的表写行 ----------
  const failing = await call(
    "POST",
    "/api/backend/enterprise/data-tables/999999999/rows",
    OWNER,
    { name: "不该成功" },
  );
  assert(failing.code !== 0, "失败请求确实失败", `code=${failing.code}`);

  // ---------- 4. 机器通道：签发平台 Key → /api/v1 批量写 2 行 ----------
  const key = await call("POST", "/api/backend/enterprise/api-keys", OWNER, {});
  assert(!!key.data?.plainKey, "签发平台 Key", key.message);
  keyId = Number(key.data?.id);
  const plainKey = String(key.data?.plainKey);

  const machineRes = await httpJson({
    url: `${suite.base}/api/backend/api/v1/data-tables/${tableId}/rows/batch`,
    method: "POST",
    body: { rows: [{ name: "机器行 1" }, { name: "机器行 2" }] },
    headers: { "X-Api-Key": plainKey },
  });
  assert(machineRes.data?.code === 0, "机器通道批量写行 2 条", machineRes.data?.message);

  // ---------- 5. 操作流：逐条核对记了什么 ----------
  const events = await call(
    "GET",
    "/api/backend/enterprise/agent/events?page=1&pageSize=50",
    OWNER,
  );
  assert(events.code === 0, "操作流接口可用", events.message);
  const list = events.data?.list || [];
  assert(
    list.length === BEFORE_TOTAL,
    `记下 ${BEFORE_TOTAL} 条意图`,
    `实际 ${list.length} 条：${JSON.stringify(tally(list))}`,
  );
  assert(
    sameTally(tally(list), BEFORE_CLEANUP),
    "动作清单逐条对上（不多记、不漏记）",
    JSON.stringify(tally(list)),
  );

  const byAction = (action) => list.filter((row) => row.action === action);

  // 建表：对象 id 与名称取自响应，凭据键只留占位
  const createEvent = byAction("DataTable_create")[0];
  assert(
    createEvent?.targetId === String(tableId),
    "建表事件记住对象 id",
    createEvent?.targetId,
  );
  assert(
    createEvent?.targetLabel === TABLE_NAME,
    "建表事件记住表名",
    createEvent?.targetLabel,
  );
  assert(
    createEvent?.params?.password === "[已脱敏]",
    "口令键只留占位",
    JSON.stringify(createEvent?.params),
  );
  assert(
    createEvent?.params?.name === TABLE_NAME,
    "业务参数留下摘要",
    JSON.stringify(createEvent?.params?.name),
  );
  assert(
    createEvent?.domain === "data-tables",
    "业务域＝路径首段",
    createEvent?.domain,
  );
  assert(
    createEvent?.channel === "web",
    "界面请求记为网页通道",
    createEvent?.channel,
  );
  assert(createEvent?.outcome === "ok", "成功请求记为成功", createEvent?.outcome);

  // 中文标签由契约派生，界面不需要第二份字典
  assert(
    list.every((row) => hasChinese(row.actionLabel) && hasChinese(row.domainLabel)),
    "每条都有中文动作名与业务域名",
    `${createEvent?.actionLabel} / ${createEvent?.domainLabel}`,
  );
  assert(
    list.every(
      (row) => hasChinese(row.outcomeLabel) && hasChinese(row.channelLabel),
    ),
    "结果与通道也是中文",
    `${createEvent?.outcomeLabel} / ${createEvent?.channelLabel}`,
  );

  // 失败请求：记 outcome 与本站错误码，不记上游原文
  const failedEvents = list.filter((row) => row.outcome === "failed");
  assert(
    failedEvents.length === 1,
    "失败请求留一条痕",
    `实际 ${failedEvents.length} 条`,
  );
  assert(
    failedEvents[0]?.action === "DataTable_addRow",
    "失败的那条是写行",
    failedEvents[0]?.action,
  );
  assert(
    failedEvents[0]?.targetId === "999999999",
    "失败也记住目标对象（路径参数兜底）",
    failedEvents[0]?.targetId,
  );
  assert(
    String(failedEvents[0]?.errorCode) === String(failing.code),
    "错误码＝本站信封 code",
    `${failedEvents[0]?.errorCode} vs ${failing.code}`,
  );

  // 机器通道：/api/v1 的写记为 machine，数组参数只留条数与样本
  const machineEvent = byAction("OpenApi_dataTableCreateRows")[0];
  assert(
    machineEvent?.channel === "machine",
    "机器通道单独归一类",
    machineEvent?.channel,
  );
  assert(
    machineEvent?.domain === "data-tables",
    "机器通道业务域对齐",
    machineEvent?.domain,
  );
  assert(
    machineEvent?.targetId === String(tableId),
    "机器通道记住目标表",
    machineEvent?.targetId,
  );
  assert(
    machineEvent?.params?.rows?.count === 2,
    "数组参数只留条数",
    JSON.stringify(machineEvent?.params),
  );

  // 凭据绝不进记忆：明文 Key 与口令都不得出现在任何一条事件里
  const dump = JSON.stringify(list);
  assert(!dump.includes(PLAIN_SECRET), "明文口令未进记忆");
  assert(!dump.includes(plainKey), "明文平台 Key 未进记忆");

  // ---------- 6. 概览统计与分布 ----------
  const overview = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OWNER,
  );
  const stats = overview.data || {};
  assert(stats.total === BEFORE_TOTAL, "概览总数＝事件条数", `total=${stats.total}`);
  assert(stats.failed === 1, "概览失败数＝1", `failed=${stats.failed}`);
  assert(
    stats.last7Days === BEFORE_TOTAL,
    `近 7 天＝全部 ${BEFORE_TOTAL} 条（今天写的）`,
    `last7Days=${stats.last7Days}`,
  );
  assert(stats.activeDays === 1, "活跃天数＝1", `activeDays=${stats.activeDays}`);
  assert(
    !!stats.firstAt && !!stats.lastAt,
    "首末时间可用",
    `${stats.firstAt} ~ ${stats.lastAt}`,
  );
  const domainCount = (rows) =>
    Object.fromEntries((rows || []).map((row) => [row.domain, row.count]));
  assert(
    domainCount(stats.byDomain)["data-tables"] === 7 &&
      domainCount(stats.byDomain)["api-keys"] === 1,
    "按业务域分布：多维表格 7 / 平台密钥 1",
    JSON.stringify(domainCount(stats.byDomain)),
  );
  const channelCount = Object.fromEntries(
    (stats.byChannel || []).map((row) => [row.channel, row.count]),
  );
  assert(
    channelCount.web === 7 && channelCount.machine === 1,
    "按通道分布：网页 7 / 机器 1",
    JSON.stringify(channelCount),
  );
  const topRow = (stats.topActions || []).find(
    (row) => row.action === "DataTable_addRow",
  );
  assert(topRow?.count === 4, "高频动作：写行 4 次", JSON.stringify(topRow));

  // 筛选参数生效：只看失败的那一条
  const onlyFailed = await call(
    "GET",
    "/api/backend/enterprise/agent/events?outcome=failed&pageSize=10",
    OWNER,
  );
  assert(
    onlyFailed.data?.total === 1 &&
      onlyFailed.data?.list?.[0]?.outcome === "failed",
    "按结果筛选生效",
    `total=${onlyFailed.data?.total}`,
  );

  // ---------- 7. 留痕双写：每条意图都锚一条 audit_logs ----------
  const anchors = await prisma.agentMemoryEvent.findMany({
    where: { userId: users[OWNER].userId },
    select: { action: true, auditLogId: true },
  });
  assert(
    anchors.length === BEFORE_TOTAL,
    "落库事件条数一致",
    `实际 ${anchors.length}`,
  );
  const auditIds = anchors.map((row) => row.auditLogId).filter((id) => id > 0);
  assert(
    auditIds.length === BEFORE_TOTAL,
    "每条事件都锚了一条审计留痕",
    `锚点 ${auditIds.length} 个`,
  );
  const audits = await prisma.auditLog.findMany({
    where: { id: { in: auditIds } },
    select: { action: true, detail: true },
  });
  assert(
    audits.length === BEFORE_TOTAL,
    "审计留痕逐条存在",
    `查到 ${audits.length} 条`,
  );
  assert(
    audits.every((row) => Object.keys(BEFORE_CLEANUP).includes(row.action)),
    "留痕动作名＝契约 operationId",
    audits.map((row) => row.action).join(",").slice(0, 120),
  );
  assert(
    audits.every((row) => /(GET|POST|PATCH|PUT|DELETE) \//.test(row.detail)),
    "留痕详情含方法 + 路径",
    String(audits[0]?.detail),
  );

  // ---------- 8. 读请求与记忆页自身不进记忆 ----------
  await call("GET", "/api/backend/enterprise/data-tables", OWNER);
  await call("GET", `/api/backend/enterprise/data-tables/${tableId}`, OWNER);
  await call(
    "GET",
    "/api/backend/enterprise/agent/events?page=1&pageSize=5",
    OWNER,
  );
  const afterReads = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OWNER,
  );
  assert(
    afterReads.data?.total === BEFORE_TOTAL,
    "读请求与记忆接口自身不产生事件",
    `total=${afterReads.data?.total}`,
  );

  // ---------- 9. 删表、吊销 Key 同样进记忆，然后一键清空我的记忆 ----------
  const removed = await call(
    "DELETE",
    `/api/backend/enterprise/data-tables/${tableId}`,
    OWNER,
  );
  assert(removed.code === 0, "删表成功", removed.message);
  tableId = 0;

  const revoked = await call(
    "POST",
    `/api/backend/enterprise/api-keys/${keyId}/revoke`,
    OWNER,
    {},
  );
  assert(revoked.code === 0, "吊销平台 Key 成功", revoked.message);
  keyId = 0;

  const finalList = await call(
    "GET",
    "/api/backend/enterprise/agent/events?page=1&pageSize=50",
    OWNER,
  );
  assert(
    sameTally(tally(finalList.data?.list || []), ALL_EVENTS),
    `收尾两个写动作也留痕（合计 ${ALL_TOTAL} 条）`,
    JSON.stringify(tally(finalList.data?.list || [])),
  );

  const cleared = await call(
    "POST",
    "/api/backend/enterprise/agent/memory/clear",
    OWNER,
    {},
  );
  assert(cleared.code === 0, "清空我的记忆可用", cleared.message);
  assert(
    cleared.data?.events === ALL_TOTAL,
    "清空条数＝本人事件条数（没牵连别人的数据）",
    JSON.stringify(cleared.data),
  );
  assert(
    cleared.data?.candidates === 0 &&
      cleared.data?.preferences === 0 &&
      cleared.data?.playbooks === 0 &&
      cleared.data?.grants === 0 &&
      cleared.data?.runs === 0,
    "阶段 1 其余五张表本就没有数据",
    JSON.stringify(cleared.data),
  );

  const afterClear = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OWNER,
  );
  assert(afterClear.data?.total === 0, "清空后归零", `total=${afterClear.data?.total}`);
  const otherAfter = await call(
    "GET",
    "/api/backend/enterprise/agent/overview",
    OTHER,
  );
  assert(
    otherAfter.data?.total === 0,
    "别的账号依旧为空",
    `total=${otherAfter.data?.total}`,
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${summary()}`);
    process.exit(suite.counts().failed ? 1 : 0);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    console.log(`\n${summary()}`);
    process.exit(1);
  });
