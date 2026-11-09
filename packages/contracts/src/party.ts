import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const jsonObject = z.record(z.string(), z.unknown());

/**
 * 统一外部主体：供应商 / OPC / 个人 / 合作伙伴 / 客户。
 * ERP 供应商、项目外部协作、CRM 客户都指向同一张主体表，避免三处各存一份联系人。
 */
export const PARTY_KINDS = [
  "VENDOR",
  "OPC",
  "INDIVIDUAL",
  "PARTNER",
  "CUSTOMER",
] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];
export const PARTY_KIND_LABELS: Record<string, string> = {
  VENDOR: "供应商",
  OPC: "OPC",
  INDIVIDUAL: "个人",
  PARTNER: "合作伙伴",
  CUSTOMER: "客户",
};

export const PARTY_STATUSES = ["ACTIVE", "PAUSED", "BLACKLISTED"] as const;
export const PARTY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "合作中",
  PAUSED: "已暂停",
  BLACKLISTED: "黑名单",
};

export const PARTY_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "手工建档",
  DEMAND: "需求发布",
  ERP: "ERP 供应商",
  CRM: "CRM 客户",
};

export const partyView = z.object({
  id: z.number(),
  kind: z.string(),
  kindLabel: z.string(),
  name: z.string(),
  contactName: z.string(),
  phone: z.string(),
  email: z.string(),
  taxNo: z.string(),
  address: z.string(),
  roles: z.array(z.string()),
  capabilities: z.array(z.string()),
  rateCard: jsonObject,
  availability: jsonObject,
  compliance: jsonObject,
  rating: z.number(),
  source: z.string(),
  sourceLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  note: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PartyView = z.infer<typeof partyView>;

const partyInput = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(PARTY_KINDS).default("VENDOR"),
  name: z.string().trim().min(1).max(120),
  contactName: z.string().max(64).default(""),
  phone: z.string().max(32).default(""),
  email: z.string().max(120).default(""),
  taxNo: z.string().max(32).default(""),
  address: z.string().max(200).default(""),
  roles: z.array(z.string().max(32)).max(20).default([]),
  capabilities: z.array(z.string().max(32)).max(50).default([]),
  rateCard: jsonObject.default({}),
  availability: jsonObject.default({}),
  compliance: jsonObject.default({}),
  rating: z.number().min(0).max(5).default(0),
  status: z.enum(PARTY_STATUSES).default("ACTIVE"),
  source: z.string().max(16).default("MANUAL"),
  note: z.string().max(500).default(""),
});

export const partyEndpoints = {
  Party_list: {
    method: "get" as const,
    path: "/enterprise/parties",
    params: z.object({}),
    query: pageQuerySchema.extend({
      kind: z.string().optional(),
      status: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(partyView)),
  },
  Party_save: {
    method: "post" as const,
    path: "/enterprise/parties",
    params: z.object({}),
    query: emptyQuery,
    body: partyInput,
    response: envelope(partyView),
  },
  Party_remove: {
    method: "post" as const,
    path: "/enterprise/parties/:id/remove",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), removed: z.boolean() })),
  },
};

export type PartyEndpoints = typeof partyEndpoints;
