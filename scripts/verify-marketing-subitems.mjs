/**
 * 营销服务细项（与跨境出海同构）后端口径验证：
 * 备案必填细项 → 平台逐项审核 → 名录按细项分区 → 按细项独立签约（一细项一生效签约）→ 职员按细项挂靠。
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）。
 */
import { assertChannelOff } from "./regression-guard.mjs";
import { createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);

/** 本次新建的营销备案机构名（跑完清理，不留在名录里）。 */
const ORG = `E2E营销细项测试机构`;
/** 报名细项：直播带货 通过、内容营销 通过、私域营销 不通过。 */
const APPLIED = ["LIVE_SELLING", "CONTENT_MARKETING", "PRIVATE_DOMAIN"];
const APPROVED_ITEMS = ["LIVE_SELLING", "CONTENT_MARKETING"];

(async () => {
  const me0 = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  const existing = (me0.data?.data?.items || []).find(
    (item) => item.providerType === "MARKETING" && ["PENDING", "APPROVED"].includes(item.status),
  );
  if (existing) {
    await api("DELETE", `/enterprise/identity/provider-application/${existing.id}`, null, "demo_user");
  }
  assert(!existing, "前置：demo_user 无 MARKETING 备案行", existing ? `清理 id=${existing.id}` : "");

  console.log("1. 备案必填细项（MARKETING 与 EXPORT_REFUND 同构）");
  const bare = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_types: ["MARKETING"],
      org_name: ORG,
      // 所在省、市备案提交必填（需求文档 1.4 条目 69）
      province: "浙江省",
      city: "杭州市",
      uscc: "91310000E2M000001",
      contact_name: "测试联系人",
      contact_phone: "13800007777",
      contact_email: "mkt@demo.local",
      intro: "营销细项验证",
    },
    "demo_user",
  );
  assert(
    bare.data?.code !== 0 && /细项/.test(bare.data?.message || ""),
    "未勾选细项被拒",
    bare.data?.message,
  );
  const chinese = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_types: ["MARKETING"],
      service_items: { MARKETING: ["达人探店"] },
      org_name: ORG,
      // 所在省、市备案提交必填（需求文档 1.4 条目 69）
      province: "浙江省",
      city: "杭州市",
      uscc: "91310000E2M000001",
      contact_name: "测试联系人",
      contact_phone: "13800007777",
      contact_email: "mkt@demo.local",
      intro: "营销细项验证",
    },
    "demo_user",
  );
  assert(
    chinese.data?.code !== 0 && /细项/.test(chinese.data?.message || ""),
    "裸中文细项被拒（只认 code）",
    chinese.data?.message,
  );
  const unknown = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_types: ["MARKETING"],
      service_items: { MARKETING: ["LIVE_SELLING", "达人孵化"] },
      org_name: ORG,
      // 所在省、市备案提交必填（需求文档 1.4 条目 69）
      province: "浙江省",
      city: "杭州市",
      uscc: "91310000E2M000001",
      contact_name: "测试联系人",
      contact_phone: "13800007777",
      contact_email: "mkt@demo.local",
      intro: "营销细项验证",
    },
    "demo_user",
  );
  assert(unknown.data?.code !== 0, "不属于营销六项的 code 被拒", unknown.data?.message);
  const crossDomain = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_types: ["MARKETING"],
      service_items: { MARKETING: ["COMPANY_REG"] },
      org_name: ORG,
      // 所在省、市备案提交必填（需求文档 1.4 条目 69）
      province: "浙江省",
      city: "杭州市",
      uscc: "91310000E2M000001",
      contact_name: "测试联系人",
      contact_phone: "13800007777",
      contact_email: "mkt@demo.local",
      intro: "营销细项验证",
    },
    "demo_user",
  );
  assert(
    crossDomain.data?.code !== 0,
    "出海细项不能填进营销备案行（细项不跨类目）",
    crossDomain.data?.message,
  );

  console.log("2. 细项对象形式提交并落库");
  const apply = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_types: ["MARKETING"],
      service_items: { MARKETING: APPLIED },
      org_name: ORG,
      // 所在省、市备案提交必填（需求文档 1.4 条目 69）
      province: "浙江省",
      city: "杭州市",
      uscc: "91310000E2M000001",
      contact_name: "测试联系人",
      contact_phone: "13800007777",
      contact_email: "mkt@demo.local",
      intro: "营销细项验证",
    },
    "demo_user",
  );
  assert(apply.data?.code === 0, "勾选 3 项细项提交成功", apply.data?.message);
  const appId = apply.data?.data?.id;
  const pending = await api(
    "GET",
    "/enterprise/admin/provider-applications?status=PENDING",
    null,
    "admin",
  );
  const row = (pending.data?.data || []).find((item) => item.id === appId);
  assert(!!row, "管理后台可见该待审备案行");
  assert(
    String(row?.serviceItems || "") === APPLIED.join(","),
    "serviceItems 按报名 code 落库",
    row?.serviceItems,
  );

  console.log("3. 平台逐项审核");
  const noDecision = await api(
    "POST",
    `/enterprise/admin/provider-applications/${appId}/audit`,
    { action: "APPROVE" },
    "admin",
  );
  assert(
    noDecision.data?.code !== 0 && /逐项审核/.test(noDecision.data?.message || ""),
    "缺逐项结论时不允许通过",
    noDecision.data?.message,
  );
  const audit = await api(
    "POST",
    `/enterprise/admin/provider-applications/${appId}/audit`,
    {
      action: "APPROVE",
      items: APPLIED.map((item) => ({
        item,
        status: APPROVED_ITEMS.includes(item) ? "APPROVE" : "REJECT",
        note: APPROVED_ITEMS.includes(item) ? "" : "缺少该细项资质",
      })),
    },
    "admin",
  );
  assert(audit.data?.code === 0, "逐项审核提交成功", audit.data?.message);
  const afterAudit = await api(
    "GET",
    "/enterprise/identity/provider-application",
    null,
    "demo_user",
  );
  const approvedRow = (afterAudit.data?.data?.items || []).find(
    (item) => item.id === appId,
  );
  assert(
    approvedRow?.status === "APPROVED",
    "有通过项 → 整体 APPROVED",
    approvedRow?.status,
  );
  assert(
    String(approvedRow?.serviceItems || "") === APPROVED_ITEMS.join(","),
    "serviceItems 收窄为通过项（不通过项不生效）",
    approvedRow?.serviceItems,
  );
  const audits = Array.isArray(approvedRow?.itemAudits) ? approvedRow.itemAudits : [];
  assert(audits.length === 3, "itemAudits 保留 3 条结论", JSON.stringify(audits));
  assert(
    audits.find((i) => i.item === "PRIVATE_DOMAIN")?.status === "REJECTED",
    "私域营销结论为 REJECTED",
    JSON.stringify(audits.find((i) => i.item === "PRIVATE_DOMAIN")),
  );
  assert(
    audits.every((i) => /[\u4e00-\u9fa5]/.test(String(i.label || ""))),
    "结论带中文标签（无裸枚举）",
    audits.map((i) => i.label).join(","),
  );

  console.log("4. 名录按细项分区");
  async function directory(type) {
    const res = await api(
      "GET",
      `/enterprise/contracts/providers?serviceType=${type}`,
      null,
      "demo_enterprise",
    );
    return (res.data?.data || []).map((item) => item.providerUserId);
  }
  const live = await directory("LIVE_SELLING");
  const content = await directory("CONTENT_MARKETING");
  const privateDomain = await directory("PRIVATE_DOMAIN");
  const geo = await directory("GEO_OPTIMIZATION");
  assert(live.includes(users.demo_user.userId), "直播带货分区含新通过细项的服务商");
  assert(content.includes(users.demo_user.userId), "内容营销分区含同一服务商");
  assert(!privateDomain.includes(users.demo_user.userId), "私域营销分区不含未通过细项");
  assert(!geo.includes(users.demo_user.userId), "未报名的 GEO优化分区不含该服务商");
  const influencer = await directory("INFLUENCER_VISIT");
  assert(
    influencer.includes(users.demo_marketing.userId) &&
      !influencer.includes(users.demo_marketing2.userId),
    "种子数据按细项归位（星链传媒在达人探店、云播 MCN 不在）",
    `达人探店=${influencer.length} 家`,
  );
  const geoSeeded = await directory("GEO_OPTIMIZATION");
  assert(
    !geoSeeded.includes(users.demo_marketing.userId),
    "云播 MCN 的「达人孵化」自由文本未被猜成任何细项",
  );
  assert(
    geoSeeded.includes(users.demo_all.userId),
    "全类目演示账号（万象综合服务）六个细项齐全，出现在 GEO优化分区",
    `GEO优化=${geoSeeded.length} 家`,
  );
  const precision = await directory("PRECISION_MARKETING");
  assert(
    precision.includes(users.demo_all.userId) &&
      !precision.includes(users.demo_marketing.userId) &&
      !precision.includes(users.demo_marketing2.userId),
    "精准营销分区只有细项通过的机构",
    `精准营销=${precision.length} 家`,
  );

  console.log("5. 按细项独立签约");
  const bareType = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "MARKETING" },
    "demo_enterprise",
  );
  assert(
    bareType.data?.code !== 0 && /分类不合法/.test(bareType.data?.message || ""),
    "裸 MARKETING 不可签约（只在细项级）",
    bareType.data?.message,
  );
  const notAccepted = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "PRIVATE_DOMAIN" },
    "demo_enterprise",
  );
  assert(
    notAccepted.data?.code !== 0 && /不承接/.test(notAccepted.data?.message || ""),
    "未通过细项不可签约",
    notAccepted.data?.message,
  );
  const listBefore = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  const liveDup = (listBefore.data?.data || []).some(
    (item) =>
      item.serviceType === "LIVE_SELLING" &&
      ["PENDING", "ACTIVE"].includes(item.status),
  );
  const created = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "LIVE_SELLING" },
    "demo_enterprise",
  );
  if (liveDup) {
    assert(
      created.data?.code !== 0 && /解约后才能再次发起/.test(created.data?.message || ""),
      "一细项一生效签约（存量直播带货签约挡第二条）",
      created.data?.message,
    );
  } else {
    assert(created.data?.code === 0, "按直播带货细项发起签约", created.data?.message);
  }
  const contractId = created.data?.data?.id;
  const sameProvider = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "LIVE_SELLING" },
    "demo_enterprise",
  );
  assert(
    sameProvider.data?.code !== 0,
    "同服务商同细项重复发起被拒",
    sameProvider.data?.message,
  );
  const secondProvider = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_marketing2.userId, service_type: "LIVE_SELLING" },
    "demo_enterprise",
  );
  assert(
    !liveDup
      ? secondProvider.data?.code !== 0 &&
          /解约后才能再次发起/.test(secondProvider.data?.message || "")
      : secondProvider.data?.code !== 0,
    "直播带货独占：一家企业同一细项只留 1 家服务商",
    secondProvider.data?.message,
  );
  const contentCreated = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "CONTENT_MARKETING" },
    "demo_enterprise",
  );
  assert(
    contentCreated.data?.code === 0,
    "不同细项各自独立签约不受独占限制",
    contentCreated.data?.message,
  );

  console.log("6. 职员按细项挂靠");
  const roles = await api("GET", "/enterprise/staff/roles", null, "demo_user");
  const roleRows = roles.data?.data || [];
  const codes = roleRows.map((item) => item.code);
  assert(roleRows.length > 0, "角色选项非空", JSON.stringify(roles.data).slice(0, 200));
  assert(
    codes.includes("LIVE_SELLING") && codes.includes("CONTENT_MARKETING"),
    "已生效细项进角色选项（直播带货 / 内容营销）",
    codes.join(","),
  );
  assert(
    !codes.includes("PRIVATE_DOMAIN"),
    "未通过细项不进角色选项",
  );
  const liveRole = roleRows.find((item) => item.code === "LIVE_SELLING");
  assert(
    liveRole?.category === "营销服务 · 直播带货" &&
      liveRole?.role === "直播带货专员",
    "角色分组为中文「营销服务 · 直播带货」",
    JSON.stringify(liveRole),
  );
  assert(
    roleRows.every((item) => /[一-龥]/.test(String(item.category || ""))),
    "挂靠类目全中文（无裸枚举）",
    roleRows.map((item) => item.category).join(" / "),
  );
  const seededRoles = await api("GET", "/enterprise/staff/roles", null, "demo_marketing");
  assert(
    (seededRoles.data?.data || [])
      .map((item) => item.code)
      .join(",") === "INFLUENCER_VISIT,LIVE_SELLING,CONTENT_MARKETING",
    "存量营销服务商按归一后的细项给出挂靠角色",
    (seededRoles.data?.data || []).map((item) => `${item.category}=${item.code}`).join(" / "),
  );

  console.log("7. 清理本次验证数据");
  for (const id of [contractId, contentCreated.data?.data?.id]) {
    if (!id) continue;
    const off = await api("POST", `/enterprise/contracts/${id}/terminate`, null, "demo_enterprise");
    assert(off.data?.code === 0, `解约测试签约 #${id}`, off.data?.message);
  }
  const del = await api(
    "DELETE",
    `/enterprise/identity/provider-application/${appId}`,
    null,
    "demo_user",
  );
  assert(del.data?.code === 0, "删除测试备案行", del.data?.message);
  const afterDelete = await directory("LIVE_SELLING");
  assert(
    !afterDelete.includes(users.demo_user.userId),
    "清理后名录分区不再含测试机构",
  );

  const { passed, failed } = suite.counts();
  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("验证脚本异常：", err?.message || err);
  process.exit(1);
});
