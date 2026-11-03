/**
 * IM 连接（飞书 / 企业微信）：接口层实测（默认打 1690 开发实例）。
 *
 * 口径：
 * - 只用假凭据验证本地校验、组织隔离、回调路径、通知规则与同步对象；不真连飞书 / 企微。
 * - 本脚本自己建连接器、自己删；成员同步用假凭据只会如实失败，不落成员、不写事件。
 *
 * 用法：
 *   node scripts/verify-im.mjs
 *   BASE_URL=http://127.0.0.1:1690 node scripts/verify-im.mjs
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1690",
});
const { call, assert } = suite;

const OWNER = "demo_enterprise";
const OTHER = "demo_provider";
const STAMP = Date.now();
const BASE = "/enterprise/im";

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${OWNER}`);

let connectorId = 0;
let providerConnectorId = 0;

try {
  const anon = await fetch(`${suite.base}${BASE}/connectors`);
  assert(anon.status === 401, "未登录读连接器 → 401", `status=${anon.status}`);

  const missing = await call("POST", `${BASE}/connectors`, OWNER, {
    provider: "FEISHU",
    name: "验证·缺凭据",
    appId: "",
    appSecret: "",
  });
  assert(
    missing.code !== 0 && /App ID/.test(missing.message || ""),
    "飞书缺 App ID / Secret 被中文拒收",
    `code=${missing.code} message=${missing.message}`,
  );

  const created = await call("POST", `${BASE}/connectors`, OWNER, {
    provider: "FEISHU",
    name: `验证·飞书 ${STAMP}`,
    appId: `cli_verify_${STAMP}`,
    appSecret: "verify-app-secret",
    encryptKey: "verify-encrypt-key",
  });
  assert(
    created.code === 0 && created.data?.id,
    "新建飞书连接器成功",
    `code=${created.code} message=${created.message}`,
  );
  connectorId = created.data?.id || 0;
  assert(
    /^\/api\/backend\/enterprise\/im\/events\/feishu\/[0-9a-f]{32}$/.test(
      created.data?.webhookPath || "",
    ),
    "回调路径是一条连接器一个 32 位随机地址",
    created.data?.webhookPath,
  );
  assert(
    created.data?.hasAppSecret === true &&
      !JSON.stringify(created.data || {}).includes("verify-app-secret"),
    "凭据只回「是否已保存」，不回明文",
  );

  const tested = await call(
    "POST",
    `${BASE}/connectors/${connectorId}/test`,
    OWNER,
  );
  assert(
    tested.code === 0 && tested.data?.ok === false,
    "假凭据的测试连接如实失败",
    `ok=${tested.data?.ok} message=${tested.data?.message}`,
  );
  assert(
    /飞书|企业微信|凭据|网络|超时/.test(tested.data?.message || ""),
    "测试失败给的是中文提示",
    `message=${tested.data?.message}`,
  );

  const members = await call(
    "GET",
    `${BASE}/connectors/${connectorId}/members`,
    OWNER,
  );
  assert(
    members.code === 0 &&
      Array.isArray(members.data?.linked) &&
      Array.isArray(members.data?.unlinked),
    "成员映射返回 已绑定 / 未绑定 两组",
  );

  const linkMissing = await call(
    "POST",
    `${BASE}/connectors/${connectorId}/members/link`,
    OWNER,
    { memberUserId: "u-enterprise", externalUserId: `ou_verify_${STAMP}` },
  );
  assert(
    linkMissing.code !== 0 && /同步/.test(linkMissing.message || ""),
    "绑定一个没同步过的 IM 成员被拒",
    `code=${linkMissing.code} message=${linkMissing.message}`,
  );

  const syncFail = await call(
    "POST",
    `${BASE}/connectors/${connectorId}/sync`,
    OWNER,
    { module: "CONTACTS" },
  );
  assert(
    syncFail.code !== 0,
    "假凭据的通讯录同步如实失败",
    `code=${syncFail.code} message=${syncFail.message}`,
  );

  const binding = await call(
    "POST",
    `${BASE}/connectors/${connectorId}/bindings`,
    OWNER,
    {
      module: "APPROVAL",
      objectKey: "leave",
      direction: "PUSH",
      config: { externalTemplateId: "verify-approval-code" },
      fieldMap: { name: "名称" },
    },
  );
  assert(
    binding.code === 0 && binding.data?.id,
    "保存审批同步对象成功",
    `code=${binding.code} message=${binding.message}`,
  );
  const bindings = await call(
    "GET",
    `${BASE}/connectors/${connectorId}/bindings`,
    OWNER,
  );
  assert(
    (bindings.data || []).some((item) => item.objectKey === "leave"),
    "同步对象清单读得到刚保存的审批绑定",
  );
  const bindingTest = await call(
    "POST",
    `${BASE}/connectors/${connectorId}/bindings/test`,
    OWNER,
    {
      module: "APPROVAL",
      config: { externalTemplateId: "verify-approval-code" },
    },
  );
  assert(
    bindingTest.code === 0 && bindingTest.data?.ok === true,
    "审批绑定配置格式校验通过",
    `message=${bindingTest.data?.message}`,
  );

  const savedRules = await call(
    "PUT",
    `${BASE}/connectors/${connectorId}/notify`,
    OWNER,
    {
      rules: [
        { event: "approval_pending", target: "CHAT", chatId: "oc_verify" },
        { event: "task_failed", target: "USER", chatId: "" },
      ],
    },
  );
  assert(
    savedRules.code === 0 &&
      (savedRules.data?.rules || []).some(
        (item) => item.event === "approval_pending" && item.chatId === "oc_verify",
      ),
    "通知规则保存后读回一致",
    `code=${savedRules.code}`,
  );

  const logs = await call(
    "GET",
    `${BASE}/connectors/${connectorId}/logs?page=1&pageSize=10`,
    OWNER,
  );
  assert(logs.code === 0, "同步记录可读", `code=${logs.code}`);

  const overview = await call("GET", `${BASE}/overview`, OWNER);
  assert(
    overview.code === 0 && overview.data?.connectors >= 1,
    "概览计数包含刚建的连接器",
    `connectors=${overview.data?.connectors}`,
  );

  const directory = await call(
    "GET",
    `${BASE}/staff-directory?connectorId=${connectorId}`,
    OWNER,
  );
  assert(
    directory.code === 0 &&
      directory.data?.localActive === (directory.data?.locals || []).length &&
      (directory.data?.connectors || []).some(
        (item) => item.id === connectorId,
      ) &&
      Array.isArray(directory.data?.imOnly),
    "映射总览按连接器给出本系统人数、IM 人数与两侧未对应",
    `localActive=${directory.data?.localActive} connectors=${(directory.data?.connectors || []).length}`,
  );
  assert(
    (directory.data?.locals || []).every((row) => Array.isArray(row.links)),
    "每位本系统职员都带自己的 IM 绑定列表（可空）",
  );

  const otherDirectory = await call(
    "GET",
    `${BASE}/staff-directory?connectorId=${connectorId}`,
    OTHER,
  );
  assert(
    otherDirectory.code !== 0,
    "映射总览按组织隔离（另一个组织读不到）",
    `code=${otherDirectory.code}`,
  );

  const providerConnector = await call("POST", `${BASE}/connectors`, OTHER, {
    provider: "WECOM",
    name: `验证·企微 ${STAMP}`,
    corpId: `ww_verify_${STAMP}`,
    appId: "",
    appSecret: "verify-wecom-secret",
  });
  assert(
    providerConnector.code === 0 && providerConnector.data?.id,
    "服务商组织可建企业微信连接器",
    `code=${providerConnector.code} message=${providerConnector.message}`,
  );
  providerConnectorId = providerConnector.data?.id || 0;
  const providerDirectory = await call(
    "GET",
    `${BASE}/staff-directory?connectorId=${providerConnectorId}`,
    OTHER,
  );
  assert(
    providerDirectory.code === 0 &&
      providerDirectory.data?.orgType === "PROVIDER" &&
      providerDirectory.data?.localActive ===
        (providerDirectory.data?.locals || []).length,
    "服务商映射总览把旧表在职职员一起计入本系统人数",
    `localActive=${providerDirectory.data?.localActive}`,
  );

  const snsSelf = await call("POST", "/enterprise/sns/messages", OWNER, {
    toUserId: "u-enterprise",
    subject: "",
    body: "验证自己发给自己",
  });
  assert(
    snsSelf.code !== 0 && /不能给自己/.test(snsSelf.message || ""),
    "发给自己的私信被中文拒收",
    `code=${snsSelf.code} message=${snsSelf.message}`,
  );
  const snsOutsider = await call("POST", "/enterprise/sns/messages", OWNER, {
    toUserId: "u-bob",
    subject: "",
    body: "验证跨组织",
  });
  assert(
    snsOutsider.code !== 0 && /本组织/.test(snsOutsider.message || ""),
    "只能给本组织职员/代理人发私信",
    `code=${snsOutsider.code} message=${snsOutsider.message}`,
  );
  const snsBadRead = await call(
    "POST",
    "/enterprise/notifications/sns/abc/read",
    OWNER,
  );
  assert(
    snsBadRead.code !== 0 && /编号无效/.test(snsBadRead.message || ""),
    "SNS 通知编号非法 → 中文 400",
    `code=${snsBadRead.code} message=${snsBadRead.message}`,
  );
  const unread = await call("GET", "/enterprise/notifications/unread", OWNER);
  assert(
    unread.code === 0 &&
      typeof unread.data?.sns?.available === "boolean" &&
      typeof unread.data?.sns?.unread === "number",
    "铃铛未读数带 AIworkin 社交的可用状态与未读数",
    `sns=${JSON.stringify(unread.data?.sns)}`,
  );

  const otherList = await call("GET", `${BASE}/connectors`, OTHER);
  assert(
    otherList.code === 0 &&
      !(otherList.data || []).some((item) => item.id === connectorId),
    "连接器按组织隔离（另一个组织看不到）",
  );
  const otherTouch = await call(
    "GET",
    `${BASE}/connectors/${connectorId}/members`,
    OTHER,
  );
  assert(
    otherTouch.code !== 0,
    "另一个组织直接按 id 访问 → 404 语义",
    `code=${otherTouch.code}`,
  );

  const badEvent = await fetch(
    `${suite.base}/api/backend/enterprise/im/events/feishu/${"0".repeat(32)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "url_verification", challenge: "x" }),
    },
  );
  assert(
    badEvent.status === 404,
    "未知回调 token → 404",
    `status=${badEvent.status}`,
  );
} finally {
  if (connectorId) {
    await call(
      "DELETE",
      `${BASE}/connectors/${connectorId}`,
      OWNER,
    ).catch(() => undefined);
  }
  if (providerConnectorId) {
    await call(
      "DELETE",
      `${BASE}/connectors/${providerConnectorId}`,
      OTHER,
    ).catch(() => undefined);
  }
}

const after = await call("GET", `${BASE}/connectors`, OWNER);
assert(
  !(after.data || []).some((item) => item.id === connectorId),
  "临时连接器已删除",
);

const { passed, failed } = suite.counts();
console.log(`\n${suite.summary()}`);
if (failed) process.exitCode = 1;
else console.log(`共 ${passed} 项断言全部通过`);