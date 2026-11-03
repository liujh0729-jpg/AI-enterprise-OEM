/**
 * 给「万象综合服务（demo_all）」造一组申报计划演示数据（全部走真实接口，幂等可重跑）：
 * 企业 2 双身份演示企业（小规模）· 企业 9 陈记早点铺（个体工商户/一般）：
 * 企业发起财税签约 → 万象确认 → 指派财税承办职员（许静）→ 建账套 → 打开申报计划自动生成当期任务。
 * 结束后打印两账号各自可见的申报计划，便于核对。
 */
import { createSuite } from "./harness.mjs";

// 演示数据播种脚本跑在常规实例上（用户手动执行、要看界面），默认端口不是隔离实例。
const suite = createSuite({ base: process.env.BASE_URL || "http://127.0.0.1:1690" });
const { api } = suite;

const step = (label, r) =>
  console.log(
    `${r.data?.code === 0 ? "OK  " : "ERR "} ${label} — ${r.data?.message || JSON.stringify(r.data?.data ?? r.data)}`,
  );

const TARGETS = [
  { username: "demo_dual", enterpriseId: 2, setName: "双身份演示企业 2026 年度账套" },
  { username: "demo_individual", enterpriseId: 9, setName: "陈记早点铺 2026 年度账套" },
];

for (const t of TARGETS) {
  console.log(`\n=== 企业 ${t.enterpriseId}（${t.username}）===`);
  const list = await api("GET", "/enterprise/contracts/options", null, t.username);
  let contract = (list.data?.data || []).find(
    (row) =>
      row.providerUserId === "u-all" &&
      row.serviceType === "TAX_FINANCE" &&
      row.status !== "TERMINATED",
  );
  if (contract) {
    console.log(`OK   已存在财税签约 #${contract.id}（${contract.status}）`);
  } else {
    const created = await api(
      "POST",
      "/enterprise/contracts",
      { providerUserId: "u-all", service_type: "TAX_FINANCE", note: "演示：财税代账申报" },
      t.username,
    );
    step("企业发起财税签约", created);
    contract = created.data?.data;
  }
  if (!contract?.id) {
    console.log("  跳过：未取得签约 ID");
    continue;
  }
  if (contract.status === "PENDING") {
    const confirmed = await api(
      "POST",
      `/enterprise/contracts/${contract.id}/confirm`,
      {},
      "demo_all",
    );
    step(`万象确认签约 #${contract.id}`, confirmed);
  }
  const contractsNow = await api("GET", "/enterprise/contracts/options", null, "demo_all");
  const fresh = (contractsNow.data?.data || []).find(
    (row) => row.id === contract.id,
  );
  if (fresh?.designated_staff?.name !== "许静") {
    const designate = await api(
      "POST",
      `/enterprise/contracts/${contract.id}/designate-staff`,
      { staff_name: "许静" },
      "demo_all",
    );
    step("指定业务人员（承办对接人：许静）", designate);
  } else {
    console.log("OK   承办对接人已是许静");
  }
  const assigned = await api(
    "POST",
    "/enterprise/staff/assignments",
    { enterpriseId: t.enterpriseId, staffUserId: "u-staff-all" },
    "demo_all",
  );
  step("指派财税承办职员（许静）", assigned);
  const sets = await api("GET", "/enterprise/tax/account-sets", null, "demo_all");
  const exists = (sets.data?.data || []).find(
    (row) => row.enterpriseId === t.enterpriseId && row.status === "ACTIVE",
  );
  if (exists) {
    console.log(`OK   已存在账套 #${exists.id}（${exists.name}）`);
  } else {
    const set = await api(
      "POST",
      "/enterprise/tax/account-sets",
      { name: t.setName, enterpriseId: t.enterpriseId },
      "demo_all",
    );
    step("建账套", set);
  }
}

const dueOf = (list, enterpriseId, taxType) =>
  list.find(
    (row) =>
      row.enterpriseId === enterpriseId &&
      row.taxType === taxType &&
      row.status === "DUE",
  );

/** 申报单推进：create-decl → run-ai（本地汇总）→ 7 项核对；不涉及外报回填与扣款（资金类不自动化）。 */
const advance = async (plan, done) => {
  const decl = await api(
    "POST",
    `/enterprise/tax/plans/${plan.id}/create-decl`,
    {},
    "demo_staff_all",
  );
  step(`create-decl（#${plan.id} ${plan.tax_type_name} ${plan.period}）`, decl);
  const declId = decl.data?.data?.id;
  if (!declId || !done) return;
  await api(
    "POST",
    `/enterprise/tax/declarations/${declId}/run-ai`,
    {},
    "demo_staff_all",
  );
  const qc = await api(
    "POST",
    `/enterprise/tax/declarations/${declId}/qc`,
    {
      action: "PASS",
      confirms: [
        "纳税人信息",
        "所属期",
        "销售额/收入",
        "税额计算",
        "减免优惠",
        "附件齐全",
        "签署确认",
      ],
    },
    "demo_staff_all",
  );
  step(`AI 汇总 + 7 项核对通过（申报单 #${declId}）`, qc);
};

let latest = (await api("GET", "/enterprise/tax/plans", null, "demo_all")).data
  ?.data || [];
console.log("\n=== 制造进度多样性（待申报 / 申报中 / 已完成） ===");
const toFinish = dueOf(latest, 2, "vat_small");
if (toFinish) {
  await advance(toFinish, true);
} else {
  console.log("OK  企业2 增值税（小规模）计划已非待申报，跳过");
}
const toStart = dueOf(latest, 9, "vat_general");
if (toStart) {
  await advance(toStart, false);
} else {
  console.log("OK  企业9 增值税计划已非待申报，跳过");
}

console.log("\n=== 万象综合服务视角：申报计划（触发自动生成） ===");
const plans = await api("GET", "/enterprise/tax/plans", null, "demo_all");
const rows = plans.data?.data || [];
console.log(`共 ${rows.length} 条`);
rows.forEach((row) =>
  console.log(
    `  #${row.id} 企业${row.enterpriseId} ${row.enterprise_name} · ${row.period} · ${row.tax_type_name} · ${row.staff_name || "未指派"} · ${row.status} · 账套 ${row.account_set_name || "—"}`,
  ),
);

const staffView = await api("GET", "/enterprise/tax/plans", null, "demo_staff_all");
console.log(
  `\n许静可见：${(staffView.data?.data || []).length} 条（应仅承办给自己的）`,
);
const entView = await api("GET", "/enterprise/tax/plans", null, "demo_individual");
console.log(
  `陈记早点铺当事人可见：${(entView.data?.data || []).length} 条（应仅本企业的）`,
);
