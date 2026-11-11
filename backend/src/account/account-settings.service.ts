import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';
import { AccountCrypto } from './account-crypto';

export type RegisterMode = 'USERNAME' | 'EMAIL' | 'PHONE';
export type LoginMethod = 'PASSWORD' | 'EMAIL_CODE' | 'SMS_CODE' | 'WECHAT';
export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passCipher: string;
};
export type SmsSettings = {
  accessKeyId: string;
  accessKeySecretCipher: string;
  signName: string;
  templateCode: string;
  dailyLimit: number;
};
export type WechatSettings = {
  /** WECHAT_OPEN（开放平台网站应用扫码）等：绑定表里的 provider 口径。 */
  provider: string;
  appId: string;
  appSecretCipher: string;
  /** 后台总开关：关掉后登录页不出现「微信扫码」，回调也直接拒绝。 */
  enabled: boolean;
  /** 授权范围：开放平台网站应用固定 snsapi_login。 */
  scopes: string;
  /** 扫码后未绑定：true 自动建号，false 引导绑定已有账号。 */
  autoRegister: boolean;
};

/**
 * 账户板块的后台可配设置（存 system_settings 键值表）：
 * 注册通道、登录方式、找回密码链接前缀、注销冷静期，以及 SMTP / 阿里云短信 / 微信凭据（敏感项 AES-GCM 密文存储）。
 */
export class AccountSettingsService {
  static readonly REGISTER_MODES_KEY = 'account_register_modes';
  static readonly LOGIN_METHODS_KEY = 'account_login_methods';
  static readonly SMTP_KEY = 'account_smtp';
  static readonly SMS_KEY = 'account_sms';
  static readonly WECHAT_KEY = 'account_wechat';
  static readonly COOLDOWN_KEY = 'account_deactivate_cooldown_days';
  static readonly RESET_LINK_KEY = 'account_reset_link_base';

  private readonly crypto = new AccountCrypto();

  constructor(private readonly prisma: PrismaService) {}

  private async read(key: string): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value || '';
  }
  private async write(key: string, value: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** 注册通道：默认只开用户名注册（开源版开箱即用，无外部依赖）。 */
  async registerModes(): Promise<RegisterMode[]> {
    try {
      const parsed = JSON.parse(
        await this.read(AccountSettingsService.REGISTER_MODES_KEY),
      ) as unknown[];
      if (Array.isArray(parsed)) {
        const modes = parsed.filter((m): m is RegisterMode =>
          ['USERNAME', 'EMAIL', 'PHONE'].includes(text(m)),
        );
        if (modes.length) return [...new Set(modes)];
      }
    } catch {
      /* 配置损坏时回落默认 */
    }
    return ['USERNAME'];
  }

  /** 各通道可用性：EMAIL/PHONE 必须在后台配好对应渠道才可选。 */
  async channelAvailability() {
    return {
      USERNAME: true,
      EMAIL: await this.smtpConfigured(),
      PHONE: await this.smsConfigured(),
    };
  }

  /** 登录方式：默认只开常规登录（账号 + 密码），开箱即用无外部依赖。 */
  async loginMethods(): Promise<LoginMethod[]> {
    try {
      const parsed = JSON.parse(
        await this.read(AccountSettingsService.LOGIN_METHODS_KEY),
      ) as unknown[];
      if (Array.isArray(parsed)) {
        const methods = parsed.filter((m): m is LoginMethod =>
          ['PASSWORD', 'EMAIL_CODE', 'SMS_CODE', 'WECHAT'].includes(text(m)),
        );
        if (methods.length) return [...new Set(methods)];
      }
    } catch {
      /* 配置损坏时回落默认 */
    }
    return ['PASSWORD'];
  }

  /** 各登录方式可用性：验证码类需配好对应渠道、微信需配好参数才可选。 */
  async loginAvailability() {
    const [smtp, sms, wechat] = await Promise.all([
      this.smtpConfigured(),
      this.smsConfigured(),
      this.wechatConfigured(),
    ]);
    return {
      PASSWORD: true,
      EMAIL_CODE: smtp,
      SMS_CODE: sms,
      WECHAT: wechat,
    };
  }

  /**
   * 找回密码 / 已登录验证码设密可用性：与登录方式同一份策略。
   * 密码登录未开启时整条找回链路关闭（避免「能重置却无法用密码登录」）；
   * 某通道需同时「勾选登录方式」且「通道凭据已配置」。
   */
  async passwordRecoveryAvailability() {
    const [methods, availability] = await Promise.all([
      this.loginMethods(),
      this.loginAvailability(),
    ]);
    const passwordEnabled = methods.includes('PASSWORD');
    const EMAIL =
      passwordEnabled &&
      methods.includes('EMAIL_CODE') &&
      availability.EMAIL_CODE;
    const SMS =
      passwordEnabled && methods.includes('SMS_CODE') && availability.SMS_CODE;
    return { enabled: EMAIL || SMS, PASSWORD: passwordEnabled, EMAIL, SMS };
  }

  /**
   * 公开配置：登录页据此渲染「有哪些方式」「微信开没开」「忘记密码能不能点」。
   * 只回布尔与方式名，微信 AppID/Secret 永不回传。
   */
  async publicLoginView() {
    const [methods, availability, wechat, passwordRecovery] = await Promise.all(
      [
        this.loginMethods(),
        this.loginAvailability(),
        this.wechat(),
        this.passwordRecoveryAvailability(),
      ],
    );
    return {
      loginMethods: methods,
      loginAvailability: availability,
      wechat: { enabled: !!wechat?.enabled },
      passwordRecovery,
    };
  }

  async cooldownDays(): Promise<number> {
    const raw = Number(await this.read(AccountSettingsService.COOLDOWN_KEY));
    return Number.isInteger(raw) && raw >= 0 ? raw : 15;
  }
  /** 找回密码邮件里的重置链接前缀（前端页面地址）；未配置时邮箱走验证码而非链接。 */
  async resetLinkBase(): Promise<string> {
    return (await this.read(AccountSettingsService.RESET_LINK_KEY)).trim();
  }

  // ---------- SMTP ----------
  private parseSmtp(raw: string): SmtpSettings | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as SmtpSettings;
      return value?.host && value?.user && value?.from ? value : null;
    } catch {
      return null;
    }
  }
  async smtpConfigured(): Promise<boolean> {
    return !!this.parseSmtp(await this.read(AccountSettingsService.SMTP_KEY));
  }
  async smtp(): Promise<SmtpSettings | null> {
    return this.parseSmtp(await this.read(AccountSettingsService.SMTP_KEY));
  }
  smtpPassword(settings: SmtpSettings): string {
    return this.crypto.decrypt(settings.passCipher);
  }
  /** 保存 SMTP 设置：密码字段传空串表示保留原密码。 */
  async saveSmtp(body: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    from?: string;
    password?: string;
  }) {
    if (!body.host || !body.user || !body.from) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'SMTP 的 host / 账号 / 发件人必填',
      );
    }
    const previous = this.parseSmtp(
      await this.read(AccountSettingsService.SMTP_KEY),
    );
    const next: SmtpSettings = {
      host: String(body.host).trim(),
      port: Number(body.port) || 465,
      secure: body.secure !== false,
      user: String(body.user).trim(),
      from: String(body.from).trim(),
      passCipher: body.password
        ? this.crypto.encrypt(String(body.password))
        : previous?.passCipher || '',
    };
    await this.write(AccountSettingsService.SMTP_KEY, JSON.stringify(next));
  }

  // ---------- 阿里云短信 ----------
  private parseSms(raw: string): SmsSettings | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as SmsSettings;
      return value?.accessKeyId && value?.signName && value?.templateCode
        ? value
        : null;
    } catch {
      return null;
    }
  }
  async smsConfigured(): Promise<boolean> {
    return !!this.parseSms(await this.read(AccountSettingsService.SMS_KEY));
  }
  async sms(): Promise<SmsSettings | null> {
    return this.parseSms(await this.read(AccountSettingsService.SMS_KEY));
  }
  smsSecret(settings: SmsSettings): string {
    return this.crypto.decrypt(settings.accessKeySecretCipher);
  }
  /** 保存短信设置：AccessKeySecret 传空串表示保留原值。 */
  async saveSms(body: {
    accessKeyId?: string;
    accessKeySecret?: string;
    signName?: string;
    templateCode?: string;
    dailyLimit?: number;
  }) {
    if (!body.accessKeyId || !body.signName || !body.templateCode) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '阿里云短信的 AccessKeyId / 签名 / 模板 Code 必填',
      );
    }
    const previous = this.parseSms(
      await this.read(AccountSettingsService.SMS_KEY),
    );
    const next: SmsSettings = {
      accessKeyId: String(body.accessKeyId).trim(),
      accessKeySecretCipher: body.accessKeySecret
        ? this.crypto.encrypt(String(body.accessKeySecret))
        : previous?.accessKeySecretCipher || '',
      signName: String(body.signName).trim(),
      templateCode: String(body.templateCode).trim(),
      dailyLimit: Number(body.dailyLimit) > 0 ? Number(body.dailyLimit) : 10,
    };
    await this.write(AccountSettingsService.SMS_KEY, JSON.stringify(next));
  }

  // ---------- 微信扫码 ----------
  private parseWechat(raw: string): WechatSettings | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as WechatSettings;
      return value?.appId ? value : null;
    } catch {
      return null;
    }
  }
  /** 参数齐备＝能发起扫码授权（AppID 有值且密钥非空），与 enabled 开关分开判断。 */
  async wechatConfigured(): Promise<boolean> {
    const settings = this.parseWechat(
      await this.read(AccountSettingsService.WECHAT_KEY),
    );
    return !!settings && !!settings.appSecretCipher;
  }
  async wechat(): Promise<WechatSettings | null> {
    return this.parseWechat(await this.read(AccountSettingsService.WECHAT_KEY));
  }
  wechatSecret(settings: WechatSettings): string {
    return this.crypto.decrypt(settings.appSecretCipher);
  }
  /** 保存微信设置：AppSecret 传空串表示保留原密钥。 */
  async saveWechat(body: {
    provider?: string;
    appId?: string;
    appSecret?: string;
    enabled?: boolean;
    scopes?: string;
    autoRegister?: boolean;
  }) {
    if (!body.appId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '微信 AppID 必填');
    }
    const previous = this.parseWechat(
      await this.read(AccountSettingsService.WECHAT_KEY),
    );
    const next: WechatSettings = {
      provider: String(
        body.provider || previous?.provider || 'WECHAT_OPEN',
      ).trim(),
      appId: String(body.appId).trim(),
      appSecretCipher: body.appSecret
        ? this.crypto.encrypt(String(body.appSecret))
        : previous?.appSecretCipher || '',
      enabled: body.enabled === true,
      scopes: String(body.scopes || previous?.scopes || 'snsapi_login').trim(),
      autoRegister: body.autoRegister !== false,
    };
    if (next.enabled && !next.appSecretCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '启用微信登录前先填 AppSecret',
      );
    }
    await this.write(AccountSettingsService.WECHAT_KEY, JSON.stringify(next));
  }

  // ---------- 注册通道开关 ----------
  async saveRegisterModes(
    modes: RegisterMode[],
    availability: Record<RegisterMode, boolean>,
  ) {
    const picked = [...new Set(modes)];
    if (!picked.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '至少保留一种注册方式',
      );
    }
    for (const mode of picked) {
      if (!availability[mode]) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          mode === 'EMAIL'
            ? '开通邮箱注册 / 找回前先配好 SMTP'
            : '开通手机号注册 / 找回前先配好阿里云短信',
        );
      }
    }
    await this.write(
      AccountSettingsService.REGISTER_MODES_KEY,
      JSON.stringify(picked),
    );
  }

  // ---------- 登录方式开关 ----------
  async saveLoginMethods(
    methods: LoginMethod[],
    availability: Record<LoginMethod, boolean>,
  ) {
    const picked = [...new Set(methods)];
    if (!picked.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '至少保留一种登录方式',
      );
    }
    for (const method of picked) {
      if (!availability[method]) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          method === 'EMAIL_CODE'
            ? '开通邮箱验证码登录前先配好 SMTP'
            : method === 'SMS_CODE'
              ? '开通手机验证码登录前先配好阿里云短信'
              : '开通微信登录前先配好微信参数',
        );
      }
    }
    await this.write(
      AccountSettingsService.LOGIN_METHODS_KEY,
      JSON.stringify(picked),
    );
  }

  async saveAccountPolicy(body: {
    cooldownDays?: number;
    resetLinkBase?: string;
  }) {
    if (body.cooldownDays !== undefined) {
      const days = Number(body.cooldownDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '冷静期需为 0-365 的整数天',
        );
      }
      await this.write(AccountSettingsService.COOLDOWN_KEY, String(days));
    }
    if (body.resetLinkBase !== undefined) {
      const base = String(body.resetLinkBase).trim();
      if (base && !/^https?:\/\//.test(base)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '重置链接前缀需以 http(s):// 开头',
        );
      }
      await this.write(AccountSettingsService.RESET_LINK_KEY, base);
    }
  }

  /** 后台展示用：脱敏快照。 */
  async maskedView() {
    const [modes, loginMethods, smtp, sms, wechat, cooldown, resetLink] =
      await Promise.all([
        this.registerModes(),
        this.loginMethods(),
        this.smtp(),
        this.sms(),
        this.wechat(),
        this.cooldownDays(),
        this.resetLinkBase(),
      ]);
    return {
      registerModes: modes,
      loginMethods,
      availability: await this.channelAvailability(),
      loginAvailability: await this.loginAvailability(),
      smtp: smtp
        ? {
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            user: smtp.user,
            from: smtp.from,
            configured: true,
          }
        : { configured: false },
      sms: sms
        ? {
            accessKeyId: sms.accessKeyId,
            signName: sms.signName,
            templateCode: sms.templateCode,
            dailyLimit: sms.dailyLimit,
            configured: true,
          }
        : { configured: false },
      wechat: {
        provider: wechat?.provider || 'WECHAT_OPEN',
        appId: wechat?.appId || '',
        enabled: !!wechat?.enabled,
        scopes: wechat?.scopes || 'snsapi_login',
        autoRegister: wechat?.autoRegister !== false,
        configured: !!wechat?.appSecretCipher,
      },
      cooldownDays: cooldown,
      resetLinkBase: resetLink,
      passwordRecovery: await this.passwordRecoveryAvailability(),
    };
  }
}
