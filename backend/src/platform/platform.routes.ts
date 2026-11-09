import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import {
  SiteSettingsService,
  SUPPORTED_LANGUAGES,
} from './site-settings.service';
import {
  HomepageSettingsService,
  type HomepageSettings,
} from './homepage-settings.service';

export class PlatformModule {
  readonly site: SiteSettingsService;
  readonly homepage: HomepageSettingsService;

  constructor(services: Services) {
    this.site = new SiteSettingsService(services.prisma);
    this.homepage = new HomepageSettingsService(services.prisma);
  }
}

export function createPlatformModule(services: Services): PlatformModule {
  return new PlatformModule(services);
}

/** 公开路由（挂在根 app，与 /api/auth/* 同通道，不走业务鉴权）：前端 SSR 读取。 */
export function registerPlatformPublicRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: PlatformModule,
) {
  app.get('/api/site-config', async (c) =>
    c.json(ok(await module.site.view())),
  );
  // 官网首页（静态落地页）的可编辑内容：未登录也要能读，缺失时返回内置默认。
  app.get('/api/homepage', async (c) =>
    c.json(ok(await module.homepage.view())),
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
          .array(
            z.object({ label: z.string().max(64), url: z.string().max(512) }),
          )
          .max(20)
          .optional(),
        aipddReferralCode: z.string().max(64).optional(),
        hiddenMenuPaths: z.array(z.string().max(512)).max(128).optional(),
        // 业务服务板块页签显隐：token = `<板块>:<角色>`，白名单与归一化在 service 里做
        hiddenBoardTabs: z.array(z.string().max(64)).max(64).optional(),
        defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
        // 站点对外地址：宽松收进来（含空串＝清空），协议/域名合法性与归一化在 service 里做
        siteUrl: z.string().max(512).optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.site.save(body), '站点设置已保存');
  });

  // ---------- 首页设置（系统设置 → 首页设置页签） ----------
  app.get('/enterprise/admin/homepage', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.homepage.view());
  });
  app.put('/enterprise/admin/homepage', async (c) => {
    requireAdmin(userOf(c));
    // 逐字段归一化在 service 内完成（脏值回落默认），这里只收对象。
    const body = z
      .object({})
      .passthrough()
      .parse(await c.req.json()) as Partial<HomepageSettings>;
    return json(c, await module.homepage.save(body), '首页设置已保存');
  });
}
