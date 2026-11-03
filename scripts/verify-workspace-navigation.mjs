/** 导航与身份显示的离线回归；只使用内存样例，不连接数据库或上游。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = require("typescript");
// 本仓没有前端测试编译器，使用现有 TypeScript 编译器加载真实导航代码。
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
    });
    module._compile(result.outputText, filename);
  };
}
const { navigationFor } = require("./src/config/routes.ts");
const { identityLabel } = require("./src/lib/identity.ts");
const { openedTypes, isDomainOpened } = require("./src/lib/provider-categories.tsx");

function account(identity, extra = {}) {
  return {
    userId: "navigation-fixture", username: "fixture", displayName: "导航测试",
    javaRole: "user", roles: [identity], identities: [identity], currentIdentity: identity,
    enterprise: { subjectType: "COMPANY" }, providerApps: [], staffProfile: null, staffOf: [], qualified: {},
    ...extra,
  };
}
function leaves(route) {
  return route.routes ? route.routes.flatMap(leaves) : [route];
}
const paths = (me) => leaves(navigationFor(me)).map((route) => route.path);
const domains = (me) => leaves(navigationFor(me)).filter((route) => route.domain).map((route) => route.domain);
/** 管理设置里的 /staff 菜单项：服务商看「职员/代理人管理」，职员与个人看「申请加入服务商」。 */
const joinItem = (me) =>
  navigationFor(me).routes.find((route) => route.name === "管理设置")?.routes.find((route) => route.path === "/staff");

test("高管驾驶舱独立置顶，分组为工作台/业务服务/管理设置/开放集成/AI增值服务，首页只出现一次", () => {
  for (const identity of ["ENTERPRISE_USER", "SERVICE_PROVIDER", "PROVIDER_STAFF"]) {
    const me = account(identity);
    const nav = navigationFor(me);
    assert.equal(nav.routes[0].path, "/");
    assert.equal(nav.routes[0].name, "高管驾驶舱");
    assert.deepEqual(nav.routes.filter((route) => route.type === "group").map((route) => route.name),
      ["工作台", ...(identity === "ENTERPRISE_USER" ? ["业务服务"] : []), "管理设置", "开放集成", "AI增值服务"]);
    assert.equal(paths(me).filter((path) => path === "/").length, 1);
    assert.deepEqual(nav.routes.find((route) => route.name === "工作台").routes.map((route) => route.path),
      ["/agent", "/workbuddy", "/data-table", "/rpa", "/content", "/marketing-tools", "/assets", "/mail", "/crm", "/bi", "/oa", "/okr", "/service-desk", "/app-center", "/question-hall"]);
    assert.deepEqual(nav.routes.find((route) => route.name === "工作台").routes.map((route) => route.name),
      ["Agent", "Workbuddy 企业云", "多维表格", "RPA自动化", "内容创作", "营销工具", "数字资产管理", "AI邮箱服务", "CRM", "BI智能分析", "OA", "OKR计划", "AI客服", "应用中心", "专题大厅"]);
    assert.deepEqual(nav.routes.find((route) => route.name === "管理设置").routes.map((route) => route.path),
      ["/identity", ...(identity === "ENTERPRISE_USER" ? [] : ["/staff"]), "/contracts"]);
    assert.deepEqual(nav.routes.find((route) => route.name === "AI增值服务").routes.map((route) => route.path),
      ["https://app.aipdd.work", "https://www.aiworkin.com"]);
    assert.deepEqual(nav.routes.find((route) => route.name === "开放集成").routes.map((route) => route.path),
      ["/developer/keys", "/model-settings", "/developer/docs", "/developer/mcp"]);
    assert(!paths(me).some((path) => path.startsWith("/admin")));
  }
});

test("企业与个人显示同一十一个业务类目；个人菜单只把职员入口换成申请加入服务商", () => {
  assert.equal(domains(account("ENTERPRISE_USER")).length, 11);
  const personal = account("ENTERPRISE_USER", { enterprise: { subjectType: "PERSONAL" } });
  // 个人主体放开浏览：财税/出海照常进菜单，四类办理动作在页面内锁
  assert.equal(domains(personal).length, 11);
  assert(paths(personal).includes("/tax"));
  assert(paths(personal).includes("/overseas"));
  assert.equal(joinItem(personal)?.name, "申请加入服务商");
});

test("服务商只显示审核通过的类目，营销和资产也参与筛选；团队入口只对服务商显示", () => {
  const provider = account("SERVICE_PROVIDER", { providerApps: [
    { providerType: "TAX_FINANCE", status: "APPROVED" },
    { providerType: "MARKETING", status: "PENDING" },
    { providerType: "ASSET_TRADE", status: "REJECTED" },
  ] });
  assert.deepEqual(domains(provider), ["tax"]);
  assert(paths(provider).includes("/staff"));
  assert.equal(joinItem(provider)?.name, "职员/代理人管理");
  const micro = account("SERVICE_PROVIDER", { providerApps: [{ providerType: "MICRO", status: "APPROVED" }] });
  assert.deepEqual(domains(micro).sort(), ["logistics", "supply"]);
});

test("职员菜单按本人类目和有效绑定筛选，与首页待办一致", () => {
  const staff = account("PROVIDER_STAFF", {
    staffProfile: { categories: ["LEGAL_SERVICE"] },
    staffOf: [
      { status: "ACTIVE", roles: ["财税专员", "内容营销专员"] },
      { status: "INACTIVE", roles: ["供销专员"] },
    ],
  });
  assert.deepEqual(domains(staff).sort(), ["legal", "marketing", "tax"]);
  assert.equal(joinItem(staff)?.name, "申请加入服务商");
  assert(navigationFor(staff).routes.some((route) => route.name === "业务服务"));
  const opened = openedTypes(staff, staff.currentIdentity);
  for (const domain of ["tax", "marketing", "legal", "supply", "asset", "overseas"]) {
    assert.equal(domains(staff).includes(domain), isDomainOpened(opened, domain));
  }
});

test("同一多身份账号按当前身份选择菜单，切回时恢复，不污染共享配置", () => {
  const dual = account("ENTERPRISE_USER", {
    identities: ["ENTERPRISE_USER", "SERVICE_PROVIDER", "PROVIDER_STAFF"],
    providerApps: [{ providerType: "SUPPLY_NETWORK", status: "APPROVED" }],
    staffProfile: { categories: ["IP_SERVICE"] },
  });
  assert.equal(domains(dual).length, 11);
  assert.deepEqual(domains({ ...dual, currentIdentity: "SERVICE_PROVIDER" }), ["supply"]);
  assert.deepEqual(domains({ ...dual, currentIdentity: "PROVIDER_STAFF" }), ["ip"]);
  assert.equal(domains(dual).length, 11);
});

test("平台身份使用管理菜单；管理员切换业务身份后保留全部业务访问例外", () => {
  const admin = account("PLATFORM_ADMIN", {
    identities: ["ENTERPRISE_USER", "SERVICE_PROVIDER", "PROVIDER_STAFF", "PLATFORM_ADMIN"],
    enterprise: { subjectType: "PERSONAL" },
  });
  assert.equal(navigationFor(admin).routes[0].path, "/");
  assert.deepEqual(navigationFor(admin).routes.slice(1).map((route) => route.name),
    ["平台管理", "管理设置", "开放集成", "AI增值服务"]);
  assert.deepEqual(navigationFor(admin).routes.find((route) => route.name === "管理设置").routes.map((route) => route.path), ["/identity"]);
  assert(paths(admin).includes("/admin/provider-applications"));
  assert(!paths(admin).includes("/contracts"));
  assert.equal(domains(admin).length, 0);
  for (const identity of ["ENTERPRISE_USER", "SERVICE_PROVIDER", "PROVIDER_STAFF"]) {
    const business = { ...admin, currentIdentity: identity };
    assert.equal(domains(business).length, 11);
    assert(!paths(business).some((path) => path.startsWith("/admin")));
  }
});

test("空会话不假定企业身份；未开通类目不留下空导航组", () => {
  assert.deepEqual(navigationFor(null).routes, []);
  for (const identity of ["SERVICE_PROVIDER", "PROVIDER_STAFF"]) {
    assert(!navigationFor(account(identity)).routes.some((route) => route.type === "group" && !route.routes.length));
  }
});

test("身份名称覆盖四个角色及三种主体，共用显示不回退到企业用户", () => {
  assert.equal(identityLabel("PLATFORM_ADMIN"), "平台管理员");
  assert.equal(identityLabel("SERVICE_PROVIDER"), "服务商");
  assert.equal(identityLabel("PROVIDER_STAFF"), "职员 / 代理人");
  assert.equal(identityLabel("ENTERPRISE_USER", "PERSONAL"), "个人用户");
  assert.equal(identityLabel("ENTERPRISE_USER", "INDIVIDUAL"), "个体工商户用户");
  assert.equal(identityLabel("ENTERPRISE_USER", "COMPANY"), "企业用户");
  assert.equal(identityLabel(undefined), "身份确认中");
});
