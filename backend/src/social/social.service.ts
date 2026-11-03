import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 社交板块本地服务：把原 NestJS SNS 的关系 / 动态 / 小组 / 私信 / 简历逻辑移植到 Hono + 本地 sns_ 表。 */
export interface PersonBrief {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
}

const anon = (): PersonBrief => ({
  userId: '',
  username: 'anonymous',
  displayName: '匿名',
  avatar: '',
});

/**
 * 私信携带的链接卡片（沿用 sns_messages.link_cards 现成列）。
 * 现阶段只放简历：投递动作＝发一条带 RESUME 卡片的私信，雇主凭卡片回源看 HTML 简历。
 * 用 type 而非 interface：写入 Prisma JSON 列时才能隐式命中索引签名，免去强转。
 */
export type LinkCard = {
  kind: 'RESUME';
  userId: string;
  name: string;
  headline: string;
  updatedAt: string;
};

export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 人物名片（本地 users 表聚合） ----------
  private async person(userId: string): Promise<PersonBrief> {
    const account = await this.prisma.account.findUnique({ where: { id: Number(userId) } });
    if (!account) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    return {
      userId: String(account.id),
      username: account.username,
      displayName: account.username,
      avatar: account.avatar || '',
    };
  }
  private async persons(userIds: string[]): Promise<Record<string, PersonBrief>> {
    const ids = [...new Set(userIds.filter((id) => id && /^\d+$/.test(id)))].map(Number);
    if (!ids.length) return {};
    const rows = await this.prisma.account.findMany({ where: { id: { in: ids } } });
    const map: Record<string, PersonBrief> = {};
    for (const account of rows) {
      map[String(account.id)] = {
        userId: String(account.id),
        username: account.username,
        displayName: account.username,
        avatar: account.avatar || '',
      };
    }
    return map;
  }

  // ---------- 资料 ----------
  async getProfile(userId: string) {
    const [profile, person] = await Promise.all([
      this.prisma.snsProfile.findUnique({ where: { userId } }),
      this.person(userId),
    ]);
    return {
      person,
      profile: profile
        ? {
            title: profile.title,
            city: profile.city,
            gender: profile.gender,
            bio: profile.bio,
            lang: profile.lang,
            contacts: profile.contacts,
          }
        : { title: '', city: '', gender: 'UNSPECIFIED', bio: '', lang: 'zh', contacts: {} },
    };
  }
  async saveProfile(userId: string, input: Partial<{ title: string; city: string; gender: string; bio: string; lang: string; contacts: unknown }>) {
    const data = {
      title: String(input.title ?? '').slice(0, 120),
      city: String(input.city ?? '').slice(0, 64),
      gender: ['MALE', 'FEMALE', 'UNSPECIFIED'].includes(String(input.gender)) ? String(input.gender) : 'UNSPECIFIED',
      bio: String(input.bio ?? '').slice(0, 2000),
      lang: String(input.lang ?? 'zh').slice(0, 8),
      contacts: (input.contacts ?? {}) as object,
    };
    await this.prisma.snsProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getProfile(userId);
  }

  // ---------- 好友关系 ----------
  private friendKey(a: string, b: string): { userAId: string; userBId: string } {
    return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
  }
  async requestFriend(fromUserId: string, toUserId: string, message: string) {
    if (fromUserId === toUserId) throw new BusinessException(ErrorCode.BAD_REQUEST, '不能添加自己为好友');
    await this.person(toUserId);
    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ userId: toUserId, blockedUserId: fromUserId }, { userId: fromUserId, blockedUserId: toUserId }] },
    });
    if (blocked) throw new BusinessException(ErrorCode.FORBIDDEN, '无法向该用户发起好友请求');
    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: this.friendKey(fromUserId, toUserId) },
    });
    if (existing) return { accepted: true, requestId: 0 };
    const pending = await this.prisma.friendRequest.findUnique({
      where: { fromUserId_toUserId: { fromUserId, toUserId } },
    });
    // 反向已有待处理请求 → 直接接受，省去来回
    const reverse = await this.prisma.friendRequest.findUnique({
      where: { fromUserId_toUserId: { fromUserId: toUserId, toUserId: fromUserId } },
    });
    if (reverse && reverse.status === 'PENDING') return this.acceptFriend(fromUserId, reverse.id);
    if (pending && pending.status === 'PENDING') return { accepted: false, requestId: pending.id };
    const created = await this.prisma.friendRequest.upsert({
      where: { fromUserId_toUserId: { fromUserId, toUserId } },
      create: { fromUserId, toUserId, message: String(message ?? '').slice(0, 500), status: 'PENDING' },
      update: { message: String(message ?? '').slice(0, 500), status: 'PENDING', handledAt: null },
    });
    return { accepted: false, requestId: created.id };
  }
  async incomingRequests(userId: string) {
    const rows = await this.prisma.friendRequest.findMany({
      where: { toUserId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const froms = await this.persons(rows.map((r) => r.fromUserId));
    return rows.map((r) => ({ id: r.id, from: froms[r.fromUserId] || anon(), message: r.message, createdAt: r.createdAt.toISOString() }));
  }
  async acceptFriend(userId: string, requestId: number) {
    const req = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!req || req.toUserId !== userId) throw new BusinessException(ErrorCode.NOT_FOUND, '好友请求不存在');
    if (req.status !== 'PENDING') return { accepted: true };
    const key = this.friendKey(req.fromUserId, req.toUserId);
    await this.prisma.friendship.upsert({
      where: { userAId_userBId: key },
      create: { ...key, createdAt: new Date() },
      update: {},
    });
    await this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', handledAt: new Date() } });
    return { accepted: true, friendId: req.fromUserId };
  }
  async rejectFriend(userId: string, requestId: number) {
    const req = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!req || req.toUserId !== userId) throw new BusinessException(ErrorCode.NOT_FOUND, '好友请求不存在');
    await this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', handledAt: new Date() } });
    return { rejected: true };
  }
  async listFriends(userId: string) {
    const rows = await this.prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
    const friendIds = rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
    const persons = await this.persons(friendIds);
    return friendIds.map((id) => persons[id] || anon());
  }
  async removeFriend(userId: string, friendId: string) {
    const key = this.friendKey(userId, friendId);
    await this.prisma.friendship.deleteMany({ where: { userAId: key.userAId, userBId: key.userBId } });
    return { removed: true };
  }
  async block(userId: string, targetUserId: string) {
    if (userId === targetUserId) throw new BusinessException(ErrorCode.BAD_REQUEST, '不能拉黑自己');
    const key = this.friendKey(userId, targetUserId);
    await this.prisma.friendship.deleteMany({ where: { userAId: key.userAId, userBId: key.userBId } });
    await this.prisma.block.upsert({
      where: { userId_blockedUserId: { userId, blockedUserId: targetUserId } },
      create: { userId, blockedUserId: targetUserId },
      update: {},
    });
    return { blocked: true };
  }
  async unblock(userId: string, targetUserId: string) {
    await this.prisma.block.deleteMany({ where: { userId, blockedUserId: targetUserId } });
    return { unblocked: true };
  }
  private async blockedPairs(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ userId }, { blockedUserId: userId }] },
      select: { userId: true, blockedUserId: true },
    });
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.userId);
      set.add(r.blockedUserId);
    }
    return set;
  }

  // ---------- 动态 / 信息流 ----------
  async createPost(userId: string, body: string, visibility: string) {
    const text = String(body ?? '').trim();
    if (!text) throw new BusinessException(ErrorCode.BAD_REQUEST, '动态内容不能为空');
    if (text.length > 5000) throw new BusinessException(ErrorCode.BAD_REQUEST, '动态内容过长');
    const vis = visibility === 'FRIENDS' ? 'FRIENDS' : 'PUBLIC';
    const post = await this.prisma.post.create({ data: { userId, body: text, visibility: vis } });
    return { id: post.id, body: post.body, visibility: post.visibility, createdAt: post.createdAt.toISOString() };
  }
  async deletePost(userId: string, postId: number) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.userId !== userId) throw new BusinessException(ErrorCode.NOT_FOUND, '动态不存在');
    await this.prisma.post.delete({ where: { id: postId } });
    return { deleted: true };
  }
  async feed(userId: string, limit = 30) {
    const friends = await this.listFriends(userId);
    const friendIds = new Set([userId, ...friends.map((f) => f.userId)]);
    const blocked = await this.blockedPairs(userId);
    const posts = await this.prisma.post.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const visible = posts.filter((p) => {
      if (blocked.has(p.userId)) return false;
      if (p.visibility === 'PUBLIC') return true;
      return friendIds.has(p.userId);
    });
    const page = visible.slice(0, Math.min(limit, 100));
    const authors = await this.persons(page.map((p) => p.userId));
    return page.map((p) => ({
      id: p.id,
      author: authors[p.userId] || anon(),
      body: p.body,
      visibility: p.visibility,
      createdAt: p.createdAt.toISOString(),
    }));
  }
  async myPosts(userId: string) {
    const posts = await this.prisma.post.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return posts.map((p) => ({ id: p.id, body: p.body, visibility: p.visibility, createdAt: p.createdAt.toISOString() }));
  }

  // ---------- 小组（对标豆瓣） ----------
  /** 成员身份：OWNER=组长、ADMIN=管理员、MEMBER=普通成员、PENDING=待审批。 */
  private async membership(userId: string, groupId: number) {
    return this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  }
  /** 当前用户在组内的管理身份（OWNER/ADMIN 可管理），非激活成员返回 null。 */
  private async manageRole(userId: string, groupId: number): Promise<'OWNER' | 'ADMIN' | null> {
    const m = await this.membership(userId, groupId);
    if (!m || m.status !== 'ACTIVE') return null;
    return m.role === 'OWNER' || m.role === 'ADMIN' ? m.role : null;
  }
  /** 读取门槛：公开组任何人可读；私密组须为激活成员。 */
  private async assertGroupReadable(userId: string, group: { id: number; visibility: string }) {
    if (group.visibility === 'PUBLIC') return;
    await this.assertGroupMember(userId, group.id);
  }
  /** 批量统计成员数与主题数（避免逐组 N+1）。 */
  private async groupStats(groupIds: number[]) {
    const members = groupIds.length
      ? await this.prisma.groupMember.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groupIds }, status: 'ACTIVE' },
          _count: { _all: true },
        })
      : [];
    const topics = groupIds.length
      ? await this.prisma.groupTopic.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groupIds } },
          _count: { _all: true },
        })
      : [];
    const memberMap: Record<number, number> = {};
    const topicMap: Record<number, number> = {};
    for (const r of members) memberMap[r.groupId] = r._count._all;
    for (const r of topics) topicMap[r.groupId] = r._count._all;
    return { memberMap, topicMap };
  }

  async createGroup(
    userId: string,
    input: { name: string; description?: string; avatar?: string; rules?: string; category?: string; visibility?: string; joinPolicy?: string },
  ) {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 30) throw new BusinessException(ErrorCode.BAD_REQUEST, '小组名称需 1-30 字');
    const dup = await this.prisma.group.findUnique({ where: { name } });
    if (dup) throw new BusinessException(ErrorCode.CONFLICT, '小组名称已存在');
    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({
        data: {
          name,
          avatar: String(input.avatar ?? '').slice(0, 500),
          description: String(input.description ?? '').slice(0, 2000),
          rules: String(input.rules ?? '').slice(0, 2000),
          category: String(input.category ?? '').slice(0, 30),
          visibility: input.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
          joinPolicy: input.joinPolicy === 'APPROVE' ? 'APPROVE' : 'FREE',
          ownerId: userId,
        },
      });
      await tx.groupMember.create({ data: { groupId: created.id, userId, role: 'OWNER', status: 'ACTIVE' } });
      return created;
    });
    return { id: group.id, name: group.name, visibility: group.visibility, joinPolicy: group.joinPolicy };
  }

  /** scope=discover 发现公开组（默认）；mine 我加入的组；keyword 按名称/简介模糊匹配；category 分类筛选。 */
  async listGroups(userId: string, opts: { scope?: 'discover' | 'mine'; keyword?: string; category?: string } = {}) {
    const scope = opts.scope === 'mine' ? 'mine' : 'discover';
    const keyword = String(opts.keyword ?? '').trim();
    const category = String(opts.category ?? '').trim();
    const memberships = await this.prisma.groupMember.findMany({ where: { userId } });
    const byGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
    const joinedIds = memberships.filter((m) => m.status === 'ACTIVE' || m.status === 'PENDING').map((m) => m.groupId);
    const groups =
      scope === 'mine'
        ? await this.prisma.group.findMany({ where: { id: { in: joinedIds.length ? joinedIds : [-1] } }, orderBy: { createdAt: 'desc' }, take: 200 })
        : await this.prisma.group.findMany({ where: { visibility: 'PUBLIC', ...(category ? { category } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    let rows = groups.filter((g) => (scope === 'mine' ? true : g.visibility === 'PUBLIC' || byGroup.has(String(g.id))));
    if (keyword) {
      const kw = keyword.toLowerCase();
      rows = rows.filter((g) => g.name.toLowerCase().includes(kw) || g.description.toLowerCase().includes(kw));
    }
    const { memberMap, topicMap } = await this.groupStats(rows.map((g) => g.id));
    const pendingMap = await this.pendingCounts(rows.map((g) => g.id));
    // 发现页按成员数倒序（热组在前），我的页保持加入顺序
    if (scope === 'discover') rows = rows.sort((a, b) => (memberMap[b.id] || 0) - (memberMap[a.id] || 0));
    return rows.map((g) => {
      const m = byGroup.get(String(g.id));
      return {
        id: g.id,
        name: g.name,
        avatar: g.avatar,
        description: g.description,
        category: g.category,
        visibility: g.visibility,
        joinPolicy: g.joinPolicy,
        memberCount: memberMap[g.id] || 0,
        topicCount: topicMap[g.id] || 0,
        pendingCount: m && (m.role === 'OWNER' || m.role === 'ADMIN') && m.status === 'ACTIVE' ? pendingMap[g.id] || 0 : 0,
        joined: m?.status === 'ACTIVE',
        applying: m?.status === 'PENDING',
        myRole: m && m.status === 'ACTIVE' ? m.role : null,
      };
    });
  }

  /** 逐组待审批入组申请数（仅组长/管理员视角有意义）。 */
  private async pendingCounts(groupIds: number[]) {
    const rows = groupIds.length
      ? await this.prisma.groupMember.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groupIds }, status: 'PENDING' },
          _count: { _all: true },
        })
      : [];
    const map: Record<number, number> = {};
    for (const r of rows) map[r.groupId] = r._count._all;
    return map;
  }

  async getGroup(groupId: number, userId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new BusinessException(ErrorCode.NOT_FOUND, '小组不存在');
    await this.assertGroupReadable(userId, group);
    const m = await this.membership(userId, groupId);
    const { memberMap, topicMap } = await this.groupStats([groupId]);
    const canManage = group.visibility === 'PUBLIC' ? await this.manageRole(userId, groupId) : m?.role === 'OWNER' || m?.role === 'ADMIN' ? m.role : null;
    return {
      id: group.id,
      name: group.name,
      avatar: group.avatar,
      description: group.description,
      rules: group.rules,
      category: group.category,
      visibility: group.visibility,
      joinPolicy: group.joinPolicy,
      memberCount: memberMap[groupId] || 0,
      topicCount: topicMap[groupId] || 0,
      joined: m?.status === 'ACTIVE',
      applying: m?.status === 'PENDING',
      myRole: m && m.status === 'ACTIVE' ? m.role : null,
      canManage,
      pendingCount: canManage ? (await this.pendingCounts([groupId]))[groupId] || 0 : 0,
    };
  }

  async updateGroup(groupId: number, userId: string, input: Partial<{ name: string; avatar: string; description: string; rules: string; category: string; visibility: string; joinPolicy: string }>) {
    const role = await this.manageRole(userId, groupId);
    if (!role) throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长或管理员可以修改小组');
    const data: Record<string, unknown> = {};
    if (input.name != null) {
      const name = String(input.name).trim();
      if (!name || name.length > 30) throw new BusinessException(ErrorCode.BAD_REQUEST, '小组名称需 1-30 字');
      const dup = await this.prisma.group.findFirst({ where: { name, NOT: { id: groupId } } });
      if (dup) throw new BusinessException(ErrorCode.CONFLICT, '小组名称已存在');
      data.name = name;
    }
    if (input.avatar != null) data.avatar = String(input.avatar).slice(0, 500);
    if (input.description != null) data.description = String(input.description).slice(0, 2000);
    if (input.rules != null) data.rules = String(input.rules).slice(0, 2000);
    if (input.category != null) data.category = String(input.category).slice(0, 30);
    if (input.visibility != null) data.visibility = input.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
    if (input.joinPolicy != null) data.joinPolicy = input.joinPolicy === 'APPROVE' ? 'APPROVE' : 'FREE';
    await this.prisma.group.update({ where: { id: groupId }, data });
    return this.getGroup(groupId, userId);
  }

  async joinGroup(userId: string, groupId: number) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new BusinessException(ErrorCode.NOT_FOUND, '小组不存在');
    const existing = await this.membership(userId, groupId);
    if (existing && existing.status === 'ACTIVE') return { joined: true, status: 'ACTIVE' };
    const status = group.joinPolicy === 'APPROVE' ? 'PENDING' : 'ACTIVE';
    await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, role: 'MEMBER', status },
      update: { status },
    });
    return { joined: status === 'ACTIVE', status };
  }

  async leaveGroup(userId: string, groupId: number) {
    const m = await this.membership(userId, groupId);
    if (!m) return { left: false };
    if (m.role === 'OWNER') throw new BusinessException(ErrorCode.FORBIDDEN, '组长不能退出小组，请先转让或删除');
    await this.prisma.groupMember.delete({ where: { id: m.id } });
    return { left: true };
  }

  /** 组长/管理员查看成员；status 默认 ACTIVE，传 PENDING 看待审批。 */
  async listMembers(groupId: number, userId: string, status = 'ACTIVE') {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new BusinessException(ErrorCode.NOT_FOUND, '小组不存在');
    const canManage = await this.manageRole(userId, groupId);
    const wantPending = status === 'PENDING';
    if (wantPending && !canManage) throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长或管理员可查看待审批');
    if (!wantPending) await this.assertGroupReadable(userId, group);
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId, status: wantPending ? 'PENDING' : 'ACTIVE' },
      orderBy: { createdAt: wantPending ? 'desc' : 'asc' },
      take: 200,
    });
    const persons = await this.persons(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      role: r.role,
      status: r.status,
      joinedAt: r.createdAt.toISOString(),
      person: persons[r.userId] || anon(),
    }));
  }

  /** 审批入组申请（组长/管理员）。 */
  async reviewJoin(groupId: number, actorId: string, memberId: number, approve: boolean) {
    const role = await this.manageRole(actorId, groupId);
    if (!role) throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长或管理员可以审批');
    const member = await this.prisma.groupMember.findFirst({ where: { id: memberId, groupId, status: 'PENDING' } });
    if (!member) throw new BusinessException(ErrorCode.NOT_FOUND, '申请不存在');
    if (approve) {
      await this.prisma.groupMember.update({ where: { id: memberId }, data: { status: 'ACTIVE' } });
      return { approved: true };
    }
    await this.prisma.groupMember.delete({ where: { id: memberId } });
    return { rejected: true };
  }

  /** 任命/取消管理员（仅组长）；移除成员（组长或管理员，管理员只能移除普通成员）。 */
  async setMemberRole(groupId: number, actorId: string, targetUserId: string, role: 'ADMIN' | 'MEMBER') {
    const actor = await this.membership(actorId, groupId);
    if (!actor || actor.role !== 'OWNER' || actor.status !== 'ACTIVE') throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长可以管理管理员');
    const target = await this.membership(targetUserId, groupId);
    if (!target || target.status !== 'ACTIVE') throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    if (target.role === 'OWNER') throw new BusinessException(ErrorCode.FORBIDDEN, '不能变更组长身份');
    await this.prisma.groupMember.update({ where: { id: target.id }, data: { role } });
    return { role };
  }
  async removeMember(groupId: number, actorId: string, targetUserId: string) {
    const role = await this.manageRole(actorId, groupId);
    if (!role) throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长或管理员可以移除成员');
    const target = await this.membership(targetUserId, groupId);
    if (!target) return { removed: false };
    if (target.role === 'OWNER') throw new BusinessException(ErrorCode.FORBIDDEN, '不能移除组长');
    if (role === 'ADMIN' && target.role !== 'MEMBER') throw new BusinessException(ErrorCode.FORBIDDEN, '管理员只能移除普通成员');
    await this.prisma.groupMember.delete({ where: { id: target.id } });
    return { removed: true };
  }

  private async assertGroupMember(userId: string, groupId: number) {
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member || member.status !== 'ACTIVE') throw new BusinessException(ErrorCode.FORBIDDEN, '请先加入该小组');
    return member;
  }
  async createTopic(userId: string, groupId: number, input: { title: string; body: string; anonymous?: boolean; tag?: string }) {
    await this.assertGroupMember(userId, groupId);
    const title = String(input.title ?? '').trim().slice(0, 120);
    const body = String(input.body ?? '').trim();
    if (!title || !body) throw new BusinessException(ErrorCode.BAD_REQUEST, '标题与正文必填');
    const topic = await this.prisma.groupTopic.create({
      data: { groupId, userId, title, body, tag: String(input.tag ?? '').slice(0, 30), anonymous: Boolean(input.anonymous) },
    });
    return { id: topic.id, title: topic.title, body: topic.body, tag: topic.tag, anonymous: topic.anonymous, replyCount: 0, likeCount: 0, createdAt: topic.createdAt.toISOString() };
  }
  /** 组内主题列表：置顶在前，其后按最近回复；featuredOnly 只看加精，tag 分类筛选。公开组未加入也可浏览。 */
  async listTopics(groupId: number, userId: string, opts: { featuredOnly?: boolean; tag?: string } = {}) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new BusinessException(ErrorCode.NOT_FOUND, '小组不存在');
    await this.assertGroupReadable(userId, group);
    const tag = String(opts.tag ?? '').trim();
    const topics = await this.prisma.groupTopic.findMany({
      where: { groupId, ...(opts.featuredOnly ? { featured: true } : {}), ...(tag ? { tag } : {}) },
      orderBy: [{ pinned: 'desc' }, { lastReplyAt: 'desc' }],
      take: 100,
    });
    const authors = await this.persons(topics.filter((t) => !t.anonymous).map((t) => t.userId));
    const liked = new Set((await this.prisma.topicLike.findMany({ where: { userId, topicId: { in: topics.map((t) => t.id) } }, select: { topicId: true } })).map((l) => l.topicId));
    const manage = await this.manageRole(userId, groupId);
    return topics.map((t) => ({
      id: t.id,
      author: t.anonymous ? anon() : authors[t.userId] || anon(),
      title: t.title,
      body: t.body,
      tag: t.tag,
      anonymous: t.anonymous,
      pinned: t.pinned,
      featured: t.featured,
      likeCount: t.likeCount,
      likedByMe: liked.has(t.id),
      replyCount: t.replyCount,
      canModerate: Boolean(manage),
      canDelete: t.userId === userId || Boolean(manage),
      createdAt: t.createdAt.toISOString(),
    }));
  }
  async getTopic(topicId: number, userId: string) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    const group = await this.prisma.group.findUnique({ where: { id: topic.groupId } });
    if (group) await this.assertGroupReadable(userId, group);
    const author = topic.anonymous ? anon() : await this.person(topic.userId).catch(() => anon());
    const liked = await this.prisma.topicLike.findUnique({ where: { topicId_userId: { topicId, userId } } });
    const manage = await this.manageRole(userId, topic.groupId);
    return {
      id: topic.id,
      groupId: topic.groupId,
      groupName: group?.name || '',
      author,
      title: topic.title,
      body: topic.body,
      tag: topic.tag,
      anonymous: topic.anonymous,
      pinned: topic.pinned,
      featured: topic.featured,
      likeCount: topic.likeCount,
      likedByMe: Boolean(liked),
      replyCount: topic.replyCount,
      canModerate: Boolean(manage),
      canDelete: topic.userId === userId || Boolean(manage),
      createdAt: topic.createdAt.toISOString(),
    };
  }
  /** 置顶/加精开关（组长/管理员）。 */
  async setTopicFlags(topicId: number, actorId: string, flags: { pinned?: boolean; featured?: boolean }) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    const role = await this.manageRole(actorId, topic.groupId);
    if (!role) throw new BusinessException(ErrorCode.FORBIDDEN, '只有组长或管理员可以操作');
    const data: Record<string, boolean> = {};
    if (flags.pinned != null) data.pinned = Boolean(flags.pinned);
    if (flags.featured != null) data.featured = Boolean(flags.featured);
    if (Object.keys(data).length) await this.prisma.groupTopic.update({ where: { id: topicId }, data });
    return { id: topicId, ...data };
  }
  /** 删除主题：作者本人或组长/管理员；连带楼层与推荐。 */
  async deleteTopic(topicId: number, userId: string) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    const role = await this.manageRole(userId, topic.groupId);
    if (topic.userId !== userId && !role) throw new BusinessException(ErrorCode.FORBIDDEN, '无权删除该主题');
    await this.prisma.$transaction(async (tx) => {
      const replies = await tx.groupReply.findMany({ where: { topicId }, select: { id: true } });
      const replyIds = replies.map((r) => r.id);
      if (replyIds.length) await tx.replyLike.deleteMany({ where: { replyId: { in: replyIds } } });
      await tx.groupReply.deleteMany({ where: { topicId } });
      await tx.topicLike.deleteMany({ where: { topicId } });
      await tx.groupTopic.delete({ where: { id: topicId } });
    });
    return { deleted: true };
  }
  /** 主题推荐（豆瓣「推荐/赞」），一人一贴切换。 */
  async likeTopic(topicId: number, userId: string) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    const existing = await this.prisma.topicLike.findUnique({ where: { topicId_userId: { topicId, userId } } });
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.topicLike.delete({ where: { id: existing.id } });
        const updated = await tx.groupTopic.update({ where: { id: topicId }, data: { likeCount: Math.max(0, topic.likeCount - 1) } });
        return { liked: false, likeCount: updated.likeCount };
      }
      await tx.topicLike.create({ data: { topicId, userId } });
      const updated = await tx.groupTopic.update({ where: { id: topicId }, data: { likeCount: topic.likeCount + 1 } });
      return { liked: true, likeCount: updated.likeCount };
    });
  }
  async replyTopic(userId: string, topicId: number, input: { body: string; anonymous?: boolean }) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    await this.assertGroupMember(userId, topic.groupId);
    const body = String(input.body ?? '').trim();
    if (!body) throw new BusinessException(ErrorCode.BAD_REQUEST, '回复内容不能为空');
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.groupReply.count({ where: { topicId } });
      const reply = await tx.groupReply.create({
        data: { topicId, groupId: topic.groupId, userId, floor: count, body, anonymous: Boolean(input.anonymous) },
      });
      await tx.groupTopic.update({ where: { id: topicId }, data: { replyCount: count + 1, lastReplyAt: new Date() } });
      const author = reply.anonymous ? anon() : await this.person(userId).catch(() => anon());
      return { id: reply.id, floor: reply.floor, author, body: reply.body, anonymous: reply.anonymous, likeCount: 0, likedByMe: false, createdAt: reply.createdAt.toISOString() };
    });
  }
  async listReplies(topicId: number, userId: string) {
    const topic = await this.prisma.groupTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BusinessException(ErrorCode.NOT_FOUND, '主题不存在');
    const group = await this.prisma.group.findUnique({ where: { id: topic.groupId } });
    if (group) await this.assertGroupReadable(userId, group);
    const replies = await this.prisma.groupReply.findMany({ where: { topicId }, orderBy: { floor: 'asc' }, take: 200 });
    const persons = await this.persons(replies.filter((r) => !r.anonymous).map((r) => r.userId));
    const liked = new Set((await this.prisma.replyLike.findMany({ where: { userId, replyId: { in: replies.map((r) => r.id) } }, select: { replyId: true } })).map((l) => l.replyId));
    const manage = await this.manageRole(userId, topic.groupId);
    return replies.map((r) => ({
      id: r.id,
      floor: r.floor,
      author: r.anonymous ? anon() : persons[r.userId] || anon(),
      body: r.body,
      anonymous: r.anonymous,
      likeCount: r.likeCount,
      likedByMe: liked.has(r.id),
      canDelete: r.userId === userId || Boolean(manage),
      createdAt: r.createdAt.toISOString(),
    }));
  }
  /** 删除回复：作者本人或组长/管理员；连带推荐。 */
  async deleteReply(replyId: number, userId: string) {
    const reply = await this.prisma.groupReply.findUnique({ where: { id: replyId } });
    if (!reply) throw new BusinessException(ErrorCode.NOT_FOUND, '回复不存在');
    const role = await this.manageRole(userId, reply.groupId);
    if (reply.userId !== userId && !role) throw new BusinessException(ErrorCode.FORBIDDEN, '无权删除该回复');
    await this.prisma.$transaction(async (tx) => {
      await tx.replyLike.deleteMany({ where: { replyId } });
      await tx.groupReply.delete({ where: { id: replyId } });
      const remaining = await tx.groupReply.count({ where: { topicId: reply.topicId } });
      await tx.groupTopic.update({ where: { id: reply.topicId }, data: { replyCount: remaining } });
    });
    return { deleted: true };
  }
  /** 回复推荐，一人一楼切换。 */
  async likeReply(replyId: number, userId: string) {
    const reply = await this.prisma.groupReply.findUnique({ where: { id: replyId } });
    if (!reply) throw new BusinessException(ErrorCode.NOT_FOUND, '回复不存在');
    const existing = await this.prisma.replyLike.findUnique({ where: { replyId_userId: { replyId, userId } } });
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.replyLike.delete({ where: { id: existing.id } });
        const updated = await tx.groupReply.update({ where: { id: replyId }, data: { likeCount: Math.max(0, reply.likeCount - 1) } });
        return { liked: false, likeCount: updated.likeCount };
      }
      await tx.replyLike.create({ data: { replyId, userId } });
      const updated = await tx.groupReply.update({ where: { id: replyId }, data: { likeCount: reply.likeCount + 1 } });
      return { liked: true, likeCount: updated.likeCount };
    });
  }

  // ---------- 站内私信 ----------
  private threadKey(a: string, b: string): { userAId: string; userBId: string } {
    return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
  }
  async sendMail(fromUserId: string, toUserId: string, subject: string, body: string) {
    return this.createMessage(fromUserId, toUserId, subject, body, []);
  }
  /** 落一条私信；linkCards 为随信卡片（如简历卡片），空数组＝纯文本私信。 */
  private async createMessage(fromUserId: string, toUserId: string, subject: string, body: string, linkCards: LinkCard[]) {
    if (fromUserId === toUserId) throw new BusinessException(ErrorCode.BAD_REQUEST, '不能给自己发私信');
    await this.person(toUserId);
    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ userId: toUserId, blockedUserId: fromUserId }, { userId: fromUserId, blockedUserId: toUserId }] },
    });
    if (blocked) throw new BusinessException(ErrorCode.FORBIDDEN, '无法向该用户发送私信');
    const text = String(body ?? '').trim();
    if (!text) throw new BusinessException(ErrorCode.BAD_REQUEST, '私信内容不能为空');
    const key = this.threadKey(fromUserId, toUserId);
    return this.prisma.$transaction(async (tx) => {
      const thread = await tx.mailThread.upsert({
        where: { userAId_userBId: key },
        create: { ...key, subject: String(subject ?? '').slice(0, 200), lastMessageAt: new Date() },
        update: { lastMessageAt: new Date() },
      });
      const message = await tx.snsMessage.create({
        data: {
          threadId: thread.id,
          fromUserId,
          toUserId,
          subject: String(subject ?? '').slice(0, 200),
          body: text.slice(0, 20000),
          linkCards,
        },
      });
      return { id: message.id, threadId: thread.id, createdAt: message.createdAt.toISOString(), linkCards };
    });
  }
  async listThreads(userId: string) {
    const threads = await this.mailboxThreads(userId);
    const result: Array<{ threadId: number; peer: PersonBrief; subject: string; lastMessageAt: string; unread: number }> = [];
    for (const thread of threads) {
      const peerId = thread.userAId === userId ? thread.userBId : thread.userAId;
      const peer = await this.person(peerId).catch(() => anon());
      const last = await this.prisma.snsMessage.findFirst({ where: { threadId: thread.id }, orderBy: { createdAt: 'desc' } });
      const unread = last && last.toUserId === userId && !this.isRead(last.readUserIds, userId) ? 1 : 0;
      result.push({ threadId: thread.id, peer, subject: thread.subject, lastMessageAt: thread.lastMessageAt.toISOString(), unread });
    }
    return result;
  }
  private async mailboxThreads(userId: string) {
    return this.prisma.mailThread.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }
  async threadMessages(userId: string, threadId: number) {
    const thread = await this.prisma.mailThread.findUnique({ where: { id: threadId } });
    if (!thread || (thread.userAId !== userId && thread.userBId !== userId))
      throw new BusinessException(ErrorCode.NOT_FOUND, '会话不存在');
    const messages = await this.prisma.snsMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' }, take: 200 });
    // 标记已读
    for (const m of messages) {
      if (m.toUserId === userId && !this.isRead(m.readUserIds, userId)) {
        const read = Array.isArray(m.readUserIds) ? (m.readUserIds as string[]) : [];
        await this.prisma.snsMessage.update({ where: { id: m.id }, data: { readUserIds: [...read, userId] as object } });
      }
    }
    const senders = await this.persons(messages.map((m) => m.fromUserId));
    return messages.map((m) => ({
      id: m.id,
      from: senders[m.fromUserId] || anon(),
      toUserId: m.toUserId,
      subject: m.subject,
      body: m.body,
      linkCards: this.resumeCards(m.linkCards),
      createdAt: m.createdAt.toISOString(),
    }));
  }
  private isRead(readUserIds: unknown, userId: string): boolean {
    return Array.isArray(readUserIds) && (readUserIds as unknown[]).includes(userId);
  }
  /** 取私信里的简历卡片：link_cards 是宽松 JSON，逐项按形状筛，脏数据不影响会话渲染。 */
  private resumeCards(raw: unknown): LinkCard[] {
    if (!Array.isArray(raw)) return [];
    return (raw as LinkCard[]).filter(
      (card) => card && typeof card === 'object' && card.kind === 'RESUME' && typeof card.userId === 'string',
    );
  }

  // ---------- 简历 ----------
  async getResume(userId: string) {
    const [resume, items] = await Promise.all([
      this.prisma.resume.findUnique({ where: { userId } }),
      this.prisma.resumeItem.findMany({ where: { userId }, orderBy: [{ kind: 'asc' }, { sort: 'asc' }] }),
    ]);
    return {
      resume: resume
        ? { headline: resume.headline, location: resume.location, summary: resume.summary, objectiveRole: resume.objectiveRole, objectiveCity: resume.objectiveCity, objectiveType: resume.objectiveType, additional: resume.additional, contacts: resume.contacts }
        : { headline: '', location: '', summary: '', objectiveRole: '', objectiveCity: '', objectiveType: '', additional: '', contacts: {} },
      items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, subtitle: i.subtitle, startYear: i.startYear, endYear: i.endYear, description: i.description, url: i.url, sort: i.sort })),
    };
  }
  async saveResume(userId: string, input: Partial<{ headline: string; location: string; summary: string; objectiveRole: string; objectiveCity: string; objectiveType: string; additional: string; contacts: unknown }>) {
    const data = {
      headline: String(input.headline ?? '').slice(0, 120),
      location: String(input.location ?? '').slice(0, 64),
      summary: String(input.summary ?? '').slice(0, 2000),
      objectiveRole: String(input.objectiveRole ?? '').slice(0, 120),
      objectiveCity: String(input.objectiveCity ?? '').slice(0, 64),
      objectiveType: String(input.objectiveType ?? '').slice(0, 16),
      additional: String(input.additional ?? '').slice(0, 2000),
      contacts: (input.contacts ?? {}) as object,
    };
    await this.prisma.resume.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.getResume(userId);
  }
  async addResumeItem(userId: string, input: { kind: string; title: string; subtitle?: string; startYear?: number; endYear?: number; description?: string; url?: string; sort?: number }) {
    const kind = String(input.kind ?? '').slice(0, 16);
    const title = String(input.title ?? '').trim().slice(0, 120);
    if (!kind || !title) throw new BusinessException(ErrorCode.BAD_REQUEST, '条目类型与标题必填');
    const item = await this.prisma.resumeItem.create({
      data: {
        userId,
        kind,
        title,
        subtitle: String(input.subtitle ?? '').slice(0, 120),
        startYear: input.startYear ?? null,
        endYear: input.endYear ?? null,
        description: String(input.description ?? '').slice(0, 2000),
        url: String(input.url ?? '').slice(0, 200),
        sort: Number(input.sort) || 0,
      },
    });
    return { id: item.id, kind: item.kind, title: item.title };
  }
  async deleteResumeItem(userId: string, itemId: number) {
    const item = await this.prisma.resumeItem.findUnique({ where: { id: itemId } });
    if (!item || item.userId !== userId) throw new BusinessException(ErrorCode.NOT_FOUND, '条目不存在');
    await this.prisma.resumeItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }
  /**
   * 投递简历：把简历卡片随私信发给对方（复用封禁校验与 threadKey 复用会话）。
   * 卡片只存指针不快照正文，所以雇主回看时永远是简历最新版。
   */
  async sendResume(fromUserId: string, toUserId: string, note: string) {
    const [data, person] = await Promise.all([this.getResume(fromUserId), this.person(fromUserId)]);
    if (!data.resume.headline && !data.resume.summary && data.items.length === 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '简历还是空的，先到「简历」页填好主信息或添加经历条目再投递');
    const text = String(note ?? '').trim() || `我投递了一份简历，点开卡片即可查看（${person.displayName}）。`;
    return this.createMessage(fromUserId, toUserId, '简历投递', text, [
      {
        kind: 'RESUME',
        userId: fromUserId,
        name: person.displayName,
        headline: data.resume.headline,
        updatedAt: new Date().toISOString(),
      },
    ]);
  }
  /**
   * 查看某人简历（HTML 打印版的数据源）：本人始终可看；
   * 他人仅当对方简历确实投递进彼此的会话时可看——否则按 userId 就能遍历别人简历，直接 403。
   */
  async viewResume(viewerId: string, targetId: string) {
    const [person, data, row] = await Promise.all([
      this.person(targetId),
      this.getResume(targetId),
      this.prisma.resume.findUnique({ where: { userId: targetId } }),
    ]);
    const own = viewerId === targetId;
    if (!own) {
      // 只看对方发给我的那一段：简历卡片只会长在投递人发出的消息上，
      // 单向取 200 条比双向混取同等条件下能覆盖更久的历史投递。
      const messages = await this.prisma.snsMessage.findMany({
        where: { fromUserId: targetId, toUserId: viewerId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const delivered = messages.some((m) => this.resumeCards(m.linkCards).some((card) => card.userId === targetId));
      if (!delivered) throw new BusinessException(ErrorCode.FORBIDDEN, '对方还没有向你投递简历');
    }
    return {
      person,
      canManage: own,
      updatedAt: row ? row.updatedAt.toISOString() : '',
      ...data,
    };
  }
}
