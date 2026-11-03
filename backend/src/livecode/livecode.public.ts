import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { dispatch } from './livecode.dispatch';
import {
  LIVE_CALLBACK_COOKIE,
  ipHash,
  newVisitorId,
  signSticky,
  verifySticky,
} from './livecode-cookie';
import { embedPayload, embedScript, renderLanding } from './livecode.page';

const COOKIE_MAX_AGE = 30 * 24 * 3600;

/** 进程内限流：单 IP 每分钟 60 次（活码是公开入口，不需要更复杂的令牌桶）。 */
const hits = new Map<string, { count: number; resetAt: number }>();
const limited = (ip: string) => {
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || row.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  row.count += 1;
  return row.count > 60;
};

const clientIp = (c: Context<ApiEnv>) =>
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
  c.req.header('x-real-ip') ||
  '0.0.0.0';

const originOf = (c: Context<ApiEnv>) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || '';
  const proto =
    c.req.header('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https');
  return host ? `${proto}://${host}` : '';
};

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy':
        "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      ...extra,
    },
  });

const cookieOf = (c: Context<ApiEnv>, name: string) => {
  const raw = c.req.header('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
};

const setCookie = (value: string) =>
  `${LIVE_CALLBACK_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`;

/**
 * 活码公开访问：
 * - `/s/:code`：Nginx 的 `location /` 交给 Next，再由 next.config 的 rewrite 转到
 *   `/api/public/lk/s/:code`；
 * - `/api/public/lk/...`：客户 CDN 回源地址与官网脚本接口。
 */
export function registerLivecodePublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const desk = services.livecode;

  const serve = async (
    c: Context<ApiEnv>,
    rawCode: string,
    domainKey: string,
    asJson: boolean,
  ) => {
    if (limited(clientIp(c))) {
      return asJson
        ? c.json({ code: 429, message: '请求过于频繁', data: null }, 429)
        : html('<h1>请求过于频繁</h1>', 429);
    }
    // 域名检测探针：不计数、不落库
    if (rawCode.startsWith('_probe_')) {
      const key = rawCode.slice('_probe_'.length);
      return html(
        `<!doctype html><html><body data-lk-probe="${key}">ok</body></html>`,
      );
    }
    const code = await desk.codeForPublic(rawCode);
    if (!code) {
      return asJson
        ? c.json({ code: 404, message: '活码不存在', data: null }, 404)
        : html(
            '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:40px">链接不存在</body></html>',
            404,
          );
    }
    let domain: { id: number; userId: string; domain: string } | null = null;
    const key =
      domainKey || c.req.header('x-lk-site') || c.req.query('site') || '';
    if (key) {
      const row = await desk.domainByKey(key);
      if (row && row.userId === code.userId) {
        domain = { id: row.id, userId: row.userId, domain: row.domain };
        await desk.markDomainSeen(row.id);
      }
    }
    const sticky = verifySticky(cookieOf(c, LIVE_CALLBACK_COOKIE));
    const visitorId = sticky?.v || newVisitorId();
    const channel = String(c.req.query('c') || '').slice(0, 32);
    const ua = c.req.header('user-agent') || '';
    const result = await dispatch(services.prisma, code, {
      channel,
      stickyChildId: sticky?.c === code.id ? sticky.k : 0,
      visitorId,
      ipHash: ipHash(clientIp(c)),
      ua,
      region: String(c.req.header('x-lk-region') || '').slice(0, 32),
      domainId: domain?.id || 0,
    });
    const nextSticky = signSticky({
      v: visitorId,
      c: code.id,
      k: result.child?.id || 0,
      exp: Date.now() + COOKIE_MAX_AGE * 1000,
    });
    if (asJson) {
      return new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: embedPayload({
            code,
            ...result,
            urlOf: (key) => services.oss.urlOf(key),
          }),
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
            'set-cookie': setCookie(nextSticky),
          },
        },
      );
    }
    return html(
      renderLanding({
        code,
        child: result.child,
        result: result.result,
        origin: originOf(c),
        codeText: code.code,
        urlOf: (key) => services.oss.urlOf(key),
      }),
      200,
      { 'set-cookie': setCookie(nextSticky) },
    );
  };

  app.get('/s/:code', (c) => serve(c, c.req.param('code'), '', false));
  app.get('/api/public/lk/s/:code', (c) =>
    serve(c, c.req.param('code'), '', false),
  );
  app.get('/api/public/lk/o/:key/s/:code', (c) =>
    serve(c, c.req.param('code'), c.req.param('key'), false),
  );
  app.get('/api/public/lk/e/:code', (c) =>
    serve(c, c.req.param('code'), '', true),
  );
  app.get('/api/public/lk/embed.js', () => {
    return new Response(embedScript(), {
      status: 200,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
        'x-content-type-options': 'nosniff',
      },
    });
  });
  // 点击打点：信标请求，返回 204；不跳转（域名仍是客户的）
  app.post('/api/public/lk/c/:code/:childId', async (c) => {
    const code = await desk.codeForPublic(c.req.param('code'));
    if (!code) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    }
    await desk.recordClick(code, Number(c.req.param('childId')) || 0, 0);
    return new Response(null, {
      status: 204,
      headers: { 'access-control-allow-origin': '*' },
    });
  });
}
