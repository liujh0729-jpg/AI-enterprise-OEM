import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";
import { fmtTime } from "@/lib/datetime";
import { scheduleText } from "@/lib/schedule";

/**
 * Workbuddy 企业云界面层：Workbuddy Enterprise 账号（腾讯云凭据）/ Agent / 计划任务。
 * 后端 /enterprise/workbuddy/*，全部按账号归属——每把 Key 只看得到那个企业的 Agent，
 * 管理员也不代看他人密钥。计划任务的口水话澄清走「API Key 管理」里的平台 sk- Key。
 */

export { fmtTime };

export const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: "ap-guangzhou", label: "华南地区（广州）" },
  { value: "ap-shanghai", label: "华东地区（上海）" },
  { value: "ap-beijing", label: "华北地区（北京）" },
  { value: "ap-nanjing", label: "华东地区（南京）" },
  { value: "ap-shenzhen", label: "华南地区（深圳）" },
  { value: "ap-chengdu", label: "西南地区（成都）" },
];

export function regionLabel(value: string) {
  return REGION_OPTIONS.find((item) => item.value === value)?.label || value || "—";
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
};

export const ACCOUNT_STATUS_OPTIONS = Object.entries(ACCOUNT_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);

export const PLAN_KIND_LABEL: Record<string, string> = {
  ai: "AI 沟通确定任务",
  direct: "明确生成任务",
  scheduled: "定时任务",
};

export const PLAN_KIND_OPTIONS = [
  { value: "", label: "全部类型" },
  ...Object.entries(PLAN_KIND_LABEL).map(([value, label]) => ({
    value,
    label,
  })),
];

export const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  clarifying: "澄清中",
  ready: "待派发",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const PLAN_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  ...Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => ({
    value,
    label,
  })),
];

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const STRATEGY_LABEL: Record<string, string> = {
  single: "单账号执行",
  fan_out: "多账号并行",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  user: "我的输入",
  tool: "工具调用",
  assistant: "Agent 回复",
};

function colorOf(status: string) {
  if (status === "succeeded") return "success";
  if (status === "running" || status === "clarifying") return "processing";
  if (status === "failed") return "error";
  if (status === "ready") return "warning";
  if (status === "cancelled" || status === "disabled") return "default";
  return "default";
}

export const planStatusColor = colorOf;
export const taskStatusColor = colorOf;

export type WbAccount = {
  id: number;
  createdBy: string;
  name: string;
  region: string;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string;
  notes: string;
  /** SecretId 打码展示；SecretKey 只回「存过没有」，都不回明文。 */
  secretIdMasked: string;
  hasSecretKey: boolean;
  createdAt: string;
  updatedAt: string;
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
  AccountId?: string;
};

export type WbAgentDetail = WbAgentItem & {
  RoutingSet?: { VersionId?: string; Weight?: number }[];
  A2AConfig?: {
    A2AEnabled?: boolean;
    A2APublicRef?: string;
    A2AEndpoint?: string;
    A2AStatus?: string;
  };
};

export type WbVersion = {
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

export type WbModelItem = {
  ModelId?: string;
  Name?: string;
  Vendor?: string;
  MaxOutputTokens?: number;
  MaxInputTokens?: number;
  SupportsToolCall?: boolean;
  Status?: string;
  DescriptionZh?: string;
};

export type WbConnectorItem = {
  ConnectorId?: string;
  Name?: string;
  Description?: string;
  Source?: string;
  Type?: string;
  ServiceUrl?: string;
  Status?: string;
};

export type PlanStep = { title: string; instruction: string };

/** 任务书：目标 / 交付物 / 验收标准 / 可独立执行的步骤（由 AI 澄清产出，后端归一）。 */
export type WbPlanSpec = {
  goal: string;
  deliverable: string;
  acceptance: string;
  steps: PlanStep[];
};

export type WbPlan = {
  id: number;
  createdBy: string;
  title: string;
  rawInput: string;
  spec: WbPlanSpec;
  stepCount: number;
  ready: boolean;
  taskCount: number;
  strategy: string;
  accountIds: number[];
  status: string;
  summary: string;
  lastError: string;
  /** 新建时的分类：ai 沟通确定 / direct 明确生成 / scheduled 定时任务。 */
  kind: string;
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WbTask = {
  id: number;
  planId: number;
  seq: number;
  accountId: number;
  agentId: string;
  versionId: string;
  /** 派发后才有：腾讯云会话 ID 与 A2A 任务态。 */
  sessionId: string;
  instruction: string;
  status: string;
  /** 与所属计划同分类，任务列表按它筛选。 */
  kind: string;
  lastEventSeq: number;
  state: string;
  lastError: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WbTaskEvent = {
  id: number;
  taskId: number;
  seq: number;
  eventType: string;
  content: string;
  toolName: string;
  toolInput: string;
  toolOutput: string;
  tokenUsage: { input?: number; output?: number; total?: number } | null;
  occurredAt: string;
};

export type PlanAccount = { id: number; name: string; status: string };

export type WbLlmSetting = {
  configured: boolean;
  keyMasked: string;
  model: string;
  baseUrl: string;
};

export type ClarifyMessage = { role: "user" | "assistant"; content: string };

export type ClarifyResult = {
  reply: string;
  spec: WbPlanSpec;
  ready: boolean;
  specError?: string;
  elapsedMs: number;
};

export type DispatchTarget = {
  accountId: number;
  agentId: string;
  versionId?: string;
};

export type DispatchResult = {
  dispatched: number;
  failed: number;
  plan: WbPlan;
  errors: string[];
};

export type SyncResult = {
  synced: number;
  errors?: string[];
  plan: WbPlan;
};

const api = {
  accounts: endpoint(endpoints.Workbuddy_accounts),
  createAccount: endpoint(endpoints.Workbuddy_addAccount),
  updateAccount: endpoint(endpoints.Workbuddy_updateAccount),
  deleteAccount: endpoint(endpoints.Workbuddy_removeAccount),
  verifyAccount: endpoint(endpoints.Workbuddy_verifyAccount),
  setting: endpoint(endpoints.Workbuddy_setting),
  saveSetting: endpoint(endpoints.Workbuddy_saveSetting),
  removeSetting: endpoint(endpoints.Workbuddy_removeSetting),
  llmModels: endpoint(endpoints.Workbuddy_models),
  agents: endpoint(endpoints.Workbuddy_agents),
  agentDetail: endpoint(endpoints.Workbuddy_agentDetail),
  createAgent: endpoint(endpoints.Workbuddy_createAgent),
  updateAgent: endpoint(endpoints.Workbuddy_updateAgent),
  deleteAgent: endpoint(endpoints.Workbuddy_removeAgent),
  agentVersions: endpoint(endpoints.Workbuddy_agentVersions),
  createAgentVersion: endpoint(endpoints.Workbuddy_createAgentVersion),
  builtinModels: endpoint(endpoints.Workbuddy_catalogModels),
  skills: endpoint(endpoints.Workbuddy_catalogSkills),
  experts: endpoint(endpoints.Workbuddy_catalogExperts),
  connectors: endpoint(endpoints.Workbuddy_catalogConnectors),
  plans: endpoint(endpoints.Workbuddy_plans),
  plan: endpoint(endpoints.Workbuddy_plan),
  createPlan: endpoint(endpoints.Workbuddy_createPlan),
  updatePlan: endpoint(endpoints.Workbuddy_updatePlan),
  deletePlan: endpoint(endpoints.Workbuddy_removePlan),
  clarify: endpoint(endpoints.Workbuddy_clarify),
  materialize: endpoint(endpoints.Workbuddy_materialize),
  addTask: endpoint(endpoints.Workbuddy_addPlanTask),
  dispatch: endpoint(endpoints.Workbuddy_dispatchPlan),
  sync: endpoint(endpoints.Workbuddy_syncPlan),
  updateTask: endpoint(endpoints.Workbuddy_updateTask),
  deleteTask: endpoint(endpoints.Workbuddy_removeTask),
  taskEvents: endpoint(endpoints.Workbuddy_taskEvents),
  followUp: endpoint(endpoints.Workbuddy_followUpTask),
  cancelTask: endpoint(endpoints.Workbuddy_cancelTask),
};

/** 取数：失败不抛错，交页面提示（与 rpa/_components/common.ts 同口径）。 */
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

/** 写操作：失败抛出后端文案，由调用方 message.error。 */
async function mutate<T>(work: Promise<unknown>): Promise<T> {
  return (await work) as T;
}

type AgentList = { total: number; items: WbAgentItem[]; offset: number; limit: number };
type VersionList = { total: number; items: WbVersion[]; offset: number; limit: number };

export const workbuddyApi = {
  accounts: () => load<WbAccount[]>(api.accounts({})),
  createAccount: (body: Record<string, unknown>) =>
    mutate<WbAccount>(api.createAccount({ body })),
  updateAccount: (id: number, body: Record<string, unknown>) =>
    mutate<WbAccount>(api.updateAccount({ params: { id: String(id) }, body })),
  deleteAccount: (id: number) =>
    mutate<{ id: number }>(api.deleteAccount({ params: { id: String(id) } })),
  verifyAccount: (id: number) =>
    mutate<{ ok: boolean; agentTotal: number; account: WbAccount }>(
      api.verifyAccount({ params: { id: String(id) } }),
    ),

  setting: () => load<WbLlmSetting>(api.setting({})),
  saveSetting: (body: Record<string, unknown>) =>
    mutate<WbLlmSetting>(api.saveSetting({ body })),
  removeSetting: () => mutate<{ removed: boolean }>(api.removeSetting({})),
  llmModels: () =>
    load<{ baseUrl: string; models: string[] }>(api.llmModels({})),

  agents: (params: {
    accountId: number;
    keyword?: string;
    offset?: number;
    limit?: number;
  }) => load<AgentList>(api.agents({ query: params })),
  agentDetail: (accountId: number, agentId: string) =>
    load<WbAgentDetail>(api.agentDetail({ query: { accountId, agentId } })),
  createAgent: (body: Record<string, unknown>) =>
    mutate<WbAgentDetail>(api.createAgent({ body })),
  updateAgent: (body: Record<string, unknown>) =>
    mutate<WbAgentDetail>(api.updateAgent({ body })),
  deleteAgent: (body: Record<string, unknown>) =>
    mutate<{ agentId: string }>(api.deleteAgent({ body })),
  agentVersions: (params: {
    accountId: number;
    agentId: string;
    offset?: number;
    limit?: number;
  }) => load<VersionList>(api.agentVersions({ query: params })),
  createAgentVersion: (body: Record<string, unknown>) =>
    mutate<WbVersion>(api.createAgentVersion({ body })),
  builtinModels: (accountId: number) =>
    load<WbModelItem[]>(api.builtinModels({ query: { accountId } })),
  skills: (accountId: number, source: string) =>
    load<{ total: number; items: unknown[] }>(
      api.skills({ query: { accountId, source } }),
    ),
  experts: (accountId: number, source: string) =>
    load<{ total: number; items: unknown[] }>(
      api.experts({ query: { accountId, source } }),
    ),
  connectors: (accountId: number, keyword?: string) =>
    load<WbConnectorItem[]>(api.connectors({ query: { accountId, keyword } })),

  plans: (status?: string) =>
    load<{ items: WbPlan[]; counts: Record<string, number> }>(
      api.plans({ query: { status } }),
    ),
  plan: (id: number) =>
    load<{ plan: WbPlan; tasks: WbTask[]; accounts: PlanAccount[] }>(
      api.plan({ params: { id: String(id) } }),
    ),
  createPlan: (body: Record<string, unknown>) =>
    mutate<WbPlan>(api.createPlan({ body })),
  updatePlan: (id: number, body: Record<string, unknown>) =>
    mutate<WbPlan>(api.updatePlan({ params: { id: String(id) }, body })),
  deletePlan: (id: number) =>
    mutate<{ id: number }>(api.deletePlan({ params: { id: String(id) } })),
  clarify: (body: {
    messages: ClarifyMessage[];
    spec?: WbPlanSpec;
    model?: string;
  }) => mutate<ClarifyResult>(api.clarify({ body })),
  materialize: (id: number, body: Record<string, unknown>) =>
    mutate<WbPlan>(api.materialize({ params: { id: String(id) }, body })),
  addTask: (id: number, body: Record<string, unknown>) =>
    mutate<WbTask>(api.addTask({ params: { id: String(id) }, body })),
  dispatch: (id: number) => mutate<DispatchResult>(api.dispatch({ params: { id: String(id) } })),
  sync: (id: number) => mutate<SyncResult>(api.sync({ params: { id: String(id) } })),

  updateTask: (id: number, body: Record<string, unknown>) =>
    mutate<WbTask>(api.updateTask({ params: { id: String(id) }, body })),
  deleteTask: (id: number) =>
    mutate<{ id: number }>(api.deleteTask({ params: { id: String(id) } })),
  taskEvents: (id: number) =>
    load<{ task: WbTask; events: WbTaskEvent[] }>(
      api.taskEvents({ params: { id: String(id) } }),
    ),
  followUp: (id: number, body: { instruction: string }) =>
    mutate<WbTask>(api.followUp({ params: { id: String(id) }, body })),
  cancelTask: (id: number) =>
    mutate<WbTask>(api.cancelTask({ params: { id: String(id) } })),
};

/** 聊天里不显示任务书标记行（任务书已单独预览）。 */
export function stripSpecMarker(reply: string) {
  return String(reply || "")
    .replace(/SPEC_JSON\s*:.*$/gm, "")
    .trim();
}

/** 计划一句话：分类 + 状态 + 任务书 + 派发方式，列表里给个可扫读的副标题。 */
export function planHint(plan: WbPlan) {
  const parts = [
    PLAN_KIND_LABEL[plan.kind] || PLAN_KIND_LABEL.ai,
    PLAN_STATUS_LABEL[plan.status] || plan.status,
  ];
  parts.push(plan.stepCount ? `任务书 ${plan.stepCount} 步` : "任务书未成形");
  if (plan.taskCount) parts.push(`任务 ${plan.taskCount} 条`);
  if (plan.strategy === "fan_out") parts.push(STRATEGY_LABEL.fan_out);
  if (plan.kind === "scheduled") parts.push(scheduleText(plan));
  return parts.join(" · ");
}

/** 任务归属：账号名 + Agent 短 ID，列表里能看出这一步铺到了哪把 Key。 */
export function targetText(
  task: Pick<WbTask, "accountId" | "agentId">,
  accounts: PlanAccount[],
) {
  const name =
    accounts.find((item) => item.id === task.accountId)?.name ||
    `账号 #${task.accountId}`;
  return `${name} · ${task.agentId.slice(0, 12)}${task.agentId.length > 12 ? "…" : ""}`;
}

/** Manifest 输入框：顺手校验 JSON 并给出字节数（腾讯云单版本上限 256 KiB）。 */
export function manifestState(raw: string): {
  bytes: number;
  error: string;
} {
  const text = raw.trim();
  if (!text) return { bytes: 0, error: "" };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 256 * 1024) {
    return { bytes, error: "超过 256 KiB，腾讯云不接受这么大的 Manifest" };
  }
  try {
    JSON.parse(text);
    return { bytes, error: "" };
  } catch {
    return { bytes, error: "不是合法 JSON" };
  }
}
