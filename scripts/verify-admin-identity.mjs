import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const backendRequire = createRequire(new URL("../backend/package.json", import.meta.url));
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = backendRequire("typescript");
function loadSource(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../frontend/src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
  );
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (name) => dependencies[name] || frontendRequire(name),
  });
  return exports;
}
const categories = loadSource("lib/provider-categories.tsx");
const { openedTypes, isDomainOpened, canPublishService, DOMAIN_TYPES } = categories;
const { navigationFor } = loadSource("config/routes.ts", {
  "../lib/provider-categories": categories,
  "../lib/subject": loadSource("lib/subject.ts"),
});

function menuPaths(route) {
  return [route.path, ...(route.routes || []).flatMap(menuPaths)].filter(Boolean);
}

function session(overrides = {}) {
  return { identities: [], providerApps: [], staffProfile: null, staffOf: [], ...overrides };
}

for (const identity of ["ENTERPRISE_USER", "SERVICE_PROVIDER", "PROVIDER_STAFF"]) {
  test(`administrators can access all business domains as ${identity} without qualifications`, () => {
    const me = session({ identities: ["PLATFORM_ADMIN"], currentIdentity: identity });
    const opened = openedTypes(me, identity);
    for (const domain of Object.keys(DOMAIN_TYPES)) {
      assert.equal(isDomainOpened(opened, domain), true, domain);
    }
  });

  test(`administrator navigation exposes all business modules as ${identity}`, () => {
    const me = session({
      identities: ["PLATFORM_ADMIN"],
      currentIdentity: identity,
      enterprise: { subjectType: "PERSONAL" },
    });
    const paths = menuPaths(navigationFor(me));
    for (const path of ["/tax", "/overseas", "/marketing", "/supply", "/flex", "/logistics", "/smart", "/ip", "/legal", "/asset"]) {
      assert.ok(paths.includes(path), path);
    }
    // 服务商本人是「团队管理」入口；职员/代理人以「申请加入服务商」视角进入本页，管理员身份亦如此。
    // 企业用户（即使主体为个人）在当前身份下不进本页。
    assert.equal(paths.includes("/staff"), identity !== "ENTERPRISE_USER");
  });
}

test("ordinary providers still require approved category qualifications", () => {
  const me = session({
    identities: ["SERVICE_PROVIDER"],
    providerApps: [
      { providerType: "TAX_FINANCE", status: "APPROVED" },
      { providerType: "LOGISTICS", status: "PENDING" },
    ],
  });
  const opened = openedTypes(me, "SERVICE_PROVIDER");
  assert.equal(isDomainOpened(opened, "tax"), true);
  assert.equal(isDomainOpened(opened, "logistics"), false);
  assert.equal(isDomainOpened(opened, "legal"), false);
});

test("ordinary staff still use their profile and active institution bindings", () => {
  const me = session({
    identities: ["PROVIDER_STAFF"],
    staffProfile: { categories: ["TAX_FINANCE"] },
    staffOf: [
      { status: "ACTIVE", roles: ["法律顾问"] },
      { status: "INACTIVE", roles: ["知识产权专员"] },
    ],
  });
  const opened = openedTypes(me, "PROVIDER_STAFF");
  assert.equal(isDomainOpened(opened, "tax"), true);
  assert.equal(isDomainOpened(opened, "legal"), true);
  assert.equal(isDomainOpened(opened, "ip"), false);
});

test("switching identities does not substitute for service publication qualifications", () => {
  const me = session({ identities: ["PLATFORM_ADMIN"], currentIdentity: "SERVICE_PROVIDER" });
  assert.equal(canPublishService(me, "logistics"), false);
  me.providerApps = [{ providerType: "LOGISTICS", status: "APPROVED" }];
  assert.equal(canPublishService(me, "logistics"), true);
});

test("revoking administrator access restores category restrictions", () => {
  const me = session({ identities: ["PLATFORM_ADMIN"], currentIdentity: "SERVICE_PROVIDER" });
  assert.equal(isDomainOpened(openedTypes(me, "SERVICE_PROVIDER"), "tax"), true);
  me.identities = [];
  assert.equal(isDomainOpened(openedTypes(me, "SERVICE_PROVIDER"), "tax"), false);
});
