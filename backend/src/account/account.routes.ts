import { setCookie, getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import {
  issueSsoSession,
  tokenRemainingSeconds,
  REMEMBER_TTL_SECONDS,
} from '../auth/token';
import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { AccountService, type LoginContext } from './account.service';
import { AccountSettingsService, type RegisterMode } from './account-settings.service';
import { NotifyChannelService } from './notify-channel.service';
import { AipddKeyService } from './aipdd-key.service';

/** 登录会话 Cookie 与既有会话通道同名，前端与退出逻辑零改动。 */
const ACCESS_COOKIE = 'aiworkin_token';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure:
    process.env.NODE_ENV === 'production' ||
    process.env.AUTH_COOKIE_SECURE === 'true',
  path: '/',
  maxAge: 90 * 86400,
});

export class AccountModule {
  readonly settings: AccountSettingsService;
  readonly channels: NotifyChannelService;
  readonly account: AccountService;
  readonly aipdd: AipddKeyService;

  constructor(services: Services) {
    this.settings = new AccountSettingsService(services.prisma);
    this.channels = new NotifyChannelService(services.prisma, this.settings);
    this.account = new AccountService(
      services.prisma,
      this.settings,
      this.channels,
      services.points.ledger,
    );
    this.aipdd = new AipddKeyService(services.prisma);
  }
}

export function createAccountModule(services: Services): AccountModule {
  return new AccountModule(services);
}

// ---------- 公开路由（挂在根 app，与 /api/auth/login 同一通道，不走业务鉴权中间件） ----------

const ipWindow = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string) {
  if (!ip) return;
  const now = Date.now();
  const entry = ipWindow.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipWindow.set(ip, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (++entry.count > 30) {
    throw new BusinessException(ErrorCode.RATE_LIMITED, '请求过于频繁，请稍后再试');
  }
}

const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
  (c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '').slice(0, 64);
const loginContext = (c: {
  req: { header(name: string): string | undefined };
}): LoginContext => ({ ip: clientIp(c), userAgent: c.req.header('user-agent') });

export function registerAccountRoutes(app: OpenAPIHono<ApiEnv>, module: AccountModule) {
  // 登录/注册页配置：开放的注册通道与各渠道可用性
  app.get('/api/auth/account-config', async (c) => {
    const [modes, availability] = await Promise.all([
      module.settings.registerModes(),
      module.settings.channelAvailability(),
    ]);
    return c.json(
      ok({
        registerModes: modes,
        availability,
        captchaRequired: false,
      }),
    );
  });

  app.post('/api/auth/local/register-code', async (c) => {
    rateLimit(clientIp(c));
    const body = z
      .object({
        channel: z.enum(['EMAIL', 'SMS']),
        target: z.string().min(3).max(160),
      })
      .parse(await c.req.json());
    await module.account.sendRegisterCode(body.channel, body.target);
    return c.json(ok({ sent: true }, '验证码已发送'));
  });

  app.post('/api/auth/local/register', async (c) => {
    rateLimit(clientIp(c));
    const body = z
      .object({
        mode: z.enum(['USERNAME', 'EMAIL', 'PHONE']).default('USERNAME'),
        username: z.string().max(64).optional(),
        password: z.string().min(1).max(128),
        email: z.string().max(160).optional(),
        phone: z.string().max(32).optional(),
        code: z.string().max(64).optional(),
        /** 选填：他人的 6 位邀请码（大小写不敏感），填错直接报错。 */
        inviteCode: z.string().max(32).optional(),
      })
      .parse(await c.req.json());
    const account = await module.account.register(body as { mode?: RegisterMode });
    return c.json(ok(account, '注册成功'));
  });

  app.post('/api/auth/local/login', async (c) => {
    rateLimit(clientIp(c));
    const body = z
      .object({
        account: z.string().min(1).max(160),
        password: z.string().min(1).max(128),
        /** 勾选「30 天内自动登录」：会话令牌延长为 30 天。 */
        remember: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const session = await module.account.login(body.account, body.password, loginContext(c));
    const token = issueSsoSession(
      session.userId,
      session.username,
      session.role,
      session.tokenVersion,
      body.remember === true ? REMEMBER_TTL_SECONDS : undefined,
    );
    parseIssue(token);
    setCookie(c, ACCESS_COOKIE, token, cookieOptions());
    c.header('x-login-next', '/');
    return c.json(
      ok({
        mustChangePassword: session.mustChangePassword,
        user: session.public,
      }),
    );
  });

  // 找回密码：三通道之二的自助入口（邮箱·短信）；管理员兜底走后台接口
  app.post('/api/auth/local/forgot', async (c) => {
    rateLimit(clientIp(c));
    const body = z
      .object({
        channel: z.enum(['EMAIL', 'SMS']),
        target: z.string().min(3).max(160),
      })
      .parse(await c.req.json());
    await module.account.requestPasswordReset(body.channel, body.target);
    return c.json(ok({ sent: true }, '重置信息已发送'));
  });

  app.post('/api/auth/local/reset', async (c) => {
    rateLimit(clientIp(c));
    const body = z
      .object({
        channel: z.enum(['EMAIL', 'SMS']),
        target: z.string().min(3).max(160),
        code: z.string().min(4).max(128),
        password: z.string().min(1).max(128),
      })
      .parse(await c.req.json());
    await module.account.resetPassword(body.channel, body.target, body.code, body.password);
    return c.json(ok({ reset: true }, '密码已重置，请用新密码登录'));
  });
}

/** 写 Cookie 前自验一次签名，避免签发异常令牌落到浏览器。 */
function parseIssue(token: string) {
  try {
    JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
  } catch {
    throw new BusinessException(ErrorCode.INTERNAL_ERROR, '会话签发失败');
  }
}

// ---------- 登录态路由（挂在 business，经过统一鉴权中间件） ----------

export function registerAccountBusinessRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: AccountModule,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  /** 统一信封应答：与全站 {code,message,data} 口径一致。 */
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  app.get('/enterprise/account/profile', async (c) =>
    json(c, await module.account.me(userOf(c))),
  );
  app.put('/enterprise/account/profile', async (c) => {
    const body = z
      .object({
        avatar: z.string().max(512).optional(),
        intro: z.string().max(500).optional(),
        lang: z.string().max(16).optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.account.updateProfile(userOf(c), body));
  });

  app.post('/enterprise/account/password', async (c) => {
    const body = z
      .object({ oldPassword: z.string().min(1), newPassword: z.string().min(1) })
      .parse(await c.req.json());
    const result = await module.account.changePassword(userOf(c), body.oldPassword, body.newPassword);
    // 换发新会话 Cookie：当前设备保持登录，其他设备旧会话被 tokenVersion 顶替失效。
    // 时长沿用当前令牌剩余寿命：30 天免登录会话改密后不被降级回默认时长。
    const keepTtl = tokenRemainingSeconds(
      getCookie(c, ACCESS_COOKIE) || c.req.header('authorization'),
    );
    const token = issueSsoSession(
      result.session.userId,
      result.session.username,
      result.session.role,
      result.session.tokenVersion,
      keepTtl > 0 ? keepTtl : undefined,
    );
    setCookie(c, ACCESS_COOKIE, token, cookieOptions());
    return json(c, { changed: result.changed });
  });

  app.get('/enterprise/account/login-logs', async (c) =>
    json(
      c,
      await module.account.loginLogs(userOf(c), Number(c.req.query('limit') || 20)),
    ),
  );

  // 我的邀请：邀请码（无码懒生成）+ 邀请人 + 已邀请人数
  app.get('/enterprise/account/invite', async (c) =>
    json(c, await module.account.inviteInfo(userOf(c))),
  );

  app.post('/enterprise/account/rebind-code', async (c) => {
    const body = z
      .object({ channel: z.enum(['EMAIL', 'SMS']), target: z.string().min(3).max(160) })
      .parse(await c.req.json());
    return json(c, await module.account.sendRebindCode(userOf(c), body.channel, body.target));
  });
  app.post('/enterprise/account/rebind', async (c) => {
    const body = z
      .object({
        channel: z.enum(['EMAIL', 'SMS']),
        target: z.string().min(3).max(160),
        code: z.string().min(4).max(128),
      })
      .parse(await c.req.json());
    return json(c, await module.account.confirmRebind(userOf(c), body.channel, body.target, body.code));
  });

  app.post('/enterprise/account/deactivate', async (c) =>
    json(c, await module.account.deactivate(userOf(c)), '账号已申请注销'),
  );

  // AIPDD APIKey 绑定（N:1）
  app.get('/enterprise/account/aipdd-key', async (c) =>
    json(c, await module.aipdd.status(userOf(c).userId)),
  );
  app.put('/enterprise/account/aipdd-key', async (c) => {
    const body = z.object({ key: z.string().min(8).max(200) }).parse(await c.req.json());
    return json(c, await module.aipdd.bind(userOf(c).userId, body.key), '绑定成功');
  });
  app.delete('/enterprise/account/aipdd-key', async (c) =>
    json(c, await module.aipdd.unbind(userOf(c).userId), '已解绑'),
  );

  // ---------- 平台管理员 ----------
  app.get('/enterprise/admin/account/settings', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.settings.maskedView());
  });
  app.put('/enterprise/admin/account/settings', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({
        registerModes: z.array(z.enum(['USERNAME', 'EMAIL', 'PHONE'])).optional(),
        smtp: z
          .object({
            host: z.string(),
            port: z.number().optional(),
            secure: z.boolean().optional(),
            user: z.string(),
            from: z.string(),
            password: z.string().optional(),
          })
          .optional(),
        sms: z
          .object({
            accessKeyId: z.string(),
            accessKeySecret: z.string().optional(),
            signName: z.string(),
            templateCode: z.string(),
            dailyLimit: z.number().optional(),
          })
          .optional(),
        policy: z
          .object({ cooldownDays: z.number().optional(), resetLinkBase: z.string().optional() })
          .optional(),
      })
      .parse(await c.req.json());
    if (body.smtp) await module.settings.saveSmtp(body.smtp);
    if (body.sms) await module.settings.saveSms(body.sms);
    if (body.policy) await module.settings.saveAccountPolicy(body.policy);
    if (body.registerModes) {
      await module.settings.saveRegisterModes(
        body.registerModes as RegisterMode[],
        (await module.settings.channelAvailability()) as Record<RegisterMode, boolean>,
      );
    }
    return json(c, await module.settings.maskedView(), '设置已保存');
  });

  // 平台级 AIPDD APIKey（基础数据通道：省市字典 / 平台字典项）：加密入库、只回掩码
  app.get('/enterprise/admin/account/aipdd-platform-key', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.aipdd.platformKeyView());
  });
  app.put('/enterprise/admin/account/aipdd-platform-key', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({ key: z.string().min(8).max(200) })
      .parse(await c.req.json());
    return json(
      c,
      await module.aipdd.savePlatformKey(userOf(c).userId, body.key),
      '平台 AIPDD APIKey 已保存',
    );
  });
  app.delete('/enterprise/admin/account/aipdd-platform-key', async (c) => {
    requireAdmin(userOf(c));
    return json(
      c,
      await module.aipdd.clearPlatformKey(userOf(c).userId),
      '平台 AIPDD APIKey 已清除',
    );
  });

  app.get('/enterprise/admin/account/users', async (c) => {
    requireAdmin(userOf(c));
    return json(
      c,
      await module.account.adminSearchUsers(
        userOf(c),
        c.req.query('keyword') || '',
        Number(c.req.query('limit') || 20),
      ),
    );
  });
  app.post('/enterprise/admin/account/users/:userId/reset-password', async (c) => {
    requireAdmin(userOf(c));
    return json(
      c,
      await module.account.adminResetPassword(userOf(c), c.req.param('userId')),
      '请把一次性新密码告知用户',
    );
  });
  app.post('/enterprise/admin/account/users/:userId/ban', async (c) => {
    requireAdmin(userOf(c));
    const body = z.object({ reason: z.string().max(255).default('') }).parse(await c.req.json().catch(() => ({})));
    return json(c, await module.account.adminSetStatus(userOf(c), c.req.param('userId'), 'BANNED', body.reason), '已封禁');
  });
  app.post('/enterprise/admin/account/users/:userId/unban', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.account.adminSetStatus(userOf(c), c.req.param('userId'), 'ACTIVE'), '已解封');
  });
}
