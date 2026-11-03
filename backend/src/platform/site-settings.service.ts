import { PrismaService } from '../prisma/prisma.service';
import { invalidateSiteUrlCache, normalizeSiteUrl } from '../common/site-url';

export interface FooterLink {
  label: string;
  url: string;
}

/** 系统支持的语言码（与前端 lib/i18n 清单一致）：简体中文 / English / Tiếng Việt / 日本語 / العربية / Français / Español / Русский。 */
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'vi', 'ja', 'ar', 'fr', 'es', 'ru'] as const;

export interface SiteSettings {
  siteName: string;
  siteLogo: string;
  siteDesc: string;
  icpRecord: string;
  footerLinks: FooterLink[];
  /** AIPDD 推荐码：管理员填入后，用户绑定 AIPDD Key 页面会引导新注册携带该码（邀请佣金归管理员）并赠送算力。 */
  aipddReferralCode: string;
  /** 被隐藏的业务服务菜单路径（如 ["/tax"]）：仅控制菜单显示，直接访问链接不受影响。 */
  businessMenuHidden: string[];
  /** 被隐藏的「开放集成」菜单路径（如 ["/developer/docs"]）：仅控制菜单显示，默认全部可见。 */
  integrationMenuHidden: string[];
  /** 「AI增值服务」分组是否隐藏：默认可见（false）。 */
  aiServicesHidden: boolean;
  /** 默认语言码（SUPPORTED_LANGUAGES 之一）：新用户首次进站按此语言展示界面，可在前台随时切换。 */
  defaultLanguage: string;
  /**
   * 站点对外地址（协议 + 域名，可带端口）：MCP / API 接入端点、IM 回调与「去处理」链接、
   * 客服嵌入脚本、活码入口、邀请链接等所有绝对地址都以此为准；留空时前端按当前访问域名推导。
   */
  siteUrl: string;
}

/**
 * 站点级设置（存 system_settings 键值表，单一 JSON 键）：名称 / logo / 简介 / ICP 备案号 / 页脚链接 / AIPDD 推荐码 / 业务服务菜单显隐 / 开放集成菜单显隐 / AI增值服务显隐 / 默认语言 / 站点对外地址。
 * 前端 SSR 读取渲染标题、logo、页脚备案，管理员保存后即时生效。
 */
export class SiteSettingsService {
  static readonly SITE_KEY = 'site_settings';

  constructor(private readonly prisma: PrismaService) {}

  private defaults(): SiteSettings {
    return {
      siteName: process.env.SITE_NAME || '企业服务工作台',
      siteLogo: process.env.SITE_LOGO || '',
      siteDesc: process.env.SITE_DESC || '',
      icpRecord: process.env.ICP_RECORD || '',
      footerLinks: [],
      aipddReferralCode: process.env.AIPDD_REFERRAL_CODE || '',
      businessMenuHidden: [],
      integrationMenuHidden: [],
      aiServicesHidden: false,
      defaultLanguage: SUPPORTED_LANGUAGES.includes(
        (process.env.SITE_DEFAULT_LANGUAGE ?? '') as (typeof SUPPORTED_LANGUAGES)[number],
      )
        ? process.env.SITE_DEFAULT_LANGUAGE!
        : 'zh-CN',
      // 部署期兜底域名：管理员在后台改过之后以库里的值为准。
      siteUrl: normalizeSiteUrl(process.env.SITE_URL),
    };
  }

  async view(): Promise<SiteSettings> {
    const base = this.defaults();
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: SiteSettingsService.SITE_KEY },
    });
    if (!row?.value) return base;
    try {
      const stored = JSON.parse(row.value) as Partial<SiteSettings>;
      return {
        siteName: stored.siteName?.trim() || base.siteName,
        siteLogo: stored.siteLogo ?? base.siteLogo,
        siteDesc: stored.siteDesc ?? base.siteDesc,
        icpRecord: stored.icpRecord ?? base.icpRecord,
        footerLinks: Array.isArray(stored.footerLinks)
          ? stored.footerLinks
              .filter(
                (l): l is FooterLink =>
                  !!l && typeof l.label === 'string' && typeof l.url === 'string',
              )
              .map((l) => ({ label: l.label.slice(0, 64), url: l.url.slice(0, 512) }))
          : base.footerLinks,
        aipddReferralCode:
          typeof stored.aipddReferralCode === 'string'
            ? stored.aipddReferralCode.trim().slice(0, 64)
            : base.aipddReferralCode,
        businessMenuHidden: Array.isArray(stored.businessMenuHidden)
          ? stored.businessMenuHidden
              .filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
              .map((p) => p.slice(0, 64))
              .slice(0, 32)
          : base.businessMenuHidden,
        integrationMenuHidden: Array.isArray(stored.integrationMenuHidden)
          ? stored.integrationMenuHidden
              .filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
              .map((p) => p.slice(0, 64))
              .slice(0, 32)
          : base.integrationMenuHidden,
        aiServicesHidden:
          typeof stored.aiServicesHidden === 'boolean'
            ? stored.aiServicesHidden
            : base.aiServicesHidden,
        defaultLanguage:
          typeof stored.defaultLanguage === 'string' &&
          (SUPPORTED_LANGUAGES as readonly string[]).includes(stored.defaultLanguage)
            ? stored.defaultLanguage
            : base.defaultLanguage,
        // 库里存过就以库为准（管理员清空即回落到当前访问域名，不再取环境变量）
        siteUrl:
          stored.siteUrl !== undefined
            ? normalizeSiteUrl(stored.siteUrl)
            : base.siteUrl,
      };
    } catch {
      return base;
    }
  }

  async save(body: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = await this.view();
    const next: SiteSettings = {
      siteName:
        body.siteName !== undefined
          ? String(body.siteName).trim().slice(0, 120) || current.siteName
          : current.siteName,
      siteLogo:
        body.siteLogo !== undefined
          ? String(body.siteLogo).trim().slice(0, 512)
          : current.siteLogo,
      siteDesc:
        body.siteDesc !== undefined
          ? String(body.siteDesc).trim().slice(0, 500)
          : current.siteDesc,
      icpRecord:
        body.icpRecord !== undefined
          ? String(body.icpRecord).trim().slice(0, 128)
          : current.icpRecord,
      footerLinks:
        body.footerLinks !== undefined
          ? body.footerLinks
              .filter((l) => l && typeof l.label === 'string' && typeof l.url === 'string')
              .slice(0, 20)
              .map((l) => ({ label: l.label.slice(0, 64), url: l.url.slice(0, 512) }))
          : current.footerLinks,
      aipddReferralCode:
        body.aipddReferralCode !== undefined
          ? String(body.aipddReferralCode).trim().slice(0, 64)
          : current.aipddReferralCode,
      businessMenuHidden:
        body.businessMenuHidden !== undefined
          ? [
              ...new Set(
                body.businessMenuHidden
                  .filter((p) => typeof p === 'string' && p.startsWith('/'))
                  .map((p) => p.slice(0, 64)),
              ),
            ].slice(0, 32)
          : current.businessMenuHidden,
      integrationMenuHidden:
        body.integrationMenuHidden !== undefined
          ? [
              ...new Set(
                body.integrationMenuHidden
                  .filter((p) => typeof p === 'string' && p.startsWith('/'))
                  .map((p) => p.slice(0, 64)),
              ),
            ].slice(0, 32)
          : current.integrationMenuHidden,
      aiServicesHidden:
        typeof body.aiServicesHidden === 'boolean'
          ? body.aiServicesHidden
          : current.aiServicesHidden,
      defaultLanguage:
        body.defaultLanguage !== undefined &&
        (SUPPORTED_LANGUAGES as readonly string[]).includes(body.defaultLanguage)
          ? body.defaultLanguage
          : current.defaultLanguage,
      // 只保留协议 + 域名：非法值（非 http(s)、带空格或凭据）归零，等于交给当前访问域名
      siteUrl:
        body.siteUrl !== undefined
          ? normalizeSiteUrl(body.siteUrl).slice(0, 512)
          : current.siteUrl,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: SiteSettingsService.SITE_KEY },
      create: { key: SiteSettingsService.SITE_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    // 域名改了，后台任务（IM 推送等）持有的缓存立刻作废
    invalidateSiteUrlCache();
    return next;
  }
}
