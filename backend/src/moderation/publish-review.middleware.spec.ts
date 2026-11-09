import type { Context } from 'hono';
import type { ApiEnv } from '../http/types';
import type { PublishReviewService } from './publish-review.service';
import {
  matchPublishRule,
  publishReviewMiddleware,
  textOf,
} from './publish-review.middleware';
import { stub } from '../../test/doubles';

const makeContext = (
  method: string,
  path: string,
  body?: unknown,
  user: { userId: string } | null = { userId: 'user-1' },
) => {
  const request = body
    ? new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    : new Request(`http://localhost${path}`, { method });
  return stub<Context<ApiEnv>>({
    get: () => user,
    req: { method, path, raw: request },
  });
};

const run = async (
  method: string,
  path: string,
  body?: unknown,
  user?: { userId: string } | null,
) => {
  const guard = jest.fn(async () => undefined);
  const next = jest.fn(async () => undefined);
  const middleware = publishReviewMiddleware(
    stub<PublishReviewService>({
      guard,
    }),
  );
  await middleware(makeContext(method, path, body, user), next);
  return { guard, next };
};

describe('发布审核路径匹配', () => {
  it.each([
    ['POST', '/enterprise/services', 'service'],
    ['PATCH', '/enterprise/services/42', 'service'],
    ['POST', '/enterprise/market/marketing/services', 'service'],
    ['POST', '/enterprise/marketing', 'demand'],
    ['PATCH', '/enterprise/marketing/9', 'demand'],
    ['POST', '/enterprise/legal/requests', 'demand'],
    ['PATCH', '/enterprise/flex/work-orders/7', 'demand'],
    ['POST', '/enterprise/market/logistics/demands', 'demand'],
    ['POST', '/enterprise/market/hub/demands', 'demand'],
    ['PATCH', '/enterprise/market/hub/demands/7', 'demand'],
    ['POST', '/enterprise/market/hub/services', 'service'],
    ['PATCH', '/enterprise/market/hub/services/7', 'service'],
    ['POST', '/enterprise/social/posts', 'community_post'],
    ['POST', '/enterprise/social/groups/g1/topics', 'community_post'],
    ['PUT', '/enterprise/social/resume', 'resume'],
    ['POST', '/enterprise/social/resume/items', 'resume'],
  ])('%s %s 命中 %s 场景', (method, path, scene) => {
    expect(matchPublishRule(method, path)?.scene).toBe(scene);
  });

  it('剥离 /api/backend 前缀后仍能识别', () => {
    expect(
      matchPublishRule('POST', '/api/backend/enterprise/services')?.scene,
    ).toBe('service');
  });

  it.each([
    ['GET', '/enterprise/services'],
    ['DELETE', '/enterprise/services/42'],
    ['POST', '/enterprise/services/42/publish'],
    ['PATCH', '/enterprise/services'],
    ['POST', '/enterprise/social/posts/1/like'],
  ])('%s %s 不是发布动作', (method, path) => {
    expect(matchPublishRule(method, path)).toBeUndefined();
  });
});

describe('发布审核中间件', () => {
  it('抽取正文类字段并按场景送审', async () => {
    const { guard, next } = await run('POST', '/enterprise/services', {
      title: '企业代运营',
      description: '全案服务',
      tags: ['营销', '增长'],
      contacts: '13800000000',
    });
    expect(guard).toHaveBeenCalledWith({
      userId: 'user-1',
      scene: 'service',
      texts: ['企业代运营', '全案服务', '营销、增长', '', '', '', '', ''],
    });
    expect(next).toHaveBeenCalled();
  });

  it('未登录、非发布路径与非法正文都直接放行', async () => {
    expect(
      (await run('POST', '/enterprise/services', { title: 'x' }, null)).guard,
    ).not.toHaveBeenCalled();
    expect(
      (await run('POST', '/enterprise/dashboard', { title: 'x' })).guard,
    ).not.toHaveBeenCalled();
    expect(
      (await run('POST', '/enterprise/services', ['not-object'])).guard,
    ).not.toHaveBeenCalled();
  });

  it('社群发帖只审正文，群话题审标题、正文与标签', async () => {
    const post = await run('POST', '/enterprise/social/posts', {
      body: '今日分享',
      title: '不应送审',
    });
    expect(post.guard).toHaveBeenCalledWith({
      userId: 'user-1',
      scene: 'community_post',
      texts: ['今日分享'],
    });
    const topic = await run('POST', '/enterprise/social/groups/g1/topics', {
      title: '话题',
      body: '内容',
      tag: '讨论',
    });
    expect(topic.guard).toHaveBeenCalledWith({
      userId: 'user-1',
      scene: 'community_post',
      texts: ['话题', '内容', '讨论'],
    });
  });
});

describe('审核文本抽取', () => {
  it('忽略对象 / 空值并展开数组', () => {
    expect(textOf({ a: 1 })).toBe('');
    expect(textOf(null)).toBe('');
    expect(textOf(0)).toBe('0');
    expect(textOf(false)).toBe('false');
    expect(textOf(['a', ['b', 2], null])).toBe('a、b、2');
  });
});
