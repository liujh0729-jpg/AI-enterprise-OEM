import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  MCP_ERROR,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  mcpEndpoints,
} from '@enterprise/contracts';
import { handleMcpMessage } from './mcp-handler';
import { McpService } from './mcp.service';
import type { Services } from '../http/services';
import type { ApiEnv } from '../http/types';

/**
 * 全站唯一的 MCP 入口：`POST /api/v1/mcp`。
 * 与 REST 同前缀、同一把 `ek_` Key（`x-api-key` 或 `Authorization: Bearer` 都行），
 * 鉴权、审计、身份口径都复用机器通道那一套，不建第二套。
 *
 * 这里**故意不向契约声明请求体**：JSON-RPC 的解析失败要按标准回 `-32700`，
 * 而不是被套进本站统一的 422 信封；响应体同样由服务端自己拼装。
 */
export function registerMcpRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
  shared?: McpService,
) {
  const definition = mcpEndpoints.Mcp_handle;
  const mcp = shared ?? new McpService(services);
  app.openapi(
    createRoute({
      method: 'post',
      path: definition.path,
      operationId: 'Mcp_handle',
      tags: ['Mcp'],
      description: `MCP Server（${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}）：JSON-RPC 2.0，支持 initialize / ping / tools/list / tools/call。`,
      request: { params: definition.params, query: definition.query },
      responses: {
        200: {
          description: 'JSON-RPC 2.0 响应',
          content: { 'application/json': { schema: definition.response } },
        },
        202: { description: '通知类消息已接收，无响应体' },
      },
    }),
    async (context) => {
      const raw = await context.req.text();
      let message: unknown;
      try {
        message = raw ? JSON.parse(raw) : undefined;
      } catch {
        return context.json(
          jsonRpcError(MCP_ERROR.PARSE, '请求体不是合法 JSON') as never,
          200,
        );
      }
      const reply = await handleMcpMessage(
        mcp,
        context.get('user')!,
        context.get('requestId') ?? '',
        message,
      );
      if (reply.status === 202) return new Response(null, { status: 202 });
      return context.json(reply.payload as never, 200);
    },
  );
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message } };
}
