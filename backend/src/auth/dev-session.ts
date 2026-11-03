import type { OpenAPIHono } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { safeNextPath } from '@enterprise/contracts';
import { issueSsoSession } from './token';
import type { ApiEnv } from '../http/types';
import type { AccountModule } from '../account/account.routes';

/**
 * 开发态免密登录：只签发本地账户体系的自签会话（issueSsoSession），
 * 账号必须已存在于本地 users 表（如 seed-admin 创建的管理员）；production 代码级禁用。
 */
export function registerDevSessionRoutes(
  app: OpenAPIHono<ApiEnv>,
  account: AccountModule,
) {
  const enabled = () =>
    process.env.DEV_AUTO_LOGIN === 'true' &&
    process.env.NODE_ENV !== 'production';
  app.get('/api/dev/accounts', async (c) => {
    if (!enabled())
      return c.json({ code: 404, message: '接口不存在', data: null }, 404);
    const rows = await account.account.listActiveForDev();
    return c.json({ code: 0, message: 'ok', data: rows });
  });
  app.get('/api/dev/session', async (c) => {
    if (!enabled())
      return c.json({ code: 404, message: '接口不存在', data: null }, 404);
    const username =
      c.req.query('as') || process.env.DEV_SESSION_USER || 'admin';
    const session = await account.account.devSession(username);
    if (!session)
      return c.json(
        { code: 400, message: '开发账号不存在或已停用（需先存在于本地账户表）', data: null },
        400,
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
      maxAge: 43200,
    });
    return c.redirect(safeNextPath(c.req.query('next')), 303);
  });
}
