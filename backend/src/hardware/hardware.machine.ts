import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  HW_MCP_ENDPOINT_PATH,
  HW_MCP_INSTRUCTIONS,
  HW_MCP_SERVER_NAME,
  HW_MCP_SERVER_TITLE,
  HW_MCP_SERVER_VERSION,
  MCP_ERROR,
  MCP_PROTOCOL_FALLBACKS,
  MCP_PROTOCOL_VERSION,
} from '@enterprise/contracts';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { asObject, asString, optionalId, toolNameOf } from './hardware.helpers';
import type { HardwareService } from './hardware.service';

/**
 * 硬件对外通道，与平台 MCP / 业务 REST 完全分开：
 * · REST：`/api/v1/hardware/**`，复用机器通道的 `ek_` Key 鉴权（business 中间件已做）；
 * · MCP：`POST /api/v1/hardware/mcp`，独立 JSON-RPC 端点，工具命名 `hw__<型号>__<工具>`。
 * 两者都挂在 business 上，继承同一套 Key 校验、功能开关与审计；设备通道另走根 app 的公开路由。
 */

type JsonRpcReply =
  { status: 202 } | { status: 200; payload: Record<string, unknown> };

function reply(
  id: string | number | undefined,
  result: Record<string, unknown>,
): JsonRpcReply {
  return {
    status: 200,
    payload: { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), result },
  };
}

function replyError(
  id: string | number | undefined,
  code: number,
  message: string,
): JsonRpcReply {
  return {
    status: 200,
    payload: {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      error: { code, message },
    },
  };
}

function messageId(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
}

function negotiateProtocol(params: Record<string, unknown>): string {
  const requested = params['protocolVersion'];
  if (typeof requested !== 'string') return MCP_PROTOCOL_VERSION;
  if (requested === MCP_PROTOCOL_VERSION) return requested;
  return (MCP_PROTOCOL_FALLBACKS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

/** 硬件 MCP 的 JSON-RPC 信封层：只管协议，业务判定都在 HardwareService。 */
async function handleHardwareMcpMessage(
  hardware: HardwareService,
  user: CurrentUser,
  message: unknown,
): Promise<JsonRpcReply> {
  if (Array.isArray(message)) {
    return replyError(
      undefined,
      MCP_ERROR.INVALID_REQUEST,
      '一次请求只接受一条 JSON-RPC 消息（不支持批量调用）',
    );
  }
  if (!message || typeof message !== 'object') {
    return replyError(
      undefined,
      MCP_ERROR.INVALID_REQUEST,
      '请求体必须是一条 JSON-RPC 2.0 消息对象',
    );
  }
  const envelope = message as Record<string, unknown>;
  const id = messageId(envelope['id']);
  const method = envelope['method'];
  if (typeof method !== 'string' || !method)
    return replyError(id, MCP_ERROR.INVALID_REQUEST, '缺少 method 字段');
  const params =
    envelope['params'] && typeof envelope['params'] === 'object'
      ? (envelope['params'] as Record<string, unknown>)
      : {};

  if (id === undefined) {
    if (method.startsWith('notifications/')) return { status: 202 };
    return replyError(
      undefined,
      MCP_ERROR.INVALID_REQUEST,
      `${method} 需要带 id`,
    );
  }

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: negotiateProtocol(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: HW_MCP_SERVER_NAME,
          title: HW_MCP_SERVER_TITLE,
          version: HW_MCP_SERVER_VERSION,
        },
        instructions: HW_MCP_INSTRUCTIONS,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: await hardware.mcpDescriptors(user.userId) });
    case 'tools/call': {
      const name = params['name'];
      if (typeof name !== 'string' || !name)
        return replyError(id, MCP_ERROR.INVALID_PARAMS, 'tools/call 缺少 name');
      const args = params['arguments'] ?? params['args'];
      return reply(id, await hardware.mcpCall(user.userId, name, args));
    }
    default:
      return replyError(
        id,
        MCP_ERROR.METHOD_NOT_FOUND,
        `本服务端不支持的方法：${method}`,
      );
  }
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message } };
}

/** 统一信封：与站内 REST 同口径，机器通道调用方按 code 判成败。 */
function envelope(data: unknown) {
  return { code: 0, message: 'ok', data };
}

export function registerHardwareMachineRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const hardware = services.hardware;
  const userOf = (c: Context<ApiEnv>) => c.get('user')!;

  // ---- MCP：独立端点，故意不声明请求体，解析失败按标准回 -32700 ----
  app.post(HW_MCP_ENDPOINT_PATH, async (c) => {
    const raw = await c.req.text();
    let message: unknown;
    try {
      message = raw ? JSON.parse(raw) : undefined;
    } catch {
      return c.json(jsonRpcError(MCP_ERROR.PARSE, '请求体不是合法 JSON'), 200);
    }
    const result = await handleHardwareMcpMessage(hardware, userOf(c), message);
    if (result.status === 202) return new Response(null, { status: 202 });
    return c.json(result.payload, 200);
  });

  // ---- REST 机器通道 ----
  app.get('/api/v1/hardware/models', async (c) => {
    return c.json(envelope(await hardware.plazaModels(userOf(c).userId, {})));
  });

  app.get('/api/v1/hardware/models/:code/tools', async (c) => {
    const code = c.req.param('code');
    return c.json(envelope(await hardware.tools(userOf(c).userId, code, {})));
  });

  app.post('/api/v1/hardware/tools/:code/call', async (c) => {
    const code = c.req.param('code');
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const toolCode = asString(body.toolCode, 64);
    if (!toolCode)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少 toolCode');
    const result = await hardware.callByName({
      userId: userOf(c).userId,
      name: toolNameOf(code, toolCode),
      args: asObject(body.args),
      deviceId: optionalId(body.deviceId),
      source: 'machine',
      dryRun: body.dryRun === true,
    });
    return c.json(envelope(result));
  });
}
