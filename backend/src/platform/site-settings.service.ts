import { PrismaService } from '../prisma/prisma.service';
import { invalidateSiteUrlCache, normalizeSiteUrl } from '../common/site-url';

export interface FooterLink {
  label: string;
  url: string;
}

/** 系统支持的语言码（与前端 lib/i18n 清单一致）：简体中文 / English / Tiếng Việt / 日本語 / العربية / Français / Español / Русский。 */
export const SUPPORTED_LANGUAGES = [
  'zh-CN',
  'en',
  'vi',
  'ja',
  'ar',
  'fr',
  'es',
  'ru',
] as const;

/**
 * 菜单路径白名单化：站内菜单以单个 `/` 开头，外链菜单以 http(s):// 开头（去掉协议相对写法 `//host`）；
 * 顺带 trim、截断、去重并限量，避免脏值写进站点配置。
 */
function normalizeMenuPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = value
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim().slice(0, 512))
    .filter((p) =>
      p.startsWith('/') ? !p.startsWith('//') : /^https?:\/\/\S+$/i.test(p),
    );
  return [...new Set(paths)].slice(0, 128);
}

/**
 * 「业务服务」板块（与前端 routes.ts 该分组同源）：管理员可逐板块隐藏「需求信息 / 服务市集」两个页签。
 * 值取 `<板块>:<角色>`（角色 demand＝需求信息 / services＝服务市集），如 `marketing:services`。
 */
export const BOARD_TAB_BOARDS = [
  'marketing',
  'supply',
  'tax',
  'overseas',
  'flex',
  'logistics',
  'smart',
  'ip',
  'legal',
  'think-tank',
  'asset',
  'market',
] as const;
export const BOARD_TAB_ROLES = ['demand', 'services'] as const;
const MAX_BOARD_TAB_TOKENS = BOARD_TAB_BOARDS.length * BOARD_TAB_ROLES.length;

/** 板块页签 token 白名单化：只认 `<已知板块>:<已知角色>`，去重限量，脏值一律丢弃。 */
export function normalizeBoardTabs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const boards = new Set<string>(BOARD_TAB_BOARDS);
  const roles = new Set<string>(BOARD_TAB_ROLES);
  const tokens = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, 64))
    .filter((v) => {
      const [board, role, ...rest] = v.split(':');
      return rest.length === 0 && boards.has(board) && roles.has(role);
    });
  return [...new Set(tokens)].slice(0, MAX_BOARD_TAB_TOKENS);
}

export interface SiteSettings {
  siteName: string;
  siteLogo: string;
  siteDesc: string;
  icpRecord: string;
  footerLinks: FooterLink[];
  /** AIPDD 推荐码：管理员填入后，用户绑定 AIPDD Key 页面会引导新注册携带该码（邀请佣金归管理员）并赠送算力。 */
  aipddReferralCode: string;
  /**
   * 被隐藏的用户侧菜单路径：覆盖前台侧栏每一条菜单（含首页入口与「AI增值服务」的外链，外链存完整 URL）。
   * 仅控制菜单显示，直接访问链接不受影响；某分组内的菜单项全部隐藏后该分组自动消失。
   */
  hiddenMenuPaths: string[];
  /**
   * 被隐藏的「业务服务」板块页签（token = `<板块>:<角色>`，角色 demand＝需求信息 / services＝服务市集）：
   * 管理员逐板块选择是否展示这两个页签；对所有身份一致生效，仅控制展示，直链/接口不受限（与 hiddenMenuPaths 同口径）。
   */
  hiddenBoardTabs: string[];
  /** 默认语言码（SUPPORTED_LANGUAGES 之一）：新用户首次进站按此语言展示界面，可在前台随时切换。 */
  defaultLanguage: string;
  /**
   * 站点对外地址（协议 + 域名，可带端口）：MCP / API 接入端点、IM 回调与「去处理」链接、
   * 客服嵌入脚本、活码入口、邀请链接等所有绝对地址都以此为准；留空时前端按当前访问域名推导。
   */
  siteUrl: string;
  /**
   * 顶部统一 Chrome 插件入口总开关：关闭后所有用户都看不到入口图标（直链与营销工具内的
   * 插件使用说明不受影响）；平台未发布插件包时入口同样不展示。
   */
  extensionEntryEnabled: boolean;
}

/**
 * 内置备案号占位：部署后由管理员在「站点设置 → ICP 备案号」改成真实备案号。
 * 未配置过站点设置、或历史配置里备案号为空时都用它，保证官网首页页脚有备案信息。
 */
const DEFAULT_ICP_RECORD = '京ICP备2026000001号-1';

/**
 * 站点级设置（存 system_settings 键值表，单一 JSON 键）：名称 / logo / 简介 / ICP 备案号 / 页脚链接 / AIPDD 推荐码 / 用户侧菜单显隐 / 业务服务板块页签显隐 / 默认语言 / 站点对外地址。
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
      icpRecord: process.env.ICP_RECORD || DEFAULT_ICP_RECORD,
      footerLinks: [],
      aipddReferralCode: process.env.AIPDD_REFERRAL_CODE || '',
      hiddenMenuPaths: [],
      hiddenBoardTabs: [],
      defaultLanguage: SUPPORTED_LANGUAGES.includes(
        (process.env.SITE_DEFAULT_LANGUAGE ??
          '') as (typeof SUPPORTED_LANGUAGES)[number],
      )
        ? process.env.SITE_DEFAULT_LANGUAGE!
        : 'zh-CN',
      // 部署期兜底域名：管理员在后台改过之后以库里的值为准。
      siteUrl: normalizeSiteUrl(process.env.SITE_URL),
      extensionEntryEnabled: true,
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
        icpRecord: stored.icpRecord?.trim() || base.icpRecord,
        footerLinks: Array.isArray(stored.footerLinks)
          ? stored.footerLinks
              .filter(
                (l): l is FooterLink =>
                  !!l &&
                  typeof l.label === 'string' &&
                  typeof l.url === 'string',
              )
              .map((l) => ({
                label: l.label.slice(0, 64),
                url: l.url.slice(0, 512),
              }))
          : base.footerLinks,
        aipddReferralCode:
          typeof stored.aipddReferralCode === 'string'
            ? stored.aipddReferralCode.trim().slice(0, 64)
            : base.aipddReferralCode,
        hiddenMenuPaths: normalizeMenuPaths(stored.hiddenMenuPaths),
        hiddenBoardTabs: normalizeBoardTabs(stored.hiddenBoardTabs),
        defaultLanguage:
          typeof stored.defaultLanguage === 'string' &&
          (SUPPORTED_LANGUAGES as readonly string[]).includes(
            stored.defaultLanguage,
          )
            ? stored.defaultLanguage
            : base.defaultLanguage,
        // 库里存过就以库为准（管理员清空即回落到当前访问域名，不再取环境变量）
        siteUrl:
          stored.siteUrl !== undefined
            ? normalizeSiteUrl(stored.siteUrl)
            : base.siteUrl,
        // 只有管理员显式关过才隐藏；历史配置没有该字段时保持默认展示
        extensionEntryEnabled: stored.extensionEntryEnabled !== false,
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
              .filter(
                (l) =>
                  l && typeof l.label === 'string' && typeof l.url === 'string',
              )
              .slice(0, 20)
              .map((l) => ({
                label: l.label.slice(0, 64),
                url: l.url.slice(0, 512),
              }))
          : current.footerLinks,
      aipddReferralCode:
        body.aipddReferralCode !== undefined
          ? String(body.aipddReferralCode).trim().slice(0, 64)
          : current.aipddReferralCode,
      hiddenMenuPaths:
        body.hiddenMenuPaths !== undefined
          ? normalizeMenuPaths(body.hiddenMenuPaths)
          : current.hiddenMenuPaths,
      hiddenBoardTabs:
        body.hiddenBoardTabs !== undefined
          ? normalizeBoardTabs(body.hiddenBoardTabs)
          : current.hiddenBoardTabs,
      defaultLanguage:
        body.defaultLanguage !== undefined &&
        (SUPPORTED_LANGUAGES as readonly string[]).includes(
          body.defaultLanguage,
        )
          ? body.defaultLanguage
          : current.defaultLanguage,
      // 只保留协议 + 域名：非法值（非 http(s)、带空格或凭据）归零，等于交给当前访问域名
      siteUrl:
        body.siteUrl !== undefined
          ? normalizeSiteUrl(body.siteUrl).slice(0, 512)
          : current.siteUrl,
      extensionEntryEnabled:
        body.extensionEntryEnabled !== undefined
          ? body.extensionEntryEnabled === true
          : current.extensionEntryEnabled,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: SiteSettingsService.SITE_KEY },
      create: {
        key: SiteSettingsService.SITE_KEY,
        value: JSON.stringify(next),
      },
      update: { value: JSON.stringify(next) },
    });
    // 域名改了，后台任务（IM 推送等）持有的缓存立刻作废
    invalidateSiteUrlCache();
    return next;
  }
}
