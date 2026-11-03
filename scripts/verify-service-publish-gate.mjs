/**
 * 「服务发布」栏目资质门控（2026-09-25 用户口径）后端口径验证：
 * **除资产交易外**，五个板块只允许「当前身份＝服务商 且 该板块服务类目备案审核通过」的账号发布；
 * 资产交易按 §6.9 双身份口径保持开放。断言按备案数据逐条给**唯一期望值**（不放水）。
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693，见 regression-instance.mjs）。自建自清，不留副作用。
 */
import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, token, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

/** 该板块的备案类目（与后端 SERVICE_PUBLISH_CATEGORY_BY_DOMAIN 同源，用于拼期望文案）。 */
const CATEGORY_LABELS = {
  LOGISTICS: "物流服务",
  IP: "知识产权服务",
  LEGAL: "法律服务",
  FLEX: "灵活用工服务",
  MARKETING: "营销服务",
};
/** 拒绝码：20002＝当前身份不是服务商；403＝服务商身份但该板块未备案通过。 */
const NOT_PROVIDER = 20002;
const NOT_FILING = 403;

/** 当前身份（与后端 qualifications 同口径：偏好仅在仍持有时生效）。 */
async function identityOf(username) {
  const me = await api("GET", "/enterprise/me", null, username);
  return me.data?.data?.currentIdentity || "";
}

/**
 * 用例：账号 × 板块 → 期望（ok / 拒绝码）。
 * 备案数据（provider_application，status=APPROVED）：
 * - demo_all：九类目全备案（含 LOGISTICS/MARKETING/IP_SERVICE/LEGAL_SERVICE/FLEX_WORK）；
 * - demo_logistics：仅 MICRO 行（承载物流两细项）→ 物流应放行；
 * - demo_user：虽有 TAX_FINANCE 备案，但当前身份为用户 → 20002；
 * - demo_provider：ASSET_TRADE + EXPORT_REFUND + TAX_FINANCE → 知产按「未备案」拒；
 * - demo_dual：有 TAX_FINANCE 备案但当前身份＝用户 → 20002；
 * - demo_enterprise（无备案）/ demo_staff_all（仅职员绑定）/ demo_personal（个人主体）/ admin（平台管理员）→ 20002。
 */
const CASES = [
  // ① 有资质服务商：五个受限板块 + 资产全部放行
  ...["LOGISTICS", "IP", "LEGAL", "FLEX", "MARKETING", "ASSET"].map((domain) => ({
    user: "demo_all",
    domain,
    expect: "ok",
  })),
  // ② 小微服务商（MICRO 备案行承载物流细项）：物流放行
  { user: "demo_logistics", domain: "LOGISTICS", expect: "ok" },
  // ③ 用户身份先被身份门控拒绝；服务商身份但板块未备案通过则由 demo_provider 覆盖
  { user: "demo_user", domain: "LOGISTICS", expect: NOT_PROVIDER },
  { user: "demo_user", domain: "MARKETING", expect: NOT_PROVIDER },
  { user: "demo_provider", domain: "IP", expect: NOT_FILING },
  { user: "demo_provider", domain: "LEGAL", expect: NOT_FILING },
  // ④ 有服务商资质但当前身份不是服务商 → 20002；资产不受门控仍放行
  { user: "demo_dual", domain: "LOGISTICS", expect: NOT_PROVIDER },
  { user: "demo_dual", domain: "ASSET", expect: "ok" },
  // ⑤ 用户 / 职员 / 个人 / 平台管理员：五个板块一律拒，资产放行
  { user: "demo_enterprise", domain: "LOGISTICS", expect: NOT_PROVIDER },
  { user: "demo_enterprise", domain: "MARKETING", expect: NOT_PROVIDER },
  { user: "demo_enterprise", domain: "ASSET", expect: "ok" },
  { user: "demo_staff_all", domain: "FLEX", expect: NOT_PROVIDER },
  { user: "demo_staff_all", domain: "ASSET", expect: "ok" },
  { user: "demo_personal", domain: "LEGAL", expect: NOT_PROVIDER },
  { user: "demo_personal", domain: "ASSET", expect: "ok" },
  { user: "admin", domain: "IP", expect: NOT_PROVIDER },
  { user: "admin", domain: "ASSET", expect: "ok" },
];

const created = [];

try {
  const health = await api("GET", "/health");
  assert(health.data?.code === 0, "health");

  // 前置状态核对：断言用的身份/备案数据必须成立，否则用例的期望值无意义
  assert(
    (await identityOf("demo_all")) === "SERVICE_PROVIDER",
    "前置：demo_all 当前身份＝服务商",
  );
  assert(
    (await identityOf("demo_dual")) === "ENTERPRISE_USER",
    "前置：demo_dual 当前身份＝用户",
  );
  assert(
    (await identityOf("demo_staff_all")) === "PROVIDER_STAFF",
    "前置：demo_staff_all 当前身份＝职员",
  );
  assert(
    (await identityOf("demo_personal")) === "ENTERPRISE_USER",
    "前置：demo_personal 当前身份＝用户",
  );

  for (const item of CASES) {
    const label = `${item.user} · ${item.domain}`;
    const create = await api(
      "POST",
      "/enterprise/services",
      {
        domain: item.domain,
        title: `verify 服务发布门控 · ${item.domain}`,
        description: "验证「服务发布」资质门控：本条为脚本自建草稿，跑完即删。",
        money_mode: "NEGOTIABLE",
        price_description: "面议（验证数据）",
        service_area_mode: "NATIONWIDE",
        publish_action: "DRAFT",
      },
      item.user,
    );
    const row = create.data?.data;
    if (row?.id) created.push({ user: item.user, id: row.id });
    if (item.expect === "ok") {
      assert(
        create.data?.code === 0 && !!row?.service_no,
        `${label}：放行（建档成功）`,
        JSON.stringify(create.data?.message || row?.service_no || ""),
      );
      assert(row?.status === "DRAFT", `${label}：停在草稿态`, `status=${row?.status}`);
      const list = await api(
        "GET",
        `/enterprise/services?domain=${item.domain}`,
        null,
        item.user,
      );
      assert(
        (list.data?.data || []).some((x) => x.id === row?.id),
        `${label}：本人列表可见`,
      );
      const other = await api(
        "GET",
        `/enterprise/services?domain=${item.domain}`,
        null,
        item.user === "demo_provider" ? "demo_enterprise" : "demo_provider",
      );
      assert(
        !(other.data?.data || []).some((x) => x.id === row?.id),
        `${label}：他人列表不可见`,
      );
      continue;
    }
    assert(
      create.status === 403 && create.data?.code === item.expect && !row?.id,
      `${label}：拦下（code=${item.expect}）`,
      `http=${create.status} code=${create.data?.code} msg=${create.data?.message || ""}`,
    );
    const hint = item.expect === NOT_PROVIDER ? "只对服务商身份开放" : "未通过";
    assert(
      String(create.data?.message || "").includes(hint),
      `${label}：提示含「${hint}」`,
      create.data?.message || "",
    );
  }

  // 未备案板块的草稿不能被「无该板块资质」的账号绕过（同一账号换板块仍按门控走）
  const bypass = await api(
    "POST",
    "/enterprise/services",
    { domain: "flex", title: "verify 服务发布门控 · 小写域", description: "x" },
    "demo_enterprise",
  );
  assert(
    bypass.data?.code === NOT_PROVIDER,
    "业务域大小写不敏感：小写 flex 同样按门控拦下",
    JSON.stringify(bypass.data?.message || ""),
  );

  // 未知业务域必须被拦（服务发布只覆盖有本地台账的板块）
  const badDomain = await api(
    "POST",
    "/enterprise/services",
    { domain: "NOT_A_BOARD", title: "x", description: "y" },
    "demo_enterprise",
  );
  assert(
    badDomain.data?.code === 400 &&
      badDomain.data?.message === "请选择业务域",
    "未知业务域被拒（不是本地台账板块）",
    `${badDomain.data?.code}「${badDomain.data?.message}」`,
  );

  // 财税 / 供销 / 出海（2026-09-26 起平台直连，本系统零落库）：本地台账路由必须拒收，
  // 否则写进去的行任何看板都读不到（任何身份同一判据，门控在身份之前）。
  for (const [domain, label] of [
    ["TAX", "财税服务"],
    ["SUPPLY", "供销服务"],
    ["OVERSEAS", "跨境出海"],
  ]) {
    const before = await prisma.providerServiceListing.count({ where: { domain } });
    for (const user of ["demo_all", "demo_enterprise"]) {
      const res = await api(
        "POST",
        "/enterprise/services",
        {
          domain,
          title: `verify 直连板块不走本地台账 · ${domain}`,
          description: "本条应当被拒收；若建档成功即为双写死角。",
          money_mode: "NEGOTIABLE",
          price_description: "面议（验证数据）",
          service_area_mode: "NATIONWIDE",
          publish_action: "DRAFT",
        },
        user,
      );
      assert(
        res.data?.code === 400 &&
          res.data?.message === `${label}的服务发布走平台直连接口，本系统不写本地台账` &&
          !res.data?.data?.id,
        `${user} · ${domain}：本地台账拒收（改走平台直连）`,
        `${res.data?.code}「${res.data?.message}」`,
      );
    }
    const after = await prisma.providerServiceListing.count({ where: { domain } });
    assert(
      after === before,
      `${domain}：本地台账行数不变（零写入）`,
      `${before} → ${after}`,
    );
  }
} finally {
  for (const item of created) {
    await api("DELETE", `/enterprise/services/${item.id}`, null, item.user);
  }
  const left = await prisma.providerServiceListing.count({
    where: { title: { startsWith: "verify 服务发布门控" } },
  });
  log("清理：验证数据已归零", left === 0, `残留 ${left} 条`);
  await prisma.$disconnect();
}

const { passed, failed } = suite.counts();
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
