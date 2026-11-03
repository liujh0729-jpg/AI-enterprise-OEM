import { MCP_ENDPOINT_PATH } from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AgentMcpCrypto } from './agent-mcp-crypto';
import {
  McpClient,
  McpClientError,
  type McpRemoteTool,
  type McpTransport,
} from './agent-mcp.client';
import { mcpToolDescriptors } from '../mcp/mcp.service';
import { runAsAgent } from '../mcp/agent-context';
import { currentAgentScope } from './agent-scope';

const NAME_MAX = 60;
const URL_MAX = 500;
const HEADER_LINES_MAX = 20;
const HEADER_VALUE_MAX = 2000;
const ERROR_TEXT_MAX = 300;
const TOOL_CACHE_MS = 5 * 60 * 1000;
const MAX_CONNECTORS = 20;
const MAX_TOOLS_PER_CONNECTOR = 40;
const MAX_TOTAL_TOOLS = 46;

const BUILTIN_NAME = '本站 MCP Server';

/** 本站 MCP Server 由 app 组装完成后回填：它需要完整的 Services 对象，不能在建服务时直接构造。 */
export type BuiltinMcpOutcome = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

export type BuiltinMcpRunner = (
  user: CurrentUser,
  requestId: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<BuiltinMcpOutcome>;

/** 交给对话循环的一件远程工具：名字带连接器前缀，避免与内置工具重名。 */
export type ConnectorToolSpec = {
  name: string;
  connectorId: number;
  connectorName: string;
  remoteName: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type ConnectorRow = {
  id: number;
  userId: string;
  name: string;
  transport: string;
  url: string;
  headers: string;
  headerNames: unknown;
  enabled: boolean;
  toolCount: number;
  toolNames: unknown;
  lastError: string;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 这些头由传输层自己发，让用户再填会直接覆盖掉协议必需值。 */
const RESERVED_HEADERS = ['host', 'content-length', 'content-type', 'accept'];

function transportOf(raw: unknown): McpTransport {
  return raw === 'sse' ? 'sse' : 'http';
}

function safeToolName(remote: string) {
  return remote.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
}

function failText(message: string) {
  return { text: `工具执行失败：${message}`, ok: false };
}

/** 请求头按「名字: 值」逐行录入；保存时只留名字给界面，值加密落库。 */
function parseHeaders(raw: unknown): Record<string, string> {
  const value = text(raw).trim();
  if (!value) return {};
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length > HEADER_LINES_MAX) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `请求头最多 ${HEADER_LINES_MAX} 行`,
    );
  }
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请求头格式应为「名字: 值」，这一行看不懂：${line.slice(0, 40)}`,
      );
    }
    const name = line.slice(0, colon).trim();
    const headerValue = line.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请求头名字不合法：${name.slice(0, 40)}`,
      );
    }
    if (RESERVED_HEADERS.includes(name.toLowerCase())) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请求头 ${name} 由系统自己发，不用填`,
      );
    }
    if (!headerValue) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请求头 ${name} 没有值`,
      );
    }
    if (headerValue.length > HEADER_VALUE_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请求头 ${name} 太长了（上限 ${HEADER_VALUE_MAX} 字）`,
      );
    }
    headers[name] = headerValue;
  }
  return headers;
}

function readUrl(raw: unknown) {
  const value = text(raw).trim();
  if (!value) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请填写连接器的服务地址',
    );
  }
  if (value.length > URL_MAX) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `服务地址太长了（上限 ${URL_MAX} 字）`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '服务地址要写成完整网址，例如 https://example.com/mcp',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '服务地址只支持 http:// 或 https://',
    );
  }
  if (parsed.username || parsed.password) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请把账号密码填到请求头里，不要写进服务地址',
    );
  }
  return parsed.toString();
}

function readName(raw: unknown) {
  const value = text(raw).trim();
  if (!value) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请给连接器起个名字');
  }
  if (value.length > NAME_MAX) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `名字最多 ${NAME_MAX} 个字`,
    );
  }
  return value;
}

/**
 * MCP 连接器：把外部 MCP Server 的工具并入 Agent 的工具列表。
 * - 内置一条只读的「本站 MCP Server」（id 0），走进程内的 MCP 服务，与外部客户端同一套工具；
 * - 自定义连接器按账号归属，请求头加密落库；工具名统一加 `mcp__c<id>__` 前缀。
 * 探测失败只记 lastError 并跳过注入，不阻塞对话。
 */
export class ContentAgentConnectorService {
  private readonly cache = new Map<
    number,
    { at: number; tools: McpRemoteTool[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AgentMcpCrypto,
    readonly builtin: { current?: BuiltinMcpRunner },
  ) {}

  private builtinTools() {
    return mcpToolDescriptors().map((row) => row.name);
  }

  private builtinShape() {
    const tools = this.builtinTools();
    return {
      id: 0,
      name: BUILTIN_NAME,
      transport: 'builtin' as const,
      url: MCP_ENDPOINT_PATH,
      headerNames: [] as string[],
      enabled: true,
      toolCount: tools.length,
      tools,
      lastError: '',
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private shapeRow(row: ConnectorRow) {
    return {
      id: row.id,
      name: row.name,
      transport: transportOf(row.transport),
      url: row.url,
      headerNames: Array.isArray(row.headerNames)
        ? row.headerNames.map((item) => String(item))
        : [],
      enabled: row.enabled,
      toolCount: row.toolCount,
      tools: Array.isArray(row.toolNames)
        ? row.toolNames.map((item) => String(item))
        : [],
      lastError: row.lastError,
      lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private headersOf(row: ConnectorRow): Record<string, string> {
    if (!row.headers) return {};
    try {
      const parsed = JSON.parse(this.crypto.decrypt(row.headers)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof value === 'string' && value) headers[key] = value;
      }
      return headers;
    } catch {
      return {};
    }
  }

  private messageOf(error: unknown) {
    if (error instanceof McpClientError) return error.message;
    if (error instanceof BusinessException) return error.message;
    return '连接器调用失败，请稍后重试';
  }

  private async ownedRow(user: CurrentUser, id: number) {
    const row = await this.prisma.contentAgentMcpConnector.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '连接器不存在或已被删除',
      );
    }
    return row;
  }

  private async assertNameFree(user: CurrentUser, name: string, exceptId = 0) {
    const clash = await this.prisma.contentAgentMcpConnector.findFirst({
      where: {
        userId: user.userId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `已经有一个叫「${name}」的连接器了`,
      );
    }
  }

  // ---------------------------------------------------------------- 增删改查

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentMcpConnector.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
      take: MAX_CONNECTORS,
    });
    return [this.builtinShape(), ...rows.map((row) => this.shapeRow(row))];
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = readName(body.name);
    await this.assertNameFree(user, name);
    const count = await this.prisma.contentAgentMcpConnector.count({
      where: { userId: user.userId },
    });
    if (count >= MAX_CONNECTORS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `最多添加 ${MAX_CONNECTORS} 个连接器`,
      );
    }
    const headers = parseHeaders(body.headers);
    const row = await this.prisma.contentAgentMcpConnector.create({
      data: {
        userId: user.userId,
        name,
        transport: transportOf(body.transport),
        url: readUrl(body.url),
        headers: Object.keys(headers).length
          ? this.crypto.encrypt(JSON.stringify(headers))
          : '',
        headerNames: Object.keys(headers) as never,
        enabled: body.enabled !== false,
      },
    });
    // 保存时顺手连一次，把工具数/错误直接显示在列表里；连不上不挡保存。
    const fresh = row.enabled
      ? await this.probeRow(row).then(
          () => row,
          () => row,
        )
      : row;
    const reloaded = await this.prisma.contentAgentMcpConnector.findUnique({
      where: { id: fresh.id },
    });
    return this.shapeRow(reloaded ?? row);
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const connectorId = Number(id);
    if (!Number.isInteger(connectorId) || connectorId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '本站 MCP Server 是内置连接器，不能修改或删除',
      );
    }
    const row = await this.ownedRow(user, connectorId);
    const data: {
      name?: string;
      transport?: string;
      url?: string;
      headers?: string;
      headerNames?: string[];
      enabled?: boolean;
    } = {};
    if (body.name !== undefined) {
      const name = readName(body.name);
      if (name !== row.name) await this.assertNameFree(user, name, row.id);
      data.name = name;
    }
    if (body.transport !== undefined)
      data.transport = transportOf(body.transport);
    if (body.url !== undefined) data.url = readUrl(body.url);
    if (body.headers !== undefined) {
      const headers = parseHeaders(body.headers);
      data.headers = Object.keys(headers).length
        ? this.crypto.encrypt(JSON.stringify(headers))
        : '';
      data.headerNames = Object.keys(headers);
    }
    if (body.enabled !== undefined) data.enabled = body.enabled !== false;

    const connectionChanged =
      (data.transport !== undefined && data.transport !== row.transport) ||
      (data.url !== undefined && data.url !== row.url) ||
      data.headers !== undefined;
    this.cache.delete(row.id);
    await this.prisma.contentAgentMcpConnector.update({
      where: { id: row.id },
      data,
    });
    const reloaded = await this.prisma.contentAgentMcpConnector.findUnique({
      where: { id: row.id },
    });
    if (!reloaded) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '连接器不存在或已被删除',
      );
    }
    if (connectionChanged && reloaded.enabled) {
      await this.probeRow(reloaded).catch(() => undefined);
    }
    const after = await this.prisma.contentAgentMcpConnector.findUnique({
      where: { id: row.id },
    });
    return this.shapeRow(after ?? reloaded);
  }

  async remove(user: CurrentUser, id: string) {
    const connectorId = Number(id);
    if (!Number.isInteger(connectorId) || connectorId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '本站 MCP Server 是内置连接器，不能修改或删除',
      );
    }
    const removed = await this.prisma.contentAgentMcpConnector.deleteMany({
      where: { id: connectorId, userId: user.userId },
    });
    if (!removed.count) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '连接器不存在或已被删除',
      );
    }
    this.cache.delete(connectorId);
    return { removed: true };
  }

  /** 「测试连接」：已保存的连接器默认用库里的请求头；弹窗里还没保存时可以带新配置试连。 */
  async test(user: CurrentUser, body: Record<string, unknown>) {
    const idRaw = Number(body.id ?? 0);
    const row =
      Number.isInteger(idRaw) && idRaw > 0
        ? await this.ownedRow(user, idRaw)
        : undefined;
    if (idRaw > 0 && !row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '连接器不存在');
    }
    const transport = transportOf(
      body.transport !== undefined ? body.transport : row?.transport,
    );
    const url = body.url !== undefined ? readUrl(body.url) : row ? row.url : '';
    if (!url) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写连接器的服务地址',
      );
    }
    const usingStoredHeaders = body.headers === undefined && Boolean(row);
    const headers = usingStoredHeaders
      ? this.headersOf(row as ConnectorRow)
      : parseHeaders(body.headers);
    const client = new McpClient({ transport, url, headers });
    try {
      const tools = await client.listTools();
      if (row) {
        await this.persistProbe(row.id, tools, '');
        if (usingStoredHeaders)
          this.cache.set(row.id, { at: Date.now(), tools });
      }
      return {
        ok: true,
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name).slice(0, 50),
        message: tools.length
          ? `连接成功，发现 ${tools.length} 个工具`
          : '连接成功，但这个服务没有发布任何工具',
      };
    } catch (error) {
      const message = this.messageOf(error);
      if (row) {
        this.cache.delete(row.id);
        await this.persistProbe(row.id, [], message);
      }
      return { ok: false, toolCount: 0, tools: [], message };
    } finally {
      client.close();
    }
  }

  // ---------------------------------------------------------------- 探测与缓存

  private async persistProbe(
    id: number,
    tools: McpRemoteTool[],
    error: string,
  ) {
    await this.prisma.contentAgentMcpConnector
      .updateMany({
        where: { id },
        data: {
          toolCount: tools.length,
          toolNames: tools.slice(0, 50).map((tool) => tool.name) as never,
          lastError: error.slice(0, ERROR_TEXT_MAX),
          lastCheckedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  private async probeRow(row: ConnectorRow) {
    const client = new McpClient({
      transport: transportOf(row.transport),
      url: row.url,
      headers: this.headersOf(row),
    });
    try {
      const tools = await client.listTools();
      await this.persistProbe(row.id, tools, '');
      this.cache.set(row.id, { at: Date.now(), tools });
      return tools;
    } catch (error) {
      const message = this.messageOf(error);
      this.cache.delete(row.id);
      await this.persistProbe(row.id, [], message);
      throw error instanceof McpClientError
        ? error
        : new McpClientError(message, 'upstream');
    } finally {
      client.close();
    }
  }

  private async fetchTools(row: ConnectorRow) {
    const hit = this.cache.get(row.id);
    if (hit && Date.now() - hit.at < TOOL_CACHE_MS) return hit.tools;
    return this.probeRow(row);
  }

  private async specsOf(row: ConnectorRow): Promise<ConnectorToolSpec[]> {
    const tools = await this.fetchTools(row);
    return tools.slice(0, MAX_TOOLS_PER_CONNECTOR).map((tool) => ({
      name: `mcp__c${row.id}__${safeToolName(tool.name)}`,
      connectorId: row.id,
      connectorName: row.name,
      remoteName: tool.name,
      description: `[连接器 ${row.name}] ${tool.description || tool.name}`,
      inputSchema: tool.inputSchema,
    }));
  }

  // ---------------------------------------------------------------- 对话循环用

  /** 本轮可用的远程工具：内置 6 件元工具 + 各启用连接器发布的工具；连不上的直接跳过。 */
  async toolSpecs(
    user: CurrentUser,
    connectorIds?: number[],
  ): Promise<ConnectorToolSpec[]> {
    // 定时任务固定引用的连接器：空＝全部启用中的；0＝本站 MCP Server
    const scoped =
      connectorIds && connectorIds.length ? new Set(connectorIds) : null;
    const specs: ConnectorToolSpec[] = [];
    if (!scoped || scoped.has(0)) {
      specs.push(
        ...mcpToolDescriptors().map((descriptor) => ({
          name: `mcp__c0__${descriptor.name}`,
          connectorId: 0,
          connectorName: BUILTIN_NAME,
          remoteName: descriptor.name,
          description: `[${BUILTIN_NAME}] ${descriptor.title}：${descriptor.description}`,
          inputSchema: descriptor.inputSchema,
        })),
      );
    }
    const externalIds = scoped ? [...scoped].filter((id) => id > 0) : undefined;
    if (externalIds && !externalIds.length) return specs;
    const rows = await this.prisma.contentAgentMcpConnector.findMany({
      where: {
        userId: user.userId,
        enabled: true,
        ...(externalIds ? { id: { in: externalIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: MAX_CONNECTORS,
    });
    const groups = await Promise.all(
      rows.map((row) =>
        this.specsOf(row).catch(() => [] as ConnectorToolSpec[]),
      ),
    );
    for (const group of groups) specs.push(...group);
    return specs.slice(0, MAX_TOTAL_TOOLS);
  }

  /** 执行一次远程工具调用；失败按 `工具执行失败：…` 回给模型，不打断整轮对话。 */
  async callTool(
    user: CurrentUser,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; ok: boolean }> {
    const match = /^mcp__c(\d+)__(.+)$/.exec(name);
    if (!match) return failText(`未知工具：${name}`);
    const connectorId = Number(match[1]);
    // 本轮只引用了部分连接器时，模型即便叫出范围外的工具也直接拒
    const scoped = currentAgentScope()?.connectorIds;
    if (scoped && scoped.length && !scoped.includes(connectorId)) {
      return failText(
        connectorId === 0
          ? '本轮没有引用本站 MCP Server，不能调用它的工具'
          : '这个连接器不在本轮指定的范围内',
      );
    }
    if (connectorId === 0) return this.callBuiltin(user, match[2], args);
    const row = await this.prisma.contentAgentMcpConnector.findFirst({
      where: { id: connectorId, userId: user.userId },
    });
    if (!row) return failText('连接器不存在或已被删除');
    if (!row.enabled) return failText(`连接器「${row.name}」已停用`);
    let spec: ConnectorToolSpec | undefined;
    try {
      spec = (await this.specsOf(row)).find(
        (item) => item.name === name || item.remoteName === match[2],
      );
    } catch (error) {
      return failText(`连接器「${row.name}」不可用：${this.messageOf(error)}`);
    }
    if (!spec) {
      return failText(`连接器「${row.name}」没有名为 ${match[2]} 的工具`);
    }
    const client = new McpClient({
      transport: transportOf(row.transport),
      url: row.url,
      headers: this.headersOf(row),
    });
    try {
      const outcome = await client.callTool(spec.remoteName, args);
      return outcome.isError
        ? {
            text: `工具执行失败：连接器「${row.name}」返回错误：${outcome.text}`,
            ok: false,
          }
        : { text: `[${row.name}] ${outcome.text}`, ok: true };
    } catch (error) {
      return failText(
        `连接器「${row.name}」调用失败：${this.messageOf(error)}`,
      );
    } finally {
      client.close();
    }
  }

  private async callBuiltin(
    user: CurrentUser,
    remoteName: string,
    args: Record<string, unknown>,
  ) {
    const runner = this.builtin.current;
    if (!runner) return failText('本站 MCP Server 暂时不可用');
    try {
      // 定时任务的邮箱范围随上下文进 MCP：邮件工具按它挡越界调用，不靠模型自觉
      const scope = currentAgentScope();
      const mailboxIds = scope?.mailboxIds;
      const result = await runAsAgent(
        {
          user,
          requestId: `agent-${user.userId}-${Date.now()}`,
          mailboxIds: mailboxIds?.length ? mailboxIds : undefined,
          trigger: scope?.trigger ?? 'chat',
        },
        () =>
          runner(user, `agent-${user.userId}-${Date.now()}`, remoteName, args),
      );
      const body = result.content
        .map((part) => part.text)
        .join('\n')
        .trim();
      const fallback = JSON.stringify(result.structuredContent ?? {});
      const output = body || fallback;
      return result.isError
        ? { text: `工具执行失败：${output}`, ok: false }
        : { text: output, ok: true };
    } catch (error) {
      return failText(this.messageOf(error));
    }
  }
}
