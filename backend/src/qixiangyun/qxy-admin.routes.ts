import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import { QxySettingsService } from './qxy-settings.service';

/**
 * 平台管理后台「财税管理」：企享云报税 API Key 账号池与税号匹配。
 * 多账号、到期提醒、每账号最多 5 个税号：开源版本地能力，未纳入统一 contracts
 * 生成表，直接挂 Hono 路由（与平台站点设置同范式）。
 */
export function registerQxyAdminRoutes(
  app: OpenAPIHono<ApiEnv>,
  settings: QxySettingsService,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    requireAdmin(user);
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  app.get('/enterprise/admin/qxy-accounts', async (c) =>
    json(c, await settings.list(userOf(c))),
  );

  app.put('/enterprise/admin/qxy-accounts', async (c) => {
    const user = userOf(c);
    const body = z
      .object({
        id: z.string().max(64).optional(),
        label: z.string().max(60).optional(),
        appkey: z.string().max(4096).optional(),
        secret: z.string().max(4096).optional(),
        expiresAt: z.string().max(10).optional(),
        taxNos: z.array(z.string().max(32)).max(20).optional(),
      })
      .parse(await c.req.json());
    return json(c, await settings.save(user, body), '账号已保存');
  });

  app.delete('/enterprise/admin/qxy-accounts/:id', async (c) =>
    json(c, await settings.remove(userOf(c), c.req.param('id')), '账号已删除'),
  );

  app.post('/enterprise/admin/qxy-accounts/:id/tax-nos', async (c) => {
    const user = userOf(c);
    const body = z
      .object({ taxNo: z.string().max(32) })
      .parse(await c.req.json());
    return json(
      c,
      await settings.bind(user, c.req.param('id'), body.taxNo),
      '税号已匹配',
    );
  });

  app.delete('/enterprise/admin/qxy-accounts/:id/tax-nos/:taxNo', async (c) =>
    json(
      c,
      await settings.unbind(userOf(c), c.req.param('id'), c.req.param('taxNo')),
      '税号已解除',
    ),
  );
}
