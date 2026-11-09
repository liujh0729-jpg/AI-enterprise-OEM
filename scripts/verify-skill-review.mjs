/**
 * 技能包安全审查（方案 §5.9）管理端口径验证：
 * - 台账/放行接口 requireAdmin 收口；分页结构可查；
 * - 先审后用：reviewStatus≠passed 的技能启用即 403 SKILL_NOT_PASSED(26002)；
 * - 人工放行/终裁改写 reviewStatus＋reviewedBy=admin:userId；停用不受审查门约束；
 * - 目标不存在返回 NOT_FOUND；访问策略接口 admin 可读写口径。
 * 审查执行引擎（静态六红线＋LLM 绝对安全门）由 backend/.tmp/review-smoke.ts 单元级覆盖，
 * 本脚本验证接口面＋数据面。目标实例由 BASE_URL 指定。自建自清，不留副作用。
 * 鉴权走本站自签 SSO 会话（createLocalSessionSuite）：owner 账号自建自删，不依赖 seed 数据。
 */
import { createLocalSessionSuite } from "./harness.mjs";

const suite = await createLocalSessionSuite();
const { api, log, assert, prisma } = suite;

/** SKILL_NOT_PASSED 业务码（contracts errors.ts）。 */
const SKILL_NOT_PASSED = 26002;

const admin = "admin";
const owner = "verify-sr-owner";
let ownerUserId = "";
const SKILL_NAME = "verify skill-review 用例包";

/** 前置自建普通账号（存在即复用，跑完删除）：技能行挂在该账号名下。 */
async function ensureAccount(username) {
  const existing = await prisma.account.findFirst({ where: { username } });
  if (existing) return existing;
  return prisma.account.create({
    data: { username, role: "USER" },
  });
}

let skillId = 0;

try {
  const health = await api("GET", "/health");
  assert(health.data?.code === 0, "health");

  const ownerRow = await ensureAccount(owner);
  ownerUserId = String(ownerRow.id);

  // ---------- 权限收口 ----------
  const deniedRuns = await api("GET", "/enterprise/platform/skill-reviews?page=1&pageSize=5", null, owner);
  assert(
    deniedRuns.status === 403 && deniedRuns.data?.code !== 0,
    "非管理员读审查台账被拒（requireAdmin）",
    `http=${deniedRuns.status} code=${deniedRuns.data?.code}`,
  );
  const runs = await api("GET", "/enterprise/platform/skill-reviews?page=1&pageSize=5", null, admin);
  assert(
    runs.data?.code === 0 && Array.isArray(runs.data?.data?.list) && typeof runs.data?.data?.total === "number",
    "台账分页信封结构（list/total/page/size）",
    `total=${runs.data?.data?.total ?? "-"}`,
  );

  // ---------- 构造 pending 技能（模拟存量/人工重审中的状态：上传主链路已改为同步审查，不再产生 pending） ----------
  await prisma.contentAgentSkill.deleteMany({ where: { userId: ownerUserId, name: SKILL_NAME } });
  const skill = await prisma.contentAgentSkill.create({
    data: {
      userId: ownerUserId,
      name: SKILL_NAME,
      description: "验证 §5.9 先审后用：本条为脚本自建技能，跑完即删。",
      content: "# verify\n安全正文，无外联无脚本。",
      enabled: false,
      reviewStatus: "pending",
    },
  });
  skillId = skill.id;

  // ---------- 未过审：启用被拦 ----------
  const enableBlocked = await api(
    "POST",
    `/enterprise/content/agent/skills/${skillId}`,
    { enabled: true },
    owner,
  );
  const enableToggle = await api(
    "PUT",
    `/enterprise/content/agent/skills/${skillId}`,
    { enabled: true },
    owner,
  );
  assert(
    enableToggle.status === 403 && enableToggle.data?.code === SKILL_NOT_PASSED,
    "pending 技能启用被拦（PUT 403 SKILL_NOT_PASSED=26002）",
    `http=${enableToggle.status} code=${enableToggle.data?.code} msg=${enableToggle.data?.message || ""}`,
  );
  void enableBlocked;
  const stillPending = await prisma.contentAgentSkill.findUnique({ where: { id: skillId } });
  assert(
    stillPending?.enabled === false && stillPending?.reviewStatus === "pending",
    "拦截后行状态不变（enabled=false / pending）",
  );

  // 本人列表可见且带审查状态（gating 只影响注入系统提示的摘要集，不影响管理列表）
  const list = await api("GET", "/enterprise/content/agent/skills", null, owner);
  const row = (list.data?.data || []).find((item) => item.id === skillId);
  assert(
    row?.reviewStatus === "pending",
    "本人技能列表行含 reviewStatus=pending",
    JSON.stringify({ reviewStatus: row?.reviewStatus, hasMessage: "reviewMessage" in (row || {}) }),
  );

  // ---------- 人工放行 ----------
  const pass = await api(
    "POST",
    "/enterprise/platform/skill-reviews/decision",
    { kind: "skill", itemId: skillId, decision: "passed", note: "verify 人工放行" },
    admin,
  );
  assert(
    pass.data?.code === 0 && pass.data?.data?.reviewStatus === "passed",
    "decision=passed 返回 reviewStatus=passed",
    JSON.stringify(pass.data?.data || {}),
  );
  const passedRow = await prisma.contentAgentSkill.findUnique({ where: { id: skillId } });
  assert(
    passedRow?.reviewStatus === "passed" &&
      String(passedRow?.reviewedBy || "").startsWith("admin:") &&
      passedRow?.reviewedAt != null,
    "放行落库：passed＋reviewedBy=admin:userId＋reviewedAt",
    `reviewedBy=${passedRow?.reviewedBy}`,
  );

  // 放行后可启用（enabledPlugins/promptSummaries 的 gating 前提）
  const enableOk = await api(
    "PUT",
    `/enterprise/content/agent/skills/${skillId}`,
    { enabled: true },
    owner,
  );
  assert(
    enableOk.data?.code === 0 && enableOk.data?.data?.enabled === true,
    "passed 后启用放行（enabled=true）",
    `code=${enableOk.data?.code}`,
  );

  // ---------- 人工终裁拒绝 ----------
  const reject = await api(
    "POST",
    "/enterprise/platform/skill-reviews/decision",
    { kind: "skill", itemId: skillId, decision: "rejected", note: "verify 终裁拒绝" },
    admin,
  );
  assert(reject.data?.code === 0 && reject.data?.data?.reviewStatus === "rejected", "decision=rejected 落库");

  // 停用不受审查门约束；停用后再启用被拦（rejected 文案口径）
  const disableOk = await api(
    "PUT",
    `/enterprise/content/agent/skills/${skillId}`,
    { enabled: false },
    owner,
  );
  assert(disableOk.data?.code === 0, "rejected 后仍允许停用（关闭自由、启用受审）");
  const enableAfterReject = await api(
    "PUT",
    `/enterprise/content/agent/skills/${skillId}`,
    { enabled: true },
    owner,
  );
  assert(
    enableAfterReject.status === 403 && enableAfterReject.data?.code === SKILL_NOT_PASSED,
    "rejected 后再启用被拦（26002）",
    `code=${enableAfterReject.data?.code} msg=${enableAfterReject.data?.message || ""}`,
  );

  // ---------- 目标不存在 ----------
  const missing = await api(
    "POST",
    "/enterprise/platform/skill-reviews/decision",
    { kind: "skill", itemId: 99999999, decision: "passed", note: "" },
    admin,
  );
  assert(
    missing.status === 404 && missing.data?.code !== 0,
    "decision 目标不存在返回 NOT_FOUND",
    `http=${missing.status} code=${missing.data?.code}`,
  );

  // ---------- 访问策略（§5.9 配套）：admin 可读、结构完整 ----------
  const policy = await api("GET", "/enterprise/platform/access-policy", null, admin);
  assert(
    policy.data?.code === 0 &&
      Array.isArray(policy.data?.data?.blacklist) &&
      typeof policy.data?.data?.limits?.minIntervalMs === "number" &&
      Array.isArray(policy.data?.data?.limits?.allowMethods),
    "访问策略读取（blacklist＋limits 默认值）",
    `blacklist=${policy.data?.data?.blacklist?.length ?? "-"} minInterval=${policy.data?.data?.limits?.minIntervalMs ?? "-"}`,
  );
  const policyDenied = await api("GET", "/enterprise/platform/access-policy", null, owner);
  assert(policyDenied.status === 403, "非管理员读访问策略被拒");
} finally {
  if (skillId) await prisma.contentAgentSkill.delete({ where: { id: skillId } }).catch(() => undefined);
  await prisma.account.deleteMany({ where: { username: { in: [owner] } } });
  const left = await prisma.contentAgentSkill.count({ where: { userId: ownerUserId, name: SKILL_NAME } });
  log("清理：验证技能行已归零", left === 0, `残留 ${left} 条`);
  await prisma.$disconnect();
}

const { passed, failed } = suite.counts();
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
