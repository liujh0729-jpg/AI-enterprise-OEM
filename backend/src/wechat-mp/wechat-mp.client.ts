import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import type {
  WechatMpRuntime,
  WechatMpSettingsService,
} from './wechat-mp.settings';

const API_BASE = (
  process.env.WECHAT_MP_API_BASE || 'https://api.weixin.qq.com'
).replace(/\/+$/, '');
const API_TIMEOUT_MS = 15_000;
const MAX_BYTES = 512 * 1024;

type MpPayload = { errcode?: number; errmsg?: string };

export type WechatMpTemplateItem = {
  templateId: string;
  title: string;
  content: string;
  example: string;
};

export type WechatMpSendResult = {
  errcode: number;
  errmsg: string;
  msgId: string;
};

/**
 * 微信服务号 HTTP 客户端：token 单飞缓存、二维码、模板、客服消息、菜单与网页授权。
 * 所有出站请求只走 httpRequest，错误统一转中文提示；推送类方法回 errcode 由调用方留痕。
 */
export class WechatMpClient {
  private readonly tokens = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly settings: WechatMpSettingsService) {}

  async runtime(): Promise<WechatMpRuntime> {
    return this.settings.requireRuntime();
  }

  private async accessToken(runtime: WechatMpRuntime, force = false) {
    const cached = this.tokens.get(runtime.appId);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = this.pending.get(runtime.appId);
    if (pending) return pending;
    const task = this.fetchAccessToken(runtime).finally(() =>
      this.pending.delete(runtime.appId),
    );
    this.pending.set(runtime.appId, task);
    return task;
  }

  private async fetchAccessToken(runtime: WechatMpRuntime) {
    const query = new URLSearchParams({
      grant_type: 'client_credential',
      appid: runtime.appId,
      secret: runtime.appSecret,
    });
    const data = await this.request<
      MpPayload & { access_token?: string; expires_in?: number }
    >(`${API_BASE}/cgi-bin/token?${query.toString()}`, {
      operation: 'wechat-mp-token',
    });
    if (!data.access_token) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `获取微信 access_token 失败（${data.errcode ?? '未知'}）${data.errmsg ? `：${data.errmsg}` : ''}，请核对 AppID / AppSecret`,
      );
    }
    const ttl = Math.max(Number(data.expires_in || 7200) - 300, 60);
    this.tokens.set(runtime.appId, {
      value: data.access_token,
      expiresAt: Date.now() + ttl * 1000,
    });
    return data.access_token;
  }

  private async request<T>(
    url: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      operation: string;
    },
  ): Promise<T> {
    let result;
    try {
      result = await httpRequest<T>(url, {
        method: options.method || 'GET',
        headers:
          options.body === undefined
            ? undefined
            : { 'content-type': 'application/json' },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        timeoutMs: API_TIMEOUT_MS,
        readAs: 'json',
        maxBytes: MAX_BYTES,
        operation: options.operation,
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        error instanceof TransportError && error.kind === 'timeout'
          ? '微信接口响应超时，请稍后重试'
          : '连接微信接口失败，请检查服务器网络',
      );
    }
    if (!result.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `微信接口暂不可用（HTTP ${result.status}）`,
      );
    }
    return (result.data || {}) as T;
  }

  private async withToken<T>(
    runtime: WechatMpRuntime,
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      operation: string;
    },
    retried = false,
  ): Promise<T> {
    const token = await this.accessToken(runtime, retried);
    const separator = path.includes('?') ? '&' : '?';
    const data = await this.request<T>(
      `${API_BASE}${path}${separator}access_token=${encodeURIComponent(token)}`,
      options,
    );
    const code = Number((data as MpPayload)?.errcode || 0);
    if (!retried && [40001, 40014, 42001].includes(code)) {
      this.tokens.delete(runtime.appId);
      return this.withToken<T>(runtime, path, options, true);
    }
    return data;
  }

  /** 连接自检与模板目录：两者共用同一份临时模板清单。 */
  async templates(runtime?: WechatMpRuntime): Promise<WechatMpTemplateItem[]> {
    const rt = runtime || (await this.runtime());
    const data = await this.withToken<
      MpPayload & { template_list?: unknown[] }
    >(rt, '/cgi-bin/template/get_all_private_template', {
      operation: 'wechat-mp-template-list',
    });
    this.assertOk(data, '获取模板列表');
    return (Array.isArray(data.template_list) ? data.template_list : []).map(
      (item) => {
        const row = (item || {}) as Record<string, unknown>;
        return {
          templateId: text(row.template_id),
          title: text(row.title),
          content: text(row.content),
          example: text(row.example),
        };
      },
    );
  }

  async createQrcode(
    runtime: WechatMpRuntime,
    scene: string,
    expireSeconds: number,
  ) {
    const data = await this.withToken<
      MpPayload & { ticket?: string; expire_seconds?: number; url?: string }
    >(runtime, '/cgi-bin/qrcode/create', {
      method: 'POST',
      operation: 'wechat-mp-qrcode',
      body: {
        expire_seconds: Math.min(Math.max(expireSeconds, 60), 2592000),
        action_name: 'QR_STR_SCENE',
        action_info: { scene: { scene_str: scene } },
      },
    });
    this.assertOk(data, '生成绑定二维码');
    if (!data.ticket) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信未返回二维码 ticket，请确认服务号已通过认证',
      );
    }
    return {
      ticket: data.ticket,
      expireSeconds: Number(data.expire_seconds || expireSeconds),
      url: this.showQrcodeUrl(data.ticket),
    };
  }

  showQrcodeUrl(ticket: string) {
    return `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(ticket)}`;
  }

  async sendTemplate(
    runtime: WechatMpRuntime,
    input: {
      openId: string;
      templateId: string;
      url: string;
      data: Record<string, { value: string }>;
    },
  ): Promise<WechatMpSendResult> {
    const data = await this.withToken<MpPayload & { msgid?: number }>(
      runtime,
      '/cgi-bin/message/template/send',
      {
        method: 'POST',
        operation: 'wechat-mp-template-send',
        body: {
          touser: input.openId,
          template_id: input.templateId,
          url: input.url || undefined,
          data: input.data,
        },
      },
    );
    return {
      errcode: Number(data.errcode || 0),
      errmsg: String(data.errmsg || ''),
      msgId: data.msgid ? String(data.msgid) : '',
    };
  }

  async sendCustomText(
    runtime: WechatMpRuntime,
    openId: string,
    content: string,
  ): Promise<WechatMpSendResult> {
    const data = await this.withToken<MpPayload & { msgid?: number }>(
      runtime,
      '/cgi-bin/message/custom/send',
      {
        method: 'POST',
        operation: 'wechat-mp-custom-send',
        body: {
          touser: openId,
          msgtype: 'text',
          text: { content: content.slice(0, 2000) },
        },
      },
    );
    return {
      errcode: Number(data.errcode || 0),
      errmsg: String(data.errmsg || ''),
      msgId: data.msgid ? String(data.msgid) : '',
    };
  }

  async createMenu(runtime: WechatMpRuntime, button: unknown[]) {
    const data = await this.withToken<MpPayload>(
      runtime,
      '/cgi-bin/menu/create',
      {
        method: 'POST',
        operation: 'wechat-mp-menu-create',
        body: { button },
      },
    );
    this.assertOk(data, '发布菜单');
  }

  async getMenu(runtime: WechatMpRuntime): Promise<unknown[]> {
    const data = await this.withToken<
      MpPayload & { menu?: { button?: unknown[] } }
    >(runtime, '/cgi-bin/menu/get', {
      operation: 'wechat-mp-menu-get',
    });
    // 46003：服务号尚未创建自定义菜单，按空菜单处理。
    if (Number(data.errcode || 0) === 46003) return [];
    this.assertOk(data, '拉取菜单');
    return Array.isArray(data.menu?.button) ? data.menu.button : [];
  }

  private assertOk(data: MpPayload, action: string) {
    const code = Number(data.errcode || 0);
    if (code !== 0) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `${action}失败（${code}）${data.errmsg ? `：${data.errmsg}` : ''}`,
      );
    }
  }
}
