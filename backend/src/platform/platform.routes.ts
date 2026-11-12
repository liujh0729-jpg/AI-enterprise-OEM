import type { Context } from 'hono';
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { endpoints, z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { serializeResponse } from '../http/response';
import { errorResponse } from '../http/route-groups/common';
import {
  SiteSettingsService,
  SUPPORTED_LANGUAGES,
} from './site-settings.service';
import {
  HomepageSettingsService,
  type HomepageSettings,
} from './homepage-settings.service';
import { ExtensionEntryService } from './extension-entry.service';
import type { ExtensionCatalogService } from './extension-catalog.service';

export class PlatformModule {
  readonly site: SiteSettingsService;
  readonly homepage: HomepageSettingsService;
  readonly extension: ExtensionEntryService;
  readonly catalog: ExtensionCatalogService;

  constructor(services: Services) {
    this.site = new SiteSettingsService(services.prisma);
    this.homepage = new HomepageSettingsService(services.prisma);
    this.extension = new ExtensionEntryService(services.prisma, this.site);
    // 复用服务容器里的单例：派发链路（获客插件/分发）与后台管理必须看到同一份能力状态。
    this.catalog = services.extensionCatalog;
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

  // ---------- 顶部统一浏览器插件入口 ----------
  // 登录用户都能读；管理员关闭总开关或平台未发布插件包时 enabled=false，前台不渲染图标。
  app.get('/enterprise/extension/info', async (c) => {
    const forwardedProto = c.req
      .header('x-forwarded-proto')
      ?.split(',')[0]
      .trim();
    const forwardedHost = c.req
      .header('x-forwarded-host')
      ?.split(',')[0]
      .trim();
    const url = new URL(c.req.url);
    const proto = forwardedProto || url.protocol.replace(':', '');
    const host = forwardedHost || c.req.header('host') || url.host;
    return json(c, await module.extension.view(`${proto}://${host}`));
  });

  // ---------- 统一插件能力目录（§10.7） ----------
  // 登录用户可读：前端顶部入口、营销工具页与 MCP 读同一份能力清单 + 发布信息。
  {
    const endpoint = endpoints['Extension_catalog'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path,
        operationId: 'Extension_catalog',
        tags: ['Extension'],
        request: { params: endpoint.params, query: endpoint.query },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          500: errorResponse,
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            endpoint.response,
            ok(await module.catalog.catalog()),
          ),
          200,
        ),
    );
  }
  // 平台管理员维护单个能力的启用 / 灰度 / 强制升级 / 下线。
  {
    const endpoint = endpoints['Extension_capabilitySave'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Extension_capabilitySave',
        tags: ['Extension'],
        request: {
          params: endpoint.params,
          body: {
            required: true,
            content: { 'application/json': { schema: endpoint.body } },
          },
        },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          500: errorResponse,
        },
      }),
      async (c) => {
        const actor = userOf(c);
        requireAdmin(actor);
        const result = await module.catalog.save(
          c.req.valid('param').key,
          c.req.valid('json'),
          actor.userId,
        );
        return c.json(serializeResponse(endpoint.response, ok(result)), 200);
      },
    );
  }

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
        // 顶部统一 Chrome 插件入口总开关：关掉后所有用户都看不到入口图标
        extensionEntryEnabled: z.boolean().optional(),
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
