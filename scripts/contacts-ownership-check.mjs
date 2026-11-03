// 联系方式归属侧实测：逐模块验证「只能改自己这一侧」。
// 用法：node scripts/regression-instance.mjs -- node scripts/contacts-ownership-check.mjs
import { assertChannelOff } from "./regression-guard.mjs";
import { createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, api, log } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);

const byId = (userId) =>
  Object.keys(users).find((name) => users[name].userId === userId) || "";

const list = async (path, who = "demo_enterprise") => {
  const res = await api("GET", path, null, who);
  const data = res.data?.data;
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
};

/** 每模块一条链：企业改企业侧(应成功) + 企业越界改执行侧(应 400)；执行侧反之。 */
const CASES = [
  { name: "法律", list: "/enterprise/legal/requests", edit: "/enterprise/legal/requests" },
  { name: "知产", list: "/enterprise/ip/requests", edit: "/enterprise/ip/requests" },
  { name: "物流", list: "/enterprise/logistics", edit: "/enterprise/logistics" },
  { name: "营销", list: "/enterprise/marketing", edit: "/enterprise/marketing" },
  { name: "资产", list: "/enterprise/asset", edit: "/enterprise/asset" },
  { name: "出海", list: "/enterprise/overseas", edit: "/enterprise/overseas" },
  {
    name: "灵工用工需求",
    list: "/enterprise/flex/work-orders",
    edit: "/enterprise/flex/work-orders",
  },
  {
    name: "灵工进件",
    list: "/enterprise/flex/onboardings",
    edit: "/enterprise/flex/onboardings",
  },
  {
    name: "灵工发薪",
    list: "/enterprise/flex/payrolls",
    edit: "/enterprise/flex/payrolls",
  },
  {
    name: "报税材料包",
    list: "/enterprise/tax/material-packs",
    edit: "/enterprise/tax/material-packs",
  },
];

(async () => {
  // 灵工发薪板块开关默认启用，停用时该模块的接口一律 20002——「企业侧/执行侧」这条链在关闭态
  // 根本测不到。所以整轮跑在开启态，跑完按**跑前读到的原值**恢复（不假设默认值就是 true）。
  const before = await api("GET", "/enterprise/admin/flex-payroll", null, "admin");
  const wasEnabled = before.data?.data?.enabled === true;
  const on = await api("POST", "/enterprise/admin/flex-payroll", { enabled: true }, "admin");
  log("灵工发薪：临时开启板块开关（测归属侧）", on.data?.data?.enabled === true, before.data?.message);
  try {
    await runCases();
  } finally {
    const restore = await api(
      "POST",
      "/enterprise/admin/flex-payroll",
      { enabled: wasEnabled },
      "admin",
    );
    log(
      `灵工发薪：板块开关已恢复为 ${wasEnabled ? "启用" : "停用"}`,
      restore.data?.data?.enabled === wasEnabled,
      restore.data?.message,
    );
  }

  const { passed: ok, failed: bad } = suite.counts();
  console.log(`\n通过 ${ok} 项 · 失败 ${bad} 项`);
  process.exit(bad ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function runCases() {
  for (const item of CASES) {
    const rows = await list(item.list);
    if (!rows.length) {
      log(`${item.name}：企业侧单据存在`, false, "列表为空，跳过");
      continue;
    }
    const row = rows[0];
    const staff = byId(row.staffUserId);
    const provider = byId(row.providerUserId);

    // 企业改企业侧 → 成功
    const enterpriseOwn = await api(
      "POST",
      `${item.edit}/${row.id}/contacts`,
      { contact_name: "实测企业侧", contact_phone: "13700001111" },
      "demo_enterprise",
    );
    log(
      `${item.name}：企业改企业侧`,
      enterpriseOwn.data?.code === 0,
      JSON.stringify(enterpriseOwn.data?.data || enterpriseOwn.data?.message),
    );

    // 企业越界改执行侧 → 400
    const enterpriseCross = await api(
      "POST",
      `${item.edit}/${row.id}/contacts`,
      { provider_contact_name: "越界", provider_contact_phone: "13700002222" },
      "demo_enterprise",
    );
    log(
      `${item.name}：企业越界改执行侧被拒`,
      enterpriseCross.data?.code === 400,
      JSON.stringify(enterpriseCross.data?.message || enterpriseCross.data),
    );

    // 执行侧用「已指派承办人」的单据验证（未指派的单据没有执行侧账号可测）
    const execRow = rows.find((r) => r.staffUserId || r.providerUserId);
    const actor = execRow
      ? byId(execRow.staffUserId) || byId(execRow.providerUserId)
      : "";
    if (!execRow || !actor) {
      log(`${item.name}：执行侧账号存在`, false, "无 staff/provider 归属，跳过执行侧");
      continue;
    }
    // 执行侧改执行侧 → 成功
    const executorOwn = await api(
      "POST",
      `${item.edit}/${execRow.id}/contacts`,
      { provider_contact_name: "实测执行侧", provider_contact_phone: "13700003333" },
      actor,
    );
    log(
      `${item.name}：执行侧(${actor})改执行侧`,
      executorOwn.data?.code === 0,
      JSON.stringify(executorOwn.data?.data || executorOwn.data?.message),
    );

    // 执行侧越界改企业侧 → 400
    const executorCross = await api(
      "POST",
      `${item.edit}/${execRow.id}/contacts`,
      { contact_name: "越界", contact_phone: "13700004444" },
      actor,
    );
    log(
      `${item.name}：执行侧越界改企业侧被拒`,
      executorCross.data?.code === 400,
      JSON.stringify(executorCross.data?.message || executorCross.data),
    );

    // 保存本侧不得改回对方侧（对方「临时换人」的值要保留）
    const pick = (r, camel, snake) => r?.[camel] ?? r?.[snake] ?? "";
    const reload = async () =>
      (await list(item.list)).find((r) => r.id === execRow.id);
    await api(
      "POST",
      `${item.edit}/${execRow.id}/contacts`,
      { contact_name: "实测企业侧", contact_phone: "13700001111" },
      "demo_enterprise",
    );
    const afterEnt = await reload();
    log(
      `${item.name}：企业改本侧不动执行侧`,
      pick(afterEnt, "providerContactName", "provider_contact_name") === "实测执行侧",
      `执行侧=${pick(afterEnt, "providerContactName", "provider_contact_name")}/${pick(afterEnt, "providerContactPhone", "provider_contact_phone")}`,
    );
    await api(
      "POST",
      `${item.edit}/${execRow.id}/contacts`,
      { provider_contact_name: "实测执行侧", provider_contact_phone: "13700003333" },
      actor,
    );
    const afterExec = await reload();
    log(
      `${item.name}：执行侧改本侧不动企业侧`,
      pick(afterExec, "contactName", "contact_name") === "实测企业侧",
      `企业侧=${pick(afterExec, "contactName", "contact_name")}/${pick(afterExec, "contactPhone", "contact_phone")}`,
    );
  }
}
