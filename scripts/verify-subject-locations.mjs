import { assertChannelOff } from "./regression-guard.mjs";
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

const uids = (rows) => rows.map((row) => row.providerUserId).sort().join(",");

(async () => {
  console.log("1) 名录按省、市筛选");
  // 出海「海外公司注册」与营销「直播带货」两条细项名录都过一遍
  for (const serviceType of ["COMPANY_REG", "LIVE_SELLING"]) {
    const all = await api(
      "GET",
      `/enterprise/contracts/providers?serviceType=${serviceType}`,
      null,
      "demo_enterprise",
    );
    assert(all.data?.code === 0, `${serviceType}：名录接口可用`);
    const rows = all.data?.data || [];
    assert(
      rows.every((row) => "province" in row && "city" in row),
      `${serviceType}：每行都带省、市字段`,
      JSON.stringify(rows.map((row) => [row.orgName, row.province, row.city])),
    );
    // 从字典里取该细项下真实存在「省+市」齐全的一家，作为筛选样本
    const sample = rows.find((row) => row.province && row.city);
    assert(!!sample, `${serviceType}：至少一家已填省市（否则筛选无从验证）`);
    if (!sample) continue;
    const qs = `&province=${encodeURIComponent(sample.province)}&city=${encodeURIComponent(sample.city)}`;
    const hit = await api(
      "GET",
      `/enterprise/contracts/providers?serviceType=${serviceType}${qs}`,
      null,
      "demo_enterprise",
    );
    const expected = rows.filter(
      (row) => row.province === sample.province && row.city === sample.city,
    );
    assert(
      uids(hit.data?.data || []) === uids(expected),
      `${serviceType}：${sample.province}/${sample.city} 命中集与全量一致`,
      `实际=${uids(hit.data?.data || [])} 期望=${uids(expected)}`,
    );
    assert(
      (hit.data?.data || []).length > 0,
      `${serviceType}：筛选后有结果可展示`,
    );
    const onlyProvince = await api(
      "GET",
      `/enterprise/contracts/providers?serviceType=${serviceType}&province=${encodeURIComponent(sample.province)}`,
      null,
      "demo_enterprise",
    );
    assert(
      uids(onlyProvince.data?.data || []) ===
        uids(rows.filter((row) => row.province === sample.province)),
      `${serviceType}：只按省筛选同样自洽`,
    );
    const none = await api(
      "GET",
      `/enterprise/contracts/providers?serviceType=${serviceType}&province=${encodeURIComponent(sample.province)}&city=${encodeURIComponent("不存在的市")}`,
      null,
      "demo_enterprise",
    );
    assert(
      (none.data?.data || []).length === 0,
      `${serviceType}：省对市错时不返回任何行`,
      JSON.stringify(none.data?.data || []),
    );
  }

  console.log("2) 职员/代理人资料：省市必填 + 落库");
  const staffUser = "demo_staff_all";
  const staffId = users[staffUser].userId;
  const before = await prisma.staffProfile.findUnique({ where: { userId: staffId } });
  assert(!!before, "职员档案存在（种子数据）", staffId);
  // 模拟「省市字段上线前的历史档案」：先清空，才能证明被拒的提交真的没有写入
  await prisma.staffProfile.update({
    where: { userId: staffId },
    data: { province: "", city: "" },
  });
  const base = {
    real_name: before.realName,
    phone: before.phone,
    email: before.email,
    region: before.region,
    categories: before.categories,
    qualification: before.qualification,
    intro: before.intro,
  };
  const noLoc = await api("POST", "/enterprise/identity/staff-profile", base, staffUser);
  assert(
    noLoc.data?.message === "请先选择所在省份与城市（提交时必填）",
    "缺省市 → 拒绝提交",
    JSON.stringify(noLoc.data),
  );
  const halfLoc = await api(
    "POST",
    "/enterprise/identity/staff-profile",
    { ...base, province: "浙江省" },
    staffUser,
  );
  assert(halfLoc.data?.code !== 0, "只填省不填市 → 拒绝提交", JSON.stringify(halfLoc.data));
  const afterReject = await prisma.staffProfile.findUnique({ where: { userId: staffId } });
  assert(
    afterReject.province === "" && afterReject.city === "",
    "被拒的提交没有改写已存省市",
    `${afterReject.province}/${afterReject.city}`,
  );
  const okSubmit = await api(
    "POST",
    "/enterprise/identity/staff-profile",
    { ...base, province: "浙江省", city: "杭州市" },
    staffUser,
  );
  assert(okSubmit.data?.code === 0, "带省市 → 提交成功", JSON.stringify(okSubmit.data));
  const storedStaff = await prisma.staffProfile.findUnique({ where: { userId: staffId } });
  assert(
    storedStaff.province === "浙江省" && storedStaff.city === "杭州市",
    "省市已落库",
    `${storedStaff.province}/${storedStaff.city}`,
  );
  const readBack = await api("GET", "/enterprise/identity/staff-profile", null, staffUser);
  assert(
    readBack.data?.data?.province === "浙江省" && readBack.data?.data?.city === "杭州市",
    "读取接口回填省市（界面预填依赖）",
    JSON.stringify([readBack.data?.data?.province, readBack.data?.data?.city]),
  );

  console.log("3) 服务商备案：省市必填 + 修改备案落库");
  const providerUser = "demo_all";
  const providerId = users[providerUser].userId;
  const rows = await prisma.providerApplication.findMany({
    where: { userId: providerId, status: "APPROVED" },
    orderBy: { id: "asc" },
  });
  assert(rows.length > 0, "全类目服务商备案行存在", `${rows.length} 行`);
  const badSubmit = await api(
    "POST",
    "/enterprise/identity/provider-application",
    {
      provider_type: "IP_SERVICE",
      org_name: "省市必填校验用",
      uscc: "91330100BADLOC0001",
      contact_name: "测试",
      contact_phone: "13800000000",
      contact_email: "loc@example.com",
      intro: "缺省市的备案提交",
      service_items: { IP_SERVICE: ["COMPANY_REG"] },
    },
    providerUser,
  );
  assert(
    badSubmit.data?.message === "请先选择所在省份与城市（提交时必填）",
    "备案缺省市 → 拒绝",
    JSON.stringify(badSubmit.data),
  );
  const created = await prisma.providerApplication.findFirst({
    where: { userId: providerId, uscc: "91330100BADLOC0001" },
  });
  assert(!created, "被拒的备案提交未落库");

  for (const row of rows) {
    const patched = await api(
      "PATCH",
      `/enterprise/identity/provider-application/${row.id}`,
      { province: "浙江省", city: "杭州市" },
      providerUser,
    );
    assert(
      patched.data?.code === 0,
      `修改备案 #${row.id}(${row.providerType}) 省市成功`,
      JSON.stringify(patched.data),
    );
  }
  const saved = await prisma.providerApplication.findMany({
    where: { userId: providerId, status: "APPROVED" },
  });
  assert(
    saved.every((row) => row.province === "浙江省" && row.city === "杭州市"),
    "全部备案行省市已落库",
    JSON.stringify(saved.map((row) => [row.providerType, row.province, row.city])),
  );
  assert(
    saved.every((row) => row.status === "APPROVED"),
    "仅改省市不触发主体复审（状态仍为已备案）",
  );

  console.log("4) 用户（企业）档案：省市必填 + 落库");
  const entUser = "demo_enterprise";
  const entId = users[entUser].userId;
  const LOC_MSG = "请先选择所在省份与城市（提交时必填）";
  const ent = await prisma.enterpriseProfile.findFirst({
    where: { userId: entId },
    orderBy: { id: "desc" },
  });
  const entNoLoc = await api(
    "POST",
    "/enterprise/identity/enterprise",
    {
      name: ent.name,
      uscc: ent.uscc,
      subject_type: ent.subjectType,
      legal_person: ent.legalPerson,
      phone: ent.phone,
      address: ent.address,
      industry: ent.industry,
    },
    entUser,
  );
  assert(
    entNoLoc.data?.code !== 0 && entNoLoc.data?.message === LOC_MSG,
    "用户认证缺省市 → 拒绝",
    JSON.stringify(entNoLoc.data),
  );
  const entHalf = await api(
    "PATCH",
    "/enterprise/identity/enterprise",
    { province: "浙江省" },
    entUser,
  );
  assert(
    entHalf.data?.message === LOC_MSG,
    "用户档案只填省 → 拒绝（省市必须成对）",
    JSON.stringify(entHalf.data),
  );
  const entPatch = await api(
    "PATCH",
    "/enterprise/identity/enterprise",
    { province: "浙江省", city: "杭州市" },
    entUser,
  );
  assert(entPatch.data?.code === 0, "用户档案修改省市成功", JSON.stringify(entPatch.data));
  const entSaved = await prisma.enterpriseProfile.findFirst({
    where: { userId: entId },
    orderBy: { id: "desc" },
  });
  assert(
    entSaved.province === "浙江省" && entSaved.city === "杭州市",
    "用户省市已落库",
    `${entSaved.province}/${entSaved.city}`,
  );
  const entKept = await api("GET", "/enterprise/identity/enterprise", null, entUser);
  assert(
    entKept.data?.data?.name === ent.name && entKept.data?.data?.uscc === ent.uscc,
    "只传省市不会清空名称 / 信用代码",
    JSON.stringify([entKept.data?.data?.name, entKept.data?.data?.uscc]),
  );

  console.log("5) 名录里能按该省市筛出刚改过的服务商");
  const filtered = await api(
    "GET",
    "/enterprise/contracts/providers?province=浙江省&city=杭州市",
    null,
    entUser,
  );
  assert(
    (filtered.data?.data || []).every(
      (row) => row.province === "浙江省" && row.city === "杭州市",
    ),
    "不带类目的省市筛选同样只返回命中行",
    JSON.stringify((filtered.data?.data || []).map((row) => [row.orgName, row.province, row.city])),
  );

  await prisma.$disconnect();
  const { passed, failed } = suite.counts();
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})();
