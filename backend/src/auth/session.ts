import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  loginSchema,
  registerSchema,
  safeNextPath,
  z,
} from '@enterprise/contracts';
import { issueSsoSession, parseAccessToken, REMEMBER_TTL_SECONDS } from './token';
import type { ApiEnv } from '../http/types';
import type { AccountModule } from '../account/account.routes';

const ACCESS = 'aiworkin_token',
  REFRESH = 'aiworkin_refresh_token';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure:
    process.env.NODE_ENV === 'production' ||
    process.env.AUTH_COOKIE_SECURE === 'true',
  path: '/',
  maxAge: 90 * 86400,
});
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
 */
export async function sessionToken(c: Context<ApiEnv>, publicRequest = false) {
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
  (c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '').slice(0, 64);

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
    c.header('x-login-next', safeNextPath(c.req.query('next')));
    return c.json(envelope(0, '登录成功'));
  });
  app.post('/api/auth/register', async (c) => {
    const body = registerSchema.parse(await c.req.json().catch(() => ({})));
    const email = String(body.email || '').trim();
    const emailCode = String(body.emailCode || '').trim();
    await account.account.register({
      ...(email && emailCode ? { mode: 'EMAIL' as const } : {}),
      username: String(body.username || '').trim(),
      password: String(body.password || ''),
      ...(email ? { email } : {}),
      ...(emailCode ? { code: emailCode } : {}),
      ...(body.inviteCode ? { inviteCode: String(body.inviteCode) } : {}),
    });
    return c.json(envelope(0, '注册成功'));
  });
  app.post('/api/auth/email-code', async (c) => {
    const body = z
      .object({ email: z.string().email(), scene: z.string().default('REGISTER') })
      .parse(await c.req.json().catch(() => ({})));
    await account.account.sendRegisterCode('EMAIL', body.email);
    return c.json(envelope(0, '验证码已发送'));
  });
  /** 敏感操作二次验密：核对当前会话用户的本地密码（前端按 422 判「密码不正确」）。 */
  app.post('/api/auth/verify-password', async (c) => {
    const token = await sessionToken(c);
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
