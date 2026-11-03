/**
 * 需求消息多会话实测（2026-09-25）
 *
 * 用户裁定：「一条需求可能有多个人回复的多轮对话，因此查看消息不可能只是面对一个用户的，
 * 应该是多个可以选择看和回复」。本脚本按这条口径验证七板块（物流/营销/IT服务/法律/知产/
 * 资产交易/灵活用工）的查看消息接口：
 *   A. 返回体是「回复方会话清单」（conversations + source），不再是单条扁平消息流；
 *   B. 一条需求下两位服务商各自回复 → 会话清单里是两条线程；
 *   C. 选定某条线程回复（conversation_id）后，消息只进这一条线程，其他线程不动。
 *
 * 覆盖范围＝有本地需求台账的七板块。财税 / 供销 / 出海（2026-09-26 起平台直连、零落库）不在此列，
 * 见下方「0. 覆盖边界」与 `verify-market-board-direct.mjs`。
 *
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）：
 *   node scripts/regression-instance.mjs -- node scripts/verify-demand-conversations.mjs
 */
import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, call, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

const MODULES = [
  {
    key: "物流",
    model: "logisticsOrder",
    list: "/enterprise/logistics",
    messages: (id) => `/enterprise/logistics/${id}/messages`,
  },
  {
    key: "营销",
    model: "marketingOrder",
    list: "/enterprise/marketing",
    messages: (id) => `/enterprise/marketing/${id}/messages`,
  },
  {
    key: "IT服务",
    model: "smartServiceOrder",
    list: "/enterprise/smart",
    messages: (id) => `/enterprise/smart/${id}/messages`,
  },
  {
    key: "法律",
    model: "legalRequest",
    list: "/enterprise/legal/requests",
    messages: (id) => `/enterprise/legal/requests/${id}/messages`,
  },
  {
    key: "知产",
    model: "ipRequest",
    list: "/enterprise/ip/requests",
    messages: (id) => `/enterprise/ip/requests/${id}/messages`,
  },
  {
    key: "资产交易",
    model: "assetRequest",
    list: "/enterprise/asset",
    messages: (id) => `/enterprise/asset/${id}/messages`,
  },
  {
    key: "灵活用工",
    model: "flexWorkOrder",
    list: "/enterprise/flex/work-orders",
    messages: (id) => `/enterprise/flex/work-orders/${id}/messages`,
  },
];

const ENTERPRISE = "demo_enterprise";
const THREAD_A = "实测回复方甲";
const THREAD_B = "实测回复方乙";

/** 会话清单结构断言：每条会话有 id / name / messages，且 LOCAL 时总数与台账一致。 */
function assertShape(key, payload, localCount) {
  const data = payload.data || {};
  const list = data.conversations;
  if (!Array.isArray(list)) {
    log(`${key}：返回 conversations 数组`, false, `实际 ${JSON.stringify(list)}`);
    return [];
  }
  log(
    `${key}：返回 conversations 数组`,
    true,
    `${list.length} 条 / source=${data.source}`,
  );
  log(
    `${key}：source 标明会话来源`,
    data.source === "AIWORKIN" || data.source === "LOCAL",
    String(data.source),
  );
  const bad = list.filter(
    (item) => !item.id || !item.name || !Array.isArray(item.messages),
  );
  log(`${key}：每条会话含 id/name/messages`, bad.length === 0);
  const total = list.reduce((sum, item) => sum + item.messages.length, 0);
  log(
    `${key}：会话消息不重不漏（合计 ${total} 条＝台账 ${localCount} 条）`,
    total === localCount,
  );
  return list;
}

async function main() {
  // —— 0. 覆盖边界：财税 / 供销 / 出海自 2026-09-26 起平台直连，本系统没有这两块的需求表 ——
  // 它们的「查看消息（n）」＝直接读平台会话（`/enterprise/market/<板块>/demands/:id/messages`），
  // 实测在 `verify-market-board-direct.mjs`（需 `--live-platform`）；这里钉住「本地没有这三条路由家族」，
  // 免得日后有人以为七板块的会话实现漏做了财税/供销/出海。
  for (const [label, path] of [
    ["财税", "/enterprise/tax/demands"],
    ["供销", "/enterprise/supply/demands"],
    ["出海", "/enterprise/overseas/demands"],
  ]) {
    const res = await call("GET", path, "admin");
    assert(
      res.status === 404 && res.code === 404 && String(res.message).startsWith("Cannot GET"),
      `${label}：本系统不设本地需求路由（会话只在平台上）`,
      `${res.code}「${res.message}」`,
    );
  }

  console.log(`\n== A. 七板块查看消息接口形态（admin 读取）@ ${BASE}`);
  for (const mod of MODULES) {
    const list = await call("GET", mod.list, "admin");
    let rows = Array.isArray(list.data) ? list.data : list.data?.list || [];
    if (!rows.length && mod.model === "smartServiceOrder") {
      const created = await call("POST", mod.list, ENTERPRISE, {
        title: "多会话实测需求（IT服务）",
        service_item: "SOFTWARE_DEV",
        description: "临时实例实测数据，可删除",
        budget: "10万元",
        province: "广东省",
        city: "深圳市",
      });
      if (created.code !== 0) {
        log("IT服务：无数据，先建一条需求", false, created.message);
        continue;
      }
      log("IT服务：无数据，先建一条需求", true);
      rows = [(await call("GET", mod.list, "admin")).data?.list?.[0] ||
        (await call("GET", mod.list, "admin")).data?.[0]];
    }
    const row = rows[0];
    if (!row) {
      log(`${mod.key}：取到一条需求`, false);
      continue;
    }
    const local = await prisma[mod.model].findUnique({
      where: { id: row.id },
      select: { messages: true },
    });
    const localCount = Array.isArray(local?.messages) ? local.messages.length : 0;
    const channel = await call("GET", mod.messages(row.id), "admin");
    assertShape(mod.key, channel, localCount);
  }

  console.log(`\n== B/C. 一条需求两位回复方 + 选定线程回复（法律）`);
  const target = await prisma.legalRequest.findFirst({
    where: { createdBy: users[ENTERPRISE].userId, status: { in: ["OPEN", "MATCHING"] } },
    orderBy: { id: "desc" },
    select: { id: true, requestNo: true, messages: true },
  });
  if (!target) {
    log("取一条本企业法律需求", false);
    return;
  }
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  await prisma.legalRequest.update({
    where: { id: target.id },
    data: {
      messages: [
        { role: "ENTERPRISE", name: ENTERPRISE, time, text: "【实测】我要咨询合同审查" },
        { role: "PROVIDER", name: THREAD_A, time, text: "甲所：可以，报价 2 万" },
        { role: "PROVIDER", name: THREAD_B, time, text: "乙所：我们更擅长，报价 1.6 万" },
      ],
    },
  });
  log(
    `准备数据：${target.requestNo} 记入两位服务商各自回复（写入本地台账）`,
    true,
  );

  const before = await call("GET", `/enterprise/legal/requests/${target.id}/messages`, ENTERPRISE);
  const beforeList = assertShape("法律（两位回复方）", before, 3) || [];
  const ids = beforeList.map((item) => item.id);
  assert(
    beforeList.length === 3 &&
      ids.includes("local-lead") &&
      ids.includes(`local-${THREAD_A}`) &&
      ids.includes(`local-${THREAD_B}`),
    "一条需求拆出 需求方 + 两位回复方 共三条会话",
    JSON.stringify(ids),
  );

  const reply = await call(
    "POST",
    `/enterprise/legal/requests/${target.id}/messages`,
    ENTERPRISE,
    { text: `【实测】只回给乙所：${time}`, conversation_id: `local-${THREAD_B}` },
  );
  assert(reply.code === 0, "选定乙所会话发起回复（接口不判定「能不能回」，只按所选会话落位）", reply.message);

  const after = await call("GET", `/enterprise/legal/requests/${target.id}/messages`, ENTERPRISE);
  const afterList = after.data?.conversations || [];
  const threadB = afterList.find((item) => item.id === `local-${THREAD_B}`);
  const threadA = afterList.find((item) => item.id === `local-${THREAD_A}`);
  const lead = afterList.find((item) => item.id === "local-lead");
  assert(
    threadB?.messages?.[threadB.messages.length - 1]?.text?.startsWith("【实测】只回给乙所"),
    "新消息落在乙所会话末尾",
    JSON.stringify(threadB?.messages?.map((m) => m.name)),
  );
  assert(threadA?.messages?.length === 1, "甲所会话不受影响", `${threadA?.messages?.length} 条`);
  assert(lead?.messages?.length === 1, "需求方会话不受影响", `${lead?.messages?.length} 条`);
  const stored = await prisma.legalRequest.findUnique({
    where: { id: target.id },
    select: { messages: true },
  });
  const last = stored.messages[stored.messages.length - 1];
  assert(
    last.reply_to === `local-${THREAD_B}`,
    "落库消息记录了所属会话标记 reply_to",
    String(last.reply_to),
  );

  console.log(`\n== D. 列表按钮「查看消息（n）」的家数（n＝回复方家数，不含需求方本人会话）`);
  const badgeCases = await prisma.marketingOrder.findMany({
    where: { createdBy: users[ENTERPRISE].userId },
    orderBy: { id: "desc" },
    take: 20,
    select: { id: true, orderNo: true, messages: true },
  });
  if (badgeCases.length < 2) {
    log("至少两条本企业营销需求可用于弹窗口径核对", false, `${badgeCases.length} 条`);
    return;
  }
  // 家数口径的两条用例自己造：取最新两条（实测残留行）覆写台账，
  // 不依赖库里恰好留着一条多人回复的需求——别套件的实跑会不断新增需求，靠窗口扫必然漂移。
  const multiCase = badgeCases[0];
  const zeroCase = badgeCases[1];
  const badgeTime = new Date().toLocaleString("zh-CN", { hour12: false });
  multiCase.messages = [
    { role: "ENTERPRISE", name: ENTERPRISE, time: badgeTime, text: "【实测】找一家做投放" },
    { role: "PROVIDER", name: THREAD_A, time: badgeTime, text: "甲：可做，报价 3 万" },
    { role: "PROVIDER", name: THREAD_B, time: badgeTime, text: "乙：我们更熟，报价 2.4 万" },
  ];
  zeroCase.messages = [];
  await prisma.marketingOrder.update({
    where: { id: multiCase.id },
    data: { messages: multiCase.messages },
  });
  await prisma.marketingOrder.update({
    where: { id: zeroCase.id },
    data: { messages: zeroCase.messages },
  });
  log(
    `准备数据：${multiCase.orderNo} 记两家回复、${zeroCase.orderNo} 记 0 家（写入本地台账）`,
    true,
  );
  const listRows = await call("GET", "/enterprise/marketing?pageSize=100", ENTERPRISE);
  const rows = listRows.data?.list || listRows.data || [];
  const expectOf = (messages) => {
    const set = new Set();
    for (const m of Array.isArray(messages) ? messages : []) {
      if (String(m?.role || "").toUpperCase() === "PROVIDER") set.add(String(m.name || "").trim());
      const t = String(m?.reply_to || "");
      if (t.startsWith("local-") && t !== "local-lead") set.add(t.slice("local-".length));
    }
    set.delete("");
    return set.size;
  };
  let checked = 0;
  for (const item of badgeCases) {
    const row = rows.find((r) => r.id === item.id);
    // badgeCases 全是该企业本人创建的（createdBy 过滤），列表里看不到就是可见性缺陷，不许静默跳过
    assert(!!row, `营销 ${item.orderNo} 出现在企业自己的需求列表`, `id=${item.id}`);
    if (!row) continue;
    checked++;
    const expected = expectOf(item.messages);
    log(
      `营销 ${item.orderNo}：conversationCount=${row.conversationCount}＝台账回复方家数 ${expected}`,
      row.conversationCount === expected,
    );
  }
  assert(checked >= 2, "至少核对两条营销需求", `${checked} 条`);
  // 弹窗「回复方会话（n）」与按钮同一口径：接口给的会话数减去需求方本人会话
  const multiRow = rows.find((r) => r.id === multiCase.id);
  assert(
    multiRow?.conversationCount === 2,
    `营销 ${multiCase.orderNo}：两家回复时按钮计数为 2`,
    `实际 ${multiRow?.conversationCount}`,
  );
  const zeroRow = rows.find((r) => r.id === zeroCase.id);
  assert(
    zeroRow?.conversationCount === 0,
    `营销 ${zeroCase.orderNo}：0 家回复的需求按钮计数为 0（不是 1）`,
    `实际 ${zeroRow?.conversationCount}`,
  );
  const badgeChannel = await call(
    "GET",
    `/enterprise/marketing/${multiCase.id}/messages`,
    ENTERPRISE,
  );
  const badgeList = badgeChannel.data?.conversations || [];
  const parties = badgeList.filter((item) => item.id !== "local-lead").length;
  log(
    `营销 ${multiCase.orderNo}：弹窗回复方会话数 ${parties}＝按钮 ${multiRow?.conversationCount}`,
    parties === multiRow?.conversationCount,
    `会话总条数 ${badgeList.length}`,
  );

  console.log(`\n结果：${suite.counts().passed} 项通过，${suite.counts().failed} 项失败`);
}

main()
  .catch((error) => {
    console.error("脚本异常：", error);
    suite.log("脚本异常（未跑完）", false, error?.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(suite.counts().failed ? 1 : 0);
  });
