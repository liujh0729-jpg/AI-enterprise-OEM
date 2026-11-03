import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AccountCrypto } from './account-crypto';

export type RegisterMode = 'USERNAME' | 'EMAIL' | 'PHONE';
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

/**
 * 账户板块的后台可配设置（存 system_settings 键值表）：
 * 注册通道、找回密码链接前缀、注销冷静期，以及 SMTP / 阿里云短信凭据（敏感项 AES-GCM 密文存储）。
 */
export class AccountSettingsService {
  static readonly REGISTER_MODES_KEY = 'account_register_modes';
  static readonly SMTP_KEY = 'account_smtp';
  static readonly SMS_KEY = 'account_sms';
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
      const parsed = JSON.parse(await this.read(AccountSettingsService.REGISTER_MODES_KEY));
      if (Array.isArray(parsed)) {
        const modes = parsed.filter(
          (m): m is RegisterMode => ['USERNAME', 'EMAIL', 'PHONE'].includes(String(m)),
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
  async smtpPassword(settings: SmtpSettings): Promise<string> {
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
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'SMTP 的 host / 账号 / 发件人必填');
    }
    const previous = this.parseSmtp(await this.read(AccountSettingsService.SMTP_KEY));
    const next: SmtpSettings = {
      host: String(body.host).trim(),
      port: Number(body.port) || 465,
      secure: body.secure !== false,
      user: String(body.user).trim(),
      from: String(body.from).trim(),
      passCipher: body.password
        ? this.crypto.encrypt(String(body.password))
        : (previous?.passCipher || ''),
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
  async smsSecret(settings: SmsSettings): Promise<string> {
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
    const previous = this.parseSms(await this.read(AccountSettingsService.SMS_KEY));
    const next: SmsSettings = {
      accessKeyId: String(body.accessKeyId).trim(),
      accessKeySecretCipher: body.accessKeySecret
        ? this.crypto.encrypt(String(body.accessKeySecret))
        : (previous?.accessKeySecretCipher || ''),
      signName: String(body.signName).trim(),
      templateCode: String(body.templateCode).trim(),
      dailyLimit: Number(body.dailyLimit) > 0 ? Number(body.dailyLimit) : 10,
    };
    await this.write(AccountSettingsService.SMS_KEY, JSON.stringify(next));
  }

  // ---------- 注册通道开关 ----------
  async saveRegisterModes(modes: RegisterMode[], availability: Record<RegisterMode, boolean>) {
    const picked = [...new Set(modes)];
    if (!picked.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '至少保留一种注册方式');
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
    await this.write(AccountSettingsService.REGISTER_MODES_KEY, JSON.stringify(picked));
  }

  async saveAccountPolicy(body: {
    cooldownDays?: number;
    resetLinkBase?: string;
  }) {
    if (body.cooldownDays !== undefined) {
      const days = Number(body.cooldownDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '冷静期需为 0-365 的整数天');
      }
      await this.write(AccountSettingsService.COOLDOWN_KEY, String(days));
    }
    if (body.resetLinkBase !== undefined) {
      const base = String(body.resetLinkBase).trim();
      if (base && !/^https?:\/\//.test(base)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '重置链接前缀需以 http(s):// 开头');
      }
      await this.write(AccountSettingsService.RESET_LINK_KEY, base);
    }
  }

  /** 后台展示用：脱敏快照。 */
  async maskedView() {
    const [modes, smtp, sms, cooldown, resetLink] = await Promise.all([
      this.registerModes(),
      this.smtp(),
      this.sms(),
      this.cooldownDays(),
      this.resetLinkBase(),
    ]);
    return {
      registerModes: modes,
      availability: await this.channelAvailability(),
      smtp: smtp
        ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, configured: true }
        : { configured: false },
      sms: sms
        ? { accessKeyId: sms.accessKeyId, signName: sms.signName, templateCode: sms.templateCode, dailyLimit: sms.dailyLimit, configured: true }
        : { configured: false },
      cooldownDays: cooldown,
      resetLinkBase: resetLink,
    };
  }
}
