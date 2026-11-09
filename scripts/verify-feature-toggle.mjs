/**
 * 功能开关（方案 §5.10）后端口径验证：
 * - 管理端目录/开关收口 requireAdmin；protected 节点拒绝关闭；
 * - 关闭即拦：真实契约路径命中前缀 403 FEATURE_CLOSED(26001)，PLATFORM 全量生效、ORG 只收紧该企业；
 * - GROUP 关闭级联叶子 closed；ORG open 不得越过 PLATFORM closed；
 * - menu 接口（Platform_menu）对登录用户开放，state 为 PLATFORM∪ORG 合并有效态。
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693，见 regression-instance.mjs）。自建自清，不留副作用。
 * 鉴权走本站自签 SSO 会话（createLocalSessionSuite）：两个普通账号由脚本自建自删，不依赖 seed 数据。
 */
import { createLocalSessionSuite } from "./harness.mjs";

const suite = await createLocalSessionSuite();
const { api, log, assert, prisma } = suite;

/** FEATURE_CLOSED 业务码（contracts errors.ts）。 */
const FEATURE_CLOSED = 26001;
/** 参与验证的目录 code：MENU（mail）/ MENU（crm，ORG 收紧用例）/ GROUP（workbench 级联）/ protected（identity）。 */
const MAIL = "mail";
const CRM = "crm";
const WORKBENCH = "workbench";
const IDENTITY = "identity";

const admin = "admin";
const orgUser = "verify-ft-org";
const otherUser = "verify-ft-peer";
let orgUserId = "";

/** 前置自建两个普通账号（存在即复用，跑完删除）：ORG 收紧用例需要两个不同企业身份。 */
async function ensureAccount(username) {
  const existing = await prisma.account.findFirst({ where: { username } });
  if (existing) return existing;
  return prisma.account.create({
    data: { username, role: "USER" },
  });
}

/** 从信封里取节点（features/menu 平铺数组）。 */
function nodeOf(list, code) {
  return (list || []).find((item) => item.code === code);
}

async function catalog(path = "/enterprise/platform/features") {
  const res = await api("GET", path, null, admin);
  return res.data?.data || [];
}

async function setToggle(body) {
  return api("POST", "/enterprise/platform/features/toggle", {
    scope: "PLATFORM",
    orgUserId: "",
    ...body,
  }, admin);
}

try {
  const health = await api("GET", "/health");
  assert(health.data?.code === 0, "health");

  const orgRow = await ensureAccount(orgUser);
  await ensureAccount(otherUser);
  orgUserId = String(orgRow.id);

  // 干净起点：清掉历史残留的验证涉及开关行（dev 库可能有往次 smoke 遗留）
  await prisma.featureToggle.deleteMany({
    where: { code: { in: [MAIL, CRM, WORKBENCH, IDENTITY] } },
  });
  // 后端求值缓存有 15s TTL 且只被写请求作废：补一次 admin 写（mail open）强制重建，避免首读拿到往次残留缓存
  await setToggle({ code: MAIL, state: "open" });

  // ---------- 权限收口 ----------
  const deniedList = await api("GET", "/enterprise/platform/features", null, orgUser);
  assert(
    deniedList.status === 403 && deniedList.data?.code !== 0,
    "非管理员读管理端目录被拒（requireAdmin）",
    `http=${deniedList.status} code=${deniedList.data?.code}`,
  );
  const deniedToggle = await setToggle({ code: MAIL, state: "closed" });
  // admin 允许；再用普通用户直接发 toggle 验证收口
  const deniedOrgToggle = await api(
    "POST",
    "/enterprise/platform/features/toggle",
    { code: MAIL, state: "closed", scope: "PLATFORM", orgUserId: "" },
    orgUser,
  );
  assert(
    deniedOrgToggle.status === 403 && deniedOrgToggle.data?.code !== 0,
    "非管理员设置开关被拒（requireAdmin）",
    `http=${deniedOrgToggle.status} code=${deniedOrgToggle.data?.code}`,
  );
  void deniedToggle;

  // ---------- 目录结构与播种 ----------
  const catalogRows = await catalog();
  assert(catalogRows.length > 20, "管理端目录已播种（>20 节点）", `实际 ${catalogRows.length}`);
  const mailNode = nodeOf(catalogRows, MAIL);
  assert(
    mailNode && mailNode.kind === "MENU" && mailNode.path === "/mail" && !mailNode.protected,
    "mail 为可关 MENU 节点（path=/mail）",
    JSON.stringify(mailNode || {}),
  );
  const identityNode = nodeOf(catalogRows, IDENTITY);
  assert(identityNode?.protected === true, "identity 为 protected 节点（合规退出组）");
  const workbenchNode = nodeOf(catalogRows, WORKBENCH);
  assert(workbenchNode?.kind === "GROUP", "workbench 为 GROUP 节点");

  // ---------- protected 拒绝关闭 ----------
  const protectedClose = await setToggle({ code: IDENTITY, state: "closed" });
  assert(
    protectedClose.status === 400 &&
      String(protectedClose.data?.message || "").includes("不允许关闭") &&
      protectedClose.data?.code !== 0,
    "protected 节点拒绝关闭（400＋文案）",
    `http=${protectedClose.status} msg=${protectedClose.data?.message || ""}`,
  );

  // ---------- PLATFORM 关闭：直链拦截 + 菜单状态 + GROUP 级联 ----------
  const closeMail = await setToggle({ code: MAIL, state: "closed" });
  assert(
    closeMail.data?.code === 0 && closeMail.data?.data?.state === "closed",
    "toggle 关闭 mail 返回 state=closed",
    JSON.stringify(closeMail.data?.data || {}),
  );
  // 注：根层 app 只转发契约 endpoints 表里的路径进 business（gate 中间件所在链），
  // 因此拦截验证必须用真实契约路径，不能用假造的 __verify_gate。
  const blockedMail = await api("GET", "/enterprise/mail/accounts", null, orgUser);
  assert(
    blockedMail.status === 403 && blockedMail.data?.code === FEATURE_CLOSED,
    "mail 关闭后直链 /enterprise/mail/* 403 FEATURE_CLOSED(26001)",
    `http=${blockedMail.status} code=${blockedMail.data?.code}`,
  );
  const blockedMailOther = await api("GET", "/enterprise/mail/accounts", null, otherUser);
  assert(
    blockedMailOther.data?.code === FEATURE_CLOSED,
    "PLATFORM 关闭对所有账号生效（他账号同拦）",
  );
  const menuAfterClose = await api("GET", "/enterprise/platform/menu", null, orgUser);
  assert(
    nodeOf(menuAfterClose.data?.data, MAIL)?.state === "closed",
    "menu 接口 mail 节点 state=closed（登录用户可读）",
  );
  assert(
    menuAfterClose.status === 200 && menuAfterClose.data?.code === 0,
    "menu 接口对登录用户开放（非管理端 403）",
  );

  // GROUP 关闭 → 叶子级联 closed（mail 挂 workbench 下）
  const closeGroup = await setToggle({ code: WORKBENCH, state: "closed" });
  assert(closeGroup.data?.code === 0, "toggle 关闭 GROUP workbench");
  const menuCascaded = await api("GET", "/enterprise/platform/menu", null, orgUser);
  const cascadeRows = menuCascaded.data?.data || [];
  const mailCascade = nodeOf(cascadeRows, MAIL);
  const crmCascade = nodeOf(cascadeRows, CRM);
  assert(
    mailCascade?.state === "closed" && crmCascade?.state === "closed",
    "GROUP closed 级联到叶子（mail/crm 均显示 closed，即便自身无开关行）",
    `mail=${mailCascade?.state} crm=${crmCascade?.state}`,
  );
  const reopenGroup = await setToggle({ code: WORKBENCH, state: "open" });
  assert(reopenGroup.data?.code === 0, "toggle 恢复 GROUP workbench");

  // ---------- PLATFORM open 时 ORG 收紧只对目标企业生效 ----------
  const closeOrgCrm = await api(
    "POST",
    "/enterprise/platform/features/toggle",
    { code: CRM, state: "closed", scope: "ORG", orgUserId },
    admin,
  );
  assert(
    closeOrgCrm.data?.code === 0 && closeOrgCrm.data?.data?.state === "open",
    "ORG 关闭返回管理端视角 state=open（PLATFORM 行仍 open）",
    JSON.stringify(closeOrgCrm.data?.data || {}),
  );
  const blockedOrgCrm = await api("GET", "/enterprise/crm/settings", null, orgUser);
  assert(
    blockedOrgCrm.status === 403 && blockedOrgCrm.data?.code === FEATURE_CLOSED,
    "ORG 收紧后该企业直链被拦",
    `http=${blockedOrgCrm.status} code=${blockedOrgCrm.data?.code}`,
  );
  const otherCrm = await api("GET", "/enterprise/crm/settings", null, otherUser);
  assert(
    otherCrm.data?.code !== FEATURE_CLOSED,
    "ORG 收紧不影响其他企业（非 26001）",
    `code=${otherCrm.data?.code}`,
  );
  const menuOrgView = await api("GET", "/enterprise/platform/menu", null, orgUser);
  assert(
    nodeOf(menuOrgView.data?.data, CRM)?.state === "closed",
    "menu 按身份合并：该企业视角 crm state=closed",
  );
  const menuOtherView = await api("GET", "/enterprise/platform/menu", null, otherUser);
  assert(
    nodeOf(menuOtherView.data?.data, CRM)?.state === "open",
    "menu 按身份合并：他企业视角 crm 仍 open",
  );

  // ---------- PLATFORM closed 时 ORG open 被拒 ----------
  const closePlatformCrm = await setToggle({ code: CRM, state: "closed" });
  assert(closePlatformCrm.data?.code === 0, "toggle 关闭 PLATFORM crm");
  const orgOpenInvalid = await api(
    "POST",
    "/enterprise/platform/features/toggle",
    { code: CRM, state: "open", scope: "ORG", orgUserId },
    admin,
  );
  assert(
    orgOpenInvalid.status === 400 &&
      String(orgOpenInvalid.data?.message || "").includes("平台级处于关闭状态"),
    "平台级关闭时企业级「打开」被拒（避免误导性覆盖行）",
    `http=${orgOpenInvalid.status} msg=${orgOpenInvalid.data?.message || ""}`,
  );

  // ---------- protected 前缀永不拦：points 板块关闭不影响平台管理接口 ----------
  const adminPoints = await api("GET", "/enterprise/points/billing-rules", null, admin);
  assert(
    adminPoints.data?.code === 0,
    "/enterprise/platform 与 /enterprise/points protected 前缀不受开关影响",
  );

  // ---------- 恢复 ----------
  const openPlatformCrm = await setToggle({ code: CRM, state: "open" });
  assert(openPlatformCrm.data?.code === 0, "toggle 恢复 PLATFORM crm");
  // ORG 收紧行独立存在（平台 open 不自动回开企业级），需显式恢复后才不影响菜单断言
  const openOrgCrm = await api(
    "POST",
    "/enterprise/platform/features/toggle",
    { code: CRM, state: "open", scope: "ORG", orgUserId },
    admin,
  );
  assert(openOrgCrm.data?.code === 0, "toggle 恢复 ORG crm（自建企业行）");
  const openMail = await setToggle({ code: MAIL, state: "open" });
  assert(openMail.data?.code === 0, "toggle 恢复 mail");
  const menuRestored = await api("GET", "/enterprise/platform/menu", null, orgUser);
  const restoredRows = menuRestored.data?.data || [];
  assert(
    [MAIL, CRM, WORKBENCH].every((code) => nodeOf(restoredRows, code)?.state === "open"),
    "恢复后该企业视角涉及节点全 open（其它节点历史设置不由本脚本负责）",
    JSON.stringify(restoredRows.filter((node) => node.state !== "open").map((node) => node.code)),
  );
} finally {
  // 清理：本脚本涉及的开关行与自建账号全部归零
  await prisma.featureToggle.deleteMany({
    where: { code: { in: [MAIL, CRM, WORKBENCH, IDENTITY] } },
  });
  await prisma.account.deleteMany({ where: { username: { in: [orgUser, otherUser] } } });
  const left = await prisma.featureToggle.count({
    where: { code: { in: [MAIL, CRM, WORKBENCH, IDENTITY] } },
  });
  log("清理：验证开关行已归零", left === 0, `残留 ${left} 条`);
  await prisma.$disconnect();
}

const { passed, failed } = suite.counts();
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
