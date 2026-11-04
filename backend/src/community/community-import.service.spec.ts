import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ComfyCloudFile, ComfyCloudJob } from './comfy.client';
import { CommunityImportService } from './community-import.service';

/**
 * 迁移服务的口径单测：钉住「先验证、后落地」这条底线。
 *
 * 迁移动作一次能把别人的云端资产搬进本站并挂到管理员名下，所以三件事不能松：
 *  - Key 与存储渠道没验过，不允许登记任务（否则跑到一半才发现图片存不进去）；
 *  - 入库条目的作者必须是当前管理员，状态直接 APPROVED、来源标记可幂等；
 *  - 媒体只走 OssService（后台配置的存储渠道），不从上游直链填 coverKeys。
 */

const ADMIN = new CurrentUser('admin-1', 'admin', 'admin');

const API_GRAPH = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'sd.safetensors' },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a cat', clip: ['1', 1] },
  },
  '6': {
    class_type: 'KSampler',
    inputs: {
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['2', 0],
      latent_image: ['3', 0],
    },
  },
  '7': {
    class_type: 'VAEDecode',
    inputs: { samples: ['6', 0], vae: ['1', 2] },
  },
  '8': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'ComfyUI', images: ['7', 0] },
  },
};

const NODE_NAMES = [
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'KSampler',
  'VAEDecode',
  'SaveImage',
];

type CreateArg = { data: Record<string, unknown> };

function job(id: string, outputsCount = 1): ComfyCloudJob {
  return {
    id,
    status: 'completed',
    workflowId: 'wf-1',
    outputsCount,
    previewOutput: null,
  };
}

function setup() {
  const create = jest.fn(async (arg: CreateArg) => ({ id: 1, ...arg }));
  const prisma = {
    communityWorkflow: {
      findFirst: jest.fn(async () => null as null | { id: number }),
      create,
    },
  };
  const identity = {
    requireAdmin: jest.fn(),
    audit: jest.fn(async () => undefined),
  };
  const users = {
    displayName: jest.fn(async () => '平台管理员'),
  };
  const oss = {
    testConnection: jest.fn(async () => ({ ok: true })),
    upload: jest.fn(async (key: string) => ({ key })),
  };
  const comfy = {
    verifyKey: jest.fn(async () => true),
    listWorkflowFiles: jest.fn(async () => [] as ComfyCloudFile[]),
    listJobs: jest.fn(async () => [] as ComfyCloudJob[]),
    nodeNames: jest.fn(async () => new Set(NODE_NAMES)),
    getJobDetail: jest.fn(async () => ({
      id: 'job-abc12345',
      status: 'completed' as const,
      workflow: API_GRAPH,
      outputs: {
        '8': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
      },
      previewOutput: null as Record<string, unknown> | null,
      workflowId: 'wf-1',
    })),
    viewFile: jest.fn(async () => ({
      bytes: Buffer.from('png'),
      contentType: 'image/png',
    })),
    downloadBytes: jest.fn(async () => ({
      bytes: Buffer.from('png'),
      contentType: 'image/png',
    })),
  };
  const service = new CommunityImportService(
    prisma as never,
    identity as never,
    users as never,
    oss as never,
    comfy as never,
  );
  return { service, prisma, identity, users, oss, comfy, create };
}

/** 等后台任务跑完（进程内任务，最多等 1 秒）。 */
async function settle(service: CommunityImportService) {
  for (let i = 0; i < 100; i += 1) {
    const state = service.status(ADMIN).state;
    if (state !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return service.status(ADMIN).state;
}

describe('preview', () => {
  it('只验 Key 并清点，不下载、不写库', async () => {
    const { service, comfy, oss, create } = setup();
    comfy.listWorkflowFiles.mockResolvedValueOnce([
      { path: 'workflows/a.json', size: 10, modified: 1 },
    ]);
    comfy.listJobs.mockResolvedValueOnce([
      job('job-1', 3),
      { ...job('job-2'), status: 'failed' },
    ]);

    const result = await service.preview(ADMIN, '  sk-test-123456  ');

    expect(result).toEqual({ verified: true, workflows: 1, jobs: 1, media: 3 });
    expect(comfy.verifyKey).toHaveBeenCalledWith('sk-test-123456');
    expect(oss.upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('start', () => {
  it('Key 验不过就直接报错，不登记任务也不碰存储渠道', async () => {
    const { service, comfy, oss } = setup();
    comfy.verifyKey.mockRejectedValueOnce(
      new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Comfy Cloud 拒绝了这个 API Key',
      ),
    );

    await expect(
      service.start(ADMIN, { apiKey: 'sk-test-123456' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(oss.testConnection).not.toHaveBeenCalled();
    expect(service.status(ADMIN).state).toBe('idle');
  });

  it('存储渠道不可用时拒绝迁移（图片视频没地方落）', async () => {
    const { service, oss, create } = setup();
    oss.testConnection.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(
      service.start(ADMIN, { apiKey: 'sk-test-123456' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.SERVICE_UNAVAILABLE });
    expect(create).not.toHaveBeenCalled();
  });

  it('没有可迁移条目时明确报错，不留下空任务', async () => {
    const { service } = setup();

    await expect(
      service.start(ADMIN, { apiKey: 'sk-test-123456' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });
    expect(service.status(ADMIN).state).toBe('idle');
  });

  it('上一次还没跑完时拒绝重入', async () => {
    const { service, comfy } = setup();
    comfy.listJobs.mockResolvedValue([job('job-1')]);
    let release: (value: boolean) => void = () => undefined;
    comfy.verifyKey.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );

    const first = service.start(ADMIN, { apiKey: 'sk-test-123456' });
    await Promise.resolve();
    await expect(
      service.start(ADMIN, { apiKey: 'sk-test-123456' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RATE_LIMITED });
    release(true);
    await first;
    await settle(service);
  });
});

describe('迁移历史任务', () => {
  it('作者挂管理员、状态直接通过、封面来自本站存储', async () => {
    const { service, comfy, oss, identity, create } = setup();
    comfy.listJobs.mockResolvedValueOnce([job('job-abc12345')]);

    const started = await service.start(ADMIN, { apiKey: 'sk-test-123456' });
    expect(started.total).toBe(1);
    expect(await settle(service)).toBe('done');

    const status = service.status(ADMIN);
    expect(status.importedWorkflows).toBe(1);
    expect(status.importedMedia).toBe(1);
    expect(status.failed).toBe(0);

    expect(oss.upload).toHaveBeenCalledTimes(1);
    const uploadKey = oss.upload.mock.calls[0][0];
    expect(uploadKey.startsWith('community/import/')).toBe(true);

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ownerUserId: 'admin-1',
      ownerName: '平台管理员',
      status: 'APPROVED',
      format: 'api',
      mediaType: 'image',
      comfyUrl: 'comfy-cloud://job/job-abc12345',
      coverKeys: [uploadKey],
      source: 'USER',
    });
    expect(identity.audit).toHaveBeenCalledWith(
      'admin-1',
      '迁移 Comfy Cloud 工作流',
      expect.stringContaining('媒体 1 个'),
    );
  });

  it('重复迁移按来源标记跳过，不重复入库', async () => {
    const { service, comfy, prisma, create } = setup();
    comfy.listJobs.mockResolvedValueOnce([job('job-abc12345')]);
    prisma.communityWorkflow.findFirst.mockResolvedValueOnce({ id: 9 });

    await service.start(ADMIN, { apiKey: 'sk-test-123456' });
    expect(await settle(service)).toBe('done');
    expect(service.status(ADMIN).skipped).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });
});
