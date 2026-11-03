/**
 * OA「AI 预审 + 发起附件」端到端实测：
 * 模板节点配预审原则 → 发起时带附件 → 审批人在详情里跑预审（用本人文本模型）
 * → 结果按审批任务缓存；模型不通时落 FAILED 但不挡人工审批。
 *
 * 模型用本地 mock（OpenAI 兼容 /chat/completions），渠道与槽位走「模型设置」接口，
 * 结束后恢复审批人原槽位并删除本次创建的渠道/模板/单据。
 */
import { createServer } from 'node:http';
import { createPrisma, createSuite } from './harness.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:1695';
const OWNER = 'demo_enterprise';
const ORG_USER_ID = 'u-enterprise';
const APPROVER = 'demo_staff';
const APPROVER_ID = 'u-staff';
const STAMP = Date.now();
const TEMPLATE_KEY = `vr${STAMP.toString(36)}`;
const TEMPLATE_NAME = 'AI预审回归模板';
const CHANNEL_NAME = `预审回归渠道-${STAMP}`;
const PRINCIPLES = '检查附件是否齐全；金额超过 1 万元必须有合同扫描件。';
/** 真实台账里的附件：服务端要按发起人自己的 digital_asset_entries 取直链并落库。 */
const STAMP_ASSET_ID = 900000000 + (STAMP % 100000000);
const ASSET_URL = `https://aipdd.example.test/assets/enterprise/${ORG_USER_ID}/verify-${STAMP}.pdf`;
const ATTACHMENT = {
  id: String(STAMP_ASSET_ID),
  name: '合同扫描件.pdf',
  size: 204800,
  url: 'https://evil.example.test/phishing',
};
/** 台账里没有的附件 id：只能保留展示信息，直链必须为空。 */
const FOREIGN_ATTACHMENT = {
  id: String(STAMP_ASSET_ID + 1),
  name: '外部伪造附件.pdf',
  size: 1,
  url: 'https://evil.example.test/phishing2',
};

const { call, assert, summary, counts } = createSuite({ base: BASE });
const prisma = createPrisma();

let createdTemplateId = 0;
let createdAppId = 0;
let createdChannelId = 0;
let previousSlot = null;
let mockReply = 'AI预审：建议通过。附件齐全，金额未超阈值。';
let lastPrompt = '';

const mock = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    try {
      lastPrompt = JSON.stringify(JSON.parse(raw));
    } catch {
      lastPrompt = raw;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: mockReply } }],
      }),
    );
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;

const node = {
  name: '部门负责人审批',
  approverType: 'MEMBER',
  userIds: [APPROVER_ID],
  roles: [],
  department: '',
  positions: [],
  aiPreReview: {
    enabled: true,
    personaId: 0,
    principles: PRINCIPLES,
    personaName: '',
    personaStyle: '',
    personaText: '',
  },
  mode: 'ANY',
  condition: null,
  emptyAction: 'SKIP',
  ccUserIds: [],
  remindAfterHours: 24,
};

const fields = [{ key: 'reason', label: '事由', type: 'text', required: true }];

const templateBody = (extra = {}) => ({
  orgType: 'ENTERPRISE',
  orgUserId: ORG_USER_ID,
  key: TEMPLATE_KEY,
  name: TEMPLATE_NAME,
  category: 'GENERAL',
  description: '回归用',
  icon: '',
  numberPrefix: 'VR',
  fields,
  flow: [node],
  linkage: [],
  enabled: true,
  sortOrder: 0,
  ...extra,
});

const cleanup = async () => {
  const apps = await prisma.oaApplication.findMany({
    where: { orgType: 'ENTERPRISE', orgUserId: ORG_USER_ID, templateId: createdTemplateId || -1 },
    select: { id: true },
  });
  const appIds = apps.map((row) => row.id);
  if (appIds.length) {
    await prisma.oaTask.deleteMany({ where: { applicationId: { in: appIds } } });
    await prisma.oaRecord.deleteMany({ where: { applicationId: { in: appIds } } });
    await prisma.oaCc.deleteMany({ where: { applicationId: { in: appIds } } });
    await prisma.notification.deleteMany({
      where: { category: 'oa', entityId: { in: appIds.map(String) } },
    });
    await prisma.oaApplication.deleteMany({ where: { id: { in: appIds } } });
  }
  if (createdTemplateId) {
    await prisma.oaTemplate.deleteMany({ where: { id: createdTemplateId } });
  }
  if (createdChannelId) {
    await prisma.contentModelChannel.deleteMany({ where: { id: createdChannelId } });
  }
  await prisma.orgStaff.deleteMany({
    where: { orgType: 'ENTERPRISE', orgUserId: ORG_USER_ID, memberUserId: APPROVER_ID },
  });
  await prisma.digitalAssetEntry.deleteMany({
    where: { userId: ORG_USER_ID, aipddAssetId: { in: [STAMP_ASSET_ID, STAMP_ASSET_ID + 1] } },
  });
};

try {
  await cleanup();
  // 审批人必须是该企业的在职成员，MEMBER 节点才会派单（否则按无人可派跳过）。
  await prisma.orgStaff.create({
    data: {
      orgType: 'ENTERPRISE',
      orgUserId: ORG_USER_ID,
      memberUserId: APPROVER_ID,
      memberKind: 'STAFF',
      status: 'ACTIVE',
      confirmedAt: new Date(),
    },
  });

  // 发起人的数字资产归属台账：附件直链由服务端从这张表取，审批人回看不依赖自己的资产列表。
  await prisma.digitalAssetEntry.create({
    data: {
      userId: ORG_USER_ID,
      aipddAssetId: STAMP_ASSET_ID,
      type: 'file',
      name: ATTACHMENT.name,
      url: ASSET_URL,
      previewUrl: ASSET_URL,
      fileSize: 0.2,
      labels: ['verify-oa-prereview'],
    },
  });

  // ---------- 1. 审批人的文本模型（本地 mock 渠道）----------
  const before = await call('GET', '/enterprise/content/settings', APPROVER);
  previousSlot = (before.data?.slots || []).find((row) => row.mediaType === 'text') || null;

  const channel = await call('POST', '/enterprise/content/channels', APPROVER, {
    provider: 'custom',
    preset: 'openai',
    name: CHANNEL_NAME,
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    apiKey: 'sk-verify',
  });
  createdChannelId = channel.data?.id || 0;
  assert(channel.code === 0 && createdChannelId > 0, '创建 mock 文本渠道', channel.message);

  const slot = await call('PUT', '/enterprise/content/settings', APPROVER, {
    slots: [{ mediaType: 'text', channelId: createdChannelId, model: 'mock-text' }],
  });
  assert(slot.code === 0, '设置文本默认模型', slot.message);

  // ---------- 2. 模板校验：开了预审但没写原则 ----------
  const invalid = await call('POST', '/enterprise/oa/templates', OWNER, templateBody({
    key: `${TEMPLATE_KEY}b`,
    name: `${TEMPLATE_NAME}校验`,
    flow: [{ ...node, aiPreReview: { ...node.aiPreReview, principles: '' } }],
  }));
  assert(
    invalid.code === 400 && invalid.status === 400 && /请填写审核原则/.test(invalid.message),
    '开预审必须填审核原则',
    `${invalid.status}/${invalid.code}/${invalid.message}`,
  );

  // ---------- 3. 保存模板 ----------
  const template = await call('POST', '/enterprise/oa/templates', OWNER, templateBody());
  createdTemplateId = template.data?.id || 0;
  assert(template.code === 0 && createdTemplateId > 0, '保存含 AI 预审的模板', template.message);
  assert(
    template.data?.flow?.[0]?.aiPreReview?.enabled === true &&
      template.data?.flow?.[0]?.aiPreReview?.principles === PRINCIPLES,
    '模板回读保留节点预审配置',
    JSON.stringify(template.data?.flow?.[0]?.aiPreReview || {}),
  );

  // ---------- 4. 发起单据（带附件）----------
  const draft = await call('POST', '/enterprise/oa/applications/draft', OWNER, {
    orgType: 'ENTERPRISE',
    orgUserId: ORG_USER_ID,
    templateId: createdTemplateId,
    title: `AI预审回归 ${STAMP}`,
    formData: { reason: '采购一批办公用品' },
    attachments: [ATTACHMENT, FOREIGN_ATTACHMENT],
  });
  createdAppId = draft.data?.id || 0;
  assert(draft.code === 0, '保存草稿', draft.message);
  const draftFiles = draft.data?.attachments || [];
  assert(
    draftFiles.length === 2 && draftFiles[0]?.name === ATTACHMENT.name,
    '草稿保存发起附件',
    JSON.stringify(draftFiles),
  );
  assert(
    draftFiles[0]?.url === ASSET_URL && draftFiles[1]?.url === '',
    '附件直链取发起人台账，请求体伪造值被忽略；台账外的附件不带直链',
    JSON.stringify(draftFiles.map((row) => row.url)),
  );

  const submitted = await call('POST', `/enterprise/oa/applications/${createdAppId}/submit`, OWNER, {});
  assert(submitted.code === 0 && submitted.data?.status === 'APPROVING', '提交进入审批', submitted.message);

  const applicantView = await call('GET', `/enterprise/oa/applications/${createdAppId}`, OWNER);
  assert(
    (applicantView.data?.attachments || []).length === 2 &&
      applicantView.data?.attachments?.[0]?.url === ASSET_URL,
    '申请人详情看到附件与直链',
    JSON.stringify(applicantView.data?.attachments || []),
  );

  // ---------- 5. 预审权限与流程 ----------
  const ownerRun = await call('POST', `/enterprise/oa/applications/${createdAppId}/pre-review`, OWNER, {});
  assert(
    ownerRun.code === 403 && ownerRun.status === 403,
    '非当前审批人不能预审',
    `${ownerRun.status}/${ownerRun.code}/${ownerRun.message}`,
  );

  const approverView = await call('GET', `/enterprise/oa/applications/${createdAppId}`, APPROVER);
  assert(
    approverView.data?.attachments?.[0]?.url === ASSET_URL,
    '审批人（非资产归属账号）也拿到附件直链',
    JSON.stringify(approverView.data?.attachments || []),
  );
  assert(
    (approverView.data?.flow || [])
      .flatMap((step) => step.approvers || [])
      .every((row) => row.preReview === undefined),
    '流程时间线不再外发其他人的预审正文',
    JSON.stringify((approverView.data?.flow || []).flatMap((step) => step.approvers || [])),
  );
  const approverOf = (view) =>
    (view?.flow || [])
      .flatMap((step) => step.approvers || [])
      .find((row) => row.userId === APPROVER_ID) || {};
  const mine = approverOf(approverView.data);
  assert(approverView.code === 0 && mine.status === 'PENDING', '审批人看到待办', JSON.stringify(mine));
  assert(approverView.data?.myPreReview?.status === 'NONE', '预审初始为未执行', approverView.data?.myPreReview?.status);

  const first = await call('POST', `/enterprise/oa/applications/${createdAppId}/pre-review`, APPROVER, {});
  assert(first.code === 0 && first.data?.status === 'DONE', '预审执行成功', JSON.stringify(first.data || {}));
  assert(first.data?.content === mockReply, '预审返回模型内容', first.data?.content);
  assert(
    lastPrompt.includes('采购一批办公用品') &&
      lastPrompt.includes(ATTACHMENT.name) &&
      lastPrompt.includes(PRINCIPLES),
    '预审提示词含表单/附件/审核原则',
    lastPrompt.slice(0, 120),
  );

  const afterView = await call('GET', `/enterprise/oa/applications/${createdAppId}`, APPROVER);
  assert(
    afterView.data?.myPreReview?.status === 'DONE' &&
      afterView.data?.myPreReview?.content === mockReply,
    '预审结果缓存在审批任务上',
    JSON.stringify(afterView.data?.myPreReview || {}),
  );

  // ---------- 6. 模型不通：落 FAILED，不挡人工审批 ----------
  await call('POST', '/enterprise/content/channels', APPROVER, {
    id: createdChannelId,
    provider: 'custom',
    preset: 'openai',
    name: CHANNEL_NAME,
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-verify',
  });
  const failed = await call('POST', `/enterprise/oa/applications/${createdAppId}/pre-review`, APPROVER, {});
  assert(
    failed.code === 0 && failed.data?.status === 'FAILED',
    '模型不通时预审落 FAILED（接口不报错）',
    JSON.stringify(failed.data || {}),
  );

  const stillPending = await call('GET', `/enterprise/oa/applications/${createdAppId}`, APPROVER);
  assert(
    stillPending.data?.status === 'APPROVING' &&
      approverOf(stillPending.data).status === 'PENDING',
    '预审失败不影响待办',
    stillPending.data?.status,
  );
} finally {
  await cleanup();
  if (previousSlot) {
    await call('PUT', '/enterprise/content/settings', APPROVER, {
      slots: [
        { mediaType: 'text', channelId: previousSlot.channelId, model: previousSlot.model },
      ],
    });
  } else {
    await prisma.contentModelSlot.deleteMany({
      where: { userId: APPROVER_ID, mediaType: 'text' },
    });
  }
  await prisma.auditLog.deleteMany({
    where: {
      userId: APPROVER_ID,
      action: '内容创作保存模型设置',
      createdAt: { gte: new Date(STAMP - 60000) },
    },
  });
  await prisma.$disconnect();
  mock.close();
}

console.log(summary());
if (counts().failed > 0) process.exit(1);