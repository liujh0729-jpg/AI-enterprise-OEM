// 内建应用（低代码）端到端验收：直打本机 1690。
// 场景：服务商 demo_provider 建 OA 项目 → 行数据/导出/自由画布 → 数据规则与字段权限
// → 加员工 demo_staff 验证「能看到 + 受权限模型约束」→ 越权账号 → 审批提交/待办/通过 → AI/附件 → 清理。
const BASE = 'http://127.0.0.1:1690/api/backend';
const OWNER = 'demo_provider';
const OWNER_ID = 'u-provider';
const STAFF = 'demo_staff';
const STAFF_ID = 'u-staff';
const OUTSIDER = 'demo_legal';

let cookie = '';
async function login(as) {
  const res = await fetch(`http://127.0.0.1:1690/api/dev/session?as=${as}&next=/`, {
    redirect: 'manual',
  });
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  cookie = raw.map((v) => v.split(';')[0]).filter(Boolean).join('; ');
}
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:15890',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ...json };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}

const suffix = Date.now().toString().slice(-6);
const projectName = `验收OA${suffix}`;
let projectId = 0;
let assetsProjectId = 0;

try {
  // ---------- 模板与组织 ----------
  await login(OWNER);
  let r = await api('GET', '/enterprise/lowcode/templates');
  const templates = r.data?.templates || [];
  const orgs = r.data?.organizations || [];
  check(
    '模板清单 5 个且含 OA_LEAVE',
    r.code === 0 && templates.length === 5 && templates.some((t) => t.key === 'OA_LEAVE'),
    `code=${r.code} templates=${templates.length}`,
  );
  check(
    '组织候选含服务商（PROVIDER）',
    orgs.some((o) => o.orgType === 'PROVIDER' && o.orgUserId === OWNER_ID),
    JSON.stringify(orgs.map((o) => o.orgType)),
  );

  // ---------- 建 OA 项目 ----------
  r = await api('POST', '/enterprise/lowcode/projects', {
    name: projectName,
    templateKey: 'OA_LEAVE',
    description: '内建应用验收',
    orgType: 'PROVIDER',
    orgUserId: OWNER_ID,
    icon: '',
  });
  projectId = r.data?.id || 0;
  check(
    '新建 OA 项目',
    r.code === 0 && projectId > 0 && r.data?.type === 'OA' && r.data?.orgType === 'PROVIDER',
    `code=${r.code} id=${projectId} type=${r.data?.type}`,
  );

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}`);
  const detail = r.data || {};
  const entity = (detail.entities || [])[0] || {};
  const fieldKeys = (entity.fields || []).map((f) => f.fieldKey);
  const pageTypes = (detail.pages || []).map((p) => p.type);
  const roleKeys = (detail.roles || []).map((x) => x.key).sort();
  check('项目详情可读且我是所有者', r.code === 0 && detail.myRoleKey === 'OWNER', `code=${r.code} role=${detail.myRoleKey}`);
  check(
    '模板生成申请单实体与 9 个字段',
    entity.name === '申请单' &&
      ['title', 'kind', 'applicant', 'days', 'start_date', 'end_date', 'amount', 'reason', 'status'].every(
        (k) => fieldKeys.includes(k),
      ),
    `name=${entity.name} fields=${fieldKeys.length}`,
  );
  check(
    '模板生成 4 个页面（含审批待办/看板）',
    pageTypes.length === 4 && pageTypes.includes('APPROVAL_INBOX') && pageTypes.includes('KANBAN'),
    JSON.stringify(pageTypes),
  );
  check(
    '内置四角色齐全',
    roleKeys.join(',') === 'ADMIN,MEMBER,OWNER,VIEWER',
    roleKeys.join(','),
  );
  const memberRole = (detail.roles || []).find((x) => x.key === 'MEMBER') || {};
  const entityId = entity.id;

  // ---------- 行数据：新增 / 列表 / 关键词 / 导出 ----------
  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows`, {
    data: { title: `员工请假${suffix}`, kind: '请假', applicant: STAFF_ID, days: 2, reason: '家中有事' },
  });
  const staffRowId = r.data?.id || 0;
  check('所有者新增行（员工）', r.code === 0 && staffRowId > 0, `code=${r.code}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows`, {
    data: { title: `他人报销${suffix}`, kind: '报销', applicant: 'u-other', amount: 500, reason: '差旅' },
  });
  const otherRowId = r.data?.id || 0;
  check('所有者新增行（他人）', r.code === 0 && otherRowId > 0, `code=${r.code}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows?page=1&pageSize=20`);
  check(
    '所有者列表含 2 行且可删可导',
    r.code === 0 && r.data?.total === 2 && r.data?.canDelete === true && r.data?.canExport === true,
    `code=${r.code} total=${r.data?.total}`,
  );

  r = await api(
    'GET',
    `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows?page=1&pageSize=20&keyword=${encodeURIComponent('员工请假')}`,
  );
  check('关键词筛选命中 1 行', r.code === 0 && r.data?.total === 1, `total=${r.data?.total}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/export`, {
    keyword: '',
    sort: '',
    sortDir: 'asc',
    filter: [],
  });
  check(
    '导出 CSV 含表头与 2 行',
    r.code === 0 && r.data?.rows === 2 && String(r.data?.content || '').includes('申请事由'),
    `code=${r.code} rows=${r.data?.rows}`,
  );

  // ---------- 自由画布（CUSTOM 页面） ----------
  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/pages`, {
    id: 0,
    parentId: 0,
    type: 'CUSTOM',
    name: '自由画布',
    entityId: 0,
    config: {
      nodes: [
        { id: 'n1', type: 'HEADING', x: 0, y: 0, w: 480, h: 56, props: { text: '我的 OA' } },
        { id: 'n2', type: 'ENTITY_LIST', x: 0, y: 72, w: 640, h: 360, props: { entityId } },
      ],
    },
    visible: true,
  });
  check(
    '保存自由画布页面（CUSTOM + nodes）',
    r.code === 0 && r.data?.type === 'CUSTOM' && (r.data?.config?.nodes || []).length === 2,
    `code=${r.code} type=${r.data?.type}`,
  );

  // ---------- 数据规则 + 字段权限 ----------
  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/data-rules`, {
    id: 0,
    entityId,
    roleId: memberRole.id,
    field: 'applicant',
    op: '=',
    value: '#{me}',
  });
  check('保存行级规则（成员只看自己）', r.code === 0 && r.data?.id > 0, `code=${r.code}`);

  r = await api(
    'POST',
    `/enterprise/lowcode/projects/${projectId}/roles/${memberRole.id}/permissions`,
    { permissions: [{ resourceType: 'FIELD', resourceId: `${entityId}:reason`, actions: ['hidden'] }] },
  );
  check('保存字段权限（reason 对成员隐藏）', r.code === 0 && r.data?.saved === 1, `code=${r.code}`);

  // ---------- 加员工成员 ----------
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/member-candidates`);
  const candidateIds = (r.data || []).map((x) => x.userId);
  check(
    '成员候选来自本组织在职员工（含 u-staff，不含所有者）',
    r.code === 0 && candidateIds.includes(STAFF_ID) && !candidateIds.includes(OWNER_ID),
    `code=${r.code} n=${candidateIds.length}`,
  );

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/members`, {
    userIds: [STAFF_ID],
    roleId: memberRole.id,
  });
  check('加员工为项目成员', r.code === 0 && r.data?.added === 1, `code=${r.code} added=${r.data?.added}`);

  // ---------- 员工视角：可见 + 受权限模型约束 ----------
  await login(STAFF);
  r = await api('GET', '/enterprise/lowcode/projects?scope=joined');
  const joined = r.data || [];
  check(
    '员工在项目列表能看到该项目',
    r.code === 0 && joined.some((p) => p.id === projectId),
    `code=${r.code} n=${joined.length}`,
  );

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}`);
  check('员工可打开详情且角色为成员', r.code === 0 && r.data?.myRoleKey === 'MEMBER', `code=${r.code} role=${r.data?.myRoleKey}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows?page=1&pageSize=20`);
  const staffRows = r.data?.list || [];
  check(
    '行级规则生效：员工只看到自己那 1 行',
    r.code === 0 && r.data?.total === 1 && staffRows[0]?.data?.applicant === STAFF_ID,
    `code=${r.code} total=${r.data?.total}`,
  );
  check(
    '字段权限生效：reason 列隐藏、且查询结果无该键',
    r.code === 0 &&
      (r.data?.hiddenFields || []).includes('reason') &&
      !(r.data?.columns || []).some((c) => c.key === 'reason') &&
      staffRows[0]?.data?.reason === undefined,
    `hidden=${JSON.stringify(r.data?.hiddenFields)}`,
  );
  check(
    '成员默认权限：可建可改不可删',
    r.code === 0 && r.data?.canCreate === true && r.data?.canUpdate === true && r.data?.canDelete === false,
    `create=${r.data?.canCreate} update=${r.data?.canUpdate} delete=${r.data?.canDelete}`,
  );

  r = await api('DELETE', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows/${staffRowId}`);
  check('成员删除行被拒（ROLE_MISMATCH）', r.code !== 0 && r.status === 403, `code=${r.code} status=${r.status}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/roles`, {
    id: 0,
    key: '',
    name: '越权角色',
    description: '',
  });
  check('成员改项目角色被拒', r.code !== 0 && r.status === 403, `code=${r.code} status=${r.status}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows`, {
    data: { title: `员工自建${suffix}`, kind: '请假', applicant: STAFF_ID, days: 1 },
  });
  const staffOwnRow = r.data?.id || 0;
  check('成员可新增自己的申请', r.code === 0 && staffOwnRow > 0, `code=${r.code}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows`, {
    data: { title: `替他人建${suffix}`, kind: '报销', applicant: 'u-other', amount: 1 },
  });
  check('成员可新增记录（规则只影响可见性）', r.code === 0, `code=${r.code}`);
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows?page=1&pageSize=20`);
  check(
    '成员新增他人记录后仍只看得到自己的 2 行',
    r.code === 0 && r.data?.total === 2,
    `total=${r.data?.total}`,
  );

  // ---------- 无关账号：项目不存在 ----------
  await login(OUTSIDER);
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}`);
  check(
    '无关账号访问详情按项目不存在处理（404）',
    r.code === 404 && r.status === 404,
    `code=${r.code} status=${r.status} msg=${r.message}`,
  );
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows`);
  check('无关账号读行同样 404', r.code === 404 && r.status === 404, `code=${r.code}`);

  // ---------- 审批链路（所有者提交 + 双节点通过） ----------
  await login(OWNER);
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/approval-flows?entityId=${entityId}`);
  const flow = (r.data || [])[0] || {};
  check(
    '模板审批流：2 个节点（主管 / 部门负责人）',
    r.code === 0 && (flow.nodes || []).length === 2,
    `code=${r.code} nodes=${(flow.nodes || []).length}`,
  );

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/approval-submit`, {
    entityId,
    rowId: staffRowId,
    flowId: flow.id || 0,
    comment: '验收提交',
  });
  check('提交审批生成实例', r.code === 0 && r.data?.instanceId > 0 && r.data?.status === 'RUNNING', `code=${r.code}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/approval-tasks?status=PENDING&page=1&pageSize=20`);
  const tasks = r.data?.list || [];
  const firstTask = tasks.find((t) => t.rowId === staffRowId) || {};
  check(
    '审批待办落到组织账号（u-provider）',
    r.code === 0 && firstTask.assigneeUserId === OWNER_ID && firstTask.nodeIndex === 0,
    `code=${r.code} assignee=${firstTask.assigneeUserId}`,
  );

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}`);
  check('详情待办计数 = 1', r.code === 0 && r.data?.myPendingApprovals === 1, `n=${r.data?.myPendingApprovals}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/approval-act`, {
    taskId: firstTask.id,
    action: 'APPROVE',
    comment: '主管通过',
  });
  check('第一节点通过后流转到第二节点', r.code === 0 && r.data?.instanceStatus === 'RUNNING', `code=${r.code} state=${r.data?.instanceStatus}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/approval-tasks?status=PENDING&page=1&pageSize=20`);
  const secondTask = (r.data?.list || []).find((t) => t.rowId === staffRowId) || {};
  check('第二节点待办生成', r.code === 0 && secondTask.nodeIndex === 1, `node=${secondTask.nodeIndex}`);

  r = await api('POST', `/enterprise/lowcode/projects/${projectId}/approval-act`, {
    taskId: secondTask.id,
    action: 'APPROVE',
    comment: '负责人通过',
  });
  check('第二节点通过后实例结束', r.code === 0 && r.data?.instanceStatus === 'APPROVED', `code=${r.code} state=${r.data?.instanceStatus}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows/${staffRowId}`);
  check('审批结果回写行状态（已通过）', r.code === 0 && r.data?.data?.status === '已通过', `status=${r.data?.data?.status}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/entities/${entityId}/rows/${staffRowId}/approval`);
  check('行审批记录可读且含实例与任务', r.code === 0 && r.data?.instance?.id > 0 && (r.data?.tasks || []).length >= 2, `code=${r.code}`);

  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/approval-tasks?status=DONE&page=1&pageSize=20`);
  check('已办清单含已完成任务', r.code === 0 && (r.data?.list || []).some((t) => t.rowId === staffRowId), `code=${r.code}`);

  // ---------- AI 设置与附件（只读探测，不发真实模型请求） ----------
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/ai/settings`);
  check('AI 设置可读（按账号渠道）', r.code === 0 && Array.isArray(r.data?.channels), `code=${r.code} configured=${r.data?.configured}`);
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}/ai/channels`);
  check('AI 渠道清单可读', r.code === 0 && Array.isArray(r.data), `code=${r.code}`);

  // ---------- 数字资产（附件） ----------
  // 开发态兜底平台 Key（CONTENT_TEST_AIPDD_KEY）只绑 demo_logistics，换个账号验证附件清单可读。
  // 只读探测：上传会在 AIPDD 平台留下无法由本系统清理的资产，故不做上传落库。
  await login('demo_logistics');
  r = await api('GET', '/enterprise/lowcode/templates');
  const assetsOrg = (r.data?.organizations || [])[0];
  if (!assetsOrg) {
    check('数字资产清单可读', false, 'demo_logistics 没有可归属组织');
  } else {
    r = await api('POST', '/enterprise/lowcode/projects', {
      name: `验收附件${suffix}`,
      templateKey: 'BLANK',
      description: '附件清单探测',
      orgType: assetsOrg.orgType,
      orgUserId: assetsOrg.orgUserId,
      icon: '',
    });
    assetsProjectId = r.code === 0 ? r.data?.id : 0;
    check('附件验收项目可建（demo_logistics）', assetsProjectId > 0, `code=${r.code} msg=${r.message}`);
    if (assetsProjectId) {
      r = await api('GET', `/enterprise/lowcode/projects/${assetsProjectId}/assets?page=1&pageSize=10`);
      check(
        '数字资产清单可读',
        r.code === 0 && Array.isArray(r.data?.list) && r.data?.total === 0,
        `code=${r.code} total=${r.data?.total} msg=${r.message}`,
      );
      r = await api('DELETE', `/enterprise/lowcode/projects/${assetsProjectId}`);
      check('附件验收项目已清理', r.code === 0, `code=${r.code}`);
      if (r.code === 0) assetsProjectId = 0;
    }
  }
  await login(OWNER);

  // ---------- 清理 ----------
  r = await api('DELETE', `/enterprise/lowcode/projects/${projectId}`);
  check('清理：删除验收项目', r.code === 0 && r.data?.removed === true, `code=${r.code}`);
  r = await api('GET', `/enterprise/lowcode/projects/${projectId}`);
  check('清理后项目不存在', r.code === 404, `code=${r.code}`);
  if (r.code === 0) projectId = 0;
} catch (error) {
  check('脚本异常', false, String(error && error.message ? error.message : error));
} finally {
  if (projectId) {
    try {
      await login(OWNER);
      await api('DELETE', `/enterprise/lowcode/projects/${projectId}`);
    } catch {
      /* 清理失败不覆盖主结果 */
    }
  }
  if (assetsProjectId) {
    try {
      await login('demo_logistics');
      await api('DELETE', `/enterprise/lowcode/projects/${assetsProjectId}`);
    } catch {
      /* 清理失败不覆盖主结果 */
    }
  }
}

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(' | '));
  process.exit(1);
}
