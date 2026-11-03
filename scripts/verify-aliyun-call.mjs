/**
 * 阿里云智能外呼（营销工具）：接口层实测。
 *
 * 口径：
 * - 打在开发实例（默认 1690）上，用种子账号的真实登录态走 /api/backend/enterprise/aliyun-call/*。
 * - 只验证「不需要通阿里云」与「错误路径」的部分：未配置 Key、错 Key 的中文提示、
 *   映射校验、预览去重/无效号码、确认费用门控、追加任务组的前置校验、未授权表被拒、
 *   批次详情不存在的 404。真实 CreateJobGroup / AssignJobs 需要可用的子账号 AK/SK +
 *   实例 + 已发布话术 + 已绑定号码，本脚本不伪造这部分结论。
 * - 测试自己建表建行、自己配一份临时假 Key，结束时把这两样都清掉（账号回到初始状态）。
 *
 * 用法：node scripts/verify-aliyun-call.mjs [BASE_URL]
 */
import { createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.argv[2] || "http://127.0.0.1:1690",
});
const { call, assert, log, summary, counts } = suite;

const OWNER = "demo_flex3";
const OTHER = "demo_legal";
const BASE = "/api/backend/enterprise/aliyun-call";
const FAKE_KEY_ID = "LTAI5tFakeKeyForAliyunCallVerify";
const FAKE_KEY_SECRET = "fake-secret-not-a-real-credential";

const prisma = createPrisma();
let tableId = 0;

const created = (res) => res.code === 0;
const messageOf = (res) => String(res.message || "");

async function cleanup() {
  if (tableId) {
    await call("DELETE", `/api/backend/enterprise/data-tables/${tableId}`, OWNER);
    tableId = 0;
  }
  const row = await prisma.aliyunCallSetting.findUnique({
    where: { userId: suite.users[OWNER].userId },
  });
  if (row) {
    await prisma.aliyunCallSetting.delete({ where: { id: row.id } });
  }
  await prisma.aliyunCallImport.deleteMany({
    where: { userId: suite.users[OWNER].userId },
  });
}

async function main() {
  // ---------- 1. 未配置 Key ----------
  const empty = await call("GET", `${BASE}/settings`, OWNER);
  assert(created(empty), "未配置 Key：设置读取成功", messageOf(empty));
  assert(empty.data?.configured === false, "未配置 Key：configured=false");
  assert(empty.data?.hasSecret === false, "未配置 Key：hasSecret=false");
  assert(
    empty.data?.region === "cn-shanghai",
    "未配置 Key：地域固定华东 2（上海）",
    empty.data?.region,
  );

  for (const [name, path] of [
    ["instances", `${BASE}/instances`],
    ["test", `${BASE}/test`],
    ["job-groups", `${BASE}/job-groups?instanceId=any`],
  ]) {
    const res = await call(
      path.endsWith("/test") ? "POST" : "GET",
      path,
      OWNER,
    );
    assert(
      res.status === 400 &&
        messageOf(res).includes("尚未配置阿里云 AccessKey"),
      `未配置 Key：${name} 返回 400 中文引导`,
      `${res.status} ${messageOf(res)}`,
    );
  }

  // ---------- 2. 设置校验 ----------
  const noId = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-shanghai",
    instanceId: "",
  });
  assert(
    noId.status === 400 && messageOf(noId).includes("AccessKeyId"),
    "设置校验：缺 AccessKeyId 被拒",
    `${noId.status} ${messageOf(noId)}`,
  );

  const noSecret = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    region: "cn-shanghai",
    instanceId: "",
  });
  assert(
    noSecret.status === 400 && messageOf(noSecret).includes("AccessKeySecret"),
    "设置校验：缺 AccessKeySecret 被拒",
    `${noSecret.status} ${messageOf(noSecret)}`,
  );

  const badRegion = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-beijing",
    instanceId: "",
  });
  assert(
    badRegion.status === 400 && messageOf(badRegion).includes("华东 2（上海）"),
    "设置校验：不支持的地域被拒",
    `${badRegion.status} ${messageOf(badRegion)}`,
  );

  const saved = await call("POST", `${BASE}/settings`, OWNER, {
    accessKeyId: FAKE_KEY_ID,
    accessKeySecret: FAKE_KEY_SECRET,
    region: "cn-shanghai",
    instanceId: "",
  });
  assert(created(saved), "设置保存：假 Key 落库成功", messageOf(saved));
  assert(saved.data?.configured === true, "设置保存：configured=true");
  assert(
    saved.data?.accessKeyIdMasked &&
      saved.data.accessKeyIdMasked !== FAKE_KEY_ID,
    "设置保存：AccessKeyId 只回显打码值",
    saved.data?.accessKeyIdMasked,
  );
  assert(
    !JSON.stringify(saved).includes(FAKE_KEY_SECRET),
    "设置保存：响应里不含 AccessKeySecret 明文",
  );

  const dropSecret = await call("POST", `${BASE}/settings`, OWNER, {
    region: "cn-shanghai",
    instanceId: "",
  });
  assert(
    created(dropSecret) && dropSecret.data?.hasSecret === true,
    "设置保存：留空密钥＝保持原密钥不变",
    messageOf(dropSecret),
  );

  // ---------- 3. 错 Key 的错误路径 ----------
  const badKeyInstances = await call("GET", `${BASE}/instances`, OWNER);
  assert(
    badKeyInstances.status !== 200 && badKeyInstances.code !== 401,
    "错 Key：上游鉴权失败不会变成本地 401",
    `${badKeyInstances.status} code=${badKeyInstances.code}`,
  );
  assert(
    /阿里云|AccessKey|权限|网络|实例/.test(messageOf(badKeyInstances)) &&
      !/InvalidAccessKeyId|SignatureDoesNotMatch|SDK/.test(
        messageOf(badKeyInstances),
      ),
    "错 Key：返回中文可操作提示、不暴露上游原文",
    messageOf(badKeyInstances),
  );

  const badKeyTest = await call("POST", `${BASE}/test`, OWNER);
  assert(
    created(badKeyTest) &&
      badKeyTest.data?.ok === false &&
      Array.isArray(badKeyTest.data?.messages) &&
      badKeyTest.data.messages.length > 0,
    "错 Key：连通测试如实返回失败项",
    JSON.stringify(badKeyTest.data?.messages || []).slice(0, 160),
  );

  const badKeyGroups = await call(
    "GET",
    `${BASE}/job-groups?instanceId=any&page=1&pageSize=20`,
    OWNER,
  );
  assert(
    badKeyGroups.status !== 200 && badKeyGroups.code !== 401,
    "错 Key：任务组列表失败但不踢登录态",
    `${badKeyGroups.status} code=${badKeyGroups.code}`,
  );

  // ---------- 4. 多维表格与预览 ----------
  const table = await call("POST", "/api/backend/enterprise/data-tables", OWNER, {
    name: `阿里云外呼验证-${Date.now()}`,
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
        { name: "手机号", fieldKey: "phone", fieldType: "text" },
        { name: "姓名", fieldKey: "name", fieldType: "text" },
        { name: "性别", fieldKey: "gender", fieldType: "text" },
        { name: "城市", fieldKey: "city", fieldType: "text" },
      ],
    },
  );
  assert(
    created(fields) && Array.isArray(fields.data) && fields.data.length === 4,
    "建验证表：四列写入成功",
    messageOf(fields),
  );

  const rows = [
    { phone: "13800138000", name: "张三", gender: "男", city: "杭州" },
    { phone: "13800138000", name: "张三重复", gender: "男", city: "杭州" },
    { phone: "13512345678", name: "李四", gender: "女", city: "上海" },
    { phone: "not-a-phone", name: "王五", gender: "男", city: "北京" },
    { phone: "", name: "赵六", gender: "女", city: "广州" },
  ];
  for (const row of rows) {
    const added = await call(
      "POST",
      `/api/backend/enterprise/data-tables/${tableId}/rows`,
      OWNER,
      { data: row },
    );
    assert(created(added), `建验证表：写入「${row.name}」`, messageOf(added));
  }

  const mapping = {
    phoneFieldKey: "phone",
    nameFieldKey: "name",
    honorificMode: "gender",
    honorificFieldKey: "",
    honorificValue: "",
    genderFieldKey: "gender",
    roleFieldKey: "",
    extras: [{ key: "city", sourceType: "field", fieldKey: "city", value: "" }],
  };
  const previewBody = {
    tableId,
    mapping,
    mode: "new",
    jobGroupId: "",
    skipExisting: true,
  };

  const preview = await call("POST", `${BASE}/preview`, OWNER, previewBody);
  assert(created(preview), "预览：读取成功", messageOf(preview));
  assert(preview.data?.totalRows === 5, "预览：总行数 5", preview.data?.totalRows);
  assert(
    preview.data?.validRows === 2,
    "预览：两条有效号码",
    preview.data?.validRows,
  );
  assert(
    preview.data?.duplicateRows === 1,
    "预览：表内重复 1 行",
    preview.data?.duplicateRows,
  );
  assert(
    preview.data?.invalidRows === 2,
    "预览：无效号码 2 行（格式错 / 空）",
    preview.data?.invalidRows,
  );
  assert(
    preview.data?.existingRows === 0,
    "预览：还没有历史批次，已导入跳过 0",
    preview.data?.existingRows,
  );
  assert(
    Array.isArray(preview.data?.errors) && preview.data.errors.length === 0,
    "预览：没有阻断错误",
    JSON.stringify(preview.data?.errors || []),
  );
  const genders = (preview.data?.sample || [])
    .filter((item) => item.status === "ok")
    .map((item) => item.honorific)
    .sort();
  assert(
    genders.length === 2 && genders[0] === "先生" && genders[1] === "女士",
    "预览：称谓按性别生成（男→先生 / 女→女士）",
    genders.join("/"),
  );
  assert(
    (preview.data?.sample || []).every(
      (item) => !String(item.phoneMasked || "").includes("13800138000"),
    ),
    "预览：样例行号码打码，不回显完整号码",
  );

  const noPhone = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mapping: { ...mapping, phoneFieldKey: "" },
  });
  assert(
    noPhone.status === 400 && messageOf(noPhone).includes("被叫号码"),
    "预览校验：未选被叫号码列被拒",
    `${noPhone.status} ${messageOf(noPhone)}`,
  );

  const foreignField = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mapping: { ...mapping, phoneFieldKey: "not_exists" },
  });
  assert(
    foreignField.status === 400 && messageOf(foreignField).includes("不属于这张表"),
    "预览校验：映射列必须属于这张表",
    `${foreignField.status} ${messageOf(foreignField)}`,
  );

  const genderNoColumn = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mapping: { ...mapping, genderFieldKey: "" },
  });
  assert(
    genderNoColumn.status === 400 && messageOf(genderNoColumn).includes("性别"),
    "预览校验：按性别生成称谓必须选性别列",
    `${genderNoColumn.status} ${messageOf(genderNoColumn)}`,
  );

  const fixedEmpty = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mapping: {
      ...mapping,
      honorificMode: "fixed",
      genderFieldKey: "",
      honorificValue: "",
    },
  });
  assert(
    fixedEmpty.status === 400 && messageOf(fixedEmpty).includes("称谓"),
    "预览校验：固定称谓必须填内容",
    `${fixedEmpty.status} ${messageOf(fixedEmpty)}`,
  );

  const badExtra = await call("POST", `${BASE}/preview`, OWNER, {
    ...previewBody,
    mapping: {
      ...mapping,
      extras: [{ key: "城市-cn", sourceType: "field", fieldKey: "city", value: "" }],
    },
  });
  assert(
    badExtra.status === 400 && messageOf(badExtra).includes("不合法"),
    "预览校验：自定义变量名只允许英文数字下划线",
    `${badExtra.status} ${messageOf(badExtra)}`,
  );

  // ---------- 5. 未授权表 ----------
  const denied = await call("POST", `${BASE}/preview`, OTHER, previewBody);
  assert(
    denied.status === 403 || denied.status === 404,
    "表权限：别人没授权的表读不到",
    `${denied.status} ${messageOf(denied)}`,
  );
  assert(
    denied.status !== 500 && /无权|不存在|权限|授权/.test(messageOf(denied)),
    "表权限：拒绝原因是中文权限/不存在说明",
    messageOf(denied),
  );

  // ---------- 6. 导入门控 ----------
  const noConfirm = await call("POST", `${BASE}/imports`, OWNER, {
    ...previewBody,
    instanceId: "irrelevant",
    scriptId: "script",
    jobGroupName: "验证任务组",
    strategy: {},
    callingNumbers: [],
    writeBack: true,
  });
  assert(
    noConfirm.status === 400 &&
      messageOf(noConfirm).includes("真实通话费用"),
    "导入门控：未确认费用被拒",
    `${noConfirm.status} ${messageOf(noConfirm)}`,
  );

  const noInstance = await call("POST", `${BASE}/imports`, OWNER, {
    ...previewBody,
    confirmCost: true,
    instanceId: "",
    scriptId: "script",
    jobGroupName: "验证任务组",
    strategy: {},
    callingNumbers: [],
    writeBack: true,
  });
  assert(
    noInstance.status === 400 && messageOf(noInstance).includes("业务实例"),
    "导入门控：未选实例被拒",
    `${noInstance.status} ${messageOf(noInstance)}`,
  );

  const appendNoGroup = await call("POST", `${BASE}/imports`, OWNER, {
    ...previewBody,
    mode: "append",
    confirmCost: true,
    instanceId: "irrelevant",
    scriptId: "",
    jobGroupName: "",
    strategy: {},
    callingNumbers: [],
    writeBack: true,
  });
  assert(
    appendNoGroup.status === 400 && messageOf(appendNoGroup).includes("任务组"),
    "导入门控：追加模式必须选任务组",
    `${appendNoGroup.status} ${messageOf(appendNoGroup)}`,
  );

  const newNoScript = await call("POST", `${BASE}/imports`, OWNER, {
    ...previewBody,
    confirmCost: true,
    instanceId: "irrelevant",
    scriptId: "",
    jobGroupName: "验证任务组",
    strategy: {},
    callingNumbers: [],
    writeBack: true,
  });
  assert(
    newNoScript.status === 400 && messageOf(newNoScript).includes("话术"),
    "导入门控：新建模式必须选已发布话术",
    `${newNoScript.status} ${messageOf(newNoScript)}`,
  );

  // ---------- 7. 批次与详情 ----------
  const imports = await call("GET", `${BASE}/imports?page=1&pageSize=20`, OWNER);
  assert(
    created(imports) &&
      Array.isArray(imports.data?.list) &&
      imports.data.list.length === 0,
    "批次列表：新账号为空",
    messageOf(imports),
  );

  const missing = await call(
    "GET",
    `${BASE}/imports/999999999?page=1&pageSize=50`,
    OWNER,
  );
  assert(
    missing.status === 404 && messageOf(missing).includes("导入批次不存在"),
    "批次详情：不存在时 404 中文提示",
    `${missing.status} ${messageOf(missing)}`,
  );
  const retryMissing = await call(
    "POST",
    `${BASE}/imports/999999999/retry`,
    OWNER,
  );
  assert(
    retryMissing.status === 404 && messageOf(retryMissing).includes("导入批次不存在"),
    "批次重试：不存在时 404 中文提示",
    `${retryMissing.status} ${messageOf(retryMissing)}`,
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
