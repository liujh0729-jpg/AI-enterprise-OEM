/**
 * 组织职能（部门 / 岗位）与 OA「按部门 + 岗位」签批人：接口层实测。
 *
 * 口径：
 * - 只动 demo 服务商 u-provider 自己建的目录行与一条测试单据；结束按 id 清理。
 * - 验证链路：建部门/岗位 → 赋给在职成员 → OA 设置回显目录 → 建模板（DEPT_POSITION）→
 *   提交一张单据，断言首个节点的审批人正是被赋职能的成员。
 * - 已提交单据没有删除接口，收尾按本次创建的 applicationId 精确清理任务/流水/单据。
 *
 * 用法：
 *   node scripts/verify-org-functions.mjs            # BASE_URL 默认 1694
 */
import { createRequire } from "node:module";
import { createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1694",
});
const { call, assert } = suite;
const ACCOUNT = "demo_provider";
const ORG_USER_ID = "u-provider";
const ORG_TYPE = "PROVIDER";
const STAMP = Date.now();

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { PrismaClient } = require("../backend/generated/prisma");
const prisma = new PrismaClient();
const databaseUrl = process.env.DATABASE_URL || "";

const FUNCTIONS = "/enterprise/org-staff/functions";
const OA_SETTINGS = "/enterprise/oa/settings";
const OA_SAVE_TEMPLATE = "/enterprise/oa/templates";
const OA_SAVE_DRAFT = "/enterprise/oa/applications/draft";

const deptName = `验证部门-${STAMP}`;
const posName = `验证岗位-${STAMP}`;
const posDesc = "负责验证职能目录与审批人解析";

let departmentId = 0;
let positionId = 0;
let templateId = 0;
let applicationId = 0;
let member = null;

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

try {
  // 1. 目录与成员清单
  const initial = await call("GET", `${FUNCTIONS}?orgType=${ORG_TYPE}`, ACCOUNT);
  assert(initial.code === 0, `职能目录 code=${initial.code}`);
  const members = initial.data?.members || [];
  assert(members.length > 0, "在职成员为空，无法验证赋予");
  member = members[0];
  console.log(
    `目录初始：部门 ${initial.data.departments.length} / 岗位 ${initial.data.positions.length}；成员 ${members.length}`,
  );

  // 2. 建部门与岗位
  const dept = await call("POST", FUNCTIONS + "/departments", ACCOUNT, {
    orgType: ORG_TYPE,
    name: deptName,
    description: "验证用部门",
    sortOrder: 0,
  });
  assert(dept.code === 0, `建部门 code=${dept.code}`);
  departmentId = dept.data.id;

  const pos = await call("POST", FUNCTIONS + "/positions", ACCOUNT, {
    orgType: ORG_TYPE,
    name: posName,
    description: posDesc,
    sortOrder: 0,
  });
  assert(pos.code === 0, `建岗位 code=${pos.code}`);
  positionId = pos.data.id;

  // 3. 赋给成员（部门 + 岗位）
  const assigned = await call(
    "PUT",
    `${FUNCTIONS}/members/${member.id}`,
    ACCOUNT,
    {
      orgType: ORG_TYPE,
      department: deptName,
      positions: [{ name: posName, description: posDesc }],
    },
  );
  assert(assigned.code === 0, `赋职能 code=${assigned.code}`);
  assert(assigned.data?.department === deptName, "赋职能后部门不对");
  assert(
    assigned.data?.positions?.some((item) => item.name === posName),
    "赋职能后岗位不对",
  );
  console.log(`已赋给 ${assigned.data.realName}：${deptName} / ${posName}`);

  // 4. OA 设置回显目录与成员岗位
  const settings = await call(
    "GET",
    `${OA_SETTINGS}?orgType=${ORG_TYPE}&orgUserId=${ORG_USER_ID}`,
    ACCOUNT,
  );
  assert(settings.code === 0, `OA 设置 code=${settings.code}`);
  assert(
    (settings.data?.departments || []).some((item) => item.name === deptName),
    "OA 设置没有回显新部门",
  );
  assert(
    (settings.data?.positions || []).some((item) => item.name === posName),
    "OA 设置没有回显新岗位",
  );
  const oaMember = (settings.data?.members || []).find(
    (item) => item.userId === member.memberUserId,
  );
  assert(Boolean(oaMember), "OA 设置里找不到被赋职能的成员");
  assert(
    oaMember?.positions?.some((item) => item.name === posName),
    "OA 设置成员岗位未同步",
  );
  console.log("OA 设置已回显目录与成员岗位");

  // 5. 建模板：按部门 + 岗位派签批人
  const template = await call("POST", OA_SAVE_TEMPLATE, ACCOUNT, {
    orgType: ORG_TYPE,
    orgUserId: ORG_USER_ID,
    key: `fn-test-${STAMP}`,
    name: `职能验证-${STAMP}`,
    category: "GENERAL",
    description: "验证部门岗位签批人（可删除）",
    numberPrefix: "FT",
    fields: [
      { key: "reason", label: "事由", type: "text", required: true },
    ],
    flow: [
      {
        name: "部门岗位审批",
        approverType: "DEPT_POSITION",
        userIds: [],
        roles: [],
        department: deptName,
        positions: [posName],
        mode: "ANY",
        condition: null,
        emptyAction: "ERROR",
        ccUserIds: [],
        remindAfterHours: 24,
      },
    ],
    linkage: [],
    enabled: true,
    sortOrder: 0,
  });
  assert(template.code === 0, `建模板 code=${template.code}`);
  templateId = template.data.id;
  assert(
    template.data.flow[0].department === deptName,
    "模板节点部门未保存",
  );

  // 6. 提交单据，验证审批人解析
  const draft = await call("POST", OA_SAVE_DRAFT, ACCOUNT, {
    orgType: ORG_TYPE,
    orgUserId: ORG_USER_ID,
    templateId,
    title: `职能验证单据-${STAMP}`,
    formData: { reason: "验证按部门岗位派单" },
    ccUserIds: [],
    linkTargets: [],
  });
  assert(draft.code === 0, `建草稿 code=${draft.code}`);
  applicationId = draft.data.id;

  const submitted = await call(
    "POST",
    `/enterprise/oa/applications/${applicationId}/submit`,
    ACCOUNT,
    {},
  );
  assert(submitted.code === 0, `提交 code=${submitted.code}`);
  assert(submitted.data?.status === "APPROVING", "提交后状态不是审批中");
  const firstStep = submitted.data?.flow?.[0];
  assert(Boolean(firstStep), "提交流程没有节点");
  const approvers = firstStep?.approvers || [];
  assert(
    approvers.some((item) => item.userId === member.memberUserId),
    `签批人不是被赋职能的成员（实际 ${approvers.map((a) => a.userId).join(",")}）`,
  );
  console.log(
    `提交成功：节点「${firstStep.name}」审批人 ${approvers.map((a) => a.name).join("、")}`,
  );

  console.log("\n职能管理 + OA 部门岗位签批人：全部通过");
} finally {
  // 已提交单据没有删除接口：只按本次创建的 id 精确清理（不碰其他数据）。
  if (applicationId) {
    await prisma.$transaction([
      prisma.oaTask.deleteMany({ where: { applicationId } }),
      prisma.oaRecord.deleteMany({ where: { applicationId } }),
      prisma.oaCc.deleteMany({ where: { applicationId } }),
      prisma.oaLink.deleteMany({ where: { applicationId } }),
      prisma.oaApplication.deleteMany({ where: { id: applicationId } }),
    ]).catch(() => undefined);
  }
  if (templateId) {
    await call("DELETE", `/enterprise/oa/templates/${templateId}`, ACCOUNT).catch(
      () => undefined,
    );
  }
  if (departmentId) {
    await call(
      "DELETE",
      `${FUNCTIONS}/departments/${departmentId}?orgType=${ORG_TYPE}`,
      ACCOUNT,
    ).catch(() => undefined);
  }
  if (positionId) {
    await call(
      "DELETE",
      `${FUNCTIONS}/positions/${positionId}?orgType=${ORG_TYPE}`,
      ACCOUNT,
    ).catch(() => undefined);
  }
  await prisma.$disconnect();
  void databaseUrl;
}