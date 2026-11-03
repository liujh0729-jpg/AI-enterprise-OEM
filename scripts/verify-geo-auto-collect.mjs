// GEO 自动采集管线接口冒烟：用户端「开启/关闭自动采集」+ 平台管理「每周采集任务量」。
// 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693），需要跑着新 dist 的后端。
// 用法：node scripts/regression-instance.mjs -- node scripts/verify-geo-auto-collect.mjs [projectId]
import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const PROJECT_ID = Number(process.argv[2] || 5);
const prisma = createPrisma();

const ok = (payload) => payload?.data?.code === 0;
const AUTO = `/enterprise/geo/projects/${PROJECT_ID}/auto-collect`;
const OWNER = "demo_enterprise";

/**
 * 本期（周日起算）还剩不剩采集窗口——与后端 nextWindowOf 同一算法：逐日看 02:00–06:00 是否未结束。
 * 周六 06:00 之后到周日 00:00 之间本周已无窗口，此时开启开关**不会**排本期任务（要等下期周日），
 * 所以这一段必须按另一套唯一期望值断言，而不是把断言写成「有任务或没任务都行」。
 */
const hasWindowRemaining = (() => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  for (let offset = 0; offset < 7; offset += 1) {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + offset);
    end.setHours(6, 0, 0, 0);
    if (end.getTime() > now.getTime()) return true;
  }
  return false;
})();

const project = await prisma.geoProject.findUnique({
  where: { id: PROJECT_ID },
});
if (!project) {
  console.error(`项目 ${PROJECT_ID} 不存在`);
  process.exit(1);
}
const questionCount = await prisma.geoQuestion.count({
  where: { projectId: PROJECT_ID, status: "ACTIVE" },
});
console.log(
  `项目 #${PROJECT_ID} ${project.brand}：启用问题 ${questionCount} 个，配置平台 ${JSON.stringify(project.platforms)}`,
);

/* ---------- 0. 复位：把本项目恢复到「开关关闭 + 本期无任务行」 ----------
 * 上一轮可能崩在任意一步：开关留在开着、本期任务留在 PENDING。只删 CANCELLED
 * 清不掉那种现场，第 1 步的初始态断言就会假红（currentRun 只要本期有行就非空，
 * 跟窗口在不在无关——windowStart 是执行时才回填的）。所以先翻开关取消未跑完的
 * 本期任务，再删这些刚被取消的行；不动 DONE/在跑以外由调度器正常留下的历史期。 */
const staleBeforeReset = await api("PUT", AUTO, { enabled: false }, OWNER);
assert(
  ok(staleBeforeReset),
  "复位：关闭开关（取消上一轮遗留的本期任务）",
  JSON.stringify(staleBeforeReset.data?.message),
);
const staleRunIds = (
  await prisma.geoCollectRun.findMany({
    where: { projectId: PROJECT_ID, status: "CANCELLED" },
    select: { id: true },
  })
).map((r) => r.id);
if (staleRunIds.length) {
  const items = await prisma.geoCollectItem.deleteMany({
    where: { runId: { in: staleRunIds } },
  });
  const runs = await prisma.geoCollectRun.deleteMany({
    where: { id: { in: staleRunIds } },
  });
  console.log(
    `复位：清理上一轮证据任务 ${runs.count} 条（明细 ${items.count} 条）`,
  );
}

/* ---------- 1. 鉴权与开关读取 ---------- */
const anon = await api("GET", AUTO);
assert(anon.status === 401, "未登录读状态 → 401", `实际 ${anon.status}`);

const before = await api("GET", AUTO, null, OWNER);
assert(ok(before), "用户端 GET auto-collect → code 0", JSON.stringify(before.data?.message));
const s0 = before.data?.data || {};
assert(s0.enabled === false, "初始为未开启", `enabled=${s0.enabled}`);
assert(
  s0.questionCount === questionCount,
  `状态里的启用问题数＝库里的 ${questionCount}`,
  `questionCount=${s0.questionCount}`,
);
assert(
  s0.plannedPerRun === s0.questionCount * s0.usablePlatforms.length,
  "每期计划＝启用问题 × 可用平台",
  `${s0.questionCount}×${s0.usablePlatforms.length}=${s0.plannedPerRun}`,
);
assert(s0.usablePlatforms.length >= 1, "至少一个平台可用（已配 Key + 模型）", s0.usablePlatforms.join(","));
assert(
  s0.usablePlatforms.every((item) => project.platforms.includes(item)),
  "可用平台取自项目配置",
  s0.usablePlatforms.join(","),
);
assert(
  s0.usablePlatforms.length + s0.skippedPlatforms.length ===
    project.platforms.length,
  "可用 + 跳过＝配置平台数（跳过的带原因）",
  `跳过：${s0.skippedPlatforms.join("、") || "无"}`,
);
assert(/^2026-W\d\d$/.test(String(s0.weekLabel)), "本期期次标签", s0.weekLabel);
const windowStart = s0.windowStart ? new Date(s0.windowStart) : null;
if (hasWindowRemaining) {
  assert(Boolean(windowStart), "状态里给出本期剩余可用窗口", s0.windowStart);
  assert(
    windowStart && windowStart.getHours() === 2 && windowStart.getMinutes() === 0,
    "窗口从 02:00 起",
    windowStart ? `${windowStart.getDay()} 日 ${windowStart.getHours()}:00` : "null",
  );
  assert(
    windowStart &&
      new Date(s0.windowEnd).getTime() - windowStart.getTime() === 4 * 3600 * 1000,
    "窗口时长 4 小时（02:00–06:00）",
  );
  // 窗口按「还没结束」给出：凌晨在窗口内时 windowStart 就是今天（已在过去）
  assert(
    new Date(s0.windowEnd).getTime() > Date.now(),
    "给出的窗口尚未结束",
    s0.windowEnd,
  );
} else {
  assert(
    windowStart === null,
    "本周窗口已全部过去 → 状态不再给窗口",
    `windowStart=${s0.windowStart}`,
  );
}
assert(s0.inWindow === false, "当前时刻不在窗口内（不会真外呼）", `inWindow=${s0.inWindow}`);
assert(s0.currentRun === null, "开启前本期尚无任务", JSON.stringify(s0.currentRun));

const other = await api("GET", AUTO, null, "demo_provider");
assert(!ok(other), "非本人读该项目状态 → 拒绝", `code=${other.data?.code}`);

/* ---------- 2. 开启：排期 + 明细 ---------- */
const on = await api("PUT", AUTO, { enabled: true }, OWNER);
assert(ok(on), "PUT enabled=true → code 0", JSON.stringify(on.data?.message));
assert(on.data?.data?.enabled === true, "返回开关已开启");
const s1 = (await api("GET", AUTO, null, OWNER)).data?.data;
assert(s1.enabled === true, "再读：已开启");
assert(s1.updatedBy === OWNER, "记录开关操作人", s1.updatedBy);
assert(Boolean(s1.updatedAt), "记录开关时间", s1.updatedAt);
if (hasWindowRemaining) {
  assert(s1.currentRun && s1.currentRun.status === "PENDING", "本期已排期且待采集", s1.currentRun?.status);
  assert(
    s1.currentRun.planned === s1.plannedPerRun,
    "任务计划量＝问题 × 可用平台",
    `planned=${s1.currentRun.planned}`,
  );
  assert(s1.currentRun.done === 0 && s1.currentRun.failed === 0, "尚未执行：完成 0 / 失败 0");
  assert(s1.currentRun.pending === s1.currentRun.planned, "待采集＝计划量", `pending=${s1.currentRun.pending}`);
  assert(s1.currentRun.batchId === 0, "未产生批次（窗口内首条成功才建）");

  const items = await prisma.geoCollectItem.findMany({
    where: { runId: s1.currentRun.id },
  });
  assert(
    items.length === s1.currentRun.planned,
    "明细条数＝计划量（逐「问题 × 平台」）",
    `${items.length} 条`,
  );
  assert(
    items.every((item) => item.status === "PENDING" && item.attempts === 0),
    "窗口外未发生任何外呼（明细全 PENDING、attempts 0）",
  );
  assert(
    new Set(items.map((item) => `${item.questionId}|${item.platform}`)).size ===
      items.length,
    "明细无重复「问题 × 平台」",
  );
} else {
  assert(
    s1.currentRun === null,
    "本周无剩余窗口：开启只翻开关，不排本期任务",
    JSON.stringify(s1.currentRun),
  );
}

/* ---------- 3. 平台管理：本周任务量 ---------- */
const stats = await api("GET", "/enterprise/admin/geo-collection/stats", null, "admin");
assert(ok(stats), "管理员 GET geo-collection/stats → code 0", JSON.stringify(stats.data?.message));
const st = stats.data?.data || {};
assert(st.weekLabel === s1.weekLabel, "管理端与用户端同属本期", `${st.weekLabel} / ${s1.weekLabel}`);
const row = st.runs.find((item) => item.projectId === PROJECT_ID);
if (hasWindowRemaining) {
  assert(st.totals.planned >= s1.currentRun.planned, "本周计划量含本项目", `planned=${st.totals.planned}`);
  assert(Boolean(row), "明细含本项目行");
  assert(row?.brand === project.brand, "明细带品牌名", row?.brand);
  assert(row?.enabled === true, "明细带开关态", String(row?.enabled));
  assert(row?.status === "PENDING", "明细带任务状态", row?.status);
} else {
  assert(
    row === undefined,
    "本周无窗口：管理端本周明细里没有本项目",
    JSON.stringify(row || null),
  );
}
assert(
  st.totals.pending === st.totals.planned - st.totals.done - st.totals.failed,
  "待采集＝计划 − 完成 − 失败",
  `${st.totals.planned}-${st.totals.done}-${st.totals.failed}=${st.totals.pending}`,
);
assert(
  st.totals.projects === st.runs.length,
  "本周项目数＝明细行数",
  `${st.totals.projects} / ${st.runs.length}`,
);
const deniedStats = await api("GET", "/enterprise/admin/geo-collection/stats", null, OWNER);
assert(!ok(deniedStats), "非管理员读管理端任务量 → 拒绝", `code=${deniedStats.data?.code}`);

/* ---------- 4. 关闭：本期任务取消 ---------- */
const off = await api("PUT", AUTO, { enabled: false }, OWNER);
assert(ok(off), "PUT enabled=false → code 0");
const s2 = (await api("GET", AUTO, null, OWNER)).data?.data;
assert(s2.enabled === false, "再读：已关闭");
if (hasWindowRemaining) {
  assert(s2.currentRun?.status === "CANCELLED", "本期任务置为已取消", s2.currentRun?.status);
  const cancelledItems = await prisma.geoCollectItem.count({
    where: { runId: s1.currentRun.id, status: "PENDING" },
  });
  assert(cancelledItems === s1.currentRun.planned, "取消不动明细（下期重排）", `${cancelledItems} 条`);

  /* ---------- 5. 重新开启：本期继续（唯一键不挡重开） ---------- */
  await api("PUT", AUTO, { enabled: true }, OWNER);
  const s3 = (await api("GET", AUTO, null, OWNER)).data?.data;
  assert(s3.currentRun?.id === s1.currentRun.id, "重开沿用本期任务，不重复排期", `run ${s3.currentRun?.id}`);
  assert(s3.currentRun?.status === "PENDING", "重开后回到待采集", s3.currentRun?.status);
  assert(/重新开启/.test(String(s3.currentRun?.lastError)), "重开写明原因", s3.currentRun?.lastError);
} else {
  assert(s2.currentRun === null, "无任务可取消：currentRun 仍为空", JSON.stringify(s2.currentRun));
}

/* ---------- 6. 复位：关闭开关，留一条已取消的本期任务作证据 ---------- */
await api("PUT", AUTO, { enabled: false }, OWNER);
const s4 = (await api("GET", AUTO, null, OWNER)).data?.data;
assert(s4.enabled === false, "脚本结束：自动采集已关闭");
if (hasWindowRemaining) {
  assert(s4.currentRun?.status === "CANCELLED", "脚本结束：本期任务已取消", s4.currentRun?.status);
} else {
  assert(s4.currentRun === null, "脚本结束：本期没有任务行", JSON.stringify(s4.currentRun));
}
const stillRunning = await prisma.geoCollectRun.count({
  where: { status: { in: ["PENDING", "RUNNING"] } },
});
assert(stillRunning === 0, "库中无遗留待跑/在跑任务", `实际 ${stillRunning}`);
const enabledProjects = await prisma.geoProject.count({ where: { autoCollect: 1 } });
assert(enabledProjects === 0, "库中无遗留开启的自动采集项目", `实际 ${enabledProjects}`);

await prisma.$disconnect();
const { passed, failed } = suite.counts();
console.log(`\n通过 ${passed} / 失败 ${failed}`);
process.exit(failed ? 1 : 0);
