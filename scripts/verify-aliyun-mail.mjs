/**
 * 阿里云邮件推送（营销工具）：接口层实测。
 *
 * 口径：
 * - 打在开发实例（默认 1690）上，用种子账号的真实登录态走 /api/backend/enterprise/aliyun-mail/*。
 * - 只验证「不需要通阿里云」与「错误路径」的部分：未配置 Key、设置校验与打码回显、
 *   表权限、映射校验、错 Key 的中文失败提示、批次列表与 404。
 * - 预览计数（有效 / 重复 / 无效 / 台账跳过 / 容量截断）、变量长度与 6k 字节上限、
 *   500 条切批由 backend/src/aliyun-mail/aliyun-mail.service.spec.ts 用桩件覆盖：
 *   预览在新建模式下必须回读账号下的收件人列表（10 个上限），没有可用 Key 时走不到本地统计。
 * - 真实 CreateReceiver / SaveReceiverDetail 需要可用的子账号 AK/SK + 列表空位，
 *   本脚本不伪造这部分结论；真实链路仍待用户提供凭据后单独实测。
 * - 测试自己建表、自己配一份临时假 Key，结束时把这两样都清掉（账号回到初始状态）。
 *
 * 用法：node scripts/verify-aliyun-mail.mjs [BASE_URL]
 */
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.argv[2] || "http://127.0.0.1:1690",
});
const { call, assert, log, summary, counts } = suite;

const OWNER = "demo_flex3";
const OTHER = "demo_legal";
const BASE = "/api/backend/enterprise/aliyun-mail";
const FAKE_KEY_ID = "LTAI5tFakeKeyForAliyunMailVerify";
const FAKE_KEY_SECRET = "fake-secret-not-a-real-credential";
const MAPPING = {
  emailFieldKey: "email",
  variables: [{ key: "UserName", fieldKey: "name" }],
  writeBack: true,
};

const prisma = createPrisma();
let tableId = 0;

const created = (res) => res.code === 0;
const messageOf = (res) => String(res.message || "");

/** 上游失败（错 Key 或网络不通）都必须被翻成本系统中文，且不带上游原文。 */
const looksLikeOwnChinese = (res) =>
  res.status === 503 &&
  res.code === 503 &&
  /^(阿里云|连接阿里云)/.test(messageOf(res)) &&
  !/InvalidAccessKeyId|SignatureDoesNotMatch|Specified access key|SDK|RequestId/.test(
    messageOf(res),
  );

async function cleanup() {
  if (tableId) {
    await call("DELETE", `/api/backend/enterprise/data-tables/${tableId}`, OWNER);
    tableId = 0;
  }
  const row = await prisma.aliyunMailSetting.findUnique({
    where: { userId: suite.users[OWNER].userId },
  });
  if (row) {
    await prisma.aliyunMailSetting.delete({ where: { id: row.id } });
  }
  await prisma.aliyunMailImport.deleteMany({
    where: { userId: suite.users[OWNER].userId },
  });
  await prisma.aliyunMailContact.deleteMany({
    where: { userId: suite.users[OWNER].userId },
  });
}

async function main() {
  // ---------- 1. 未配置 Key ----------
  const empty = await call("GET", `${BASE}/settings`, OWNER);
  assert(created(empty), "未配置 Key：设置读取成功", messageOf(empty));
  assert(empty.data?.configured === false, "未配置 Key：configured=false");
  assert(
    empty.data?.hasAccessKeySecret === false,
    "未配置 Key：hasAccessKeySecret=false",
  );
  assert(
    empty.data?.region === "cn-hangzhou",
    "未配置 Key：地域默认华东 1（杭州）",
    empty.data?.region,
  );
  assert(
    empty.data?.accessKeyIdMasked === "",
    "未配置 Key：不返回打码 Key",
    empty.data?.accessKeyIdMasked,
  );

  for (const [name, method, path] of [
    ["test", "POST", `${BASE}/test`],
    ["sender-addresses", "GET", `${BASE}/sender-addresses`],
    ["receiver-lists", "GET", `${BASE}/receiver-lists?keyWord=`],
  ]) {
    const res = await call(method, path, OWNER);
    assert(
      res.status === 400 &&
        res.code === 400 &&
        messageOf(res).includes("尚未配置阿里云 AccessKey"),
      `未配置 Key：${name} 返回 400 中文引导`,
      `${res.status} ${messageOf(res)}`,
    );
  }

  const noKeyCreateList = await call(
    "POST",
    `${BASE}/receiver-lists`,
    OWNER,
    {
      receiverName: "验证列表",
      receiverAlias: "verify@example.com",
      description: "",
    },
  );
  assert(
    noKeyCreateList.status === 400 &&
      messageOf(noKeyCreateList).includes("尚未配置阿里云 AccessKey"),
    "未配置 Key：新建列表前先要求配置",
    `${noKeyCreateList.status} ${messageOf(noKeyCreateList)}`,
  );

  // ---------- 2. 设置校验 ----------
  const noId = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-hangzhou",
  });
  assert(
    noId.status === 400 && messageOf(noId) === "请填写 AccessKeyId",
    "设置校验：缺 AccessKeyId 被拒",
    `${noId.status} ${messageOf(noId)}`,
  );

  const badId = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: "bad key!",
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-hangzhou",
  });
  assert(
    badId.status === 400 && messageOf(badId).includes("AccessKeyId 格式不正确"),
    "设置校验：AccessKeyId 格式错误被拒",
    `${badId.status} ${messageOf(badId)}`,
  );

  const noSecret = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    region: "cn-hangzhou",
  });
  assert(
    noSecret.status === 400 &&
      messageOf(noSecret) ===
        "请填写 AccessKeySecret（已保存过可留空表示不修改）",
    "设置校验：首次保存必须有 Secret",
    `${noSecret.status} ${messageOf(noSecret)}`,
  );

  const shortSecret = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    accessKeySecret: "short-secret",
    region: "cn-hangzhou",
  });
  assert(
    shortSecret.status === 400 &&
      messageOf(shortSecret).includes("AccessKeySecret 长度不正确"),
    "设置校验：Secret 过短被拒",
    `${shortSecret.status} ${messageOf(shortSecret)}`,
  );

  const badRegion = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-beijing",
  });
  assert(
    badRegion.status === 400 &&
      messageOf(badRegion).includes("不支持该邮件推送地域"),
    "设置校验：不支持的地域被拒",
    `${badRegion.status} ${messageOf(badRegion)}`,
  );

  const saved = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-hangzhou",
  });
  assert(created(saved), "设置保存：假 Key 落库成功", messageOf(saved));
  assert(saved.data?.configured === true, "设置保存：configured=true");
  assert(
    saved.data?.accessKeyIdMasked === "LTAI****rify",
    "设置保存：AccessKeyId 只回显前 4 后 4",
    saved.data?.accessKeyIdMasked,
  );
  assert(
    !JSON.stringify(saved).includes(FAKE_KEY_SECRET),
    "设置保存：响应里不含 AccessKeySecret 明文",
  );

  const keepSecret = await call("POST", `${BASE}/settings`, OWNER, {
    region: "cn-hangzhou",
    defaultReceiverId: "",
  });
  assert(
    created(keepSecret) &&
      keepSecret.data?.hasAccessKeySecret === true &&
      keepSecret.data?.accessKeyIdMasked === "LTAI****rify",
    "设置保存：留空 Key 与 Secret＝保持原值",
    messageOf(keepSecret),
  );

  const reread = await call("GET", `${BASE}/settings`, OWNER);
  assert(
    reread.data?.configured === true &&
      reread.data?.region === "cn-hangzhou" &&
      !JSON.stringify(reread).includes(FAKE_KEY_SECRET),
    "设置读取：回读已打码、无明文",
    messageOf(reread),
  );

  // ---------- 3. 错 Key 的上游错误路径 ----------
  const badSenders = await call("GET", `${BASE}/sender-addresses`, OWNER);
  assert(
    looksLikeOwnChinese(badSenders),
    "错 Key：发信地址列表返回 503 中文提示、不带上游原文",
    `${badSenders.status} ${messageOf(badSenders)}`,
  );

  const badLists = await call(
    "GET",
    `${BASE}/receiver-lists?keyWord=`,
    OWNER,
  );
  assert(
    looksLikeOwnChinese(badLists),
    "错 Key：收件人列表返回 503 中文提示、不踢登录态",
    `${badLists.status} code=${badLists.code}`,
  );

  const badTest = await call("POST", `${BASE}/test`, OWNER);
  assert(
    created(badTest) &&
      badTest.data?.ok === false &&
      badTest.data?.receiverCount === 0 &&
      Array.isArray(badTest.data?.messages) &&
      badTest.data.messages.length === 1 &&
      /^(阿里云|连接阿里云)/.test(badTest.data.messages[0]),
    "错 Key：连通测试如实返回失败项",
    JSON.stringify(badTest.data?.messages || []).slice(0, 120),
  );

  // ---------- 4. 验证表与映射门控 ----------
  const table = await call("POST", "/api/backend/enterprise/data-tables", OWNER, {
    name: `邮件推送验证-${Date.now()}`,
    description: "脚本自建，跑完删除",
  });
  assert(created(table), "建验证表：成功", messageOf(table));
  tableId = Number(table.data?.id || 0);

  const fields = await call(
    "POST",
    `/api/backend/enterprise/data-tables/${tableId}/fields/batch`,
    OWNER,
    {
      fields: [
        { name: "邮箱", fieldKey: "email", fieldType: "text" },
        { name: "姓名", fieldKey: "name", fieldType: "text" },
        { name: "城市", fieldKey: "city", fieldType: "text" },
      ],
    },
  );
  assert(
    created(fields) && Array.isArray(fields.data) && fields.data.length === 3,
    "建验证表：三列写入成功",
    messageOf(fields),
  );

  const previewBody = {
    tableId,
    mode: "new",
    receiverName: "验证列表",
    receiverAlias: "verify@example.com",
    mapping: MAPPING,
  };

  const upstreamPreview = await call("POST", `${BASE}/preview`, OWNER, previewBody);
  assert(
    looksLikeOwnChinese(upstreamPreview),
    "预览：新建模式要回读列表，错 Key 返回 503 中文提示",
    `${upstreamPreview.status} ${messageOf(upstreamPreview)}`,
  );

  const upstreamImport = await call(
    "POST",
    `${BASE}/imports`,
    OWNER,
    previewBody,
  );
  assert(
    looksLikeOwnChinese(upstreamImport),
    "同步：错 Key 建批次失败且不落半条脏批次",
    `${upstreamImport.status} ${messageOf(upstreamImport)}`,
  );

  const noTable = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    tableId: 0,
  });
  assert(
    noTable.status === 400 && messageOf(noTable) === "请选择多维表格",
    "预览校验：未选表被拒",
    `${noTable.status} ${messageOf(noTable)}`,
  );

  for (const [name, mapping, expected] of [
    [
      "未选邮箱列",
      { ...MAPPING, emailFieldKey: "" },
      "请选择邮箱列",
    ],
    [
      "邮箱列不属于这张表",
      { ...MAPPING, emailFieldKey: "not_exists" },
      "邮箱列不属于这张表，请刷新后重选",
    ],
    [
      "变量名只能是英文字母",
      {
        emailFieldKey: "email",
        variables: [{ key: "User1", fieldKey: "name" }],
      },
      "模板变量名「User1」不合法（只能用英文字母，如 UserName）",
    ],
    [
      "变量名不允许重复",
      {
        emailFieldKey: "email",
        variables: [
          { key: "UserName", fieldKey: "name" },
          { key: "UserName", fieldKey: "city" },
        ],
      },
      "模板变量名「UserName」重复",
    ],
    [
      "变量来源列必须属于这张表",
      {
        emailFieldKey: "email",
        variables: [{ key: "City", fieldKey: "not_exists" }],
      },
      "变量 City 的来源列不属于这张表，请刷新后重选",
    ],
  ]) {
    const res = await call("POST", `${BASE}/preview`, OWNER, {
      ...previewBody,
      mapping,
    });
    assert(
      res.status === 400 && messageOf(res) === expected,
      `映射校验：${name}`,
      `${res.status} ${messageOf(res)}`,
    );
  }

  const noName = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    receiverName: "",
  });
  assert(
    noName.status === 400 &&
      messageOf(noName) === "请填写收件人列表名称（1–30 个字符）",
    "新建校验：列表名必填",
    `${noName.status} ${messageOf(noName)}`,
  );

  const badAlias = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    receiverAlias: "not-an-email",
  });
  assert(
    badAlias.status === 400 &&
      messageOf(badAlias) === "列表别称必须是邮箱地址且不超过 30 个字符",
    "新建校验：别称必须是邮箱",
    `${badAlias.status} ${messageOf(badAlias)}`,
  );

  const appendNoTarget = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mode: "append",
    receiverId: "",
  });
  assert(
    appendNoTarget.status === 400 && messageOf(appendNoTarget) === "请选择收件人列表",
    "追加校验：必须选目标列表",
    `${appendNoTarget.status} ${messageOf(appendNoTarget)}`,
  );

  const denied = await call("POST", `${BASE}/preview`, OTHER, previewBody);
  assert(
    denied.status === 403 &&
      denied.code === 20002 &&
      messageOf(denied).includes("未获授权"),
    "表权限：别人没授权的表读不到",
    `${denied.status} code=${denied.code} ${messageOf(denied)}`,
  );

  // ---------- 5. 批次记录 ----------
  const imports = await call("GET", `${BASE}/imports?page=1&pageSize=20`, OWNER);
  assert(
    created(imports) &&
      imports.data?.total === 0 &&
      Array.isArray(imports.data?.list) &&
      imports.data.list.length === 0,
    "批次列表：错 Key 未产生批次，账号仍为空",
    `${messageOf(imports)} total=${imports.data?.total}`,
  );

  const missing = await call(
    "GET",
    `${BASE}/imports/999999999?page=1&pageSize=50`,
    OWNER,
  );
  assert(
    missing.status === 404 && messageOf(missing) === "同步批次不存在",
    "批次详情：不存在时 404 中文提示",
    `${missing.status} ${messageOf(missing)}`,
  );

  const retryMissing = await call(
    "POST",
    `${BASE}/imports/999999999/retry`,
    OWNER,
  );
  assert(
    retryMissing.status === 404 && messageOf(retryMissing) === "同步批次不存在",
    "批次重试：不存在时 404 中文提示",
    `${retryMissing.status} ${messageOf(retryMissing)}`,
  );

  const refreshMissing = await call(
    "POST",
    `${BASE}/imports/999999999/refresh`,
    OWNER,
  );
  assert(
    refreshMissing.status === 404 &&
      messageOf(refreshMissing) === "同步批次不存在",
    "列表人数回读：不存在时 404 中文提示",
    `${refreshMissing.status} ${messageOf(refreshMissing)}`,
  );
}

try {
  await main();
} catch (error) {
  log("脚本异常", false, error?.stack || String(error));
} finally {
  await cleanup()
    .catch((error) => log("清理失败", false, error?.message || String(error)))
    .finally(async () => {
      await prisma.$disconnect();
      console.log(`\n${summary()}`);
      if (counts().failed) process.exitCode = 1;
    });
}
