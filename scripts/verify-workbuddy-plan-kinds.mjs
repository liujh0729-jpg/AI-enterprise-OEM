/**
 * Workbuddy 企业版「新建计划三分类」接口层实测（#476 schema / #477 后端 / #478 前端）。
 *
 * 用户口径：新建计划先选分类——① 与 AI 沟通分析并确定任务 ② 明确的生成任务
 * ③ 定时任务（②③ 都按 Workbuddy 的字段要求统一）；计划列表按任务类型、任务状态筛选。
 *
 * 覆盖：
 * 1) ai＝只收原始描述，建完是草稿、没有任务行（后面靠澄清把任务书聊出来）；
 * 2) direct＝任务书由表单直接填出，一次落库「计划 + 逐条任务」，建完就是待派发；
 *    任务行继承计划的 kind，多账号时按顺序轮流分配（不是同一步重复下发）；
 * 3) scheduled＝同 direct，再带一套排期字段（与 RPA 同一口径）：周期重复在建完就要
 *    有下一次执行时刻，once 不算定时、直接拒；缺星期/号数会算不出下一次，也直接拒；
 * 4) 三类共用的必填校验：ai 要原始描述，direct/scheduled 要任务目标与至少一条任务内容，
 *    没有派发目标要报错；空 instruction 的步骤不入库；
 * 5) 列表侧：服务端仍回全部计划与按状态计数，每行都带上 kind / scheduleType /
 *    scheduleConfig / scheduledAt（界面按任务类型筛选靠这几列）。
 *
 * 口径：
 * - 打在开发实例（默认 1690，见 [[project-local-runtime]]）。测试主体用 seed 账号 demo_user，
 *   本次创建的凭据与计划全部在收尾删除，账号回到初始状态。
 * - 全程只建计划、不派发：假凭据不打到腾讯云，定时计划的执行时刻一律落在未来，
 *   调度器不会在本轮 tick 里认领；真实派发链路待正式腾讯云凭据（#370）。
 * - 假凭据明文只在本进程内存里，不打印、不落盘。
 *
 * 用法：node scripts/verify-workbuddy-plan-kinds.mjs [BASE_URL]
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({ base: process.argv[2] || "http://127.0.0.1:1690" });
const { call, assert, base, users } = suite;

const stamp = Date.now().toString(36);
const FAKE_SECRET_ID = `AKIDwbverify${stamp}`;
const FAKE_SECRET_KEY = `wbkey-${stamp}-SECRET`;
const AGENT_A = `agent-verify-${stamp}-a`;
const AGENT_B = `agent-verify-${stamp}-b`;

console.log(`目标实例：${base}`);

const ACCOUNT = "demo_user";
const me = await call("GET", "/enterprise/me", ACCOUNT);
if (me.code !== 0) {
  console.log(`FAIL 测试主体不可用（${me.message}），中止且不写入`);
  process.exit(1);
}

/** 本轮创建的凭据与计划，收尾逐个删除。 */
const planIds = [];
const accountIds = [];

async function createAccount(name) {
  const res = await call("POST", "/enterprise/workbuddy/accounts", ACCOUNT, {
    name,
    secretId: FAKE_SECRET_ID,
    secretKey: FAKE_SECRET_KEY,
    region: "ap-shanghai",
    notes: "Workbuddy 三分类实测用假凭据",
  });
  return res;
}

const accountA = await createAccount(`三分类实测A-${stamp}`);
assert(accountA.code === 0 && accountA.data?.id, "绑定第一把假凭据", accountA.message);
const accountB = await createAccount(`三分类实测B-${stamp}`);
assert(accountB.code === 0 && accountB.data?.id, "绑定第二把假凭据", accountB.message);
const accountIdA = accountA.data?.id;
const accountIdB = accountB.data?.id;
if (accountIdA) accountIds.push(accountIdA);
if (accountIdB) accountIds.push(accountIdB);
const targetA = { accountId: accountIdA, agentId: AGENT_A };
const targetB = { accountId: accountIdB, agentId: AGENT_B };

/** 计划详情（含任务行）。 */
async function detail(id) {
  const res = await call("GET", `/enterprise/workbuddy/plans/${id}`, ACCOUNT);
  return res.code === 0 ? res.data : null;
}

// ---------- 1) 与 AI 沟通分析并确定任务 ----------
const aiPlan = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "ai",
  rawInput: `帮我调研 ${stamp} 家竞品并整理成表格`,
});
assert(aiPlan.code === 0 && aiPlan.data?.id, "AI 分类建计划成功", aiPlan.message);
const aiId = aiPlan.data?.id;
if (aiId) planIds.push(aiId);
assert(aiPlan.data?.kind === "ai", "AI 分类落库 kind=ai", aiPlan.data?.kind);
assert(aiPlan.data?.status === "draft", "AI 分类建完是草稿", aiPlan.data?.status);
assert(aiPlan.data?.stepCount === 0, "AI 分类没有任务书步骤");
assert(aiPlan.data?.ready === false, "AI 分类任务书未成形（ready=false）");
assert(aiPlan.data?.taskCount === 0, "AI 分类没有派发任务行");
assert(
  typeof aiPlan.data?.rawInput === "string" && aiPlan.data.rawInput.includes(stamp),
  "AI 分类保存了原始描述",
);

const aiEmpty = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "ai",
  rawInput: "   ",
});
assert(
  aiEmpty.code === 400 && aiEmpty.message === "请先用一句话说清你想让 Agent 做什么",
  "AI 分类缺原始描述直接拒",
  `${aiEmpty.code} / ${aiEmpty.message}`,
);

// ---------- 2) 明确的生成任务（不走 AI，按 Workbuddy 字段填） ----------
const DIRECT_STEPS = [
  { title: "抓取列表", instruction: `打开竞品页抓取 ${stamp} 个品牌名` },
  { title: "补齐字段", instruction: "逐个补价格、销量、评价数" },
  { instruction: "（这条没填标题，要自动按「第 N 步」命名）" },
];
const directPlan = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  title: `三分类实测-明确任务-${stamp}`,
  goal: `产出 ${stamp} 家竞品的对比表`,
  deliverable: "一张 CSV",
  acceptance: "全覆盖，缺一个不算完成",
  steps: DIRECT_STEPS,
  targets: [targetA],
});
assert(directPlan.code === 0 && directPlan.data?.id, "明确分类建计划成功", directPlan.message);
const directId = directPlan.data?.id;
if (directId) planIds.push(directId);
assert(directPlan.data?.kind === "direct", "明确分类落库 kind=direct", directPlan.data?.kind);
assert(directPlan.data?.status === "ready", "明确分类建完就是待派发", directPlan.data?.status);
assert(directPlan.data?.stepCount === 3, "任务书 3 步全部落库");
assert(directPlan.data?.taskCount === 3, "一次落库 3 条任务行");
assert(directPlan.data?.ready === true, "明确分类任务书已成形（ready=true）");
assert(
  directPlan.data?.spec?.acceptance === "全覆盖，缺一个不算完成",
  "验收标准按 Workbuddy 字段原样存住",
);
assert(directPlan.data?.scheduleType === "once", "明确分类不排期", directPlan.data?.scheduleType);
assert(directPlan.data?.scheduledAt == null, "明确分类没有执行时刻");
assert(directPlan.data?.strategy === "single", "单账号派发 strategy=single");

const directDetail = await detail(directId);
const directTasks = directDetail?.tasks || [];
assert(directTasks.length === 3, "详情里 3 条任务行可读", `${directTasks.length} 条`);
assert(
  directTasks.every((task) => task.kind === "direct"),
  "任务行继承计划分类 kind=direct",
);
assert(
  directTasks.map((task) => task.seq).join(",") === "1,2,3",
  "任务行按序号排列",
  directTasks.map((task) => task.seq).join(","),
);
assert(
  directTasks.every((task) => task.accountId === accountIdA && task.status === "pending"),
  "任务行落在所选账号且待派发",
);
assert(
  directDetail?.plan?.spec?.steps?.[2]?.title === "第 3 步",
  "没填标题的步骤自动按「第 3 步」命名",
  directDetail?.plan?.spec?.steps?.[2]?.title,
);
assert(
  directTasks[2]?.instruction === DIRECT_STEPS[2].instruction,
  "步骤内容原样落到任务行",
  directTasks[2]?.instruction,
);

// 多账号：步骤轮流分配，不是同一步重复下发
const fanPlan = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  title: `三分类实测-双账号-${stamp}`,
  goal: `双账号轮流分配 ${stamp}`,
  steps: [
    { title: "第 1 条", instruction: `做第 1 件事 ${stamp}` },
    { title: "第 2 条", instruction: `做第 2 件事 ${stamp}` },
    { title: "第 3 条", instruction: `做第 3 件事 ${stamp}` },
  ],
  targets: [targetA, targetB],
});
assert(fanPlan.code === 0 && fanPlan.data?.id, "双账号明确任务建计划成功", fanPlan.message);
const fanId = fanPlan.data?.id;
if (fanId) planIds.push(fanId);
assert(fanPlan.data?.strategy === "fan_out", "多账号派发 strategy=fan_out");
assert(
  fanPlan.data?.taskCount === 3 && fanPlan.data?.stepCount === 3,
  "3 步仍然只建 3 条任务（轮流分配不是重复下发）",
);
const fanDetail = await detail(fanId);
const fanTasks = fanDetail?.tasks || [];
assert(
  fanTasks.map((task) => task.accountId).join(",") ===
    [accountIdA, accountIdB, accountIdA].join(","),
  "任务行按账号轮流落位",
  fanTasks.map((task) => task.accountId).join(","),
);

// 校验：空步骤 / 缺目标 / 步骤没有内容
const noSteps = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  goal: `没有步骤 ${stamp}`,
  steps: [],
  targets: [targetA],
});
assert(
  noSteps.code === 400 && noSteps.message === "请至少填写一条任务内容",
  "明确分类零步骤直接拒",
  `${noSteps.code} / ${noSteps.message}`,
);
const blankSteps = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  goal: `只有空内容 ${stamp}`,
  steps: [{ title: "看起来有标题", instruction: "  " }],
  targets: [targetA],
});
assert(
  blankSteps.code === 400 && blankSteps.message === "请至少填写一条任务内容",
  "步骤内容全空时不算有效任务",
  `${blankSteps.code} / ${blankSteps.message}`,
);
const noTarget = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  goal: `没有派发目标 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [],
});
assert(
  noTarget.code === 400 &&
    noTarget.message === "请选择用来执行任务的 Workbuddy Enterprise 账号与 Agent",
  "明确分类缺派发目标直接拒",
  `${noTarget.code} / ${noTarget.message}`,
);
const noAgent = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "direct",
  goal: `选了账号没选 Agent ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [{ accountId: accountIdA, agentId: "" }],
});
assert(
  noAgent.code === 400 && noAgent.message === "请选择 Agent",
  "缺 Agent 直接拒（不是静默当单账号）",
  `${noAgent.code} / ${noAgent.message}`,
);

// ---------- 3) 定时任务（排期字段与 RPA 同一套） ----------
const recurringPlan = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  title: `三分类实测-周期-${stamp}`,
  goal: `每天早晨跑一次竞品抓取 ${stamp}`,
  steps: [{ title: "抓取", instruction: `抓取竞品列表 ${stamp}` }],
  targets: [targetA],
  scheduleType: "recurring",
  scheduleConfig: { freq: "daily", time: "09:30" },
});
assert(recurringPlan.code === 0 && recurringPlan.data?.id, "定时分类建周期计划成功", recurringPlan.message);
const recurringId = recurringPlan.data?.id;
if (recurringId) planIds.push(recurringId);
assert(recurringPlan.data?.kind === "scheduled", "定时分类落库 kind=scheduled", recurringPlan.data?.kind);
assert(recurringPlan.data?.status === "ready", "定时计划建完待调度", recurringPlan.data?.status);
assert(
  recurringPlan.data?.scheduleType === "recurring",
  "周期重复原样落库",
  recurringPlan.data?.scheduleType,
);
assert(recurringPlan.data?.scheduleConfig?.time === "09:30", "执行时刻原样落库");
const nextRun = recurringPlan.data?.scheduledAt ? new Date(recurringPlan.data.scheduledAt).getTime() : 0;
assert(nextRun > Date.now(), "周期计划建完就有未来的下一次执行时刻", recurringPlan.data?.scheduledAt);
const recurringTasks = (await detail(recurringId))?.tasks || [];
assert(
  recurringTasks.length === 1 && recurringTasks[0]?.kind === "scheduled",
  "定时计划的任务行继承 kind=scheduled",
  recurringTasks.map((task) => task.kind).join(","),
);

const oncePlan = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  title: `三分类实测-定时一次-${stamp}`,
  goal: `明天这个点跑一次 ${stamp}`,
  steps: [{ instruction: `跑一次 ${stamp}` }],
  targets: [targetB],
  scheduleType: "scheduled",
  scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
});
assert(oncePlan.code === 0 && oncePlan.data?.id, "定时分类建一次性定时计划成功", oncePlan.message);
const onceId = oncePlan.data?.id;
if (onceId) planIds.push(onceId);
assert(oncePlan.data?.scheduleType === "scheduled", "定时一次原样落库", oncePlan.data?.scheduleType);
assert(
  new Date(oncePlan.data?.scheduledAt || 0).getTime() > Date.now(),
  "一次性定时计划记下了用户选的时刻",
  oncePlan.data?.scheduledAt,
);

// 排期校验：once 不算定时 / 缺时间 / 缺频率 / 缺星期 / 缺号数 / 频率非法
const schedOnce = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `选了不排期 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "once",
});
assert(
  schedOnce.code === 400 &&
    schedOnce.message === "定时任务要选择执行时间或重复频率",
  "定时分类拒绝「不排期」",
  `${schedOnce.code} / ${schedOnce.message}`,
);
const schedNoTime = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `定时一次没选时间 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "scheduled",
  scheduledAt: "",
});
assert(
  schedNoTime.code === 400 && schedNoTime.message === "定时任务要选择执行时间",
  "定时一次缺执行时间直接拒",
  `${schedNoTime.code} / ${schedNoTime.message}`,
);
const schedNoFreq = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `周期重复没选频率 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "recurring",
  scheduleConfig: {},
});
assert(
  schedNoFreq.code === 400 && schedNoFreq.message === "周期重复要选择重复频率",
  "周期重复缺频率直接拒",
  `${schedNoFreq.code} / ${schedNoFreq.message}`,
);
const schedNoWeekday = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `每周重复没选星期 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "recurring",
  scheduleConfig: { freq: "weekly", time: "09:00" },
});
assert(
  schedNoWeekday.code === 400 && schedNoWeekday.message === "每周重复要选星期",
  "每周缺星期直接拒（否则永远算不出下一次）",
  `${schedNoWeekday.code} / ${schedNoWeekday.message}`,
);
const schedNoDay = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `每月重复没填号数 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "recurring",
  scheduleConfig: { freq: "monthly", time: "09:00" },
});
assert(
  schedNoDay.code === 400 && schedNoDay.message === "每月重复要填几号（1-31）",
  "每月缺号数直接拒",
  `${schedNoDay.code} / ${schedNoDay.message}`,
);
const schedBadFreq = await call("POST", "/enterprise/workbuddy/plans", ACCOUNT, {
  kind: "scheduled",
  goal: `频率非法 ${stamp}`,
  steps: [{ instruction: `做一件事 ${stamp}` }],
  targets: [targetA],
  scheduleType: "recurring",
  scheduleConfig: { freq: "minutely" },
});
assert(
  schedBadFreq.code === 400 &&
    schedBadFreq.message === "重复频率只能是 hourly / daily / weekly / monthly",
  "非法频率直接拒",
  `${schedBadFreq.code} / ${schedBadFreq.message}`,
);

// ---------- 4) 列表：界面按任务类型 / 任务状态筛选所依赖的列 ----------
const list = await call("GET", "/enterprise/workbuddy/plans", ACCOUNT);
assert(list.code === 0 && Array.isArray(list.data?.items), "计划列表可读", list.message);
const items = list.data?.items || [];
const mine = items.filter((row) => planIds.includes(row.id));
assert(mine.length === planIds.length, "本轮三类计划都在列表里", `${mine.length}/${planIds.length}`);
assert(
  ["ai", "direct", "scheduled"].every((kind) => mine.some((row) => row.kind === kind)),
  "三种任务类型各自都能按 kind 读到（界面类型筛选的依据）",
);
assert(
  mine.every(
    (row) =>
      typeof row.kind === "string" &&
      typeof row.status === "string" &&
      typeof row.scheduleType === "string" &&
      row.scheduleConfig !== undefined &&
      "scheduledAt" in row,
  ),
  "每行都带类型、状态与排期三列",
);
assert(
  mine.filter((row) => row.status === "draft").length === 1 &&
    mine.filter((row) => row.status === "ready").length === planIds.length - 1,
  "状态分布＝1 草稿 + 其余待派发",
  mine.map((row) => row.status).join(","),
);
const ownerUserId = users[ACCOUNT].userId;
assert(
  items.length > 0 && items.every((row) => row.createdBy === ownerUserId),
  "列表只回本人的计划（不串号）",
);

const readyOnly = await call("GET", "/enterprise/workbuddy/plans?status=ready", ACCOUNT);
assert(
  readyOnly.code === 0 &&
    Array.isArray(readyOnly.data?.items) &&
    readyOnly.data.items.length > 0 &&
    readyOnly.data.items.every((row) => row.status === "ready"),
  "服务端按状态筛选可用",
  `${readyOnly.data?.items?.length} 条`,
);
assert(
  readyOnly.code === 0 && !readyOnly.data?.items?.some((row) => row.id === aiId),
  "AI 分类草稿不会混进待派发筛选",
);
assert(
  readyOnly.data?.counts && typeof readyOnly.data.counts === "object",
  "列表带按状态计数（界面状态筛选的计数依据）",
  JSON.stringify(readyOnly.data?.counts || {}),
);

// ---------- 收尾：删除本轮创建的计划与假凭据 ----------
for (const id of planIds) {
  const removed = await call("DELETE", `/enterprise/workbuddy/plans/${id}`, ACCOUNT);
  assert(removed.code === 0, `删除测试计划 #${id}`, removed.message);
}
for (const id of accountIds) {
  const removed = await call("DELETE", `/enterprise/workbuddy/accounts/${id}`, ACCOUNT);
  assert(removed.code === 0, `删除假凭据 #${id}`, removed.message);
}
const afterList = await call("GET", "/enterprise/workbuddy/plans", ACCOUNT);
const left = (afterList.data?.items || []).filter((row) => planIds.includes(row.id));
assert(left.length === 0, "本轮计划已全部清除", `${left.length} 条残留`);
const afterAccounts = await call("GET", "/enterprise/workbuddy/accounts", ACCOUNT);
const leftAccounts = (afterAccounts.data || []).filter((row) => accountIds.includes(row.id));
assert(leftAccounts.length === 0, "本轮假凭据已全部清除", `${leftAccounts.length} 条残留`);

console.log(`\n${suite.summary()}`);
const failures = suite.counts().failures;
if (failures.length) {
  console.log("失败明细：");
  for (const line of failures) console.log(` - ${line}`);
  process.exitCode = 1;
}
