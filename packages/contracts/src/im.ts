import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParams = z.object({ id: z.string().min(1) });

/**
 * IM 连接（飞书 / 企业微信）：组织级连接器。通讯录以本系统为准（推为主、拉只建立绑定），
 * 通知单向推送；OA 审批与 OKR 计划按「谁发起谁审批 / 谁完成谁回写」做镜像。
 */

export const IM_PROVIDERS = ["FEISHU", "WECOM"] as const;
export type ImProvider = (typeof IM_PROVIDERS)[number];
export const IM_PROVIDER_LABELS: Record<string, string> = {
  FEISHU: "飞书",
  WECOM: "企业微信",
};

export const IM_MODULES = [
  "APPROVAL",
  "TASK",
  "BASE",
  "LOWCODE",
  "DRIVE",
  "BI",
] as const;
export const IM_MODULE_LABELS: Record<string, string> = {
  APPROVAL: "OA 审批",
  TASK: "OKR 计划任务",
  BASE: "多维表格",
  LOWCODE: "内建应用实体",
  DRIVE: "数字资产（云文档）",
  BI: "BI 摘要",
};

export const IM_DIRECTIONS = ["PUSH", "PULL", "BOTH"] as const;
export const IM_DIRECTION_LABELS: Record<string, string> = {
  PUSH: "只推送",
  PULL: "只拉取",
  BOTH: "双向",
};

export const IM_NOTIFY_TARGETS = ["OFF", "USER", "CHAT"] as const;

/** 可推送的通知事件：白名单里勾选，未勾＝不推。 */
export const IM_NOTIFY_EVENTS = [
  "approval_pending",
  "approval_approved",
  "approval_rejected",
  "approval_returned",
  "approval_cc",
  "approval_timeout",
  "okr_target",
  "okr_report_due",
  "plan_overdue",
  "task_finished",
  "task_failed",
  "system_alert",
] as const;
export const IM_NOTIFY_EVENT_LABELS: Record<string, string> = {
  approval_pending: "待我审批",
  approval_approved: "审批通过",
  approval_rejected: "审批驳回",
  approval_returned: "审批退回",
  approval_cc: "抄送我",
  approval_timeout: "审批超时提醒",
  okr_target: "OKR 目标下发",
  okr_report_due: "汇报待填写",
  plan_overdue: "计划逾期",
  task_finished: "任务完成",
  task_failed: "任务失败",
  system_alert: "系统告警",
};

const connectorBase = {
  id: z.number(),
  provider: z.string(),
  providerLabel: z.string(),
  name: z.string(),
  corpId: z.string(),
  appId: z.string(),
  agentId: z.string(),
  hasAppSecret: z.boolean(),
  hasContactSecret: z.boolean(),
  hasEncryptKey: z.boolean(),
  webhookToken: z.string(),
  /** 填到飞书 / 企微后台的事件订阅地址 */
  webhookPath: z.string(),
  status: z.string(),
  scopes: z.array(z.string()),
  lastVerifiedAt: z.string().nullable(),
  canManage: z.boolean(),
  createdAt: z.string(),
};
export const imConnectorSchema = z.object(connectorBase);
export type ImConnector = z.infer<typeof imConnectorSchema>;

export const imMemberLinkSchema = z.object({
  id: z.number(),
  connectorId: z.number(),
  memberUserId: z.string(),
  memberName: z.string(),
  externalUserId: z.string(),
  unionId: z.string(),
  nameSnapshot: z.string(),
  mobileSnapshot: z.string(),
  departmentExternalId: z.string(),
  source: z.string(),
  status: z.string(),
  lastSyncedAt: z.string().nullable(),
});
export type ImMemberLink = z.infer<typeof imMemberLinkSchema>;

export const imMembersSchema = z.object({
  linked: z.array(imMemberLinkSchema),
  unlinked: z.array(imMemberLinkSchema),
});
export type ImMembers = z.infer<typeof imMembersSchema>;

export const imDeptLinkSchema = z.object({
  id: z.number(),
  department: z.string(),
  externalDeptId: z.string(),
  name: z.string(),
  parentExternalId: z.string(),
});
export type ImDeptLink = z.infer<typeof imDeptLinkSchema>;

export const imBindingSchema = z.object({
  id: z.number(),
  connectorId: z.number(),
  module: z.string(),
  moduleLabel: z.string(),
  objectKey: z.string(),
  direction: z.string(),
  directionLabel: z.string(),
  config: z.record(z.string(), z.unknown()),
  fieldMap: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  lastSyncAt: z.string().nullable(),
});
export type ImBinding = z.infer<typeof imBindingSchema>;

export const imEventSchema = z.object({
  id: z.number(),
  connectorId: z.number(),
  direction: z.string(),
  kind: z.string(),
  eventId: z.string(),
  objectType: z.string(),
  objectId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.string(),
  attempts: z.number(),
  error: z.string(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ImEvent = z.infer<typeof imEventSchema>;

export const imNotifyRulesSchema = z.object({
  rules: z.array(
    z.object({
      event: z.string(),
      /** OFF | USER | CHAT */
      target: z.string(),
      chatId: z.string(),
    }),
  ),
  quietHours: z.record(z.string(), z.unknown()),
});
export type ImNotifyRules = z.infer<typeof imNotifyRulesSchema>;

export const imApprovalTemplateSchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.string(),
});
export type ImApprovalTemplate = z.infer<typeof imApprovalTemplateSchema>;

export const imOverviewSchema = z.object({
  connectors: z.number(),
  linkedMembers: z.number(),
  pendingMembers: z.number(),
  failedEvents: z.number(),
  lastSyncAt: z.string().nullable(),
  providers: z.array(z.string()),
});
export type ImOverview = z.infer<typeof imOverviewSchema>;

const notifyRulesBody = z.object({
  rules: z
    .array(
      z.object({
        event: z.string().min(1).max(40),
        target: z.enum(IM_NOTIFY_TARGETS).default("OFF"),
        chatId: z.string().max(120).default(""),
      }),
    )
    .default([]),
  quietHours: z.record(z.string(), z.unknown()).default({}),
});

/** 组织 ↔ IM 的非对称映射总览：本系统人数、各 IM 成员数、已绑定与两侧未对应。 */
export const imStaffDirectorySchema = z.object({
  orgType: z.string(),
  orgUserId: z.string(),
  orgName: z.string(),
  localActive: z.number(),
  connectors: z.array(
    z.object({
      id: z.number(),
      provider: z.string(),
      providerLabel: z.string(),
      name: z.string(),
      status: z.string(),
      counts: z.object({
        imMembers: z.number(),
        linked: z.number(),
        imUnlinked: z.number(),
      }),
    }),
  ),
  locals: z.array(
    z.object({
      memberUserId: z.string(),
      memberName: z.string(),
      memberKind: z.string(),
      memberKindLabel: z.string(),
      department: z.string(),
      links: z.array(
        z.object({
          id: z.number(),
          connectorId: z.number(),
          provider: z.string(),
          providerLabel: z.string(),
          externalUserId: z.string(),
          name: z.string(),
          status: z.string(),
        }),
      ),
    }),
  ),
  imOnly: z.array(
    z.object({
      connectorId: z.number(),
      provider: z.string(),
      providerLabel: z.string(),
      externalUserId: z.string(),
      name: z.string(),
      mobile: z.string(),
      status: z.string(),
    }),
  ),
});
export type ImStaffDirectory = z.infer<typeof imStaffDirectorySchema>;

export const imEndpoints = {
  Im_connectors: {
    method: "get" as const,
    path: "/enterprise/im/connectors",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(imConnectorSchema)),
  },
  Im_saveConnector: {
    method: "post" as const,
    path: "/enterprise/im/connectors",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().optional(),
        provider: z.enum(IM_PROVIDERS),
        name: z.string().min(1).max(80),
        corpId: z.string().max(120).default(""),
        appId: z.string().max(120).default(""),
        appSecret: z.string().max(200).default(""),
        agentId: z.string().max(64).default(""),
        contactSecret: z.string().max(200).default(""),
        verificationToken: z.string().max(120).default(""),
        encryptKey: z.string().max(120).default(""),
        status: z.enum(["active", "disabled"]).default("active"),
        scopes: z.array(z.string()).default([]),
      })
      .passthrough(),
    response: envelope(imConnectorSchema),
  },
  Im_deleteConnector: {
    method: "delete" as const,
    path: "/enterprise/im/connectors/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Im_testConnector: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/test",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        ok: z.boolean(),
        message: z.string(),
        detail: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  Im_staffDirectory: {
    method: "get" as const,
    path: "/enterprise/im/staff-directory",
    params: z.object({}),
    query: z.object({ connectorId: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(imStaffDirectorySchema),
  },
  Im_members: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/members",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(imMembersSchema),
  },
  Im_importMembers: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/members/import",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        pulled: z.number(),
        matched: z.number(),
        unlinked: z.number(),
      }),
    ),
  },
  Im_linkMember: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/members/link",
    params: idParams,
    query: emptyQuery,
    body: z.object({
      memberUserId: z.string().min(1).max(64),
      externalUserId: z.string().min(1).max(120),
    }),
    response: envelope(imMemberLinkSchema),
  },
  Im_unlinkMember: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/members/unlink",
    params: idParams,
    query: emptyQuery,
    body: z.object({ linkId: z.coerce.number().int().positive() }),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Im_inviteUnlinked: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/members/invite",
    params: idParams,
    query: emptyQuery,
    body: z.object({
      externalUserId: z.string().min(1).max(120),
      memberUserId: z.string().min(1).max(64),
    }),
    response: envelope(z.object({ invited: z.boolean(), message: z.string() })),
  },
  Im_departments: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/departments",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(imDeptLinkSchema)),
  },
  Im_saveDeptLink: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/departments",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        department: z.string().min(1).max(64),
        externalDeptId: z.string().min(1).max(120),
        name: z.string().max(120).default(""),
        parentExternalId: z.string().max(120).default(""),
      })
      .passthrough(),
    response: envelope(imDeptLinkSchema),
  },
  Im_bindings: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/bindings",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(imBindingSchema)),
  },
  Im_saveBinding: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/bindings",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        id: z.number().optional(),
        module: z.enum(IM_MODULES),
        objectKey: z.string().min(1).max(120),
        direction: z.enum(IM_DIRECTIONS).default("PUSH"),
        config: z.record(z.string(), z.unknown()).default({}),
        fieldMap: z.record(z.string(), z.string()).default({}),
        enabled: z.boolean().default(true),
      })
      .passthrough(),
    response: envelope(imBindingSchema),
  },
  Im_deleteBinding: {
    method: "delete" as const,
    path: "/enterprise/im/connectors/:id/bindings/:bindingId",
    params: z.object({ id: z.string().min(1), bindingId: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Im_bindingTest: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/bindings/test",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        module: z.enum(IM_MODULES),
        config: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(z.object({ ok: z.boolean(), message: z.string() })),
  },
  Im_syncNow: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/sync",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        module: z.enum(["CONTACTS", "APPROVAL", "TASK"]).default("CONTACTS"),
      })
      .passthrough(),
    response: envelope(
      z.object({
        ok: z.boolean(),
        message: z.string(),
        pushed: z.number(),
        pulled: z.number(),
      }),
    ),
  },
  Im_syncLogs: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/logs",
    params: idParams,
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(imEventSchema)),
  },
  Im_retryEvent: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/events/:eventId/retry",
    params: z.object({ id: z.string().min(1), eventId: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(imEventSchema),
  },
  Im_notifyRules: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/notify",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(imNotifyRulesSchema),
  },
  Im_saveNotifyRules: {
    method: "put" as const,
    path: "/enterprise/im/connectors/:id/notify",
    params: idParams,
    query: emptyQuery,
    body: notifyRulesBody,
    response: envelope(imNotifyRulesSchema),
  },
  Im_testNotify: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/notify/test",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        target: z.enum(["USER", "CHAT"]).default("CHAT"),
        chatId: z.string().max(120).default(""),
        memberUserId: z.string().max(64).default(""),
      })
      .passthrough(),
    response: envelope(z.object({ ok: z.boolean(), message: z.string() })),
  },
  Im_approvalTemplates: {
    method: "get" as const,
    path: "/enterprise/im/connectors/:id/approval-templates",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(imApprovalTemplateSchema)),
  },
  Im_publishApproval: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/publish-approval",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        templateKey: z.string().min(1).max(120),
        /** 飞书：可一键发成新定义；企微：只能绑已有模板 ID */
        externalTemplateId: z.string().max(120).default(""),
      })
      .passthrough(),
    response: envelope(imBindingSchema),
  },
  Im_taskPublish: {
    method: "post" as const,
    path: "/enterprise/im/connectors/:id/task-publish",
    params: idParams,
    query: emptyQuery,
    body: z
      .object({
        planIds: z.array(z.number().int().positive()).default([]),
        tasklistId: z.string().max(120).default(""),
      })
      .passthrough(),
    response: envelope(
      z.object({
        pushed: z.number(),
        skipped: z.number(),
        message: z.string(),
      }),
    ),
  },
  Im_overview: {
    method: "get" as const,
    path: "/enterprise/im/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(imOverviewSchema),
  },
};
