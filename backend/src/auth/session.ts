import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Input } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorCode,
  loginSchema,
  registerSchema,
  safeNextPath,
  z,
} from '@enterprise/contracts';
import {
  issueSsoSession,
  parseAccessToken,
  REMEMBER_TTL_SECONDS,
} from './token';
import { BusinessException } from '../common/business.exception';
import { RateWindow } from '../common/rate-window';
import type { ApiEnv } from '../http/types';
import type { AccountModule } from '../account/account.routes';

const ACCESS = 'aiworkin_token',
  REFRESH = 'aiworkin_refresh_token';
export const SESSION_COOKIE = ACCESS;
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure:
    process.env.NODE_ENV === 'production' ||
    process.env.AUTH_COOKIE_SECURE === 'true',
  path: '/',
  maxAge: 90 * 86400,
});
/** 微信 H5 网页授权换发会话时复用同一 Cookie 口径，避免两套过期时间互相覆盖。 */
export function writeSessionCookie(
  c: Context<ApiEnv, string, Input>,
  token: string,
) {
  setCookie(c, ACCESS, token, cookieOptions());
}
function normalize(value?: string) {
  let result = value
    ?.trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^['"]|['"]$/g, '');
  try {
    if (result) result = decodeURIComponent(result);
  } catch {
    /* unchanged */
  }
  return result;
}
/**
 * 读取当前请求携带的本系统会话令牌（Authorization 头优先，其次 Cookie）。
 * 开源版令牌全部由本系统自签（issueSsoSession），不再有「过期后向账号侧刷新」的链路。
 * 后两个泛型写满（不用 Context<ApiEnv> 默认值）：默认值里路径与校验输入是 any，
 * `use('*')` 中间件传进来的实参会被 no-unsafe-argument 判成不安全实参。
 */
export function sessionToken(c: Context<ApiEnv, string, Input>) {
  const header = c.req.header('authorization');
  if (header) return normalize(header);
  return normalize(getCookie(c, ACCESS)) || undefined;
}
const envelope = (code: number, message: string, data: unknown = null) => ({
  code,
  message,
  data,
});
const clientIp = (c: Context) =>
  (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    ''
  ).slice(0, 64);

/**
 * 验密端点是「一次请求＝一次故意的慢 bcrypt」：不限流的话，拿到被盗令牌的一方
 * 既能把它当 CPU 放大器拖住进程，也能无上限地试探密码。账号与来源各一道。
 * 与 assertSensitivePassword 同一口径（进程内固定窗口，多实例各自独立）。
 */
const VERIFY_PER_USER = new RateWindow(10, 60_000);
const VERIFY_PER_IP = new RateWindow(60, 60_000);
const VERIFY_THROTTLED = '密码验证过于频繁，请稍后再试';

/** 超限就回文案（调用方据此回 429）；账号那道是主力，来源那道只挡「一个 IP 挂着批量令牌」。 */
function throttleVerify(userId: string, ip: string) {
  try {
    VERIFY_PER_USER.consume(`u:${userId}`, VERIFY_THROTTLED);
    if (ip) VERIFY_PER_IP.consume(`i:${ip}`, VERIFY_THROTTLED);
  } catch (error) {
    if (error instanceof BusinessException) return error.message;
    throw error;
  }
  return '';
}

/**
 * 会话兼容端点：前端既有调用路径 /api/auth/login|register|email-code|logout
 * 在开源版一律改走本地账户体系（设计 3.6），不再代理 AIworkin 账号侧（Java）。
 * 独立的自助全家桶入口在 /api/auth/local/*（account.routes 注册）。
 */
export function registerSessionRoutes(
  app: OpenAPIHono<ApiEnv>,
  account: AccountModule,
) {
  app.post('/api/auth/login', async (c) => {
    const body = loginSchema.parse(await c.req.json().catch(() => ({})));
    const session = await account.account.login(
      String(body.username || ''),
      String(body.password || ''),
      { ip: clientIp(c), userAgent: c.req.header('user-agent') },
    );
    const token = issueSsoSession(
      session.userId,
      session.username,
      session.role,
      session.tokenVersion,
      // 勾选「30 天内自动登录」：会话延长到 30 天，期间打开即免登录。
      body.remember === true ? REMEMBER_TTL_SECONDS : undefined,
    );
    parseAccessToken(token);
    setCookie(c, ACCESS, token, cookieOptions());
    deleteCookie(c, REFRESH, { path: '/' });
    c.header('x-login-next', safeNextPath(c.req.query('next'), '/dashboard'));
    return c.json(envelope(0, '登录成功'));
  });
  app.post('/api/auth/register', async (c) => {
    const body = registerSchema.parse(await c.req.json().catch(() => ({})));
    const email = String(body.email || '').trim();
    const emailCode = String(body.emailCode || '').trim();
    await account.account.register(
      {
        ...(email && emailCode ? { mode: 'EMAIL' as const } : {}),
        username: String(body.username || '').trim(),
        password: String(body.password || ''),
        ...(email ? { email } : {}),
        ...(emailCode ? { code: emailCode } : {}),
        ...(body.inviteCode ? { inviteCode: String(body.inviteCode) } : {}),
        terms: (Array.isArray(body.terms) ? body.terms : []).map((item) => ({
          code: String(item?.code || ''),
          version: String(item?.version || ''),
        })),
      },
      { ip: clientIp(c), userAgent: c.req.header('user-agent') },
    );
    return c.json(envelope(0, '注册成功'));
  });
  app.post('/api/auth/email-code', async (c) => {
    const body = z
      .object({
        email: z.string().email(),
        scene: z.string().default('REGISTER'),
      })
      .parse(await c.req.json().catch(() => ({})));
    await account.account.sendRegisterCode('EMAIL', body.email);
    return c.json(envelope(0, '验证码已发送'));
  });
  /** 敏感操作二次验密：核对当前会话用户的本地密码（前端按 422 判「密码不正确」）。 */
  app.post('/api/auth/verify-password', async (c) => {
    const token = sessionToken(c);
    let userId = '';
    try {
      userId = token ? parseAccessToken(token).userId : '';
    } catch {
      userId = '';
    }
    if (!userId) return c.json(envelope(401, '请先登录'), 401);
    const { password } = z
      .object({ password: z.string().min(1) })
      .parse(await c.req.json().catch(() => ({})));
    const throttled = throttleVerify(userId, clientIp(c));
    if (throttled) {
      return c.json(envelope(ErrorCode.RATE_LIMITED.code, throttled), 429);
    }
    const okFlag = await account.account.verifyPassword(userId, password);
    return c.json(
      okFlag ? envelope(0, '验证通过') : envelope(422, '密码不正确'),
      okFlag ? 200 : 422,
    );
  });
  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, ACCESS, { path: '/' });
    deleteCookie(c, REFRESH, { path: '/' });
    return c.json(envelope(0, '已退出登录'));
  });
}
