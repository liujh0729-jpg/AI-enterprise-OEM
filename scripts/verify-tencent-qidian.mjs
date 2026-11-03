/**
 * 腾讯企点营销工具：接口层实测（默认打 1690 开发实例）。
 *
 * 口径：
 * - 只用假凭据（网关指向 127.0.0.1:9）验证本地校验与中文错误，不真连腾讯企点、不产生任何上游账单；
 * - 本脚本自己建凭据、自己删；批量动作在「本地校验」阶段就拦下，不会落任务、不会写表。
 *
 * 用法：
 *   node scripts/verify-tencent-qidian.mjs
 *   BASE_URL=http://127.0.0.1:1690 node scripts/verify-tencent-qidian.mjs
 */
import { createRequire } from "node:module";

import { createSuite } from "./harness.mjs";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { endpoints } = require("@enterprise/contracts");

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1690",
});
const { call, assert } = suite;

const ACCOUNT = "demo_enterprise";
const STAMP = Date.now();
const BASE = "/enterprise/tencent-qidian";

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

let accountId = 0;

try {
  const anon = await fetch(`${suite.base}${BASE}/accounts`);
  assert(anon.status === 401, "未登录读凭据 → 401", `status=${anon.status}`);

  const created = await call("POST", `${BASE}/accounts`, ACCOUNT, {
    product: "CDP",
    label: `验证·企点 ${STAMP}`,
    gateway: "http://127.0.0.1:9",
    corporationId: `verify-corp-${STAMP}`,
    secretId: "verify-secret-id",
    secretKey: "verify-secret-key",
    bizId: `verify-biz-${STAMP}`,
  });
  assert(
    created.code === 0 && created.data?.id,
    "新建企点凭据成功（加密保存）",
    `code=${created.code} message=${created.message}`,
  );
  accountId = created.data?.id || 0;
  assert(
    !JSON.stringify(created.data || {}).includes("verify-secret-key"),
    "凭据接口不回显 secretKey 明文",
  );

  const missing = await call("POST", `${BASE}/accounts`, ACCOUNT, {
    product: "CDP",
    label: "验证·缺字段",
    corporationId: "",
    bizId: "",
  });
  assert(
    missing.code !== 0 && /企业ID|空间ID/.test(missing.message || ""),
    "缺企业ID / 空间ID 被中文拒收",
    `code=${missing.code} message=${missing.message}`,
  );

  const tested = await call("POST", `${BASE}/accounts/${accountId}/test`, ACCOUNT);
  assert(
    tested.code === 0 && tested.data?.ok === false,
    "假凭据的测试连接如实返回失败",
    `code=${tested.code} ok=${tested.data?.ok}`,
  );
  assert(
    /企点|连接|凭据|网络|超时/.test(tested.data?.message || ""),
    "测试失败给的是中文可操作提示",
    `message=${tested.data?.message}`,
  );

  const noMapping = await call("POST", `${BASE}/cdp/customers/import`, ACCOUNT, {
    accountId,
    tableId: 1,
    mapping: {},
  });
  assert(
    noMapping.code !== 0 && /列对应关系/.test(noMapping.message || ""),
    "批量导入没有列映射时在本地被拒",
    `code=${noMapping.code} message=${noMapping.message}`,
  );

  const crmNoName = await call("POST", `${BASE}/crm/import`, ACCOUNT, {
    accountId,
    source: "data_table",
    tableId: 1,
    mapping: { phone: "mobile" },
    confirmCost: true,
  });
  assert(
    crmNoName.code !== 0 && /客户名称/.test(crmNoName.message || ""),
    "写入 CRM 缺客户名称映射被拒",
    `code=${crmNoName.code} message=${crmNoName.message}`,
  );

  const crmNoCrowd = await call("POST", `${BASE}/crm/import`, ACCOUNT, {
    accountId,
    source: "cdp_segment",
    crowdId: "",
    mapping: { name: "oneid" },
    confirmCost: true,
  });
  assert(
    crmNoCrowd.code !== 0 &&
      /分群/.test(crmNoCrowd.message || ""),
    "写入 CRM 选分群来源但没填分群ID 被拒",
    `code=${crmNoCrowd.code} message=${crmNoCrowd.message}`,
  );

  assert(
    "advertiserId" in endpoints.Tp_rtaUploadAudience.body.shape &&
      "confirmCost" in endpoints.Tp_rtaUploadAudience.body.shape,
    "RTA 人群上传契约带广告主账号与二次确认字段",
  );

  const tasks = await call("GET", `${BASE}/tasks?page=1&pageSize=10`, ACCOUNT);
  assert(tasks.code === 0, "任务台账可读", `code=${tasks.code}`);

  const other = await call("GET", `${BASE}/accounts`, "demo_provider");
  assert(
    other.code === 0 &&
      !(other.data || []).some((item) => item.id === accountId),
    "企点凭据按登录账号隔离（另一个账号看不到）",
  );
} finally {
  if (accountId) {
    await call("DELETE", `${BASE}/accounts/${accountId}`, ACCOUNT).catch(
      () => undefined,
    );
  }
}

const after = await call("GET", `${BASE}/accounts`, ACCOUNT);
assert(
  !(after.data || []).some((item) => item.id === accountId),
  "临时凭据已删除",
);

const { passed, failed } = suite.counts();
console.log(`\n${suite.summary()}`);
if (failed) process.exitCode = 1;
else console.log(`共 ${passed} 项断言全部通过`);