import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { SocialService } from './social.service';
import { SocialAffinityService } from './social-affinity.service';
import { SocialSyncService } from './social-sync.service';
import { AiworkinSocialService } from './aiworkin-social.service';

export class SocialModule {
  readonly social: SocialService;
  readonly affinity: SocialAffinityService;
  readonly sync: SocialSyncService;
  readonly aiworkin: AiworkinSocialService;
  constructor(services: Services) {
    this.aiworkin = services.socialSync.aiworkin;
    this.sync = services.socialSync.sync;
    this.affinity = services.socialSync.affinity;
    this.social = new SocialService(services.prisma, this.sync);
  }
}
export function createSocialModule(services: Services): SocialModule {
  return new SocialModule(services);
}

const intParam = (raw: string | undefined, name: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${name}非法`);
  return value;
};

/** 可选请求体：antd 按钮/空 body 都可能不传 JSON，不能因此 500。 */
const optionalBody = async (c: Context<ApiEnv>): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
};

/**
 * 社交板块路由（设计 §5 / M5）：本地闭环，全部挂在 business（经统一鉴权中间件，
 * 平台级封禁在中间件已即时拦截，无需各路由重复判断）。userId 取当前会话。
 */
export function registerSocialRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: SocialModule,
) {
  const service = module.social;
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  // ---------- 资料 ----------
  app.get('/enterprise/social/profile/:userId', async (c) =>
    json(c, await service.getProfile(c.req.param('userId'))),
  );
  app.put('/enterprise/social/profile', async (c) => {
    const body = z
      .object({
        title: z.string().max(120).optional(),
        city: z.string().max(64).optional(),
        gender: z.string().max(16).optional(),
        bio: z.string().max(2000).optional(),
        lang: z.string().max(8).optional(),
        contacts: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    const result = await service.saveProfile(userOf(c).userId, body);
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '资料已保存');
  });

  // ---------- 好友 / 拉黑 ----------
  app.post('/enterprise/social/friends/requests', async (c) => {
    const body = z
      .object({
        toUserId: z.string().min(1).max(64),
        message: z.string().max(500).default(''),
        syncUpstream: z.boolean().optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.requestFriend(
        userOf(c).userId,
        body.toUserId,
        body.message,
        { syncUpstream: body.syncUpstream },
      ),
    );
  });
  app.get('/enterprise/social/friends/requests', async (c) =>
    json(c, await service.incomingRequests(userOf(c).userId)),
  );
  app.post('/enterprise/social/friends/requests/:id/accept', async (c) => {
    const body = z
      .object({ syncUpstream: z.boolean().optional() })
      .parse(await optionalBody(c));
    const result = await service.acceptFriend(
      userOf(c).userId,
      intParam(c.req.param('id'), '请求'),
      { syncUpstream: body.syncUpstream },
    );
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '已添加好友');
  });
  app.post('/enterprise/social/friends/requests/:id/reject', async (c) => {
    const body = z
      .object({ syncUpstream: z.boolean().optional() })
      .parse(await optionalBody(c));
    const result = await service.rejectFriend(
      userOf(c).userId,
      intParam(c.req.param('id'), '请求'),
      { syncUpstream: body.syncUpstream },
    );
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '已拒绝');
  });
  app.get('/enterprise/social/friends', async (c) =>
    json(c, await service.listFriends(userOf(c).userId)),
  );
  app.delete('/enterprise/social/friends/:friendId', async (c) => {
    const friendId = c.req.param('friendId');
    const result = await service.removeFriend(userOf(c).userId, friendId);
    await Promise.all([
      module.affinity.invalidate(userOf(c).userId),
      module.affinity.invalidate(friendId),
    ]);
    return json(c, result, '已删除好友');
  });
  app.post('/enterprise/social/blocks', async (c) => {
    const body = z
      .object({ userId: z.string().min(1).max(64) })
      .parse(await c.req.json());
    const result = await service.block(userOf(c).userId, body.userId);
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '已拉黑');
  });
  app.delete('/enterprise/social/blocks/:userId', async (c) => {
    const result = await service.unblock(
      userOf(c).userId,
      c.req.param('userId'),
    );
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '已取消拉黑');
  });

  // ---------- 亲密度推荐 ----------
  app.get('/enterprise/social/recommendations', async (c) =>
    json(
      c,
      await module.affinity.recommend(
        userOf(c).userId,
        Number(c.req.query('limit') || 12),
      ),
    ),
  );
  app.post('/enterprise/social/recommendations/:userId/dismiss', async (c) =>
    json(
      c,
      await module.affinity.dismiss(userOf(c).userId, c.req.param('userId')),
      '已减少此类推荐',
    ),
  );

  // ---------- AIworkin 同步 ----------
  app.get('/enterprise/social/sync/overview', async (c) =>
    json(c, await module.sync.overview(userOf(c).userId)),
  );
  app.get('/enterprise/social/sync/preferences', async (c) =>
    json(c, await module.sync.preferences(userOf(c).userId)),
  );
  app.put('/enterprise/social/sync/preferences', async (c) => {
    const body = z
      .object({
        discoverable: z.boolean().optional(),
        recommendEnabled: z.boolean().optional(),
        businessReasonVisible: z.boolean().optional(),
        friendRequestOutbound: z.boolean().optional(),
        friendRelationOutbound: z.boolean().optional(),
        friendRelationInbound: z.boolean().optional(),
        mailOutboundDefault: z.boolean().optional(),
        mailInbound: z.boolean().optional(),
        channel: z.enum(['AUTO', 'MCP', 'LEGACY']).optional(),
      })
      .parse(await c.req.json());
    const result = await module.sync.savePreferences(userOf(c).userId, body);
    await module.affinity.invalidate(userOf(c).userId);
    return json(c, result, '同步设置已保存');
  });
  app.get('/enterprise/social/sync/jobs', async (c) =>
    json(
      c,
      await module.sync.jobs(
        userOf(c).userId,
        c.req.query('status'),
        Number(c.req.query('limit') || 20),
      ),
    ),
  );
  app.post('/enterprise/social/sync/jobs/:id/retry', async (c) =>
    json(
      c,
      await module.sync.retry(
        userOf(c).userId,
        intParam(c.req.param('id'), '任务'),
      ),
      '已重新排队',
    ),
  );
  app.post('/enterprise/social/sync/pull', async (c) =>
    json(c, await module.sync.pull(userOf(c).userId), '已排队拉取'),
  );
  app.post('/enterprise/social/sync/verify', async (c) =>
    json(c, await module.sync.verify(userOf(c).userId)),
  );
  app.post('/enterprise/social/sync/backfill/friends', async (c) => {
    const body = z
      .object({ confirm: z.boolean().default(false) })
      .parse(await optionalBody(c));
    return json(
      c,
      await module.sync.backfillStart(userOf(c).userId, body.confirm),
      body.confirm ? '已排队回填' : 'ok',
    );
  });
  app.get('/enterprise/social/sync/backfill/friends/progress', async (c) =>
    json(c, await module.sync.backfillProgress(userOf(c).userId)),
  );

  // ---------- 动态 / 信息流 ----------
  app.post('/enterprise/social/posts', async (c) => {
    const body = z
      .object({
        body: z.string().min(1).max(5000),
        visibility: z.enum(['PUBLIC', 'FRIENDS']).default('PUBLIC'),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.createPost(userOf(c).userId, body.body, body.visibility),
      '已发布',
    );
  });
  app.delete('/enterprise/social/posts/:id', async (c) =>
    json(
      c,
      await service.deletePost(
        userOf(c).userId,
        intParam(c.req.param('id'), '动态'),
      ),
      '已删除',
    ),
  );
  app.get('/enterprise/social/feed', async (c) => {
    const userId = userOf(c).userId;
    return json(
      c,
      await service.feed(userId, Number(c.req.query('limit') || 30), (posts) =>
        module.affinity.rankFeed(userId, posts),
      ),
    );
  });
  app.get('/enterprise/social/posts/mine', async (c) =>
    json(c, await service.myPosts(userOf(c).userId)),
  );

  // ---------- 小组（对标豆瓣） ----------
  app.post('/enterprise/social/groups', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(30),
        description: z.string().max(2000).default(''),
        avatar: z.string().max(500).default(''),
        rules: z.string().max(2000).default(''),
        category: z.string().max(30).default(''),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
        joinPolicy: z.enum(['FREE', 'APPROVE']).default('FREE'),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.createGroup(userOf(c).userId, body),
      '小组已创建',
    );
  });
  app.get('/enterprise/social/groups', async (c) =>
    json(
      c,
      await service.listGroups(userOf(c).userId, {
        scope: c.req.query('scope') === 'mine' ? 'mine' : 'discover',
        keyword: c.req.query('keyword'),
        category: c.req.query('category'),
      }),
    ),
  );
  app.get('/enterprise/social/groups/:id', async (c) =>
    json(
      c,
      await service.getGroup(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
      ),
    ),
  );
  app.put('/enterprise/social/groups/:id', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(30).optional(),
        description: z.string().max(2000).optional(),
        avatar: z.string().max(500).optional(),
        rules: z.string().max(2000).optional(),
        category: z.string().max(30).optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
        joinPolicy: z.enum(['FREE', 'APPROVE']).optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.updateGroup(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
        body,
      ),
      '小组已更新',
    );
  });
  app.post('/enterprise/social/groups/:id/join', async (c) =>
    json(
      c,
      await service.joinGroup(
        userOf(c).userId,
        intParam(c.req.param('id'), '小组'),
      ),
    ),
  );
  app.post('/enterprise/social/groups/:id/leave', async (c) =>
    json(
      c,
      await service.leaveGroup(
        userOf(c).userId,
        intParam(c.req.param('id'), '小组'),
      ),
      '已退出小组',
    ),
  );
  app.get('/enterprise/social/groups/:id/members', async (c) =>
    json(
      c,
      await service.listMembers(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
        c.req.query('status') || 'ACTIVE',
      ),
    ),
  );
  app.post(
    '/enterprise/social/groups/:id/requests/:memberId/review',
    async (c) => {
      const body = z.object({ approve: z.boolean() }).parse(await c.req.json());
      return json(
        c,
        await service.reviewJoin(
          intParam(c.req.param('id'), '小组'),
          userOf(c).userId,
          intParam(c.req.param('memberId'), '成员'),
          body.approve,
        ),
        body.approve ? '已通过' : '已拒绝',
      );
    },
  );
  app.put('/enterprise/social/groups/:id/members/:userId/role', async (c) => {
    const body = z
      .object({ role: z.enum(['ADMIN', 'MEMBER']) })
      .parse(await c.req.json());
    return json(
      c,
      await service.setMemberRole(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
        c.req.param('userId'),
        body.role,
      ),
      '已更新成员身份',
    );
  });
  app.delete('/enterprise/social/groups/:id/members/:userId', async (c) =>
    json(
      c,
      await service.removeMember(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
        c.req.param('userId'),
      ),
      '已移除成员',
    ),
  );
  app.post('/enterprise/social/groups/:id/topics', async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(20000),
        anonymous: z.boolean().default(false),
        tag: z.string().max(30).default(''),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.createTopic(
        userOf(c).userId,
        intParam(c.req.param('id'), '小组'),
        body,
      ),
      '已发布',
    );
  });
  app.get('/enterprise/social/groups/:id/topics', async (c) =>
    json(
      c,
      await service.listTopics(
        intParam(c.req.param('id'), '小组'),
        userOf(c).userId,
        {
          featuredOnly: c.req.query('featured') === '1',
          tag: c.req.query('tag'),
        },
      ),
    ),
  );
  app.get('/enterprise/social/topics/:id', async (c) =>
    json(
      c,
      await service.getTopic(
        intParam(c.req.param('id'), '主题'),
        userOf(c).userId,
      ),
    ),
  );
  app.delete('/enterprise/social/topics/:id', async (c) =>
    json(
      c,
      await service.deleteTopic(
        intParam(c.req.param('id'), '主题'),
        userOf(c).userId,
      ),
      '已删除',
    ),
  );
  app.post('/enterprise/social/topics/:id/flags', async (c) => {
    const body = z
      .object({
        pinned: z.boolean().optional(),
        featured: z.boolean().optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.setTopicFlags(
        intParam(c.req.param('id'), '主题'),
        userOf(c).userId,
        body,
      ),
      '已更新',
    );
  });
  app.post('/enterprise/social/topics/:id/like', async (c) =>
    json(
      c,
      await service.likeTopic(
        intParam(c.req.param('id'), '主题'),
        userOf(c).userId,
      ),
    ),
  );
  app.post('/enterprise/social/topics/:id/replies', async (c) => {
    const body = z
      .object({
        body: z.string().min(1).max(20000),
        anonymous: z.boolean().default(false),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.replyTopic(
        userOf(c).userId,
        intParam(c.req.param('id'), '主题'),
        body,
      ),
      '已回复',
    );
  });
  app.get('/enterprise/social/topics/:id/replies', async (c) =>
    json(
      c,
      await service.listReplies(
        intParam(c.req.param('id'), '主题'),
        userOf(c).userId,
      ),
    ),
  );
  app.delete('/enterprise/social/replies/:id', async (c) =>
    json(
      c,
      await service.deleteReply(
        intParam(c.req.param('id'), '回复'),
        userOf(c).userId,
      ),
      '已删除',
    ),
  );
  app.post('/enterprise/social/replies/:id/like', async (c) =>
    json(
      c,
      await service.likeReply(
        intParam(c.req.param('id'), '回复'),
        userOf(c).userId,
      ),
    ),
  );

  // ---------- 站内私信 ----------
  app.get('/enterprise/social/mail/threads', async (c) =>
    json(c, await service.listThreads(userOf(c).userId)),
  );
  app.get('/enterprise/social/mail/threads/:id/messages', async (c) =>
    json(
      c,
      await service.threadMessages(
        userOf(c).userId,
        intParam(c.req.param('id'), '会话'),
      ),
    ),
  );
  app.post('/enterprise/social/mail', async (c) => {
    const body = z
      .object({
        toUserId: z.string().min(1).max(64),
        subject: z.string().max(200).default(''),
        body: z.string().min(1).max(20000),
        syncUpstream: z.boolean().optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.sendMail(
        userOf(c).userId,
        body.toUserId,
        body.subject,
        body.body,
        { syncUpstream: body.syncUpstream },
      ),
      '已发送',
    );
  });
  /** 投递我的简历：往对方会话里发一条带简历卡片的私信，雇主点卡片打开 HTML 简历。 */
  app.post('/enterprise/social/mail/resume', async (c) => {
    const body = z
      .object({
        toUserId: z.string().min(1).max(64),
        note: z.string().max(2000).default(''),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.sendResume(userOf(c).userId, body.toUserId, body.note),
      '简历已投递',
    );
  });

  // ---------- 简历 ----------
  app.get('/enterprise/social/resume', async (c) =>
    json(c, await service.getResume(userOf(c).userId)),
  );
  /** 查看他人简历（HTML 打印版）：仅限收到过该投递的人，权限判定在 service 里。 */
  app.get('/enterprise/social/resume/:userId/view', async (c) =>
    json(c, await service.viewResume(userOf(c).userId, c.req.param('userId'))),
  );
  app.put('/enterprise/social/resume', async (c) => {
    const body = z
      .object({
        headline: z.string().max(120).optional(),
        location: z.string().max(64).optional(),
        summary: z.string().max(2000).optional(),
        objectiveRole: z.string().max(120).optional(),
        objectiveCity: z.string().max(64).optional(),
        objectiveType: z.string().max(16).optional(),
        additional: z.string().max(2000).optional(),
        contacts: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.saveResume(userOf(c).userId, body),
      '简历已保存',
    );
  });
  app.post('/enterprise/social/resume/items', async (c) => {
    const body = z
      .object({
        kind: z.string().min(1).max(16),
        title: z.string().min(1).max(120),
        subtitle: z.string().max(120).default(''),
        startYear: z.number().int().optional(),
        endYear: z.number().int().optional(),
        description: z.string().max(2000).default(''),
        url: z.string().max(200).default(''),
        sort: z.number().int().default(0),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.addResumeItem(userOf(c).userId, body),
      '条目已添加',
    );
  });
  app.delete('/enterprise/social/resume/items/:id', async (c) =>
    json(
      c,
      await service.deleteResumeItem(
        userOf(c).userId,
        intParam(c.req.param('id'), '条目'),
      ),
      '条目已删除',
    ),
  );
}
