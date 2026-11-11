import type {
  WechatMpEventKey,
  WechatMpMenu,
  WechatMpMenuButton,
  WechatMpSettingsInput,
  WechatMpTemplateMap,
} from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { WechatMpBindingService } from './wechat-mp.binding.service';
import type { WechatMpClient } from './wechat-mp.client';
import type { WechatMpPushService } from './wechat-mp.push.service';
import type { WechatMpSettingsService } from './wechat-mp.settings';

/** 微信回传的菜单字段来自任意 JSON，只接受字符串。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 微信自定义菜单：一级最多 3 个，二级最多 5 个；view 必须有 https 地址，click 必须有 key。 */
function cleanMenu(raw: unknown): WechatMpMenuButton[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 3) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '微信菜单最多 3 个一级菜单',
    );
  }
  return raw.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    const name = textOf(row.name).trim().slice(0, 16);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '菜单名称不能为空');
    }
    const subs = Array.isArray(row.sub_button)
      ? cleanSubMenu(row.sub_button, name)
      : undefined;
    if (subs?.length) {
      return { type: 'view', name, sub_button: subs };
    }
    const type = row.type === 'click' ? 'click' : 'view';
    if (type === 'view') {
      const url = textOf(row.url).trim();
      if (!/^https:\/\//i.test(url)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `菜单「${name}」是跳转类型，URL 必须以 https:// 开头`,
        );
      }
      return { type, name, url };
    }
    const key = textOf(row.key).trim().slice(0, 128);
    if (!key) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `菜单「${name}」是点击类型，必须填写事件 key`,
      );
    }
    return { type, name, key };
  });
}

function cleanSubMenu(raw: unknown[], parent: string): WechatMpMenuButton[] {
  if (raw.length > 5) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `菜单「${parent}」最多 5 个二级菜单`,
    );
  }
  return raw.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    const name = textOf(row.name).trim().slice(0, 16);
    if (!name) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `菜单「${parent}」下有二级菜单未填写名称`,
      );
    }
    const type = row.type === 'click' ? 'click' : 'view';
    if (type === 'view') {
      const url = textOf(row.url).trim();
      if (!/^https:\/\//i.test(url)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `二级菜单「${name}」的 URL 必须以 https:// 开头`,
        );
      }
      return { type, name, url };
    }
    const key = textOf(row.key).trim().slice(0, 128);
    if (!key) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `二级菜单「${name}」必须填写事件 key`,
      );
    }
    return { type, name, key };
  });
}

function mapRemoteMenu(raw: unknown[]): WechatMpMenuButton[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 3).map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    const name = textOf(row.name).slice(0, 16);
    const subs = Array.isArray(row.sub_button)
      ? mapRemoteMenu(row.sub_button)
      : undefined;
    const type = row.type === 'click' ? 'click' : 'view';
    const url = textOf(row.url);
    const key = textOf(row.key);
    return {
      type,
      name,
      ...(type === 'view' && url ? { url } : {}),
      ...(type === 'click' && key ? { key } : {}),
      ...(subs?.length ? { sub_button: subs } : {}),
    };
  });
}

/** 平台「微信服务号设置」与用户侧绑定。方法名与 WechatMp_ / WechatMpAdmin_ 契约后缀一一对应。 */
export class WechatMpController {
  constructor(
    private readonly settingsService: WechatMpSettingsService,
    private readonly bindingService: WechatMpBindingService,
    private readonly push: WechatMpPushService,
    private readonly client: WechatMpClient,
    private readonly identity: IdentityService,
  ) {}

  // ---------- 用户侧 ----------

  async status(user: CurrentUser) {
    return this.bindingService.status(user);
  }

  async bindScene(user: CurrentUser) {
    return this.bindingService.createBindScene(user);
  }

  async unbind(user: CurrentUser) {
    return this.bindingService.unbind(user);
  }

  // ---------- 平台管理 ----------

  async settings(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.settingsService.view();
  }

  async saveSettings(user: CurrentUser, body: WechatMpSettingsInput) {
    this.identity.requireAdmin(user);
    return this.settingsService.save(body, user.userId);
  }

  async test(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const settings = await this.settingsService.load();
    try {
      const runtime = await this.settingsService.requireRuntime({
        requireEnabled: false,
      });
      const list = await this.client.templates(runtime);
      return {
        ok: true,
        accountName: settings.accountName,
        templateCount: list.length,
        message: '连接成功，已读取服务号模板列表',
      };
    } catch (error) {
      return {
        ok: false,
        accountName: settings.accountName,
        templateCount: 0,
        message: error instanceof Error ? error.message : '连接失败',
      };
    }
  }

  async templates(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const runtime = await this.settingsService.requireRuntime({
      requireEnabled: false,
    });
    return this.client.templates(runtime);
  }

  async testSend(
    user: CurrentUser,
    body: { eventKey?: WechatMpEventKey; userId?: string },
  ) {
    this.identity.requireAdmin(user);
    return this.push.testSend(user, body);
  }

  async saveTemplates(
    user: CurrentUser,
    body: { templates: WechatMpTemplateMap[] },
  ) {
    this.identity.requireAdmin(user);
    return this.settingsService.saveTemplates(body.templates, user.userId);
  }

  async menu(user: CurrentUser): Promise<WechatMpMenu> {
    this.identity.requireAdmin(user);
    return this.settingsService.menu();
  }

  async saveMenu(user: CurrentUser, body: { button: WechatMpMenuButton[] }) {
    this.identity.requireAdmin(user);
    const button = cleanMenu(body.button);
    return this.settingsService.saveMenu(button, user.userId);
  }

  async publishMenu(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const menu = await this.settingsService.menu();
    if (!menu.button.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先添加至少一个菜单并保存草稿',
      );
    }
    const runtime = await this.settingsService.requireRuntime();
    const button = cleanMenu(menu.button).map((item) =>
      item.sub_button?.length
        ? { name: item.name, sub_button: item.sub_button }
        : item,
    );
    await this.client.createMenu(runtime, button);
    await this.settingsService.markMenuPublished(user.userId);
    return { published: true, message: '菜单已发布到微信服务号' };
  }

  async pullMenu(user: CurrentUser): Promise<WechatMpMenu> {
    this.identity.requireAdmin(user);
    const runtime = await this.settingsService.requireRuntime();
    const remote = await this.client.getMenu(runtime);
    return this.settingsService.replaceMenu(mapRemoteMenu(remote), user.userId);
  }

  async bindings(user: CurrentUser, query: Record<string, unknown>) {
    this.identity.requireAdmin(user);
    return this.bindingService.listBindings(query);
  }

  async unbindBinding(user: CurrentUser, userId: string) {
    this.identity.requireAdmin(user);
    return this.bindingService.unbindByAdmin(user, userId);
  }

  async messages(user: CurrentUser, query: Record<string, unknown>) {
    this.identity.requireAdmin(user);
    return this.push.listMessages(query);
  }

  async retry(user: CurrentUser, id: string) {
    this.identity.requireAdmin(user);
    return this.push.retry(user, id);
  }

  async stats(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.push.stats();
  }
}
