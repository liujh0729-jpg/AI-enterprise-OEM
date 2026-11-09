import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const jsonObject = z.record(z.string(), z.unknown());
const jsonList = z.array(z.unknown());

/**
 * 智能硬件（一级栏目「智能硬件」）：硬件广场（型号 + 开发包）、添加硬件（设备 + 心跳）、
 * MCP / API 两个按型号出工具的控制入口。
 *
 * 与平台 MCP 是两套东西：端点 `/api/v1/hardware/mcp` 独立、工具命名 `hw__<modelCode>__<toolCode>`、
 * 授权闸独立（`hw_tool_grants`）。平台的 `tools/list` 不会出现硬件工具，反之亦然。
 */

/** 硬件 MCP 独立端点（与平台 `/api/v1/mcp` 分开）。 */
export const HW_MCP_ENDPOINT_PATH = "/api/v1/hardware/mcp";
export const HW_MCP_SERVER_NAME = "aiworkin-hardware-mcp";
export const HW_MCP_SERVER_TITLE = "AIworkin 智能硬件 MCP";
export const HW_MCP_SERVER_VERSION = "1.0.0";

/**
 * 硬件 MCP 的使用说明：与平台 MCP 各自一套。
 * 工具名形如 `hw__<型号编码>__<工具编码>`，只列本人可见（型号默认 + 本人自建）的工具；
 * 写动作受「工具授权闸」约束（未授权 / 无人值守只出草案）。
 */
export const HW_MCP_INSTRUCTIONS = [
  "本服务端只提供智能硬件工具：先 list_hardware_models 看有哪些型号，再 list_hardware_tools 看该型号的工具。",
  "工具名 hw__<型号编码>__<工具编码>；调用 write 类工具前需本人在「智能硬件 → 硬件MCP / 硬件API」里勾选授权，未授权只会返回草案。",
  "无人值守（定时任务 / 助理）默认不执行写动作，只出草案。",
].join("\n");

/** 设备令牌前缀：只走设备通道（心跳 / 指令 / 回执），不能调任何业务接口。 */
export const HW_DEVICE_TOKEN_PREFIX = "hw_";
export const HW_DEVICE_TOKEN_HEADER = "x-device-token";

/** 工具命名空间分隔符：`hw__<modelCode>__<toolCode>`。 */
export const HW_TOOL_NAMESPACE = "hw__";

export const HW_TOOL_KINDS = ["API", "MCP"] as const;
export type HwToolKind = (typeof HW_TOOL_KINDS)[number];
export const HW_TOOL_KIND_LABELS: Record<HwToolKind, string> = {
  API: "API",
  MCP: "MCP",
};

export const HW_TOOL_SCOPES = ["DEFAULT", "USER"] as const;
export type HwToolScope = (typeof HW_TOOL_SCOPES)[number];
export const HW_TOOL_SCOPE_LABELS: Record<HwToolScope, string> = {
  DEFAULT: "型号默认",
  USER: "我自建",
};

/** HTTP＝平台代调设备 HTTP；DEVICE＝平台下发指令、设备拉取回执。 */
export const HW_TOOL_TRANSPORTS = ["HTTP", "DEVICE"] as const;
export type HwToolTransport = (typeof HW_TOOL_TRANSPORTS)[number];
export const HW_TOOL_TRANSPORT_LABELS: Record<HwToolTransport, string> = {
  HTTP: "设备直连",
  DEVICE: "指令下发",
};

export const HW_DEVICE_STATUSES = ["ONLINE", "OFFLINE", "NEVER"] as const;
export type HwDeviceStatus = (typeof HW_DEVICE_STATUSES)[number];
export const HW_DEVICE_STATUS_LABELS: Record<HwDeviceStatus, string> = {
  ONLINE: "在线",
  OFFLINE: "离线",
  NEVER: "未激活",
};

export const HW_KIT_CHANNELS = ["STABLE", "BETA"] as const;
export type HwKitChannel = (typeof HW_KIT_CHANNELS)[number];
export const HW_KIT_CHANNEL_LABELS: Record<HwKitChannel, string> = {
  STABLE: "稳定版",
  BETA: "测试版",
};

export const HW_DEVICE_EVENT_KINDS = [
  "HEARTBEAT",
  "COMMAND",
  "RESULT",
  "STATUS",
] as const;
export type HwDeviceEventKind = (typeof HW_DEVICE_EVENT_KINDS)[number];
export const HW_DEVICE_EVENT_KIND_LABELS: Record<HwDeviceEventKind, string> = {
  HEARTBEAT: "心跳",
  COMMAND: "指令下发",
  RESULT: "设备回执",
  STATUS: "状态变更",
};

export const HW_MODEL_CODE_MAX = 48;
export const HW_MODEL_NAME_MAX = 80;
export const HW_MODEL_SUMMARY_MAX = 500;
export const HW_KIT_CHANGELOG_MAX = 1000;
export const HW_DEVICE_NAME_MAX = 80;
export const HW_TOOL_CODE_MAX = 64;
export const HW_TOOL_NAME_MAX = 80;
export const HW_TOOL_DESCRIPTION_MAX = 500;

/** 型号编码：小写字母数字与连字符（进 MCP 工具名，必须白名单）。 */
export const HW_MODEL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** 工具编码：同上，进 `hw__<model>__<tool>`。 */
export const HW_TOOL_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

/** 心跳超过该时长（秒）即判离线；设备上报周期默认 30~60 秒。 */
export const HW_OFFLINE_AFTER_SECONDS = 180;
/** DEVICE 通道指令回执超时（秒）：超时在事件流水留痕并返回明确原因。 */
export const HW_COMMAND_TIMEOUT_SECONDS = 30;
/** 每设备每分钟指令上限（G7 频控）。 */
export const HW_COMMANDS_PER_MINUTE = 30;

export const hwModelSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  vendor: z.string(),
  chip: z.string(),
  category: z.string(),
  summary: z.string(),
  coverUrl: z.string(),
  /** 能力 / 接口 / 尺寸等结构化规格。 */
  spec: jsonObject,
  featured: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  /** 已上架开发包数 / 本人已接入设备数（列表视图用）。 */
  kitCount: z.number(),
  deviceCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HwModel = z.infer<typeof hwModelSchema>;

export const hwKitSchema = z.object({
  id: z.number(),
  modelId: z.number(),
  version: z.string(),
  channel: z.enum(HW_KIT_CHANNELS),
  fileName: z.string(),
  fileSize: z.number(),
  sha256: z.string(),
  changelog: z.string(),
  docUrl: z.string(),
  minFirmware: z.string(),
  downloadCount: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HwKit = z.infer<typeof hwKitSchema>;

export const hwModelDetailSchema = hwModelSchema.extend({
  kits: z.array(hwKitSchema),
  /** 本人已接入的该型号设备（添加硬件时选设备用）。 */
  devices: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.enum(HW_DEVICE_STATUSES),
      lastSeenAt: z.string().nullable(),
    }),
  ),
});
export type HwModelDetail = z.infer<typeof hwModelDetailSchema>;

export const hwDeviceSchema = z.object({
  id: z.number(),
  modelId: z.number(),
  modelCode: z.string(),
  modelName: z.string(),
  name: z.string(),
  serialNo: z.string(),
  /** 令牌前 8 位，仅供识别；明文只在生成那一刻显示。 */
  tokenPrefix: z.string(),
  status: z.enum(HW_DEVICE_STATUSES),
  lastSeenAt: z.string().nullable(),
  lastIp: z.string(),
  firmwareVersion: z.string(),
  meta: jsonObject,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HwDevice = z.infer<typeof hwDeviceSchema>;

export const hwDeviceEventSchema = z.object({
  id: z.number(),
  kind: z.enum(HW_DEVICE_EVENT_KINDS),
  direction: z.enum(["IN", "OUT"]),
  commandCode: z.string(),
  payload: jsonObject,
  ok: z.boolean(),
  latencyMs: z.number(),
  message: z.string(),
  createdAt: z.string(),
});
export type HwDeviceEvent = z.infer<typeof hwDeviceEventSchema>;

export const hwToolSchema = z.object({
  id: z.number(),
  modelId: z.number(),
  kind: z.enum(HW_TOOL_KINDS),
  scope: z.enum(HW_TOOL_SCOPES),
  ownerUserId: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  transport: z.enum(HW_TOOL_TRANSPORTS),
  method: z.string(),
  path: z.string(),
  commandCode: z.string(),
  /** 参数 JSON Schema（API 参数表与 MCP inputSchema 同源）。 */
  params: jsonObject,
  response: jsonObject,
  examples: jsonList,
  write: z.boolean(),
  requiresGrant: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  /** 站内 Agent / 外部 MCP 看到的工具名。 */
  toolName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HwTool = z.infer<typeof hwToolSchema>;

/** 调用或试调一次硬件工具的结果。 */
export const hwToolCallResultSchema = z.object({
  ok: z.boolean(),
  /** HTTP 状态码；DEVICE 通道为 0。 */
  status: z.number(),
  latencyMs: z.number(),
  /** 设备返回的原始响应（HTTP）或回执载荷（DEVICE）。 */
  response: z.unknown(),
  message: z.string(),
  /** 未授权 / 无人值守 / 设备离线 / 超时等拦截原因。 */
  reason: z.string(),
});
export type HwToolCallResult = z.infer<typeof hwToolCallResultSchema>;

export const hwToolGrantSchema = z.object({
  toolId: z.number(),
  modelId: z.number(),
  modelCode: z.string(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(HW_TOOL_KINDS),
  transport: z.enum(HW_TOOL_TRANSPORTS),
  granted: z.boolean(),
});
export type HwToolGrant = z.infer<typeof hwToolGrantSchema>;

/* ------------------------------ 请求体 ------------------------------ */

export const hwDeviceCreateBodySchema = z.object({
  modelId: z.number().int().positive(),
  name: z.string().trim().min(1).max(HW_DEVICE_NAME_MAX),
  serialNo: z.string().trim().max(80).default(""),
});

export const hwDeviceUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(HW_DEVICE_NAME_MAX).optional(),
  serialNo: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
});

export const hwToolSaveBodySchema = z.object({
  kind: z.enum(HW_TOOL_KINDS),
  code: z.string().trim().regex(HW_TOOL_CODE_PATTERN, "工具编码只能用小写字母、数字、连字符与下划线"),
  name: z.string().trim().min(1).max(HW_TOOL_NAME_MAX),
  description: z.string().trim().max(HW_TOOL_DESCRIPTION_MAX).default(""),
  transport: z.enum(HW_TOOL_TRANSPORTS),
  method: z.string().trim().max(8).default("POST"),
  path: z.string().trim().max(300).default(""),
  commandCode: z.string().trim().max(64).default(""),
  params: jsonObject.default({}),
  response: jsonObject.default({}),
  examples: jsonList.default([]),
  write: z.boolean().default(false),
  requiresGrant: z.boolean().default(true),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type HwToolSaveBody = z.infer<typeof hwToolSaveBodySchema>;

export const hwModelSaveBodySchema = z.object({
  code: z.string().trim().regex(HW_MODEL_CODE_PATTERN, "型号编码只能用小写字母、数字与连字符"),
  name: z.string().trim().min(1).max(HW_MODEL_NAME_MAX),
  vendor: z.string().trim().max(60).default(""),
  chip: z.string().trim().max(60).default(""),
  category: z.string().trim().max(40).default(""),
  summary: z.string().trim().max(HW_MODEL_SUMMARY_MAX).default(""),
  coverUrl: z.string().trim().max(500).default(""),
  spec: jsonObject.default({}),
  featured: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type HwModelSaveBody = z.infer<typeof hwModelSaveBodySchema>;

/** 开发包的二进制先经 `/enterprise/hardware/admin/kits/upload` 直传对象存储，再带上元数据落库。 */
export const hwKitFileSchema = z.object({
  fileName: z.string().trim().max(160).default(""),
  fileSize: z.number().int().min(0).default(0),
  ossKey: z.string().trim().max(400).default(""),
  sha256: z.string().trim().max(64).default(""),
});
export type HwKitFile = z.infer<typeof hwKitFileSchema>;

export const hwKitSaveBodySchema = hwKitFileSchema.extend({
  modelId: z.number().int().positive(),
  version: z.string().trim().min(1).max(40),
  channel: z.enum(HW_KIT_CHANNELS).default("STABLE"),
  changelog: z.string().trim().max(HW_KIT_CHANGELOG_MAX).default(""),
  docUrl: z.string().trim().max(500).default(""),
  minFirmware: z.string().trim().max(40).default(""),
  enabled: z.boolean().default(true),
});

export const hwToolGrantsBodySchema = z.object({
  toolIds: z.array(z.number().int().positive()).max(500).default([]),
});

/* ------------------------------ 端点 ------------------------------ */

export const hardwareEndpoints = {
  // ---- 硬件广场：型号与开发包 ----
  Hw_models: {
    method: "get" as const,
    path: "/enterprise/hardware/models",
    params: emptyQuery,
    query: z.object({ all: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.object({ models: z.array(hwModelSchema) })),
  },
  Hw_model: {
    method: "get" as const,
    path: "/enterprise/hardware/models/:code",
    params: z.object({ code: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(hwModelDetailSchema),
  },
  Hw_kitDownload: {
    method: "get" as const,
    path: "/enterprise/hardware/kits/:id/download",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        url: z.string(),
        fileName: z.string(),
        fileSize: z.number(),
        sha256: z.string(),
      }),
    ),
  },
  // ---- 添加硬件：我的设备 ----
  Hw_devices: {
    method: "get" as const,
    path: "/enterprise/hardware/devices",
    params: emptyQuery,
    query: z.object({ modelId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        devices: z.array(hwDeviceSchema),
        online: z.number(),
        offline: z.number(),
        never: z.number(),
      }),
    ),
  },
  Hw_deviceCreate: {
    method: "post" as const,
    path: "/enterprise/hardware/devices",
    params: emptyQuery,
    query: emptyQuery,
    body: hwDeviceCreateBodySchema,
    response: envelope(
      z.object({ device: hwDeviceSchema, token: z.string() }),
    ),
  },
  Hw_deviceUpdate: {
    method: "put" as const,
    path: "/enterprise/hardware/devices/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: hwDeviceUpdateBodySchema,
    response: envelope(hwDeviceSchema),
  },
  Hw_deviceRemove: {
    method: "delete" as const,
    path: "/enterprise/hardware/devices/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Hw_deviceResetToken: {
    method: "post" as const,
    path: "/enterprise/hardware/devices/:id/token",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ device: hwDeviceSchema, token: z.string() }),
    ),
  },
  Hw_deviceEvents: {
    method: "get" as const,
    path: "/enterprise/hardware/devices/:id/events",
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ kind: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.object({ events: z.array(hwDeviceEventSchema) })),
  },
  // ---- MCP / API：按型号出工具 ----
  Hw_tools: {
    method: "get" as const,
    path: "/enterprise/hardware/models/:code/tools",
    params: z.object({ code: z.string().min(1) }),
    query: z.object({ kind: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        tools: z.array(hwToolSchema),
        granted: z.array(z.number()),
      }),
    ),
  },
  Hw_toolCreate: {
    method: "post" as const,
    path: "/enterprise/hardware/models/:code/tools",
    params: z.object({ code: z.string().min(1) }),
    query: emptyQuery,
    body: hwToolSaveBodySchema,
    response: envelope(hwToolSchema),
  },
  Hw_toolUpdate: {
    method: "put" as const,
    path: "/enterprise/hardware/tools/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: hwToolSaveBodySchema.partial(),
    response: envelope(hwToolSchema),
  },
  Hw_toolRemove: {
    method: "delete" as const,
    path: "/enterprise/hardware/tools/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Hw_toolTrial: {
    method: "post" as const,
    path: "/enterprise/hardware/tools/:id/trial",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({ deviceId: z.number().int().positive(), args: jsonObject.default({}) }),
    response: envelope(hwToolCallResultSchema),
  },
  Hw_toolGrants: {
    method: "get" as const,
    path: "/enterprise/hardware/grants",
    params: emptyQuery,
    query: z.object({ modelId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        tools: z.array(hwToolGrantSchema),
        grantedCount: z.number(),
      }),
    ),
  },
  Hw_toolSaveGrants: {
    method: "post" as const,
    path: "/enterprise/hardware/grants",
    params: emptyQuery,
    query: emptyQuery,
    body: hwToolGrantsBodySchema,
    response: envelope(
      z.object({ granted: z.number(), revoked: z.number() }),
    ),
  },
  // ---- 平台管理：型号 / 开发包 / 默认工具 ----
  AdminHw_modelList: {
    method: "get" as const,
    path: "/enterprise/hardware/admin/models",
    params: emptyQuery,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ models: z.array(hwModelSchema) })),
  },
  AdminHw_modelSave: {
    method: "post" as const,
    path: "/enterprise/hardware/admin/models",
    params: emptyQuery,
    query: emptyQuery,
    body: hwModelSaveBodySchema,
    response: envelope(hwModelSchema),
  },
  AdminHw_modelUpdate: {
    method: "put" as const,
    path: "/enterprise/hardware/admin/models/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: hwModelSaveBodySchema.partial(),
    response: envelope(hwModelSchema),
  },
  AdminHw_modelRemove: {
    method: "delete" as const,
    path: "/enterprise/hardware/admin/models/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  AdminHw_kitList: {
    method: "get" as const,
    path: "/enterprise/hardware/admin/kits",
    params: emptyQuery,
    query: z.object({ modelId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.object({ kits: z.array(hwKitSchema) })),
  },
  AdminHw_kitSave: {
    method: "post" as const,
    path: "/enterprise/hardware/admin/kits",
    params: emptyQuery,
    query: emptyQuery,
    body: hwKitSaveBodySchema,
    response: envelope(hwKitSchema),
  },
  AdminHw_kitUpdate: {
    method: "put" as const,
    path: "/enterprise/hardware/admin/kits/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: hwKitSaveBodySchema.partial(),
    response: envelope(hwKitSchema),
  },
  AdminHw_kitRemove: {
    method: "delete" as const,
    path: "/enterprise/hardware/admin/kits/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  AdminHw_toolList: {
    method: "get" as const,
    path: "/enterprise/hardware/admin/tools",
    params: emptyQuery,
    query: z.object({
      modelId: z.string().optional(),
      kind: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.object({ tools: z.array(hwToolSchema) })),
  },
  AdminHw_toolSave: {
    method: "post" as const,
    path: "/enterprise/hardware/admin/tools",
    params: emptyQuery,
    query: z.object({ modelId: z.string().min(1) }),
    body: hwToolSaveBodySchema,
    response: envelope(hwToolSchema),
  },
  AdminHw_updateTool: {
    method: "put" as const,
    path: "/enterprise/hardware/admin/tools/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: hwToolSaveBodySchema.partial(),
    response: envelope(hwToolSchema),
  },
  AdminHw_removeTool: {
    method: "delete" as const,
    path: "/enterprise/hardware/admin/tools/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
};
