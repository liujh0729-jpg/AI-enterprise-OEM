import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

const DAY = 24 * 3600_000;
const SNAPSHOT_TTL = 6 * 3600_000;
/** 高匹配阈值与展示上限（方案 §6.3）。 */
const HIGH_SCORE = 70;
const MAX_CANDIDATES = 300;

export type Signal = {
  /** 六度人脉最短度数：1 好友，2–6 第 N 度，0 表示六度内没有路径 */
  degree: number;
  mutual: number;
  orgKey: string;
  orgName: string;
  orgDept: string;
  businessContract: number;
  businessOrder: number;
  businessAssignment: number;
  businessParty: number;
  groupIds: string[];
  groupNames: string[];
  experiences: string[];
  interactions: number;
  sameCity: boolean;
  sameIndustry: boolean;
  profileComplete: boolean;
  latestInteractionAt: string;
};

export type RecommendationReason = { kind: string; label: string };

export type FeedCandidatePost = {
  id: number;
  userId: string;
  createdAt: Date;
};
export type FeedRanking = {
  score: number;
  reasons: RecommendationReason[];
};

const emptySignal = (): Signal => ({
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
});

const iso = (date: Date | null | undefined): string =>
  date ? date.toISOString() : '';

/**
 * 六度人脉加成：度数越小越亲近，六度之外不加分。
 * 六度理论里「可能认识」的强度主要由最短关系链决定，因此单独加权，
 * 与共同好友、同组织等信号叠加后仍按总分排序。
 */
const DEGREE_BONUS: Record<number, number> = {
  1: 36,
  2: 30,
  3: 22,
  4: 15,
  5: 10,
  6: 6,
};

const degreeBonusOf = (degree: number): number => DEGREE_BONUS[degree] || 0;

const degreeLabel = (degree: number): string =>
  degree === 2 ? '好友的好友' : `${degree} 度人脉`;

/**
 * 打分规则（方案 §6.3）：纯函数，便于单测固定信号 → 固定分数。
 * 业务理由只输出关系类型，不出现合同号、订单号、金额、客户名。
 */
export function scoreAffinity(
  signal: Signal,
  businessVisible: boolean,
  rejectedLongAgo: boolean,
): { score: number; reasons: RecommendationReason[] } {
  const biz =
    signal.businessContract +
    signal.businessOrder +
    signal.businessAssignment +
    signal.businessParty;
  const groupAndInteraction = signal.groupIds.length + signal.interactions;
  const raw =
    24 * Math.min(1, signal.mutual / 5) +
    (signal.orgKey ? 18 : 0) +
    20 * Math.min(1, biz / 3) +
    12 * Math.min(1, groupAndInteraction / 5) +
    8 * Math.min(1, signal.experiences.length / 2) +
    (signal.sameCity ? 6 : signal.sameIndustry ? 4 : 0) +
    (signal.profileComplete ? 6 : 0);

  const latest = signal.latestInteractionAt
    ? new Date(signal.latestInteractionAt).getTime()
    : 0;
  const age = latest ? Date.now() - latest : Number.MAX_SAFE_INTEGER;
  const recency = age <= 30 * DAY ? 1 : age <= 90 * DAY ? 0.92 : 0.9;
  const penalty = rejectedLongAgo ? 15 : 0;
  const score = Math.max(
    0,
    Math.round(raw * recency - penalty) + degreeBonusOf(signal.degree),
  );

  const reasons: RecommendationReason[] = [];
  if (signal.degree >= 2 && signal.degree <= 6)
    reasons.push({ kind: 'DEGREE', label: degreeLabel(signal.degree) });
  if (signal.mutual)
    reasons.push({
      kind: 'MUTUAL_FRIEND',
      label: `你们有 ${signal.mutual} 位共同好友`,
    });
  if (signal.orgKey)
    reasons.push({
      kind: 'SAME_ORG',
      label: signal.orgName
        ? `同属${signal.orgName}`
        : signal.orgDept
          ? '在同一家机构的同一部门'
          : '在同一家机构',
    });
  if (biz) {
    if (!businessVisible)
      reasons.push({ kind: 'BUSINESS', label: '有业务往来' });
    else if (signal.businessContract)
      reasons.push({ kind: 'BUSINESS', label: '有生效中的服务合作' });
    else if (signal.businessOrder)
      reasons.push({ kind: 'BUSINESS', label: '有进行中的供销合作' });
    else if (signal.businessAssignment)
      reasons.push({ kind: 'BUSINESS', label: '有服务对接关系' });
    else reasons.push({ kind: 'BUSINESS', label: '有商务往来' });
  }
  if (signal.groupNames.length)
    reasons.push({
      kind: 'SAME_GROUP',
      label: signal.groupNames[0]
        ? `同在「${signal.groupNames[0]}」小组`
        : '同在同一个兴趣小组',
    });
  if (signal.experiences.length)
    reasons.push({
      kind: 'SAME_EXPERIENCE',
      label: `都曾在${signal.experiences[0]}共事或就读`,
    });
  if (signal.sameCity)
    reasons.push({ kind: 'SAME_CITY', label: '在同一个城市' });
  else if (signal.sameIndustry)
    reasons.push({ kind: 'SAME_INDUSTRY', label: '同属一个行业' });

  return {
    score,
    reasons: reasons.slice(0, 4),
  };
}

/**
 * 信息流排序分：时间衰减（半衰期 36 小时）× 亲密度增益。
 * 用乘法而不是加法，保证旧内容不会因关系强而无限期压过新内容；
 * 亲密度增益封顶 80%，只在近一两天内重排。
 */
export function feedRankScore(input: {
  createdAt: Date;
  now: number;
  affinityScore: number;
  sameCity?: boolean;
  friend?: boolean;
  own?: boolean;
}): number {
  const ageHours =
    Math.max(0, input.now - input.createdAt.getTime()) / 3600_000;
  const freshness = 100 * Math.pow(0.5, ageHours / 36);
  const boost = Math.min(
    80,
    Math.max(0, input.affinityScore) +
      (input.sameCity ? 8 : 0) +
      (input.friend ? 18 : 0) +
      (input.own ? 6 : 0),
  );
  return Math.round(freshness * (1 + boost / 100) * 100) / 100;
}

/**
 * 亲密度推荐：候选来自六度人脉 + 本地关系/业务数据，平台内注册用户都可出现，
 * 按方案 §6 打分（六度越近加成越高），落 6 小时快照。
 * 计算量与隐私边界：
 * - 候选上限 300，全部走索引 + `in` 批量查询，不做 N+1；
 * - 业务理由只输出关系类型，不出现合同号、订单号、金额、客户名；
 * - 对方关闭 discoverable / recommendEnabled 即不出现在候选里。
 */
export class SocialAffinityService {
  constructor(private readonly prisma: PrismaService) {}

  private add(map: Map<string, Signal>, userId: string): Signal | null {
    if (!userId || !/^\d+$/.test(userId) || userId === '0') return null;
    let signal = map.get(userId);
    if (!signal) {
      signal = emptySignal();
      map.set(userId, signal);
    }
    return signal;
  }

  private touch(signal: Signal, at: Date | null | undefined) {
    const value = iso(at);
    if (
      value &&
      (!signal.latestInteractionAt || value > signal.latestInteractionAt)
    )
      signal.latestInteractionAt = value;
  }

  /**
   * 六度人脉：从一度好友出发逐层扩展，返回 userId → 最短度数（1–6）。
   * 只在推荐计算时按用户跑一次（快照 6 小时），并限制广度避免大平台放大成本。
   */
  private async sixDegrees(
    userId: string,
    friendIds: string[],
    secondDegree: string[],
  ): Promise<Map<string, number>> {
    const degrees = new Map<string, number>();
    for (const id of friendIds) degrees.set(id, 1);
    let frontier = [...new Set(secondDegree)].filter(
      (id) => id !== userId && !degrees.has(id),
    );
    for (const id of frontier) degrees.set(id, 2);
    const visited = new Set<string>([userId, ...degrees.keys()]);
    for (let depth = 3; depth <= 6 && frontier.length; depth++) {
      const rows = await this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: { in: frontier } }, { userBId: { in: frontier } }],
        },
        select: { userAId: true, userBId: true },
        take: 5000,
      });
      const next: string[] = [];
      for (const row of rows) {
        for (const other of [row.userAId, row.userBId]) {
          if (visited.has(other)) continue;
          visited.add(other);
          degrees.set(other, depth);
          next.push(other);
          if (visited.size >= 5000) break;
        }
        if (visited.size >= 5000) break;
      }
      frontier = next.slice(0, 1000);
    }
    return degrees;
  }

  /** 组织成员 → 候选；orgName 用于「同属 XX」理由。 */
  private async orgMembers(
    map: Map<string, Signal>,
    ownerId: string,
    orgType: 'ENTERPRISE' | 'PROVIDER',
    orgName: string,
  ) {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType,
        orgUserId: ownerId,
        status: 'ACTIVE',
        memberUserId: { not: ownerId },
      },
      select: { memberUserId: true, department: true },
      take: 100,
    });
    for (const row of rows) {
      const signal = this.add(map, row.memberUserId);
      if (!signal) continue;
      signal.orgKey = `${orgType}:${ownerId}`;
      signal.orgName = orgName || signal.orgName;
      if (row.department && !signal.orgDept) signal.orgDept = row.department;
    }
    // 服务商职员早期只落 provider_staff，没有 org_staff 记录，这里补一层
    if (orgType === 'PROVIDER') {
      const staff = await this.prisma.providerStaff.findMany({
        where: { providerUserId: ownerId, status: 'ACTIVE' },
        select: { staffUserId: true, department: true },
        take: 100,
      });
      for (const row of staff) {
        if (row.staffUserId === ownerId) continue;
        const signal = this.add(map, row.staffUserId);
        if (!signal) continue;
        signal.orgKey = `PROVIDER:${ownerId}`;
        signal.orgName = orgName || signal.orgName;
        if (row.department && !signal.orgDept) signal.orgDept = row.department;
      }
    }
  }

  private async orgName(
    orgType: 'ENTERPRISE' | 'PROVIDER',
    ownerId: string,
  ): Promise<string> {
    if (orgType === 'ENTERPRISE') {
      const row = await this.prisma.enterpriseProfile.findFirst({
        where: { userId: ownerId },
        select: { name: true },
      });
      return row?.name || '';
    }
    const row = await this.prisma.providerApplication.findFirst({
      where: { userId: ownerId },
      orderBy: { createdAt: 'desc' },
      select: { orgName: true },
    });
    return row?.orgName || '';
  }

  /** 企业侧/服务商侧的反向组织成员：把业务关系落到具体的人。 */
  private async counterpartMembers(
    map: Map<string, Signal>,
    orgType: 'ENTERPRISE' | 'PROVIDER',
    ownerId: string,
  ) {
    if (!ownerId) return;
    this.add(map, ownerId);
    await this.orgMembers(
      map,
      ownerId,
      orgType,
      await this.orgName(orgType, ownerId),
    );
  }

  private async collect(userId: string): Promise<Map<string, Signal>> {
    const map = new Map<string, Signal>();
    const since90 = new Date(Date.now() - 90 * DAY);

    const [
      allFriendships,
      outgoing,
      incoming,
      blocks,
      myProfile,
      myExperiences,
      myGroups,
      myEnterprise,
      myProvider,
      myOrgStaff,
      myTopics,
      myReplies,
    ] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        take: 2000,
      }),
      this.prisma.friendRequest.findMany({
        where: { fromUserId: userId, status: 'PENDING' },
        select: { toUserId: true },
      }),
      this.prisma.friendRequest.findMany({
        where: { toUserId: userId, status: 'PENDING' },
        select: { fromUserId: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ userId }, { blockedUserId: userId }] },
        select: { userId: true, blockedUserId: true },
      }),
      this.prisma.snsProfile.findUnique({ where: { userId } }),
      this.prisma.experience.findMany({
        where: { userId, hideFromPeers: false },
        take: 50,
      }),
      this.prisma.groupMember.findMany({
        where: { userId, status: 'ACTIVE' },
        take: 100,
      }),
      this.prisma.enterpriseProfile.findMany({
        where: { userId },
        select: { id: true, userId: true, name: true, industry: true },
        take: 20,
      }),
      this.prisma.providerApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { orgName: true },
      }),
      this.prisma.orgStaff.findMany({
        where: { memberUserId: userId, status: 'ACTIVE' },
        take: 50,
      }),
      this.prisma.topicLike.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        take: 200,
      }),
      this.prisma.replyLike.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        take: 200,
      }),
    ]);

    const friendIds = allFriendships.map((row) =>
      row.userAId === userId ? row.userBId : row.userAId,
    );
    const friendSet = new Set(friendIds);

    // 二度好友：共同好友数是最强信号
    const secondDegree = new Set<string>();
    if (friendIds.length) {
      const second = await this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: { in: friendIds } }, { userBId: { in: friendIds } }],
        },
        take: 2000,
      });
      for (const row of second) {
        const other =
          friendSet.has(row.userAId) && !friendSet.has(row.userBId)
            ? row.userBId
            : friendSet.has(row.userBId) && !friendSet.has(row.userAId)
              ? row.userAId
              : '';
        if (!other || other === userId) continue;
        secondDegree.add(other);
        const signal = this.add(map, other);
        if (signal) signal.mutual += 1;
      }
    }

    // 六度人脉：1–6 度的最短关系链，既补候选也用于排序加权
    const degrees = await this.sixDegrees(userId, friendIds, [...secondDegree]);

    // 同组织：我在的每个组织里除我以外的人
    const orgPairs = new Map(
      myOrgStaff.map((row) => [`${row.orgType}:${row.orgUserId}`, row]),
    );
    if (myEnterprise.length)
      orgPairs.set(`ENTERPRISE:${userId}`, {
        orgType: 'ENTERPRISE',
        orgUserId: userId,
      } as (typeof myOrgStaff)[number]);
    if (myProvider)
      orgPairs.set(`PROVIDER:${userId}`, {
        orgType: 'PROVIDER',
        orgUserId: userId,
      } as (typeof myOrgStaff)[number]);
    for (const pair of orgPairs.values()) {
      const name = await this.orgName(
        pair.orgType === 'PROVIDER' ? 'PROVIDER' : 'ENTERPRISE',
        pair.orgUserId,
      );
      await this.orgMembers(
        map,
        pair.orgUserId,
        pair.orgType === 'PROVIDER' ? 'PROVIDER' : 'ENTERPRISE',
        name,
      );
    }

    // 上下游业务关系：合同 / 供销订单 / 服务商指派 / 商务往来
    const enterpriseIds = myEnterprise.map((row) => row.id);
    const contractWhere: Prisma.ContractWhereInput = {
      status: 'ACTIVE',
      OR: [
        { providerUserId: userId },
        ...(enterpriseIds.length
          ? [{ enterpriseId: { in: enterpriseIds } }]
          : []),
      ],
    };
    const contracts = await this.prisma.contract.findMany({
      where: contractWhere,
      select: {
        providerUserId: true,
        enterpriseId: true,
      },
      take: 100,
    });
    for (const contract of contracts) {
      if (contract.providerUserId === userId) {
        const enterprise = await this.prisma.enterpriseProfile.findFirst({
          where: { id: contract.enterpriseId },
          select: { userId: true },
        });
        if (!enterprise) continue;
        const signal = this.add(map, enterprise.userId);
        if (signal) signal.businessContract += 1;
        await this.counterpartMembers(map, 'ENTERPRISE', enterprise.userId);
      } else {
        const signal = this.add(map, contract.providerUserId);
        if (signal) signal.businessContract += 1;
        await this.counterpartMembers(map, 'PROVIDER', contract.providerUserId);
      }
    }

    const orders = await this.prisma.supplyOrder.findMany({
      where: {
        status: { in: ['SUBMITTED', 'QUOTED', 'ACTIVE'] },
        OR: [
          { providerUserId: userId },
          { staffUserId: userId },
          { createdBy: userId },
          ...(enterpriseIds.length
            ? [{ enterpriseId: { in: enterpriseIds } }]
            : []),
        ],
      },
      select: {
        providerUserId: true,
        staffUserId: true,
        createdBy: true,
        enterpriseId: true,
      },
      take: 100,
    });
    for (const order of orders) {
      if (order.providerUserId === userId || order.staffUserId === userId) {
        const enterprise = await this.prisma.enterpriseProfile.findFirst({
          where: { id: order.enterpriseId },
          select: { userId: true },
        });
        if (!enterprise) continue;
        const signal = this.add(map, enterprise.userId);
        if (signal) signal.businessOrder += 1;
        await this.counterpartMembers(map, 'ENTERPRISE', enterprise.userId);
      } else {
        const signal = this.add(map, order.providerUserId);
        if (signal) signal.businessOrder += 1;
        await this.counterpartMembers(map, 'PROVIDER', order.providerUserId);
      }
    }

    const assignments = await this.prisma.providerAssignment.findMany({
      where: {
        OR: [
          { providerUserId: userId },
          { staffUserId: userId },
          ...(enterpriseIds.length
            ? [{ enterpriseId: { in: enterpriseIds } }]
            : []),
        ],
      },
      select: {
        providerUserId: true,
        staffUserId: true,
        enterpriseId: true,
      },
      take: 100,
    });
    for (const row of assignments) {
      if (row.providerUserId === userId) {
        const enterprise = await this.prisma.enterpriseProfile.findFirst({
          where: { id: row.enterpriseId },
          select: { userId: true },
        });
        if (!enterprise) continue;
        const signal = this.add(map, enterprise.userId);
        if (signal) signal.businessAssignment += 1;
        await this.counterpartMembers(map, 'ENTERPRISE', enterprise.userId);
      } else {
        const signal = this.add(map, row.providerUserId);
        if (signal) signal.businessAssignment += 1;
        await this.counterpartMembers(map, 'PROVIDER', row.providerUserId);
      }
      if (row.staffUserId) {
        const signal = this.add(map, row.staffUserId);
        if (signal) signal.businessAssignment += 1;
      }
    }

    // 商务往来：只在联系方式精确命中本地账号时才算候选，避免同名误配
    const orgIds = [userId, ...myEnterprise.map((row) => row.userId)];
    const parties = await this.prisma.bizParty.findMany({
      where: {
        orgUserId: { in: orgIds },
        status: 'ACTIVE',
        OR: [{ phone: { not: '' } }, { email: { not: '' } }],
      },
      select: { phone: true, email: true },
      take: 100,
    });
    const phones = [
      ...new Set(parties.map((row) => row.phone).filter(Boolean)),
    ];
    const emails = [
      ...new Set(parties.map((row) => row.email).filter(Boolean)),
    ];
    if (phones.length || emails.length) {
      const accounts = await this.prisma.account.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            ...(phones.length ? [{ phone: { in: phones } }] : []),
            ...(emails.length ? [{ email: { in: emails } }] : []),
          ],
        },
        select: { id: true },
        take: 100,
      });
      for (const account of accounts) {
        const signal = this.add(map, String(account.id));
        if (signal) signal.businessParty += 1;
      }
    }

    // 共同经历（前同事 / 同校）
    if (myExperiences.length) {
      const pairs = myExperiences.map((row) => ({
        kind: row.kind,
        orgKey: row.orgKey,
      }));
      const rows = await this.prisma.experience.findMany({
        where: {
          userId: { not: userId },
          hideFromPeers: false,
          OR: pairs,
        },
        select: { userId: true, organization: true },
        take: 200,
      });
      for (const row of rows) {
        const signal = this.add(map, row.userId);
        if (!signal) continue;
        const name = row.organization;
        if (name && !signal.experiences.includes(name))
          signal.experiences.push(name);
      }
    }

    // 同小组 + 近期互动
    const groupIds = myGroups.map((row) => row.groupId);
    if (groupIds.length) {
      const rows = await this.prisma.groupMember.findMany({
        where: {
          groupId: { in: groupIds },
          status: 'ACTIVE',
          userId: { not: userId },
        },
        select: { userId: true, groupId: true },
        take: 300,
      });
      for (const row of rows) {
        const signal = this.add(map, row.userId);
        if (!signal) continue;
        const key = String(row.groupId);
        if (!signal.groupIds.includes(key)) signal.groupIds.push(key);
      }
      const groups = await this.prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true, visibility: true },
      });
      const nameMap = new Map(
        groups.map((row) => [
          String(row.id),
          row.visibility === 'PUBLIC' ? row.name : '同一兴趣小组',
        ]),
      );
      for (const signal of map.values()) {
        signal.groupNames = signal.groupIds
          .map((id) => nameMap.get(id) || '')
          .filter(Boolean);
      }
    }

    if (myTopics.length) {
      const topics = await this.prisma.groupTopic.findMany({
        where: { id: { in: myTopics.map((row) => row.topicId) } },
        select: { id: true, userId: true },
      });
      for (const topic of topics) {
        const signal = this.add(map, topic.userId);
        if (!signal) continue;
        signal.interactions += 1;
        this.touch(signal, null);
      }
    }
    if (myReplies.length) {
      const replies = await this.prisma.groupReply.findMany({
        where: { id: { in: myReplies.map((row) => row.replyId) } },
        select: { userId: true },
      });
      for (const reply of replies) {
        const signal = this.add(map, reply.userId);
        if (!signal) continue;
        signal.interactions += 1;
      }
    }
    const messages = await this.prisma.snsMessage.findMany({
      where: {
        createdAt: { gte: since90 },
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      select: { fromUserId: true, toUserId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    for (const message of messages) {
      const peer =
        message.fromUserId === userId ? message.toUserId : message.fromUserId;
      const signal = this.add(map, peer);
      if (!signal) continue;
      signal.interactions += 1;
      this.touch(signal, message.createdAt);
    }

    // 同城 / 同行业（弱信号）
    if (myProfile?.city) {
      const rows = await this.prisma.snsProfile.findMany({
        where: { city: myProfile.city, userId: { not: userId } },
        select: { userId: true },
        take: 100,
      });
      for (const row of rows) {
        const signal = this.add(map, row.userId);
        if (signal) signal.sameCity = true;
      }
    }
    const industry = myEnterprise.find((row) => row.industry)?.industry || '';
    if (industry) {
      const rows = await this.prisma.enterpriseProfile.findMany({
        where: { industry, userId: { not: userId } },
        select: { userId: true },
        take: 100,
      });
      for (const row of rows) {
        const signal = this.add(map, row.userId);
        if (signal) signal.sameIndustry = true;
      }
    }

    // 硬过滤：已是好友 / 待处理申请 / 拉黑 / 90 天内拒绝过我 / 关闭推荐
    const exclude = new Set<string>([userId, ...friendSet]);
    for (const row of outgoing) exclude.add(row.toUserId);
    for (const row of incoming) exclude.add(row.fromUserId);
    for (const row of blocks) {
      exclude.add(row.userId);
      exclude.add(row.blockedUserId);
    }
    const rejected = await this.prisma.friendRequest.findMany({
      where: {
        fromUserId: userId,
        status: 'REJECTED',
        handledAt: { gte: since90 },
      },
      select: { toUserId: true },
    });
    for (const row of rejected) exclude.add(row.toUserId);

    // 六度之内的人都可能认识：已有候选补度数，其余按由近到远补进候选池，
    // 上限 2 倍候选量，避免超大关系网把偏好过滤的查询撑爆。
    for (const [id, signal] of map) {
      const degree = degrees.get(id);
      if (degree) signal.degree = degree;
    }
    const closest = [...degrees.entries()]
      .filter(([, degree]) => degree >= 2 && degree <= 6)
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_CANDIDATES * 2);
    for (const [id, degree] of closest) {
      const signal = this.add(map, id);
      if (signal) signal.degree = degree;
    }
    for (const id of exclude) map.delete(id);

    // 六度之外没有路径的注册用户也允许出现，排在最后
    let cursor: number | undefined;
    for (let page = 0; page < 20 && map.size < MAX_CANDIDATES; page++) {
      const batch = await this.prisma.account.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: 100,
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1].id;
      for (const row of batch) {
        if (map.size >= MAX_CANDIDATES) break;
        const id = String(row.id);
        if (exclude.has(id) || map.has(id)) continue;
        this.add(map, id);
      }
    }

    const ids = [...map.keys()];
    if (ids.length) {
      const feedback = await this.prisma.socialRecommendationFeedback.findMany({
        where: {
          userId,
          targetUserId: { in: ids },
          action: 'DISMISS',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { targetUserId: true },
      });
      for (const row of feedback) map.delete(row.targetUserId);

      const prefs = await this.prisma.socialSyncPreference.findMany({
        where: {
          userId: { in: ids },
          OR: [{ discoverable: false }, { recommendEnabled: false }],
        },
        select: { userId: true },
      });
      for (const row of prefs) map.delete(row.userId);
    }

    // 候选上限：先按粗信号排序，再截断，避免大组织全量打分
    const ranked = [...map.entries()]
      .map(([id, signal]) => ({
        id,
        weight:
          (signal.degree ? (7 - signal.degree) * 10 : 0) +
          signal.mutual * 5 +
          (signal.orgKey ? 4 : 0) +
          (signal.businessContract +
            signal.businessOrder +
            signal.businessAssignment +
            signal.businessParty) *
            3 +
          signal.groupIds.length +
          signal.interactions,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_CANDIDATES);
    const limited = new Map<string, Signal>();
    for (const row of ranked) limited.set(row.id, map.get(row.id)!);
    return limited;
  }

  private async enrich(ids: string[], map: Map<string, Signal>) {
    const numeric = ids.map(Number);
    const [accounts, profiles, recentPosts] = await Promise.all([
      this.prisma.account.findMany({
        where: { id: { in: numeric }, status: 'ACTIVE' },
        select: {
          id: true,
          username: true,
          avatar: true,
          intro: true,
        },
      }),
      this.prisma.snsProfile.findMany({
        where: { userId: { in: ids } },
        select: {
          userId: true,
          title: true,
          city: true,
          bio: true,
          contacts: true,
        },
      }),
      this.prisma.post.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          createdAt: { gte: new Date(Date.now() - 90 * DAY) },
        },
        _count: { _all: true },
      }),
    ]);
    const active = new Set(accounts.map((row) => String(row.id)));
    for (const id of ids) if (!active.has(id)) map.delete(id);

    const accountMap = new Map(accounts.map((row) => [String(row.id), row]));
    const profileMap = new Map(profiles.map((row) => [row.userId, row]));
    const postSet = new Set(recentPosts.map((row) => row.userId));

    return [...map.entries()].map(([id, signal]) => {
      const account = accountMap.get(id);
      const profile = profileMap.get(id);
      signal.profileComplete = Boolean(
        account?.avatar && (profile?.bio || account?.intro) && postSet.has(id),
      );
      return {
        userId: id,
        signal,
        person: {
          userId: id,
          username: account?.username || id,
          displayName: account?.username || id,
          avatar: account?.avatar || '',
          title: profile?.title || '',
          city: profile?.city || '',
        },
      };
    });
  }

  private async businessVisible(userId: string): Promise<boolean> {
    const pref = await this.prisma.socialSyncPreference.findUnique({
      where: { userId },
      select: { businessReasonVisible: true },
    });
    return pref?.businessReasonVisible ?? true;
  }

  private async longAgoRejected(
    userId: string,
    sampleIds: string[],
  ): Promise<Set<string>> {
    if (!sampleIds.length) return new Set();
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        fromUserId: userId,
        toUserId: { in: sampleIds },
        status: 'REJECTED',
        handledAt: { lt: new Date(Date.now() - 90 * DAY) },
      },
      select: { toUserId: true },
    });
    return new Set(rows.map((row) => row.toUserId));
  }

  /** 读取推荐：命中未过期快照直接返回，否则同步计算并写快照。 */
  async recommend(userId: string, limit = 12) {
    const take = Math.max(1, Math.min(50, Math.floor(limit) || 12));
    const cached = await this.prisma.socialAffinitySnapshot.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { score: 'desc' },
      take: 60,
    });
    if (cached.length) {
      const targets = cached.map((row) => row.targetUserId);
      const blocked = await this.unavailable(userId, targets);
      const visible = cached.filter((row) => !blocked.has(row.targetUserId));
      if (visible.length) {
        const items = await this.fromSnapshots(userId, visible, take);
        if (items.length)
          return {
            items,
            computedAt: cached[0].computedAt.toISOString(),
            stale: false,
          };
      }
    }
    return this.compute(userId, take);
  }

  /** 快照之外再过滤一次：好友、拉黑、待处理申请、关闭推荐，避免快照过期窗口漏出。 */
  private async unavailable(
    userId: string,
    targets: string[],
  ): Promise<Set<string>> {
    const set = new Set<string>();
    if (!targets.length) return set;
    const [friends, outgoing, incoming, blocks, prefs, feedback] =
      await Promise.all([
        this.prisma.friendship.findMany({
          where: {
            OR: [
              { userAId: userId, userBId: { in: targets } },
              { userBId: userId, userAId: { in: targets } },
            ],
          },
          select: { userAId: true, userBId: true },
        }),
        this.prisma.friendRequest.findMany({
          where: {
            fromUserId: userId,
            toUserId: { in: targets },
            status: 'PENDING',
          },
          select: { toUserId: true },
        }),
        this.prisma.friendRequest.findMany({
          where: {
            toUserId: userId,
            fromUserId: { in: targets },
            status: 'PENDING',
          },
          select: { fromUserId: true },
        }),
        this.prisma.block.findMany({
          where: {
            OR: [
              { userId, blockedUserId: { in: targets } },
              { blockedUserId: userId, userId: { in: targets } },
            ],
          },
          select: { userId: true, blockedUserId: true },
        }),
        this.prisma.socialSyncPreference.findMany({
          where: {
            userId: { in: targets },
            OR: [{ discoverable: false }, { recommendEnabled: false }],
          },
          select: { userId: true },
        }),
        this.prisma.socialRecommendationFeedback.findMany({
          where: {
            userId,
            targetUserId: { in: targets },
            action: 'DISMISS',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { targetUserId: true },
        }),
      ]);
    for (const row of friends) {
      set.add(row.userAId === userId ? row.userBId : row.userAId);
    }
    for (const row of outgoing) set.add(row.toUserId);
    for (const row of incoming) set.add(row.fromUserId);
    for (const row of blocks) {
      set.add(row.userId);
      set.add(row.blockedUserId);
    }
    for (const row of prefs) set.add(row.userId);
    for (const row of feedback) set.add(row.targetUserId);
    return set;
  }

  private diversify<T extends { signal: Signal }>(rows: T[], take: number) {
    const orgCount = new Map<string, number>();
    const groupCount = new Map<string, number>();
    const result: T[] = [];
    for (const row of rows) {
      if (result.length >= take) break;
      const org = row.signal.orgKey;
      if (org && (orgCount.get(org) || 0) >= 3) continue;
      const group = row.signal.groupIds[0];
      if (group && (groupCount.get(group) || 0) >= 3) continue;
      if (org) orgCount.set(org, (orgCount.get(org) || 0) + 1);
      if (group) groupCount.set(group, (groupCount.get(group) || 0) + 1);
      result.push(row);
    }
    return result;
  }

  private async compute(userId: string, take: number) {
    const map = await this.collect(userId);
    const enriched = await this.enrich([...map.keys()], map);
    const visible = await this.businessVisible(userId);
    const rejected = await this.longAgoRejected(
      userId,
      enriched.map((row) => row.userId),
    );
    const scored = enriched
      .map((row) => ({
        ...row,
        ...scoreAffinity(row.signal, visible, rejected.has(row.userId)),
      }))
      // 不设硬门槛：六度内的人与全站注册用户都可出现，按分数倒序，同分时关系更近的优先。
      .sort(
        (a, b) =>
          b.score - a.score || (a.signal.degree || 7) - (b.signal.degree || 7),
      );
    const picked = this.diversify(scored, take);
    const computedAt = new Date();
    const expiresAt = new Date(computedAt.getTime() + SNAPSHOT_TTL);
    const top = scored.slice(0, 50);
    await this.prisma.$transaction([
      this.prisma.socialAffinitySnapshot.deleteMany({ where: { userId } }),
      this.prisma.socialAffinitySnapshot.createMany({
        data: top.map((row) => ({
          userId,
          targetUserId: row.userId,
          score: row.score,
          reasons: row.reasons,
          signals: row.signal,
          computedAt,
          expiresAt,
        })),
        skipDuplicates: true,
      }),
    ]);
    return {
      items: picked.map((row) =>
        this.item(row.person, row.score, row.reasons, row.signal),
      ),
      computedAt: computedAt.toISOString(),
      stale: false,
    };
  }

  private item(
    person: {
      userId: string;
      username: string;
      displayName: string;
      avatar: string;
      title: string;
      city: string;
    },
    score: number,
    reasons: RecommendationReason[],
    signal: Signal,
  ) {
    return {
      person,
      score,
      matchBand: score >= HIGH_SCORE ? 'HIGH' : 'MEDIUM',
      reasons,
      actions: ['ADD', 'DISMISS'],
      organization: signal.orgName || '',
    };
  }

  private async fromSnapshots(
    userId: string,
    rows: Array<{
      targetUserId: string;
      score: number;
      reasons: unknown;
      signals: unknown;
    }>,
    take: number,
  ) {
    const ids = rows.map((row) => row.targetUserId);
    const numeric = ids.map(Number);
    const [accounts, profiles] = await Promise.all([
      this.prisma.account.findMany({
        where: { id: { in: numeric }, status: 'ACTIVE' },
        select: { id: true, username: true, avatar: true },
      }),
      this.prisma.snsProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, title: true, city: true },
      }),
    ]);
    const accountMap = new Map(accounts.map((row) => [String(row.id), row]));
    const profileMap = new Map(profiles.map((row) => [row.userId, row]));
    const decorated = rows
      .filter((row) => accountMap.has(row.targetUserId))
      .map((row) => {
        const account = accountMap.get(row.targetUserId)!;
        const profile = profileMap.get(row.targetUserId);
        const signal = {
          ...emptySignal(),
          ...((row.signals || {}) as Partial<Signal>),
        };
        return {
          target: {
            userId: row.targetUserId,
            username: account.username,
            displayName: account.username,
            avatar: account.avatar || '',
            title: profile?.title || '',
            city: profile?.city || '',
          },
          score: row.score,
          reasons: Array.isArray(row.reasons)
            ? (row.reasons as RecommendationReason[])
            : [],
          signal,
        };
      });
    return this.diversify(decorated, take).map((row) =>
      this.item(row.target, row.score, row.reasons, row.signal),
    );
  }

  /**
   * 信息流综合排序：时间衰减为主轴，叠加好友、共同好友、同组织、业务往来、
   * 小组、近期互动、同城/同行业等亲密度信号。只读，不产生写操作。
   */
  async rankFeed(
    userId: string,
    posts: FeedCandidatePost[],
  ): Promise<Map<number, FeedRanking>> {
    const ranks = new Map<number, FeedRanking>();
    if (!posts.length) return ranks;
    const now = Date.now();
    const authorIds = [...new Set(posts.map((post) => post.userId))].filter(
      (id) => /^\d+$/.test(id),
    );
    const authorSet = new Set(authorIds);
    if (!authorSet.size) {
      for (const post of posts)
        ranks.set(post.id, {
          score: feedRankScore({
            createdAt: post.createdAt,
            now,
            affinityScore: 0,
          }),
          reasons: [],
        });
      return ranks;
    }

    const ids = [userId, ...authorIds.filter((id) => id !== userId)];
    const since90 = new Date(now - 90 * DAY);
    const [
      myProfile,
      myFriendships,
      authorFriendships,
      myGroups,
      authorGroups,
      myEnterprises,
      authorEnterprises,
      authorProfiles,
      providerRows,
      orgStaffRows,
      myExperiences,
      authorExperiences,
      myTopicLikes,
      myReplyLikes,
      myReplies,
      messages,
      accounts,
      businessVisible,
    ] = await Promise.all([
      this.prisma.snsProfile.findUnique({
        where: { userId },
        select: { city: true },
      }),
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
        take: 2000,
      }),
      this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: { in: authorIds } }, { userBId: { in: authorIds } }],
        },
        select: { userAId: true, userBId: true },
        take: 2000,
      }),
      this.prisma.groupMember.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { groupId: true },
        take: 100,
      }),
      this.prisma.groupMember.findMany({
        where: { userId: { in: authorIds }, status: 'ACTIVE' },
        select: { userId: true, groupId: true },
        take: 1000,
      }),
      this.prisma.enterpriseProfile.findMany({
        where: { userId },
        select: { id: true, userId: true, name: true, industry: true },
        take: 20,
      }),
      this.prisma.enterpriseProfile.findMany({
        where: { userId: { in: authorIds } },
        select: { id: true, userId: true, name: true, industry: true },
        take: 300,
      }),
      this.prisma.snsProfile.findMany({
        where: { userId: { in: authorIds } },
        select: { userId: true, city: true, bio: true },
        take: 500,
      }),
      this.prisma.providerApplication.findMany({
        where: { userId: { in: ids }, status: 'APPROVED' },
        select: { userId: true, orgName: true },
      }),
      this.prisma.orgStaff.findMany({
        where: { memberUserId: { in: ids }, status: 'ACTIVE' },
        select: {
          memberUserId: true,
          orgType: true,
          orgUserId: true,
        },
        take: 1000,
      }),
      this.prisma.experience.findMany({
        where: { userId, hideFromPeers: false },
        select: { orgKey: true, organization: true },
        take: 50,
      }),
      this.prisma.experience.findMany({
        where: { userId: { in: authorIds }, hideFromPeers: false },
        select: { userId: true, orgKey: true, organization: true },
        take: 500,
      }),
      this.prisma.topicLike.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { topicId: true, createdAt: true },
        take: 200,
      }),
      this.prisma.replyLike.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { replyId: true, createdAt: true },
        take: 200,
      }),
      this.prisma.groupReply.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { topicId: true, createdAt: true },
        take: 200,
      }),
      this.prisma.snsMessage.findMany({
        where: {
          OR: [
            { fromUserId: userId, toUserId: { in: authorIds } },
            { fromUserId: { in: authorIds }, toUserId: userId },
          ],
        },
        orderBy: { id: 'desc' },
        select: { fromUserId: true, toUserId: true, createdAt: true },
        take: 500,
      }),
      this.prisma.account.findMany({
        where: { id: { in: authorIds.map(Number) }, status: 'ACTIVE' },
        select: { id: true, avatar: true, intro: true },
        take: 500,
      }),
      this.businessVisible(userId),
    ]);

    const friendSet = new Set<string>();
    for (const row of myFriendships) {
      const other = row.userAId === userId ? row.userBId : row.userAId;
      if (other !== userId) friendSet.add(other);
    }
    const mutual = new Map<string, number>();
    for (const row of authorFriendships) {
      for (const [author, other] of [
        [row.userAId, row.userBId],
        [row.userBId, row.userAId],
      ] as const) {
        if (!authorSet.has(author) || author === userId) continue;
        if (friendSet.has(other) && other !== userId)
          mutual.set(author, (mutual.get(author) || 0) + 1);
      }
    }

    const myGroupIds = new Set(myGroups.map((row) => row.groupId));
    const sharedGroups = new Map<string, number[]>();
    const sharedGroupIds = new Set<number>();
    for (const row of authorGroups) {
      if (!myGroupIds.has(row.groupId)) continue;
      const list = sharedGroups.get(row.userId) || [];
      list.push(row.groupId);
      sharedGroups.set(row.userId, list);
      sharedGroupIds.add(row.groupId);
    }
    const groupNames = new Map<number, string>();
    if (sharedGroupIds.size) {
      const rows = await this.prisma.group.findMany({
        where: { id: { in: [...sharedGroupIds] } },
        select: { id: true, name: true },
        take: 100,
      });
      for (const row of rows) groupNames.set(row.id, row.name);
    }

    const orgNameByKey = new Map<string, string>();
    const addEnterpriseOrg = (rows: { userId: string; name: string }[]) => {
      for (const row of rows)
        orgNameByKey.set(`ENTERPRISE:${row.userId}`, row.name);
    };
    addEnterpriseOrg(myEnterprises);
    addEnterpriseOrg(authorEnterprises);
    for (const row of providerRows)
      orgNameByKey.set(`PROVIDER:${row.userId}`, row.orgName);
    const orgKeysByUser = new Map<string, Set<string>>();
    const addOrgKey = (uid: string, key: string) => {
      const set = orgKeysByUser.get(uid) || new Set<string>();
      set.add(key);
      orgKeysByUser.set(uid, set);
    };
    for (const row of myEnterprises)
      addOrgKey(row.userId, `ENTERPRISE:${row.userId}`);
    for (const row of authorEnterprises)
      addOrgKey(row.userId, `ENTERPRISE:${row.userId}`);
    for (const row of providerRows)
      addOrgKey(row.userId, `PROVIDER:${row.userId}`);
    for (const row of orgStaffRows)
      addOrgKey(row.memberUserId, `${row.orgType}:${row.orgUserId}`);
    const myOrgKeys = orgKeysByUser.get(userId) || new Set<string>();

    const enterpriseOwner = new Map<number, string>();
    for (const row of [...myEnterprises, ...authorEnterprises])
      enterpriseOwner.set(row.id, row.userId);
    const myEnterpriseIds = myEnterprises.map((row) => row.id);
    const authorEnterpriseIds = authorEnterprises.map((row) => row.id);
    const contractAuthors = new Set<string>();
    const orderAuthors = new Set<string>();
    if (authorEnterpriseIds.length || myEnterpriseIds.length) {
      const [contracts, orders] = await Promise.all([
        this.prisma.contract.findMany({
          where: {
            status: 'ACTIVE',
            OR: [
              ...(authorEnterpriseIds.length
                ? [
                    {
                      providerUserId: userId,
                      enterpriseId: { in: authorEnterpriseIds },
                    },
                  ]
                : []),
              ...(myEnterpriseIds.length
                ? [
                    {
                      providerUserId: { in: authorIds },
                      enterpriseId: { in: myEnterpriseIds },
                    },
                  ]
                : []),
            ],
          },
          select: { providerUserId: true, enterpriseId: true },
          take: 200,
        }),
        this.prisma.supplyOrder.findMany({
          where: {
            status: { in: ['SUBMITTED', 'QUOTED', 'ACTIVE'] },
            OR: [
              ...(authorEnterpriseIds.length
                ? [
                    {
                      OR: [
                        { providerUserId: userId },
                        { staffUserId: userId },
                        { createdBy: userId },
                      ],
                      enterpriseId: { in: authorEnterpriseIds },
                    },
                  ]
                : []),
              ...(myEnterpriseIds.length
                ? [
                    {
                      OR: [
                        { providerUserId: { in: authorIds } },
                        { staffUserId: { in: authorIds } },
                        { createdBy: { in: authorIds } },
                      ],
                      enterpriseId: { in: myEnterpriseIds },
                    },
                  ]
                : []),
            ],
          },
          select: {
            providerUserId: true,
            staffUserId: true,
            createdBy: true,
            enterpriseId: true,
          },
          take: 200,
        }),
      ]);
      for (const row of contracts) {
        if (row.providerUserId === userId) {
          const owner = enterpriseOwner.get(row.enterpriseId);
          if (owner && authorSet.has(owner)) contractAuthors.add(owner);
        } else if (authorSet.has(row.providerUserId))
          contractAuthors.add(row.providerUserId);
      }
      for (const row of orders) {
        const roles = [row.providerUserId, row.staffUserId, row.createdBy];
        if (roles.includes(userId)) {
          const owner = enterpriseOwner.get(row.enterpriseId);
          if (owner && authorSet.has(owner)) orderAuthors.add(owner);
        } else {
          for (const uid of roles)
            if (uid && authorSet.has(uid)) orderAuthors.add(uid);
        }
      }
    }

    const myExperienceKeys = new Set(
      myExperiences
        .map((row) => row.orgKey || row.organization)
        .filter(Boolean),
    );
    const sharedExperience = new Map<string, string[]>();
    for (const row of authorExperiences) {
      const key = row.orgKey || row.organization;
      if (!key || !myExperienceKeys.has(key)) continue;
      const list = sharedExperience.get(row.userId) || [];
      const label = row.organization || key;
      if (!list.includes(label)) list.push(label);
      sharedExperience.set(row.userId, list);
    }

    const [likedTopics, likedReplies, repliedTopics] = await Promise.all([
      myTopicLikes.length
        ? this.prisma.groupTopic.findMany({
            where: {
              id: { in: [...new Set(myTopicLikes.map((row) => row.topicId))] },
            },
            select: { id: true, userId: true },
            take: 200,
          })
        : Promise.resolve([] as { id: number; userId: string }[]),
      myReplyLikes.length
        ? this.prisma.groupReply.findMany({
            where: {
              id: { in: [...new Set(myReplyLikes.map((row) => row.replyId))] },
            },
            select: { id: true, userId: true },
            take: 200,
          })
        : Promise.resolve([] as { id: number; userId: string }[]),
      myReplies.length
        ? this.prisma.groupTopic.findMany({
            where: {
              id: { in: [...new Set(myReplies.map((row) => row.topicId))] },
            },
            select: { id: true, userId: true },
            take: 200,
          })
        : Promise.resolve([] as { id: number; userId: string }[]),
    ]);
    const likedTopicAuthor = new Map(
      likedTopics.map((row) => [row.id, row.userId]),
    );
    const likedReplyAuthor = new Map(
      likedReplies.map((row) => [row.id, row.userId]),
    );
    const repliedTopicAuthor = new Map(
      repliedTopics.map((row) => [row.id, row.userId]),
    );
    const interaction = new Map<string, { count: number; latest: number }>();
    const bump = (author: string, at: Date | null | undefined) => {
      if (!author || !authorSet.has(author) || author === userId) return;
      const current = interaction.get(author) || { count: 0, latest: 0 };
      current.count += 1;
      const time = at ? at.getTime() : 0;
      if (time > current.latest) current.latest = time;
      interaction.set(author, current);
    };
    for (const row of messages)
      bump(
        row.fromUserId === userId ? row.toUserId : row.fromUserId,
        row.createdAt,
      );
    for (const row of myTopicLikes)
      bump(likedTopicAuthor.get(row.topicId) || '', row.createdAt);
    for (const row of myReplyLikes)
      bump(likedReplyAuthor.get(row.replyId) || '', row.createdAt);
    for (const row of myReplies)
      bump(repliedTopicAuthor.get(row.topicId) || '', row.createdAt);

    const normalizeCity = (value: string | null | undefined) =>
      (value || '').trim().replace(/市$/, '');
    const myCity = normalizeCity(myProfile?.city);
    const myIndustries = new Set(
      myEnterprises.map((row) => row.industry.trim()).filter(Boolean),
    );
    const industryByAuthor = new Map<string, Set<string>>();
    for (const row of authorEnterprises) {
      const industry = row.industry.trim();
      if (!industry) continue;
      const set = industryByAuthor.get(row.userId) || new Set<string>();
      set.add(industry);
      industryByAuthor.set(row.userId, set);
    }
    const accountMap = new Map(accounts.map((row) => [String(row.id), row]));
    const profileMap = new Map(
      authorProfiles.map((row) => [
        row.userId,
        { city: row.city, bio: row.bio },
      ]),
    );
    const recentAuthor = new Set(
      posts
        .filter((post) => post.createdAt >= since90)
        .map((post) => post.userId),
    );

    const signals = new Map<string, Signal>();
    for (const author of authorIds) {
      if (author === userId) continue;
      const signal = emptySignal();
      signal.mutual = mutual.get(author) || 0;
      const authorOrgKeys = orgKeysByUser.get(author) || new Set<string>();
      const commonOrg = [...authorOrgKeys].find((key) => myOrgKeys.has(key));
      if (commonOrg) {
        signal.orgKey = commonOrg;
        signal.orgName = orgNameByKey.get(commonOrg) || '';
      }
      if (contractAuthors.has(author)) signal.businessContract = 1;
      if (orderAuthors.has(author)) signal.businessOrder = 1;
      const groups = sharedGroups.get(author) || [];
      signal.groupIds = groups.map(String);
      signal.groupNames = groups
        .map((id) => groupNames.get(id) || '')
        .filter(Boolean)
        .slice(0, 2);
      signal.experiences = sharedExperience.get(author) || [];
      const inter = interaction.get(author);
      signal.interactions = inter?.count || 0;
      signal.latestInteractionAt = inter?.latest
        ? new Date(inter.latest).toISOString()
        : '';
      const authorCity = normalizeCity(profileMap.get(author)?.city);
      signal.sameCity = Boolean(myCity && authorCity && myCity === authorCity);
      const authorIndustries = industryByAuthor.get(author);
      signal.sameIndustry = Boolean(
        authorIndustries &&
        [...authorIndustries].some((industry) => myIndustries.has(industry)),
      );
      const account = accountMap.get(author);
      const profile = profileMap.get(author);
      signal.profileComplete = Boolean(
        account?.avatar &&
        (profile?.bio || account?.intro) &&
        recentAuthor.has(author),
      );
      signals.set(author, signal);
    }

    for (const post of posts) {
      if (post.userId === userId) {
        ranks.set(post.id, {
          score: feedRankScore({
            createdAt: post.createdAt,
            now,
            affinityScore: 0,
            own: true,
          }),
          reasons: [],
        });
        continue;
      }
      const signal = signals.get(post.userId);
      if (!signal) {
        ranks.set(post.id, {
          score: feedRankScore({
            createdAt: post.createdAt,
            now,
            affinityScore: 0,
          }),
          reasons: [],
        });
        continue;
      }
      const affinity = scoreAffinity(signal, businessVisible, false);
      const isFriend = friendSet.has(post.userId);
      const reasons = isFriend
        ? [{ kind: 'FRIEND', label: '好友' }, ...affinity.reasons].slice(0, 4)
        : affinity.reasons;
      ranks.set(post.id, {
        score: feedRankScore({
          createdAt: post.createdAt,
          now,
          affinityScore: affinity.score,
          sameCity: signal.sameCity,
          friend: isFriend,
        }),
        reasons,
      });
    }
    return ranks;
  }

  async dismiss(userId: string, targetUserId: string) {
    if (targetUserId === userId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能屏蔽自己');
    const target = /^\d+$/.test(targetUserId)
      ? await this.prisma.account.findUnique({
          where: { id: Number(targetUserId) },
          select: { id: true },
        })
      : null;
    if (!target) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    await this.prisma.socialRecommendationFeedback.upsert({
      where: {
        userId_targetUserId: { userId, targetUserId },
      },
      create: {
        userId,
        targetUserId,
        action: 'DISMISS',
        expiresAt: new Date(Date.now() + 90 * DAY),
      },
      update: {
        action: 'DISMISS',
        expiresAt: new Date(Date.now() + 90 * DAY),
        createdAt: new Date(),
      },
    });
    await this.prisma.socialAffinitySnapshot.deleteMany({
      where: { userId, targetUserId },
    });
    return { dismissed: true };
  }

  /** 好友/资料/组织变化后调用，下次读取自动重算。 */
  async invalidate(userId: string) {
    await this.prisma.socialAffinitySnapshot.deleteMany({ where: { userId } });
  }
}
