import {
  feedRankScore,
  scoreAffinity,
  type Signal,
} from './social-affinity.service';

const signal = (overrides: Partial<Signal> = {}): Signal => ({
  degree: 0,
  mutual: 0,
  orgKey: '',
  orgName: '',
  orgDept: '',
  businessContract: 0,
  businessOrder: 0,
  businessAssignment: 0,
  businessParty: 0,
  groupIds: [],
  groupNames: [],
  experiences: [],
  interactions: 0,
  sameCity: false,
  sameIndustry: false,
  profileComplete: false,
  latestInteractionAt: '',
  ...overrides,
});

describe('scoreAffinity', () => {
  it('没有任何信号时得 0 分且不给理由', () => {
    const result = scoreAffinity(signal(), true, false);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('共同好友、同组织与资料完整按权重累加', () => {
    const result = scoreAffinity(
      signal({
        mutual: 5,
        orgKey: 'ENTERPRISE:1',
        orgName: '甲公司',
        profileComplete: true,
      }),
      true,
      false,
    );
    // 24（共同好友封顶）+ 18（同组织）+ 6（资料完整），无互动记录按 0.9 衰减
    expect(result.score).toBe(43);
    expect(result.reasons.map((reason) => reason.kind)).toEqual([
      'MUTUAL_FRIEND',
      'SAME_ORG',
    ]);
  });

  it('业务原因脱敏：关闭展示时只给「有业务往来」', () => {
    const hidden = scoreAffinity(signal({ businessContract: 1 }), false, false);
    expect(
      hidden.reasons.find((reason) => reason.kind === 'BUSINESS')?.label,
    ).toBe('有业务往来');
    const visible = scoreAffinity(signal({ businessContract: 1 }), true, false);
    expect(
      visible.reasons.find((reason) => reason.kind === 'BUSINESS')?.label,
    ).toBe('有生效中的服务合作');
  });

  it('互动时间衰减：30 天内不打折，90 天内 0.92，更久 0.9', () => {
    const now = Date.now();
    const daysAgo = (days: number) =>
      new Date(now - days * 24 * 3600_000).toISOString();
    expect(
      scoreAffinity(
        signal({ mutual: 5, latestInteractionAt: daysAgo(10) }),
        true,
        false,
      ).score,
    ).toBe(24);
    expect(
      scoreAffinity(
        signal({ mutual: 5, latestInteractionAt: daysAgo(45) }),
        true,
        false,
      ).score,
    ).toBe(22);
    expect(
      scoreAffinity(
        signal({ mutual: 5, latestInteractionAt: daysAgo(200) }),
        true,
        false,
      ).score,
    ).toBe(22);
  });

  it('90 天前拒绝过的候选扣 15 分', () => {
    const base = signal({
      mutual: 5,
      orgKey: 'ENTERPRISE:1',
      profileComplete: true,
    });
    expect(scoreAffinity(base, true, false).score).toBe(43);
    expect(scoreAffinity(base, true, true).score).toBe(28);
  });

  it('理由最多展示 4 条', () => {
    const result = scoreAffinity(
      signal({
        mutual: 3,
        orgKey: 'ENTERPRISE:1',
        businessOrder: 1,
        groupNames: ['同行'],
        experiences: ['甲公司'],
        sameCity: true,
      }),
      true,
      false,
    );
    expect(result.reasons).toHaveLength(4);
  });

  it('六度人脉：度数越近加分越高，六度之外不加分', () => {
    expect(scoreAffinity(signal({ degree: 2 }), true, false).score).toBe(30);
    expect(scoreAffinity(signal({ degree: 3 }), true, false).score).toBe(22);
    expect(scoreAffinity(signal({ degree: 4 }), true, false).score).toBe(15);
    expect(scoreAffinity(signal({ degree: 5 }), true, false).score).toBe(10);
    expect(scoreAffinity(signal({ degree: 6 }), true, false).score).toBe(6);
    expect(scoreAffinity(signal({ degree: 7 }), true, false).score).toBe(0);
  });

  it('六度人脉理由置顶：二度显示「好友的好友」，三度起显示度数', () => {
    const second = scoreAffinity(signal({ degree: 2, mutual: 5 }), true, false);
    // 24（共同好友封顶）× 0.9（无互动记录）+ 30（二度）
    expect(second.score).toBe(52);
    expect(second.reasons[0]).toEqual({
      kind: 'DEGREE',
      label: '好友的好友',
    });
    const third = scoreAffinity(signal({ degree: 3 }), true, false);
    expect(third.reasons[0]).toEqual({ kind: 'DEGREE', label: '3 度人脉' });
  });
});

describe('feedRankScore', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000);

  it('同条件下最新内容排在最前', () => {
    const newest = feedRankScore({ createdAt: at(0), now, affinityScore: 0 });
    const older = feedRankScore({ createdAt: at(24), now, affinityScore: 0 });
    expect(newest).toBe(100);
    expect(older).toBeLessThan(newest);
  });

  it('同一时间下同城优先于陌生同时间', () => {
    const stranger = feedRankScore({ createdAt: at(2), now, affinityScore: 0 });
    const sameCity = feedRankScore({
      createdAt: at(2),
      now,
      affinityScore: 0,
      sameCity: true,
    });
    expect(sameCity).toBeGreaterThan(stranger);
  });

  it('强关系可在一天内反超最新陌生内容，但旧内容不会无限期复活', () => {
    const strongRecent = feedRankScore({
      createdAt: at(20),
      now,
      affinityScore: 60,
      sameCity: true,
      friend: true,
    });
    const newestStranger = feedRankScore({
      createdAt: at(0),
      now,
      affinityScore: 0,
    });
    const strongOld = feedRankScore({
      createdAt: at(24 * 7),
      now,
      affinityScore: 60,
      sameCity: true,
      friend: true,
    });
    expect(strongRecent).toBeGreaterThan(newestStranger);
    expect(strongOld).toBeLessThan(newestStranger);
  });

  it('亲密度增益封顶 80%，普通好友不会翻转时间顺序', () => {
    const friendYesterday = feedRankScore({
      createdAt: at(24),
      now,
      affinityScore: 0,
      friend: true,
    });
    const strangerNow = feedRankScore({
      createdAt: at(0),
      now,
      affinityScore: 0,
    });
    expect(friendYesterday).toBeLessThan(strangerNow);
    const capped = feedRankScore({
      createdAt: at(0),
      now,
      affinityScore: 500,
      sameCity: true,
      friend: true,
      own: true,
    });
    expect(capped).toBe(180);
  });
});
