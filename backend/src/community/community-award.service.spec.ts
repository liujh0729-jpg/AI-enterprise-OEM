import { CommunityAwardService } from './community-award.service';
import { CurrentUser } from '../auth/current-user';

/**
 * 社区奖励发放的单测：重点是「幂等靠积分流水，而不是状态字段」和「不发奖也绝不能把审核动作带崩」。
 *
 * 发奖是真金白银：重复发 = 平台亏积分，漏发 = 创作者寒心。
 * 两个帽子和「官方条目永不发奖」都必须在这里钉死。
 */

const ADMIN = new CurrentUser('admin-1', 'admin', 'admin');
const OWNER_WORKFLOW = {
  id: 7,
  code: 'wf_a1b2c3d4',
  source: 'USER',
  ownerUserId: 'owner-1',
  title: '我的文生图工作流',
};

/** flag 表按 key 给值：缺省的键回空串，让 view() 走默认值。 */
function build(flags: Record<string, string> = {}) {
  const prisma = {
    pointTransaction: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    communityWorkflow: {
      findUnique: jest.fn().mockResolvedValue({ rewardedAt: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const points = { credit: jest.fn().mockResolvedValue({}) };
  const settings = {
    flag: jest.fn(async (key: string) => flags[key] ?? ''),
    setFlag: jest.fn().mockResolvedValue(undefined),
  };
  const identity = { audit: jest.fn().mockResolvedValue(undefined) };
  const service = new CommunityAwardService(
    prisma as never,
    points as never,
    settings as never,
    identity as never,
  );
  return { prisma, points, settings, identity, service };
}

describe('积分规则读写', () => {
  it('没配过就走默认：通过 0 分、推荐 200 分、单人日帽 1000、全站日帽 20000', async () => {
    const { service } = build();
    expect(await service.view()).toEqual({
      approveReward: 0,
      recommendReward: 200,
      perUserDailyCap: 1000,
      siteDailyCap: 20000,
    });
  });

  it('脏值不生效：负数/非法数字回落默认，超大值截到上限', async () => {
    const { service } = build({
      community_approve_reward: '50',
      community_recommend_reward: '999999999',
      community_reward_daily_per_user: 'abc',
      community_reward_daily_site_cap: '-5',
    });
    expect(await service.view()).toEqual({
      approveReward: 50,
      // 上限 100000：配错了也不会把预算开飞
      recommendReward: 100000,
      perUserDailyCap: 1000,
      siteDailyCap: 20000,
    });
  });

  it('保存规则：非法值改写成默认，没传的字段一律不动', async () => {
    const { service, settings } = build();
    await service.save({
      approveReward: -1,
      recommendReward: 300,
      perUserDailyCap: 20.9,
    });
    expect(settings.setFlag).toHaveBeenCalledWith(
      'community_approve_reward',
      '0',
    );
    expect(settings.setFlag).toHaveBeenCalledWith(
      'community_recommend_reward',
      '300',
    );
    expect(settings.setFlag).toHaveBeenCalledWith(
      'community_reward_daily_per_user',
      '20',
    );
    // 没传的字段不写，避免把后台表单没展示的规则抹成默认
    expect(settings.setFlag).not.toHaveBeenCalledWith(
      'community_reward_daily_site_cap',
      expect.anything(),
    );
  });
});

describe('发奖条件', () => {
  it('官方条目与没有作者的条目一律不发，也不报错', async () => {
    const { service, points } = build();
    await expect(
      service.award(
        ADMIN,
        { ...OWNER_WORKFLOW, source: 'OFFICIAL', ownerUserId: '' },
        'recommend',
      ),
    ).resolves.toEqual({
      rewarded: false,
      points: 0,
      skipped: '官方模板无站内作者',
    });
    await expect(
      service.award(
        ADMIN,
        { ...OWNER_WORKFLOW, ownerUserId: '   ' },
        'approve',
      ),
    ).resolves.toEqual({ rewarded: false, points: 0, skipped: '作者账号缺失' });
    expect(points.credit).not.toHaveBeenCalled();
  });

  it('规则设成 0 ＝ 该场景关闭：不发奖、也不去查帽子', async () => {
    const { service, points, prisma } = build({
      community_recommend_reward: '0',
    });
    await expect(
      service.award(ADMIN, OWNER_WORKFLOW, 'recommend'),
    ).resolves.toEqual({
      rewarded: false,
      points: 0,
      skipped: '该场景奖励已关闭',
    });
    expect(points.credit).not.toHaveBeenCalled();
    expect(prisma.pointTransaction.aggregate).not.toHaveBeenCalled();
  });

  it('同一份工作流的同一场景终身只发一次（靠积分流水判定）', async () => {
    const { service, points, prisma } = build({
      community_recommend_reward: '200',
    });
    prisma.pointTransaction.count.mockResolvedValue(1);
    await expect(
      service.award(ADMIN, OWNER_WORKFLOW, 'recommend'),
    ).resolves.toEqual({
      rewarded: false,
      points: 0,
      skipped: '该工作流已发过这类奖励',
    });
    expect(points.credit).not.toHaveBeenCalled();
    // 已发过但状态标记漏了：补写 rewardedAt，前台不会再显示成「待发奖」
    expect(prisma.communityWorkflow.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { rewardedAt: true },
    });
    expect(prisma.communityWorkflow.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { rewardedAt: expect.any(Date) },
    });

    prisma.communityWorkflow.update.mockClear();
    prisma.communityWorkflow.findUnique.mockResolvedValue({
      rewardedAt: new Date(),
    });
    await service.award(ADMIN, OWNER_WORKFLOW, 'recommend');
    expect(prisma.communityWorkflow.update).not.toHaveBeenCalled();
  });

  it('approve 与 recommend 是两个独立的一次性奖励', async () => {
    const { service, prisma } = build({
      community_approve_reward: '20',
      community_recommend_reward: '200',
    });
    await service.award(ADMIN, OWNER_WORKFLOW, 'approve');
    expect(prisma.pointTransaction.count).toHaveBeenCalledWith({
      where: { refType: 'community_workflow', refId: 'approve:wf_a1b2c3d4' },
    });
    await service.award(ADMIN, OWNER_WORKFLOW, 'recommend');
    expect(prisma.pointTransaction.count).toHaveBeenCalledWith({
      where: { refType: 'community_workflow', refId: 'recommend:wf_a1b2c3d4' },
    });
  });

  it('单人当日帽与全站当日帽各自生效，越帽只是不发', async () => {
    const { service, points, prisma } = build({
      community_recommend_reward: '200',
      community_reward_daily_per_user: '300',
      community_reward_daily_site_cap: '20000',
    });
    // 今天已经拿了 150，再 +200 就超 300
    prisma.pointTransaction.aggregate.mockResolvedValue({
      _sum: { amount: 150 },
    });
    await expect(
      service.award(ADMIN, OWNER_WORKFLOW, 'recommend'),
    ).resolves.toEqual({
      rewarded: false,
      points: 0,
      skipped: '作者当日社区奖励已达上限',
    });
    expect(points.credit).not.toHaveBeenCalled();

    const site = build({
      community_recommend_reward: '200',
      community_reward_daily_per_user: '0',
      community_reward_daily_site_cap: '1000',
    });
    // 单人帽设 0 = 不限，那就只剩全站预算帽兜底
    site.prisma.pointTransaction.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });
    await expect(
      site.service.award(ADMIN, OWNER_WORKFLOW, 'recommend'),
    ).resolves.toEqual({
      rewarded: true,
      points: 200,
      skipped: '',
    });
    // 今天已经发了 900：再来 200 就越过 1000 的预算帽
    site.prisma.pointTransaction.aggregate.mockResolvedValue({
      _sum: { amount: 900 },
    });
    await expect(
      site.service.award(
        ADMIN,
        { ...OWNER_WORKFLOW, code: 'wf_other000' },
        'recommend',
      ),
    ).resolves.toEqual({
      rewarded: false,
      points: 0,
      skipped: '全站当日社区奖励预算已用尽',
    });
  });

  it('正常发奖：按场景入账、refId 收进 64 字符、只有 recommend 写 rewardedAt', async () => {
    const { service, points, prisma, identity } = build({
      community_approve_reward: '20',
      community_recommend_reward: '200',
    });
    const long = { ...OWNER_WORKFLOW, code: `wf_${'x'.repeat(80)}` };
    const approved = await service.award(ADMIN, OWNER_WORKFLOW, 'approve');
    expect(approved).toEqual({ rewarded: true, points: 20, skipped: '' });
    expect(prisma.communityWorkflow.update).not.toHaveBeenCalled();
    expect(points.credit).toHaveBeenCalledWith(
      'owner-1',
      'EARN',
      20,
      expect.objectContaining({
        scene: 'community_approve',
        refType: 'community_workflow',
        operator: 'admin-1',
        remark: expect.stringContaining('审核通过奖励'),
      }),
    );
    expect(identity.audit).toHaveBeenCalledWith(
      'admin-1',
      '创意社区发放奖励',
      'approve wf_a1b2c3d4 +20分 → owner-1',
    );

    prisma.communityWorkflow.update.mockClear();
    const recommended = await service.award(ADMIN, long, 'recommend');
    expect(recommended.points).toBe(200);
    expect(prisma.communityWorkflow.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { rewardedAt: expect.any(Date) },
    });
    const creditArgs = points.credit.mock.calls[1] as unknown[];
    const refId = String((creditArgs[3] as { refId: string }).refId);
    expect(refId).toHaveLength(64);
    expect(refId.startsWith('recommend:wf_')).toBe(true);
  });
});
