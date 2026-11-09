import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 企业微信 SCRM 契约（《企微SCRM一体化方案》§6/§7）。
 * 客户以企微为源、本地镜像；原生 SCRM 是唯一客户同步源（启用后暂停企点客户同步）。
 * 所有管理端点按组织键隔离，跨组织一律 404。
 */

export const SCRM_CONTACT_STATUS = ["ACTIVE", "LOST"] as const;
export const SCRM_FIELD_TYPES = [
  "TEXT",
  "SELECT",
  "MULTI",
  "DATE",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "BIRTHDAY",
  "IMAGE",
] as const;
export const SCRM_TAG_SOURCES = ["WECOM", "AUTO", "MANUAL"] as const;
export const SCRM_STAFF_STRATEGIES = ["ROUND_ROBIN", "FIXED", "WEIGHTED"] as const;
export const SCRM_WELCOME_SCOPES = ["ALL", "STAFF", "CHAT"] as const;
export const SCRM_MASS_TYPES = ["CONTACT", "CHAT", "MOMENT"] as const;
export const SCRM_MASS_STATUS = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUBMITTED",
  "DONE",
  "PARTIAL",
  "FAILED",
] as const;
export const SCRM_TRANSFER_KINDS = ["CONTACT", "CHAT"] as const;
export const SCRM_TRANSFER_TYPES = ["ACTIVE", "RESIGN"] as const;
export const SCRM_TRANSFER_STATUS = ["PENDING", "PROCESSING", "DONE", "FAILED"] as const;
export const SCRM_SOP_TRIGGERS = ["JOIN", "TAG", "KEYWORD", "SCHEDULE", "MANUAL"] as const;
export const SCRM_SOP_ACTIONS = ["WELCOME", "MATERIAL", "MASS", "TASK", "NOTIFY", "TAG"] as const;
export const SCRM_SENSITIVE_ACTIONS = ["ALERT", "BLOCK", "REPLACE"] as const;
export const SCRM_SENSITIVE_DIRECTIONS = ["INBOUND", "OUTBOUND", "CHAT"] as const;
export const SCRM_MATERIAL_TYPES = ["TEXT", "IMAGE", "LINK", "MINIPROGRAM", "FILE"] as const;
export const SCRM_SYNC_SCOPES = ["ALL", "CONTACTS", "TAGS", "CHATS"] as const;

export const scrmSettingsSchema = z.object({
  configured: z.boolean(),
  corpId: z.string(),
  corpName: z.string(),
  agentId: z.string(),
  status: z.string(),
  enabled: z.boolean(),
  hasContactSecret: z.boolean(),
  hasAppSecret: z.boolean(),
  hasCallback: z.boolean(),
  callbackUrl: z.string(),
  syncSource: z.string(),
  qidianPaused: z.boolean(),
  lastSyncAt: z.string(),
  lastSyncResult: z.string(),
});

export const saveScrmSettingsBodySchema = z.object({
  corpId: z.string().min(1).max(64),
  corpName: z.string().max(120).default(""),
  agentId: z.string().max(32).default(""),
  contactSecret: z.string().max(300).optional(),
  appSecret: z.string().max(300).optional(),
  callbackToken: z.string().max(200).optional(),
  aesKey: z.string().max(200).optional(),
  archiveSecret: z.string().max(300).optional(),
  archivePrivateKey: z.string().max(8000).optional(),
  enabled: z.boolean().default(true),
});

export const scrmStaffRefSchema = z.object({
  userId: z.string(),
  name: z.string(),
});

export const scrmContactTagSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  source: z.string(),
});

export const scrmContactSchema = z.object({
  id: z.number(),
  externalUserId: z.string(),
  name: z.string(),
  avatar: z.string(),
  gender: z.string(),
  region: z.string(),
  remark: z.string(),
  description: z.string(),
  status: z.string(),
  sourceCodeId: z.number(),
  sourceCodeName: z.string(),
  addedAt: z.string(),
  lostAt: z.string(),
  lostReason: z.string(),
  lastInteractionAt: z.string(),
  crmLeadId: z.number(),
  crmCustomerId: z.number(),
  staff: z.array(scrmStaffRefSchema),
  tags: z.array(scrmContactTagSchema),
  chatCount: z.number(),
});

export const scrmContactFieldValueSchema = z.object({
  fieldKey: z.string(),
  /** 字段名与类型在详情/侧边栏读取时带上，写入时由后端按定义覆盖 */
  label: z.string().optional(),
  type: z.string().optional(),
  value: z.union([z.string(), z.array(z.string())]),
});

export const scrmTimelineSchema = z.object({
  id: z.number(),
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  at: z.string(),
});

export const scrmContactDetailSchema = scrmContactSchema.extend({
  fields: z.array(scrmContactFieldValueSchema),
  chats: z.array(
    z.object({
      id: z.number(),
      chatId: z.string(),
      name: z.string(),
      ownerStaffName: z.string(),
      memberCount: z.number(),
    }),
  ),
  timeline: z.array(scrmTimelineSchema),
});

export const scrmContactQuerySchema = pageQuerySchema.extend({
  keyword: z.string().max(100).optional(),
  status: z.enum(SCRM_CONTACT_STATUS).optional(),
  staffUserId: z.string().max(64).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  codeId: z.coerce.number().int().positive().optional(),
  crmCustomerId: z.coerce.number().int().positive().optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
});

export const updateScrmContactBodySchema = z.object({
  id: z.number().int().positive(),
  remark: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
});

export const promoteScrmContactBodySchema = z.object({
  id: z.number().int().positive(),
});

export const assignScrmContactBodySchema = z.object({
  id: z.number().int().positive(),
  staffUserId: z.string().min(1).max(64),
});

export const batchScrmTagBodySchema = z.object({
  contactIds: z.array(z.number().int().positive()).min(1).max(200),
  addTagIds: z.array(z.number().int().positive()).max(50).default([]),
  removeTagIds: z.array(z.number().int().positive()).max(50).default([]),
});

export const batchScrmTagFilterBodySchema = z.object({
  keyword: z.string().max(100).optional(),
  status: z.enum(SCRM_CONTACT_STATUS).optional(),
  staffUserId: z.string().max(64).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  addTagIds: z.array(z.number().int().positive()).max(50).default([]),
  removeTagIds: z.array(z.number().int().positive()).max(50).default([]),
});

export const scrmFieldSchema = z.object({
  id: z.number(),
  key: z.string(),
  label: z.string(),
  type: z.string(),
  options: z.array(z.string()),
  required: z.boolean(),
  sort: z.number(),
  builtin: z.boolean(),
  description: z.string(),
});

export const saveScrmFieldBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  key: z.string().max(40).optional(),
  label: z.string().min(1).max(40),
  type: z.enum(SCRM_FIELD_TYPES),
  options: z.array(z.string().max(40)).max(50).default([]),
  required: z.boolean().default(false),
  sort: z.number().int().min(0).max(999).default(0),
  description: z.string().max(200).default(""),
});

export const saveScrmContactFieldsBodySchema = z.object({
  contactId: z.number().int().positive(),
  values: z.array(scrmContactFieldValueSchema).max(200),
});

export const scrmTagSchema = z.object({
  id: z.number(),
  externalId: z.string(),
  name: z.string(),
  color: z.string(),
  sort: z.number(),
  usageCount: z.number(),
});

export const scrmTagGroupSchema = z.object({
  id: z.number(),
  externalId: z.string(),
  name: z.string(),
  sort: z.number(),
  tags: z.array(scrmTagSchema),
});

export const scrmAutoTagRuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  event: z.string(),
  conditions: z.record(z.string(), z.unknown()),
  tagIds: z.array(z.number()),
  codeIds: z.array(z.number()),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const saveScrmAutoTagBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(60),
  /** ADD 新客户 | CODE 活码来源；关键词/群事件需要会话存档，首期不开放 */
  event: z.enum(["ADD", "CODE"]).default("ADD"),
  conditions: z.record(z.string(), z.unknown()).default({}),
  tagIds: z.array(z.number().int().positive()).min(1).max(30),
  codeIds: z.array(z.number().int().positive()).max(50).default([]),
  enabled: z.boolean().default(true),
});

export const scrmCodeStaffSchema = z.object({
  staffUserId: z.string(),
  name: z.string(),
  weight: z.number(),
  dailyLimit: z.number(),
  usedToday: z.number(),
});

export const scrmCodeSchema = z.object({
  id: z.number(),
  name: z.string(),
  groupName: z.string(),
  configId: z.string(),
  qrUrl: z.string(),
  scene: z.string(),
  tagIds: z.array(z.number()),
  tagNames: z.array(z.string()),
  welcomeId: z.number(),
  staffStrategy: z.string(),
  dailyLimit: z.number(),
  status: z.string(),
  scanned: z.number(),
  added: z.number(),
  staff: z.array(scrmCodeStaffSchema),
  createdAt: z.string(),
});

export const saveScrmCodeBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(60),
  groupName: z.string().max(40).default(""),
  scene: z.string().max(40).default(""),
  tagIds: z.array(z.number().int().positive()).max(30).default([]),
  welcomeId: z.number().int().min(0).default(0),
  staffStrategy: z.enum(SCRM_STAFF_STRATEGIES).default("ROUND_ROBIN"),
  dailyLimit: z.number().int().min(0).max(100000).default(0),
  staff: z
    .array(
      z.object({
        staffUserId: z.string().min(1).max(64),
        weight: z.number().int().min(1).max(100).default(1),
        dailyLimit: z.number().int().min(0).max(100000).default(0),
      }),
    )
    .max(100)
    .default([]),
});

export const scrmWelcomeSchema = z.object({
  id: z.number(),
  name: z.string(),
  scope: z.string(),
  staffUserId: z.string(),
  content: z.string(),
  materialIds: z.array(z.number()),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const saveScrmWelcomeBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(60),
  scope: z.enum(SCRM_WELCOME_SCOPES).default("ALL"),
  staffUserId: z.string().max(64).default(""),
  content: z.string().max(2000),
  materialIds: z.array(z.number().int().positive()).max(20).default([]),
  enabled: z.boolean().default(true),
});

export const scrmChatMemberSchema = z.object({
  contactId: z.number(),
  externalUserId: z.string(),
  name: z.string(),
  role: z.string(),
  joinAt: z.string(),
  leaveAt: z.string(),
});

export const scrmChatSchema = z.object({
  id: z.number(),
  chatId: z.string(),
  name: z.string(),
  ownerStaffId: z.string(),
  ownerStaffName: z.string(),
  groupName: z.string(),
  memberCount: z.number(),
  maxMembers: z.number(),
  status: z.string(),
  createdAt: z.string(),
});

export const scrmChatDetailSchema = scrmChatSchema.extend({
  notice: z.string(),
  members: z.array(scrmChatMemberSchema),
});

export const scrmChatQuerySchema = pageQuerySchema.extend({
  keyword: z.string().max(100).optional(),
  ownerStaffId: z.string().max(64).optional(),
  groupName: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
});

export const scrmChatGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  sort: z.number(),
  chatCount: z.number(),
});

export const saveScrmChatGroupBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(40),
  sort: z.number().int().min(0).max(999).default(0),
});

export const moveScrmChatsBodySchema = z.object({
  chatIds: z.array(z.number().int().positive()).min(1).max(200),
  groupId: z.number().int().min(0),
});

export const scrmRoomPullSchema = z.object({
  id: z.number(),
  name: z.string(),
  chatIds: z.array(z.number()),
  welcomeId: z.number(),
  tagIds: z.array(z.number()),
  status: z.string(),
  invited: z.number(),
  joined: z.number(),
  createdAt: z.string(),
});

export const saveScrmRoomPullBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(60),
  chatIds: z.array(z.number().int().positive()).max(100).default([]),
  welcomeId: z.number().int().min(0).default(0),
  tagIds: z.array(z.number().int().positive()).max(30).default([]),
});

export const scrmMassContentSchema = z.object({
  text: z.string().max(2000).default(""),
  linkUrl: z.string().max(500).default(""),
  linkTitle: z.string().max(120).default(""),
  linkDesc: z.string().max(300).default(""),
  imageMediaId: z.string().max(200).default(""),
  miniProgram: z
    .object({
      appId: z.string().max(64).default(""),
      title: z.string().max(64).default(""),
      page: z.string().max(200).default(""),
    })
    .default({ appId: "", title: "", page: "" }),
});

export const scrmMassFilterSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(50).default([]),
  staffUserIds: z.array(z.string().max(64)).max(100).default([]),
  codeIds: z.array(z.number().int().positive()).max(50).default([]),
  chatIds: z.array(z.number().int().positive()).max(200).default([]),
  addedFrom: z.string().max(20).default(""),
  addedTo: z.string().max(20).default(""),
  contactIds: z.array(z.number().int().positive()).max(1000).default([]),
});

export const scrmMassTaskSchema = z.object({
  id: z.number(),
  type: z.string(),
  name: z.string(),
  targetFilter: scrmMassFilterSchema,
  content: scrmMassContentSchema,
  status: z.string(),
  scheduledAt: z.string(),
  submittedAt: z.string(),
  reviewNote: z.string(),
  total: z.number(),
  sent: z.number(),
  failed: z.number(),
  unknown: z.number(),
  createdAt: z.string(),
});

export const scrmMassTargetSchema = z.object({
  id: z.number(),
  taskId: z.number(),
  kind: z.string(),
  targetName: z.string(),
  staffUserId: z.string(),
  staffName: z.string(),
  status: z.string(),
  error: z.string(),
  msgId: z.string(),
  sentAt: z.string(),
});

export const saveScrmMassBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  type: z.enum(SCRM_MASS_TYPES),
  name: z.string().min(1).max(60),
  targetFilter: scrmMassFilterSchema.default({
    tagIds: [],
    staffUserIds: [],
    codeIds: [],
    chatIds: [],
    addedFrom: "",
    addedTo: "",
    contactIds: [],
  }),
  content: scrmMassContentSchema,
  scheduledAt: z.string().max(30).default(""),
});

export const reviewScrmMassBodySchema = z.object({
  id: z.number().int().positive(),
  approve: z.boolean(),
  note: z.string().max(300).default(""),
});

export const scrmTransferTargetSchema = z.object({
  kind: z.enum(SCRM_TRANSFER_KINDS),
  id: z.number().int().positive(),
});

export const scrmUnassignedSchema = z.object({
  kind: z.string(),
  /** 本地客户/客户群 id；企微待分配但本地还没有镜像时为 0，不能在这里发起转接。 */
  id: z.number(),
  externalId: z.string(),
  name: z.string(),
  ownerStaffId: z.string(),
  ownerStaffName: z.string(),
  reason: z.string(),
  lastActiveAt: z.string(),
});

export const scrmTransferSchema = z.object({
  id: z.number(),
  type: z.string(),
  kind: z.string(),
  targetName: z.string(),
  fromStaffId: z.string(),
  fromStaffName: z.string(),
  toStaffId: z.string(),
  toStaffName: z.string(),
  status: z.string(),
  failReason: z.string(),
  externalJobId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createScrmTransferBodySchema = z.object({
  type: z.enum(SCRM_TRANSFER_TYPES),
  targets: z.array(scrmTransferTargetSchema).min(1).max(200),
  toStaffId: z.string().min(1).max(64),
});

export const refreshScrmTransferBodySchema = z.object({
  id: z.number().int().positive(),
});

export const scrmSopActionSchema = z.object({
  kind: z.enum(SCRM_SOP_ACTIONS),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const scrmSopSchema = z.object({
  id: z.number(),
  name: z.string(),
  trigger: z.string(),
  triggerConfig: z.record(z.string(), z.unknown()),
  actions: z.array(scrmSopActionSchema),
  enabled: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
});

export const saveScrmSopBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().min(1).max(60),
  trigger: z.enum(SCRM_SOP_TRIGGERS),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(scrmSopActionSchema).max(20).default([]),
  enabled: z.boolean().default(true),
});

export const scrmSopTaskSchema = z.object({
  id: z.number(),
  sopId: z.number(),
  sopName: z.string(),
  contactId: z.number(),
  contactName: z.string(),
  staffUserId: z.string(),
  staffName: z.string(),
  dueAt: z.string(),
  status: z.string(),
  result: z.string(),
  completedAt: z.string(),
  createdAt: z.string(),
});

export const completeScrmSopTaskBodySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["DONE", "SKIPPED"]),
  result: z.string().max(1000).default(""),
});

export const scrmSensitiveWordSchema = z.object({
  id: z.number(),
  group: z.string(),
  word: z.string(),
  action: z.string(),
  direction: z.string(),
  replacement: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const saveScrmSensitiveWordBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  group: z.string().max(40).default(""),
  word: z.string().min(1).max(100),
  action: z.enum(SCRM_SENSITIVE_ACTIONS).default("BLOCK"),
  direction: z.enum(SCRM_SENSITIVE_DIRECTIONS).default("OUTBOUND"),
  replacement: z.string().max(100).default(""),
  enabled: z.boolean().default(true),
});

export const scrmSensitiveHitSchema = z.object({
  id: z.number(),
  word: z.string(),
  group: z.string(),
  direction: z.string(),
  contactId: z.number(),
  contactName: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export const checkScrmTextBodySchema = z.object({
  text: z.string().max(4000),
  direction: z.enum(SCRM_SENSITIVE_DIRECTIONS).default("OUTBOUND"),
});

export const checkScrmTextResultSchema = z.object({
  blocked: z.boolean(),
  replaced: z.string(),
  hits: z.array(z.object({ word: z.string(), action: z.string(), group: z.string() })),
});

export const scrmQcBodySchema = z.object({
  contactId: z.number().int().positive().optional(),
  conversationId: z.string().max(64).optional(),
  text: z.string().max(20000).default(""),
});

export const scrmQcResultSchema = z.object({
  score: z.number(),
  dimensions: z.array(z.object({ key: z.string(), label: z.string(), score: z.number() })),
  highlights: z.array(z.string()),
  suggestions: z.array(z.string()),
  source: z.string(),
});

export const scrmStatsOverviewSchema = z.object({
  contacts: z.number(),
  todayAdded: z.number(),
  lost: z.number(),
  chats: z.number(),
  chatMembers: z.number(),
  todayMassSent: z.number(),
  todayMassDelivered: z.number(),
  activeStaff: z.number(),
  daily: z.array(
    z.object({ day: z.string(), added: z.number(), lost: z.number(), net: z.number() }),
  ),
});

export const scrmStatsTrendSchema = z.object({
  days: z.number(),
  points: z.array(
    z.object({ day: z.string(), added: z.number(), lost: z.number(), net: z.number() }),
  ),
  mass: z.array(z.object({ day: z.string(), sent: z.number(), delivered: z.number() })),
});

export const scrmStatsStaffSchema = z.object({
  rows: z.array(
    z.object({
      staffUserId: z.string(),
      name: z.string(),
      contacts: z.number(),
      chats: z.number(),
      massSent: z.number(),
      sopDone: z.number(),
      sopRate: z.number(),
    }),
  ),
});

export const scrmMaterialSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  assetId: z.number(),
  link: z.string(),
  miniProgram: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const saveScrmMaterialBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  type: z.enum(SCRM_MATERIAL_TYPES),
  title: z.string().min(1).max(80),
  content: z.string().max(2000).default(""),
  assetId: z.number().int().min(0).default(0),
  link: z.string().max(500).default(""),
  miniProgram: z.record(z.string(), z.unknown()).default({}),
});

export const scrmSidebarTicketSchema = z.object({
  ticket: z.string(),
  expiresAt: z.string(),
});

export const scrmSidebarSchema = z.object({
  staff: z.object({ userId: z.string(), name: z.string() }),
  contact: scrmContactSchema.nullable(),
  fields: z.array(scrmContactFieldValueSchema),
  tags: z.array(scrmContactTagSchema),
  tasks: z.array(scrmSopTaskSchema),
  materials: z.array(scrmMaterialSchema),
  chats: z.array(
    z.object({ id: z.number(), name: z.string(), memberCount: z.number() }),
  ),
});

export const scrmExportStatsBodySchema = z.object({
  days: z.number().int().min(7).max(180).default(30),
});

export const scrmEndpoints = {
  // ---------- 接入与概览 ----------
  Scrm_settings: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(scrmSettingsSchema),
  },
  Scrm_saveSettings: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/settings/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmSettingsBodySchema,
    response: envelope(scrmSettingsSchema),
  },
  Scrm_testConnection: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/settings/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(z.object({ ok: z.boolean(), message: z.string(), departments: z.number() })),
  },
  Scrm_sync: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sync",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      scope: z.enum(SCRM_SYNC_SCOPES).default("ALL"),
    }),
    response: envelope(
      z.object({
        contacts: z.number(),
        tags: z.number(),
        chats: z.number(),
        lost: z.number(),
        message: z.string(),
      }),
    ),
  },
  Scrm_overview: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(scrmStatsOverviewSchema),
  },
  // ---------- 客户 ----------
  Scrm_contacts: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/contacts",
    params: z.object({}),
    query: scrmContactQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(scrmContactSchema)),
  },
  Scrm_contact: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/contacts/detail",
    params: z.object({}),
    query: z.object({ id: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(scrmContactDetailSchema),
  },
  Scrm_updateContact: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/update",
    params: z.object({}),
    query: emptyQuery,
    body: updateScrmContactBodySchema,
    response: envelope(scrmContactSchema),
  },
  Scrm_promoteContact: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/promote",
    params: z.object({}),
    query: emptyQuery,
    body: promoteScrmContactBodySchema,
    response: envelope(z.object({ contactId: z.number(), crmLeadId: z.number() })),
  },
  Scrm_assignContact: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/assign",
    params: z.object({}),
    query: emptyQuery,
    body: assignScrmContactBodySchema,
    response: envelope(z.object({ contactId: z.number(), staffUserId: z.string() })),
  },
  Scrm_batchTag: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/tags",
    params: z.object({}),
    query: emptyQuery,
    body: batchScrmTagBodySchema,
    response: envelope(z.object({ updated: z.number(), failed: z.number() })),
  },
  Scrm_batchTagByFilter: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/tags/batch",
    params: z.object({}),
    query: emptyQuery,
    body: batchScrmTagFilterBodySchema,
    response: envelope(z.object({ matched: z.number(), updated: z.number(), failed: z.number() })),
  },
  // ---------- 资料卡字段 ----------
  Scrm_fields: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/fields",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmFieldSchema)),
  },
  Scrm_saveField: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/fields/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmFieldBodySchema,
    response: envelope(scrmFieldSchema),
  },
  Scrm_removeField: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/fields/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Scrm_saveContactFields: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/contacts/fields",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmContactFieldsBodySchema,
    response: envelope(z.object({ saved: z.number() })),
  },
  // ---------- 标签 ----------
  Scrm_tagGroups: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/tags",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmTagGroupSchema)),
  },
  Scrm_syncTags: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/tags/sync",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(z.object({ groups: z.number(), tags: z.number() })),
  },
  Scrm_autoTagRules: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/tags/rules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmAutoTagRuleSchema)),
  },
  Scrm_saveAutoTagRule: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/tags/rules/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmAutoTagBodySchema,
    response: envelope(scrmAutoTagRuleSchema),
  },
  Scrm_removeAutoTagRule: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/tags/rules/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  // ---------- 活码与欢迎语 ----------
  Scrm_codes: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/codes",
    params: z.object({}),
    query: pageQuerySchema.extend({ keyword: z.string().max(100).optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmCodeSchema)),
  },
  Scrm_saveCode: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/codes/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmCodeBodySchema,
    response: envelope(scrmCodeSchema),
  },
  Scrm_removeCode: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/codes/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Scrm_codeStats: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/codes/stats",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
    body: z.undefined(),
    response: envelope(
      z.array(z.object({ codeId: z.number(), name: z.string(), scanned: z.number(), added: z.number() })),
    ),
  },
  Scrm_welcomes: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/welcomes",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmWelcomeSchema)),
  },
  Scrm_saveWelcome: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/welcomes/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmWelcomeBodySchema,
    response: envelope(scrmWelcomeSchema),
  },
  Scrm_removeWelcome: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/welcomes/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  // ---------- 客户群 ----------
  Scrm_chats: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/chats",
    params: z.object({}),
    query: scrmChatQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(scrmChatSchema)),
  },
  Scrm_chat: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/chats/detail",
    params: z.object({}),
    query: z.object({ id: z.coerce.number().int().positive() }),
    body: z.undefined(),
    response: envelope(scrmChatDetailSchema),
  },
  Scrm_chatGroups: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/chats/groups",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmChatGroupSchema)),
  },
  Scrm_saveChatGroup: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/chats/groups/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmChatGroupBodySchema,
    response: envelope(scrmChatGroupSchema),
  },
  Scrm_moveChats: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/chats/groups/move",
    params: z.object({}),
    query: emptyQuery,
    body: moveScrmChatsBodySchema,
    response: envelope(z.object({ moved: z.number() })),
  },
  Scrm_roomPulls: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/chats/pulls",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmRoomPullSchema)),
  },
  Scrm_saveRoomPull: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/chats/pulls/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmRoomPullBodySchema,
    response: envelope(scrmRoomPullSchema),
  },
  Scrm_runRoomPull: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/chats/pulls/run",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ invited: z.number(), joined: z.number(), message: z.string() })),
  },
  // ---------- 群发 ----------
  Scrm_massTasks: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/mass",
    params: z.object({}),
    query: pageQuerySchema.extend({
      type: z.enum(SCRM_MASS_TYPES).optional(),
      status: z.string().max(20).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmMassTaskSchema)),
  },
  Scrm_saveMassTask: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/mass/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmMassBodySchema,
    response: envelope(scrmMassTaskSchema),
  },
  Scrm_requestMassReview: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/mass/request-review",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(scrmMassTaskSchema),
  },
  Scrm_reviewMassTask: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/mass/review",
    params: z.object({}),
    query: emptyQuery,
    body: reviewScrmMassBodySchema,
    response: envelope(scrmMassTaskSchema),
  },
  Scrm_submitMassTask: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/mass/submit",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number(), status: z.string(), sent: z.number(), failed: z.number() })),
  },
  Scrm_massTargets: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/mass/targets",
    params: z.object({}),
    query: pageQuerySchema.extend({
      taskId: z.coerce.number().int().positive(),
      status: z.string().max(20).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmMassTargetSchema)),
  },
  // ---------- 分配与继承 ----------
  Scrm_unassigned: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/transfers/unassigned",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmUnassignedSchema)),
  },
  Scrm_transfers: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/transfers",
    params: z.object({}),
    query: pageQuerySchema.extend({ type: z.enum(SCRM_TRANSFER_TYPES).optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmTransferSchema)),
  },
  Scrm_createTransfer: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/transfers/create",
    params: z.object({}),
    query: emptyQuery,
    body: createScrmTransferBodySchema,
    response: envelope(z.object({ created: z.number(), message: z.string() })),
  },
  Scrm_refreshTransfer: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/transfers/refresh",
    params: z.object({}),
    query: emptyQuery,
    body: refreshScrmTransferBodySchema,
    response: envelope(scrmTransferSchema),
  },
  // ---------- SOP ----------
  Scrm_sops: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/sop",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmSopSchema)),
  },
  Scrm_saveSop: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sop/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmSopBodySchema,
    response: envelope(scrmSopSchema),
  },
  Scrm_removeSop: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sop/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Scrm_runSop: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sop/run",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ created: z.number(), message: z.string() })),
  },
  Scrm_sopTasks: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/sop/tasks",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().max(20).optional(),
      staffUserId: z.string().max(64).optional(),
      contactId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmSopTaskSchema)),
  },
  Scrm_completeSopTask: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sop/tasks/complete",
    params: z.object({}),
    query: emptyQuery,
    body: completeScrmSopTaskBodySchema,
    response: envelope(scrmSopTaskSchema),
  },
  // ---------- 合规 ----------
  Scrm_sensitiveWords: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/compliance/words",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmSensitiveWordSchema)),
  },
  Scrm_saveSensitiveWord: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/compliance/words/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmSensitiveWordBodySchema,
    response: envelope(scrmSensitiveWordSchema),
  },
  Scrm_removeSensitiveWord: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/compliance/words/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Scrm_sensitiveHits: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/compliance/hits",
    params: z.object({}),
    query: pageQuerySchema.extend({ direction: z.enum(SCRM_SENSITIVE_DIRECTIONS).optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(scrmSensitiveHitSchema)),
  },
  Scrm_checkText: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/compliance/check",
    params: z.object({}),
    query: emptyQuery,
    body: checkScrmTextBodySchema,
    response: envelope(checkScrmTextResultSchema),
  },
  Scrm_qc: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/compliance/qc",
    params: z.object({}),
    query: emptyQuery,
    body: scrmQcBodySchema,
    response: envelope(scrmQcResultSchema),
  },
  // ---------- 统计 ----------
  Scrm_statsTrend: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/stats/trend",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }),
    body: z.undefined(),
    response: envelope(scrmStatsTrendSchema),
  },
  Scrm_statsStaff: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/stats/staff",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }),
    body: z.undefined(),
    response: envelope(scrmStatsStaffSchema),
  },
  Scrm_exportStats: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/stats/export",
    params: z.object({}),
    query: emptyQuery,
    body: scrmExportStatsBodySchema,
    response: envelope(z.object({ jobId: z.number(), status: z.string() })),
  },
  // ---------- 素材 ----------
  Scrm_materials: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/materials",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(scrmMaterialSchema)),
  },
  Scrm_saveMaterial: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/materials/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveScrmMaterialBodySchema,
    response: envelope(scrmMaterialSchema),
  },
  Scrm_removeMaterial: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/materials/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  // ---------- 员工侧边栏 ----------
  Scrm_sidebarTicket: {
    method: "post" as const,
    path: "/enterprise/wecom-scrm/sidebar/ticket",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ contactId: z.number().int().positive().optional() }),
    response: envelope(scrmSidebarTicketSchema),
  },
  Scrm_sidebar: {
    method: "get" as const,
    path: "/enterprise/wecom-scrm/sidebar",
    params: z.object({}),
    query: z.object({ contactId: z.coerce.number().int().positive().optional() }),
    body: z.undefined(),
    response: envelope(scrmSidebarSchema),
  },
};
