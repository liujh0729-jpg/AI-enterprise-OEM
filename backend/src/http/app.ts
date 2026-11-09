import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import { MCP_ENDPOINT_PATH, endpoints } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { runInRequestContext, currentRequest } from '../common/request-context';
import { resolveSiteUrl } from '../common/site-url';
import { AuthService } from '../auth/auth.service';
import {
  registerUpstreamTokenResolver,
  registerBaseDataTokenResolver,
} from '../common/upstream-token';
import { registerSessionRoutes, sessionToken } from '../auth/session';
import { registerDevSessionRoutes } from '../auth/dev-session';
import {
  createAccountModule,
  registerAccountBusinessRoutes,
  registerAccountRoutes,
} from '../account/account.routes';
import {
  createPlatformModule,
  registerPlatformAdminRoutes,
  registerPlatformPublicRoutes,
} from '../platform/platform.routes';
import {
  createSocialModule,
  registerSocialRoutes,
} from '../social/social.routes';
import { registerQxyAdminRoutes } from '../qixiangyun/qxy-admin.routes';
import { registerCapabilityAdminRoutes } from '../capability/capability-admin.routes';
import {
  createPointsModule,
  registerPointsRoutes,
  registerPointsPublicRoutes,
} from '../points/points.routes';
import {
  createListingModule,
  registerListingRoutes,
} from '../social/listing.routes';
import {
  createHiringModule,
  registerHiringRoutes,
} from '../social/hiring.routes';
import { registerRoutes } from './routes';
import { registerAutomationRoutes } from './automation-routes';
import { featureGateMiddleware } from '../feature/feature-gate.middleware';
import { publishReviewMiddleware } from '../moderation/publish-review.middleware';
import { registerPublishReviewRoutes } from '../moderation/publish-review.routes';
import { registerMcpRoutes } from '../mcp/mcp-routes';
import { registerLivecodePublic } from '../livecode/livecode.public';
import { registerServiceDeskPublic } from '../service-desk/service-desk.public';
import { registerSurveyPublic } from '../survey/survey.public';
import { registerMechanismPublic } from '../mechanisms/mechanism.public';
import { registerScrmPublic } from '../wecom-scrm/scrm-callback';
import { registerScrmSidebarPublic } from '../wecom-scrm/scrm-sidebar.service';
import { registerGapsPublic } from '../gaps/gaps.public';
import { registerModelPlazaPublic } from '../model-plaza/model-plaza.public';
import { registerHardwarePublic } from '../hardware/hardware.public';
import { registerHardwareMachineRoutes } from '../hardware/hardware.machine';
import { McpService } from '../mcp/mcp.service';
import { handleError, validationHook } from './error-handler';
import { bearerApiKey } from '../mcp/mcp-auth';
import { agentIntentMiddleware } from '../agent-memory/agent-memory.middleware';
import type { Services } from './services';
import type { Context, Input } from 'hono';
import type { ApiEnv } from './types';

export function canonicalPath(path: string) {
  return path.replace(/^\/api\/backend(?=\/|$)/, '') || '/';
}
export function requestBodyLimit(path: string) {
  const canonical = canonicalPath(path).replace(/\/+$/, '');
  if (
    canonical === '/enterprise/identity/provider-application/attachments' ||
    canonical === '/enterprise/flex/onboardings/attachments'
  )
    return 16 * 1024 * 1024;
  // 内容创作的素材上传走 AIPDD 数字资产云中转，图片/视频单件上限 100MB
  if (canonical === '/enterprise/content/uploads') return 100 * 1024 * 1024;
  // 创意社区运行表单的输入图：Comfy Cloud 对 >50MiB 的图片输入直接拒收，取到 50MB 即可
  if (canonical === '/enterprise/community/uploads') return 50 * 1024 * 1024;
  return 12 * 1024 * 1024;
}
/**
 * 来源校验：白名单 + 管理员配置的站点域名 + 同源（Origin 主机 = X-Forwarded-Host/Host）始终放行；
 * 开发态再放宽 loopback 与内网来源，生产不放宽，避免削弱 CSRF 防护。
 */
function originAllowed(
  origin: string | undefined,
  origins: string[],
  hosts: (string | undefined)[] = [],
  siteOrigin = '',
) {
  if (!origin) return false;
  if (origins.includes(origin)) return true;
  // 站点域名在后台改过就立刻生效，不必回来重启或改环境变量
  if (siteOrigin && origin === siteOrigin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // 同源放行：Next/Nginx 转发时 Origin 与原始 Host 一致（局域网 IP、预览域名都适用）
    if (hosts.some((host) => host && host.split(',')[0].trim() === url.host)) {
      return true;
    }
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENTERPRISE_ENV === 'production'
    ) {
      return false;
    }
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
      return true;
    }
    // 开发态还会用局域网 / Tailscale / .local 访问前端，放行这些内网来源
    if (/\.local$/i.test(url.hostname)) return true;
    const parts = url.hostname.split('.').map((item) => Number(item));
    if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item))) {
      return false;
    }
    const [a, b] = parts;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  } catch {
    return false;
  }
}

export function createApp(services: Services) {
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: validationHook });
  // 开源版本地账户模块：先于 AuthService 构建，自签会话的封禁/改密失效核对依赖它。
  const account = createAccountModule(services);
  // M3 上游通道改造：全系统访问 AIworkin 的凭证统一换成用户绑定的 AIPDD Key（设计 3.3）。
  registerUpstreamTokenResolver((userId) => account.aipdd.resolveToken(userId));
  // 基础数据通道（省市字典、平台字典项）：平台 Key 优先，未配置回落用户 Key。
  registerBaseDataTokenResolver((userId) =>
    account.aipdd.baseDataToken(userId),
  );
  // M4 平台后台：站点设置（前端 SSR 读取）。
  const platform = createPlatformModule(services);
  // 积分与充值：复用 services.ts 已构造的积分域实例，仅负责路由组装。
  const points = createPointsModule(services);
  // M5 社交板块：把原 NestJS SNS 的关系/动态/小组/私信/简历本地化进 Hono（直连 sns_ 表）。
  const social = createSocialModule(services);
  // M6 供求广场：社交板通用发布需求/服务，本地免 Key + 勾选同步 AIworkin（复用上游通道）。
  const listing = createListingModule(services);
  // 商务人脉·招聘：岗位本地免 Key 发布进招聘广场，勾选则同步为 AIworkin 用工需求（同一上游通道）。
  const hiring = createHiringModule(services);
  const auth = new AuthService(
    services.prisma,
    services.users,
    account.account,
  );
  const origins = (
    process.env.CORS_ORIGIN_PATTERNS ||
    'http://localhost:15890,http://127.0.0.1:15890'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use('*', (c, next) => {
    const started = Date.now(),
      requestId = randomUUID();
    return runInRequestContext(
      async () => {
        c.set('requestId', requestId);
        c.header('X-Request-Id', requestId);
        await next();
        if (process.env.NODE_ENV !== 'test')
          console.info(
            JSON.stringify({
              event: 'http',
              requestId,
              method: c.req.method,
              route: c.req.routePath,
              status: c.res.status,
              elapsedMs: Date.now() - started,
              ...currentRequest()?.metrics,
              memoryRss: process.memoryUsage().rss,
              sqlQueriesTotal: services.prisma.databaseMetrics.queryCount,
              sqlMsTotal: services.prisma.databaseMetrics.queryMs,
            }),
          );
      },
      { requestId, signal: c.req.raw.signal },
    );
  });
  app.use(
    '*',
    cors({
      origin: async (origin) =>
        originAllowed(
          origin,
          origins,
          [],
          await resolveSiteUrl(services.prisma),
        )
          ? origin
          : undefined,
      credentials: true,
      exposeHeaders: ['X-Request-Id', 'X-Login-Next'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Api-Key',
        'Idempotency-Key',
        'X-Locale',
      ],
    }),
  );
  app.use('*', async (c: Context<ApiEnv, string, Input>, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      (c.req.header('cookie') || c.req.path.startsWith('/api/auth/'))
    ) {
      const origin = c.req.header('origin');
      if (
        !originAllowed(
          origin,
          origins,
          [c.req.header('x-forwarded-host'), c.req.header('host')],
          await resolveSiteUrl(services.prisma),
        )
      ) {
        console.warn(
          JSON.stringify({
            event: 'origin_rejected',
            method: c.req.method,
            path: c.req.path,
            origin,
            host: c.req.header('host'),
            forwardedHost: c.req.header('x-forwarded-host'),
          }),
        );
        throw new BusinessException(ErrorCode.FORBIDDEN, '请求来源未通过校验');
      }
    }
    return bodyLimit({
      maxSize: requestBodyLimit(c.req.path),
      onError: () => {
        throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
      },
    })(c, next);
  });
  registerSessionRoutes(app, account);
  registerAccountRoutes(app, account);
  registerDevSessionRoutes(app, account);
  registerPlatformPublicRoutes(app, platform);
  // 微信支付回调：公开、免登录、不走统一信封，按微信规范原样应答。
  registerPointsPublicRoutes(app, points);
  const business = new OpenAPIHono<ApiEnv>({ defaultHook: validationHook });
  business.onError(handleError);
  business.use('*', async (c: Context<ApiEnv, string, Input>, next) => {
    const path = canonicalPath(c.req.path);
    const apiKey =
      c.req.header('x-api-key') ?? bearerApiKey(c.req.header('authorization'));
    const token =
      apiKey && path.startsWith('/api/v1/') ? undefined : sessionToken(c);
    c.set('accessToken', token);
    c.set('user', await auth.authenticate(c.req.method, path, token, apiKey));
    await next();
  });
  // 意图中间件在鉴权之后、业务路由之前：全站写请求只在这一处进记忆，业务服务不各自埋点。
  business.use('*', agentIntentMiddleware(services.agentMemory));
  // §5.10 功能开关拦截：鉴权后、路由前，菜单隐藏的板块直链/MCP 转发同口径 403 FEATURE_CLOSED；
  // 平台管理/认证会话/账户计费/合规退出四组 protected 前缀在中间件内部直接跳过。
  business.use('*', featureGateMiddleware(services.feature.toggle));
  // 发布审核：鉴权与功能开关之后、业务路由之前，按路径拦截发帖 / 简历 / 需求 / 服务发布。
  business.use('*', publishReviewMiddleware(services.publishReview));
  registerRoutes(business, services);
  registerAccountBusinessRoutes(business, account, (user) =>
    services.identity.requireAdmin(user),
  );
  registerPlatformAdminRoutes(business, platform, (user) =>
    services.identity.requireAdmin(user),
  );
  // 平台「财税管理」：企享云报税 API Key 账号池与税号匹配（命令式路由，不进 contracts）。
  registerQxyAdminRoutes(business, services.qxySettings, (user) =>
    services.identity.requireAdmin(user),
  );
  // 平台「财税管理 · 已开通」：OPEN 能力清单（开通时间 / 匹配账号）。
  registerCapabilityAdminRoutes(business, services.capability, (user) =>
    services.identity.requireAdmin(user),
  );
  // 积分中心（用户侧）+ 积分与充值管理（后台）：统一 requireAdmin 注入。
  registerPointsRoutes(business, points, (user) =>
    services.identity.requireAdmin(user),
  );
  // L0 平台治理（§5.9/§5.10/§5.12）由契约 moduleHandlers 注册（Platform_/Points_），
  // 菜单对登录用户开放，其余管理端动作在控制器内统一 requireAdmin。
  // 发布审核（阿里云内容安全）：配置、测试与拦截台账，平台管理员专属。
  registerPublishReviewRoutes(business, services.publishReview, (user) =>
    services.identity.requireAdmin(user),
  );
  // L1 知识库底座（§10）由契约 moduleHandlers 注册（Kb_*），可见性闸在服务内部收口。
  // M5 社交路由挂 business：继承统一鉴权与平台级封禁即时拦截，无需各自判重。
  registerSocialRoutes(business, social);
  registerListingRoutes(business, listing);
  registerHiringRoutes(business, hiring);
  registerAutomationRoutes(business, services);
  // 外部 MCP 端点与 Agent 的「本站 MCP Server」连接器共用同一个服务实例、同一条授权闸。
  const mcpService = new McpService(services);
  services.builtinMcp.current = (user, requestId, name, args) =>
    mcpService.callTool(user, requestId, name, args);
  registerMcpRoutes(business, services, mcpService);
  // 智能硬件对外通道：REST `/api/v1/hardware/**` 与独立 MCP `/api/v1/hardware/mcp`，
  // 与平台 MCP 各自一套；继承 business 的 ek_ Key 鉴权、功能开关与审计。
  registerHardwareMachineRoutes(business, services);
  // IM 连接事件回调（飞书 / 企业微信）：原样回挑战值，不经契约层信封。
  business.post('/enterprise/im/events/:provider/:token', async (c) => {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => undefined);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ code: 400, message: 'invalid payload' }, 400);
    }
    try {
      const result = await services.controllers.imController.handleEvent(
        c.req.param('provider').toLowerCase(),
        c.req.param('token'),
        body,
      );
      return c.json(result);
    } catch (error) {
      const message =
        error instanceof BusinessException ? error.message : 'invalid event';
      const status =
        error instanceof BusinessException ? error.getStatus() : 400;
      return c.json({ code: status, message }, status);
    }
  });
  // 飞书事件订阅回调：飞书要求原样返回 { challenge }，所以不经契约层的统一信封。
  business.post('/enterprise/feishu/events/:token', async (c) => {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => undefined);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ code: 400, message: 'invalid payload' }, 400);
    }
    const result =
      await services.controllers.dataTableFeishuController.handleEvent(
        c.req.param('token'),
        body,
      );
    return c.json(result);
  });
  // Agent 助理的第三方回调：各平台要求的应答格式不同（空串 / success / {code:0} / 204），
  // 所以和飞书事件一样原样返回，不经契约层的统一信封。
  business.all('/enterprise/agent/assistant/:token', async (c) => {
    const method = c.req.method === 'GET' ? 'GET' : 'POST';
    const query: Record<string, string> = {};
    new URL(c.req.url).searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const result =
      await services.controllers.contentController.handleAssistantCallback(
        c.req.param('token'),
        {
          method,
          query,
          rawBody: method === 'POST' ? await c.req.text() : '',
          headers: {
            timestamp: c.req.header('timestamp') || '',
            sign: c.req.header('sign') || '',
            authorization: c.req.header('authorization') || '',
            'content-type': c.req.header('content-type') || '',
          },
        },
      );
    return c.body(result.body, result.status as 200, {
      'content-type': result.contentType || 'text/plain; charset=utf-8',
    });
  });
  app.get('/api/openapi.json', (c) => {
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'AIworkin Enterprise API', version: '1.0.0' },
    });
    for (const path of Object.keys(document.paths || {})) {
      if (path.startsWith('/api/backend/api/v1/')) {
        document.paths[path.replace('/api/backend', '')] = document.paths[path];
        delete document.paths[path];
      }
    }
    return c.json(document);
  });
  app.route('/api/backend', business);
  // Legacy service-to-service URLs share handlers but do not duplicate OpenAPI operation IDs.
  for (const endpoint of Object.values(endpoints)) {
    app.on(endpoint.method.toUpperCase(), endpoint.path, (c) =>
      business.fetch(c.req.raw),
    );
  }
  app.post('/enterprise/feishu/events/:token', (c) =>
    business.fetch(c.req.raw),
  );
  app.all('/enterprise/agent/assistant/:token', (c) =>
    business.fetch(c.req.raw),
  );
  // MCP 端点不在统一信封的 `endpoints` 表里（它按 JSON-RPC 自成一格），所以单独转发一次。
  app.post(MCP_ENDPOINT_PATH, (c) => business.fetch(c.req.raw));
  // 硬件机器通道（含独立 MCP 端点）也不在契约表里，整段前缀转发给 business 走 Key 鉴权。
  app.all('/api/v1/hardware/*', (c) => business.fetch(c.req.raw));
  // 活码落地页 / 官网脚本 / 访客客服通道：公开、免登录，不走统一信封
  registerLivecodePublic(app, services);
  registerServiceDeskPublic(app, services);
  registerSurveyPublic(app, services);
  // 资产公开分享与 OIDC 外部身份源回跳：免登录，路径带 /api/public 前缀。
  registerMechanismPublic(app, services);
  // 企微事件回调（安全模式验签）与员工侧边栏 H5：免登录，靠密钥/票据自证。
  registerScrmPublic(app, services);
  registerScrmSidebarPublic(app, services);
  // 附录 B 公开通道：预约 / 报价 PDF / 条款正文，路径带 /api/public 前缀。
  registerGapsPublic(app, services);
  // 模型广场对外网关：OpenAI 兼容的 /v1/*，自带 Key 鉴权与积分结算，不走统一信封。
  registerModelPlazaPublic(app, services);
  // 智能硬件设备通道：/api/public/hardware/**，只认设备令牌，免登录、不进功能开关（关板块不掐心跳）。
  registerHardwarePublic(app, services);
  app.notFound((c) =>
    c.json({ code: 404, message: '接口不存在', data: null }, 404),
  );
  app.onError(handleError);
  return app;
}
