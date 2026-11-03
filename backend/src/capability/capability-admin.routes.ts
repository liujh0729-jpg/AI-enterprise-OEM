import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import { CapabilityService } from './capability.service';

/**
 * 平台管理后台「财税管理 · 已开通」：按能力维度列出 OPEN 记录（开通时间 / 匹配账号），
 * 并承载企业维度的「关闭」操作（原「企业能力开通」矩阵已并入财税管理）；
 * 本页是财税管理的第三个页签，开源版本地能力，直接挂 Hono 路由（不进 contracts 生成表）。
 */
export function registerCapabilityAdminRoutes(
  app: OpenAPIHono<ApiEnv>,
  capability: CapabilityService,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    requireAdmin(user);
    return user;
  };
  const positive = (value: unknown, fallback: number, max: number) => {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.min(Math.floor(number), max);
  };

  app.get('/enterprise/admin/capability-opened', async (c) => {
    userOf(c);
    const page = positive(c.req.query('page'), 1, 10000);
    const pageSize = positive(c.req.query('pageSize'), 20, 50);
    return c.json(ok(await capability.openedPage(page, pageSize)));
  });
}
