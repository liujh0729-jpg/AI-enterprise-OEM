import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { upstreamTokenOrNull } from '../common/upstream-token';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { SiteSettingsService, SUPPORTED_LANGUAGES } from './site-settings.service';
import { ProviderDisplayService, type ProviderSyncMode } from './provider-display.service';

export class PlatformModule {
  readonly site: SiteSettingsService;
  readonly provider: ProviderDisplayService;

  constructor(services: Services) {
    this.site = new SiteSettingsService(services.prisma);
    this.provider = new ProviderDisplayService(services.prisma, new AiworkinClient());
  }
}

export function createPlatformModule(services: Services): PlatformModule {
  return new PlatformModule(services);
}

/** 公开路由（挂在根 app，与 /api/auth/* 同通道，不走业务鉴权）：前端 SSR 读取。 */
export function registerPlatformPublicRoutes(app: OpenAPIHono<ApiEnv>, module: PlatformModule) {
  app.get('/api/site-config', async (c) => c.json(ok(await module.site.view())));
  app.get('/api/providers/display', async (c) =>
    c.json(ok(await module.provider.listPublic())),
  );
}

/** 管理端路由（挂在 business，经统一鉴权中间件；全部要求平台管理员身份）。 */
export function registerPlatformAdminRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: PlatformModule,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  // ---------- 站点设置 ----------
  app.get('/enterprise/admin/site-settings', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.site.view());
  });
  app.put('/enterprise/admin/site-settings', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({
        siteName: z.string().max(120).optional(),
        siteLogo: z.string().max(512).optional(),
        siteDesc: z.string().max(500).optional(),
        icpRecord: z.string().max(128).optional(),
        footerLinks: z
          .array(z.object({ label: z.string().max(64), url: z.string().max(512) }))
          .max(20)
          .optional(),
        aipddReferralCode: z.string().max(64).optional(),
        businessMenuHidden: z.array(z.string().max(64)).max(32).optional(),
        integrationMenuHidden: z.array(z.string().max(64)).max(32).optional(),
        aiServicesHidden: z.boolean().optional(),
        defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
        // 站点对外地址：宽松收进来（含空串＝清空），协议/域名合法性与归一化在 service 里做
        siteUrl: z.string().max(512).optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.site.save(body), '站点设置已保存');
  });

  // ---------- 服务商展示与同步 ----------
  app.get('/enterprise/admin/providers/display', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.provider.listAdmin());
  });
  app.put('/enterprise/admin/providers/display/:id', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({
        visible: z.boolean().optional(),
        sortWeight: z.number().int().min(-10000).max(10000).optional(),
        adminNote: z.string().max(500).optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.provider.updateDisplay(Number(c.req.param('id')), body), '已更新');
  });
  app.get('/enterprise/admin/providers/sync-status', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.provider.status());
  });
  app.put('/enterprise/admin/providers/sync-mode', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({ mode: z.enum(['MANUAL', 'SCHEDULED']) })
      .parse(await c.req.json());
    return json(c, await module.provider.setSyncMode(body.mode as ProviderSyncMode), '同步策略已切换');
  });
  app.post('/enterprise/admin/providers/sync-now', async (c) => {
    requireAdmin(userOf(c));
    // 同步属尽力而为：管理员未绑定 Key 时不硬拒，而是走 service 的 SKIPPED 分支把原因回写后台。
    const token = await upstreamTokenOrNull(c);
    return json(c, await module.provider.syncNow(token), '已执行同步');
  });
}
