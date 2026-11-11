import type {
  WechatMpFollowReply,
  WechatMpKeywordReply,
  WechatMpMenu,
  WechatMpQuietHours,
  WechatMpSettingsInput,
  WechatMpSettingsView,
  WechatMpTemplateMap,
} from '@enterprise/contracts';
import { WECHAT_MP_EVENT_KEYS } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import type { PrismaService } from '../prisma/prisma.service';
import { WechatMpCrypto } from './wechat-mp-crypto';

const SETTINGS_KEY = 'wechat_mp_settings';

export type WechatMpStoredSettings = {
  enabled: boolean;
  accountName: string;
  appId: string;
  appSecretCipher: string;
  token: string;
  encodingAesKeyCipher: string;
  encryptedMode: boolean;
  followReply: WechatMpFollowReply;
  keywordReplies: WechatMpKeywordReply[];
  defaultReply: WechatMpFollowReply;
  quietHours: WechatMpQuietHours;
  dailyCap: number;
  dedupeSeconds: number;
  mobileLinks: Record<string, string>;
  templates: WechatMpTemplateMap[];
  menu: WechatMpMenu;
  updatedBy: string;
  updatedAt: string;
};

export type WechatMpRuntime = {
  appId: string;
  appSecret: string;
  token: string;
  encodingAesKey: string;
  encryptedMode: boolean;
};

const emptyReply = (
  text = '',
  linkText = '',
  linkUrl = '',
): WechatMpFollowReply => ({ enabled: true, text, linkText, linkUrl });

const defaults = (): WechatMpStoredSettings => ({
  enabled: false,
  accountName: '',
  appId: '',
  appSecretCipher: '',
  token: '',
  encodingAesKeyCipher: '',
  encryptedMode: true,
  followReply: emptyReply(
    '欢迎关注！这里会推送你的任务、审批与客服回复。',
    '打开我的消息',
    '/m/inbox',
  ),
  keywordReplies: [],
  defaultReply: emptyReply(
    '已收到。回复「待办」查看待处理事项。',
    '打开消息中心',
    '/m/inbox',
  ),
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  dailyCap: 20,
  dedupeSeconds: 300,
  mobileLinks: {
    default: '/m/inbox',
    'task.assigned': '/m/inbox?tab=task',
    'service_desk.reply': '/m/inbox?tab=service',
    'oa.approval': '/m/inbox?tab=approval',
    'oa.result': '/m/inbox?tab=approval',
  },
  templates: [],
  menu: { button: [], draftUpdatedAt: '', publishedAt: '' },
  updatedBy: '',
  updatedAt: '',
});

function safeLink(value: string) {
  const link = String(value || '').trim();
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//') && !link.includes('\\')) {
    return link;
  }
  try {
    const url = new URL(link);
    return url.protocol === 'https:' ? link : '';
  } catch {
    return '';
  }
}

function normalizeTemplate(
  raw: Partial<WechatMpTemplateMap> & { eventKey: string },
): WechatMpTemplateMap {
  return {
    eventKey: raw.eventKey,
    enabled: raw.enabled === true,
    templateId: String(raw.templateId || '')
      .trim()
      .slice(0, 64),
    title: String(raw.title || '')
      .trim()
      .slice(0, 80),
    fields: Array.isArray(raw.fields)
      ? raw.fields
          .map((field) => ({
            key: String(field?.key || '')
              .trim()
              .slice(0, 32),
            value: String(field?.value || '').slice(0, 200),
          }))
          .filter((field) => field.key)
          .slice(0, 20)
      : [],
    url: safeLink(String(raw.url || '')),
    customFallback: raw.customFallback !== false,
  };
}

function normalizeMenu(raw: Partial<WechatMpMenu> | undefined): WechatMpMenu {
  return {
    button: Array.isArray(raw?.button) ? raw.button : [],
    draftUpdatedAt: String(raw?.draftUpdatedAt || ''),
    publishedAt: String(raw?.publishedAt || ''),
  };
}

export class WechatMpSettingsService {
  private cryptoInstance: WechatMpCrypto | null = null;
  private cache: { value: WechatMpStoredSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 未配置 EXTERNAL_CRED_KEY 的环境（单测/文档生成）不在构造期抛错。 */
  private get crypto() {
    return (this.cryptoInstance ??= new WechatMpCrypto());
  }

  signOAuthState(payload: string) {
    return this.crypto.signState(payload);
  }

  verifyOAuthState(payload: string, signature: string) {
    return this.crypto.verifyState(payload, signature);
  }

  invalidate() {
    this.cache = null;
  }

  private async readRaw(): Promise<WechatMpStoredSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const base = defaults();
    if (!row?.value) return base;
    try {
      const parsed = JSON.parse(row.value) as Partial<WechatMpStoredSettings>;
      const templates = new Map(
        (Array.isArray(parsed.templates) ? parsed.templates : []).map(
          (item) => [String(item?.eventKey || ''), normalizeTemplate(item)],
        ),
      );
      return {
        ...base,
        ...parsed,
        enabled: parsed.enabled === true,
        accountName: String(parsed.accountName || '').slice(0, 80),
        appId: String(parsed.appId || '').slice(0, 64),
        token: String(parsed.token || '').slice(0, 32),
        encryptedMode: parsed.encryptedMode !== false,
        followReply: { ...base.followReply, ...(parsed.followReply || {}) },
        keywordReplies: Array.isArray(parsed.keywordReplies)
          ? parsed.keywordReplies.slice(0, 50)
          : [],
        defaultReply: { ...base.defaultReply, ...(parsed.defaultReply || {}) },
        quietHours: { ...base.quietHours, ...(parsed.quietHours || {}) },
        dailyCap: Number.isFinite(Number(parsed.dailyCap))
          ? Math.min(Math.max(Number(parsed.dailyCap), 0), 200)
          : base.dailyCap,
        dedupeSeconds: Number.isFinite(Number(parsed.dedupeSeconds))
          ? Math.min(Math.max(Number(parsed.dedupeSeconds), 0), 86400)
          : base.dedupeSeconds,
        mobileLinks: {
          ...base.mobileLinks,
          ...(parsed.mobileLinks || {}),
        },
        templates: [...templates.values()],
        menu: normalizeMenu(parsed.menu),
        updatedBy: String(parsed.updatedBy || ''),
        updatedAt: String(parsed.updatedAt || ''),
      };
    } catch {
      return base;
    }
  }

  /** 推送链路高频读取：15 秒进程内缓存，保存后主动失效。 */
  async load(): Promise<WechatMpStoredSettings> {
    if (this.cache && Date.now() - this.cache.at < 15_000) {
      return this.cache.value;
    }
    const value = await this.readRaw();
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** `requireEnabled=false` 供管理后台测试连接/读取模板：填好凭据即可验证，无需先启用。 */
  async runtime(
    options: { requireEnabled?: boolean } = {},
  ): Promise<WechatMpRuntime | null> {
    const value = await this.load();
    if (options.requireEnabled !== false && !value.enabled) return null;
    if (!value.appId || !value.token) return null;
    const appSecret = value.appSecretCipher
      ? this.crypto.decrypt(value.appSecretCipher)
      : '';
    const encodingAesKey = value.encodingAesKeyCipher
      ? this.crypto.decrypt(value.encodingAesKeyCipher)
      : '';
    if (!appSecret) return null;
    return {
      appId: value.appId,
      appSecret,
      token: value.token,
      encodingAesKey,
      encryptedMode: value.encryptedMode,
    };
  }

  /** 回调/绑定必须使用已启用且凭据完整的配置，否则给出可操作的中文提示。 */
  async requireRuntime(
    options: { requireEnabled?: boolean } = {},
  ): Promise<WechatMpRuntime> {
    const runtime = await this.runtime(options);
    if (!runtime) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信服务号尚未启用或缺少 AppID / AppSecret，请到「平台管理后台 → 微信服务号设置」完成配置',
      );
    }
    return runtime;
  }

  async view(): Promise<WechatMpSettingsView> {
    const value = await this.load();
    const [boundCount, siteUrl] = await Promise.all([
      this.prisma.wechatMpBinding.count(),
      resolveSiteUrl(this.prisma),
    ]);
    const mapped = new Map(
      value.templates.map((item) => [item.eventKey, item]),
    );
    return {
      enabled: value.enabled,
      accountName: value.accountName,
      appId: value.appId,
      tokenConfigured: Boolean(value.token),
      appSecretConfigured: Boolean(value.appSecretCipher),
      encodingAesKeyConfigured: Boolean(value.encodingAesKeyCipher),
      encryptedMode: value.encryptedMode,
      followReply: value.followReply,
      keywordReplies: value.keywordReplies,
      defaultReply: value.defaultReply,
      quietHours: value.quietHours,
      dailyCap: value.dailyCap,
      dedupeSeconds: value.dedupeSeconds,
      mobileLinks: value.mobileLinks,
      templates: WECHAT_MP_EVENT_KEYS.map(
        (eventKey) =>
          mapped.get(eventKey) ?? {
            eventKey,
            enabled: false,
            templateId: '',
            title: '',
            fields: [],
            url: '',
            customFallback: true,
          },
      ),
      menu: value.menu,
      serverUrl: joinSiteUrl(siteUrl, '/api/public/wechat-mp/callback'),
      boundCount,
      updatedAt: value.updatedAt,
    };
  }

  async save(
    body: WechatMpSettingsInput,
    operatorId: string,
  ): Promise<WechatMpSettingsView> {
    const current = await this.readRaw();
    const token = String(body.token || '').trim();
    const appSecret = String(body.appSecret || '').trim();
    const encodingAesKey = String(body.encodingAesKey || '').trim();
    if (encodingAesKey && encodingAesKey.length !== 43) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'EncodingAESKey 必须是 43 位字符，可在公众号后台「服务器配置」中随机生成后复制',
      );
    }
    const next: WechatMpStoredSettings = {
      ...current,
      enabled: body.enabled === true,
      accountName: String(body.accountName || '')
        .trim()
        .slice(0, 80),
      appId: String(body.appId || '')
        .trim()
        .slice(0, 64),
      token: token ? token.slice(0, 32) : current.token,
      appSecretCipher: appSecret
        ? this.crypto.encrypt(appSecret)
        : current.appSecretCipher,
      encodingAesKeyCipher: encodingAesKey
        ? this.crypto.encrypt(encodingAesKey)
        : current.encodingAesKeyCipher,
      encryptedMode: body.encryptedMode !== false,
      followReply: this.normalizeReply(body.followReply),
      keywordReplies: (body.keywordReplies || [])
        .map((item) => ({
          keyword: String(item.keyword || '')
            .trim()
            .slice(0, 40),
          match:
            item.match === 'exact' ? ('exact' as const) : ('contains' as const),
          text: String(item.text || '').slice(0, 1000),
          linkText: String(item.linkText || '')
            .trim()
            .slice(0, 40),
          linkUrl: safeLink(String(item.linkUrl || '')),
          enabled: item.enabled !== false,
        }))
        .filter((item) => item.keyword)
        .slice(0, 50),
      defaultReply: this.normalizeReply(body.defaultReply),
      quietHours: {
        enabled: body.quietHours?.enabled === true,
        start: /^\d{2}:\d{2}$/.test(String(body.quietHours?.start || ''))
          ? String(body.quietHours?.start)
          : '22:00',
        end: /^\d{2}:\d{2}$/.test(String(body.quietHours?.end || ''))
          ? String(body.quietHours?.end)
          : '08:00',
      },
      dailyCap: Math.min(Math.max(Number(body.dailyCap) || 0, 0), 200),
      dedupeSeconds: Math.min(
        Math.max(Number(body.dedupeSeconds) || 0, 0),
        86400,
      ),
      mobileLinks: Object.entries(body.mobileLinks || {}).reduce<
        Record<string, string>
      >((links, [key, value]) => {
        const link = safeLink(String(value || ''));
        if (link) links[key] = link;
        return links;
      }, {}),
      templates: (body.templates || [])
        .map((item) => normalizeTemplate(item))
        .slice(0, 50),
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    for (const item of next.templates) {
      if (item.enabled && !item.templateId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `事件「${item.eventKey}」已启用，但还没有选择模板 ID`,
        );
      }
    }
    if (next.enabled) {
      if (!next.appId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '启用前请填写 AppID',
        );
      }
      if (!next.token) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '启用前请填写服务器配置 Token（与公众号后台一致）',
        );
      }
      if (!next.appSecretCipher) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '启用前请填写 AppSecret',
        );
      }
    }
    await this.write(next);
    await this.audit(
      operatorId,
      'wechat_mp.settings',
      next.enabled ? '保存并启用' : '保存',
    );
    return this.view();
  }

  async saveTemplates(
    templates: WechatMpTemplateMap[],
    operatorId: string,
  ): Promise<WechatMpSettingsView> {
    const current = await this.readRaw();
    const next = {
      ...current,
      templates: templates.map((item) => normalizeTemplate(item)).slice(0, 50),
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    for (const item of next.templates) {
      if (item.enabled && !item.templateId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `事件「${item.eventKey}」已启用，但还没有选择模板 ID`,
        );
      }
    }
    await this.write(next);
    await this.audit(operatorId, 'wechat_mp.templates', '保存模板映射');
    return this.view();
  }

  async menu(): Promise<WechatMpMenu> {
    return (await this.load()).menu;
  }

  async saveMenu(button: WechatMpMenu['button'], operatorId: string) {
    const current = await this.readRaw();
    const next: WechatMpStoredSettings = {
      ...current,
      menu: {
        ...current.menu,
        button,
        draftUpdatedAt: new Date().toISOString(),
      },
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    await this.audit(operatorId, 'wechat_mp.menu', '保存菜单草稿');
    return next.menu;
  }

  async markMenuPublished(operatorId: string) {
    const current = await this.readRaw();
    const next: WechatMpStoredSettings = {
      ...current,
      menu: {
        ...current.menu,
        publishedAt: new Date().toISOString(),
      },
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    await this.audit(operatorId, 'wechat_mp.menu.publish', '发布菜单');
    return next.menu;
  }

  async replaceMenu(
    button: WechatMpMenu['button'],
    operatorId: string,
  ): Promise<WechatMpMenu> {
    const current = await this.readRaw();
    const next: WechatMpStoredSettings = {
      ...current,
      menu: {
        button,
        draftUpdatedAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      },
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    await this.audit(operatorId, 'wechat_mp.menu.pull', '拉取微信当前菜单');
    return next.menu;
  }

  private normalizeReply(
    value?: Partial<WechatMpFollowReply>,
  ): WechatMpFollowReply {
    return {
      enabled: value?.enabled !== false,
      text: String(value?.text || '').slice(0, 1000),
      linkText: String(value?.linkText || '')
        .trim()
        .slice(0, 40),
      linkUrl: safeLink(String(value?.linkUrl || '')),
    };
  }

  private async write(value: WechatMpStoredSettings) {
    await this.prisma.systemSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
    this.invalidate();
  }

  private async audit(userId: string, action: string, detail: string) {
    await this.prisma.auditLog
      .create({
        data: { userId, action, detail: detail.slice(0, 500) },
      })
      .catch(() => undefined);
  }
}
