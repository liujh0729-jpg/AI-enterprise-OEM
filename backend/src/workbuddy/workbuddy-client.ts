import { createHash, createHmac, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import { shorten } from './workbuddy-shared';

/**
 * 腾讯云 WorkBuddy Managed Agents（Workbuddy 企业云）的 API 3.0 客户端。
 *
 * 签名走标准 TC3-HMAC-SHA256：密钥对（SecretId / SecretKey）由每个用户自己填，
 * 用哪把 key 签名就只看得到那个企业的 Agent 与会话，SaaS 隔离由腾讯云侧完成，本地不再做 ACL。
 *
 * 控制面（本文件 call()）：Agent / 版本 / 会话 / 消息事件的增删查，全部是 workbuddyenterprise 的 Action。
 * 数据面（pushInstruction()）：会话创建后拿到的聊天接入点 + DescribeUserAccessToken 换到的用户级令牌，
 * 按产品文档「数据面鉴权走 DescribeUserAccessToken 的用户级访问令牌」与本产品的 A2A 互通协议下发指令。
 */

export const WB_HOST = 'workbuddyenterprise.tencentcloudapi.com';
export const WB_SERVICE = 'workbuddyenterprise';
export const WB_API_VERSION = '2026-07-09';
const CONTENT_TYPE = 'application/json; charset=utf-8';

/** 文档口径：接口默认超时 10s，这里给到 20s 容纳网络抖动。 */
const DEFAULT_TIMEOUT_MS = 20000;

export type WbCreds = {
  secretId: string;
  secretKey: string;
  region: string;
};

export type WbResponseError = { Code?: string; Message?: string };

/** 控制面回包：出错时 Error 非空，成功时业务字段与 RequestId 平铺在 Response 下。 */
export type WbRawResponse = Record<string, unknown> & {
  Error?: WbResponseError;
  RequestId?: string;
};

export type WbChatEndpoint = {
  EndpointType?: string;
  Url?: string;
};

export type WbAgentItem = {
  AgentId?: string;
  AgentName?: string;
  Description?: string;
  AvatarUrl?: string;
  Model?: string;
  LatestVersionId?: string;
  LatestVersionName?: string;
  SessionCount?: number;
  CreatedTime?: string;
  ModifiedTime?: string;
  A2AEnabled?: boolean;
  A2AEndpoint?: string;
  A2AStatus?: string;
  PublicApiEnabled?: boolean;
  PublicApiUrl?: string;
  CreatorUin?: string;
  AccountId?: string;
};

export type WbVersionItem = {
  VersionId?: string;
  VersionName?: string;
  VersionType?: string;
  Model?: string;
  Status?: string;
  Description?: string;
  Manifest?: string;
  SandboxTemplateId?: string;
  SessionCount?: number;
  CreatedTime?: string;
  ModifiedTime?: string;
};

export type WbTokenUsage = {
  InputTokens?: number;
  OutputTokens?: number;
  TotalTokens?: number;
  Scope?: string;
};

export type WbToolCall = {
  ToolCallId?: string;
  ToolName?: string;
  Status?: string;
  Input?: string;
  Output?: string;
  StartedAt?: string;
  EndedAt?: string;
  DurationMs?: number;
};

export type WbMessageEvent = {
  Sequence?: number;
  EventType?: string;
  OccurredAt?: string;
  Message?: { Content?: string; TokenUsage?: WbTokenUsage };
  ToolCall?: WbToolCall;
};

/** DescribeAgent / CreateAgent / ModifyAgent 共用的单体回包（A2A 配置四项收进了结构）。 */
export type WbAgentDetail = {
  AgentId?: string;
  AgentName?: string;
  Description?: string;
  AvatarUrl?: string;
  IsDebug?: boolean;
  CreatedTime?: string;
  ModifiedTime?: string;
  RoutingSet?: { VersionId?: string; Weight?: number }[];
  A2AConfig?: {
    A2AEnabled?: boolean;
    A2APublicRef?: string;
    A2AEndpoint?: string;
    A2AStatus?: string;
  };
  AccountId?: string;
};

export type WbConnectorItem = {
  ConnectorId?: string;
  ConnectorSlug?: string;
  ConnectorKey?: string;
  Name?: string;
  Description?: string;
  AvatarUrl?: string;
  Source?: string;
  Type?: string;
  ServiceUrl?: string;
  AuthModes?: string[];
  Status?: string;
};

export type WbModelItem = {
  ModelId?: string;
  Name?: string;
  Vendor?: string;
  MaxOutputTokens?: number;
  MaxInputTokens?: number;
  SupportsToolCall?: boolean;
  SupportsImages?: boolean;
  DescriptionZh?: string;
  DescriptionEn?: string;
  Tags?: string[];
  Status?: string;
  AgentCount?: number;
};

/** SkillItem 与 ExpertItem 字段基本同形，展示只需这几列。 */
export type WbCatalogItem = {
  SkillId?: string;
  ExpertId?: string;
  Source?: string;
  Name?: string;
  DisplayName?: string;
  Description?: string;
  Icon?: string;
  Enabled?: boolean;
  Status?: string;
  SkillVersion?: string;
  ExpertVersion?: string;
};

export type WbCatalogCounts = {
  Builtin?: number;
  Custom?: number;
  Total?: number;
};

export type WbSessionCreated = {
  SessionId?: string;
  EndpointSet?: WbChatEndpoint[];
};

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** TC3-HMAC-SHA256 签名串：date/service/tc3_request 派生四级密钥，签名只覆盖 content-type 与 host。 */
export function buildTc3Authorization(input: {
  secretId: string;
  secretKey: string;
  payload: string;
  timestamp: number;
}) {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${CONTENT_TYPE}`,
    `host:${WB_HOST}`,
    '',
    'content-type;host',
    sha256Hex(input.payload),
  ].join('\n');
  const credentialScope = `${date}/${WB_SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(input.timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, WB_SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');
  return {
    authorization: `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
    date,
  };
}

/** 把腾讯云侧错误码翻成界面能读懂的一句话；绝不出 401，否则前端会把已登录用户踢出会话。 */
function fail(action: string, response: WbRawResponse, httpStatus: number) {
  const code = String(response.Error?.Code || `HTTP_${httpStatus}`);
  const message = String(response.Error?.Message || 'Workbuddy 未返回错误说明');
  const requestId = String(response.RequestId || '');
  return new BusinessException(
    ErrorCode.BAD_REQUEST,
    `Workbuddy「${action}」调用失败：${code} · ${shorten(message)}${
      requestId ? `（RequestId ${requestId.slice(0, 24)}）` : ''
    }`,
  );
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
) {
  const response = await httpRequest<string>(url, {
    method: 'POST',
    headers,
    body,
    timeoutMs,
    readAs: 'text',
    operation: 'workbuddy:rpc',
  });
  const raw = response.data;
  let payload: WbRawResponse = {};
  try {
    payload = JSON.parse(raw) as WbRawResponse;
  } catch {
    // 非 JSON 回包按 HTTP 状态判失败，原文进错误文案
  }
  return { status: response.status, ok: response.ok, payload, raw };
}

/**
 * 控制面调用：签名 → POST 到 workbuddyenterprise.tencentcloudapi.com → 取 Response。
 * 回包里的 Error、HTTP 非 2xx、超时、网络异常都会变成带腾讯云错误码与 RequestId 的 400/503。
 */
export async function wbCall<T = WbRawResponse>(
  creds: WbCreds,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const body = JSON.stringify(payload || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization } = buildTc3Authorization({
    secretId: creds.secretId,
    secretKey: creds.secretKey,
    payload: body,
    timestamp,
  });
  try {
    const response = await httpRequest<string>(`https://${WB_HOST}/`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPE,
        Host: WB_HOST,
        'X-TC-Action': action,
        'X-TC-Version': WB_API_VERSION,
        'X-TC-Timestamp': String(timestamp),
        ...(creds.region ? { 'X-TC-Region': creds.region } : {}),
        Authorization: authorization,
      },
      body,
      timeoutMs,
      readAs: 'text',
      operation: `workbuddy:${action}`,
    });
    const raw = response.data;
    let parsed: { Response?: WbRawResponse } = {};
    try {
      parsed = JSON.parse(raw) as { Response?: WbRawResponse };
    } catch {
      // 非 JSON：下面按 HTTP 状态失败
    }
    const envelope = parsed.Response || {};
    if (!response.ok || envelope.Error) {
      throw fail(action, envelope, response.status);
    }
    return envelope as unknown as T;
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (error instanceof TransportError && error.kind === 'timeout') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Workbuddy「${action}」超时（${timeoutMs} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `Workbuddy 无法访问：${(error as Error)?.message || '网络异常'}`,
    );
  }
}

export async function wbDescribeAgentList(
  creds: WbCreds,
  input: { offset?: number; limit?: number; keyword?: string } = {},
) {
  const filters: { Name: string; Values: string[]; ExactMatch: boolean }[] = [];
  const keyword = String(input.keyword || '').trim();
  if (keyword) {
    filters.push({
      Name: 'AgentName',
      Values: [keyword],
      ExactMatch: false,
    });
  }
  return wbCall<{
    TotalCount?: number;
    AgentSet?: WbAgentItem[];
  }>(creds, 'DescribeAgentList', {
    Offset: input.offset ?? 0,
    Limit: input.limit ?? 20,
    ...(filters.length ? { Filters: filters } : {}),
    SortBy: 'created_at',
    SortDirection: 'DESC',
  });
}

export async function wbDescribeAgentVersionList(
  creds: WbCreds,
  input: { agentId: string; offset?: number; limit?: number },
) {
  return wbCall<{
    TotalCount?: number;
    // 文档口径：集合名带实体前缀，以区分 Skill 版本接口的同名字段
    AgentVersionSet?: WbVersionItem[];
  }>(creds, 'DescribeAgentVersionList', {
    AgentId: input.agentId,
    Offset: input.offset ?? 0,
    Limit: input.limit ?? 20,
  });
}

export async function wbDescribeMessageEventList(
  creds: WbCreds,
  input: {
    sessionId: string;
    agentId: string;
    offset?: number;
    limit?: number;
  },
) {
  return wbCall<{ TotalCount?: number; MessageEventSet?: WbMessageEvent[] }>(
    creds,
    'DescribeMessageEventList',
    {
      SessionId: input.sessionId,
      AgentId: input.agentId,
      Offset: input.offset ?? 0,
      Limit: input.limit ?? 100,
    },
  );
}

/** 文档只写了「换取用户级 access_token」，输出字段名没展开，这里按键名含 token 的字符串兜底取。 */
export async function wbDescribeUserAccessToken(creds: WbCreds) {
  const response = await wbCall<WbRawResponse>(
    creds,
    'DescribeUserAccessToken',
    {},
  );
  let token = '';
  for (const [key, value] of Object.entries(response)) {
    if (!token && /token/i.test(key) && typeof value === 'string' && value) {
      token = value;
    }
  }
  return { token, raw: response };
}

/**
 * 数据面下发指令：读会话接入点的 A2A Agent Card 取得 RPC 地址，再按 JSON-RPC `message/send`
 * 把这段任务指令交给 Agent；令牌来自 DescribeUserAccessToken。
 * 回包原样带回，界面「执行结果」里能直接看到，协议对不上时错误可见而不是静默。
 */
export async function wbPushInstruction(input: {
  endpoint: string;
  token: string;
  sessionId: string;
  instruction: string;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 30000;
  const rpcUrl = await resolveRpcUrl(input.endpoint, input.token, timeoutMs);
  const payload = await wbRpcCall({
    rpcUrl,
    token: input.token,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        // 会话内每条消息都要有唯一 ID：用会话 ID + 内容哈希，重试/重跑同一份内容时
        // 天然幂等（对端按 messageId 去重，同内容不会发两遍）。
        messageId: `${input.sessionId}-${createHash('sha256').update(input.instruction).digest('hex').slice(0, 16)}`,
        contextId: input.sessionId,
        parts: [{ kind: 'text', text: input.instruction }],
      },
    },
    timeoutMs,
  });
  return { rpcUrl, payload };
}

/** A2A 取任务态：派发后拿 result.id 存下来，后续轮询靠它判完成。 */
export async function wbAgentTaskGet(input: {
  rpcUrl: string;
  token: string;
  taskId: string;
  timeoutMs?: number;
}) {
  return wbRpcCall({
    rpcUrl: input.rpcUrl,
    token: input.token,
    method: 'tasks/get',
    params: { id: input.taskId },
    timeoutMs: input.timeoutMs ?? 20000,
  });
}

export async function wbAgentTaskCancel(input: {
  rpcUrl: string;
  token: string;
  taskId: string;
  timeoutMs?: number;
}) {
  return wbRpcCall({
    rpcUrl: input.rpcUrl,
    token: input.token,
    method: 'tasks/cancel',
    params: { id: input.taskId },
    timeoutMs: input.timeoutMs ?? 20000,
  });
}

/** 接入点 → Agent Card 里的 RPC 地址；拿不到卡片就按标准拼法直接打接入点。 */
async function resolveRpcUrl(
  endpoint: string,
  token: string,
  timeoutMs: number,
) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  if (!base) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '该任务还没有会话接入地址，请先派发任务',
    );
  }
  try {
    const cardResponse = await httpRequest<string>(
      `${base}/.well-known/agent-card.json`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        timeoutMs,
        readAs: 'text',
        operation: 'workbuddy:agent-card',
      },
    );
    if (cardResponse.ok) {
      const card = JSON.parse(cardResponse.data) as { url?: string };
      if (String(card.url || '').trim()) return String(card.url).trim();
    }
  } catch {
    // 拿不到 Agent Card 时按标准拼法直接打接入点
  }
  return base;
}

/** JSON-RPC 调用：HTTP 非 2xx 与 JSON-RPC error 都翻成带原文的 400。 */
async function wbRpcCall(input: {
  rpcUrl: string;
  token: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    // 多账号并行下发会落在同一毫秒，请求 ID 用时间戳会撞号
    id: `wb-${randomUUID()}`,
    method: input.method,
    params: input.params,
  });
  const { status, ok, payload, raw } = await postJson(
    input.rpcUrl,
    {
      'Content-Type': 'application/json',
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body,
    input.timeoutMs,
  );
  if (!ok) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `Workbuddy 会话接入点返回 HTTP ${status}：${shorten(raw)}`,
    );
  }
  const rpcError = payload?.error as { code?: number; message?: string };
  if (rpcError?.message) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `Workbuddy 会话拒绝该请求：${shorten(String(rpcError.message))}`,
    );
  }
  return payload;
}

export async function wbDescribeAgent(
  creds: WbCreds,
  agentId: string,
): Promise<WbAgentDetail> {
  return wbCall<WbAgentDetail>(creds, 'DescribeAgent', { AgentId: agentId });
}

export async function wbCreateAgent(
  creds: WbCreds,
  input: {
    agentName: string;
    description?: string;
    avatarUrl?: string;
    model?: string;
    manifest?: string;
    connectorIds?: string[];
    accountId?: string;
  },
): Promise<WbAgentDetail> {
  return wbCall<WbAgentDetail>(creds, 'CreateAgent', {
    AgentName: input.agentName,
    ...(input.description ? { Description: input.description } : {}),
    ...(input.avatarUrl ? { AvatarUrl: input.avatarUrl } : {}),
    ...(input.model ? { Model: input.model } : {}),
    ...(input.manifest ? { Manifest: input.manifest } : {}),
    ...(input.connectorIds?.length
      ? {
          ConnectorSet: input.connectorIds.map((connectorId) => ({
            ConnectorId: connectorId,
          })),
        }
      : {}),
    ...(input.accountId ? { AccountId: input.accountId } : {}),
  });
}

/** ModifyAgent 只接受名称 / 描述 / 头像三项，模型与 Manifest 要走版本接口。 */
export async function wbModifyAgent(
  creds: WbCreds,
  agentId: string,
  input: { agentName?: string; description?: string; avatarUrl?: string },
): Promise<WbAgentDetail> {
  return wbCall<WbAgentDetail>(creds, 'ModifyAgent', {
    AgentId: agentId,
    ...(input.agentName !== undefined ? { AgentName: input.agentName } : {}),
    ...(input.description !== undefined
      ? { Description: input.description }
      : {}),
    ...(input.avatarUrl !== undefined ? { AvatarUrl: input.avatarUrl } : {}),
  });
}

export async function wbDeleteAgent(creds: WbCreds, agentId: string) {
  return wbCall<Record<string, unknown>>(creds, 'DeleteAgent', {
    AgentId: agentId,
  });
}

export async function wbCreateAgentVersion(
  creds: WbCreds,
  input: {
    agentId: string;
    manifest: string;
    model?: string;
    description?: string;
    sandboxTemplateId?: string;
  },
): Promise<WbVersionItem> {
  return wbCall<WbVersionItem>(creds, 'CreateAgentVersion', {
    AgentId: input.agentId,
    Manifest: input.manifest,
    ...(input.model ? { Model: input.model } : {}),
    ...(input.description ? { Description: input.description } : {}),
    ...(input.sandboxTemplateId
      ? { SandboxTemplateId: input.sandboxTemplateId }
      : {}),
  });
}

export async function wbCreateAgentSession(
  creds: WbCreds,
  input: { agentId: string; versionId?: string },
): Promise<WbSessionCreated> {
  return wbCall<WbSessionCreated>(creds, 'CreateAgentSession', {
    AgentId: input.agentId,
    ...(input.versionId ? { VersionId: input.versionId } : {}),
  });
}

export async function wbDescribeBuiltinModelList(
  creds: WbCreds,
  input: { offset?: number; limit?: number } = {},
) {
  return wbCall<{ TotalCount?: number; BuiltinModelSet?: WbModelItem[] }>(
    creds,
    'DescribeBuiltinModelList',
    { Offset: input.offset ?? 0, Limit: input.limit ?? 100 },
  );
}

/** Source 是数据通路判别而非筛选条件，必须显式传：BUILTIN / CUSTOM / AUTHORIZED。 */
export async function wbDescribeSkillList(
  creds: WbCreds,
  input: { source: string; offset?: number; limit?: number },
) {
  return wbCall<{
    TotalCount?: number;
    SkillSet?: WbCatalogItem[];
    Counts?: WbCatalogCounts | null;
  }>(creds, 'DescribeSkillList', {
    Source: input.source,
    Offset: input.offset ?? 0,
    Limit: input.limit ?? 100,
  });
}

export async function wbDescribeExpertList(
  creds: WbCreds,
  input: { source: string; offset?: number; limit?: number },
) {
  return wbCall<{
    TotalCount?: number;
    ExpertSet?: WbCatalogItem[];
    Counts?: WbCatalogCounts | null;
  }>(creds, 'DescribeExpertList', {
    Source: input.source,
    Offset: input.offset ?? 0,
    Limit: input.limit ?? 100,
  });
}

export async function wbDescribeConnectorList(
  creds: WbCreds,
  input: { offset?: number; limit?: number; keyword?: string } = {},
) {
  const keyword = String(input.keyword || '').trim();
  return wbCall<{ TotalCount?: number; ConnectorSet?: WbConnectorItem[] }>(
    creds,
    'DescribeConnectorList',
    {
      Offset: input.offset ?? 0,
      Limit: input.limit ?? 100,
      ...(keyword
        ? { Filters: [{ Name: 'Name', Values: [keyword], ExactMatch: false }] }
        : {}),
    },
  );
}
