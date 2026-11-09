import { CommunityService } from './community.service';
import { ComfyClient, MAX_DOWNLOAD_BYTES } from './comfy.client';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import type { OssService } from '../oss/oss.service';
import type { ComfyCrypto } from './comfy-crypto';
import type { CommunityAwardService } from './community-award.service';
import { stub } from '../../test/doubles';

/**
 * 创意社区服务的口径单测：钉住「纯 BYOK 的运行链路」和「跨账号读写收口」两组不变量。
 *
 * 这两条一旦松掉，代价分别是：拿别人的 Comfy 订阅跑任务（花钱且追责不清），
 * 以及看到 / 改动别人的工作流与产物。所以这里全部用假依赖，把「谁被调用、以什么参数被调用」看清。
 */

const OWNER = new CurrentUser('owner-1', 'owner', 'user');
const OTHER = new CurrentUser('other-1', 'other', 'user');
const ADMIN = new CurrentUser('admin-1', 'admin', 'admin');

const GRAPH = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'sd.safetensors' },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'default', clip: ['1', 1] },
  },
  '9': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
};

const SLOTS = [
  {
    key: 'prompt',
    label: '提示词',
    type: 'text',
    nodeId: '2',
    field: 'text',
    required: true,
  },
  {
    key: 'src',
    label: '输入图',
    type: 'image',
    nodeId: '9',
    field: 'image',
    required: true,
  },
];

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    code: 'wf_a1b2c3d4',
    source: 'USER',
    ownerUserId: 'owner-1',
    ownerName: 'Owner',
    title: '测试工作流',
    summary: '摘要',
    description: '说明',
    category: 'image',
    groupLabel: '文生图',
    tags: ['sdxl'],
    mediaType: 'image',
    format: 'api',
    workflowJson: GRAPH,
    slots: SLOTS,
    coverKeys: ['enterprise/cover.png', 'https://comfy.org/remote.png'],
    comfyUrl: '',
    status: 'APPROVED',
    auditNote: '',
    rewardedAt: null,
    runCount: 0,
    favoriteCount: 0,
    likeCount: 0,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * 假依赖的 jest.fn() 不带形参签名，取调用实参要过一道 unknown；
 * 项目开了 noUncheckedIndexedAccess，索引结果先判空再断言（没被调用时报「假依赖没被调用」比 undefined 好读）。
 */
function firstCall(mock: { mock: { calls: unknown[][] } }): unknown[] {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('假依赖没被调用');
  return call;
}
function firstArg(mock: {
  mock: { calls: unknown[][] };
}): Record<string, unknown> {
  return firstCall(mock)[0] as Record<string, unknown>;
}
/** 提交图里按节点取 inputs（开了 noUncheckedIndexedAccess，不能直接下标）。 */
function inputsOf(
  graph: Record<string, { inputs: Record<string, unknown> }>,
  nodeId: string,
): Record<string, unknown> {
  return (graph[nodeId] ?? { inputs: {} }).inputs;
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    workflowId: 7,
    userId: 'owner-1',
    jobId: 'job-1',
    status: 'queued',
    progressCurrent: 0,
    progressTotal: 0,
    queuePosition: 1,
    inputs: {},
    errorText: '',
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  };
}

function build() {
  const prisma = {
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => operations),
    communityWorkflow: {
      findUnique: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 7, code: 'wf_a1b2c3d4', title: '测试工作流' },
        ]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      // 详情里的浏览量自增是 fire-and-forget，故必须回 Promise
      update: jest.fn(async () => workflowRow()),
    },
    communityRun: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(runRow()),
    },
    communityRunOutput: { findMany: jest.fn().mockResolvedValue([]) },
    communityFavorite: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
    },
    communityLike: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
    },
    comfyCredential: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    pointTransaction: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
    },
  };
  const identity = {
    isPlatformAdmin: jest.fn((user: CurrentUser) => user.role === 'admin'),
    requireAdmin: jest.fn((user: CurrentUser) => {
      if (user.role !== 'admin') {
        throw new BusinessException(ErrorCode.FORBIDDEN, '需要管理员权限');
      }
    }),
    audit: jest.fn(async () => undefined),
  };
  const users = {
    displayName: jest.fn(async () => 'Owner'),
    displayNames: jest.fn(async () => new Map([['owner-1', '中文名']])),
  };
  const oss = {
    keyUrlOf: jest.fn((key: string) => `https://oss.example.com/${key}`),
    upload: jest.fn(async (_path: string, bytes: Buffer) => ({
      key: 'uploaded/key.png',
      url: 'https://oss.example.com/uploaded/key.png',
      size: bytes.length,
    })),
  };
  const comfy = {
    verifyKey: jest.fn(async () => undefined),
    submitJob: jest.fn(async () => ({
      id: 'job-1',
      status: 'queued' as const,
    })),
    getJob: jest.fn(),
    cancelJob: jest.fn(async () => undefined),
    nodeNames: jest.fn(
      async () =>
        new Set(['CheckpointLoaderSimple', 'CLIPTextEncode', 'LoadImage']),
    ),
    uploadAsset: jest.fn(async () => 'asset-1'),
  };
  const crypto = {
    encrypt: jest.fn((value: string) => `cipher:${value.length}`),
    decrypt: jest.fn(() => 'plain-key'),
  };
  const awards = {
    award: jest.fn(async () => ({ rewarded: true, points: 50, skipped: '' })),
    view: jest.fn(),
    save: jest.fn(),
  };
  const service = new CommunityService(
    stub<PrismaService>(prisma),
    stub<IdentityService>(identity),
    stub<UserLookupService>(users),
    stub<OssService>(oss),
    stub<ComfyClient>(comfy),
    stub<ComfyCrypto>(crypto),
    stub<CommunityAwardService>(awards),
  );
  // 目录取数：默认按 code / id 取到的都是同一行，具体用例再覆盖
  const byCode = (overrides?: Record<string, unknown>) => {
    const row = workflowRow(overrides);
    prisma.communityWorkflow.findUnique.mockResolvedValue(row);
    return row;
  };
  return {
    prisma,
    identity,
    users,
    oss,
    comfy,
    crypto,
    awards,
    service,
    byCode,
  };
}

function boundKey(prisma: ReturnType<typeof build>['prisma']) {
  prisma.comfyCredential.findUnique.mockResolvedValue({
    userId: 'owner-1',
    keyCipher: 'cipher:24',
    keyMask: 'comfy-****-abcdef',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastError: '',
  });
}

describe('运行：纯 BYOK', () => {
  it('没绑 Key 就拦住，给的是「去连接」而不是上游错误，且一次出站都不发', async () => {
    const { service, prisma, comfy, crypto, byCode } = build();
    byCode();
    await expect(service.run(OWNER, 'wf_a1b2c3d4', {})).rejects.toMatchObject({
      message: expect.stringContaining('连接 Comfy Cloud'),
    });
    expect(comfy.submitJob).not.toHaveBeenCalled();
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(prisma.communityRun.create).not.toHaveBeenCalled();
  });

  it('浏览型（只有 UI 格式）条目直接给「下载 JSON 自己打开」，不解密 Key', async () => {
    const { service, comfy, crypto, byCode } = build();
    byCode({ format: 'ui' });
    await expect(service.run(OWNER, 'wf_a1b2c3d4', {})).rejects.toMatchObject({
      message: expect.stringContaining('站内不能直接运行'),
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(comfy.submitJob).not.toHaveBeenCalled();
  });

  it('用本人解密出来的 Key 提交：图片槽换成 Comfy 资产，台账按本人 userId 落库', async () => {
    const { service, prisma, comfy, crypto, identity, byCode } = build();
    byCode();
    boundKey(prisma);
    prisma.communityRun.create.mockResolvedValue(runRow());
    const result = await service.run(OWNER, 'wf_a1b2c3d4', {
      prompt: '一只猫',
      src: 'data:image/png;base64,AAAA',
    });
    expect(crypto.decrypt).toHaveBeenCalledWith('cipher:24');
    expect(comfy.uploadAsset).toHaveBeenCalledWith(
      'plain-key',
      expect.any(Buffer),
      'input.png',
      'image/png',
    );
    const submitted = firstCall(comfy.submitJob);
    expect(submitted[0]).toBe('plain-key');
    const graph = submitted[1] as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(inputsOf(graph, '2').text).toBe('一只猫');
    expect(inputsOf(graph, '9').image).toEqual({
      __type: 'core/ASSET',
      info: { id: 'asset-1' },
    });
    const created = firstArg(prisma.communityRun.create) as {
      data: Record<string, unknown>;
    };
    expect(created.data.userId).toBe('owner-1');
    expect(created.data.jobId).toBe('job-1');
    // 台账不存整张图：base64 只留占位，避免 JSON 列被撑爆
    expect(created.data.inputs).toEqual({
      prompt: '一只猫',
      src: expect.stringMatching(/^<image \d+B>$/),
    });
    expect(prisma.communityWorkflow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { runCount: { increment: 1 } } }),
    );
    expect(identity.audit).toHaveBeenCalledWith(
      'owner-1',
      '创意社区运行工作流',
      expect.stringContaining('job-1'),
    );
    expect(result.status).toBe('queued');
    expect(result.active).toBe(true);
    expect(result.workflowCode).toBe('wf_a1b2c3d4');
  });

  it('必填槽位没填 → 连上游都不碰，直接中文校验错', async () => {
    const { service, prisma, comfy, byCode } = build();
    byCode();
    boundKey(prisma);
    await expect(
      service.run(OWNER, 'wf_a1b2c3d4', { prompt: '一只猫' }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(comfy.submitJob).not.toHaveBeenCalled();
    expect(prisma.communityRun.create).not.toHaveBeenCalled();
  });

  it('运行记录只本人可见：别人的 id 一律当不存在', async () => {
    const { service, prisma, comfy } = build();
    prisma.communityRun.findFirst.mockResolvedValue(null);
    await expect(service.runStatus(OTHER, '21')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.cancelRun(OTHER, '21')).rejects.toMatchObject({
      message: expect.stringContaining('运行记录不存在'),
    });
    expect(comfy.cancelJob).not.toHaveBeenCalled();
    // 编号本身不合法时也不去查库
    prisma.communityRun.findFirst.mockClear();
    await expect(service.runStatus(OWNER, 'abc')).rejects.toBeInstanceOf(
      BusinessException,
    );
    expect(prisma.communityRun.findFirst).not.toHaveBeenCalled();
  });

  it('取消：上游说找不到任务时，本地照样收口成已取消，别让界面卡在排队中', async () => {
    const { service, prisma, comfy } = build();
    boundKey(prisma);
    prisma.communityRun.findFirst.mockResolvedValue(
      runRow({ status: 'running', jobId: 'job-9' }),
    );
    prisma.communityRun.findUnique.mockResolvedValue(
      runRow({ status: 'canceled', jobId: 'job-9' }),
    );
    comfy.cancelJob.mockRejectedValue(
      new BusinessException(ErrorCode.NOT_FOUND, '上游找不到'),
    );
    const result = await service.cancelRun(OWNER, '21');
    expect(prisma.communityRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'canceled' }),
      }),
    );
    expect(result.status).toBe('canceled');
    // 终态任务不能再取消
    prisma.communityRun.findFirst.mockResolvedValue(
      runRow({ status: 'succeeded' }),
    );
    await expect(service.cancelRun(OWNER, '21')).rejects.toMatchObject({
      message: expect.stringContaining('已经结束'),
    });
    // 上游真失败（非 404）时不能假装取消成功
    prisma.communityRun.findFirst.mockResolvedValue(
      runRow({ status: 'running', jobId: 'job-9' }),
    );
    comfy.cancelJob.mockRejectedValue(
      new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, '上游炸了'),
    );
    await expect(service.cancelRun(OWNER, '21')).rejects.toMatchObject({
      message: expect.stringContaining('上游炸了'),
    });
  });

  it('状态轮询：已完成的记录不再打上游；没 Key 时也只回本地状态', async () => {
    const { service, prisma, comfy } = build();
    prisma.communityRun.findFirst.mockResolvedValue(
      runRow({ status: 'succeeded' }),
    );
    const done = await service.runStatus(OWNER, '21');
    expect(done.status).toBe('succeeded');
    expect(comfy.getJob).not.toHaveBeenCalled();

    prisma.communityRun.findFirst.mockResolvedValue(
      runRow({ status: 'running', jobId: 'job-9' }),
    );
    comfy.getJob.mockResolvedValue({
      id: 'job-9',
      status: 'running',
      queuePosition: 0,
      progressCurrent: 30,
      progressTotal: 100,
      outputs: [],
      errorText: '',
    });
    const running = await service.runStatus(OWNER, '21');
    // 未绑定 Key（comfyCredential.findUnique → null）时跳过上游，进度仍是本地值
    expect(running.progressCurrent).toBe(0);
    expect(comfy.getJob).not.toHaveBeenCalled();

    boundKey(prisma);
    const withKey = await service.runStatus(OWNER, '21');
    expect(withKey.progressCurrent).toBe(30);
    expect(comfy.getJob).toHaveBeenCalledWith('plain-key', 'job-9');
  });
});

describe('可见性与归属', () => {
  it('未过审的条目：别人看不到，作者自己看得到并能管理', async () => {
    const { service, byCode } = build();
    byCode({ status: 'PENDING' });
    await expect(service.detail(OTHER, 'wf_a1b2c3d4')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    byCode({ status: 'PENDING' });
    const mine = await service.detail(OWNER, 'wf_a1b2c3d4');
    expect(mine.canManage).toBe(true);
    expect(mine.statusLabel).toBe('待审核');
    // 封面：对象键走本站桶，http 原样保留（官方模板就存的是外链）
    expect(mine.covers).toEqual([
      'https://oss.example.com/enterprise/cover.png',
      'https://comfy.org/remote.png',
    ]);
    expect(mine.runnable).toBe(true);
    expect(mine.slots.map((slot) => slot.key)).toEqual(['prompt', 'src']);
    byCode({ source: 'OFFICIAL', ownerUserId: '' });
    const official = await service.detail(OTHER, 'wf_a1b2c3d4');
    expect(official.canManage).toBe(false);
    expect(official.ownerName).toBe('Owner');
  });

  it('官方模板与他人条目都不能改、不能下架', async () => {
    const { service, prisma, byCode } = build();
    byCode({ source: 'OFFICIAL' });
    await expect(service.unpublish(OTHER, 'wf_a1b2c3d4')).rejects.toMatchObject(
      {
        errorCode: ErrorCode.FORBIDDEN,
        message: expect.stringContaining('官方模板'),
      },
    );
    byCode({ ownerUserId: 'someone-else' });
    await expect(
      service.updateWorkflow(OTHER, 'wf_a1b2c3d4', { title: '改成我的' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('只有作者本人'),
    });
    expect(prisma.communityWorkflow.update).not.toHaveBeenCalled();
    // 管理员可以下架他人条目（收口在同一个校验里，靠 isPlatformAdmin 放行）
    byCode({ ownerUserId: 'someone-else' });
    await expect(service.unpublish(ADMIN, 'wf_a1b2c3d4')).resolves.toEqual({
      status: 'REMOVED',
    });
  });

  it('改 JSON 一定重回待审核；只改文案不动状态', async () => {
    const { service, prisma, comfy, byCode } = build();
    boundKey(prisma);
    byCode({ status: 'APPROVED' });
    prisma.communityWorkflow.update.mockResolvedValue(
      workflowRow({ status: 'PENDING' }),
    );
    await service.updateWorkflow(OWNER, 'wf_a1b2c3d4', {
      workflowJson: GRAPH,
      slots: SLOTS,
    });
    expect(comfy.nodeNames).toHaveBeenCalledWith('plain-key');
    expect(firstArg(prisma.communityWorkflow.update).data).toMatchObject({
      status: 'PENDING',
      format: 'api',
    });

    prisma.communityWorkflow.update.mockClear();
    comfy.nodeNames.mockClear();
    byCode({ status: 'APPROVED' });
    await service.updateWorkflow(OWNER, 'wf_a1b2c3d4', { title: '只改标题' });
    expect(comfy.nodeNames).not.toHaveBeenCalled();
    const edited = firstArg(prisma.communityWorkflow.update).data as Record<
      string,
      unknown
    >;
    expect(edited.status).toBeUndefined();
  });

  it('发布：先拿本人账号的节点清单校验，落库是待审核 + USER 来源 + 新 code', async () => {
    const { service, prisma, comfy, identity } = build();
    boundKey(prisma);
    prisma.communityWorkflow.create.mockResolvedValue(
      workflowRow({ code: 'wf_new00001', status: 'PENDING' }),
    );
    const draft = await service.publish(OWNER, {
      title: '我的新工作流',
      category: 'image',
      mediaType: 'image',
      tags: ['sdxl', 'sdxl', '', 'x'.repeat(60)],
      workflowJson: GRAPH,
      slots: SLOTS,
    });
    expect(comfy.nodeNames).toHaveBeenCalled();
    const data = prisma.communityWorkflow.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      source: 'USER',
      ownerUserId: 'owner-1',
      status: 'PENDING',
      format: 'api',
    });
    expect(String(data.code)).toMatch(/^wf_[0-9a-f]{8}$/);
    // 标签去重、去空、截断到 30 字符，最多 12 个
    expect(data.tags).toEqual(['sdxl', 'x'.repeat(30)]);
    expect(draft.statusLabel).toBe('待审核');
    expect(identity.audit).toHaveBeenCalledWith(
      'owner-1',
      '创意社区发布工作流',
      expect.any(String),
    );
  });

  it('发布不过校验就不落库（未知节点直接拒）', async () => {
    const { service, prisma, comfy } = build();
    boundKey(prisma);
    comfy.nodeNames.mockResolvedValue(new Set(['KSampler']));
    await expect(
      service.publish(OWNER, {
        title: '用了不存在节点',
        workflowJson: { '1': { class_type: 'LoadImage', inputs: {} } },
        slots: [],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('不存在') });
    expect(prisma.communityWorkflow.create).not.toHaveBeenCalled();
  });

  it('收藏是幂等的：重复点收藏不再加第二次数', async () => {
    const { service, prisma, byCode } = build();
    byCode();
    prisma.communityFavorite.findUnique.mockResolvedValue({ id: 3 });
    prisma.communityWorkflow.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.code ? workflowRow({ favoriteCount: 5 }) : { favoriteCount: 5 },
        ),
    );
    const result = await service.setFavorite(OWNER, 'wf_a1b2c3d4', true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ favorited: true, favoriteCount: 5 });
  });
});

describe('平台后台', () => {
  it('非管理员调后台接口直接拒，不打库', async () => {
    const { service, prisma } = build();
    await expect(service.adminStats(OTHER)).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
    expect(prisma.communityWorkflow.count).not.toHaveBeenCalled();
  });

  it('驳回必须写理由；推荐必须先通过；两者都不触发发奖', async () => {
    const { service, prisma, awards, byCode } = build();
    byCode({ status: 'PENDING' });
    await expect(
      service.adminDecide(ADMIN, 'wf_a1b2c3d4', 'reject', '  '),
    ).rejects.toMatchObject({
      message: expect.stringContaining('驳回要写清理由'),
    });
    await expect(
      service.adminDecide(ADMIN, 'wf_a1b2c3d4', 'recommend', ''),
    ).rejects.toMatchObject({
      message: expect.stringContaining('要先审核通过'),
    });
    expect(prisma.communityWorkflow.update).not.toHaveBeenCalled();
    expect(awards.award).not.toHaveBeenCalled();
  });

  it('通过/推荐把发奖结果原样带回后台，并把未发奖原因写进审计', async () => {
    const { service, prisma, awards, identity, byCode } = build();
    byCode({ status: 'APPROVED', source: 'OFFICIAL', ownerUserId: '' });
    awards.award.mockResolvedValue({
      rewarded: false,
      points: 0,
      skipped: '官方模板无站内作者',
    });
    const result = await service.adminDecide(
      ADMIN,
      'wf_a1b2c3d4',
      'recommend',
      '主推',
    );
    expect(result).toEqual({
      status: 'RECOMMENDED',
      statusLabel: '已推荐',
      rewarded: false,
      rewardPoints: 0,
    });
    expect(awards.award).toHaveBeenCalledWith(
      ADMIN,
      expect.objectContaining({ code: 'wf_a1b2c3d4', source: 'OFFICIAL' }),
      'recommend',
    );
    expect(identity.audit).toHaveBeenCalledWith(
      'admin-1',
      '创意社区审核工作流',
      expect.stringContaining('未发奖：官方模板无站内作者'),
    );
    expect(firstArg(prisma.communityWorkflow.update).data).toMatchObject({
      status: 'RECOMMENDED',
      auditBy: 'admin-1',
    });
  });

  it('驳回与下架不发奖，但仍落状态与审计', async () => {
    const { service, prisma, awards, byCode } = build();
    byCode({ status: 'PENDING' });
    prisma.communityWorkflow.update.mockResolvedValue(
      workflowRow({ status: 'REJECTED' }),
    );
    const rejected = await service.adminDecide(
      ADMIN,
      'wf_a1b2c3d4',
      'reject',
      '节点不在册',
    );
    expect(rejected).toEqual({
      status: 'REJECTED',
      statusLabel: '已驳回',
      rewarded: false,
      rewardPoints: 0,
    });
    expect(awards.award).not.toHaveBeenCalled();

    const removed = await service.adminDecide(
      ADMIN,
      'wf_a1b2c3d4',
      'remove',
      '违规',
    );
    expect(removed.status).toBe('REMOVED');
    expect(awards.award).not.toHaveBeenCalled();
  });

  it('Key 保存：校验通过才落密文与掩码，失败只留失败原因，任何返回都不带明文', async () => {
    const { service, prisma, comfy, crypto, identity, byCode } = build();
    byCode();
    // 落库后库里就是一行密文：connectStatus 回读它
    prisma.comfyCredential.upsert.mockImplementation(
      async ({ create }: { create: Record<string, unknown> }) => {
        prisma.comfyCredential.findUnique.mockResolvedValue({
          userId: 'owner-1',
          ...create,
        });
        return create;
      },
    );
    const status = await service.saveCredential(OWNER, '  comfy-pat-abcdef  ');
    expect(comfy.verifyKey).toHaveBeenCalledWith('comfy-pat-abcdef');
    const upsert = prisma.comfyCredential.upsert.mock.calls[0][0];
    expect(upsert.create.keyCipher).toBe('cipher:16');
    // 界面上只能看到前 4 + 后 4
    expect(upsert.create.keyMask).toBe('comf…cdef');
    expect(JSON.stringify(upsert)).not.toContain('comfy-pat-abcdef');
    expect(status.connected).toBe(true);
    expect(status.keyMask).toBe('comf…cdef');
    expect(status.subscriptionRequired).toBe(true);
    expect(status.pricingUrl).toBe('https://www.comfy.org/pricing');
    expect(identity.audit).toHaveBeenCalledWith(
      'owner-1',
      '绑定 Comfy Cloud Key',
      expect.any(String),
    );

    prisma.comfyCredential.upsert.mockClear();
    comfy.verifyKey.mockRejectedValue(
      new BusinessException(ErrorCode.BAD_REQUEST, 'Key 无效'),
    );
    await expect(
      service.saveCredential(OWNER, 'comfy-pat-badddd'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Key 无效'),
    });
    const failed = prisma.comfyCredential.upsert.mock.calls[0][0];
    expect(failed.create.lastError).toContain('Key 无效');
    expect(failed.create.keyCipher).toBe('cipher:16');
    // 已绑过的人再粘一把握失败的 Key：只记失败原因，不能把 update 分支写成覆盖密文以外的字段
    expect(Object.keys(failed.update)).toEqual(['lastError']);
    expect(crypto.encrypt).toHaveBeenCalledWith('comfy-pat-badddd');
  });

  it('Key 太短直接拒（不打上游），解绑走 deleteMany + 审计', async () => {
    const { service, prisma, comfy } = build();
    await expect(service.saveCredential(OWNER, 'short')).rejects.toMatchObject({
      message: expect.stringContaining('API Key 看起来不完整'),
    });
    expect(comfy.verifyKey).not.toHaveBeenCalled();
    await service.clearCredential(OWNER);
    expect(prisma.comfyCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner-1' },
    });
    const cleared = await service.connectStatus(OWNER);
    expect(cleared.connected).toBe(false);
  });

  it('积分规则读写都要管理员，写入后落审计', async () => {
    const { service, awards, identity } = build();
    awards.view.mockResolvedValue({
      approveReward: 10,
      recommendReward: 50,
    });
    await expect(service.adminSettings(OTHER)).rejects.toBeInstanceOf(
      BusinessException,
    );
    awards.save.mockResolvedValue({
      approveReward: 20,
      recommendReward: 80,
      perUserDailyCap: 200,
      siteDailyCap: 2000,
    });
    const saved = await service.adminSaveSettings(ADMIN, {
      approveReward: 20,
      recommendReward: 80,
      perUserDailyCap: 200,
      siteDailyCap: 2000,
    });
    expect(saved.approveReward).toBe(20);
    expect(awards.save).toHaveBeenCalled();
    expect(identity.audit).toHaveBeenCalledWith(
      'admin-1',
      '创意社区积分规则变更',
      expect.stringContaining('通过20'),
    );
  });
});

describe('运行输入图片的落地边界', () => {
  it('上传输入：只收图片、封顶 50MB，落本站桶后回对象键', async () => {
    const { service, oss } = build();
    await expect(
      service.uploadInput(OWNER, {
        name: 'a.txt',
        type: 'text/plain',
        bytes: Buffer.from('hi'),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('只能是图片文件'),
    });
    await expect(
      service.uploadInput(OWNER, {
        name: '../evil.png',
        type: 'image/png',
        bytes: Buffer.alloc(MAX_DOWNLOAD_BYTES.image + 1),
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.PAYLOAD_TOO_LARGE });
    const uploaded = await service.uploadInput(OWNER, {
      name: '../evil.png',
      type: 'image/png',
      bytes: Buffer.from('fake'),
    });
    expect(uploaded.key).toBe('uploaded/key.png');
    const objectPath = String(oss.upload.mock.calls[0][0]);
    // 文件名里的路径分隔符被洗掉：对象键不会跳出自己的前缀，也不会带相对路径
    expect(objectPath).not.toMatch(/\.\.\//);
    expect(objectPath).toContain(
      `enterprise/${OWNER.userId}/community-inputs/`,
    );
  });
});
