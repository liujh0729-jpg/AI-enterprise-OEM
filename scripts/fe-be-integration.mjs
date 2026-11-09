/**
 * 前端（Next dev）↔ 后端联调回归：页面可达、BFF 通道、页面等价的写操作。
 *
 * 三条前提，第 0 节逐条实测（不满足就失败退出，别拿一半真话当结论）：
 * 1. 后端实例必须使用专用本机隔离库，并关闭 AIworkin 通道。本套件会真实写业务表；
 *    regression-instance.mjs 不创建隔离库，必须显式配置进程环境 DATABASE_URL，不能继承
 *    backend/.env 的远端 ae_test.public。通道开着时发布还可能写入真实平台。
 * 2. 前端服务的 BACKEND_URL 要与 BASE_URL 指同一个实例，否则「页面/BFF 请求」验的
 *    是一个实例、「直连接口」验的是另一个，两边结论不能互推。跑法：
 *      终端 A：node scripts/regression-instance.mjs                     # 前台，打印 BASE_URL
 *      终端 B：cd frontend && npx next build                            # 同一次源码，先出构建
 *               BACKEND_URL=http://127.0.0.1:1693 npx next start -p 15890
 *      终端 C：BASE_URL=http://127.0.0.1:1693 WEB_URL=http://127.0.0.1:15890 \
 *              node scripts/fe-be-integration.mjs
 *    为什么终端 B 用 next start 而不是第二个 dev server：Next 16 一个项目目录只允许一台
 *    dev server（第二台会拿不到 .next/dev/lock 直接退出），而 15889 是日常在用那台，不能为了
 *    跑测试去改它的 BACKEND_URL 或重启它。/health/version 只给 commit 与通道状态，两者相同
 *    只能证明「构建与通道一致」，拦得住最常见的错配：前端还指着日常实例 1690。
 *    登录重定向由 frontend/src/proxy.ts 根据当前请求 origin 构造；第 1 节只断言
 *    路径为 /login 且携带 next 参数，不固定开发端口。
 * 3. 断言只给唯一期望值（见 [[feedback-test-honesty]]）：列表接口断言数组、对象接口断言对象，
 *    发布类接口按「该类目有没有生效签约」推出唯一结果，不用「成功或已签约」式放水写法。
 *
 * 页面清单与管理后台板块不再抄在本脚本里，改从 frontend/src/config/routes.ts 解析
 * （菜单/顶栏/hero 同源，加了板块不必回来改这张表；解析不出来直接抛错）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertChannelOff } from "./regression-guard.mjs";
import { createSuite, httpJson, ROOT } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const { users, token, log, assert } = suite;
const API = suite.base;
const WEB = process.env.WEB_URL || "http://127.0.0.1:15889";
// 通道护栏：本地联调套件不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(API);

const routesSource = readFileSync(
  join(ROOT, "frontend/src/config/routes.ts"),
  "utf8",
);
/** 侧栏导航里的本站页面（外链与 /admin 入口另算）。 */
const NAV_PAGES = [...routesSource.matchAll(/\{ path: "(\/[^"]*)", name: "([^"]+)"/g)]
  .map(([, path, name]) => [path, name])
  .filter(([path]) => path !== "/admin");
const ADMIN_SECTIONS = (() => {
  const start = routesSource.indexOf("ADMIN_SECTIONS: AdminSection[] = [");
  const end = routesSource.indexOf("export const adminRoute", start);
  if (start < 0 || end < 0) throw new Error("routes.ts 里找不到 ADMIN_SECTIONS，请同步本脚本");
  return [...routesSource.slice(start, end).matchAll(/key: "([^"]+)"/g)].map(([, key]) => key);
})();
if (NAV_PAGES.length < 10) {
  throw new Error(`routes.ts 只解析出 ${NAV_PAGES.length} 个页面，正则与前端配置已不匹配，请修脚本`);
}

const raw = (base, method, path, body, username, extraHeaders = {}) =>
  httpJson({
    url: base + path,
    method,
    body,
    redirect: "manual",
    headers: {
      ...extraHeaders,
      ...(username ? { Cookie: `aiworkin_token=${token(username)}` } : {}),
    },
  });

const page = (method, path, body, username) => raw(WEB, method, path, body, username);
const bff = (method, path, body, username) =>
  raw(WEB, method, `/api/backend${path}`, body, username);
const api = (method, path, body, username) => raw(API, method, path, body, username);

const envelope = (res) => (res.data && typeof res.data === "object" ? res.data : {});

function expectCode(res, name, code = 0) {
  const actual = envelope(res).code;
  log(name, actual === code, actual === code ? "" : `code=${actual} status=${res.status} msg=${envelope(res).message || ""}`);
  return actual === code ? res.data : null;
}

function expectStatus(res, name, status) {
  log(name, res.status === status, res.status === status ? "" : `status=${res.status} loc=${res.location || ""}`);
  return res.status === status;
}

(async () => {
  console.log("══ 0. 健康检查与前提 ══");
  expectCode(await api("GET", "/health"), "API /health");
  const ready = await api("GET", "/health/ready");
  expectCode(ready, "API /health/ready");
  assert(ready.data?.data?.checks?.database === "up", "DB ready", ready.data?.data?.checks?.database);
  const viaBff = await bff("GET", "/health/version");
  const direct = await api("GET", "/health/version");
  assert(
    JSON.stringify(viaBff.data?.data) === JSON.stringify(direct.data?.data),
    "前端 BFF 与 BASE_URL 指向同一后端（通道状态＋构建一致）",
    `BFF=${JSON.stringify(viaBff.data?.data)} 直连=${JSON.stringify(direct.data?.data)}`,
  );

  console.log("══ 1. 未登录门禁 ══");
  // 回跳参数名是 next（不是 redirect），且必须带上被拦的原路径
  const bounce = await page("GET", "/identity");
  expectStatus(bounce, "无 cookie 访问受保护页面被拦", 307);
  assert(
    String(bounce.location || "").includes("/login") &&
      String(bounce.location || "").includes("next=%2Fidentity"),
    "重定向到登录页并带回跳地址",
    bounce.location || "",
  );
  expectCode(await bff("GET", "/enterprise/me"), "BFF 无 cookie 401", 401);

  console.log("══ 2. 页面 HTML（企业 JWT） ══");
  for (const [path, label] of NAV_PAGES) {
    expectStatus(await page("GET", path, undefined, "demo_enterprise"), `页面 ${path} ${label}`, 200);
  }
  // 导航之外：H5 订货（微信服务号入口）与名录独立页
  expectStatus(await page("GET", "/m/order"), "H5 /m/order 无 cookie 跳登录", 307);
  expectStatus(await page("GET", "/m/order", undefined, "demo_enterprise"), "H5 /m/order 登录后可达", 200);
  expectStatus(await page("GET", "/providers/LOGISTICS", undefined, "demo_enterprise"), "名录独立页 /providers/LOGISTICS", 200);

  console.log("══ 2·5 平台管理后台（侧栏板块来自 ADMIN_SECTIONS） ══");
  const adminEntry = await page("GET", "/admin", undefined, "admin");
  assert(
    adminEntry.status === 307 && String(adminEntry.location || "").endsWith("/admin/users"),
    "/admin 重定向到第一个管理板块",
    `status=${adminEntry.status} loc=${adminEntry.location || ""}`,
  );
  // 平台数据总览已并入高管驾驶舱，旧地址重定向回首页
  const legacyOverview = await page("GET", "/admin/overview", undefined, "admin");
  const legacyOverviewTarget = new URL(String(legacyOverview.location || "/"), WEB).pathname;
  assert(
    legacyOverview.status === 307 && legacyOverviewTarget === "/",
    "/admin/overview 重定向到高管驾驶舱",
    `status=${legacyOverview.status} loc=${legacyOverview.location || ""}`,
  );
  for (const section of ADMIN_SECTIONS) {
    expectStatus(await page("GET", `/admin/${section}`, undefined, "admin"), `板块 /admin/${section}`, 200);
  }

  console.log("══ 3. 高管驾驶舱 BFF 列表（页面真实请求） ══");
  const me = expectCode(await bff("GET", "/enterprise/me", undefined, "demo_enterprise"), "BFF /enterprise/me");
  assert(me?.data?.userId === users.demo_enterprise.userId, "me.userId", me?.data?.userId);
  assert(me?.data?.roles?.includes("ENTERPRISE_USER"), "me.ENTERPRISE_USER");
  const payrollEnabled = me?.data?.platformFlags?.flexPayrollEnabled;
  assert(typeof payrollEnabled === "boolean", "me.platformFlags.flexPayrollEnabled 是布尔", String(payrollEnabled));

  /** [路径, 账号, 标签, 期望形状]：list＝数组，object＝对象，wrap＝{ list: [] } 包络。 */
  const listGets = [
    ["/enterprise/contracts", "demo_enterprise", "签约列表", "list"],
    ["/enterprise/contracts/my-enterprises", "demo_enterprise", "我的企业", "list"],
    ["/enterprise/logistics", "demo_enterprise", "物流列表", "list"],
    ["/enterprise/smart", "demo_enterprise", "IT服务需求", "list"],
    ["/enterprise/asset", "demo_enterprise", "资产需求", "list"],
    ["/enterprise/supply/stations", "demo_enterprise", "供销服务站", "list"],
    ["/enterprise/supply/products", "demo_enterprise", "供销商品", "list"],
    ["/enterprise/supply/orders", "demo_enterprise", "供销订货单", "list"],
    ["/enterprise/supply/bookings", "demo_enterprise", "供销预约单", "list"],
    ["/enterprise/services?domain=LOGISTICS", "demo_logistics2", "服务发布列表", "list"],
    ["/enterprise/overseas", "demo_enterprise", "出海列表", "list"],
    ["/enterprise/overseas/catalog", "demo_enterprise", "出海目录", "list"],
    ["/enterprise/tax/declarations", "demo_enterprise", "申报列表", "list"],
    ["/enterprise/tax/providers", "demo_enterprise", "财税服务商", "list"],
    ["/enterprise/tax/consultations", "demo_enterprise", "财税咨询", "list"],
    ["/enterprise/tax/account-sets", "demo_provider", "账套列表", "list"],
    ["/enterprise/marketing", "demo_enterprise", "营销列表", "list"],
    ["/enterprise/legal/requests", "demo_enterprise", "法律需求", "list"],
    ["/enterprise/legal/lawyers", "demo_enterprise", "律师库", "list"],
    ["/enterprise/ip/requests", "demo_enterprise", "知产需求", "list"],
    ["/enterprise/ip/agencies", "demo_enterprise", "知产机构", "list"],
    ["/enterprise/flex/work-orders", "demo_enterprise", "用工需求", "list"],
    ["/enterprise/flex/providers", "demo_enterprise", "灵工服务商", "list"],
    ["/enterprise/flex/onboardings", "demo_enterprise", "灵工进件", "list"],
    ["/enterprise/staff", "demo_provider", "职员列表", "list"],
    ["/enterprise/staff/affiliations", "demo_provider", "挂靠审批", "list"],
    ["/enterprise/staff/my-work", "demo_staff_all", "职员我的作业", "object"],
    ["/enterprise/api-keys", "demo_enterprise", "API Key 列表", "list"],
    ["/enterprise/aiworkin/categories?domain=LOGISTICS", "demo_enterprise", "类目树", "object"],
    ["/enterprise/admin/provider-applications", "admin", "备案审核", "list"],
    ["/enterprise/admin/providers", "admin", "服务商管理", "list"],
    ["/enterprise/admin/stats", "admin", "管理统计", "object"],
    ["/enterprise/admin/settings", "admin", "系统配置", "object"],
    ["/enterprise/admin/flex-payroll", "admin", "灵工发薪开关", "object"],
    ["/enterprise/admin/enterprises", "admin", "企业监管", "list"],
  ];
  for (const [path, user, label, shape] of listGets) {
    const payload = expectCode(await bff("GET", path, undefined, user), `BFF GET ${label}`);
    if (!payload) continue;
    const okShape =
      shape === "list"
        ? Array.isArray(payload.data)
        : shape === "wrap"
          ? Array.isArray(payload.data?.list)
          : payload.data !== null &&
            typeof payload.data === "object" &&
            !Array.isArray(payload.data);
    log(
      `${label} 返回${shape === "list" ? "数组" : shape === "wrap" ? "包络 { list }" : "对象"}`,
      okShape,
      okShape ? "" : `实际=${JSON.stringify(payload.data)?.slice(0, 60) ?? "null"}`,
    );
  }
  // 板块开关的两侧口径必须一致（前端据此决定「灵工发薪」页签是否出现）
  const payrollSwitch = expectCode(await bff("GET", "/enterprise/admin/flex-payroll", undefined, "admin"), "管理端读发薪开关");
  assert(
    payrollSwitch?.data?.enabled === payrollEnabled,
    "管理端开关＝用户端 platformFlags",
    `admin=${payrollSwitch?.data?.enabled} me=${payrollEnabled}`,
  );
  if (payrollEnabled === false) {
    const blocked = await bff("GET", "/enterprise/flex/payrolls", undefined, "demo_enterprise");
    assert(envelope(blocked).code === 20002, "停用时发薪接口按规则拒绝（20002）", `code=${envelope(blocked).code}`);
  } else {
    const listed = expectCode(await bff("GET", "/enterprise/flex/payrolls", undefined, "demo_enterprise"), "启用时发薪列表可读");
    assert(Array.isArray(listed?.data), "发薪列表返回数组", `实际=${JSON.stringify(listed?.data)?.slice(0, 60)}`);
  }

  console.log("══ 4. 身份切换 ══");
  const switched = expectCode(
    await bff("POST", "/enterprise/me/identity", { identity: "SERVICE_PROVIDER" }, "demo_dual"),
    "双身份切到服务商",
  );
  assert(switched?.data?.currentIdentity === "SERVICE_PROVIDER", "currentIdentity=SERVICE_PROVIDER");
  const back = expectCode(
    await bff("POST", "/enterprise/me/identity", { identity: "ENTERPRISE_USER" }, "demo_dual"),
    "双身份切回企业",
  );
  assert(back?.data?.currentIdentity === "ENTERPRISE_USER", "currentIdentity 已还原");

  console.log("══ 5. 页面写操作走 BFF ══");
  const stamp = Date.now();
  const contracts = (await bff("GET", "/enterprise/contracts/options", undefined, "demo_enterprise")).data?.data || [];
  /** 按后端同类优先级取生效签约（细项签约在前，裸类签约兜底）。 */
  const contractFor = (types) => {
    for (const type of types) {
      const hit = contracts.find((row) => row.serviceType === type && row.status === "ACTIVE");
      if (hit) return hit;
    }
    return null;
  };
  /** 发布表单的二级类目从本地类目接口取，不依赖关闭的平台通道。 */
  const subCategoryOf = async (domain) => {
    const res = await bff("GET", `/enterprise/aiworkin/categories?domain=${domain}`, undefined, "demo_enterprise");
    const options = res.data?.data?.modules?.[0]?.category2Options || [];
    assert(options.length > 0, `${domain} 有可选二级类目`, `实际 ${options.length} 项`);
    return options[0]?.id || "";
  };
  // 本套件关闭平台通道，省市接口必须明确失败；业务表单使用固定的隔离测试地区。
  const blockedLocations = await bff("GET", "/enterprise/connections/resources/locations", undefined, "demo_enterprise");
  expectCode(blockedLocations, "关闭通道时省市接口明确失败", 24001);
  assert(blockedLocations.data?.data == null, "省市接口不回退演示字典");
  const province = "浙江省";
  const city = "杭州市";
  /** 地域范围三模式的「指定地区」：每个发布表单都带这一组字段。 */
  const REGION = { region_mode: "REGION", province, city };

  const findRow = async (path, id, username) => {
    const rows = (await bff("GET", path, undefined, username)).data?.data || [];
    return rows.find((row) => String(row.id) === String(id));
  };

  const mktSub = await subCategoryOf("MARKETING");
  const mkt = expectCode(
    await bff(
      "POST",
      "/enterprise/marketing",
      { title: `联调营销 ${stamp}`, order_type: "VISIT", sub_category_id: mktSub, description: "联调用例", ...REGION },
      "demo_enterprise",
    ),
    "页面等价：发布营销需求（细项＋省市）",
  );
  if (mkt?.data?.id) {
    const channel = expectCode(
      await bff("GET", `/enterprise/marketing/${mkt.data.id}/messages`, undefined, "demo_enterprise"),
      "营销消息通道",
    );
    assert(Array.isArray(channel?.data?.conversations), "营销通道返回会话列表");
    const replied = expectCode(
      await bff("POST", `/enterprise/marketing/${mkt.data.id}/messages`, { text: `联调报价 ${stamp}` }, "demo_enterprise"),
      "营销回复消息",
    );
    const messages = replied?.data?.messages || [];
    assert(messages[messages.length - 1]?.text === `联调报价 ${stamp}`, "回复出现在消息末尾", JSON.stringify(messages.slice(-1)));
    await bff("DELETE", `/enterprise/marketing/${mkt.data.id}`, undefined, "demo_enterprise");
  }

  const wlSub = await subCategoryOf("LOGISTICS");
  const wlContract = contractFor(["DOMESTIC_LAND", "LOGISTICS"]);
  const wl = expectCode(
    await bff(
      "POST",
      "/enterprise/logistics",
      { title: `联调物流 ${stamp}`, order_type: "DOMESTIC", sub_category_id: wlSub, cargo_name: "联调货物", ...REGION },
      "demo_enterprise",
    ),
    "页面等价：发布物流需求（细项＋省市）",
  );
  if (wl?.data?.id) {
    const row = await findRow("/enterprise/logistics", wl.data.id, "demo_enterprise");
    // 直派规则：本细项已签约→发布即派给签约服务商（PENDING）；未签约→进公开池（OPEN）
    assert(
      row?.status === (wlContract ? "PENDING" : "OPEN"),
      `物流单状态＝${wlContract ? "PENDING（已签约直派）" : "OPEN（公开池）"}`,
      `实际 ${row?.status}`,
    );
    assert((row?.providerUserId || "") === (wlContract?.providerUserId || ""), "承接人＝签约服务商（未签约为空）", row?.providerUserId || "空");
    if (!wlContract) {
      // 需求免接收：服务商不必先点「接收」，回复即接单
      const reply = expectCode(
        await bff("POST", `/enterprise/logistics/${wl.data.id}/messages`, { text: "联调：我们可承接" }, "demo_logistics2"),
        "页面等价：服务商直接回复即接单",
      );
      assert(Boolean(reply), "服务商回复成功");
      const claimed = await findRow("/enterprise/logistics", wl.data.id, "demo_logistics2");
      assert(claimed?.status === "PENDING" && claimed?.providerUserId === users.demo_logistics2.userId, "回复后承办人已变更为该服务商", `status=${claimed?.status} provider=${claimed?.providerUserId}`);
    }
    expectCode(await bff("GET", `/enterprise/logistics/${wl.data.id}/messages`, undefined, "demo_enterprise"), "物流消息通道");
    await bff("DELETE", `/enterprise/logistics/${wl.data.id}`, undefined, "demo_enterprise");
  }

  /** 有生效签约才建得成单；没签约时唯一期望值就是 20001（无生效签约），不是「成功或报错都行」。 */
  const publishGated = async ({ label, path, body, contractTypes }) => {
    const contract = contractFor(contractTypes);
    const res = await bff("POST", path, body, "demo_enterprise");
    if (!contract) {
      assert(envelope(res).code === 20001, `${label}：未签约 → 后端拒绝 20001`, `code=${envelope(res).code} msg=${envelope(res).message}`);
      return null;
    }
    const data = expectCode(res, `页面等价：${label}`);
    return data?.data?.id ? { id: data.data.id } : null;
  };

  const legalSub = await subCategoryOf("LEGAL");
  const legal = await publishGated({
    label: "法律需求",
    path: "/enterprise/legal/requests",
    body: { title: `联调法律 ${stamp}`, category: "CONSULT", sub_category_id: legalSub, ...REGION },
    contractTypes: ["LEGAL_SERVICE"],
  });
  if (legal?.id) {
    const republish = expectCode(
      await bff("POST", `/enterprise/legal/requests/${legal.id}/publish`, undefined, "demo_enterprise"),
      "法律需求补发至 AIworkin 通道",
    );
    assert(Boolean(republish?.data?.tip), "补发给出结果提示", JSON.stringify(republish?.data || null));
    await bff("DELETE", `/enterprise/legal/requests/${legal.id}`, undefined, "demo_enterprise");
  }

  await publishGated({
    label: "知产需求",
    path: "/enterprise/ip/requests",
    body: { title: `联调知产 ${stamp}`, sub_category_id: await subCategoryOf("IP"), ...REGION },
    contractTypes: ["IP_SERVICE"],
  });
  await publishGated({
    label: "出海申请",
    path: "/enterprise/overseas",
    body: { service_type: "EXPORT_REFUND", title: `联调出海 ${stamp}` },
    contractTypes: ["EXPORT_REFUND"],
  });
  await publishGated({
    label: "用工需求",
    path: "/enterprise/flex/work-orders",
    body: { title: `联调用工 ${stamp}`, work_type: "FULLTIME", sub_category_id: await subCategoryOf("FLEX"), description: "联调用例", ...REGION },
    contractTypes: ["FLEX_WORK"],
  });

  // 申报单推进的是「承办职员」这一侧：AI 汇总→7 项核对→（外报回填）→扣款
  const ADVISOR = "demo_staff2";
  const decl = expectCode(
    await bff(
      "POST",
      "/enterprise/tax/declarations",
      { tax_type: "vat_general", period: "2026-Q4", form_data: { output_tax: 800, input_tax: 100 } },
      "demo_provider",
    ),
    "页面等价：新建申报单",
  );
  if (decl?.data?.id) {
    const run = expectCode(
      await bff("POST", `/enterprise/tax/declarations/${decl.data.id}/run-ai`, undefined, ADVISOR),
      "页面等价：AI 处理",
    );
    assert(run?.data?.status === "SUBMITTED", "AI 处理后状态 SUBMITTED", `实际 ${run?.data?.status}`);
    const qc = expectCode(
      await bff(
        "POST",
        `/enterprise/tax/declarations/${decl.data.id}/qc`,
        {
          action: "PASS",
          confirms: ["纳税人信息", "所属期", "销售额/收入", "税额计算", "减免优惠", "附件齐全", "签署确认"],
        },
        ADVISOR,
      ),
      "页面等价：7 项核对通过",
    );
    assert(qc?.data?.status === "FILED", "核对通过后状态 FILED（回执号由外报通道回填）", `实际 ${qc?.data?.status}`);
    assert(Boolean(qc?.data?.external_submission_id), "核对通过即生成外报工单", JSON.stringify(qc?.data ?? null).slice(0, 80));
    // 资金类不自动化：外报回执没回填就不给扣款
    const pay = await bff("POST", `/enterprise/tax/declarations/${decl.data.id}/pay`, undefined, ADVISOR);
    assert(envelope(pay).code === 21001, "未回填外报回执 → 扣款被拒 21001", `code=${envelope(pay).code} msg=${envelope(pay).message}`);
  }

  console.log("══ 6. 签约门禁 + 管理后台 ══");
  const exclusive = await bff(
    "POST",
    "/enterprise/contracts",
    { providerUserId: users.demo_tax3?.userId || "u-tax3", service_type: "TAX_FINANCE" },
    "demo_enterprise",
  );
  assert(exclusive.data?.code === 409, "财税独占：已签约再发起 409", `code=${exclusive.data?.code} msg=${exclusive.data?.message}`);

  const adminMe = expectCode(await bff("GET", "/enterprise/me", undefined, "admin"), "管理员 me");
  assert(adminMe?.data?.roles?.includes("PLATFORM_ADMIN"), "PLATFORM_ADMIN");
  expectCode(await bff("GET", "/enterprise/admin/stats", undefined, "admin"), "管理统计");
  const settings = expectCode(await bff("GET", "/enterprise/admin/settings", undefined, "admin"), "读取系统配置");
  assert(Object.prototype.toString.call(settings?.data) === "[object Object]", "系统配置是键值对象", JSON.stringify(settings?.data ?? null).slice(0, 80));

  // ROLE_MISMATCH 的契约就是「HTTP 403 + code 20002」（common/error-code.ts），两者都要验
  const forbidden = await bff("GET", "/enterprise/admin/stats", undefined, "demo_enterprise");
  assert(
    forbidden.status === 403 && envelope(forbidden).code === 20002,
    "企业用户不能看管理统计（403 + 20002）",
    `status=${forbidden.status} code=${envelope(forbidden).code}`,
  );

  console.log("══ 7. 开放 API（页面开发者中心对应） ══");
  const key = expectCode(await bff("POST", "/enterprise/api-keys", undefined, "demo_enterprise"), "页面等价：生成 Key");
  if (key?.data?.plainKey) {
    expectCode(
      await raw(API, "GET", "/api/v1/users/me", undefined, undefined, { "X-Api-Key": key.data.plainKey }),
      "X-Api-Key 调 /api/v1/users/me",
    );
  }

  console.log("══ 8. 职员搜索（职员页） ══");
  expectCode(await bff("GET", "/enterprise/staff/search?q=李芳", undefined, "demo_provider"), "职员搜索 李芳");

  const { passed, failed, failures } = suite.counts();
  console.log(`\n通过 ${passed} 项 · 失败 ${failed} 项`);
  if (failures.length) {
    console.log("失败明细：");
    for (const item of failures) console.log(` - ${item}`);
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
