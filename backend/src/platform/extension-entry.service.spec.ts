import { invalidateSiteUrlCache } from '../common/site-url';
import type { PrismaService } from '../prisma/prisma.service';
import {
  EXTENSION_RELEASE,
  extensionPublished,
} from '../distribution/extension-release';
import { ExtensionEntryService } from './extension-entry.service';
import type { SiteSettingsService } from './site-settings.service';
import { stub } from '../../test/doubles';

/** 只桩住 resolveSiteUrl 需要的那一次读库，其余字段用例不关心。 */
function prismaStub(siteUrl: string) {
  return stub<PrismaService>({
    systemSetting: {
      findUnique: jest.fn(async () => ({
        key: 'site_settings',
        value: JSON.stringify({ siteUrl }),
      })),
    },
  });
}

function siteStub(extensionEntryEnabled: boolean) {
  return stub<SiteSettingsService>({
    view: async () => ({ extensionEntryEnabled }),
  });
}

/**
 * 顶部统一插件入口的可见性与下载地址口径（§10.6）：
 * 入口只在「平台已发布插件包 + 管理员总开关打开」时出现，下载地址优先用站点域名，
 * 没配置时才回落访客当前访问来源——任何情况下都不能硬编码某个客户的域名。
 */
describe('ExtensionEntryService', () => {
  const originalSiteUrl = process.env.SITE_URL;
  beforeEach(() => {
    // 环境变量是站点域名的第二来源，用例要独立控制「有没有配置域名」
    delete process.env.SITE_URL;
    invalidateSiteUrlCache();
  });
  afterAll(() => {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
    invalidateSiteUrlCache();
  });

  it('已发布且总开关打开时入口可见', async () => {
    const service = new ExtensionEntryService(
      prismaStub('https://oa.example.com'),
      siteStub(true),
    );
    const view = await service.view('http://127.0.0.1:1690');
    expect(extensionPublished()).toBe(true);
    expect(view.enabled).toBe(true);
    expect(view.entrySwitch).toBe(true);
  });

  it('管理员关闭总开关时入口不可见，但保留开关原值', async () => {
    const service = new ExtensionEntryService(
      prismaStub('https://oa.example.com'),
      siteStub(false),
    );
    const view = await service.view('http://127.0.0.1:1690');
    expect(view.enabled).toBe(false);
    expect(view.entrySwitch).toBe(false);
  });

  it('下载地址按站点域名拼绝对地址', async () => {
    const service = new ExtensionEntryService(
      prismaStub('https://oa.example.com'),
      siteStub(true),
    );
    const view = await service.view('http://127.0.0.1:1690');
    expect(view.downloadUrl).toBe(
      `https://oa.example.com${EXTENSION_RELEASE.downloadPath}`,
    );
  });

  it('站点域名未配置时回落当前访问来源', async () => {
    const service = new ExtensionEntryService(prismaStub(''), siteStub(true));
    const view = await service.view('https://tenant.example.org');
    expect(view.downloadUrl).toBe(
      `https://tenant.example.org${EXTENSION_RELEASE.downloadPath}`,
    );
  });

  it('版本与能力清单与发布配置同源', async () => {
    const service = new ExtensionEntryService(
      prismaStub('https://oa.example.com'),
      siteStub(true),
    );
    const view = await service.view('http://127.0.0.1:1690');
    expect(view.version).toBe(EXTENSION_RELEASE.version);
    expect(view.minVersion).toBe(EXTENSION_RELEASE.minVersion);
    expect(view.capabilities).toEqual(EXTENSION_RELEASE.capabilities);
    expect(view.changelog[0].version).toBe(EXTENSION_RELEASE.version);
  });
});
