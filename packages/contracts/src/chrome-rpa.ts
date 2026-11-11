import { z } from "zod";

/**
 * 本地 Chrome 插件 RPA 控制（docs/本地Chrome插件RPA控制方案.md）。
 *
 * 与「分发 / 获客 / 浏览器任务」同一套插件能力底座（extension.ts / browser-task.ts）：
 * 插件登录本系统后成为该账号名下的一台「本地 Chrome 设备」，云端把动作写进指令队列，
 * 插件心跳顺带领取、动态注入的内容脚本执行、按 commandCode 回执；会话由云端 LLM 逐步决策。
 * 本文件只放插件与本页面共用的形状；端点定义在 automation.ts（RpaChrome_* / OpenApi_rpaChrome*）。
 */

/** 设备令牌前缀：形态对齐 `hw_` / `ek_`，明文只在登录响应里出现一次。 */
export const RC_DEVICE_TOKEN_PREFIX = "rc_";
/** 插件调用设备通道时携带令牌的请求头。 */
export const RC_DEVICE_TOKEN_HEADER = "x-chrome-token";

/* ---------------------------------------------------------------- 设备状态 */

/** ONLINE＝90 秒内有心跳；OFFLINE＝心跳超时；DISABLED＝被停用或被撤销（复权失败）。 */
export const RC_DEVICE_STATUSES = ["ONLINE", "OFFLINE", "DISABLED"] as const;
export type RcDeviceStatus = (typeof RC_DEVICE_STATUSES)[number];
export const RC_DEVICE_STATUS_LABELS: Record<string, string> = {
  ONLINE: "在线",
  OFFLINE: "离线",
  DISABLED: "已停用",
};
/** 在线判定：3 个心跳周期（默认 30 秒/次）。 */
export const RC_ONLINE_TIMEOUT_MS = 90_000;
/** 每次心跳最多下发的指令条数。 */
export const RC_HEARTBEAT_BATCH = 10;

/** 设备当前心跳展示：服务端按 lastSeenAt 折算，不落冗余状态更新。 */
export function rcDeviceOnline(row: {
  status: string;
  lastSeenAt: Date | string | null;
  now?: number;
}): boolean {
  if (row.status !== "ONLINE") return false;
  if (!row.lastSeenAt) return false;
  const seen =
    row.lastSeenAt instanceof Date
      ? row.lastSeenAt.getTime()
      : new Date(row.lastSeenAt).getTime();
  return Number.isFinite(seen) && (row.now ?? Date.now()) - seen <= RC_ONLINE_TIMEOUT_MS;
}

/* ---------------------------------------------------------------- 指令与动作 */

/**
 * 动作闭集（插件与云端共用）。未知动作一律回 FAILED，不做「尽力而为」。
 * stop 由插件侧主动入队（用户在弹窗/页面横幅点停止），云端只读不派发。
 */
export const RC_ACTIONS = [
  "open_tab",
  "close_tab",
  "navigate",
  "snapshot",
  "read",
  "act",
  "wait",
  "screenshot",
  "finish",
] as const;
export type RcActionName = (typeof RC_ACTIONS)[number];
export const RC_ACTION_LABELS: Record<string, string> = {
  open_tab: "打开标签页",
  close_tab: "关闭标签页",
  navigate: "跳转页面",
  snapshot: "读取页面",
  read: "读取元素",
  act: "操作页面",
  wait: "等待",
  screenshot: "截图",
  finish: "结束会话",
};

/** 页面内动作（act 的子动作）：命中敏感词的 click 与 submit 需人工确认。 */
export const RC_ACT_INTERACTIONS = [
  "click",
  "type",
  "select",
  "check",
  "scroll",
  "key",
  "submit",
] as const;
export type RcActInteraction = (typeof RC_ACT_INTERACTIONS)[number];

/** 敏感动作判定：提交类动作与命中关键词的点击必须由本人在插件弹窗点「允许本次」。 */
export const RC_SENSITIVE_KEYWORDS = [
  "支付",
  "付款",
  "转账",
  "删除",
  "发布",
  "发送",
  "提交",
  "授权",
  "确认付款",
  "pay",
  "transfer",
  "delete",
  "publish",
  "send",
  "submit",
  "authorize",
] as const;

export function rcActionNeedsConfirm(action: {
  action?: unknown;
  act?: unknown;
  target?: unknown;
  value?: unknown;
}): boolean {
  const type = String(action.action || "").trim();
  if (type !== "act") return false;
  const interaction = String(action.act || "").trim();
  if (interaction === "submit") return true;
  if (interaction !== "click") return false;
  const haystack = [
    textOf(action.target),
    typeof action.value === "string" ? action.value : "",
  ]
    .join(" ")
    .toLowerCase();
  return RC_SENSITIVE_KEYWORDS.some((word) => haystack.includes(word.toLowerCase()));
}

/** 动作里的目标可能是字符串，也可能是页面地图元素对象：两种形态都取出一段可读文本。 */
function textOf(target: unknown): string {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return "";
  const bag = new Map<string, unknown>(Object.entries(target));
  return ["selector", "name", "text", "role"]
    .map((key) => bag.get(key))
    .filter((item): item is string => typeof item === "string")
    .join(" ");
}

/* ---------------------------------------------------------------- 指令状态 */

/** PENDING＝待插件领取；DISPATCHED＝已随心跳下发；PENDING_CONFIRM＝等人工允许；终态见下。 */
export const RC_COMMAND_STATUSES = [
  "PENDING",
  "DISPATCHED",
  "PENDING_CONFIRM",
  "DONE",
  "FAILED",
  "TIMEOUT",
  "CANCELLED",
] as const;
export type RcCommandStatus = (typeof RC_COMMAND_STATUSES)[number];
export const RC_COMMAND_STATUS_LABELS: Record<string, string> = {
  PENDING: "待下发",
  DISPATCHED: "已下发",
  PENDING_CONFIRM: "等待确认",
  DONE: "已完成",
  FAILED: "失败",
  TIMEOUT: "超时",
  CANCELLED: "已取消",
};

/* ---------------------------------------------------------------- 会话状态 */

export const RC_SESSION_STATUSES = [
  "RUNNING",
  "WAITING_CONFIRM",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
] as const;
export type RcSessionStatus = (typeof RC_SESSION_STATUSES)[number];
export const RC_SESSION_STATUS_LABELS: Record<string, string> = {
  RUNNING: "执行中",
  WAITING_CONFIRM: "等待确认",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  TIMEOUT: "已超时",
};

export function rcSessionTerminal(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "TIMEOUT"
  );
}

/* ---------------------------------------------------------------- 页面观测 */

/** 页面地图里的一项可见交互元素：LLM 用 elementIndex 指定比猜选择器稳。 */
export const rcPageElementSchema = z.object({
  i: z.number(),
  role: z.string().max(24),
  name: z.string().max(120),
  selector: z.string().max(300),
  value: z.string().max(200).optional(),
  href: z.string().max(500).optional(),
});
export type RcPageElement = z.infer<typeof rcPageElementSchema>;

/** 一次动作的统一回执：ok + data（含页面地图/截图的 key）+ 错误码与文案。 */
export const rcActionResultSchema = z.object({
  commandCode: z.string(),
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).default({}),
  errorMessage: z.string().max(500).default(""),
  elapsedMs: z.number().int().nonnegative().default(0),
  /** 网关错误码：沿用 BROWSER_TASK_ERROR_CODES + 本通道的 NEED_CONFIRM。 */
  code: z.string().max(40).default(""),
});
export type RcActionResultInput = z.infer<typeof rcActionResultSchema>;

/* ---------------------------------------------------------------- 设备通道（插件用） */

export const rcDeviceSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  domain: z.string(),
  extensionVersion: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  online: z.boolean(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  /** 该设备当前在跑的会话编号（没有则 0）。 */
  activeSessionId: z.number().default(0),
});
export type RcDeviceView = z.infer<typeof rcDeviceSchema>;

export const rcLoginBodySchema = z.object({
  domain: z.string().min(1).max(200),
  clientId: z.string().min(8).max(64),
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  deviceName: z.string().max(80).optional(),
  extensionVersion: z.string().max(24).optional(),
});
export type RcLoginBody = z.infer<typeof rcLoginBodySchema>;

export const rcLoginResultSchema = z.object({
  token: z.string(),
  clientId: z.string(),
  deviceName: z.string(),
  username: z.string(),
  /** 插件侧兜底上限（服务端为准）：单会话最大步数 / 单动作超时 / 会话总时长。 */
  limits: z.object({
    maxSteps: z.number(),
    stepTimeoutSeconds: z.number(),
    sessionTimeoutSeconds: z.number(),
  }),
  /** 高风险站点黑名单（已折叠为 hostname 后缀匹配）。 */
  blockedHosts: z.array(z.string()),
  /** 是否要求敏感动作人工确认。 */
  confirmSensitive: z.boolean(),
  heartbeatSeconds: z.number(),
});
export type RcLoginResult = z.infer<typeof rcLoginResultSchema>;

/** 心跳请求：插件带版本与当前打开的页面（供 UI 展示），顺带领取指令。 */
export const rcHeartbeatBodySchema = z.object({
  version: z.string().max(24).optional(),
  pages: z
    .array(z.object({ tabId: z.number(), url: z.string().max(500), title: z.string().max(200).default("") }))
    .max(20)
    .optional(),
});
export type RcHeartbeatBody = z.infer<typeof rcHeartbeatBodySchema>;

export const rcCommandSchema = z.object({
  commandCode: z.string(),
  sessionId: z.number(),
  stepIndex: z.number(),
  action: z.record(z.string(), z.unknown()),
});
export type RcCommand = z.infer<typeof rcCommandSchema>;

export const rcHeartbeatResultSchema = z.object({
  received: z.boolean(),
  serverTime: z.string(),
  /** 需要人工确认的动作：插件弹窗列出来，点允许后调 confirm。 */
  pendingConfirms: z.array(
    z.object({
      commandCode: z.string(),
      sessionId: z.number(),
      stepIndex: z.number(),
      action: z.record(z.string(), z.unknown()),
    }),
  ),
  commands: z.array(rcCommandSchema),
  /** 被强制停止的会话编号：插件收到即终止本地执行与横幅。 */
  stoppedSessionIds: z.array(z.number()).default([]),
  /** 令牌已失效（复权失败/被停用）：插件清令牌并要求重新登录。 */
  revoked: z.boolean().default(false),
  limits: z
    .object({
      maxSteps: z.number(),
      stepTimeoutSeconds: z.number(),
      sessionTimeoutSeconds: z.number(),
      /** 拒绝接管的域名（银行/支付/内网等）：插件在打开跳转前先拦下。 */
      blockedHosts: z.array(z.string()).default([]),
      /** 敏感动作是否需要本人在侧边栏逐条确认（账号级设置）。 */
      confirmSensitive: z.boolean().default(true),
    })
    .optional(),
});
export type RcHeartbeatResult = z.infer<typeof rcHeartbeatResultSchema>;

export const rcConfirmBodySchema = z.object({
  commandCode: z.string().min(4).max(40),
  allow: z.boolean(),
});

/** 插件侧主动入队的中断（不改会话终态，由会话引擎收口）。 */
export const rcStopBodySchema = z.object({
  sessionId: z.number().int().positive().optional(),
});

/* ---------------------------------------------------------------- 会话（页面 / Agent 用） */

/** 能力档：Act 操作页面 / Crawl 遍历抓取 / Extract 抽取结构化结果。 */
export const RC_AGENT_MODES = ["act", "crawl", "extract"] as const;
export type RcAgentMode = (typeof RC_AGENT_MODES)[number];
export const RC_AGENT_MODE_LABELS: Record<string, string> = {
  act: "操作",
  crawl: "抓取",
  extract: "抽取",
};

export const rcSessionStartBodySchema = z.object({
  clientId: z.string().min(8).max(64),
  goal: z.string().min(2).max(1000),
  /** 能力档（默认 act）：extract 追求结构化结果、crawl 顺着链接批量抓取。 */
  mode: z.enum(RC_AGENT_MODES).optional(),
  /** 起始地址（可选）：不给就让 LLM 先用当前活动页。 */
  startUrl: z.string().max(2000).optional(),
  taskId: z.number().int().nonnegative().optional(),
  maxSteps: z.number().int().min(1).max(60).optional(),
  modelKey: z.string().max(128).optional(),
  /** 确定性脚本：给出动作序列时按序回放，不调用 LLM、不产生 AI 积分。 */
  actions: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
});
export type RcSessionStartBody = z.infer<typeof rcSessionStartBodySchema>;

export const rcStepSchema = z.object({
  id: z.number(),
  stepIndex: z.number(),
  commandCode: z.string(),
  action: z.record(z.string(), z.unknown()),
  thought: z.string(),
  observation: z.record(z.string(), z.unknown()).nullable(),
  screenshotUrl: z.string(),
  status: z.string(),
  elapsedMs: z.number(),
  errorMessage: z.string(),
  createdAt: z.string(),
});
export type RcStepView = z.infer<typeof rcStepSchema>;

export const rcSessionSchema = z.object({
  id: z.number(),
  clientId: z.string(),
  deviceName: z.string(),
  goal: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  stepCount: z.number(),
  maxSteps: z.number(),
  model: z.string(),
  stopReason: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  steps: z.array(rcStepSchema).optional(),
});
export type RcSessionView = z.infer<typeof rcSessionSchema>;

export const rcSettingsSchema = z.object({
  /** 单会话最大步数（默认 25）。 */
  maxSteps: z.number(),
  /** 单动作超时（秒）。 */
  stepTimeoutSeconds: z.number(),
  /** 会话总时长上限（秒）。 */
  sessionTimeoutSeconds: z.number(),
  /** 高风险站点（hostname 或后缀，逗号/换行分隔）。 */
  blockedHosts: z.array(z.string()),
  /** 敏感动作是否要求人工确认（默认 true）。 */
  confirmSensitive: z.boolean(),
  /** 截图/观测保留天数（超期删除对象与记录）。 */
  retainDays: z.number(),
});
export type RcSettings = z.infer<typeof rcSettingsSchema>;

/** 插件登录目标是本系统自身地址：http / https 均可（本机开发常是 http），缺协议默认 https，路径前缀与当前站点一致。 */
export function normalizeLoginDomain(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.hostname.includes(" ")) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** 目标是否命中高风险站点黑名单（hostname 相等或为其子域）。 */
export function rcHostBlocked(
  url: string | null | undefined,
  blockedHosts: readonly string[],
): boolean {
  if (!url || !blockedHosts.length) return false;
  let host = "";
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return blockedHosts.some((entry) => {
    const target = String(entry || "").trim().toLowerCase();
    if (!target) return false;
    return host === target || host.endsWith(`.${target}`);
  });
}

/* ---------------------------------------------------------------- 浏览器代理（侧边栏 Agent） */

/**
 * 浏览器代理 = 侧边栏里的「聊天式 Agent」：一句话目标 → 插件侧循环（规划/选工具/执行/观测/再规划）。
 * 决策循环在插件（贴页面、低延迟），模型与平台工具走本系统网关（模型广场 ek_ + 工具目录 + 授权闸）。
 * 本段只放插件与页面共用的形状；服务端台账表见 §数据模型。
 */

/** 代理会话状态：与云端会话同一套终态口径，编排在插件、台账在云端。 */
export const RC_AGENT_STATUSES = [
  "RUNNING",
  "WAITING_CONFIRM",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
] as const;
export type RcAgentStatus = (typeof RC_AGENT_STATUSES)[number];
export const RC_AGENT_STATUS_LABELS: Record<string, string> = {
  RUNNING: "执行中",
  WAITING_CONFIRM: "等待确认",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  TIMEOUT: "已超时",
};
export function rcAgentTerminal(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "TIMEOUT"
  );
}

/** 消息角色：user 用户 / agent 代理 / tool 工具回执 / system 系统提示。 */
export const RC_MESSAGE_ROLES = ["user", "agent", "tool", "system"] as const;
export type RcMessageRole = (typeof RC_MESSAGE_ROLES)[number];

/**
 * 消息卡片种类（侧边栏按 kind 渲染对应卡片）：
 * text 文本、thought 思考（可折叠）、action 浏览器动作、tool 平台工具调用、
 * result 结构化结果、screenshot 截图、error 错误、question Agent 反问澄清。
 */
export const RC_MESSAGE_KINDS = [
  "text",
  "thought",
  "action",
  "tool",
  "result",
  "screenshot",
  "error",
  "question",
] as const;
export type RcMessageKind = (typeof RC_MESSAGE_KINDS)[number];
export const RC_MESSAGE_KIND_LABELS: Record<string, string> = {
  text: "文本",
  thought: "思考",
  action: "动作",
  tool: "工具",
  result: "结果",
  screenshot: "截图",
  error: "错误",
  question: "追问",
};

/** 一条会话消息（消息流卡片）。payload 承载卡片结构化内容，content 为可读文本。 */
export const rcAgentMessageSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  /** 会话内自增序号（界面排序与断点续传的锚点）。 */
  seq: z.number(),
  role: z.string(),
  kind: z.string(),
  content: z.string().max(8000),
  payload: z.record(z.string(), z.unknown()).default({}),
  screenshotKey: z.string().max(200).default(""),
  createdAt: z.string(),
});
export type RcAgentMessageView = z.infer<typeof rcAgentMessageSchema>;

/** 代理会话台账：目标、状态、模型、步数、额度消耗。 */
export const rcAgentSchema = z.object({
  id: z.number(),
  clientId: z.string(),
  deviceName: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  goal: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  stepCount: z.number(),
  maxSteps: z.number(),
  model: z.string(),
  /** 本会话累计消耗（先时长卡后积分，与站内 AI 用量同口径）。 */
  credits: z.number(),
  stopReason: z.string(),
  errorMessage: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  messages: z.array(rcAgentMessageSchema).optional(),
});
export type RcAgentView = z.infer<typeof rcAgentSchema>;

/** 技能种类：personal 个人偏好/工作流，site 站点操作知识。 */
export const RC_SKILL_KINDS = ["personal", "site"] as const;
export type RcSkillKind = (typeof RC_SKILL_KINDS)[number];
export const RC_SKILL_KIND_LABELS: Record<string, string> = {
  personal: "个人技能",
  site: "站点技能",
};

/** 技能（markdown）：Agent 学到长期有用的东西写进来，可读可编辑；site 类默认本账号私有。 */
export const rcSkillSchema = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  description: z.string(),
  /** markdown 正文：偏好 / 站点操作知识 / 工作流步骤。 */
  content: z.string().max(20000),
  /** site 类技能的归属站点（hostname）；personal 为空。 */
  site: z.string().max(200).default(""),
  enabled: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RcSkillView = z.infer<typeof rcSkillSchema>;

/** 录制 → 生成的工具：把一次成功操作沉淀为可复用动作序列（chrome_actions）。 */
export const rcRecordingSchema = z.object({
  id: z.number(),
  name: z.string(),
  site: z.string().max(200).default(""),
  /** 录制得到的动作序列（闭集动作），可直接作为确定性脚本回放。 */
  actions: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  stepCount: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RcRecordingView = z.infer<typeof rcRecordingSchema>;

/** 抽取结果：一次 Extract 的结构化产物（落库供导出/投递）。 */
export const rcExtractResultSchema = z.object({
  agentId: z.number(),
  url: z.string().max(2000),
  schemaNote: z.string().max(2000),
  data: z.record(z.string(), z.unknown()).default({}),
  rows: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  screenshotKey: z.string().max(200).default(""),
  createdAt: z.string(),
});
export type RcExtractResultView = z.infer<typeof rcExtractResultSchema>;

/* ---------------------------------------------------------------- 计划任务（浏览器代理定时） */

/** 计划任务开关：enabled 到点执行；paused 不进入调度。 */
export const RC_SCHEDULE_STATUS_LABELS: Record<string, string> = {
  enabled: "已启用",
  paused: "已暂停",
};
/** 最近一次执行结果标签；空串＝还没跑过。 */
export const RC_SCHEDULE_LAST_STATUS_LABELS: Record<string, string> = {
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  skipped: "已跳过",
};

/**
 * 浏览器代理的计划任务：到点让本人某台「在线」设备按同一套会话引擎跑一个目标。
 * 绿灯闸——设备离线（插件没开）当轮跳过、不排队补跑；账号停用即自动暂停。
 */
export const rcScheduleSchema = z.object({
  id: z.number(),
  clientId: z.string(),
  deviceName: z.string(),
  title: z.string(),
  goal: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  startUrl: z.string().max(2000).default(""),
  /** 确定性动作序列的步数（0＝走 LLM 决策）。 */
  scriptSteps: z.number(),
  model: z.string(),
  maxSteps: z.number(),
  /** scheduled＝定时一次；recurring＝周期重复。 */
  scheduleType: z.string(),
  scheduleTypeLabel: z.string(),
  scheduleConfig: z.record(z.string(), z.unknown()).default({}),
  /** 下一次执行时刻（ISO）；定时一次跑完即置空。 */
  scheduledAt: z.string().nullable(),
  status: z.string(),
  statusLabel: z.string(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string(),
  lastStatusLabel: z.string(),
  lastError: z.string(),
  /** 最近一次执行产生的会话 id（0＝无）。 */
  lastSessionId: z.number(),
  runCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RcScheduleView = z.infer<typeof rcScheduleSchema>;

/* ---------------------------------------------------------------- 代理语义层工具名 */

/**
 * 「Agent 语义层」工具（供外部 MCP 客户端也能用同一套浏览器代理）。
 * 浏览器侧会话已有 rc* 一组；这里补一层的名字固定，契约、MCP 目录、插件提示词共用。
 */
export const RC_AGENT_TOOL_NAMES = [
  "browser_agent_start",
  "browser_agent_status",
  "browser_agent_result",
  "browser_agent_stop",
  "browser_extract",
  "browser_skill_list",
  "browser_skill_run",
] as const;
export type RcAgentToolName = (typeof RC_AGENT_TOOL_NAMES)[number];

/**
 * 这七个工具的 MCP 参数：走专用业务字段，不走通用 read_data / write_data。
 * 设备用 client_id 指定（不给就取本人唯一在线的绿灯设备）；会话生命周期用 session_id。
 */
export const browserMcpToolArgs = {
  browser_agent_start: z
    .object({
      goal: z.string().trim().min(1).max(1000),
      client_id: z.string().trim().max(64).optional(),
      mode: z.enum(RC_AGENT_MODES).default("act"),
      start_url: z.string().trim().max(2000).optional(),
      max_steps: z.number().int().min(1).max(60).optional(),
    })
    .strict(),
  browser_agent_status: z
    .object({ session_id: z.number().int().positive() })
    .strict(),
  browser_agent_result: z
    .object({ session_id: z.number().int().positive() })
    .strict(),
  browser_agent_stop: z
    .object({ session_id: z.number().int().positive() })
    .strict(),
  browser_extract: z
    .object({
      instruction: z.string().trim().min(1).max(1000),
      client_id: z.string().trim().max(64).optional(),
      start_url: z.string().trim().max(2000).optional(),
      schema_note: z.string().trim().max(2000).optional(),
    })
    .strict(),
  browser_skill_list: z
    .object({
      kind: z.enum(["all", "personal", "site"]).default("all"),
      keyword: z.string().trim().max(100).optional(),
    })
    .strict(),
  browser_skill_run: z
    .object({
      skill: z.string().trim().min(1).max(120),
      goal: z.string().trim().max(1000).optional(),
      client_id: z.string().trim().max(64).optional(),
      start_url: z.string().trim().max(2000).optional(),
    })
    .strict(),
};
export type BrowserMcpToolName = keyof typeof browserMcpToolArgs;

/** 工具文案：与其余 MCP 工具同源，`tools/list` 与界面「MCP Server」页读这一份。 */
export const browserMcpTools: Record<
  RcAgentToolName,
  {
    title: string;
    description: string;
    annotations: Record<string, boolean>;
  }
> = {
  browser_agent_start: {
    title: "浏览器代理·发起",
    description:
      "在用户本机「在线（绿灯）」的 Chrome 设备上发起一次浏览器代理会话：给一个自然语言目标，云端逐步决策、插件在用户已登录的页面里执行。client_id 不给就取本人唯一在线的设备；有多台在线时会回列表要求指定。mode 为 act（操作）/ crawl（顺链接批量抓取）/ extract（抽取结构化）。会话异步执行，用 browser_agent_status / browser_agent_result 查进展，browser_agent_stop 可随时停。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  browser_agent_status: {
    title: "浏览器代理·进度",
    description:
      "查看一次浏览器代理会话的当前状态：状态标签、已执行步数/上限、结束原因与错误。只读，不需要设备在线。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  browser_agent_result: {
    title: "浏览器代理·结果",
    description:
      "取一次浏览器代理会话的完整结果：逐步回放（闭集动作、模型理由、页面观测、截图地址）与收尾原因。抽取类目标的结构化数据也在各步的观测里。只读。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  browser_agent_stop: {
    title: "浏览器代理·停止",
    description:
      "停止一次浏览器代理会话：会话置为已取消，未执行的在途指令作废。用户说「停下那个浏览器操作」时调用。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  browser_extract: {
    title: "浏览器代理·抽取",
    description:
      "按抽取要求（instruction，可附 schema_note 说明字段口径）在在线设备上发起一次「抽取」会话，把页面内容整理成结构化结果。与 browser_agent_start 的差别是能力档固定为 extract；结果用 browser_agent_result 取。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  browser_skill_list: {
    title: "浏览器技能·列表",
    description:
      "列出本账号沉淀的浏览器技能（personal 个人偏好/工作流、site 站点操作知识），返回名称、种类、归属站点、说明与启用状态。技能正文是长期知识，Agent 每次决策都会读到；需要正文时按名称调 browser_skill_run 或到插件技能库查看。只读。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  browser_skill_run: {
    title: "浏览器技能·运行",
    description:
      "用一条已沉淀的技能在在线设备上跑一次浏览器任务：按技能名（或技能编号）取该技能正文作为目标（给了 goal 就用 goal），技能的归属站点作为起始地址（也可用 start_url 覆盖）。返回发起的会话编号，用 browser_agent_status / browser_agent_result 跟进。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
};

/** 插件 → 平台的工具调用（走设备令牌；只允许工具目录内已登记的写类工具，默认受授权闸约束）。 */
export const rcToolCallSchema = z.object({
  /** 契约工具名（如 Mark... / Help_search / wf__<id> / Rpa_accounts）。 */
  tool: z.string().min(1).max(120),
  args: z.record(z.string(), z.unknown()).default({}),
  /** 幂等锚：同一会话内同 code 只执行一次。 */
  code: z.string().max(64).default(""),
});
export type RcToolCall = z.infer<typeof rcToolCallSchema>;

export const rcToolResultSchema = z.object({
  tool: z.string(),
  ok: z.boolean(),
  /** 结果 JSON（被授权闸拦下时为草案：needsGrant=true）。 */
  data: z.record(z.string(), z.unknown()).default({}),
  errorMessage: z.string().max(500).default(""),
  needsGrant: z.boolean().default(false),
  elapsedMs: z.number().int().nonnegative().default(0),
});
export type RcToolResult = z.infer<typeof rcToolResultSchema>;

/* ---------------------------------------------------------------- 侧边栏 Agent（插件侧循环） */

/**
 * 插件侧 Agent 循环（hybrid）：编排在插件（贴页面、延迟低），
 * 模型与工具在平台（复用模型广场的 Key/计量/时长卡与授权闸）。
 * 每一步插件把「目标 + 页面观测 + 最近历史」发到 `/decide`，平台调一次 LLM 回一个动作。
 */
export const rcAgentDecideBodySchema = z.object({
  goal: z.string().min(1).max(1000),
  /** act | crawl | extract（与 RC_AGENT_MODES 同源）。 */
  mode: z.string().max(16).default("act"),
  /** 选中的模型（空 = 跟随本账号默认模型）。 */
  modelKey: z.string().max(128).default(""),
  /** 从 0 起的步序号（第 N+1 步）。 */
  stepIndex: z.number().int().nonnegative().default(0),
  /** 当前页面的「页面地图」观测（可见交互元素清单 + 截断正文）。 */
  observation: z.record(z.string(), z.unknown()).default({}),
  /** 最近几步的执行历史（文本行）。 */
  history: z.string().max(4000).default(""),
  /** 用户是否已确认过本轮要执行的操作（首次动作前的「先确认再执行」闸）。 */
  confirmed: z.boolean().default(false),
  /** 用户随目标附上的数字资产（已存 OSS，key 可在结果里引用）。 */
  attachments: z
    .array(z.object({ name: z.string().max(200), key: z.string().max(400) }))
    .max(10)
    .default([]),
});
export type RcAgentDecideBody = z.infer<typeof rcAgentDecideBodySchema>;

export const rcAgentDecisionSchema = z.object({
  thought: z.string().default(""),
  /** 浏览器闭集动作（与 RC_ACTIONS 同源）；与 tool 二选一。 */
  action: z.record(z.string(), z.unknown()).nullable().default(null),
  /** 平台工具调用（与 rcToolCallSchema 同形）；与 action 二选一。 */
  tool: rcToolCallSchema.nullable().default(null),
  /** 敏感动作：需本人在侧边栏确认后才执行（账号设置 confirmSensitive 开启时）。 */
  needsConfirm: z.boolean().default(false),
  /** 目标已达成或无法继续时给出结束原因。 */
  finishReason: z.string().default(""),
  /** 待用户确认的操作说明：非空时插件展示成确认卡，点「确认执行」后才继续动作。 */
  confirm: z.string().default(""),
  /** Agent 直接回复用户（纯提问/闲聊/要规划、不需要操作页面时给出，插件展示成对话卡）。 */
  reply: z.string().default(""),
  /** Agent 反问澄清（信息不足时给出，插件展示成追问卡）。 */
  question: z.string().default(""),
  /** 实际选用的模型（回显，供界面显示）。 */
  model: z.string().default(""),
});
export type RcAgentDecision = z.infer<typeof rcAgentDecisionSchema>;

/** Agent 引导信息：模型清单 + 额度 + 安全设置（侧边栏 Header / 敏感闸用）。 */
export const rcAgentBootstrapSchema = z.object({
  models: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      modelKey: z.string(),
    }),
  ),
  /** 当前余额（积分）。 */
  balance: z.number(),
  /** 积分换算率（1 元 = N 积分）。 */
  rate: z.number(),
  defaultModelKey: z.string().default(""),
  limits: z.object({
    maxSteps: z.number(),
    stepTimeoutSeconds: z.number(),
    sessionTimeoutSeconds: z.number(),
    blockedHosts: z.array(z.string()).default([]),
    confirmSensitive: z.boolean().default(true),
  }),
});
export type RcAgentBootstrap = z.infer<typeof rcAgentBootstrapSchema>;
