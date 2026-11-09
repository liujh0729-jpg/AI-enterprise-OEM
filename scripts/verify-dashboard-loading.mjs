/** 工作台离线回归；只用内存数据，不访问数据库或平台。 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../frontend/src/", import.meta.url));
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = require("typescript");
function loadSource(filename, dependencies = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith(".")) {
        const candidate = path.resolve(path.dirname(filename), name);
        const source = [candidate + ".ts", candidate + ".tsx"].find(existsSync);
        if (source) return loadSource(source);
      }
      return require(name);
    },
  });
  return exports;
}
const { dashboardScope } = loadSource(path.join(root, "lib/dashboard-scope.ts"));
function account(currentIdentity, extra = {}) {
  return {
    userId: "dashboard-fixture", currentIdentity, identities: [currentIdentity],
    enterprise: { subjectType: "COMPANY" }, providerApps: [], staffOf: [], staffProfile: null,
    ...extra,
  };
}
function fixture(overrides = {}) {
  const calls = [];
  const dependencies = {};
  for (const name of ["contracts", "tax", "overseas", "logistics", "smart-service", "marketing", "supply", "asset", "legal", "ip", "flex", "identity", "admin"]) {
    const api = new Proxy({}, {
      get(_, method) {
        return async (input, options) => {
          const operation = `./${name}.${String(method)}`;
          calls.push({ operation, input, signal: options.signal });
          if (operation in overrides) return overrides[operation](input, options);
          if (operation === "./identity.myAffiliations" || operation === "./contracts.enterprises") return [];
          return { total: 4, enabled: true, active: 2, byStatus: { OPEN: 3 } };
        };
      },
    });
    dependencies[`./${name}`] = new Proxy({}, { get: () => api });
  }
  const source = loadSource(path.join(root, "api/dashboard.ts"), dependencies);
  return { ...source, calls, signal: new AbortController().signal };
}
const keys = (scope) => Array.from(scope.statistics);

test("企业用户只取可见待办，不取进件审核或团队列表", async () => {
  const scope = dashboardScope(account("ENTERPRISE_USER"));
  assert.equal(keys(scope).length, 11);
  assert(!keys(scope).includes("onboardings"));
  const { dashboardApi: api, calls, signal } = fixture();
  await Promise.all([api.overview(scope.identity, signal), api.team(scope.identity, signal)]);
  assert.deepEqual(calls.map((row) => row.operation), ["./contracts.stats"]);
});

test("个人跳过财税与出海；管理员切换个人业务身份保留完整类目", () => {
  const me = account("ENTERPRISE_USER", { enterprise: { subjectType: "PERSONAL" } });
  assert.equal(keys(dashboardScope(me)).length, 9);
  assert(!keys(dashboardScope(me)).some((key) => ["declarations", "overseas", "onboardings"].includes(key)));
  me.identities.push("PLATFORM_ADMIN");
  assert.equal(keys(dashboardScope(me)).length, 11);
});

test("服务商只请求审核通过的类目；小微只覆盖物流与供销", () => {
  const providerApps = [
    { providerType: "TAX_FINANCE", status: "APPROVED" },
    { providerType: "MARKETING", status: "PENDING" },
    { providerType: "ASSET_TRADE", status: "REJECTED" },
  ];
  assert.deepEqual(keys(dashboardScope(account("SERVICE_PROVIDER", { providerApps }))), ["declarations"]);
  assert.deepEqual(keys(dashboardScope(account("SERVICE_PROVIDER", { providerApps: [{ providerType: "MICRO", status: "APPROVED" }] }))), ["logistics", "supplyOrders", "supplyBookings"]);
});

test("职员类目使用个人资料与有效挂靠的并集", () => {
  const me = account("PROVIDER_STAFF", {
    staffProfile: { categories: ["FLEX_WORK"] },
    staffOf: [
      { status: "ACTIVE", roles: ["法律顾问"] },
      { status: "INACTIVE", roles: ["财税专员"] },
    ],
  });
  assert.deepEqual(keys(dashboardScope(me)), ["legal", "flexWo", "onboardings"]);
});

test("空会话、无开通类目、管理员首页均不请求业务待办", () => {
  assert.deepEqual(keys(dashboardScope(null)), []);
  for (const identity of ["SERVICE_PROVIDER", "PROVIDER_STAFF", "PLATFORM_ADMIN"]) {
    assert.deepEqual(keys(dashboardScope(account(identity))), []);
  }
});

for (const identity of ["SERVICE_PROVIDER", "PROVIDER_STAFF"]) {
  test(`管理员切换为 ${identity} 时保留所有业务类目`, () => {
    assert.equal(keys(dashboardScope(account(identity, { identities: [identity, "PLATFORM_ADMIN"] }))).length, 12);
  });
}

test("管理员只读取平台统计；职员不查询签约统计", async () => {
  const { dashboardApi: api, calls, signal } = fixture();
  const result = await api.overview("PLATFORM_ADMIN", signal);
  await api.overview("PROVIDER_STAFF", signal);
  assert.equal(result.stats.total, 4);
  assert.deepEqual(calls.map((row) => row.operation), ["./admin.stats"]);
});

test("统计请求严格按可见清单执行，空结果保持为错误", async () => {
  const { dashboardApi: api, calls, signal } = fixture();
  const scope = dashboardScope(account("SERVICE_PROVIDER", {
    providerApps: [{ providerType: "MICRO", status: "APPROVED" }],
  }));
  await Promise.all(scope.statistics.map((key) => api.statistic(key, signal)));
  assert.deepEqual(calls.map((row) => row.operation), ["./logistics.stats", "./supply.orderStats", "./supply.bookingStats"]);
  assert(calls.every((call) => call.signal === signal));
  const unavailable = fixture({ "./logistics.stats": () => null });
  await assert.rejects(unavailable.dashboardApi.statistic("logistics", unavailable.signal), /统计数据暂不可用/);
});

test("服务商只取服务企业；职员复用挂靠快照中的待确认邀请", async () => {
  const applications = [
    { id: 1, direction: "PROVIDER_INVITE", status: "PENDING", role_labels: ["财税专员"] },
    { id: 2, direction: "PROVIDER_INVITE", status: "APPROVED" },
    { id: 3, direction: "STAFF_APPLY", status: "PENDING" },
  ];
  const { dashboardApi: api, calls, signal } = fixture({ "./identity.myAffiliations": () => applications });
  await api.team("SERVICE_PROVIDER", signal);
  const team = await api.team("PROVIDER_STAFF", signal);
  assert.deepEqual(calls.map((row) => row.operation), ["./contracts.enterprises", "./identity.myWork", "./identity.myAffiliations"]);
  assert.deepEqual(Array.from(team.invitations, (row) => row.id), [1]);
  assert.deepEqual(Array.from(team.affiliations, (row) => row.id), [3]);
  assert.deepEqual(team.invitations[0].role_labels, ["财税专员"]);
  assert(calls.every((call) => call.signal === signal));
});

test("团队请求未完成时，概览可独立返回", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { dashboardApi: api, signal } = fixture({ "./contracts.enterprises": () => waiting });
  const team = api.team("SERVICE_PROVIDER", signal);
  assert.equal((await api.overview("SERVICE_PROVIDER", signal)).contractStats.active, 2);
  release([]);
  await team;
});

function queryFixture(me, resources) {
  const { useBusinessQueries } = loadSource(path.join(root, "query/business.ts"), {
    "@/lib/session": { useSession: () => ({ me, loading: false, switchingIdentity: false }) },
    "@tanstack/react-query": { useQueries: (options) => options.queries },
    "@/query/errors": {}, "@/query/invalidation": {},
    "@/query/keys": loadSource(path.join(root, "query/keys.ts")),
    "./errors": {}, "./invalidation": {},
  });
  return useBusinessQueries("dashboard", resources);
}

test("快统计单独入缓存；慢统计与失败统计不会清除已加载卡片", async () => {
  const { QueryClient } = require("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const options = queryFixture(account("SERVICE_PROVIDER"), [
    { resource: "fast", params: {}, load: async () => 3 },
    { resource: "slow", params: {}, load: () => pending },
    { resource: "failed", params: {}, load: async () => { throw new Error("查询失败"); } },
  ]);
  try {
    const requests = options.map((option) => client.fetchQuery(option).catch(() => undefined));
    await requests[0];
    await requests[2];
    assert.equal(client.getQueryData(options[0].queryKey), 3);
    assert.equal(client.getQueryData(options[1].queryKey), undefined);
    assert.equal(client.getQueryState(options[2].queryKey).status, "error");
    release(8);
    await requests[1];
    assert.equal(client.getQueryData(options[1].queryKey), 8);
  } finally { client.clear(); }
});

test("按账号与身份隔离，切换会话取消未完成的统计", async () => {
  const { QueryClient } = require("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  let release, captured;
  const resource = { resource: "stats", params: {}, load: (signal) => { captured = signal; return new Promise((resolve) => { release = resolve; }); } };
  const [option] = queryFixture(account("SERVICE_PROVIDER"), [resource]);
  const request = client.fetchQuery(option).catch(() => undefined);
  const [otherIdentity] = queryFixture(account("PROVIDER_STAFF"), [resource]);
  const [otherAccount] = queryFixture(account("SERVICE_PROVIDER", { userId: "other" }), [resource]);
  assert.notDeepEqual(option.queryKey, otherIdentity.queryKey);
  assert.notDeepEqual(option.queryKey, otherAccount.queryKey);
  await client.cancelQueries();
  client.clear();
  assert.equal(captured.aborted, true);
  release(99);
  await request;
  assert.equal(client.getQueryData(option.queryKey), undefined);
});
