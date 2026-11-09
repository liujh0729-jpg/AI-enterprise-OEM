import { agentOutcomeLabel, endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

const api = {
  overview: endpoint(endpoints.Agent_overview),
  events: endpoint(endpoints.Agent_events),
  grants: endpoint(endpoints.Agent_grants),
  saveGrants: endpoint(endpoints.Agent_saveGrants),
  clear: endpoint(endpoints.Agent_clear),
};

/** 一条意图记忆（后端 agentMemoryEventSchema 的形状）：中文标签由后端随数据下发。 */
export type AgentEvent = {
  id: number;
  domain: string;
  domainLabel: string;
  action: string;
  actionLabel: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  outcome: string;
  outcomeLabel: string;
  channel: string;
  channelLabel: string;
  errorCode: string;
  errorMessage: string;
  params: Record<string, unknown>;
  occurredAt: string;
};

/** 概览统计（后端 agentOverviewSchema 的形状）。 */
export type AgentOverview = {
  total: number;
  last7Days: number;
  last30Days: number;
  activeDays: number;
  failed: number;
  firstAt: string | null;
  lastAt: string | null;
  byDomain: { domain: string; label: string; count: number }[];
  byChannel: { channel: string; label: string; count: number }[];
  topActions: {
    action: string;
    label: string;
    domain: string;
    domainLabel: string;
    count: number;
  }[];
};

export type AgentClearResult = {
  events: number;
  candidates: number;
  preferences: number;
  playbooks: number;
  grants: number;
  runs: number;
};

export type AgentEventPage = {
  list: AgentEvent[];
  total: number;
  page: number;
  pageSize: number;
};

/** 授权闸一行：一个可勾选自动执行的写动作。 */
export type AgentGrantItem = {
  domain: string;
  domainLabel: string;
  action: string;
  actionLabel: string;
  method: string;
  path: string;
  allowed: boolean;
  forbidden: boolean;
  forbiddenReason: string;
};

/** 连接器授权一行：粒度是整条自建 MCP 连接器，不是单个工具。 */
export type AgentConnectorGrant = {
  connectorId: number;
  name: string;
  enabled: boolean;
  toolCount: number;
  lastError: string;
  lastCheckedAt: string | null;
  allowed: boolean;
};

/** 授权闸清单（后端 agentGrantsSchema 的形状）。 */
export type AgentGrants = {
  total: number;
  grantedCount: number;
  forbiddenCount: number;
  domains: { domain: string; label: string; total: number; granted: number }[];
  items: AgentGrantItem[];
  connectors: AgentConnectorGrant[];
  connectorGrantedCount: number;
};

export type AgentGrantSaveResult = {
  granted: number;
  revoked: number;
  actions: string[];
  connectorsGranted: number;
  connectorsRevoked: number;
  connectorIds: number[];
};

/** 取数：失败不抛错，交页面提示（与 data-table/_components/common.ts 同口径）。 */
async function load<T>(work: Promise<unknown>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: (await work) as T, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

export type EventQuery = {
  page?: number;
  pageSize?: number;
  domain?: string;
  outcome?: string;
  channel?: string;
};

export const memoryApi = {
  overview: () => load<AgentOverview>(api.overview({})),
  events: (query: EventQuery) =>
    load<AgentEventPage>(
      api.events({
        query: {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          ...(query.domain ? { domain: query.domain } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.channel ? { channel: query.channel } : {}),
        },
      }),
    ),
  clear: () => api.clear({ body: {} }) as Promise<AgentClearResult>,
  grants: () => load<AgentGrants>(api.grants({})),
  /**
   * 整份覆盖：传当前勾选的全部动作与连接器，未传的视为取消授权；
   * 新增授权要带登录密码，由服务端再验一次。
   */
  saveGrants: (actions: string[], connectorIds: number[], password?: string) =>
    api.saveGrants({
      body: {
        actions,
        connectorIds,
        ...(password ? { password } : {}),
      },
    }) as Promise<AgentGrantSaveResult>,
};

/** 结果筛选的固定三项：标签取自契约，界面不出现 ok/failed/blocked 原文。 */
export const OUTCOME_OPTIONS = ["ok", "failed", "blocked"].map((value) => ({
  value,
  label: agentOutcomeLabel(value),
}));

/** 参数摘要：脱敏后的键值对压成一行文本，详情展开时再用 JSON 原文。 */
export function paramsSummary(params: Record<string, unknown>): string {
  const entries = Object.entries(params || {});
  if (!entries.length) return "—";
  return entries
    .map(([key, value]) => `${key}=${displayValue(value)}`)
    .join(" · ");
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 对象列：有名称显名称，否则显 id，都没有就是「—」（对路径参数兜底的动作也看得见）。 */
export function targetText(row: AgentEvent): string {
  return row.targetLabel || row.targetId || "—";
}
