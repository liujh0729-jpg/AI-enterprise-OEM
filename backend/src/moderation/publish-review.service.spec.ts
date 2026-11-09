import type { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PublishReviewRegion } from '@enterprise/contracts';
import {
  AliyunGreenError,
  type AliyunGreenClient,
  type GreenScanResult,
} from './aliyun-green.client';
import {
  PUBLISH_REVIEW_SETTINGS_KEY,
  PublishReviewService,
  moderationMessage,
} from './publish-review.service';
import { stub } from '../../test/doubles';

const pass: GreenScanResult = {
  suggestion: 'pass',
  label: 'normal',
  labels: [],
  rate: 0,
  requestId: 'req-pass',
};

function setup(initial?: {
  enabled?: boolean;
  region?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  communityPost?: boolean;
  resume?: boolean;
}) {
  let stored: { value: string; updatedAt: Date } | null = null;
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(async () => {
        if (!stored) return null;
        return {
          key: PUBLISH_REVIEW_SETTINGS_KEY,
          value: stored.value,
          updatedAt: stored.updatedAt,
        };
      }),
      upsert: jest.fn(
        async (input: {
          create: { value: string };
          update: { value: string };
        }) => {
          stored = {
            value: input.create.value ?? input.update.value,
            updatedAt: new Date('2026-11-07T08:00:00Z'),
          };
          return { key: PUBLISH_REVIEW_SETTINGS_KEY, ...stored };
        },
      ),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    publishReviewLog: {
      create: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
  const client = {
    scan: jest.fn(async (): Promise<GreenScanResult> => pass),
    scanImage: jest.fn(async (): Promise<GreenScanResult> => pass),
    submitVideoScan: jest.fn(async (): Promise<string> => 'video-task-1'),
    videoScanResults: jest.fn(async () => ({})),
    postJson: jest.fn(),
  };
  const service = new PublishReviewService(
    stub<PrismaService>(prisma),
    stub<AliyunGreenClient>(client),
  );
  const configure = async () => {
    if (!initial) return;
    await service.save(
      {
        enabled: initial.enabled ?? true,
        region: (initial.region ?? 'cn-shanghai') as PublishReviewRegion,
        accessKeyId: initial.accessKeyId ?? 'LTAI5tUnitTestKey',
        accessKeySecret: initial.accessKeySecret ?? 'unit-test-secret',
        scenes: {
          communityPost: initial.communityPost ?? false,
          resume: initial.resume ?? false,
        },
      },
      'admin-unit',
    );
  };
  return { prisma, client, service, configure, stored: () => stored };
}

describe('发布审核配置服务', () => {
  beforeAll(() => {
    process.env.EXTERNAL_CRED_KEY = 'unit-test-external-key';
  });

  it('未配置时返回关闭可选场景、必选场景恒开的默认视图', async () => {
    const { service } = setup();
    await expect(service.view()).resolves.toMatchObject({
      enabled: true,
      configured: false,
      region: 'cn-shanghai',
      accessKeyIdMasked: '',
      scenes: {
        communityPost: false,
        resume: false,
        demand: true,
        service: true,
      },
      source: 'none',
      updatedAt: null,
    });
  });

  it('保存后凭据加密落库，视图只回掩码', async () => {
    const { service, stored } = setup();
    const view = await service.save(
      {
        enabled: true,
        region: 'cn-beijing',
        accessKeyId: 'LTAI5tUnitTestKey',
        accessKeySecret: 'unit-test-secret',
        scenes: { communityPost: true, resume: false },
      },
      'admin-unit',
    );
    expect(view).toMatchObject({
      configured: true,
      region: 'cn-beijing',
      accessKeyIdMasked: 'LTAI****tKey',
      scenes: {
        communityPost: true,
        resume: false,
        demand: true,
        service: true,
      },
      source: 'db',
    });
    const cipher = stored()?.value ?? '';
    expect(cipher.split(':')).toHaveLength(3);
    expect(cipher).not.toContain('LTAI5tUnitTestKey');
    expect(cipher).not.toContain('unit-test-secret');
  });

  it('首次保存缺少 AccessKey 时拒绝', async () => {
    const { service } = setup();
    await expect(
      service.save(
        {
          enabled: true,
          region: 'cn-shanghai',
          accessKeyId: '',
          accessKeySecret: '',
          scenes: { communityPost: false, resume: false },
        },
        'admin-unit',
      ),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('留空凭据表示沿用已保存值', async () => {
    const { service } = setup();
    await service.save(
      {
        enabled: true,
        region: 'cn-shanghai',
        accessKeyId: 'LTAI5tUnitTestKey',
        accessKeySecret: 'unit-test-secret',
        scenes: { communityPost: false, resume: false },
      },
      'admin-unit',
    );
    const view = await service.save(
      {
        enabled: false,
        region: 'cn-hangzhou',
        accessKeyId: '',
        accessKeySecret: '',
        scenes: { communityPost: false, resume: true },
      },
      'admin-unit',
    );
    expect(view.configured).toBe(true);
    expect(view.enabled).toBe(false);
    expect(view.region).toBe('cn-hangzhou');
  });

  it('未启用或未配置时不调用上游', async () => {
    const { service, client } = setup();
    await service.guard({
      userId: 'user-1',
      scene: 'demand',
      texts: ['需求正文'],
    });
    expect(client.scan).not.toHaveBeenCalled();
  });

  it('必选场景在开关关闭时仍送审，可选项关闭时跳过', async () => {
    const { service, client } = setup();
    await service.save(
      {
        enabled: true,
        region: 'cn-shanghai',
        accessKeyId: 'LTAI5tUnitTestKey',
        accessKeySecret: 'unit-test-secret',
        scenes: { communityPost: false, resume: false },
      },
      'admin-unit',
    );
    client.scan.mockImplementation(async () => pass);
    await service.guard({
      userId: 'user-1',
      scene: 'service',
      texts: ['服务介绍'],
    });
    expect(client.scan).toHaveBeenCalledTimes(1);
    await service.guard({
      userId: 'user-1',
      scene: 'resume',
      texts: ['简历摘要'],
    });
    expect(client.scan).toHaveBeenCalledTimes(1);
  });

  it('block 与 review 都拒绝发布并写入台账', async () => {
    const { service, client, prisma, configure } = setup({
      accessKeyId: 'LTAI5tUnitTestKey',
    });
    await configure();
    expect((await service.view()).configured).toBe(true);
    client.scan.mockImplementation(async () => ({
      ...pass,
      suggestion: 'block',
      label: 'spam',
      labels: ['spam'],
      requestId: 'req-block',
    }));
    await expect(
      service.guard({
        userId: 'user-1',
        scene: 'demand',
        texts: ['加微信刷单'],
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.CONTENT_MODERATION_BLOCKED,
    });
    expect(prisma.publishReviewLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scene: 'demand',
        userId: 'user-1',
        decision: 'BLOCK',
        suggestion: 'block',
        labels: 'spam',
        requestId: 'req-block',
      }),
    });
    expect(moderationMessage('block', ['spam'])).toBe(
      '发布内容未通过安全审核（命中：垃圾信息），请修改后再发布',
    );
  });

  it('上游异常时降级放行并记 ERROR 台账', async () => {
    const { service, client, prisma, configure } = setup({
      accessKeyId: 'LTAI5tUnitTestKey',
    });
    await configure();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    client.scan.mockImplementation(async () => {
      throw new AliyunGreenError(500, '阿里云内容安全连接失败');
    });
    await expect(
      service.guard({
        userId: 'user-1',
        scene: 'service',
        texts: ['服务介绍'],
      }),
    ).resolves.toBeUndefined();
    expect(prisma.publishReviewLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decision: 'ERROR',
        reason: '阿里云内容安全调用失败：阿里云内容安全连接失败',
      }),
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('空白文本不送审也不记台账', async () => {
    const { service, client, prisma } = setup({
      accessKeyId: 'LTAI5tUnitTestKey',
    });
    await service.guard({
      userId: 'user-1',
      scene: 'demand',
      texts: ['  ', null, undefined],
    });
    expect(client.scan).not.toHaveBeenCalled();
    expect(prisma.publishReviewLog.create).not.toHaveBeenCalled();
  });

  it('未配置内容安全时图片审核返回 off 且不调用上游', async () => {
    const { service, client } = setup();
    await expect(
      service.guardImage('https://cdn.example.com/a.png'),
    ).resolves.toMatchObject({
      status: 'off',
      note: '',
    });
    expect(client.scanImage).not.toHaveBeenCalled();
  });

  it('图片命中违规返回 block 并归一化命中标签', async () => {
    const { service, client, configure } = setup({
      accessKeyId: 'LTAI5tUnitTestKey',
    });
    await configure();
    client.scanImage.mockImplementation(async () => ({
      ...pass,
      suggestion: 'block',
      label: 'porn',
      labels: ['porn'],
    }));
    await expect(
      service.guardImage('https://cdn.example.com/a.png'),
    ).resolves.toMatchObject({
      status: 'block',
      labels: ['porn'],
    });
  });

  it('视频提交返回 pending 与 taskId，轮询后出结论', async () => {
    const { service, client, configure } = setup({
      accessKeyId: 'LTAI5tUnitTestKey',
    });
    await configure();
    await expect(
      service.submitVideo('https://cdn.example.com/a.mp4'),
    ).resolves.toMatchObject({
      status: 'pending',
      taskId: 'video-task-1',
    });
    client.videoScanResults.mockImplementation(async () => ({
      'video-task-1': {
        suggestion: 'block',
        label: 'terrorism',
        labels: ['terrorism'],
        rate: 99,
      },
    }));
    await expect(service.pollVideos(['video-task-1'])).resolves.toMatchObject({
      'video-task-1': { status: 'block', taskId: 'video-task-1' },
    });
  });
});
