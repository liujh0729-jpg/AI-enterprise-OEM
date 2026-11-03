import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 平台后台 / 站点配置接口：这些是开源版新增的本地接口（未纳入统一 contracts 生成表），
 * 因此直接用底层 http() 按路径调用，并用轻量 zod 描述信封 data 结构。
 */
export interface SiteConfig {
  siteName: string;
  siteLogo: string;
  siteDesc: string;
  icpRecord: string;
  footerLinks: { label: string; url: string }[];
  /** AIPDD 推荐码（管理员配置，用于新用户注册引导拉新送算力） */
  aipddReferralCode?: string;
  /** 被隐藏的业务服务菜单路径（管理员配置，仅控制菜单显示） */
  businessMenuHidden?: string[];
  /** 被隐藏的「开放集成」菜单路径（如 /developer/docs、/developer/mcp），默认全部可见 */
  integrationMenuHidden?: string[];
  /** 「AI增值服务」分组是否对用户隐藏，默认可见（false） */
  aiServicesHidden?: boolean;
  /** 默认语言码（zh-CN / en / vi / ja / ar / fr / es / ru）：管理员配置，新用户首次进站按此语言展示 */
  defaultLanguage?: string;
  /** 站点对外地址（协议 + 域名，可带端口）：MCP / API 接入端点、回调地址、分享链接等绝对地址都跟它走；留空按当前访问域名推导 */
  siteUrl?: string;
}
export interface ProviderSyncStatus {
  mode: string;
  lastSyncAt: string;
  lastResult: string;
  lastError: string;
  lastCount: number;
}
export interface ProviderDisplayRow {
  id: number;
  aiworkinProviderId: string;
  name: string;
  categoryKeys: string[];
  region: string;
  intro: string;
  visible: boolean;
  sortWeight: number;
  adminNote: string;
  syncedAt: string;
}

const siteSchema = apiEnvelope(
  z.object({
    siteName: z.string(),
    siteLogo: z.string(),
    siteDesc: z.string(),
    icpRecord: z.string(),
    footerLinks: z.array(z.object({ label: z.string(), url: z.string() })),
    aipddReferralCode: z.string().optional(),
    businessMenuHidden: z.array(z.string()).optional(),
    integrationMenuHidden: z.array(z.string()).optional(),
    aiServicesHidden: z.boolean().optional(),
    defaultLanguage: z.string().optional(),
    siteUrl: z.string().optional(),
  }),
);
const syncSchema = apiEnvelope(
  z.object({
    mode: z.string(),
    lastSyncAt: z.string(),
    lastResult: z.string(),
    lastError: z.string(),
    lastCount: z.number(),
  }),
);
const providerRowSchema = apiEnvelope(
  z.object({
    id: z.number(),
    aiworkinProviderId: z.string(),
    name: z.string(),
    categoryKeys: z.array(z.string()),
    region: z.string(),
    intro: z.string(),
    visible: z.boolean(),
    sortWeight: z.number(),
    adminNote: z.string(),
    syncedAt: z.string(),
  }),
);
const providerListFinal = apiEnvelope(
  z.array(
    z.object({
      id: z.number(),
      aiworkinProviderId: z.string(),
      name: z.string(),
      categoryKeys: z.array(z.string()),
      region: z.string(),
      intro: z.string(),
      visible: z.boolean(),
      sortWeight: z.number(),
      adminNote: z.string(),
      syncedAt: z.string(),
    }),
  ),
);

async function unwrap<T>(
  schema: z.ZodType<{ code: number; message: string; data: T | null }>,
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const result = await http(path, schema, options);
  return result.data.data as T;
}

const ADMIN = "/api/backend/enterprise/admin";

export const platformApi = {
  siteConfig: (options?: HttpOptions) =>
    unwrap(siteSchema, "/api/site-config", options),
  adminGetSite: (options?: HttpOptions) =>
    unwrap(siteSchema, `${ADMIN}/site-settings`, options),
  adminSaveSite: (
    body: Partial<SiteConfig>,
    options?: HttpOptions,
  ) =>
    unwrap(siteSchema, `${ADMIN}/site-settings`, {
      ...options,
      method: "PUT",
      body,
    }),
  providers: (options?: HttpOptions) =>
    unwrap(providerListFinal, `${ADMIN}/providers/display`, options),
  updateProvider: (
    id: number,
    body: { visible?: boolean; sortWeight?: number; adminNote?: string },
    options?: HttpOptions,
  ) =>
    unwrap(providerRowSchema, `${ADMIN}/providers/display/${id}`, {
      ...options,
      method: "PUT",
      body,
    }),
  syncStatus: (options?: HttpOptions) =>
    unwrap(syncSchema, `${ADMIN}/providers/sync-status`, options),
  setSyncMode: (mode: "MANUAL" | "SCHEDULED", options?: HttpOptions) =>
    unwrap(syncSchema, `${ADMIN}/providers/sync-mode`, {
      ...options,
      method: "PUT",
      body: { mode },
    }),
  syncNow: (options?: HttpOptions) =>
    unwrap(syncSchema, `${ADMIN}/providers/sync-now`, {
      ...options,
      method: "POST",
    }),
};

export { z };
