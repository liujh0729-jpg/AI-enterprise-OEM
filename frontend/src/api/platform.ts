import {
  apiEnvelope,
  extensionCapabilitySchema,
  extensionCatalogSchema,
  z,
  type ExtensionCapabilitySaveBody,
} from "@enterprise/contracts";
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
  /** 被隐藏的用户侧菜单路径（管理员配置，仅控制菜单显示）：站内以 / 开头，外链存完整 URL */
  hiddenMenuPaths?: string[];
  /** 被隐藏的「业务服务」板块页签（管理员配置，仅控制展示）：token = `<板块>:<角色>`，角色 demand＝需求信息 / services＝服务市集 */
  hiddenBoardTabs?: string[];
  /** 默认语言码（zh-CN / en / vi / ja / ar / fr / es / ru）：管理员配置，新用户首次进站按此语言展示 */
  defaultLanguage?: string;
  /** 站点对外地址（协议 + 域名，可带端口）：MCP / API 接入端点、回调地址、分享链接等绝对地址都跟它走；留空按当前访问域名推导 */
  siteUrl?: string;
  /** 顶部统一 Chrome 插件入口总开关 */
  extensionEntryEnabled?: boolean;
}

export type ExtensionInfo = {
  enabled: boolean;
  published: boolean;
  entrySwitch: boolean;
  name: string;
  version: string;
  minVersion: string;
  downloadUrl: string;
  chromeStoreUrl: string;
  edgeStoreUrl: string;
  checksum: string;
  browsers: string[];
  capabilities: {
    key: string;
    label: string;
    description: string;
    entry: string;
    minVersion: string;
  }[];
  installSteps: string[];
  usage: string[];
  changelog: {
    version: string;
    date: string;
    notes: string[];
  }[];
};

const siteSchema = apiEnvelope(
  z.object({
    siteName: z.string(),
    siteLogo: z.string(),
    siteDesc: z.string(),
    icpRecord: z.string(),
    footerLinks: z.array(z.object({ label: z.string(), url: z.string() })),
    aipddReferralCode: z.string().optional(),
    hiddenMenuPaths: z.array(z.string()).optional(),
    hiddenBoardTabs: z.array(z.string()).optional(),
    defaultLanguage: z.string().optional(),
    siteUrl: z.string().optional(),
    extensionEntryEnabled: z.boolean().optional(),
  }),
);

const extensionInfoSchema = apiEnvelope(
  z.object({
    enabled: z.boolean(),
    published: z.boolean(),
    entrySwitch: z.boolean(),
    name: z.string(),
    version: z.string(),
    minVersion: z.string(),
    downloadUrl: z.string(),
    chromeStoreUrl: z.string(),
    edgeStoreUrl: z.string(),
    checksum: z.string(),
    browsers: z.array(z.string()),
    capabilities: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string(),
        entry: z.string(),
        minVersion: z.string(),
      }),
    ),
    installSteps: z.array(z.string()),
    usage: z.array(z.string()),
    changelog: z.array(
      z.object({
        version: z.string(),
        date: z.string(),
        notes: z.array(z.string()),
      }),
    ),
  }),
);

const extensionCatalogEnvelope = apiEnvelope(extensionCatalogSchema);
const extensionCapabilityEnvelope = apiEnvelope(extensionCapabilitySchema);

/** 统一插件能力目录（§10.7）：能力定义在服务端合并后下发，前端入口与工具页只读这一份。 */
export type ExtensionCatalog = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Extension_catalog">["data"]
>;
/** 能力目录条目（含平台覆盖后的生效状态）。 */
export type ExtensionCapability = ExtensionCatalog["capabilities"][number];
/** 能力覆盖保存入参（与契约同源）。 */
export type { ExtensionCapabilitySaveBody };

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
  /** 顶部统一浏览器插件入口信息：登录用户可读，未发布 / 总开关关闭时 enabled=false。 */
  extensionInfo: (options?: HttpOptions) =>
    unwrap(
      extensionInfoSchema,
      `${ADMIN.replace("/admin", "")}/extension/info`,
      options,
    ),
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
  /** 统一插件能力目录：登录用户可读（前端入口 / 工具页 / 后台维护共用同一份）。 */
  extensionCatalog: (options?: HttpOptions) =>
    unwrap(
      extensionCatalogEnvelope,
      `${ADMIN.replace("/admin", "")}/extension/catalog`,
      options,
    ),
  /** 平台维护单个能力的启用 / 灰度 / 强制升级 / 下线（平台管理员）。 */
  saveExtensionCapability: (
    key: string,
    body: ExtensionCapabilitySaveBody,
    options?: HttpOptions,
  ) =>
    unwrap(
      extensionCapabilityEnvelope,
      `${ADMIN.replace("/admin", "")}/extension/capabilities/${encodeURIComponent(key)}`,
      { ...options, method: "PUT", body },
    ),
};

export { z };
