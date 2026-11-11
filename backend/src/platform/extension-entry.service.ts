import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import type { PrismaService } from '../prisma/prisma.service';
import {
  EXTENSION_RELEASE,
  extensionPublished,
} from '../distribution/extension-release';
import type { SiteSettingsService } from './site-settings.service';

/**
 * 顶部统一 Chrome 插件入口（设计 §10.6）：
 * 版本 / 能力 / 更新记录与营销工具分发页同源（extension-release.ts），下载地址按
 * 「站点域名 → 当前访问来源」拼绝对地址，绝不硬编码本机或单一客户域名。
 */
export class ExtensionEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteSettingsService,
  ) {}

  async view(requestOrigin: string) {
    const settings = await this.site.view();
    const published = extensionPublished();
    const base =
      (await resolveSiteUrl(this.prisma).catch(() => '')) || requestOrigin;
    return {
      enabled: published && settings.extensionEntryEnabled,
      published,
      /** 管理员总开关的原始值：关闭时前台不渲染入口，但仍可在后台重新打开。 */
      entrySwitch: settings.extensionEntryEnabled,
      name: EXTENSION_RELEASE.name,
      version: EXTENSION_RELEASE.version,
      minVersion: EXTENSION_RELEASE.minVersion,
      downloadUrl: joinSiteUrl(base, EXTENSION_RELEASE.downloadPath),
      chromeStoreUrl: EXTENSION_RELEASE.chromeStoreUrl,
      edgeStoreUrl: EXTENSION_RELEASE.edgeStoreUrl,
      checksum: EXTENSION_RELEASE.checksum,
      browsers: EXTENSION_RELEASE.browsers,
      capabilities: EXTENSION_RELEASE.capabilities,
      installSteps: EXTENSION_RELEASE.installSteps,
      usage: EXTENSION_RELEASE.usage,
      changelog: EXTENSION_RELEASE.changelog,
    };
  }
}
