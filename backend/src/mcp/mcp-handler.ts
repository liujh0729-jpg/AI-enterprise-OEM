import {
  MCP_ERROR,
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_FALLBACKS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
  MCP_TOOL_NAMES,
  type McpToolName,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { mcpToolDescriptors, McpService } from './mcp.service';

/**
 * JSON-RPC 2.0 信封层：只管协议，不含任何业务判定。
 * 一次 HTTP 请求承载一条消息（不支持批量），通知类消息回 202 空响应体——这是 MCP 标准做法，
 * Codex / Claude Desktop / Cursor / 自研脚本都按这一套走。
 */

export type McpReply =
  { status: 202 } | { status: 200; payload: Record<string, unknown> };

const TOOL_DESCRIPTORS = mcpToolDescriptors();

function reply(
  id: string | number | undefined,
  result: Record<string, unknown>,
): McpReply {
  return {
    status: 200,
    payload: { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), result },
  };
}

function replyError(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
): McpReply {
  return {
    status: 200,
    payload: {
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      error: { code, message, ...(data === undefined ? {} : { data }) },
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

export async function handleMcpMessage(
  mcp: McpService,
  user: CurrentUser,
  requestId: string,
  message: unknown,
): Promise<McpReply> {
  if (Array.isArray(message))
    return replyError(
      undefined,
      MCP_ERROR.INVALID_REQUEST,
      '一次请求只接受一条 JSON-RPC 消息（不支持批量调用）',
    );
  if (!message || typeof message !== 'object')
    return replyError(
      undefined,
      MCP_ERROR.INVALID_REQUEST,
      '请求体必须是一条 JSON-RPC 2.0 消息对象',
    );
  const envelope = message as Record<string, unknown>;
  const id = messageId(envelope['id']);
  const method = envelope['method'];
  if (typeof method !== 'string' || !method)
    return replyError(id, MCP_ERROR.INVALID_REQUEST, '缺少 method 字段');
  const params =
    envelope['params'] && typeof envelope['params'] === 'object'
      ? (envelope['params'] as Record<string, unknown>)
      : {};

  // 通知（没有 id）不回业务响应，只回 202 空体，客户端不会等它。
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
          name: MCP_SERVER_NAME,
          title: MCP_SERVER_TITLE,
          version: MCP_SERVER_VERSION,
        },
        instructions: MCP_INSTRUCTIONS,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOL_DESCRIPTORS });
    case 'tools/call':
      return callTool(mcp, user, requestId, id, params);
    default:
      return replyError(
        id,
        MCP_ERROR.METHOD_NOT_FOUND,
        `本服务端不支持的方法：${method}`,
      );
  }
}

async function callTool(
  mcp: McpService,
  user: CurrentUser,
  requestId: string,
  id: string | number,
  params: Record<string, unknown>,
): Promise<McpReply> {
  const name = params['name'];
  if (typeof name !== 'string' || !name)
    return replyError(id, MCP_ERROR.INVALID_PARAMS, 'tools/call 缺少 name');
  if (!MCP_TOOL_NAMES.includes(name as McpToolName))
    return replyError(
      id,
      MCP_ERROR.INVALID_PARAMS,
      `未知的工具：${name}。可用工具：${MCP_TOOL_NAMES.join('、')}`,
    );
  const args = params['arguments'] ?? params['args'];
  const result = await mcp.callTool(user, requestId, name, args);
  return reply(id, result);
}
