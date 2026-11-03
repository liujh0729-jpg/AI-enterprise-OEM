// 权限与凭据收口实测：越权拒绝、上传白名单、上游不回落凭据。
// 用法：node scripts/regression-instance.mjs -- node scripts/security-check.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertChannelOff } from "./regression-guard.mjs";
import { ROOT, createPrisma, createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, token, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);
const prisma = createPrisma();

/** 权限拒绝专指 ROLE_MISMATCH(20002)：403 也可能是「能力未开通」等业务门控。 */
const denied = (r) => r.status === 403 && r.data?.code === 20002;
/**
 * 正向对照＝身份/可见性门控确实放行。旧写法 `!denied(r)` 放水：只要不是 20002 就算通过，
 * 于是「换成 20001／401 挡住承办职员」这种真越权回归也测不出来。
 * 403 FORBIDDEN 不在此列——它是业务门控（实测：「电子报税（自动申报）未开通…经平台管理员审核通过」），
 * 权限已经过了，只是能力没开通，不该判失败。5xx 一律判失败。
 */
const IDENTITY_CODES = [401, 20001, 20002];
const guardPassed = (r) =>
  !IDENTITY_CODES.includes(r.data?.code) && r.status !== 401 && r.status < 500;

const enterprise = await prisma.enterpriseProfile.findFirstOrThrow({
  where: { userId: users.demo_enterprise.userId },
});
const decl = await prisma.taxDeclaration.findFirst({
  where: { enterpriseId: enterprise.id },
  orderBy: { id: "desc" },
});
const usernameOf = (userId) =>
  Object.entries(users).find(([, row]) => row.userId === userId)?.[0] || null;

const workOrder = await prisma.flexWorkOrder.findFirst({
  where: { enterpriseId: enterprise.id },
  orderBy: { id: "desc" },
});

console.log("A. 企享云（已开发票查询 / 自动申报 / 自动开票）");
const invUnrelated = await api(
  "GET",
  `/enterprise/qxy/enterprises/${enterprise.id}/invoices`,
  null,
  "demo_logistics",
);
assert(
  denied(invUnrelated),
  "unrelated provider cannot read another enterprise's invoices",
  `${invUnrelated.status} ${invUnrelated.data?.message || ""}`,
);
const invParty = await api(
  "GET",
  `/enterprise/qxy/enterprises/${enterprise.id}/invoices`,
  null,
  "demo_enterprise",
);
assert(
  guardPassed(invParty),
  "enterprise party can read own invoices",
  `${invParty.status} ${invParty.data?.message || ""}`,
);
const invStaff = await api(
  "GET",
  `/enterprise/qxy/enterprises/${enterprise.id}/invoices`,
  null,
  "demo_staff2",
);
assert(
  guardPassed(invStaff),
  "serving tax staff can read invoices",
  `${invStaff.status} ${invStaff.data?.message || ""}`,
);
const invProviderAcct = await api(
  "GET",
  `/enterprise/qxy/enterprises/${enterprise.id}/invoices`,
  null,
  "demo_provider",
);
assert(
  denied(invProviderAcct),
  "provider account without 承办 assignment stays blind (承办唯一)",
  `${invProviderAcct.status} ${invProviderAcct.data?.message || ""}`,
);

const fileUnrelated = await api(
  "POST",
  `/enterprise/qxy/enterprises/${enterprise.id}/auto-file`,
  { period: "2026-08", yzpzzlDm: "BDA0610611", wkpxse: "0" },
  "demo_logistics",
);
assert(
  denied(fileUnrelated),
  "unrelated provider cannot auto-file",
  `${fileUnrelated.status} ${fileUnrelated.data?.message || ""}`,
);
const fileParty = await api(
  "POST",
  `/enterprise/qxy/enterprises/${enterprise.id}/auto-file`,
  { period: "2026-08", yzpzzlDm: "BDA0610611", wkpxse: "0" },
  "demo_enterprise",
);
assert(
  denied(fileParty),
  "enterprise party cannot auto-file (read-only)",
  `${fileParty.status} ${fileParty.data?.message || ""}`,
);
const fileStaff = await api(
  "POST",
  `/enterprise/qxy/enterprises/${enterprise.id}/auto-file`,
  { period: "2026-08", yzpzzlDm: "BDA0610611", wkpxse: "0" },
  "demo_staff2",
);
assert(
  guardPassed(fileStaff),
  "serving tax staff passes permission guard on auto-file",
  `${fileStaff.status} ${fileStaff.data?.message || ""}`,
);
const invoiceParty = await api(
  "POST",
  `/enterprise/qxy/enterprises/${enterprise.id}/auto-invoice`,
  { invoiceType: "1", buyerType: "1", buyerName: "测试", orderNo: "SEC-CHECK" },
  "demo_enterprise",
);
assert(
  denied(invoiceParty),
  "enterprise party cannot auto-invoice (read-only)",
  `${invoiceParty.status} ${invoiceParty.data?.message || ""}`,
);
const qxyEcho = [
  invStaff.data?.message,
  fileStaff.data?.message,
  invParty.data?.message,
].join(" | ");
const envText = readFileSync(join(ROOT, "backend/.env"), "utf8");
const secrets = envText
  .split(/\r?\n/)
  .filter((line) => /^(QXY_APPKEY|QXY_SECRET|JWT_SECRET)=/.test(line))
  .map((line) => line.slice(line.indexOf("=") + 1).trim())
  .filter((v) => v.length > 8);
const leaked = secrets.filter((v) => qxyEcho.includes(v));
assert(
  leaked.length === 0,
  "qxy responses do not echo configured credentials",
  leaked.length ? `泄露 ${leaked.length} 项` : "无凭据回显",
);

console.log("B. 申报单（确认并审核 / 扣款）");
if (decl) {
  const qcParty = await api(
    "POST",
    `/enterprise/tax/declarations/${decl.id}/qc`,
    { action: "PASS", confirms: [] },
    "demo_enterprise",
  );
  assert(
    denied(qcParty),
    "enterprise party cannot review/file declaration",
    `${qcParty.status} ${qcParty.data?.message || ""}`,
  );
  const payParty = await api(
    "POST",
    `/enterprise/tax/declarations/${decl.id}/pay`,
    {},
    "demo_enterprise",
  );
  assert(
    denied(payParty),
    "enterprise party cannot register payment",
    `${payParty.status} ${payParty.data?.message || ""}`,
  );
  const qcOutsider = await api(
    "POST",
    `/enterprise/tax/declarations/${decl.id}/qc`,
    { action: "PASS", confirms: [] },
    "demo_legal",
  );
  assert(
    denied(qcOutsider),
    "unrelated provider cannot review declaration",
    `${qcOutsider.status} ${qcOutsider.data?.message || ""}`,
  );
  const staffActor = decl.staffUserId
    ? users.demo_staff2.userId === decl.staffUserId
      ? "demo_staff2"
      : null
    : null;
  if (staffActor) {
    const qcStaff = await api(
      "POST",
      `/enterprise/tax/declarations/${decl.id}/qc`,
      { action: "PASS", confirms: [] },
      staffActor,
    );
    assert(
      guardPassed(qcStaff),
      "serving staff passes permission guard on review",
      `${qcStaff.status} ${qcStaff.data?.message || ""}`,
    );
  } else {
    log(
      "declaration staff actor",
      false,
      `申报单 #${decl.id} 未绑定承办职员 staffUserId=${decl.staffUserId || "空"}`,
    );
  }

  console.log("C. 外报任务生成");
  const subParty = await api(
    "POST",
    `/enterprise/external/declarations/${decl.id}/submission`,
    {},
    "demo_enterprise",
  );
  assert(
    denied(subParty) && /承办人/.test(subParty.data?.message || ""),
    "enterprise party cannot create external submission",
    `${subParty.status} ${subParty.data?.message || ""}`,
  );
  const subOutsider = await api(
    "POST",
    `/enterprise/external/declarations/${decl.id}/submission`,
    {},
    "demo_legal",
  );
  assert(
    denied(subOutsider),
    "unrelated provider cannot create external submission",
    `${subOutsider.status} ${subOutsider.data?.message || ""}`,
  );
  const subStaff = await api(
    "POST",
    `/enterprise/external/declarations/${decl.id}/submission`,
    {},
    "demo_staff2",
  );
  assert(
    guardPassed(subStaff),
    "serving staff passes permission guard on external submission",
    `${subStaff.status} ${subStaff.data?.message || ""}`,
  );
} else {
  log("declaration fixtures", false, "该企业没有申报单，B/C 段无法验证");
}

console.log("D. 灵活用工（消息 / 发布）");
const owner = workOrder ? usernameOf(workOrder.providerUserId) : null;
if (workOrder && owner) {
  const msgOutsider = await api(
    "GET",
    `/enterprise/flex/work-orders/${workOrder.id}/messages`,
    null,
    "demo_flex2",
  );
  assert(
    denied(msgOutsider),
    "unrelated provider cannot read work-order messages",
    `${msgOutsider.status} ${msgOutsider.data?.message || ""}`,
  );
  const msgOwner = await api(
    "GET",
    `/enterprise/flex/work-orders/${workOrder.id}/messages`,
    null,
    owner,
  );
  // 承接方读自己的用工需求会话：门控放行且契约成立（规则 67＝会话清单），不只是「没被拒绝」
  assert(
    msgOwner.data?.code === 0 &&
      Array.isArray(msgOwner.data?.data?.conversations) &&
      ["AIWORKIN", "LOCAL"].includes(msgOwner.data?.data?.source),
    "owning provider can read work-order conversations",
    `${msgOwner.status} ${msgOwner.data?.message || ""}`,
  );
  const pubOutsider = await api(
    "POST",
    `/enterprise/flex/work-orders/${workOrder.id}/publish`,
    {},
    "demo_flex2",
  );
  assert(
    denied(pubOutsider),
    "unrelated provider cannot publish work order",
    `${pubOutsider.status} ${pubOutsider.data?.message || ""}`,
  );
  const pubParty = await api(
    "POST",
    `/enterprise/flex/work-orders/${workOrder.id}/publish`,
    {},
    "demo_enterprise",
  );
  assert(
    guardPassed(pubParty),
    "enterprise party (order owner) can publish work order",
    `${pubParty.status} ${pubParty.data?.message || ""}`,
  );
} else {
  log(
    "flex fixtures",
    false,
    `没有 flex 用工需求或服务商账号缺失 (order=${workOrder?.id || "-"} owner=${owner || "-"})`,
  );
}

console.log("E. 法律类目第二家可签（前端锁定已删，后端本就不限）");
// 先读前置：该企业与 demo_legal2 之间是否已有生效签约——有则唯一期望是 409，没有则唯一期望是 0
const preLegal = await prisma.contract.findMany({
  where: {
    enterpriseId: enterprise.id,
    providerUserId: users.demo_legal2.userId,
    serviceType: "LEGAL_SERVICE",
    status: { in: ["PENDING", "ACTIVE"] },
  },
  select: { id: true, status: true },
});
const legalSecond = await api(
  "POST",
  "/enterprise/contracts",
  { providerUserId: users.demo_legal2.userId, service_type: "LEGAL_SERVICE" },
  "demo_enterprise",
);
assert(
  preLegal.length > 0
    ? legalSecond.data?.code === 409
    : legalSecond.data?.code === 0,
  preLegal.length > 0
    ? "second legal provider re-sign blocked by duplicate (not by 限一家)"
    : "second legal provider contract is allowed",
  `${legalSecond.status} ${legalSecond.data?.message || ""} 前置签约=${JSON.stringify(preLegal)}`,
);

console.log("F. 上传白名单（Content-Type 由服务端按扩展名判定）");
const htmlUpload = await api(
  "POST",
  "/enterprise/identity/provider-application/attachments",
  {
    files: [
      {
        name: "xss.html",
        size: 12,
        contentType: "text/html",
        contentBase64: Buffer.from("<h1>x</h1>").toString("base64"),
      },
    ],
  },
  "demo_enterprise",
);
assert(
  htmlUpload.data?.code === 400 && /仅支持/.test(htmlUpload.data?.message || ""),
  "html attachment rejected",
  `${htmlUpload.status} ${htmlUpload.data?.message || ""}`,
);
const pngUpload = await api(
  "POST",
  "/enterprise/identity/provider-application/attachments",
  {
    files: [
      {
        name: "sec-check.png",
        size: 12,
        contentType: "text/html",
        contentBase64: Buffer.from("89504e470d0a1a0a0000000d").toString("base64"),
      },
    ],
  },
  "demo_enterprise",
);
if (
  pngUpload.status === 503 &&
  /文件存储未配置凭据/.test(pngUpload.data?.message || "")
) {
  console.log("SKIP png attachment stored in OSS — 未配置 OSS 凭据");
} else {
  assert(
    pngUpload.data?.code === 0 &&
      /\.png$/.test(pngUpload.data?.data?.files?.[0]?.url || ""),
    "png attachment accepted, content-type derived from extension",
    `${pngUpload.status} ${pngUpload.data?.message || JSON.stringify(pngUpload.data?.data || {})}`,
  );
}

await prisma.$disconnect();
const { passed, failed } = suite.counts();
console.log(`通过 ${passed} 项 · 失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
