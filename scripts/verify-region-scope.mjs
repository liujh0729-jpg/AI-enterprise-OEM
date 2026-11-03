/**
 * 地域范围三模式实测（2026-09-25）
 *
 * 用户口径：「地域范围三模式适用于所有发布需求与所有发布服务」——
 *   不限制（NONE）/ 指定地区（REGION，省、市）/ 经纬度坐标（RADIUS，经度+纬度+半径），
 *   且**指定地区和经纬度都算「有省、市」**（经纬度按最近城市中心点解析出省、市），
 *   列表的省市筛选对两种模式同样生效。
 *
 * 覆盖：
 *   A. 七板块需求发布（物流/营销/IT服务/法律/知产/资产交易/灵活用工）三模式落库 + 筛选 + 编辑 + 异常 + 清理；
 *   B. 服务发布（SUPPLY）三模式：「不限制」在服务侧是平台值 NATIONWIDE，存量 REMOTE 归不限制；
 *   C. AIworkin 报文映射（demandGeoConfig / serviceAreaPayload）直接跑已构建的 dist；
 *   D. 界面同源：七个发布表单与服务发布表单都只用共享控件 RegionScopeFields（不再有自由文本「地域范围」）。
 *
 * 覆盖边界：A/B 打的是有本地临时表的七板块（这些表按 #227 下线）。财税 / 供销 / 出海自 2026-09-26 起
 * 平台直连、零落库，地域三模式在 `verify-market-board-direct.mjs` 实测（通道打开实例）：
 * 非法地域方式→报文 400、RADIUS 缺半径→报文 400、REGION 的省、市由平台 a2aConfig 读回并参与筛选。
 *
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）：
 *   node scripts/regression-instance.mjs -- node scripts/verify-region-scope.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertChannelOff } from "./regression-guard.mjs";
import { ROOT, createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, call, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

const ENTERPRISE = "demo_enterprise";
const PROVINCE = "浙江省";
const CITY = "宁波市";
// 宁波市区坐标：按最近城市中心点应解析成 浙江省 / 宁波市
const NINGBO = { longitude: "121.55", latitude: "29.87", radius_km: "30" };

/** 列表返回体两种形态（数组 / {list}）都归一成数组。 */
function rowsOf(payload) {
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

/**
 * 派生展示文案落在哪一列（七张需求表不完全同构）：
 * `regionScope` 是多数表的文案列，物流沿用 `origin`，法律/知产放在 `fields` JSON 里。
 */
const LABEL = { column: "column", json: "json" };

const MODULES = [
  {
    key: "物流",
    model: "logisticsOrder",
    path: "/enterprise/logistics",
    label: { kind: LABEL.column, field: "origin" },
    base: { title: "地域三模式实测（物流）", description: "脚本数据，跑完即删" },
  },
  {
    key: "营销",
    model: "marketingOrder",
    path: "/enterprise/marketing",
    label: { kind: LABEL.column, field: "regionScope" },
    base: { title: "地域三模式实测（营销）", order_type: "VISIT" },
  },
  {
    key: "IT服务",
    model: "smartServiceOrder",
    path: "/enterprise/smart",
    label: { kind: LABEL.column, field: "regionScope" },
    base: {
      title: "地域三模式实测（IT服务）",
      service_item: "SOFTWARE_DEV",
      description: "脚本数据，跑完即删",
    },
  },
  {
    key: "法律",
    model: "legalRequest",
    path: "/enterprise/legal/requests",
    label: { kind: LABEL.json, field: "fields" },
    base: { title: "地域三模式实测（法律）", category: "CONSULT" },
  },
  {
    key: "知产",
    model: "ipRequest",
    path: "/enterprise/ip/requests",
    label: { kind: LABEL.json, field: "fields" },
    base: { title: "地域三模式实测（知产）", category: "TRADEMARK" },
  },
  {
    key: "资产交易",
    model: "assetRequest",
    path: "/enterprise/asset",
    label: { kind: LABEL.column, field: "regionScope" },
    base: { title: "地域三模式实测（资产）", description: "脚本数据，跑完即删" },
  },
  {
    key: "灵活用工",
    model: "flexWorkOrder",
    path: "/enterprise/flex/work-orders",
    label: { kind: LABEL.column, field: "regionScope" },
    base: { title: "地域三模式实测（灵工）", work_type: "PARTTIME" },
  },
];

async function createdRow(mod, id) {
  return prisma[mod.model].findUnique({
    where: { id },
    select: {
      regionMode: true,
      province: true,
      city: true,
      longitude: true,
      latitude: true,
      radiusKm: true,
      [mod.label.field]: true,
    },
  });
}

/** 行内的「地域范围」展示文案（列 / fields JSON 两种存法）。 */
function labelOf(mod, row) {
  if (!row) return undefined;
  if (mod.label.kind === LABEL.json) {
    const fields = row[mod.label.field];
    return fields && typeof fields === "object"
      ? String(fields.region_scope ?? "")
      : "";
  }
  return String(row[mod.label.field] ?? "");
}

/** 逐板块：三模式落库 + 省市筛选 + 编辑切换 + 外部自由文本 + 非法模式。 */
async function checkDemandModule(mod) {
  const created = [];
  const keep = (payload) => {
    const id = payload.data?.id;
    if (id) created.push(id);
    return id;
  };

  // ① 指定地区
  const region = await call("POST", mod.path, ENTERPRISE, {
    ...mod.base,
    region_mode: "REGION",
    province: PROVINCE,
    city: CITY,
  });
  const regionId = keep(region);
  assert(region.code === 0 && regionId, `${mod.key}：发布「指定地区」需求`, region.message);
  const regionRow = regionId ? await createdRow(mod, regionId) : null;
  assert(
    regionRow?.regionMode === "REGION" &&
      regionRow.province === PROVINCE &&
      regionRow.city === CITY &&
      labelOf(mod, regionRow) === `${PROVINCE}${CITY}` &&
      regionRow.longitude === null,
    `${mod.key}：指定地区落库＝省市两列 + 派生文案，不带坐标`,
    JSON.stringify(regionRow),
  );

  const hit = rowsOf(
    await call("GET", `${mod.path}?province=${encodeURIComponent(PROVINCE)}&city=${encodeURIComponent(CITY)}`, ENTERPRISE),
  ).some((row) => row.id === regionId);
  log(`${mod.key}：省市筛选命中该行`, hit);
  const miss = rowsOf(
    await call(
      "GET",
      `${mod.path}?province=${encodeURIComponent("广东省")}&city=${encodeURIComponent("广州市")}`,
      ENTERPRISE,
    ),
  ).some((row) => row.id === regionId);
  log(
    `${mod.key}：换省市（广东省广州市）不命中`,
    !miss,
    miss ? "筛选没生效" : "",
  );

  // ② 经纬度坐标（省市由坐标解析）
  const radius = await call("POST", mod.path, ENTERPRISE, {
    ...mod.base,
    region_mode: "RADIUS",
    ...NINGBO,
  });
  const radiusId = keep(radius);
  assert(radius.code === 0 && radiusId, `${mod.key}：发布「经纬度坐标」需求`, radius.message);
  const radiusRow = radiusId ? await createdRow(mod, radiusId) : null;
  assert(
    radiusRow?.regionMode === "RADIUS" &&
      Number(radiusRow.longitude) === 121.55 &&
      Number(radiusRow.latitude) === 29.87 &&
      Number(radiusRow.radiusKm) === 30,
    `${mod.key}：坐标与半径入库`,
    JSON.stringify(radiusRow),
  );
  assert(
    radiusRow?.province === PROVINCE &&
      radiusRow?.city === CITY &&
      labelOf(mod, radiusRow).includes("半径 30 公里"),
    `${mod.key}：经纬度也算「有省、市」（按最近城市中心点解析）`,
    `${radiusRow?.province}${radiusRow?.city} / ${labelOf(mod, radiusRow)}`,
  );
  const radiusHit = rowsOf(
    await call("GET", `${mod.path}?province=${encodeURIComponent(PROVINCE)}&city=${encodeURIComponent(CITY)}`, ENTERPRISE),
  ).some((row) => row.id === radiusId);
  log(`${mod.key}：省市筛选对经纬度行同样生效`, radiusHit);

  // ③ 不限制（未带地域入参）
  const none = await call("POST", mod.path, ENTERPRISE, { ...mod.base });
  const noneId = keep(none);
  assert(none.code === 0 && noneId, `${mod.key}：未带地域入参也可发布`, none.message);
  const noneRow = noneId ? await createdRow(mod, noneId) : null;
  assert(
    noneRow?.regionMode === "NONE" &&
      noneRow.province === "" &&
      noneRow.city === "" &&
      labelOf(mod, noneRow) === "不限制",
    `${mod.key}：默认「不限制」，省市留空`,
    JSON.stringify(noneRow),
  );

  // ④ 编辑：指定地区 → 不限制（省市必须清空）
  const edit = await call(
    "PATCH",
    `${mod.path}/${noneId}`,
    ENTERPRISE,
    { region_mode: "REGION", province: PROVINCE, city: CITY },
  );
  const edited = await createdRow(mod, noneId);
  assert(
    edit.code === 0 &&
      edited.regionMode === "REGION" &&
      edited.city === CITY,
    `${mod.key}：编辑改为「指定地区」并写入省市`,
    JSON.stringify(edited),
  );
  const back = await call("PATCH", `${mod.path}/${noneId}`, ENTERPRISE, {
    region_mode: "NONE",
  });
  const cleared = await createdRow(mod, noneId);
  assert(
    back.code === 0 &&
      cleared.regionMode === "NONE" &&
      cleared.province === "" &&
      cleared.city === "" &&
      cleared.radiusKm === null,
    `${mod.key}：切回「不限制」时省市与坐标全部清空`,
    JSON.stringify(cleared),
  );

  // ⑤ 外部接口只给自由文本：按「不限制 + 原文案」存，不报错也不猜省市
  const legacy = await call("PATCH", `${mod.path}/${noneId}`, ENTERPRISE, {
    region_scope: "长三角区域",
  });
  const legacyRow = await createdRow(mod, noneId);
  assert(
    legacy.code === 0 &&
      legacyRow.regionMode === "NONE" &&
      labelOf(mod, legacyRow) === "长三角区域" &&
      legacyRow.province === "",
    `${mod.key}：外部只传 region_scope 时按「不限制 + 原文案」存`,
    JSON.stringify(legacyRow),
  );

  // ⑥ 非法三态必须报错（不是静默按不限制）
  const bad = await call("POST", mod.path, ENTERPRISE, {
    ...mod.base,
    region_mode: "AREA",
  });
  assert(
    bad.code === 400 && String(bad.message).includes("地域范围"),
    `${mod.key}：非法地域范围取值报 400`,
    `${bad.code} ${bad.message}`,
  );
  const badRegion = await call("POST", mod.path, ENTERPRISE, {
    ...mod.base,
    region_mode: "REGION",
    province: PROVINCE,
  });
  assert(
    badRegion.code === 400 && String(badRegion.message).includes("城市"),
    `${mod.key}：「指定地区」缺城市报 400`,
    `${badRegion.code} ${badRegion.message}`,
  );
  const badRadius = await call("POST", mod.path, ENTERPRISE, {
    ...mod.base,
    region_mode: "RADIUS",
    longitude: NINGBO.longitude,
    latitude: NINGBO.latitude,
  });
  assert(
    badRadius.code === 400 && String(badRadius.message).includes("半径"),
    `${mod.key}：「经纬度坐标」缺半径报 400`,
    `${badRadius.code} ${badRadius.message}`,
  );

  for (const id of created) {
    await call("DELETE", `${mod.path}/${id}`, ENTERPRISE);
  }
  const left = await prisma[mod.model].count({ where: { id: { in: created } } });
  log(`${mod.key}：实测数据自清（${created.length} 条）`, left === 0, `残留 ${left} 条`);
}

/** 服务发布（SUPPLY）三模式。 */
async function checkServicePublish() {
  const created = [];
  const post = async (name, body) => {
    const payload = await call("POST", "/enterprise/services", ENTERPRISE, {
      domain: "ASSET",
      title: `地域三模式实测（服务·${name}）`,
      description: "脚本数据，跑完即删",
      money_mode: "FIXED",
      amount_min: 100,
      unit_label: "次",
      price_description: "按次计价",
      publish_action: "DRAFT",
      ...body,
    });
    const id = payload.data?.id;
    if (id) created.push(id);
    return payload;
  };
  const rowOf = (id) =>
    prisma.providerServiceListing.findUnique({
      where: { id },
      select: {
        serviceAreaMode: true,
        province: true,
        city: true,
        longitude: true,
        latitude: true,
        radiusKm: true,
      },
    });

  const nation = await post("不限制", { service_area_mode: "NATIONWIDE" });
  assert(nation.code === 0 && nation.data?.id, "服务发布：「不限制」可提交", nation.message);
  const nationRow = nation.data?.id ? await rowOf(nation.data.id) : null;
  assert(
    nationRow?.serviceAreaMode === "NATIONWIDE" &&
      nationRow.province === "" &&
      nationRow.city === "",
    "服务发布：不限制不带省市",
    JSON.stringify(nationRow),
  );

  const region = await post("指定地区", {
    service_area_mode: "REGION",
    province: PROVINCE,
    city: CITY,
  });
  const regionRow = region.data?.id ? await rowOf(region.data.id) : null;
  assert(
    region.code === 0 &&
      regionRow?.serviceAreaMode === "REGION" &&
      regionRow.province === PROVINCE &&
      regionRow.city === CITY,
    "服务发布：指定地区写入省市",
    JSON.stringify(regionRow),
  );

  const radius = await post("经纬度", {
    service_area_mode: "RADIUS",
    ...NINGBO,
  });
  const radiusRow = radius.data?.id ? await rowOf(radius.data.id) : null;
  assert(
    radius.code === 0 &&
      radiusRow?.serviceAreaMode === "RADIUS" &&
      Number(radiusRow.longitude) === 121.55 &&
      Number(radiusRow.radiusKm) === 30 &&
      radiusRow.province === PROVINCE &&
      radiusRow.city === CITY,
    "服务发布：经纬度模式与需求侧同一套解析（省市自动带出）",
    JSON.stringify(radiusRow),
  );

  const legacyRemote = await post("存量远程", { service_area_mode: "REMOTE" });
  const remoteRow = legacyRemote.data?.id
    ? await rowOf(legacyRemote.data.id)
    : null;
  assert(
    legacyRemote.code === 0 &&
      remoteRow?.serviceAreaMode === "REMOTE" &&
      remoteRow.province === "" &&
      remoteRow.city === "",
    "服务发布：存量 REMOTE 仍入库但归「不限制」（不带省市）",
    JSON.stringify(remoteRow),
  );

  const badRegion = await post("缺城市", {
    service_area_mode: "REGION",
    province: PROVINCE,
  });
  assert(
    badRegion.code === 400 && String(badRegion.message).includes("城市"),
    "服务发布：指定地区缺城市报 400",
    `${badRegion.code} ${badRegion.message}`,
  );

  const edited = created[0]
    ? await call("PATCH", `/enterprise/services/${created[0]}`, ENTERPRISE, {
        service_area_mode: "REGION",
        province: PROVINCE,
        city: CITY,
      })
    : {};
  const editedRow = created[0] ? await rowOf(created[0]) : null;
  assert(
    edited.code === 0 &&
      editedRow?.serviceAreaMode === "REGION" &&
      editedRow.city === CITY,
    "服务发布：编辑可在三态之间切换",
    JSON.stringify(editedRow),
  );

  for (const id of created) {
    await call("DELETE", `/enterprise/services/${id}`, ENTERPRISE);
  }
  const left = await prisma.providerServiceListing.count({
    where: { id: { in: created } },
  });
  log(`服务发布：实测数据自清（${created.length} 条）`, left === 0, `残留 ${left} 条`);
}

/** 报文映射：直接跑已构建的 dist，确保「界面 → 落库 → 平台报文」同源。 */
async function checkPayloadMapping() {
  const dist = join(ROOT, "backend/dist/shared/region-scope.js");
  const mod = await import(`file://${dist.replace(/\\/g, "/")}`);
  const { demandGeoConfig, serviceAreaPayload, locateByCoordinates } = mod;
  assert(
    typeof demandGeoConfig === "function",
    "已构建产物含报文映射",
    dist,
  );
  assert(
    JSON.stringify(demandGeoConfig({ regionMode: "NONE" })) ===
      JSON.stringify({ geoMatchMode: "NONE" }),
    "需求报文：不限制只带 geoMatchMode=NONE",
    JSON.stringify(demandGeoConfig({ regionMode: "NONE" })),
  );
  const regionPayload = demandGeoConfig({
    regionMode: "REGION",
    province: PROVINCE,
    city: CITY,
  });
  assert(
    regionPayload.geoMatchMode === "REGION" &&
      regionPayload.province === PROVINCE &&
      regionPayload.city === CITY &&
      regionPayload.longitude === undefined,
    "需求报文：指定地区带省市、不带坐标",
    JSON.stringify(regionPayload),
  );
  const radiusPayload = demandGeoConfig({
    regionMode: "RADIUS",
    province: PROVINCE,
    city: CITY,
    longitude: 121.55,
    latitude: 29.87,
    radiusKm: 30,
  });
  assert(
    radiusPayload.geoMatchMode === "RADIUS" &&
      radiusPayload.longitude === 121.55 &&
      radiusPayload.radiusKm === 30 &&
      radiusPayload.province === PROVINCE,
    "需求报文：经纬度同时带坐标与解析出的省市",
    JSON.stringify(radiusPayload),
  );
  assert(
    serviceAreaPayload({ serviceAreaMode: "NATIONWIDE" }).mode === "NATIONWIDE" &&
      serviceAreaPayload({ serviceAreaMode: "REMOTE" }).mode === "NATIONWIDE",
    "服务报文：不限制 → 平台 NATIONWIDE（存量 REMOTE 同归）",
  );
  const supplyRadius = serviceAreaPayload({
    serviceAreaMode: "RADIUS",
    province: PROVINCE,
    city: CITY,
    longitude: 121.55,
    latitude: 29.87,
    radiusKm: 30,
  });
  assert(
    supplyRadius.mode === "RADIUS" && supplyRadius.radiusKm === 30,
    "服务报文：RADIUS 原样透传坐标",
    JSON.stringify(supplyRadius),
  );
  const capital = locateByCoordinates(116.407, 39.904);
  assert(
    capital.province === "北京市" && capital.city === "北京市",
    "坐标解析：直辖市省市同名（界面文案只留一次）",
    JSON.stringify(capital),
  );
}

/** 界面同源：七个发布表单 + 服务发布表单都只用共享控件，自由文本「地域范围」不再存在。 */
function checkFormsUseSharedControl() {
  const files = {
    物流: "frontend/src/app/logistics/page.tsx",
    营销: "frontend/src/app/marketing/page.tsx",
    IT服务: "frontend/src/app/smart/page.tsx",
    法律: "frontend/src/app/legal/_components/requests-tab.tsx",
    知产: "frontend/src/app/ip/_components/requests-tab.tsx",
    资产交易: "frontend/src/app/asset/page.tsx",
    灵活用工: "frontend/src/app/flex/_components/work-order-tab.tsx",
    服务发布: "frontend/src/components/service-publish-tab.tsx",
    // 财税 / 供销 / 出海（平台直连看板）的发布表单：需求侧走 market-demand-tab，服务侧与上面同一份组件
    财税供销出海需求: "frontend/src/components/market-demand-tab.tsx",
  };
  for (const [key, rel] of Object.entries(files)) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    const usesShared =
      source.includes("RegionScopeFields") &&
      (key === "服务发布"
        ? source.includes('modeField="service_area_mode"') &&
          source.includes("serviceRegionFormValues")
        : source.includes("regionFormValues"));
    log(
      `${key}：发布表单用共享「地域范围」三态控件`,
      usesShared,
      usesShared ? "" : "仍是自由文本或缺三态控件",
    );
    assert(
      !/name="region_scope"/.test(source),
      `${key}：界面无「地域范围」自由文本输入`,
    );
  }
}

async function main() {
  console.log(`== A. 七板块需求发布三模式 @ ${BASE}`);
  for (const mod of MODULES) {
    await checkDemandModule(mod);
  }

  console.log(`\n== B. 服务发布（SUPPLY）三模式`);
  await checkServicePublish();

  console.log(`\n== C. AIworkin 报文映射（已构建 dist）`);
  await checkPayloadMapping();

  console.log(`\n== D. 界面同源（共享控件、无自由文本地域范围）`);
  checkFormsUseSharedControl();

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
