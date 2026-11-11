import { randomBytes } from 'node:crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, Input } from 'hono';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { resolveSiteUrl } from '../common/site-url';
import { writeSessionCookie } from '../auth/session';
import { exchangeWechatCode } from '../account/wechat-oauth';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

const OAUTH_NONCE_COOKIE = 'wechat_mp_oauth_nonce';

export type WechatMpSessionIssuer = (
  userId: string,
) => Promise<{ token: string } | null>;

function queryOf(c: Context<ApiEnv, string, Input>) {
  const query: Record<string, string> = {};
  new URL(c.req.url).searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function safeNext(value: unknown) {
  const next = text(value).trim();
  if (
    next.startsWith('/m/') &&
    !next.startsWith('//') &&
    !next.includes('\\') &&
    !next.includes('\n')
  ) {
    return next;
  }
  return '/m/inbox';
}

async function siteBase(c: Context<ApiEnv, string, Input>, services: Services) {
  const configured = await resolveSiteUrl(services.prisma);
  if (configured) return configured;
  const url = new URL(c.req.url);
  const proto =
    c.req.header('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(':', '');
  const host =
    c.req.header('x-forwarded-host')?.split(',')[0].trim() ||
    c.req.header('host') ||
    url.host;
  return `${proto === 'https' ? 'https' : 'http'}://${host}`.replace(
    /\/+$/,
    '',
  );
}

function decodeState(state: string) {
  const index = state.lastIndexOf('.');
  if (index <= 0) return null;
  return { payload: state.slice(0, index), signature: state.slice(index + 1) };
}

/**
 * 微信服务号公开通道：
 * - `/api/public/wechat-mp/callback`：服务器配置校验与消息回调（验签在 InboundService）。
 * - `/api/public/wechat-mp/oauth/start|callback`：微信内静默授权签发本站会话，未绑定不自动注册。
 */
export function registerWechatMpPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
  options: { issueSession: WechatMpSessionIssuer },
) {
  const { settings, inbound, binding } = services.wechatMp;

  app.all('/api/public/wechat-mp/callback', async (c) => {
    const runtime = await settings.runtime().catch(() => null);
    if (!runtime) {
      return c.body('wechat mp disabled', 503, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }
    const query = queryOf(c);
    if (c.req.method === 'GET') {
      try {
        const echo = await inbound.verify(query);
        return c.body(echo, 200, {
          'content-type': 'text/plain; charset=utf-8',
        });
      } catch {
        return c.body('invalid signature', 403, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }
    }
    const raw = await c.req.text();
    try {
      const reply = await inbound.handlePost(raw, query);
      return c.body(reply, 200, {
        'content-type': reply.startsWith('<xml>')
          ? 'application/xml; charset=utf-8'
          : 'text/plain; charset=utf-8',
      });
    } catch (error) {
      // 验签失败不回 success，避免把伪造请求当成已处理；其余异常回 success 让微信停止重试。
      if (error instanceof BusinessException && error.getStatus() === 403) {
        return c.body('invalid signature', 403, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }
      console.error(
        JSON.stringify({
          event: 'wechat_mp_callback_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.body('success', 200, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }
  });

  app.get('/api/public/wechat-mp/oauth/start', async (c) => {
    const runtime = await settings.runtime().catch(() => null);
    if (!runtime) return c.redirect('/login?wechatMp=disabled');
    const next = safeNext(c.req.query('next'));
    const nonce = randomBytes(16).toString('hex');
    const payload = Buffer.from(
      JSON.stringify({ n: next, t: Date.now(), c: nonce }),
    ).toString('base64url');
    const state = `${payload}.${settings.signOAuthState(payload)}`;
    const base = await siteBase(c, services);
    setCookie(c, OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'Lax',
      secure:
        process.env.NODE_ENV === 'production' ||
        process.env.AUTH_COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 600,
    });
    const query = new URLSearchParams({
      appid: runtime.appId,
      redirect_uri: `${base}/api/public/wechat-mp/oauth/callback`,
      response_type: 'code',
      scope: 'snsapi_base',
      state,
    });
    return c.redirect(
      `https://open.weixin.qq.com/connect/oauth2/authorize?${query.toString()}#wechat_redirect`,
    );
  });

  app.get('/api/public/wechat-mp/oauth/callback', async (c) => {
    const runtime = await settings.runtime().catch(() => null);
    if (!runtime) return c.redirect('/login?wechatMp=disabled');
    const code = String(c.req.query('code') || '');
    const state = String(c.req.query('state') || '');
    const decoded = decodeState(state);
    const nonce = getCookie(c, OAUTH_NONCE_COOKIE) || '';
    deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/' });
    if (!code || !decoded) return c.redirect('/m/bind?reason=failed');
    let payload: { n?: string; t?: number; c?: string } = {};
    try {
      payload = JSON.parse(
        Buffer.from(decoded.payload, 'base64url').toString('utf8'),
      ) as { n?: string; t?: number; c?: string };
    } catch {
      return c.redirect('/m/bind?reason=failed');
    }
    if (
      !settings.verifyOAuthState(decoded.payload, decoded.signature) ||
      !payload.t ||
      Math.abs(Date.now() - Number(payload.t)) > 10 * 60 * 1000 ||
      !nonce ||
      payload.c !== nonce
    ) {
      return c.redirect('/m/bind?reason=state');
    }
    try {
      const token = await exchangeWechatCode(
        runtime.appId,
        runtime.appSecret,
        code,
      );
      const bound = await binding.findByOpenId(token.openId);
      if (!bound) return c.redirect('/m/bind?reason=unbound');
      const session = await options.issueSession(bound.userId);
      if (!session) return c.redirect('/login?wechatMp=session');
      writeSessionCookie(c, session.token);
      await binding.touch(token.openId);
      return c.redirect(safeNext(payload.n));
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.message.includes('授权已失效')
      ) {
        return c.redirect('/m/bind?reason=expired');
      }
      console.error(
        JSON.stringify({
          event: 'wechat_mp_oauth_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.redirect('/m/bind?reason=failed');
    }
  });
}
