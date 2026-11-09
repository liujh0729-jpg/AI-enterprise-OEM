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
  /** 被隐藏的用户侧菜单路径（管理员配置，仅控制菜单显示）：站内以 / 开头，外链存完整 URL */
  hiddenMenuPaths?: string[];
  /** 被隐藏的「业务服务」板块页签（管理员配置，仅控制展示）：token = `<板块>:<角色>`，角色 demand＝需求信息 / services＝服务市集 */
  hiddenBoardTabs?: string[];
  /** 默认语言码（zh-CN / en / vi / ja / ar / fr / es / ru）：管理员配置，新用户首次进站按此语言展示 */
  defaultLanguage?: string;
  /** 站点对外地址（协议 + 域名，可带端口）：MCP / API 接入端点、回调地址、分享链接等绝对地址都跟它走；留空按当前访问域名推导 */
  siteUrl?: string;
}

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
  }),
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
};

export { z };
