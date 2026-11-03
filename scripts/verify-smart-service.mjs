/**
 * IT服务板块（参考物流板块 1:1 新增，五个细项 AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务）
 * 后端口径验证：
 * 备案必填细项 → 平台逐项审核 → 名录按细项分区 → 按细项独立签约（**不限家数**，与物流同口径）
 * → 需求按细项直派 → 回复即接单 → 推进与反馈 → 职员按细项挂靠 → 管理后台计数。
 * 末段用 **AIworkin 正式平台** 真实账号验证「服务发布」写入（SYNCED + 平台读回 + 自清）。
 *
 * 断言全部给唯一期望值（见 [[feedback-test-honesty]]）：本地演示账号（u-*，非 UUID）在正式平台
 * 的留痕只可能是 FAILED，平台真实账号（UUID）只可能是 SYNCED，二者都不接受 SKIPPED。
 * 默认打 1690；BASE_URL / PLATFORM_USER_ID 可覆盖。跑完自清，不留测试数据。
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptJwtSecret } from "./jwt-secret.mjs";
import { assertChannelOn } from "./regression-guard.mjs";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = require("jsonwebtoken");
const { PrismaClient } = require(join(
  dirname(fileURLToPath(import.meta.url)),
  "../backend/generated/prisma",
));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const users = JSON.parse(
  readFileSync(join(root, "backend/prisma/seed-users.json"), "utf8"),
);
const BASE = process.env.BASE_URL || "http://127.0.0.1:1690";
const PLATFORM = (process.env.PLATFORM_URL || "https://api.aiworkin.com").replace(/\/$/, "");
const SECRET = scriptJwtSecret();
const ISSUER = process.env.JWT_ISSUER || "aipdd-java-core";
// 通道隔离护栏：本套件末段要真实写入 AIworkin 正式平台，必须打在通道打开的实例上
await assertChannelOn(BASE);
/** 正式平台真实账号（已核验主体、可发布 SUPPLY）。 */
const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID || "00000000-0000-0000-0000-000000000001";
const PLATFORM_USERNAME = process.env.PLATFORM_USERNAME || "admin";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prisma = new PrismaClient();

const ITEMS = ["AI_DEPLOY", "SOFTWARE_DEV", "COMPUTE", "HARDWARE", "DATA_SERVICE"];
/** 逐项审核结论：算力服务不通过，其余四项通过。 */
const APPROVED = ["AI_DEPLOY", "SOFTWARE_DEV", "HARDWARE", "DATA_SERVICE"];
const REJECTED = ["COMPUTE"];
/** 第二家IT服务商（验证「同一细项不限家数」）。 */
const ORG_A = "E2EIT服务测试机构";
const ORG_B = "E2EIT服务测试机构乙";

let passed = 0;
let failed = 0;
const log = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  ok ? passed++ : failed++;
};
const assert = (cond, name, extra) => log(name, !!cond, extra || "");

function token(username) {
  const row = users[username];
  return jwt.sign(
    { userId: row.userId, username, role: row.role, type: "access" },
    SECRET,
    { algorithm: "HS256", issuer: ISSUER },
  );
}
const platformToken = jwt.sign(
  { userId: PLATFORM_USER_ID, username: PLATFORM_USERNAME, role: "super", type: "access" },
  SECRET,
  { algorithm: "HS256", issuer: ISSUER, expiresIn: "15m" },
);

async function call(url, method, body, bearer) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    // GET 调用点会传 null 占位，不能序列化成 "null" 报文（fetch 会拒收）
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 原文留给断言 */
  }
  return { status: res.status, json, text, data: json?.data };
}
const api = (method, path, body, username) =>
  call(BASE + path, method, body, username ? token(username) : undefined);
const raw = (method, path, body, bearer) => call(BASE + path, method, body, bearer);
const remote = (method, path, body, bearer) => call(PLATFORM + path, method, body, bearer);

/** 备案提交公共字段（省、市必填，见需求文档 1.4 条目 69）。 */
function applyBody(orgName, uscc, extra) {
  return {
    org_name: orgName,
    uscc,
    contact_name: "测试联系人",
    contact_phone: "13800008888",
    contact_email: "smart@demo.local",
    intro: "IT服务细项验证",
    province: "浙江省",
    city: "杭州市",
    ...extra,
  };
}

(async () => {
  // ── 前置：清掉可能残留的测试备案行与测试签约，保证每条断言只有一个期望值
  // 第二家测试机构用 demo_supply：demo_all / demo_dual 的IT服务备案是演示种子数据，不能被本脚本回收
  for (const account of ["demo_user", "demo_supply"]) {
    const me = await api("GET", "/enterprise/identity/provider-application", null, account);
    for (const item of me.data?.items || []) {
      if (item.providerType !== "SMART_SERVICE") continue;
      await api("DELETE", `/enterprise/identity/provider-application/${item.id}`, null, account);
    }
  }
  const before = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  for (const item of before.data || []) {
    if (!ITEMS.includes(item.serviceType)) continue;
    if (!["PENDING", "ACTIVE"].includes(item.status)) continue;
    await api("POST", `/enterprise/contracts/${item.id}/terminate`, null, "demo_enterprise");
  }
  // 上一轮若在写入正式平台前异常中断，测试需求会留在库里：按本脚本自建的标题前缀回收
  const staleDemands = await prisma.smartServiceOrder.deleteMany({
    where: { title: { startsWith: "E2E IT服务" } },
  });
  if (staleDemands.count) console.log(`前置：回收上一轮遗留测试需求 ${staleDemands.count} 条`);
  const cleanApps = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  assert(
    !(cleanApps.data?.items || []).some((i) => i.providerType === "SMART_SERVICE"),
    "前置：demo_user 无 SMART_SERVICE 备案行",
  );

  // ── 1. AIworkin 类目镜像（IT服务复用「软件 / AI开发公司」子树）
  const cats = await api("GET", "/enterprise/aiworkin/categories?domain=SMART", null, "demo_enterprise");
  // 契约：`{ modules: [{ domain, label, category1, category1Id, category2Options[] }] }`
  const moduleOf = (payload, domain) =>
    (payload?.modules || []).find((item) => item.domain === domain);
  const smartModule = moduleOf(cats.data, "SMART");
  const smartLeaves = smartModule?.category2Options || [];
  assert(
    smartModule?.category1 === "软件 / AI开发公司" && smartLeaves.length > 0,
    "SMART 类目镜像可选（含二级类目）",
    JSON.stringify({ parent: smartModule?.category1, n: smartLeaves.length }),
  );
  const leafId = smartLeaves[0].id;
  const logisticsCats = await api("GET", "/enterprise/aiworkin/categories?domain=LOGISTICS", null, "demo_enterprise");
  const foreignLeaf = (moduleOf(logisticsCats.data, "LOGISTICS")?.category2Options || [])[0]?.id;
  assert(!!foreignLeaf, "物流类目镜像可用（用作跨模块类目反例）", foreignLeaf);

  // ── 2. 备案必填细项
  console.log("\n[2] 备案必填细项（SMART_SERVICE 与出海/营销/物流/资产同构）");
  const bare = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", { provider_types: ["SMART_SERVICE"] }),
    "demo_user",
  );
  assert(
    bare.json?.code !== 0 && /细项/.test(bare.json?.message || ""),
    "IT服务未勾细项被拒",
    bare.json?.message,
  );
  const chinese = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", {
      provider_types: ["SMART_SERVICE"],
      service_items: { SMART_SERVICE: ["AI实施"] },
    }),
    "demo_user",
  );
  assert(
    chinese.json?.code !== 0 && /细项/.test(chinese.json?.message || ""),
    "裸中文细项被拒（只认 code）",
    chinese.json?.message,
  );
  const unknown = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", {
      provider_types: ["SMART_SERVICE"],
      service_items: { SMART_SERVICE: ["AI_DEPLOY", "冷链干线"] },
    }),
    "demo_user",
  );
  assert(unknown.json?.code !== 0, "不属于IT服务五项的 code 被拒", unknown.json?.message);
  const cross = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", {
      provider_types: ["SMART_SERVICE"],
      service_items: { SMART_SERVICE: ["DOMESTIC_LAND"] },
    }),
    "demo_user",
  );
  assert(cross.json?.code !== 0, "物流细项不能填进IT服务备案行", cross.json?.message);
  const crossBack = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", {
      provider_types: ["LOGISTICS"],
      service_items: { LOGISTICS: ["AI_DEPLOY"] },
    }),
    "demo_user",
  );
  assert(crossBack.json?.code !== 0, "IT服务细项不能填进物流备案行", crossBack.json?.message);

  // ── 3. 平台逐项审核
  console.log("\n[3] 平台逐项审核");
  const apply = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_A, "91310000E2S000001", {
      provider_types: ["SMART_SERVICE"],
      service_items: { SMART_SERVICE: ITEMS },
    }),
    "demo_user",
  );
  assert(apply.json?.code === 0, "IT服务备案勾选五项细项提交成功", apply.json?.message);
  const appId = apply.data?.id;
  assert(!!appId, "备案行返回 id", String(appId));
  const pendingList = await api("GET", "/enterprise/admin/provider-applications?status=PENDING", null, "admin");
  const pendingRow = (pendingList.data || []).find((item) => item.id === appId);
  assert(!!pendingRow, "管理后台可见该待审备案行");
  assert(
    String(pendingRow?.serviceItems || "") === ITEMS.join(","),
    "serviceItems 按报名 code 落库",
    pendingRow?.serviceItems,
  );
  const noDecisions = await api(
    "POST",
    `/enterprise/admin/provider-applications/${appId}/audit`,
    { action: "APPROVE" },
    "admin",
  );
  assert(
    noDecisions.json?.code !== 0 && /逐项审核/.test(noDecisions.json?.message || ""),
    "缺逐项结论时不允许通过",
    noDecisions.json?.message,
  );
  const audit = await api(
    "POST",
    `/enterprise/admin/provider-applications/${appId}/audit`,
    {
      action: "APPROVE",
      items: ITEMS.map((item) => ({
        item,
        status: APPROVED.includes(item) ? "APPROVE" : "REJECT",
        note: APPROVED.includes(item) ? "" : "暂无算力集群资质",
      })),
    },
    "admin",
  );
  assert(audit.json?.code === 0, "IT服务细项逐项审核提交成功", audit.json?.message);
  const afterAudit = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  const approvedRow = (afterAudit.data?.items || []).find((item) => item.id === appId);
  assert(approvedRow?.status === "APPROVED", "有通过项 → 整体 APPROVED", approvedRow?.status);
  assert(
    String(approvedRow?.serviceItems || "") === APPROVED.join(","),
    "serviceItems 收窄为通过项（算力服务不生效）",
    approvedRow?.serviceItems,
  );
  const audits = Array.isArray(approvedRow?.itemAudits) ? approvedRow.itemAudits : [];
  assert(audits.length === 5, "itemAudits 保留 5 条结论", JSON.stringify(audits.map((i) => i.item)));
  assert(
    audits.find((i) => i.item === "COMPUTE")?.status === "REJECTED",
    "算力服务结论为 REJECTED",
    JSON.stringify(audits.find((i) => i.item === "COMPUTE")),
  );
  assert(
    audits.every((i) => /[\u4e00-\u9fa5]/.test(String(i.label || ""))),
    "结论带中文标签（无裸枚举）",
    audits.map((i) => i.label).join(","),
  );
  // 第二家IT服务商：五项全通过（验证同一细项不限家数）
  const applyB = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody(ORG_B, "91310000E2S000002", {
      provider_types: ["SMART_SERVICE"],
      service_items: { SMART_SERVICE: ITEMS },
    }),
    "demo_supply",
  );
  assert(applyB.json?.code === 0, "第二家IT服务商备案提交成功", applyB.json?.message);
  const appIdB = applyB.data?.id;
  const auditB = await api(
    "POST",
    `/enterprise/admin/provider-applications/${appIdB}/audit`,
    {
      action: "APPROVE",
      items: ITEMS.map((item) => ({ item, status: "APPROVE", note: "" })),
    },
    "admin",
  );
  assert(auditB.json?.code === 0, "第二家备案五项全部通过", auditB.json?.message);

  // ── 4. 名录按细项分区
  console.log("\n[4] 名录按五个细项分区");
  async function directory(type) {
    const res = await api("GET", `/enterprise/contracts/providers?serviceType=${type}`, null, "demo_enterprise");
    return (res.data || []).map((item) => item.providerUserId);
  }
  for (const item of APPROVED) {
    const ids = await directory(item);
    assert(
      ids.includes(users.demo_user.userId) && ids.includes(users.demo_supply.userId),
      `${item} 分区含两家已备案IT服务商`,
      `${ids.length} 家`,
    );
  }
  const computeIds = await directory("COMPUTE");
  assert(
    !computeIds.includes(users.demo_user.userId),
    "算力服务分区不含该项被驳回的服务商（demo_user）",
    `${computeIds.length} 家`,
  );
  assert(
    computeIds.includes(users.demo_supply.userId),
    "算力服务分区该项通过的第二家服务商（demo_supply）",
    `${computeIds.length} 家`,
  );
  assert(
    !(await directory("AI_DEPLOY")).includes(users.demo_marketing.userId),
    "未备案IT服务的服务商不进IT服务分区",
  );

  // ── 5. 按细项独立签约（不限家数）
  console.log("\n[5] 按细项签约：裸类目不可签、同细项不限家数");
  const bareSign = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "SMART_SERVICE" },
    "demo_enterprise",
  );
  assert(
    bareSign.json?.code !== 0 && /分类不合法/.test(bareSign.json?.message || ""),
    "裸 SMART_SERVICE 不是签约单位（只在细项级）",
    bareSign.json?.message,
  );
  const notAccepted = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "COMPUTE" },
    "demo_enterprise",
  );
  assert(
    notAccepted.json?.code !== 0 && /不承接/.test(notAccepted.json?.message || ""),
    "未通过细项不可签约",
    notAccepted.json?.message,
  );
  const signA = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "AI_DEPLOY" },
    "demo_enterprise",
  );
  assert(signA.json?.code === 0, "按 AI实施 细项发起签约", signA.json?.message);
  const signB = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_supply.userId, service_type: "AI_DEPLOY" },
    "demo_enterprise",
  );
  assert(
    signB.json?.code === 0,
    "同一细项再签第二家IT服务商（不限家数，与物流同口径）",
    signB.json?.message,
  );
  const dup = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "AI_DEPLOY" },
    "demo_enterprise",
  );
  assert(dup.json?.code !== 0, "同服务商同细项重复发起被拒", dup.json?.message);
  const signOther = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "HARDWARE" },
    "demo_enterprise",
  );
  assert(
    signOther.json?.code === 0,
    "不同细项各自独立签约（硬件服务）",
    signOther.json?.message,
  );
  // 签约需服务商确认才生效（`POST /enterprise/contracts` 只回 DTO，承接账号由发起时已知）
  const confirmPairs = [
    [signA.data, "demo_user"],
    [signB.data, "demo_supply"],
  ];
  for (const [row, account] of confirmPairs) {
    const ok = await api(
      "POST",
      `/enterprise/contracts/${row.id}/confirm`,
      null,
      account,
    );
    assert(ok.json?.code === 0, `服务商确认签约 #${row.id}`, ok.json?.message);
  }
  const contracts = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  const activeAi = (contracts.data || []).filter(
    (item) => item.serviceType === "AI_DEPLOY" && item.status === "ACTIVE",
  );
  assert(activeAi.length === 2, "AI实施细项生效签约＝2 家", `${activeAi.length} 家`);

  // ── 6. 需求：按细项直派 + 公开池回复即接单 + 推进
  console.log("\n[6] 需求消息通道（直派 / 回复即接单 / 推进）");
  const badItem = await api(
    "POST",
    "/enterprise/smart",
    { title: "反例：细项不合法", service_item: "DOMESTIC_LAND", sub_category_id: leafId },
    "demo_enterprise",
  );
  assert(
    badItem.json?.code !== 0 && /服务细项/.test(badItem.json?.message || ""),
    "非IT服务五项的细项被拒",
    badItem.json?.message,
  );
  const badCategory = await api(
    "POST",
    "/enterprise/smart",
    { title: "反例：跨模块类目", service_item: "AI_DEPLOY", sub_category_id: foreignLeaf },
    "demo_enterprise",
  );
  assert(
    badCategory.json?.code !== 0 && /二级类目不属于/.test(badCategory.json?.message || ""),
    "物流类目 id 不能发到IT服务板块",
    badCategory.json?.message,
  );
  const noTitle = await api(
    "POST",
    "/enterprise/smart",
    { service_item: "AI_DEPLOY", sub_category_id: leafId },
    "demo_enterprise",
  );
  assert(noTitle.json?.code !== 0, "缺标题被拒", noTitle.json?.message);

  const demandA = await api(
    "POST",
    "/enterprise/smart",
    {
      title: "E2E IT服务·大模型客服落地",
      service_item: "AI_DEPLOY",
      sub_category_id: leafId,
      description: "把客服问答接进自有知识库，需要 RAG 与工单闭环。",
      tags: "大模型,智能体",
      budget: "面议",
      expected_result: "上线可用的智能客服",
      must_conditions: "私有化部署",
      region_scope: "全国",
      expect_start: "2026-10-10",
      deadline: "2026-11-10",
      contact_name: "张三",
      contact_phone: "13800001111",
      email_sync: "0",
    },
    "demo_enterprise",
  );
  assert(demandA.json?.code === 0, "发布 AI实施 需求成功", demandA.json?.message);
  const createdA = demandA.data || {};
  assert(
    createdA.aiworkin_sync_status === "FAILED",
    "本地演示账号（u-*，非 UUID）在正式平台留痕＝FAILED",
    `${createdA.aiworkin_sync_status}｜${(createdA.tip || "").slice(0, 120)}`,
  );
  // 落库字段以列表为准（create 只回 DTO）
  const listA = await api("GET", "/enterprise/smart", null, "demo_enterprise");
  const rowA = (listA.data || []).find((item) => item.id === createdA.id) || {};
  assert(/^ZH\d{8}-/.test(String(rowA.orderNo || "")), "单据号前缀＝ZH", rowA.orderNo);
  assert(rowA.serviceItem === "AI_DEPLOY", "细项落库＝AI_DEPLOY", rowA.serviceItem);
  assert(rowA.status === "PENDING", "已签 AI实施 → 直派且状态＝PENDING", rowA.status);
  assert(
    [users.demo_user.userId, users.demo_supply.userId].includes(rowA.providerUserId),
    "直派到已签约IT服务商",
    `${rowA.providerUserId}｜${rowA.providerName}`,
  );
  assert(!!rowA.providerName && /[\u4e00-\u9fa5]/.test(rowA.providerName), "承接服务商名中文回显", rowA.providerName);
  assert(rowA.category1 && rowA.category2, "列表带出一/二级类目名", `${rowA.category1}/${rowA.category2}`);

  const demandB = await api(
    "POST",
    "/enterprise/smart",
    {
      title: "E2E IT服务·边缘网关硬件适配",
      service_item: "DATA_SERVICE",
      sub_category_id: leafId,
      description: "数据采集链路与治理规范咨询。",
      budget: "¥60,000",
      region_scope: "长三角",
      email_sync: "0",
    },
    "demo_enterprise",
  );
  assert(demandB.json?.code === 0, "发布 数据服务 需求成功", demandB.json?.message);
  const listB = await api("GET", "/enterprise/smart", null, "demo_enterprise");
  const rowB =
    (listB.data || []).find((item) => item.id === demandB.data?.id) || {};
  assert(rowB.status === "OPEN", "未签该细项 → 进公开池 OPEN", rowB.status);
  assert(!rowB.providerUserId, "公开池需求无承接服务商", String(rowB.providerUserId));
  assert(rowB.serviceItem === "DATA_SERVICE", "细项落库＝DATA_SERVICE", rowB.serviceItem);

  // 越权：非承办、非当事人的服务商账号不可见公开池之外的单
  const outsider = await api("GET", "/enterprise/smart", null, "demo_logistics3");
  assert(
    !(outsider.data || []).some((item) => [rowA.id, rowB.id].includes(item.id)),
    "未备案IT服务的服务商账号看不到测试需求",
    `${(outsider.data || []).length} 行`,
  );

  // 回复即接单：demo_logistics3 不行（未备案），demo_user 可以
  const strangerReply = await api(
    "POST",
    `/enterprise/smart/${rowB.id}/messages`,
    { text: "我们也能接这单。" },
    "demo_logistics3",
  );
  assert(
    strangerReply.json?.code === 20002,
    "未备案IT服务的服务商不能回复接单",
    `${strangerReply.status} ${strangerReply.json?.message}`,
  );
  const reply = await api(
    "POST",
    `/enterprise/smart/${rowB.id}/messages`,
    { text: "数据治理我们做过三个同类项目，报价 ¥55,000，两周内交付。" },
    "demo_user",
  );
  assert(reply.json?.code === 0, "服务商直接回复即接单", reply.json?.message);
  const listAfterReply = await api("GET", "/enterprise/smart", null, "demo_enterprise");
  const rowBAfter = (listAfterReply.data || []).find((item) => item.id === rowB.id);
  assert(rowBAfter?.status === "PENDING", "首次回复后状态→PENDING", rowBAfter?.status);
  assert(
    rowBAfter?.providerUserId === users.demo_user.userId,
    "首次回复后绑定承接服务商",
    rowBAfter?.providerUserId,
  );
  assert(
    String(rowBAfter?.providerName || "") === users.demo_user.displayName,
    "承接服务商名回显为回复方账号显示名（与物流同一口径）",
    rowBAfter?.providerName,
  );
  // 规则 67：`/messages` 返回回复方会话清单 {conversations:[{id,name,messages:[…]}], source}
  const msgs = await api("GET", `/enterprise/smart/${rowB.id}/messages`, null, "demo_enterprise");
  const convs = msgs.data?.conversations;
  assert(msgs.status === 200 && Array.isArray(convs), "消息通道返回会话清单", msgs.text?.slice(0, 160));
  assert(
    ["AIWORKIN", "LOCAL"].includes(msgs.data?.source),
    "会话清单标明数据来源",
    String(msgs.data?.source),
  );
  const allMsgs = (convs || []).flatMap((c) => c.messages || []);
  assert(
    allMsgs.some((m) => m.role === "PROVIDER"),
    "消息通道含服务商报价",
    `${(convs || []).length} 个会话 / ${allMsgs.length} 条`,
  );
  assert(
    allMsgs.some((m) => /已回复并接收工单/.test(String(m.text || ""))),
    "系统动态记录「已回复并接收工单」",
    allMsgs.map((m) => m.text).join(" | ").slice(0, 200),
  );
  // 状态事件随列表行返回（`/messages` 接口只承载消息流）
  assert((rowBAfter?.events || []).length >= 2, "状态事件已留痕", `${(rowBAfter?.events || []).length} 条`);

  // 推进：START → IN_PROGRESS → DELIVER → DELIVERED（承办人＝回复接单的 demo_user）
  const started = await api(
    "POST",
    `/enterprise/smart/${rowB.id}/advance`,
    { action: "START", text: "已进场调研数据现状。" },
    "demo_user",
  );
  assert(started.json?.code === 0 && started.data?.status === "IN_PROGRESS", "推进 START→IN_PROGRESS", started.json?.message);
  const badAction = await api(
    "POST",
    `/enterprise/smart/${rowB.id}/advance`,
    { action: "FINISH", text: "反例动作" },
    "demo_user",
  );
  assert(badAction.json?.code !== 0, "非法推进动作被拒", badAction.json?.message);
  const delivered = await api(
    "POST",
    `/enterprise/smart/${rowB.id}/advance`,
    { action: "DELIVER", text: "数据治理规范与采集脚本已交付。" },
    "demo_user",
  );
  assert(delivered.json?.code === 0 && delivered.data?.status === "DELIVERED", "推进 DELIVER→DELIVERED", delivered.json?.message);
  const listDelivered = await api("GET", "/enterprise/smart", null, "demo_enterprise");
  const deliveredRow = (listDelivered.data || []).find((item) => item.id === rowB.id);
  assert(deliveredRow?.feedback?.n === 3 && deliveredRow?.feedback?.m === 3, "反馈进度＝3/3", JSON.stringify(deliveredRow?.feedback));
  // 规则 16：能不能改只按身份判定，不按业务状态——创建人改终态单同样放行
  const lateEdit = await api(
    "PATCH",
    `/enterprise/smart/${rowB.id}`,
    { title: "E2E IT服务·终态后由创建人改标题" },
    "demo_enterprise",
  );
  assert(
    lateEdit.json?.code === 0,
    "终态单由创建人修改放行（不按状态门控）",
    lateEdit.json?.message,
  );
  // 反向：非创建人的服务商账号即使已承接也不可改企业需求
  const notOwnerEdit = await api(
    "PATCH",
    `/enterprise/smart/${rowB.id}`,
    { title: "服务商替企业改需求" },
    "demo_user",
  );
  assert(
    notOwnerEdit.json?.code === 20002 &&
      /仅需求创建人或平台管理员/.test(notOwnerEdit.json?.message || ""),
    "非创建人改需求被拒（只按身份判定）",
    notOwnerEdit.json?.message,
  );

  // 修改：PENDING 可改（细项与类目一并校验）
  const edited = await api(
    "PATCH",
    `/enterprise/smart/${rowA.id}`,
    { title: "E2E IT服务·大模型客服落地（已改）", budget: "¥120,000", sub_category_id: foreignLeaf },
    "demo_enterprise",
  );
  assert(
    edited.json?.code !== 0 && /二级类目不属于/.test(edited.json?.message || ""),
    "修改时跨模块类目 id 同样被拒",
    edited.json?.message,
  );
  const editedOk = await api(
    "PATCH",
    `/enterprise/smart/${rowA.id}`,
    { title: "E2E IT服务·大模型客服落地（已改）", budget: "¥120,000", sub_category_id: leafId },
    "demo_enterprise",
  );
  assert(editedOk.json?.code === 0, "PENDING 单可修改", editedOk.json?.message);
  const afterEdit = (await api("GET", "/enterprise/smart", null, "demo_enterprise")).data || [];
  const editedRow = afterEdit.find((item) => item.id === rowA.id);
  assert(
    editedRow?.title === "E2E IT服务·大模型客服落地（已改）" && editedRow?.budget === "¥120,000",
    "修改内容已落库",
    `${editedRow?.title}｜${editedRow?.budget}`,
  );
  assert(editedRow?.serviceItem === "AI_DEPLOY", "修改不动细项归属", editedRow?.serviceItem);

  // 管理后台计数与可见性
  const adminList = await api("GET", "/enterprise/smart", null, "admin");
  assert(
    [rowA.id, rowB.id].every((id) => (adminList.data || []).some((item) => item.id === id)),
    "平台管理员可监管两条测试需求",
    `${(adminList.data || []).length} 行`,
  );
  const stats = await api("GET", "/enterprise/admin/stats", null, "admin");
  assert(
    typeof stats.data?.smartOrders === "number" && stats.data.smartOrders >= 2,
    "管理后台总览含IT服务单计数",
    `smartOrders=${stats.data?.smartOrders}`,
  );
  const servicesDistribution = stats.data?.servicesByType || {};
  assert(
    servicesDistribution.SMART_SERVICE >= 2,
    "服务类型分布含IT服务（两家已备案）",
    `SMART_SERVICE=${servicesDistribution.SMART_SERVICE}`,
  );

  // ── 7. 职员按细项挂靠
  console.log("\n[7] 职员按细项挂靠");
  const roles = await api("GET", "/enterprise/staff/roles", null, "demo_user");
  const codes = (roles.data || []).map((item) => item.code);
  for (const item of APPROVED) {
    assert(codes.includes(item), `已生效细项 ${item} 进角色选项`, codes.join(","));
  }
  assert(!codes.includes("COMPUTE"), "未通过细项不进角色选项");
  const aiRole = (roles.data || []).find((item) => item.code === "AI_DEPLOY");
  assert(
    aiRole?.category === "IT服务 · AI实施" && aiRole?.role === "AI实施专员",
    "角色分组中文「IT服务 · AI实施」",
    JSON.stringify(aiRole),
  );
  const hardwareRole = (roles.data || []).find((item) => item.code === "HARDWARE");
  assert(
    hardwareRole?.role === "硬件服务专员",
    "硬件服务角色名＝硬件服务专员",
    JSON.stringify(hardwareRole),
  );
  assert(
    (roles.data || []).every((item) => /[\u4e00-\u9fa5]/.test(String(item.category || ""))),
    "挂靠类目全中文（无裸枚举）",
  );

  // ── 8. 服务发布：IT服务板块真实写入 AIworkin 正式平台
  console.log("\n[8] 服务发布（SMART 板块 → 正式平台）");
  const gate = await api("POST", "/enterprise/services", {
    domain: "SMART",
    title: "E2E 反例：未备案IT服务不能发布",
    description: "验证服务发布的资质门控，验证后立即删除。",
    sub_category_id: leafId,
    publish_action: "DRAFT",
  }, "demo_legal");
  assert(gate.json?.code !== 0, "未通过IT服务备案的服务商不能在该板块发布服务", gate.json?.message);

  const status = await raw("GET", "/enterprise/aiworkin/status", undefined, platformToken);
  assert(status.json?.data?.enabled === true, "1690 通道已启用", JSON.stringify(status.json?.data?.baseUrl));
  assert(status.json?.data?.baseUrl === PLATFORM, "1690 通道指向正式平台", status.json?.data?.baseUrl);
  const remoteCats = await remote("GET", "/market/categories");
  const remoteLeaf = (remoteCats.json?.data || [])
    .flatMap((one) => one.children || [])
    .find((one) => one.id === leafId);
  assert(
    !!remoteLeaf && remoteLeaf.enabled === true,
    "正式平台存在 SMART 镜像的二级类目",
    remoteLeaf ? `${remoteLeaf.key}/${remoteLeaf.nameZh}` : "未命中",
  );
  if (remoteLeaf) {
    // 平台真实账号备案 + 平台审核通过 + 切服务商身份 → 发布
    const platformApply = await raw("POST", "/enterprise/identity/provider-application", applyBody(
      "E2EIT服务正式平台机构",
      "91310000E2S000003",
      { provider_types: ["SMART_SERVICE"], service_items: { SMART_SERVICE: ITEMS } },
    ), platformToken);
    assert(platformApply.json?.code === 0, "正式平台账号提交IT服务备案", platformApply.json?.message);
    const platformAppId = platformApply.json?.data?.id;
    if (!platformAppId) throw new Error("平台账号备案未返回 id，停止写入正式平台");
    const platformAudit = await api(
      "POST",
      `/enterprise/admin/provider-applications/${platformAppId}/audit`,
      { action: "APPROVE", items: ITEMS.map((item) => ({ item, status: "APPROVE", note: "" })) },
      "admin",
    );
    assert(platformAudit.json?.code === 0, "平台账号备案逐项通过", platformAudit.json?.message);
    const switchRes = await raw(
      "POST",
      "/enterprise/me/identity",
      { identity: "SERVICE_PROVIDER" },
      platformToken,
    );
    assert(switchRes.json?.code === 0, "切换到服务商身份", switchRes.json?.message);
    const publishTitle = `正式平台联通验证·IT服务（可删）${Date.now()}`;
    const published = await raw("POST", "/enterprise/services", {
      domain: "SMART",
      sub_category_id: leafId,
      title: publishTitle,
      description: `本条由 verify-smart-service.mjs 于 ${new Date().toISOString()} 创建，用于验证IT服务「服务发布」真实写入 AIworkin 正式平台，验证后立即删除。`,
      tags: "验证, IT服务, 正式平台",
      money_mode: "NEGOTIABLE",
      service_area_mode: "NATIONWIDE",
      price_description: "按项目计费，面议",
      response_time: "1 个工作日",
      province: "浙江省",
      city: "杭州市",
      publish_action: "DRAFT",
    }, platformToken);
    const serviceRow = published.json?.data || {};
    assert(published.json?.code === 0, "IT服务发布接口返回成功", published.text.slice(0, 200));
    assert(
      serviceRow.aiworkin_sync_status === "SYNCED",
      "留痕＝SYNCED（真实写入正式平台，不是 SKIPPED/FAILED）",
      `${serviceRow.aiworkin_sync_status}｜${serviceRow.tip || ""}`,
    );
    assert(UUID_PATTERN.test(String(serviceRow.platform_listing_id || "")), "平台回写真实单号", serviceRow.platform_listing_id);
    assert(serviceRow.status === "DRAFT", "本系统状态＝草稿", serviceRow.status);
    const listingId = serviceRow.platform_listing_id;
    const mine = await remote("GET", `/market/listings/mine/${listingId}`, undefined, platformToken);
    const onPlatform = mine.json?.data || {};
    assert(onPlatform.title === publishTitle, "平台标题与提交一致", onPlatform.title);
    assert(onPlatform.direction === "SUPPLY", "平台 direction=SUPPLY", onPlatform.direction);
    assert(onPlatform.subcategoryId === leafId, "平台二级类目与提交一致", onPlatform.subcategoryId);
    assert(
      onPlatform.province === undefined || onPlatform.province === null,
      "平台顶层不承载省市（契约拒收）",
      JSON.stringify(onPlatform.province),
    );
    const remoteDelete = await remote("DELETE", `/market/listings/${listingId}`, undefined, platformToken);
    assert(remoteDelete.json?.code === 0, "正式平台删除该验证单", remoteDelete.text.slice(0, 160));
    const gone = await remote("GET", `/market/listings/mine/${listingId}`, undefined, platformToken);
    assert(gone.status === 404, "平台单删除后属主侧 404", `HTTP ${gone.status}`);
    const localDelete = await raw("DELETE", `/enterprise/services/${serviceRow.id}`, undefined, platformToken);
    assert(localDelete.json?.code === 0, "本地服务发布行已删除", localDelete.text.slice(0, 160));
    const platformAppDel = await raw(
      "DELETE",
      `/enterprise/identity/provider-application/${platformAppId}`,
      undefined,
      platformToken,
    );
    assert(platformAppDel.json?.code === 0, "平台账号测试备案行已删除", platformAppDel.json?.message);
  }

  // ── 9. 清理
  console.log("\n[9] 清理本次验证数据");
  for (const id of [signA.data?.id, signB.data?.id, signOther.data?.id]) {
    if (!id) continue;
    const off = await api("POST", `/enterprise/contracts/${id}/terminate`, null, "demo_enterprise");
    assert(off.json?.code === 0, `解约测试签约 #${id}`, off.json?.message);
  }
  // 规则 16：能不能删只按身份判定——创建人删已承接/终态单同样放行，不需脚本删库回收
  const delDemandA = await api("DELETE", `/enterprise/smart/${rowA.id}`, null, "demo_enterprise");
  assert(
    delDemandA.json?.code === 0,
    "已直派承接的需求由创建人删除放行",
    delDemandA.json?.message,
  );
  const delDemandB = await api("DELETE", `/enterprise/smart/${rowB.id}`, null, "demo_enterprise");
  assert(
    delDemandB.json?.code === 0,
    "终态需求单 B 由创建人删除放行",
    delDemandB.json?.message,
  );
  for (const [id, account] of [[appId, "demo_user"], [appIdB, "demo_supply"]]) {
    const del = await api("DELETE", `/enterprise/identity/provider-application/${id}`, null, account);
    assert(del.json?.code === 0, `删除测试备案行 #${id}`, del.json?.message);
  }
  const afterCleanup = await api("GET", "/enterprise/smart", null, "demo_enterprise");
  assert(
    !(afterCleanup.data || []).some((item) => [rowA.id, rowB.id].includes(item.id)),
    "清理后列表无测试需求",
    `${(afterCleanup.data || []).length} 行`,
  );
  const dirAfter = await directory("AI_DEPLOY");
  assert(
    !dirAfter.includes(users.demo_user.userId) && !dirAfter.includes(users.demo_supply.userId),
    "清理后名录分区不含测试机构",
    `${dirAfter.length} 家`,
  );
  const contractsAfter = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  assert(
    !(contractsAfter.data || []).some(
      (item) => ITEMS.includes(item.serviceType) && ["PENDING", "ACTIVE"].includes(item.status),
    ),
    "清理后无遗留测试签约",
  );

  await prisma.$disconnect();
  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error("验证脚本异常：", err?.message || err);
  await prisma.$disconnect();
  process.exit(1);
});
