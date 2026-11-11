import { z } from "zod";
import { agentActionLabel, agentDomainLabel } from "./agent";
import { browserMcpToolArgs, browserMcpTools } from "./chrome-rpa";
import { endpoints } from "./endpoints";
import { mailMcpToolArgs } from "./mail";

/**
 * 本站 MCP 服务端的对外契约：端点、JSON-RPC 信封、工具清单与授权闸口径。
 * 工具只有 6 个稳定元工具，本站全部接口由 `list_operations` 从契约层派生出来，
 * 因此新增业务接口不改 MCP 代码就能被外部客户端发现——和意图记忆同一个道理。
 */

export const MCP_SERVER_NAME = "aiworkin-enterprise-mcp";
export const MCP_SERVER_TITLE = "AIworkin Enterprise MCP Server";
export const MCP_SERVER_VERSION = "1.0.0";
export const MCP_ENDPOINT_PATH = "/api/v1/mcp";
/** 本站机器通道 Key 的固定前缀（AIworkin 平台的 sk- Key 不能用于 MCP）。 */
export const MCP_API_KEY_PREFIX = "ek_";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_PROTOCOL_FALLBACKS = ["2025-03-26", "2024-11-05"] as const;

/** JSON-RPC 2.0 标准错误码；-32603 之外一律由服务端主动返回，不借本站的 code/message 信封。 */
export const MCP_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

/**
 * 永久排除清单：即使用户在「智能体记忆 → 可自动执行的动作」里也勾不上，MCP 一律不自动执行。
 * 键必须逐字是契约层的 operationId（`scripts/verify-enterprise-agent.mjs` 断言它们存在且都是写请求）。
 * 命中这些动作的请求仍可由用户本人在界面上手工发起，锁的只是「无人值守自动执行」。
 */
export const MCP_FORBIDDEN_ACTIONS: Record<string, string> = {
  // 招聘 AI：确认投递会以本人名义向外部招聘渠道提交简历，必须由本人在界面上确认。
  Recruit_confirmApplication: "对外投递需要本人确认",
  Recruit_updateApplicationStatus: "投递状态变更需要本人确认",
  Im_saveConnector: "IM 连接写操作只允许在站内完成",
  Im_deleteConnector: "IM 连接写操作只允许在站内完成",
  Im_syncNow: "IM 同步写操作只允许在站内完成",
  Im_publishApproval: "IM 审批发布只允许在站内完成",
  Im_taskPublish: "IM 任务推送只允许在站内完成",
  Im_saveBinding: "IM 同步对象写操作只允许在站内完成",
  // 创意社区：Key 只能人亲自在界面里粘贴（与上游签发口径一致，一条 MCP 指令不该能换掉账户凭据）；
  // 跑一次工作流花的是用户自己 Comfy Cloud 订阅的积分，不归无人值守自动执行。
  Community_saveCredential: "Comfy Cloud API Key 只能由本人在界面上填写",
  Community_clearCredential: "Comfy Cloud 凭据解除只能由本人在界面上操作",
  Community_run: "运行会消耗本人 Comfy Cloud 订阅积分，需要本人确认",
  Contracts_create: "签约发起需要本人确认",
  Contracts_confirm: "签约成立需要本人确认",
  Contracts_terminate: "签约解除需要本人确认",
  OpenApi_createContract: "机器通道发起签约需要本人确认",
  Tax_submitMaterialPack: "报税材料提交需要本人确认",
  External_submit: "外报提交需要本人确认",
  External_retry: "外报重新提交需要本人确认",
  Qxy_autoFile: "企享云自动报税归档需要本人确认",
  Invoice_create: "开票申请需要本人确认",
  Invoice_approve: "开票核准需要本人确认",
  Qxy_autoInvoice: "企享云自动开票需要本人确认",
  AliyunCall_createImport: "外呼号码导入会产生费用",
  AliyunCall_retryImport: "外呼号码重导会产生费用",
  Crm_approve: "审批结论需要本人确认",
  Crm_reject: "审批结论需要本人确认",
  Crm_addSign: "审批加签需要本人确认",
  Crm_returnBack: "审批退回需要本人确认",
  Crm_revokeApproval: "审批撤回需要本人确认",
  Crm_voidContract: "合同作废需要本人确认",
  Crm_voidQuotation: "报价作废需要本人确认",
  Crm_removePaymentRecord: "删除回款记录需要本人确认",
  Crm_mergeCustomers: "客户合并不可回退，需要本人确认",
  Crm_removeLeadPool: "删除线索池需要本人确认",
  Crm_removeCustomerPool: "删除客户公海需要本人确认",
  Crm_saveApprovalFlow: "审批流配置需要本人确认",
  Crm_saveMember: "成员权限变更需要本人确认",
  Bi_createDatasource: "数据源凭据与连接只能由本人配置",
  Bi_updateDatasource: "数据源凭据与连接只能由本人配置",
  Bi_removeDatasource: "删除数据源需要本人确认",
  Bi_saveDatasetPermission: "数据集权限变更需要本人确认",
  Bi_saveMember: "成员权限变更需要本人确认",
  Bi_removeDataset: "删除数据集需要本人确认",
  Bi_removeDashboard: "删除仪表板需要本人确认",
  Okr_cycleClose: "关闭 OKR 周期需要本人确认",
  Okr_objectiveDelete: "删除 OKR 目标不可回退，需要本人确认",
  Okr_krDelete: "删除关键结果不可回退，需要本人确认",
  Okr_settingsSave: "OKR 设置变更需要本人确认",
  Oa_approve: "审批结论需要本人确认",
  Oa_reject: "审批结论需要本人确认",
  Oa_return: "审批退回需要本人确认",
  Oa_transfer: "审批转交需要本人确认",
  Oa_addSign: "审批加签需要本人确认",
  Oa_withdraw: "撤销申请需要本人确认",
  Tp_saveAccount: "企点凭据只能由本人配置",
  Tp_deleteAccount: "删除企点凭据需要本人确认",
  Tp_cdpImportCustomers: "写入企点客户名单需要本人确认",
  Tp_cdpCreateTag: "创建企点外部标签需要本人确认",
  Tp_cdpApplyTags: "批量打标会改动企点客户资料，需要本人确认",
  Tp_cdpCreateSegment: "创建企点分群需要本人确认",
  Tp_cdpExportSegment: "分群成员导出含个人信息，需要本人确认",
  Tp_crmImport: "写入本系统 CRM 客户需要本人确认",
  Tp_scrmSaveCode: "企微活码变更需要本人确认",
  Tp_scrmDeleteCode: "删除企微活码需要本人确认",
  Tp_scrmWelcome: "欢迎语会真实触达客户，需要本人确认",
  Tp_scrmSaveMassTask: "群发客户任务会真实触达，需要本人确认",
  Tp_scrmControlMassTask: "停止或催办群发任务需要本人确认",
  Tp_scrmFollowupDone: "标记跟进完成需要本人确认",
  Tp_lmSaveMember: "会员资料变更需要本人确认",
  Tp_lmMemberStatus: "会员启停需要本人确认",
  Tp_lmIssuePoints: "发放积分有真实成本，需要本人确认",
  Tp_lmCouponIssue: "发放优惠券有真实成本，需要本人确认",
  Tp_maCreateTemplate: "短信/邮件模板提交需要本人确认",
  Tp_maSaveShortLink: "短链变更需要本人确认",
  Tp_maDeleteShortLink: "删除短链会让已发出的链接失效，需要本人确认",
  Tp_maMassSend: "群发任务会产生费用并真实触达，需要本人确认",
  Tp_rtaUploadAudience: "广告人群上传需要本人确认",
  // ERP 进销存：审批结论、资金收付、库存流水都会直接改动账面，只能由本人在界面上确认。
  Erp_decideStockRequest: "库存申请审批结论需要本人确认",
  Erp_decidePurchaseOrder: "采购订单审批结论需要本人确认",
  Erp_decideReceipt: "入库单审批结论需要本人确认",
  Erp_decideExpense: "费用报销审批结论需要本人确认",
  Erp_receivePayment: "核销收款会改动应收账款，需要本人确认",
  Erp_payPayable: "核销付款会改动应付账款，需要本人确认",
  Erp_saveMove: "库存出入库流水会直接改动库存，需要本人确认",
  Tp_retryTask: "重试会重新执行原写动作，需要本人确认",
  Tp_saveMapping: "列映射配置需要本人确认",
};

/**
 * 不进 `list_operations` 的五个域：
 * `admin`＝平台管理后台（机器通道的身份恒为普通账号，本就不该看得见）；
 * `agent`＝智能体记忆自身（否则外部客户端能改「可自动执行的动作」勾选，等于自己给自己授权）；
 * `mcp`＝MCP 端点自身（避免 MCP 里再套一层 MCP 递归调用）；
 * `apps`＝应用市场（第三方公开目录的只读镜像，本站只做展示，不对机器通道开放）；
 * `mail`＝邮箱配置（主机、端口、密码永远只能人手工填，机器通道改用五个专用 mail_* 工具收发邮件）。
 */
export const MCP_EXCLUDED_DOMAINS = [
  "admin",
  "agent",
  "mcp",
  "apps",
  "mail",
] as const;
/**
 * 铸造/吊销本站机器通道 Key 与上游平台 Key 的动作：Key 只能由人在界面上签发，
 * 否则一条 MCP 指令就能给自己造一把新钥匙，授权闸形同虚设。
 */
export const MCP_EXCLUDED_OPERATIONS = [
  "Identity_createKey",
  "Identity_resetKey",
  "Identity_revokeKey",
  "OpenApi_syncKey",
  "Aiworkin_createApiKey",
] as const;

/** 业务域＝`enterprise` / `api/v1` 前缀后的第一段，与意图记忆同一套解析口径。 */
export function mcpDomainOfPath(rawPath: string): string {
  const segments = rawPath.split("/").filter(Boolean);
  if (segments[0] === "api" && segments[1] === "v1") return segments[2] ?? "";
  if (segments[0] === "enterprise") return segments[1] ?? "";
  return segments[0] ?? "";
}

export type McpOperationRef = {
  operationId: string;
  /** 小写 HTTP 方法 */
  method: string;
  path: string;
  domain: string;
  domainLabel: string;
  /** 中文动作名，与「智能体记忆」操作流同一份词表 */
  label: string;
  write: boolean;
};

const EXCLUDED_DOMAINS = new Set<string>(MCP_EXCLUDED_DOMAINS);
const EXCLUDED_OPERATIONS = new Set<string>(MCP_EXCLUDED_OPERATIONS);

/** `list_operations` 与开发者文档页共用的接口索引：一份派生，不写第二份清单。 */
export function mcpOperations(): McpOperationRef[] {
  const rows: McpOperationRef[] = [];
  for (const [operationId, definition] of Object.entries(endpoints)) {
    if (EXCLUDED_OPERATIONS.has(operationId)) continue;
    const method = String(definition.method).toLowerCase();
    const path = String(definition.path);
    const domain = mcpDomainOfPath(path);
    if (!domain || EXCLUDED_DOMAINS.has(domain)) continue;
    rows.push({
      operationId,
      method,
      path,
      domain,
      domainLabel: agentDomainLabel(domain),
      label: agentActionLabel(operationId),
      write: method !== "get",
    });
  }
  return rows;
}

const pathParamBag = z.record(z.string(), z.union([z.string(), z.number()]));
const looseBag = z.record(z.string(), z.unknown());

/** 六个元工具的参数：服务端用它校验，`tools/list` 用同一份派生 JSON Schema 对外发布。 */
export const mcpToolArgs = {
  describe_capabilities: z.object({}).strict(),
  list_operations: z
    .object({
      domain: z.string().trim().min(1).max(32).optional(),
      keyword: z.string().trim().min(1).max(64).optional(),
      mode: z.enum(["all", "read", "write", "granted"]).default("all"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).max(10000).default(0),
    })
    .strict(),
  get_operation: z
    .object({ operationId: z.string().trim().min(1).max(64) })
    .strict(),
  read_data: z
    .object({
      operationId: z.string().trim().min(1).max(64),
      pathParams: pathParamBag.default({}),
      query: looseBag.default({}),
    })
    .strict(),
  write_data: z
    .object({
      operationId: z.string().trim().min(1).max(64),
      pathParams: pathParamBag.default({}),
      query: looseBag.default({}),
      body: looseBag.default({}),
      dryRun: z.boolean().default(false),
    })
    .strict(),
  analyze_memory: z
    .object({ eventLimit: z.number().int().min(1).max(50).default(20) })
    .strict(),
  /** 邮件五个专用工具：参数是业务字段（mailboxId / key / body），不接受 operationId。 */
  ...mailMcpToolArgs,
  /** 浏览器代理七个专用工具：设备在线（绿灯）时把任务派给本人本机的 Chrome。 */
  ...browserMcpToolArgs,
};
export type McpToolName = keyof typeof mcpToolArgs;
const isMcpToolName = (name: string): name is McpToolName =>
  Object.hasOwn(mcpToolArgs, name);
export const MCP_TOOL_NAMES = Object.keys(mcpToolArgs).filter(isMcpToolName);

/**
 * 工具文案是 Codex／Claude／Cursor 唯一能读到的说明书，所以每条都写清前置条件与闸口径。
 * 界面「MCP Server」页读同一份文案，不另写一套。
 */
export const MCP_TOOLS: Record<
  McpToolName,
  {
    title: string;
    description: string;
    annotations: Record<string, boolean>;
  }
> = {
  describe_capabilities: {
    title: "能力自述",
    description:
      "返回本服务端身份、鉴权头、可调用的读写接口数量、当前账号已勾选可自动执行的动作、永久排除清单与推荐调用顺序。建议每次会话先调用一次。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  list_operations: {
    title: "接口清单",
    description:
      "按业务域、关键词、读/写/已授权筛出本站可调用的接口，返回 operationId、中文动作名、方法与路径。不含参数结构，需要参数结构时再调 get_operation。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_operation: {
    title: "接口详情",
    description:
      "返回单个接口的路径参数、查询参数、请求体 JSON Schema，以及本账号最近一次执行该动作的参数摘要（已过脱敏），便于按用户已有习惯预填。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  read_data: {
    title: "读取数据",
    description:
      "执行一个 GET 接口，零副作用，不需要授权。operationId 必须来自 list_operations，pathParams/query 按其参数结构填写；返回本站统一信封的 data。",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  write_data: {
    title: "写入数据",
    description:
      "执行一个写接口。只有用户在本账号「智能体记忆 → 可自动执行的动作」里勾选过的动作才真正落库；未勾选或永久排除的动作只返回草案（executed=false），不会有任何副作用。dryRun=true 时无论是否授权都只返回草案。执行与草案都会写入智能体记忆和操作留痕。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  analyze_memory: {
    title: "分析记忆",
    description:
      "汇总本账号的智能体记忆：总量与时间跨度、业务域分布、高频动作、最近操作流、已沉淀的表单偏好、已授权动作。用于在执行指令前先理解用户的使用习惯。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  mail_list_mailboxes: {
    title: "邮箱账号列表",
    description:
      "返回本账号已启用的邮箱：mailboxId、邮箱地址、回复方式（只写草稿／写草稿并自动回复）、单轮上限与今日已发送/已出草稿计数。收发邮件前先用它拿到 mailboxId。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  mail_list_messages: {
    title: "邮件列表",
    description:
      "实时读取指定邮箱最近若干小时的邮件（只读服务器，不落库），返回去重键 key、主题、发件人、收件时间与附件标记。key 是 mail_read_message / mail_create_draft / mail_send_reply 的唯一凭据；mailboxId 必须在本次任务指定的邮箱范围内。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  mail_read_message: {
    title: "读取邮件详情",
    description:
      "按 key 读取单封邮件的收件人、正文与附件名称（附件不下载）。正文只在这次响应里出现，服务端不留存。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  mail_create_draft: {
    title: "生成回复草稿",
    description:
      "按 key 起草回复并保存为草稿：IMAP 存到服务器草稿箱，POP3 无草稿箱时只在本次结果里返回正文供用户复制。不会发出任何邮件，任何回复方式的邮箱都可用。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  mail_send_reply: {
    title: "发送邮件回复",
    description:
      "按 key 直接发出回复。只有该邮箱回复方式为「写草稿并自动回复」且用户已在「可自动执行的动作」里勾选 Mail_sendReply 时才真正发送，否则返回 executed=false 的草案；同一发件人每天最多自动回复一次。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  ...browserMcpTools,
};

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: looseBag.optional(),
  })
  .passthrough();
export type McpJsonRpcRequest = z.infer<typeof mcpJsonRpcRequestSchema>;

export const mcpJsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const mcpJsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  result: looseBag.optional(),
  error: mcpJsonRpcErrorSchema.optional(),
});
export type McpJsonRpcResponse = z.infer<typeof mcpJsonRpcResponseSchema>;

/** initialize 回给客户端的说明书：把「先分析记忆、未授权只出草案」的口径写进 instructions。 */
export const MCP_INSTRUCTIONS = [
  "这是 AIworkin Enterprise 的 MCP Server，Codex、Claude Desktop、Cursor、自研脚本和 Workbuddy 平权使用。",
  "调用顺序：describe_capabilities → analyze_memory（理解本账号的使用习惯）→ list_operations / get_operation（找接口）→ read_data（取数）→ write_data（写入）。",
  "一次 HTTP 请求承载一条 JSON-RPC 消息；tools/call 的结果同时放在 structuredContent 与 content 里，请优先读 structuredContent。",
  "身份就是这把 ek_ Key 所属的登录账号：看不到别人账号的数据，也调不到平台管理后台接口。",
  "写动作只有该账号在「智能体记忆 → 可自动执行的动作」里勾选过的才会真正执行；未勾选的返回 executed=false 的草案，请把草案交给用户确认后再由用户勾选授权。",
  "签约成立/解除、报税提交、开票申请、外呼号码导入属于永久排除项，无论如何都不自动执行。",
  "收发邮件用 mail_list_mailboxes → mail_list_messages → mail_read_message → mail_create_draft / mail_send_reply 这五个专用工具；邮箱主机、端口与密码只能由用户本人在「AI邮箱服务」界面填写，机器通道不提供配置接口。",
  "要让 Agent 在用户自己的浏览器里干活（rtrvr 式浏览器代理），用 browser_agent_start / browser_agent_status / browser_agent_result / browser_agent_stop 这一组；设备必须是「在线（绿灯）」状态，离线时请让用户在 AIPDD Enterprise 插件里登录并保持侧边栏在线。抽取用 browser_extract，用户沉淀的技能用 browser_skill_list / browser_skill_run。发起会话会接管用户浏览器，属敏感操作。",
].join("\n");

/**
 * MCP 服务端只登记一个端点：JSON-RPC 信封自成一格，不进本站统一的 code/message/data 处理，
 * 所以它单独成表，不混进 `endpoints`（那张表的每个响应都带 `data`）。
 */
export const mcpEndpoints = {
  Mcp_handle: {
    method: "post" as const,
    path: MCP_ENDPOINT_PATH,
    params: z.object({}),
    query: z.object({}),
    body: mcpJsonRpcRequestSchema,
    response: mcpJsonRpcResponseSchema,
  },
};
