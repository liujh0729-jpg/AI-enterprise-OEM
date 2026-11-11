import { BusinessException } from '../common/business.exception';
import { CurrentUser } from '../auth/current-user';
import type { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { AccountCrypto } from '../account/account-crypto';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { MktService } from './mkt.service';

/**
 * docs §8.4：营销内容生成完成 → 内容审核；审核通过 → 渠道发布。
 * 这里钉住三件事：审核派发/收口、驳回不派发布、改内容必须重审（轮次 +1）。
 */

type Row = Record<string, unknown>;

const user = new CurrentUser('owner-1', 'owner', 'user');

function orgOf(overrides: Partial<HrmOrg> = {}): HrmOrg {
  return {
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-1',
    actorId: 'owner-1',
    isOwner: true,
    isAdmin: true,
    roles: [],
    positions: [],
    department: '',
    ...overrides,
  };
}

function artifactRow(overrides: Row = {}) {
  return {
    id: 1,
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-1',
    title: '春季上新文案',
    kind: 'COPY',
    body: '旧内容',
    status: 'READY',
    sourceRunId: 9,
    reviewStatus: 'PENDING',
    reviewRound: 1,
    reviewerId: '',
    reviewedAt: null,
    reviewNote: '',
    publishStatus: 'NONE',
    publishChannel: '',
    publishNote: '',
    publishedAt: null,
    createdBy: 'owner-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(row: Row = artifactRow()) {
  const assigned: Row[] = [];
  const synced: Row[] = [];
  let current = { ...row };
  const prisma = {
    mktArtifact: {
      findFirst: jest.fn(async () => current),
      update: jest.fn(
        async ({ data }: { data: Row }) => (current = { ...current, ...data }),
      ),
    },
    orgStaff: {
      findMany: jest.fn(async () => [
        {
          memberUserId: 'ops-1',
          roles: ['MARKETING'],
          positions: [{ name: '品牌负责人' }],
        },
      ]),
    },
  };
  const scope = { resolve: jest.fn(async () => orgOf()) };
  const mechanisms = { dispatch: jest.fn(async () => undefined) };
  const tasks = {
    assign: jest.fn(async (draft: Row) => {
      assigned.push(draft);
      return null;
    }),
    syncStatus: jest.fn(async (input: Row) => {
      synced.push(input);
      return null;
    }),
  };
  const service = new MktService(
    stub<PrismaService>(prisma),
    stub<HrmScopeService>(scope),
    stub<MechanismService>(mechanisms),
    stub<AiEvalService>(),
    stub<AccountCrypto>(),
    tasks,
  );
  return { service, prisma, assigned, synced, mechanisms };
}

describe('营销内容审核与渠道发布（docs §8.4）', () => {
  it('审核通过：资产转为可用、派渠道发布待办、审核任务收口', async () => {
    const ctx = setup();
    const view = await ctx.service.reviewArtifact(user, {
      id: 1,
      decision: 'approve',
      note: '结构与品牌一致',
    });
    expect(view.reviewStatus).toBe('APPROVED');
    expect(view.reviewerId).toBe('owner-1');
    expect(view.publishStatus).toBe('PENDING');
    expect(view.status).toBe('READY');
    expect(ctx.synced[0]).toMatchObject({
      source: 'mkt',
      sourceId: 'review:1:r1',
      assigneeUserId: 'ops-1',
      terminal: true,
    });
    expect(ctx.assigned).toHaveLength(1);
    expect(ctx.assigned[0]).toMatchObject({
      source: 'mkt',
      sourceId: 'publish:1:r1',
      title: '渠道发布：春季上新文案',
      assigneeUserId: 'ops-1',
    });
    expect(ctx.mechanisms.dispatch).toHaveBeenCalledWith(
      expect.anything(),
      'mkt.artifact.approved',
      expect.objectContaining({ artifactId: 1 }),
    );
  });

  it('审核驳回：退回草稿且不派发布待办', async () => {
    const ctx = setup();
    const view = await ctx.service.reviewArtifact(user, {
      id: 1,
      decision: 'reject',
      note: '卖点表述不合规',
    });
    expect(view.reviewStatus).toBe('REJECTED');
    expect(view.status).toBe('DRAFT');
    expect(view.publishStatus).toBe('NONE');
    expect(ctx.assigned).toHaveLength(0);
    expect(ctx.synced[0]).toMatchObject({
      sourceId: 'review:1:r1',
      terminal: true,
      sourceStatusLabel: '审核驳回',
    });
  });

  it('非待审核状态不能重复审核', async () => {
    const ctx = setup(artifactRow({ reviewStatus: 'APPROVED' }));
    await expect(
      ctx.service.reviewArtifact(user, {
        id: 1,
        decision: 'approve',
        note: '',
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('未审核通过不能发布；发布后回执落库并收口发布任务', async () => {
    const blocked = setup(artifactRow({ reviewStatus: 'PENDING' }));
    await expect(
      blocked.service.publishArtifact(user, {
        id: 1,
        channel: '公众号',
        note: '',
      }),
    ).rejects.toBeInstanceOf(BusinessException);

    const ctx = setup(
      artifactRow({ reviewStatus: 'APPROVED', publishStatus: 'PENDING' }),
    );
    const view = await ctx.service.publishArtifact(user, {
      id: 1,
      channel: '小红书',
      note: '链接 https://x.example/1',
    });
    expect(view.publishStatus).toBe('PUBLISHED');
    expect(view.publishChannel).toBe('小红书');
    expect(view.publishedAt).not.toBe('');
    expect(ctx.synced[0]).toMatchObject({
      sourceId: 'publish:1:r1',
      terminal: true,
      sourceStatusLabel: '已发布：小红书',
    });
  });

  it('改已通过的内容：轮次 +1 重新进入审核，旧轮次任务就地收口', async () => {
    const ctx = setup(
      artifactRow({ reviewStatus: 'APPROVED', publishStatus: 'PENDING' }),
    );
    const view = await ctx.service.saveArtifact(user, {
      id: 1,
      title: '春季上新文案',
      kind: 'COPY',
      body: '新内容',
      status: 'READY',
    });
    expect(view.reviewStatus).toBe('PENDING');
    expect(view.reviewRound).toBe(2);
    expect(view.publishStatus).toBe('NONE');
    // 旧轮次审核/发布任务都要收口，避免僵尸待办
    expect(ctx.synced.map((item) => item.sourceId)).toEqual([
      'review:1:r1',
      'publish:1:r1',
    ]);
    expect(ctx.assigned[0]).toMatchObject({ sourceId: 'review:1:r2' });
  });

  it('手工资产（未进入审核链路）改动不触发审核', async () => {
    const ctx = setup(artifactRow({ reviewStatus: 'NONE', reviewRound: 0 }));
    const view = await ctx.service.saveArtifact(user, {
      id: 1,
      title: '手工整理文案',
      kind: 'COPY',
      body: '改过的内容',
      status: 'DRAFT',
    });
    expect(view.reviewStatus).toBe('NONE');
    expect(ctx.assigned).toHaveLength(0);
  });
});
