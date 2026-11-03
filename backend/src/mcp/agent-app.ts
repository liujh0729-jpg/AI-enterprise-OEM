import { OpenAPIHono } from '@hono/zod-openapi';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { agentIntentMiddleware } from '../agent-memory/agent-memory.middleware';
import { registerRoutes } from '../http/routes';
import { registerAutomationRoutes } from '../http/automation-routes';
import { handleError, validationHook } from '../http/error-handler';
import { currentAgentCall } from './agent-context';
import type { Services } from '../http/services';
import type { ApiEnv } from '../http/types';

/**
 * 智能体的内部自执行器：一张**从不挂载对外端口**的路由表。
 * MCP 的 `read_data` / `write_data` 在它上面跑，走的是和浏览器完全相同的 handler 与校验，
 * 所以外部客户端能做的事＝这个账号在界面上能做的事，不存在第二套业务口径。
 *
 * 身份只从 `AsyncLocalStorage` 取（由 MCP 端点在鉴权后写入），不读任何请求头：
 * 内部路由表即便被误挂到公网，也没法靠伪造头拿到别人的账号。
 * 身份形状与机器通道一致（`role='user'`），所以平台管理后台接口在这里同样调不到。
 */
export function createAgentApp(services: Services) {
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: validationHook });
  app.onError(handleError);
  app.use('*', async (c, next) => {
    const call = currentAgentCall();
    if (!call)
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '内部执行器只能由 MCP 端点在鉴权后调用',
      );
    c.set('requestId', call.requestId);
    c.set('user', call.user);
    // 与机器通道同口径：不代持上游平台的会话令牌。
    c.set('accessToken', '');
    await next();
  });
  // 执行一次就进一次记忆，通道标 mcp；业务服务本身不感知 MCP 的存在。
  app.use('*', agentIntentMiddleware(services.agentMemory, { channel: 'mcp' }));
  registerRoutes(app, services);
  registerAutomationRoutes(app, services);
  // 未命中路由也要回本站统一的 JSON 信封，执行器才好把理由原样交给客户端。
  app.notFound((c) =>
    c.json({ code: 404, message: '该接口不对智能体开放', data: null }, 404),
  );
  return app;
}
