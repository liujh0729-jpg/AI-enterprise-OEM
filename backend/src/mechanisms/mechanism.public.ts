import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { safeNextPath } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { resolveSiteUrl } from '../common/site-url';
import { issueSsoSession } from '../auth/token';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

/** 进程内限流：公开分享读 60 次/分，OIDC 跳转 20 次/分。 */
const hits = new Map<string, { count: number; resetAt: number }>();
const limited = (key: string, max: number) => {
  const now = Date.now();
  const row = hits.get(key);
  if (hits.size > 5000) {
    for (const [item, value] of hits)
      if (value.resetAt < now) hits.delete(item);
  }
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  row.count += 1;
  return row.count > max;
};

const clientIp = (c: Context<ApiEnv>) =>
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
  c.req.header('x-real-ip') ||
  '0.0.0.0';

/** OIDC state → 回跳信息，10 分钟内有效；state 只做一次性票据，不承载敏感数据。 */
const pendingStates = new Map<
  string,
  { code: string; redirectUri: string; returnTo: string; at: number }
>();
const STATE_TTL_MS = 10 * 60_000;
const pruneStates = () => {
  const now = Date.now();
  for (const [key, value] of pendingStates)
    if (now - value.at > STATE_TTL_MS) pendingStates.delete(key);
};

const originOf = async (c: Context<ApiEnv>, services: Services) =>
  (await resolveSiteUrl(services.prisma)) || new URL(c.req.url).origin;

/**
 * 公开通道（免登录）：
 * - GET/POST /api/public/share/:slug   资产公开分享读取（密码可选）
 * - GET      /api/public/oidc/:code/start    跳转外部身份源
 * - GET      /api/public/oidc/:code/callback 换取令牌、签发本系统会话
 * 注册在根 app 上，和问卷 / 活码 / 客服一样不经过业务登录中间件。
 */
export function registerMechanismPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.get('/api/public/share/:slug', async (c) => {
    if (limited(`share:get:${clientIp(c)}`, 60)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    const slug = c.req.param('slug');
    const password = c.req.query('password') || '';
    return c.json(ok(await services.mechanisms.publicView(slug, password)));
  });

  app.post('/api/public/share/:slug', async (c) => {
    if (limited(`share:post:${clientIp(c)}`, 60)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    const slug = c.req.param('slug');
    const body = (await c.req.json().catch(() => ({}))) as {
      password?: unknown;
    };
    const password = typeof body.password === 'string' ? body.password : '';
    return c.json(ok(await services.mechanisms.publicView(slug, password)));
  });

  app.get('/api/public/oidc/:code/start', async (c) => {
    if (limited(`oidc:start:${clientIp(c)}`, 20)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '登录太频繁，请稍后再试',
      );
    }
    pruneStates();
    const code = c.req.param('code').toLowerCase();
    const origin = await originOf(c, services);
    const redirectUri = `${origin}/api/public/oidc/${code}/callback`;
    const state = randomBytes(16).toString('hex');
    const returnTo = safeNextPath(c.req.query('returnTo'));
    const target = await services.mechanisms.oidcAuthorizeUrl(
      code,
      redirectUri,
      state,
    );
    pendingStates.set(state, { code, redirectUri, returnTo, at: Date.now() });
    return c.redirect(target, 302);
  });

  app.get('/api/public/oidc/:code/callback', async (c) => {
    pruneStates();
    const code = c.req.param('code').toLowerCase();
    const state = c.req.query('state') || '';
    const authCode = c.req.query('code') || '';
    const pending = pendingStates.get(state);
    if (
      !pending ||
      pending.code !== code ||
      Date.now() - pending.at > STATE_TTL_MS
    ) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '登录请求已失效，请重新发起',
      );
    }
    pendingStates.delete(state);
    if (!authCode) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '身份源未返回授权码');
    }
    const session = await services.mechanisms.oidcExchange(
      code,
      authCode,
      pending.redirectUri,
    );
    const token = issueSsoSession(
      session.userId,
      session.username,
      session.role,
      session.tokenVersion,
    );
    setCookie(c, 'aiworkin_token', token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 172800,
    });
    return c.redirect(pending.returnTo, 303);
  });
}
