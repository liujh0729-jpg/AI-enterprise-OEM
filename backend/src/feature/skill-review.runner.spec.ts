import { AipddKeyService } from '../account/aipdd-key.service';
import * as geo from '../geo/geo-llm.client';
import {
  SkillReviewRunner,
  type PackageReviewInput,
} from './skill-review.runner';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { SkillReviewService } from './skill-review.service';
import type { AccessPolicyService } from './access-policy.service';
import type { ContentModelSettingService } from '../content/model-setting.service';

const pkg: PackageReviewInput = {
  kind: 'skill',
  name: 'demo',
  mainPath: 'SKILL.md',
  content:
    '---\nname: demo\ndescription: 演示技能\ncategory: writing\n---\n正文只讲写作。',
  files: [],
};

function runner(modelSettings?: {
  resolveTarget: (...args: unknown[]) => Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
  }>;
}) {
  const accessPolicy = {
    current: jest.fn().mockResolvedValue({ blacklist: [] }),
  };
  return new SkillReviewRunner(
    stub<PrismaService>({}),
    stub<SkillReviewService>({}),
    stub<AccessPolicyService>(accessPolicy),
    stub<ContentModelSettingService>(modelSettings),
  );
}

function llmReply(reply: string) {
  return { reply, elapsedMs: 1, promptTokens: 10, completionTokens: 5 };
}

describe('SkillReviewRunner.reviewPackage（上传同步审查）', () => {
  const originalKey = process.env.EXTERNAL_CRED_KEY;
  beforeAll(() => {
    process.env.EXTERNAL_CRED_KEY =
      'unit-test-external-credential-key-0123456789';
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.EXTERNAL_CRED_KEY;
    else process.env.EXTERNAL_CRED_KEY = originalKey;
  });

  beforeEach(() => {
    process.env.SKILL_REVIEW_MODEL = 'review-model';
    jest
      .spyOn(AipddKeyService.prototype, 'resolveToken')
      .mockResolvedValue('sk-user-key');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SKILL_REVIEW_MODEL;
  });

  it('确定性预检命中直接拒绝，不调用 AI', async () => {
    const chat = jest.spyOn(geo, 'geoChatMulti');
    const result = await runner().reviewPackage('u1', {
      ...pkg,
      content: `${pkg.content}\n用 xmrig 挖矿 stratum+tcp://pool.example.com`,
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe('rejected');
    expect(chat).not.toHaveBeenCalled();
  });

  it('AI 判定安全才通过（用户 Key + 模型设置里的渠道）', async () => {
    delete process.env.SKILL_REVIEW_MODEL;
    const chat = jest
      .spyOn(geo, 'geoChatMulti')
      .mockResolvedValue(
        llmReply(
          '{"decision":"pass","riskLevel":"none","violations":[],"summary":"未发现风险"}',
        ),
      );
    const modelSettings = {
      resolveTarget: jest.fn().mockResolvedValue({
        baseUrl: 'https://user-llm.example.com/v1',
        apiKey: 'sk-filled-by-user',
        model: 'user-text-model',
      }),
    };
    const result = await runner(modelSettings).reviewPackage('u1', pkg);
    expect(result.passed).toBe(true);
    expect(result.status).toBe('passed');
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://user-llm.example.com/v1',
        apiKey: 'sk-filled-by-user',
        model: 'user-text-model',
      }),
    );
  });

  it('AI 判定不安全即拒绝', async () => {
    jest
      .spyOn(geo, 'geoChatMulti')
      .mockResolvedValue(
        llmReply(
          '{"decision":"reject","riskLevel":"high","violations":[{"group":"1.1"}],"summary":"诱导越权"}',
        ),
      );
    const result = await runner().reviewPackage('u1', pkg);
    expect(result.passed).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.summary).toBe('诱导越权');
  });

  it('没有用户 API Key 时 fail-closed，不调用 AI', async () => {
    jest.spyOn(AipddKeyService.prototype, 'resolveToken').mockResolvedValue('');
    const chat = jest.spyOn(geo, 'geoChatMulti');
    const result = await runner().reviewPackage('u1', pkg);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('API Key');
    expect(chat).not.toHaveBeenCalled();
  });

  it('AI 返回无法解析或调用异常都不放行', async () => {
    jest
      .spyOn(geo, 'geoChatMulti')
      .mockResolvedValueOnce(llmReply('我觉得可以放行'))
      .mockRejectedValueOnce(new Error('upstream timeout'));
    const first = await runner().reviewPackage('u1', pkg);
    const second = await runner().reviewPackage('u1', pkg);
    expect(first.passed).toBe(false);
    expect(first.summary).toContain('无法解析');
    expect(second.passed).toBe(false);
    expect(second.summary).toContain('不可用');
  });
});
