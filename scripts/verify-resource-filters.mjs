/**
 * 资源库筛选收口实测（2026-09-25）：律师/律所、代理机构/代理人、灵活用工机构/代理人
 * 三张资源表的筛选**只剩省、市与关键词**（加分区 kind / record_type），
 * 旧的「擅长领域 / 服务领域 / 服务商类型 / 地区自由文本」参数必须被忽略（不再收窄结果）。
 *
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）。
 */
import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, api: request, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

const LOC_MSG = "请先选择所在省份与城市（提交时必填）";
const ACTOR = "demo_all"; // 十个类目全部备案通过的服务商
/** 该套件的动作主体默认是全类目服务商，调用点少写一个参数。 */
const api = (method, path, body, username = ACTOR) =>
  request(method, path, body, username);

const ids = (rows) =>
  (rows || []).map((row) => row.id).sort((a, b) => a - b).join(",");
const q = (obj) =>
  Object.entries(obj)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) => `${key}=${encodeURIComponent(String(value))}`,
    )
    .join("&");

/** 三张资源表的差异点（路由、分区参数、登记报文）集中在这里。 */
const MODULES = [
  {
    label: "律师/律所资源库",
    path: "/enterprise/legal/lawyers",
    partition: { param: "kind", values: ["LAW_FIRM", "LAWYER"] },
    model: () => prisma.lawyerResource,
    seedName: (tag) => `省市筛选测试律所-${tag}`,
    createBody: (tag, location) => ({
      name: `省市筛选测试律所-${tag}`,
      organization: `省市筛选测试律所-${tag}`,
      qualification: "律师事务所执业许可证：浙律 XXXX",
      intro: "用于验证省、市与关键词筛选的临时资源",
      areas: ["公司法"],
      ...location,
    }),
  },
  {
    label: "代理机构/代理人资源库",
    path: "/enterprise/ip/agencies",
    partition: { param: "kind", values: ["AGENCY", "AGENT"] },
    model: () => prisma.ipAgency,
    seedName: (tag) => `省市筛选测试代理机构-${tag}`,
    createBody: (tag, location) => ({
      kind: "AGENCY",
      name: `省市筛选测试代理机构-${tag}`,
      organization: `省市筛选测试代理机构-${tag}`,
      licenseNo: "专利代理机构注册证：浙代 XXXX",
      intro: "用于验证省、市与关键词筛选的临时资源",
      fields: ["商标注册"],
      ...location,
    }),
  },
  {
    label: "灵活用工资源库",
    path: "/enterprise/flex/providers",
    partition: { param: "record_type", values: ["ORG", "AGENT"] },
    model: () => prisma.flexProvider,
    seedName: (tag) => `省市筛选测试用工机构-${tag}`,
    // 服务商身份只能登记代理人（机构由平台统筹）
    createBody: (tag, location) => ({
      recordType: "AGENT",
      kind: "INDIVIDUAL",
      name: `省市筛选测试用工机构-${tag}`,
      organization: `省市筛选测试用工机构-${tag}`,
      licenseNo: "人力资源服务从业资格：浙人服 XXXX",
      intro: "用于验证省、市与关键词筛选的临时资源",
      fields: ["兼职招聘"],
      ...location,
    }),
  },
];

(async () => {
  console.log(`目标实例：${BASE}（账号 ${ACTOR}）\n`);
  const health = await api("GET", "/enterprise/legal/lawyers", null, null);
  assert(health.status === 401, "临时实例跑的是新代码（未带 token → 401，非 404）", `status=${health.status}`);

  for (const mod of MODULES) {
    console.log(`\n=== ${mod.label} ===`);
    const all = await api("GET", mod.path, null);
    assert(all.data?.code === 0, "列表接口可用", JSON.stringify(all.data)?.slice(0, 120));
    const rows = all.data?.data || [];
    assert(
      rows.length > 0 && rows.every((row) => "province" in row && "city" in row),
      "每行都带省、市字段",
      `${rows.length} 行`,
    );

    // 1) 省、市精确匹配
    const sample = rows.find((row) => row.province && row.city);
    assert(!!sample, "至少一条已填省市的资源（否则筛选无从验证）");
    if (sample) {
      const hit = await api(
        "GET",
        `${mod.path}?${q({ province: sample.province, city: sample.city })}`,
        null,
      );
      const expected = rows.filter(
        (row) => row.province === sample.province && row.city === sample.city,
      );
      assert(
        ids(hit.data?.data) === ids(expected) && expected.length > 0,
        `${sample.province}/${sample.city} 命中集与全量自洽`,
        `实际=${ids(hit.data?.data)} 期望=${ids(expected)}`,
      );
      const onlyProvince = await api(
        "GET",
        `${mod.path}?${q({ province: sample.province })}`,
        null,
      );
      assert(
        ids(onlyProvince.data?.data) ===
          ids(rows.filter((row) => row.province === sample.province)),
        "只按省筛选同样自洽",
      );
      const cityOnly = await api(
        "GET",
        `${mod.path}?${q({ city: sample.city })}`,
        null,
      );
      assert(
        ids(cityOnly.data?.data) === ids(rows),
        "只给市、不给省 → 市不生效（与筛选条一致：选省才能选市）",
      );
      const miss = await api(
        "GET",
        `${mod.path}?${q({ province: sample.province, city: "不存在市" })}`,
        null,
      );
      assert(
        (miss.data?.data || []).length === 0,
        "省对市错 → 不返回任何行",
        JSON.stringify(miss.data?.data || []),
      );
    }

    // 2) 未填省市的资源不参与省市筛选（先按历史状态造出一条空省市行）
    if (sample) {
      const target = await mod.model().findUnique({ where: { id: sample.id } });
      await mod.model().update({
        where: { id: sample.id },
        data: { province: "", city: "" },
      });
      const filtered = await api(
        "GET",
        `${mod.path}?${q({ province: target.province })}`,
        null,
      );
      assert(
        !(filtered.data?.data || []).some((row) => row.id === sample.id),
        "省市清空的资源不再被省、市筛选命中",
        JSON.stringify((filtered.data?.data || []).map((row) => row.id)),
      );
      const unfiltered = await api("GET", mod.path, null);
      assert(
        (unfiltered.data?.data || []).some((row) => row.id === sample.id),
        "不选省市时该资源仍正常展示（不因空省市被隐藏）",
      );
      await mod.model().update({
        where: { id: sample.id },
        data: { province: target.province, city: target.city },
      });
      const restored = await mod.model().findUnique({ where: { id: sample.id } });
      assert(
        restored.province === target.province && restored.city === target.city,
        "原省市已复原",
        `${restored.province}/${restored.city}`,
      );
    }

    // 3) 旧筛选参数必须被忽略（不再收窄结果）
    const legacy = await api(
      "GET",
      `${mod.path}?${q({ region: "杭州", field: "商标", area: "知识产权", kind: "" })}`,
      null,
    );
    assert(
      ids(legacy.data?.data) === ids(rows),
      "region / field / area 等旧参数不再生效（结果与无筛选一致）",
      `实际 ${ (legacy.data?.data || []).length } 行 / 全量 ${rows.length} 行`,
    );

    // 4) 分区参数仍可用（保留两类主体分栏）
    for (const value of mod.partition.values) {
      const part = await api("GET", `${mod.path}?${q({ [mod.partition.param]: value })}`, null);
      const list = part.data?.data || [];
      const field = mod.partition.param === "record_type" ? "recordType" : "kind";
      assert(
        list.every((row) => row[field] === value),
        `分区 ${mod.partition.param}=${value} 只返回该分区`,
        JSON.stringify(list.map((row) => row[field]).filter((item) => item !== value)),
      );
    }
    const bothPartitions = await api(
      "GET",
      `${mod.path}?${q({ [mod.partition.param]: mod.partition.values[0] })}`,
      null,
    );
    const otherPartition = await api(
      "GET",
      `${mod.path}?${q({ [mod.partition.param]: mod.partition.values[1] })}`,
      null,
    );
    assert(
      (bothPartitions.data?.data || []).length +
        (otherPartition.data?.data || []).length ===
        rows.length,
      "两个分区并起来等于全量（没有第三种取值）",
      `${(bothPartitions.data?.data || []).length}+${(otherPartition.data?.data || []).length} vs ${rows.length}`,
    );

    // 5) 关键词命中与空集
    if (sample) {
      const keyword = String(sample.name).slice(0, 3);
      const searched = await api("GET", `${mod.path}?${q({ keyword })}`, null);
      const list = searched.data?.data || [];
      const whole = new Set(rows.map((row) => row.id));
      assert(
        list.length > 0 && list.every((row) => whole.has(row.id)),
        `关键词「${keyword}」命中且是全量子集`,
        `${list.length} 行`,
      );
      assert(
        list.some((row) => row.id === sample.id),
        "关键词能命中该资源本身",
      );
      const nothing = await api("GET", `${mod.path}?${q({ keyword: "绝无此名zzz" })}`, null);
      assert((nothing.data?.data || []).length === 0, "无匹配关键词 → 空集");
    }

    // 6) 登记（新建）省市必填
    const tag = `${Date.now()}`;
    const body = mod.createBody(tag, {});
    const noLoc = await api("POST", mod.path, body);
    assert(noLoc.data?.message === LOC_MSG, "缺省市 → 拒绝登记", JSON.stringify(noLoc.data));
    const halfLoc = await api("POST", mod.path, { ...body, province: "浙江省" });
    assert(halfLoc.data?.message === LOC_MSG, "只填省 → 拒绝登记", JSON.stringify(halfLoc.data));
    const cityOnlyCreate = await api("POST", mod.path, { ...body, city: "杭州市" });
    assert(cityOnlyCreate.data?.message === LOC_MSG, "只填市 → 拒绝登记", JSON.stringify(cityOnlyCreate.data));
    const notStored = await mod.model().findFirst({ where: { name: body.name } });
    assert(!notStored, "被拒的登记没有落库");

    // 7) 带省市登记成功 → 落库 → 能被省市筛出
    const created = await api(
      "POST",
      mod.path,
      mod.createBody(tag, { province: "广东省", city: "深圳市" }),
    );
    assert(created.data?.code === 0, "带省市 → 登记成功", JSON.stringify(created.data)?.slice(0, 160));
    const row = created.data?.data || {};
    assert(
      row.province === "广东省" && row.city === "深圳市",
      "接口回传省市与提交一致",
      `${row.province}/${row.city}`,
    );
    const stored = await mod.model().findUnique({ where: { id: row.id } });
    assert(
      stored?.province === "广东省" && stored?.city === "深圳市",
      "省市已落库",
      `${stored?.province}/${stored?.city}`,
    );
    const foundNew = await api(
      "GET",
      `${mod.path}?${q({ province: "广东省", city: "深圳市" })}`,
      null,
    );
    assert(
      (foundNew.data?.data || []).some((item) => item.id === row.id),
      "新登记资源立刻可被省、市筛出",
    );

    // 8) 修改：不传省市 → 保留原值；传新省市 → 更新
    const patchKeep = await api("PATCH", `${mod.path}/${row.id}`, {
      intro: "修改简介但不碰省市",
    });
    assert(patchKeep.data?.code === 0, "PATCH 成功（未带省市）", JSON.stringify(patchKeep.data)?.slice(0, 120));
    const afterKeep = await mod.model().findUnique({ where: { id: row.id } });
    assert(
      afterKeep.province === "广东省" && afterKeep.city === "深圳市",
      "未提交省市 → 原省市保持不变",
      `${afterKeep.province}/${afterKeep.city}`,
    );
    const patchBad = await api("PATCH", `${mod.path}/${row.id}`, { province: "浙江省" });
    assert(patchBad.data?.message === LOC_MSG, "PATCH 只填省 → 拒绝", JSON.stringify(patchBad.data));
    const afterBad = await mod.model().findUnique({ where: { id: row.id } });
    assert(
      afterBad.province === "广东省" && afterBad.city === "深圳市",
      "被拒的修改没有改写省市",
    );
    const patchMove = await api("PATCH", `${mod.path}/${row.id}`, {
      province: "浙江省",
      city: "杭州市",
    });
    assert(patchMove.data?.code === 0, "PATCH 换省市成功", JSON.stringify(patchMove.data)?.slice(0, 120));
    const afterMove = await mod.model().findUnique({ where: { id: row.id } });
    assert(
      afterMove.province === "浙江省" && afterMove.city === "杭州市",
      "新省市已落库",
      `${afterMove.province}/${afterMove.city}`,
    );
    const movedOut = await api(
      "GET",
      `${mod.path}?${q({ province: "广东省", city: "深圳市" })}`,
      null,
    );
    assert(
      !(movedOut.data?.data || []).some((item) => item.id === row.id),
      "换省市后不再被旧省市命中",
    );

    // 9) 清理临时资源
    const removed = await api("DELETE", `${mod.path}/${row.id}`);
    assert(removed.data?.code === 0, "临时资源已删除", JSON.stringify(removed.data)?.slice(0, 120));
    const gone = await mod.model().findUnique({ where: { id: row.id } });
    assert(!gone, "删除后库内不存在");
  }

  console.log("\n=== 种子与存量口径 ===");
  const legacyRows = await Promise.all([
    prisma.lawyerResource.findMany({ where: { kind: { in: ["LAWYER", "LAW_FIRM"] } }, select: { id: true, province: true, city: true, status: true } }),
    prisma.ipAgency.findMany({ select: { id: true, province: true, city: true, status: true } }),
    prisma.flexProvider.findMany({ select: { id: true, province: true, city: true, status: true } }),
  ]);
  for (const [label, list] of [["lawyerResource", legacyRows[0]], ["ipAgency", legacyRows[1]], ["flexProvider", legacyRows[2]]]) {
    const visible = list.filter((row) => row.status !== "HIDDEN" && row.status !== "REJECTED");
    assert(
      visible.every((row) => row.province && row.city),
      `${label}：展示中的存量行省市齐全（对齐脚本已显式跑过）`,
      JSON.stringify(visible.filter((row) => !row.province || !row.city).map((row) => row.id)),
    );
  }
  const flexKinds = await prisma.flexProvider.groupBy({ by: ["kind"], _count: true });
  assert(
    flexKinds.every((row) => ["COMPANY", "INDIVIDUAL"].includes(row.kind)),
    "flex_providers.kind 只剩一套词汇（COMPANY/INDIVIDUAL）",
    JSON.stringify(flexKinds),
  );

  console.log("\n=== 达人建联：关闭通道不提供演示筛选数据 ===");
  for (const path of [
    "/enterprise/connections/resources?category=community&pageSize=60",
    "/enterprise/connections/resources?category=community&categoryKey=travel&province=浙江省",
    "/enterprise/connections/dictionaries/market_categories/items",
  ]) {
    const response = await api("GET", path, null);
    assert(
      response.status === 503 && response.data?.code === 24001 && response.data?.data == null,
      `通道关闭：${path} 明确报错`,
      response.data?.message,
    );
  }
  // 平台筛选参数透传由 connections.service.spec.ts 使用模拟上游单独验证。

  await prisma.$disconnect();
  const { passed, failed } = suite.counts();
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error("脚本异常：", error);
  await prisma.$disconnect();
  process.exit(1);
});
