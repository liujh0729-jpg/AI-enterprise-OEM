import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../http/types';
import { PROTECTED_PATH_PREFIXES } from './feature-catalog.data';
import type { FeatureToggleService } from './feature-toggle.service';

/** 与 app.ts canonicalPath 同规则：去掉内部转发前缀后再匹配（不能反向 import app，避免环依赖）。 */
const stripBackend = (path: string) =>
  path.replace(/^\/api\/backend(?=\/|$)/, '') || '/';

/**
 * 功能开关拦截中间件（§5.10）：挂在统一鉴权之后、业务路由之前。
 * - 未登录（公开回调 / 免登录通道）不判：鉴权层自会处理；
 * - protected 基础设施前缀直接跳过（认证会话/平台管理自身/账户计费/合规退出永不拦截）；
 * - /api/v1 开放接口与 MCP 的工具级收口在断言服务里按同一 code 前缀映射走 assertFeatureOpen。
 */
export function featureGateMiddleware(
  feature: FeatureToggleService,
): MiddlewareHandler<ApiEnv> {
  return async (c: Context<ApiEnv>, next) => {
    const user = c.get('user');
    if (!user) return next();
    const path = stripBackend(c.req.path);
    if (
      PROTECTED_PATH_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
    ) {
      return next();
    }
    await feature.assertFeatureOpen(path, user.userId);
    return next();
  };
}
