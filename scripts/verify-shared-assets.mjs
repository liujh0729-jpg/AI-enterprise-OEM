/**
 * 共享资料（数字资产页签）端到端实测：
 * 企业内成员互发数字资产、收支清单、重复共享幂等、撤销与越权撤销。
 *
 * 组织关系与数字资产归属台账都用 Prisma 直接建夹具（共享资料只认登录账号自己台账里的资产），
 * 共享关系全部走接口写入，结束后按资产 id 与夹具账号清理。
 */
import { createPrisma, createSuite } from './harness.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:1695';
const OWNER = 'demo_enterprise';
const OWNER_ID = 'u-enterprise';
const MEMBERS = ['demo_staff', 'demo_staff2'];
const MEMBER_IDS = ['u-staff', 'u-staff2'];
const STAMP = Date.now();
const SEED = 900000000 + (STAMP % 100000000);
/** 企业主的资产、职员的资产、别人（职员2）的资产：三条都在台账里，只有前两条能各自共享。 */
const ASSET_ID = SEED;
const MEMBER_ASSET_ID = SEED + 1;
const OTHER_ASSET_ID = SEED + 2;
const ASSET_NAME = '共享资料回归样本.txt';
const ASSET_URL = `https://aipdd.example.test/assets/enterprise/${OWNER_ID}/verify-${STAMP}.txt`;
const LEDGER = [
  {
    userId: OWNER_ID,
    aipddAssetId: ASSET_ID,
    name: ASSET_NAME,
    url: ASSET_URL,
  },
  {
    userId: MEMBER_IDS[0],
    aipddAssetId: MEMBER_ASSET_ID,
    name: '职员共享样本.txt',
    url: `https://aipdd.example.test/assets/enterprise/${MEMBER_IDS[0]}/verify-${STAMP}.txt`,
  },
  {
    userId: MEMBER_IDS[1],
    aipddAssetId: OTHER_ASSET_ID,
    name: '别人的资产.txt',
    url: `https://aipdd.example.test/assets/enterprise/${MEMBER_IDS[1]}/verify-${STAMP}.txt`,
  },
];

const { call, assert, summary, counts } = createSuite({ base: BASE });
const prisma = createPrisma();

/** 请求体里的资产信息全部是伪造值：服务端必须改用台账，不接受外部传入的直链。 */
const forgedBody = (assetId, targetUserIds) => ({
  asset: {
    id: String(assetId),
    name: '伪造名称.txt',
    type: 'video',
    size: 999999,
    url: 'https://evil.example.test/phishing',
  },
  targetUserIds,
});

const cleanup = async () => {
  await prisma.contentSharedAsset.deleteMany({
    where: { assetId: { in: [String(ASSET_ID), String(MEMBER_ASSET_ID)] } },
  });
  await prisma.digitalAssetEntry.deleteMany({
    where: { aipddAssetId: { in: [ASSET_ID, MEMBER_ASSET_ID, OTHER_ASSET_ID] } },
  });
  await prisma.orgStaff.deleteMany({
    where: { orgType: 'ENTERPRISE', orgUserId: OWNER_ID, memberUserId: { in: MEMBER_IDS } },
  });
};

try {
  await cleanup();
  for (const memberUserId of MEMBER_IDS) {
    await prisma.orgStaff.create({
      data: {
        orgType: 'ENTERPRISE',
        orgUserId: OWNER_ID,
        memberUserId,
        memberKind: 'STAFF',
        status: 'ACTIVE',
        confirmedAt: new Date(),
      },
    });
  }
  for (const entry of LEDGER) {
    await prisma.digitalAssetEntry.create({
      data: {
        userId: entry.userId,
        aipddAssetId: entry.aipddAssetId,
        type: 'file',
        name: entry.name,
        url: entry.url,
        previewUrl: entry.url,
        fileSize: 0.5,
        labels: ['verify-shared-assets'],
      },
    });
  }

  const targets = await call('GET', '/enterprise/content/shared-assets/targets', OWNER);
  const targetIds = (targets.data?.users || []).map((item) => item.userId);
  assert(targets.code === 0, '企业主可读取共享目标', JSON.stringify(targets).slice(0, 160));
  assert(targets.data?.orgName === '杭州智造科技有限公司', '目标清单带企业名', targets.data?.orgName);
  assert(
    MEMBER_IDS.every((id) => targetIds.includes(id)) && !targetIds.includes(OWNER_ID),
    '企业主的目标清单＝企业内其他账号（不含本人）',
    targetIds.join(','),
  );

  const memberTargets = await call('GET', '/enterprise/content/shared-assets/targets', MEMBERS[0]);
  const memberTargetIds = (memberTargets.data?.users || []).map((item) => item.userId);
  assert(
    memberTargetIds.includes(OWNER_ID) &&
      memberTargetIds.includes(MEMBER_IDS[1]) &&
      !memberTargetIds.includes(MEMBER_IDS[0]),
    '职员的目标清单＝企业主 + 其他成员（不含本人）',
    memberTargetIds.join(','),
  );

  const providerTargets = await call('GET', '/enterprise/content/shared-assets/targets', 'demo_provider');
  assert(
    providerTargets.code === 0 && (providerTargets.data?.users || []).length === 0,
    '非企业账号的目标清单为空',
    JSON.stringify(providerTargets.data),
  );

  const providerShare = await call('POST', '/enterprise/content/shared-assets', 'demo_provider', forgedBody(ASSET_ID, MEMBER_IDS));
  assert(
    providerShare.code === 400 && providerShare.status === 400,
    '非企业账号不能发起共享',
    `${providerShare.status}/${providerShare.code}/${providerShare.message}`,
  );

  const share = await call('POST', '/enterprise/content/shared-assets', OWNER, forgedBody(ASSET_ID, MEMBER_IDS));
  assert(share.code === 0 && share.data?.shared === 2, '多选共享写入两条记录', JSON.stringify(share.data));

  const receiver = await call('GET', '/enterprise/content/shared-assets', MEMBERS[0]);
  const received = (receiver.data?.received || []).filter((row) => row.assetId === String(ASSET_ID));
  assert(received.length === 1, '被共享账号在「收到的共享」看到资料', `${received.length} 条`);
  assert(
    received[0]?.assetUrl === ASSET_URL && received[0]?.assetName === ASSET_NAME && received[0]?.assetType === 'file',
    '共享记录的名称/类型/直链一律取台账（请求体伪造值被忽略）',
    JSON.stringify(received[0] || {}).slice(0, 200),
  );

  const stolen = await call('POST', '/enterprise/content/shared-assets', OWNER, forgedBody(OTHER_ASSET_ID, MEMBER_IDS));
  assert(
    stolen.code === 404 && stolen.status === 404,
    '台账里没有的资产（别人的资产 id）不能共享',
    `${stolen.status}/${stolen.code}/${stolen.message}`,
  );
  const leaked = await call('GET', '/enterprise/content/shared-assets', MEMBERS[1]);
  assert(
    (leaked.data?.received || []).every((row) => row.assetId !== String(OTHER_ASSET_ID)),
    '越权共享没有落库',
    JSON.stringify((leaked.data?.received || []).map((row) => row.assetId)),
  );

  const memberShare = await call('POST', '/enterprise/content/shared-assets', MEMBERS[0], forgedBody(MEMBER_ASSET_ID, [OWNER_ID]));
  const memberSent = await call('GET', '/enterprise/content/shared-assets', MEMBERS[0]);
  assert(
    memberShare.code === 0 &&
      (memberSent.data?.sent || []).some((row) => row.assetId === String(MEMBER_ASSET_ID)),
    '在职成员也能将自有资产共享给企业内账号',
    JSON.stringify(memberShare.data ?? memberShare.message),
  );

  const again = await call('POST', '/enterprise/content/shared-assets', OWNER, forgedBody(ASSET_ID, MEMBER_IDS));
  const sentRows = await call('GET', '/enterprise/content/shared-assets', OWNER);
  const sent = (sentRows.data?.sent || []).filter((row) => row.assetId === String(ASSET_ID));
  assert(again.code === 0 && sent.length === 2, '重复共享幂等（不新增记录）', `${sent.length} 条`);

  assert(
    received[0]?.ownerName.length > 0,
    '接收记录带共享人',
    JSON.stringify(received[0] || {}),
  );

  const forbidRevoke = await call('DELETE', `/enterprise/content/shared-assets/${received[0]?.id}`, MEMBERS[0]);
  assert(
    forbidRevoke.code === 404 && forbidRevoke.status === 404,
    '接收方不能撤销别人的共享',
    `${forbidRevoke.status}/${forbidRevoke.code}/${forbidRevoke.message}`,
  );

  const revoke = await call('DELETE', `/enterprise/content/shared-assets/${sent[0]?.id}`, OWNER);
  assert(revoke.code === 0 && revoke.data?.removed === true, '共享人可撤销共享', JSON.stringify(revoke.data));

  const badId = await call('DELETE', '/enterprise/content/shared-assets/abc', OWNER);
  assert(badId.status === 404 || badId.code === 404, '非数字 id 返回 404（不是 500）', `${badId.status}/${badId.code}`);

  const missing = await call('DELETE', '/enterprise/content/shared-assets/999999999', OWNER);
  assert(
    missing.code === 404 && missing.status === 404,
    '不存在的共享返回 404',
    `${missing.status}/${missing.code}/${missing.message}`,
  );

  const after = await call('GET', '/enterprise/content/shared-assets', OWNER);
  const rest = (after.data?.sent || []).filter((row) => row.assetId === String(ASSET_ID));
  assert(rest.length === 1, '撤销后只剩未撤销的一条', `${rest.length} 条`);

  // 空 id 在契约层（`asset.id: z.string().min(1)`）就挡下 → 422；
  // 非数字 id 能过契约，由服务层的「未选资产」分支拒 400。
  const notSelected = await call('POST', '/enterprise/content/shared-assets', OWNER, forgedBody('', MEMBER_IDS));
  assert(
    notSelected.code === 422 && notSelected.status === 422,
    '空资产 id 由契约层拒（422）',
    `${notSelected.status}/${notSelected.code}/${notSelected.message}`,
  );

  const badAssetId = await call('POST', '/enterprise/content/shared-assets', OWNER, forgedBody('abc', MEMBER_IDS));
  assert(
    badAssetId.code === 400 && badAssetId.status === 400 && badAssetId.message === '请选择要共享的资料',
    '非数字资产 id 由服务端拒「请选择要共享的资料」',
    `${badAssetId.status}/${badAssetId.code}/${badAssetId.message}`,
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
}

console.log(summary());
if (counts().failed > 0) process.exit(1);
