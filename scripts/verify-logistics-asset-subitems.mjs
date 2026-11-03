/**
 * 物流 3 细项 / 资产交易 5 细项（与出海、营销同构）后端口径验证：
 * 备案必填细项 → 平台逐项审核 → 名录按细项分区 → 按细项独立签约 → 职员按细项挂靠。
 * 与营销的差异点一并验证：
 *  - 物流细项有两个承载备案行（LOGISTICS 物流服务商 / MICRO 小微服务商），任一行生效即可；
 *  - 物流按细项各签、**不限家数**；资产细项**一细项一家**（独占）；
 *  - 存量「未勾细项」的承载行不允许直接通过（须驳回补勾）。
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）。跑完自行清理，不留副作用。
 */
import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

/** 本次新建的物流备案机构名（跑完清理，不留在名录里）。 */
const ORG = "E2E物流细项测试机构";
const LEGACY_ORG = "E2E存量无细项物流机构";
/** 报名细项：境内陆运 + 仓储 通过、跨境货代 不通过。 */
const APPLIED = ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER", "WAREHOUSING"];
const APPROVED_ITEMS = ["DOMESTIC_LAND", "WAREHOUSING"];

/** 备案提交的公共字段（主体信息对断言无意义，只补齐必填）。 */
function applyBody(extra) {
  return {
    org_name: ORG,
    uscc: "91310000E2L000001",
    contact_name: "测试联系人",
    contact_phone: "13800008888",
    contact_email: "log@demo.local",
    intro: "物流与资产细项验证",
    // 所在省、市备案提交必填（需求文档 1.4 条目 69）
    province: "浙江省",
    city: "杭州市",
    ...extra,
  };
}

(async () => {
  // 前置：清掉 demo_user 可能残留的 LOGISTICS 备案行与测试签约，保证每条断言只有一个期望值
  const me0 = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  for (const item of me0.data?.data?.items || []) {
    if (item.providerType !== "LOGISTICS") continue;
    if (!["PENDING", "APPROVED"].includes(item.status)) continue;
    await api("DELETE", `/enterprise/identity/provider-application/${item.id}`, null, "demo_user");
  }
  const contractsBefore = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  for (const item of contractsBefore.data?.data || []) {
    if (![...APPLIED, "REAL_ESTATE", "INVESTMENT"].includes(item.serviceType)) continue;
    if (!["PENDING", "ACTIVE"].includes(item.status)) continue;
    await api("POST", `/enterprise/contracts/${item.id}/terminate`, null, "demo_enterprise");
  }
  const cleanApps = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  assert(
    !(cleanApps.data?.data?.items || []).some((i) => i.providerType === "LOGISTICS"),
    "前置：demo_user 无 LOGISTICS 备案行",
  );
  const cleanContracts = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  assert(
    !(cleanContracts.data?.data || []).some(
      (i) =>
        [...APPLIED, "REAL_ESTATE", "INVESTMENT"].includes(i.serviceType) &&
        ["PENDING", "ACTIVE"].includes(i.status),
    ),
    "前置：测试细项无未终结签约",
  );

  console.log("1. 备案必填细项（LOGISTICS / MICRO / ASSET_TRADE 与出海营销同构）");
  const bare = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["LOGISTICS"] }),
    "demo_user",
  );
  assert(
    bare.data?.code !== 0 && /细项/.test(bare.data?.message || ""),
    "物流未勾选细项被拒",
    bare.data?.message,
  );
  const bareAsset = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["ASSET_TRADE"] }),
    "demo_user",
  );
  assert(
    bareAsset.data?.code !== 0 && /细项/.test(bareAsset.data?.message || ""),
    "资产交易未勾选细项被拒",
    bareAsset.data?.message,
  );
  const bareMicro = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["LOGISTICS", "MICRO"], uscc: "91310000E2L000002" }),
    "demo_user",
  );
  assert(
    bareMicro.data?.code !== 0 && /小微|细项/.test(bareMicro.data?.message || ""),
    "小微备案同样必须勾细项",
    bareMicro.data?.message,
  );
  const chinese = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["LOGISTICS"], service_items: { LOGISTICS: ["境内陆运"] } }),
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
    applyBody({ provider_types: ["LOGISTICS"], service_items: { LOGISTICS: ["DOMESTIC_LAND", "冷链干线"] } }),
    "demo_user",
  );
  assert(unknown.data?.code !== 0, "不属于物流三项的 code 被拒", unknown.data?.message);
  const crossDomain = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["LOGISTICS"], service_items: { LOGISTICS: ["REAL_ESTATE"] } }),
    "demo_user",
  );
  assert(
    crossDomain.data?.code !== 0,
    "资产细项不能填进物流备案行（细项不跨类目）",
    crossDomain.data?.message,
  );
  const crossBack = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["ASSET_TRADE"], service_items: { ASSET_TRADE: ["DOMESTIC_LAND"] } }),
    "demo_user",
  );
  assert(
    crossBack.data?.code !== 0,
    "物流细项不能填进资产备案行",
    crossBack.data?.message,
  );

  console.log("2. 细项落库与平台逐项审核");
  const apply = await api(
    "POST",
    "/enterprise/identity/provider-application",
    applyBody({ provider_types: ["LOGISTICS"], service_items: { LOGISTICS: APPLIED } }),
    "demo_user",
  );
  assert(apply.data?.code === 0, "物流备案勾选三项细项提交成功", apply.data?.message);
  const appId = apply.data?.data?.id;
  const pending = await api("GET", "/enterprise/admin/provider-applications?status=PENDING", null, "admin");
  const row = (pending.data?.data || []).find((item) => item.id === appId);
  assert(!!row, "管理后台可见该待审备案行");
  assert(
    String(row?.serviceItems || "") === APPLIED.join(","),
    "serviceItems 按报名 code 落库",
    row?.serviceItems,
  );
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
        note: APPROVED_ITEMS.includes(item) ? "" : "缺少跨境运输资质",
      })),
    },
    "admin",
  );
  assert(audit.data?.code === 0, "物流细项逐项审核提交成功", audit.data?.message);
  const afterAudit = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  const approvedRow = (afterAudit.data?.data?.items || []).find((item) => item.id === appId);
  assert(approvedRow?.status === "APPROVED", "有通过项 → 整体 APPROVED", approvedRow?.status);
  assert(
    String(approvedRow?.serviceItems || "") === APPROVED_ITEMS.join(","),
    "serviceItems 收窄为通过项（跨境货代不生效）",
    approvedRow?.serviceItems,
  );
  const audits = Array.isArray(approvedRow?.itemAudits) ? approvedRow.itemAudits : [];
  assert(audits.length === 3, "itemAudits 保留 3 条结论", JSON.stringify(audits));
  assert(
    audits.find((i) => i.item === "CROSS_BORDER_FORWARDER")?.status === "REJECTED",
    "跨境货代结论为 REJECTED",
    JSON.stringify(audits.find((i) => i.item === "CROSS_BORDER_FORWARDER")),
  );
  assert(
    audits.every((i) => /[\u4e00-\u9fa5]/.test(String(i.label || ""))),
    "结论带中文标签（无裸枚举）",
    audits.map((i) => i.label).join(","),
  );

  console.log("3. 存量「未勾细项」承载行不允许直接通过");
  const legacy = await prisma.providerApplication.create({
    data: {
      userId: users.demo_user.userId,
      providerType: "ASSET_TRADE",
      orgName: LEGACY_ORG,
      uscc: "91310000E2L000003",
      intro: "存量无细项备案行（归一前数据）",
      serviceItems: "",
    },
  });
  const legacyApprove = await api(
    "POST",
    `/enterprise/admin/provider-applications/${legacy.id}/audit`,
    { action: "APPROVE" },
    "admin",
  );
  assert(
    legacyApprove.data?.code !== 0 && /未勾选/.test(legacyApprove.data?.message || ""),
    "空细项行通过被拒（须驳回补勾，不能静默全驳）",
    legacyApprove.data?.message,
  );
  const legacyReject = await api(
    "POST",
    `/enterprise/admin/provider-applications/${legacy.id}/audit`,
    { action: "REJECT", note: "请补充承接的资产细项" },
    "admin",
  );
  assert(legacyReject.data?.code === 0, "空细项行仍可驳回", legacyReject.data?.message);

  console.log("4. 名录按细项分区（物流细项双承载行）");
  async function directory(type) {
    const res = await api("GET", `/enterprise/contracts/providers?serviceType=${type}`, null, "demo_enterprise");
    return (res.data?.data || []).map((item) => item.providerUserId);
  }
  const land = await directory("DOMESTIC_LAND");
  const forwarder = await directory("CROSS_BORDER_FORWARDER");
  const warehouse = await directory("WAREHOUSING");
  assert(land.includes(users.demo_user.userId), "境内陆运分区含新通过细项的服务商");
  assert(
    warehouse.includes(users.demo_user.userId),
    "仓储分区含新通过细项的服务商（新增细项同走细项化口径）",
  );
  assert(
    land.filter((id) => id === users.demo_user.userId).length === 1,
    "同一服务商在分区内只出现一次（多承载行去重）",
    `出现 ${land.filter((id) => id === users.demo_user.userId).length} 次`,
  );
  assert(!forwarder.includes(users.demo_user.userId), "跨境货代分区不含未通过细项");
  assert(
    land.includes(users.demo_all.userId),
    "承载行＝LOGISTICS 的服务商（万象综合服务）在境内陆运分区",
    `境内陆运=${land.length} 家`,
  );
  assert(
    land.includes(users.demo_logistics.userId) &&
      forwarder.includes(users.demo_logistics.userId) &&
      warehouse.includes(users.demo_logistics.userId),
    "承载行＝MICRO 的小微服务商三项细项齐全，三个分区都在",
  );
  assert(
    warehouse.includes(users.demo_all.userId),
    "承载行＝LOGISTICS 的服务商（万象综合服务）在仓储分区",
    `仓储=${warehouse.length} 家`,
  );
  assert(
    !land.includes(users.demo_marketing.userId),
    "未备案物流的服务商不进物流分区",
  );
  const realEstate = await directory("REAL_ESTATE");
  const autoTrade = await directory("AUTO_TRADE");
  assert(
    realEstate.includes(users.demo_asset.userId) && realEstate.includes(users.demo_provider.userId),
    "房产销售/租赁分区含两家资产服务商（承载行＝ASSET_TRADE）",
    `房产=${realEstate.length} 家`,
  );
  assert(autoTrade.includes(users.demo_asset.userId), "汽车交易分区含细项齐全的资产服务商");
  assert(
    !realEstate.includes(users.demo_logistics.userId),
    "物流服务商不进资产分区",
  );

  console.log("5. 按细项独立签约（物流不限家数 / 资产一细项一家）");
  const bareLogisticsSign = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "LOGISTICS" },
    "demo_enterprise",
  );
  assert(
    bareLogisticsSign.data?.code !== 0 && /分类不合法/.test(bareLogisticsSign.data?.message || ""),
    "裸 LOGISTICS 不再是签约单位（只在细项级）",
    bareLogisticsSign.data?.message,
  );
  const bareAssetSign = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_asset.userId, service_type: "ASSET_TRADE" },
    "demo_enterprise",
  );
  assert(
    bareAssetSign.data?.code !== 0 && /分类不合法/.test(bareAssetSign.data?.message || ""),
    "裸 ASSET_TRADE 不可签约（只在细项级）",
    bareAssetSign.data?.message,
  );
  const notAccepted = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "CROSS_BORDER_FORWARDER" },
    "demo_enterprise",
  );
  assert(
    notAccepted.data?.code !== 0 && /不承接/.test(notAccepted.data?.message || ""),
    "未通过细项不可签约",
    notAccepted.data?.message,
  );
  const first = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "DOMESTIC_LAND" },
    "demo_enterprise",
  );
  assert(first.data?.code === 0, "按境内陆运细项发起签约", first.data?.message);
  const secondProvider = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_logistics2.userId, service_type: "DOMESTIC_LAND" },
    "demo_enterprise",
  );
  assert(
    secondProvider.data?.code === 0,
    "同一细项可再签第二家服务商（物流不限家数）",
    secondProvider.data?.message,
  );
  const dup = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_user.userId, service_type: "DOMESTIC_LAND" },
    "demo_enterprise",
  );
  assert(dup.data?.code !== 0, "同服务商同细项重复发起被拒", dup.data?.message);
  const assetFirst = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_asset.userId, service_type: "REAL_ESTATE" },
    "demo_enterprise",
  );
  assert(assetFirst.data?.code === 0, "按房产销售/租赁细项发起签约", assetFirst.data?.message);
  const assetSecondProvider = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_provider.userId, service_type: "REAL_ESTATE" },
    "demo_enterprise",
  );
  assert(
    assetSecondProvider.data?.code !== 0 &&
      /解约后才能再次发起/.test(assetSecondProvider.data?.message || ""),
    "资产细项独占：一家企业同一细项只留 1 家服务商",
    assetSecondProvider.data?.message,
  );
  const assetOtherItem = await api(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_asset.userId, service_type: "INVESTMENT" },
    "demo_enterprise",
  );
  assert(
    assetOtherItem.data?.code === 0,
    "不同资产细项各自独立签约不受独占限制",
    assetOtherItem.data?.message,
  );

  console.log("6. 职员按细项挂靠");
  const roles = await api("GET", "/enterprise/staff/roles", null, "demo_user");
  const roleRows = roles.data?.data || [];
  const codes = roleRows.map((item) => item.code);
  assert(
    codes.includes("DOMESTIC_LAND"),
    "已生效细项进角色选项（境内陆运）",
    codes.join(","),
  );
  assert(!codes.includes("CROSS_BORDER_FORWARDER"), "未通过细项不进角色选项");
  const landRole = roleRows.find((item) => item.code === "DOMESTIC_LAND");
  assert(
    landRole?.category === "物流服务 · 境内陆运" && landRole?.role === "境内陆运专员",
    "角色分组为中文「物流服务 · 境内陆运」",
    JSON.stringify(landRole),
  );
  const warehouseRole = roleRows.find((item) => item.code === "WAREHOUSING");
  assert(
    warehouseRole?.category === "物流服务 · 仓储" && warehouseRole?.role === "仓储专员",
    "已生效的仓储细项进角色选项，分组「物流服务 · 仓储」",
    JSON.stringify(warehouseRole),
  );
  assert(
    roleRows.every((item) => /[一-龥]/.test(String(item.category || ""))),
    "挂靠类目全中文（无裸枚举）",
    roleRows.map((item) => item.category).join(" / "),
  );
  const assetRoles = await api("GET", "/enterprise/staff/roles", null, "demo_asset");
  const assetCodes = (assetRoles.data?.data || []).map((item) => item.code);
  assert(
    ["REAL_ESTATE", "INSURANCE", "INVESTMENT", "NON_PERFORMING_ASSET", "AUTO_TRADE"].every((code) =>
      assetCodes.includes(code),
    ),
    "资产服务商给出 5 个细项挂靠角色",
    (assetRoles.data?.data || []).map((item) => `${item.category}=${item.code}`).join(" / "),
  );
  const realEstateRole = (assetRoles.data?.data || []).find((item) => item.code === "REAL_ESTATE");
  assert(
    realEstateRole?.category === "资产交易 · 房产销售/租赁" && realEstateRole?.role === "房产交易专员",
    "资产角色分组为中文「资产交易 · 房产销售/租赁」",
    JSON.stringify(realEstateRole),
  );
  const microRoles = await api("GET", "/enterprise/staff/roles", null, "demo_supply2");
  const microCodes = (microRoles.data?.data || []).map((item) => item.code);
  assert(
    microCodes.includes("DOMESTIC_LAND") && microCodes.includes("CROSS_BORDER_FORWARDER"),
    "小微服务商（MICRO 承载行）归一后可按物流细项挂靠职员",
    microCodes.join(","),
  );

  console.log("7. 清理本次验证数据");
  for (const id of [
    first.data?.data?.id,
    secondProvider.data?.data?.id,
    assetFirst.data?.data?.id,
    assetOtherItem.data?.data?.id,
  ]) {
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
  assert(del.data?.code === 0, "删除测试物流备案行", del.data?.message);
  await prisma.providerApplication.delete({ where: { id: legacy.id } });
  assert(
    (await prisma.providerApplication.count({ where: { id: legacy.id } })) === 0,
    "删除存量无细项测试备案行",
    `id=${legacy.id}`,
  );
  const afterDelete = await directory("DOMESTIC_LAND");
  assert(!afterDelete.includes(users.demo_user.userId), "清理后名录分区不再含测试机构");
  const finalContracts = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  assert(
    !(finalContracts.data?.data || []).some(
      (i) =>
        [...APPLIED, "REAL_ESTATE", "INVESTMENT"].includes(i.serviceType) &&
        ["PENDING", "ACTIVE"].includes(i.status),
    ),
    "清理后无遗留测试签约",
  );

  await prisma.$disconnect();
  const { passed, failed } = suite.counts();
  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error("验证脚本异常：", err?.message || err);
  await prisma.$disconnect();
  process.exit(1);
});
