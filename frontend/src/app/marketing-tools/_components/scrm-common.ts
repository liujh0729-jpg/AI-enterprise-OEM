"use client";

import {
  endpoints,
  scrmAutoTagRuleSchema,
  scrmChatDetailSchema,
  scrmChatGroupSchema,
  scrmChatSchema,
  scrmCodeSchema,
  scrmContactDetailSchema,
  scrmContactFieldValueSchema,
  scrmContactSchema,
  scrmContactTagSchema,
  scrmFieldSchema,
  scrmMassTargetSchema,
  scrmMassTaskSchema,
  scrmMaterialSchema,
  scrmQcResultSchema,
  scrmRoomPullSchema,
  scrmSensitiveHitSchema,
  scrmSensitiveWordSchema,
  scrmSettingsSchema,
  scrmSidebarTicketSchema,
  scrmSopSchema,
  scrmSopTaskSchema,
  scrmStatsOverviewSchema,
  scrmStatsStaffSchema,
  scrmStatsTrendSchema,
  scrmTagGroupSchema,
  scrmTimelineSchema,
  scrmTransferSchema,
  scrmUnassignedSchema,
  scrmWelcomeSchema,
  z,
} from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 企微原生 SCRM 界面层：客户以企微为源、本地镜像；
 * 所有请求都按当前登录账号的组织键隔离，未接入企微时接口会给出可操作提示而不是假数据。
 */

export type ScrmSettings = z.infer<typeof scrmSettingsSchema>;
export type ScrmContact = z.infer<typeof scrmContactSchema>;
export type ScrmContactTag = z.infer<typeof scrmContactTagSchema>;
export type ScrmContactDetail = z.infer<typeof scrmContactDetailSchema>;
export type ScrmContactFieldValue = z.infer<typeof scrmContactFieldValueSchema>;
export type ScrmTimeline = z.infer<typeof scrmTimelineSchema>;
export type ScrmField = z.infer<typeof scrmFieldSchema>;
export type ScrmTagGroup = z.infer<typeof scrmTagGroupSchema>;
export type ScrmCode = z.infer<typeof scrmCodeSchema>;
export type ScrmAutoTagRule = z.infer<typeof scrmAutoTagRuleSchema>;
export type ScrmWelcome = z.infer<typeof scrmWelcomeSchema>;
export type ScrmChat = z.infer<typeof scrmChatSchema>;
export type ScrmChatDetail = z.infer<typeof scrmChatDetailSchema>;
export type ScrmChatGroup = z.infer<typeof scrmChatGroupSchema>;
export type ScrmRoomPull = z.infer<typeof scrmRoomPullSchema>;
export type ScrmMassTask = z.infer<typeof scrmMassTaskSchema>;
export type ScrmMassTarget = z.infer<typeof scrmMassTargetSchema>;
export type ScrmUnassigned = z.infer<typeof scrmUnassignedSchema>;
export type ScrmTransfer = z.infer<typeof scrmTransferSchema>;
export type ScrmSop = z.infer<typeof scrmSopSchema>;
export type ScrmSopTask = z.infer<typeof scrmSopTaskSchema>;
export type ScrmSensitiveWord = z.infer<typeof scrmSensitiveWordSchema>;
export type ScrmSensitiveHit = z.infer<typeof scrmSensitiveHitSchema>;
export type ScrmQcResult = z.infer<typeof scrmQcResultSchema>;
export type ScrmStatsOverview = z.infer<typeof scrmStatsOverviewSchema>;
export type ScrmStatsTrend = z.infer<typeof scrmStatsTrendSchema>;
export type ScrmStatsStaff = z.infer<typeof scrmStatsStaffSchema>;
export type ScrmMaterial = z.infer<typeof scrmMaterialSchema>;
export type ScrmSidebarTicket = z.infer<typeof scrmSidebarTicketSchema>;

export const scrmApi = {
  settings: endpoint(endpoints.Scrm_settings),
  saveSettings: endpoint(endpoints.Scrm_saveSettings),
  testConnection: endpoint(endpoints.Scrm_testConnection),
  sync: endpoint(endpoints.Scrm_sync),
  overview: endpoint(endpoints.Scrm_overview),

  contacts: endpoint(endpoints.Scrm_contacts),
  contact: endpoint(endpoints.Scrm_contact),
  updateContact: endpoint(endpoints.Scrm_updateContact),
  promoteContact: endpoint(endpoints.Scrm_promoteContact),
  assignContact: endpoint(endpoints.Scrm_assignContact),
  batchTag: endpoint(endpoints.Scrm_batchTag),
  batchTagByFilter: endpoint(endpoints.Scrm_batchTagByFilter),

  fields: endpoint(endpoints.Scrm_fields),
  saveField: endpoint(endpoints.Scrm_saveField),
  removeField: endpoint(endpoints.Scrm_removeField),
  saveContactFields: endpoint(endpoints.Scrm_saveContactFields),

  tagGroups: endpoint(endpoints.Scrm_tagGroups),
  syncTags: endpoint(endpoints.Scrm_syncTags),
  autoTagRules: endpoint(endpoints.Scrm_autoTagRules),
  saveAutoTagRule: endpoint(endpoints.Scrm_saveAutoTagRule),
  removeAutoTagRule: endpoint(endpoints.Scrm_removeAutoTagRule),

  codes: endpoint(endpoints.Scrm_codes),
  saveCode: endpoint(endpoints.Scrm_saveCode),
  removeCode: endpoint(endpoints.Scrm_removeCode),
  codeStats: endpoint(endpoints.Scrm_codeStats),
  welcomes: endpoint(endpoints.Scrm_welcomes),
  saveWelcome: endpoint(endpoints.Scrm_saveWelcome),
  removeWelcome: endpoint(endpoints.Scrm_removeWelcome),

  chats: endpoint(endpoints.Scrm_chats),
  chat: endpoint(endpoints.Scrm_chat),
  chatGroups: endpoint(endpoints.Scrm_chatGroups),
  saveChatGroup: endpoint(endpoints.Scrm_saveChatGroup),
  moveChats: endpoint(endpoints.Scrm_moveChats),
  roomPulls: endpoint(endpoints.Scrm_roomPulls),
  saveRoomPull: endpoint(endpoints.Scrm_saveRoomPull),
  runRoomPull: endpoint(endpoints.Scrm_runRoomPull),

  massTasks: endpoint(endpoints.Scrm_massTasks),
  saveMassTask: endpoint(endpoints.Scrm_saveMassTask),
  requestMassReview: endpoint(endpoints.Scrm_requestMassReview),
  reviewMassTask: endpoint(endpoints.Scrm_reviewMassTask),
  submitMassTask: endpoint(endpoints.Scrm_submitMassTask),
  massTargets: endpoint(endpoints.Scrm_massTargets),

  unassigned: endpoint(endpoints.Scrm_unassigned),
  transfers: endpoint(endpoints.Scrm_transfers),
  createTransfer: endpoint(endpoints.Scrm_createTransfer),
  refreshTransfer: endpoint(endpoints.Scrm_refreshTransfer),

  sops: endpoint(endpoints.Scrm_sops),
  saveSop: endpoint(endpoints.Scrm_saveSop),
  removeSop: endpoint(endpoints.Scrm_removeSop),
  runSop: endpoint(endpoints.Scrm_runSop),
  sopTasks: endpoint(endpoints.Scrm_sopTasks),
  completeSopTask: endpoint(endpoints.Scrm_completeSopTask),

  sensitiveWords: endpoint(endpoints.Scrm_sensitiveWords),
  saveSensitiveWord: endpoint(endpoints.Scrm_saveSensitiveWord),
  removeSensitiveWord: endpoint(endpoints.Scrm_removeSensitiveWord),
  sensitiveHits: endpoint(endpoints.Scrm_sensitiveHits),
  checkText: endpoint(endpoints.Scrm_checkText),
  qc: endpoint(endpoints.Scrm_qc),

  statsTrend: endpoint(endpoints.Scrm_statsTrend),
  statsStaff: endpoint(endpoints.Scrm_statsStaff),
  exportStats: endpoint(endpoints.Scrm_exportStats),

  materials: endpoint(endpoints.Scrm_materials),
  saveMaterial: endpoint(endpoints.Scrm_saveMaterial),
  removeMaterial: endpoint(endpoints.Scrm_removeMaterial),

  sidebarTicket: endpoint(endpoints.Scrm_sidebarTicket),
  sidebar: endpoint(endpoints.Scrm_sidebar),
};

// ---------- 展示文案（界面禁裸枚举） ----------

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "正常",
  LOST: "已流失",
};
export const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: "单行文本",
  SELECT: "单选",
  MULTI: "多选",
  DATE: "日期",
  PHONE: "手机号",
  EMAIL: "邮箱",
  NUMBER: "数字",
  BIRTHDAY: "生日",
  IMAGE: "图片",
};
export const TAG_SOURCE_LABELS: Record<string, string> = {
  WECOM: "企微标签",
  AUTO: "自动打标",
  MANUAL: "手动打标",
};
export const STAFF_STRATEGY_LABELS: Record<string, string> = {
  ROUND_ROBIN: "轮询分配",
  FIXED: "固定成员",
  WEIGHTED: "按权重",
};
export const WELCOME_SCOPE_LABELS: Record<string, string> = {
  ALL: "全员默认",
  STAFF: "指定员工",
  CHAT: "客户群",
};
export const CHAT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "正常",
  DISMISSED: "已解散",
};
export const ROOM_PULL_STATUS_LABELS: Record<string, string> = {
  PENDING: "待执行",
  DONE: "已完成",
  FAILED: "失败",
};
export const CODE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用中",
  PAUSED: "已暂停",
};
export const MASS_TYPE_LABELS: Record<string, string> = {
  CONTACT: "客户群发",
  CHAT: "客户群群发",
  MOMENT: "朋友圈",
};
export const MASS_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  SUBMITTED: "已提交",
  DONE: "已完成",
  PARTIAL: "部分失败",
  FAILED: "失败",
};
export const MASS_STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  PENDING_REVIEW: "processing",
  APPROVED: "blue",
  REJECTED: "error",
  SUBMITTED: "cyan",
  DONE: "success",
  PARTIAL: "warning",
  FAILED: "error",
};
export const TARGET_STATUS_LABELS: Record<string, string> = {
  PENDING: "待发送",
  SENT: "已发送",
  FAILED: "发送失败",
  UNKNOWN: "结果未知",
};
export const TARGET_STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  SENT: "success",
  FAILED: "error",
  UNKNOWN: "warning",
};
export const TRANSFER_TYPE_LABELS: Record<string, string> = {
  ACTIVE: "在职继承",
  RESIGN: "离职继承",
};
export const TRANSFER_KIND_LABELS: Record<string, string> = {
  CONTACT: "客户",
  CHAT: "客户群",
};
export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  PROCESSING: "处理中",
  DONE: "已完成",
  FAILED: "失败",
};
export const TRANSFER_STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  PROCESSING: "processing",
  DONE: "success",
  FAILED: "error",
};
export const SOP_TRIGGER_LABELS: Record<string, string> = {
  JOIN: "加好友",
  TAG: "打标签",
  KEYWORD: "入站关键词",
  SCHEDULE: "定时",
  MANUAL: "手动",
};
export const SOP_ACTION_LABELS: Record<string, string> = {
  WELCOME: "发欢迎语",
  MATERIAL: "推素材",
  MASS: "发群发",
  TASK: "建跟进待办",
  NOTIFY: "提醒员工",
  TAG: "打标签",
};
export const SOP_TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  DONE: "已完成",
  SKIPPED: "已跳过",
};
export const SOP_TASK_STATUS_COLOR: Record<string, string> = {
  PENDING: "processing",
  DONE: "success",
  SKIPPED: "default",
};
export const SENSITIVE_ACTION_LABELS: Record<string, string> = {
  ALERT: "只告警",
  BLOCK: "拦截发送",
  REPLACE: "替换后发送",
};
export const SENSITIVE_ACTION_COLOR: Record<string, string> = {
  ALERT: "warning",
  BLOCK: "error",
  REPLACE: "processing",
};
export const SENSITIVE_DIRECTION_LABELS: Record<string, string> = {
  INBOUND: "入站（只告警）",
  OUTBOUND: "出站",
  CHAT: "群聊",
};
export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  TEXT: "文本",
  IMAGE: "图片",
  LINK: "链接",
  MINIPROGRAM: "小程序",
  FILE: "文件",
};

export const contactStatusLabel = (key: string) => CONTACT_STATUS_LABELS[key] ?? key;
export const fieldTypeLabel = (key: string) => FIELD_TYPE_LABELS[key] ?? key;
export const tagSourceLabel = (key: string) => TAG_SOURCE_LABELS[key] ?? key;
export const massTypeLabel = (key: string) => MASS_TYPE_LABELS[key] ?? key;
export const massStatusLabel = (key: string) => MASS_STATUS_LABELS[key] ?? key;
export const sopTriggerLabel = (key: string) => SOP_TRIGGER_LABELS[key] ?? key;
export const sopActionLabel = (key: string) => SOP_ACTION_LABELS[key] ?? key;
export const sensitiveDirectionLabel = (key: string) =>
  SENSITIVE_DIRECTION_LABELS[key] ?? key;

export const fmtDateTime = (value: string): string =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";

/** 把后端返回的 tags 转成 Select 选项。 */
export const tagOptions = (groups: ScrmTagGroup[]) =>
  groups.map((group) => ({
    label: group.name,
    options: group.tags.map((tag) => ({
      value: tag.id,
      label: `${tag.name}（${tag.usageCount}）`,
    })),
  }));

export const flattenTags = (groups: ScrmTagGroup[]) =>
  groups.flatMap((group) => group.tags);

/** 归属/转接/活码接待人只能选组织在册成员；读取失败按空清单降级，不阻断主链路。 */
export const loadScrmStaff = async (): Promise<{ value: string; label: string }[]> => {
  try {
    const workspace = await endpoint(endpoints.OrgStaff_workspace)();
    return (workspace?.staff ?? []).map((row) => ({
      value: row.memberUserId,
      label: row.realName || row.memberUserId,
    }));
  } catch {
    return [];
  }
};
