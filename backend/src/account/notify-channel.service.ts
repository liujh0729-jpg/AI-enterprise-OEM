import { createHmac, randomBytes, createHash } from 'node:crypto';
import { request } from 'node:https';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AccountSettingsService } from './account-settings.service';

export type VerifyScene = 'REGISTER' | 'LOGIN' | 'RESET_PASSWORD' | 'REBIND';
export type VerifyChannel = 'EMAIL' | 'SMS';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_GAP_MS = 60_000;
const MAX_VERIFY_FAILS = 5;

/**
 * 账户板块的验证码 / 重置邮件 / 短信下发：
 * 验证码只存 SHA-256 哈希（verify_codes 表），5 分钟有效、60 秒重发、单目标日上限、连错 5 次作废。
 */
export class NotifyChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AccountSettingsService,
  ) {}

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  /** 发送邮箱验证码/重置链接：配了重置链接前缀走链接邮件，否则发 6 位验证码。返回一次性 token（仅链接场景）。 */
  async sendEmailCode(
    scene: VerifyScene,
    email: string,
    subject: string,
    bodyText: (code: string) => string,
  ): Promise<string | undefined> {
    const smtp = await this.settings.smtp();
    if (!smtp) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '邮箱通道未启用：请联系管理员在后台配置 SMTP',
      );
    }
    await this.assertResendAllowed('EMAIL', email);
    const linkBase = await this.settings.resetLinkBase();
    const useLink = scene === 'RESET_PASSWORD' && !!linkBase;
    const secret = useLink
      ? randomBytes(24).toString('hex')
      : String(randomBytes(3).readUIntBE(0, 3) % 1000000).padStart(6, '0');
    const password = this.settings.smtpPassword(smtp);
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: password },
    });
    await transport.sendMail({
      from: smtp.from,
      to: email,
      subject,
      text: useLink
        ? `${bodyText('')}重置链接（30 分钟内有效）：${linkBase.replace(/\/$/, '')}/reset-password?token=${secret}`
        : bodyText(secret),
    });
    transport.close();
    await this.storeCode(
      scene,
      'EMAIL',
      email,
      secret,
      useLink ? 30 * 60_000 : CODE_TTL_MS,
    );
    return useLink ? secret : undefined;
  }

  /** 发送阿里云短信验证码（6 位数字，模板参数固定为 code）。 */
  async sendSmsCode(scene: VerifyScene, phone: string): Promise<void> {
    const sms = await this.settings.sms();
    if (!sms) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '短信通道未启用：请联系管理员在后台配置阿里云短信',
      );
    }
    await this.assertResendAllowed('SMS', phone, sms.dailyLimit);
    const code = String(randomBytes(3).readUIntBE(0, 3) % 1000000).padStart(
      6,
      '0',
    );
    await this.aliyunSms(phone, sms.signName, sms.templateCode, code);
    await this.storeCode(scene, 'SMS', phone, code, CODE_TTL_MS);
  }

  /** 校验并消费验证码/令牌：成功即标记 used_at，连错 5 次作废。 */
  async consumeCode(
    scene: VerifyScene,
    channel: VerifyChannel,
    target: string,
    code: string,
  ) {
    const row = await this.prisma.verifyCode.findFirst({
      where: { scene, channel, target, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt < new Date()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '验证码已过期，请重新获取',
      );
    }
    if (row.failCount >= MAX_VERIFY_FAILS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '验证码错误次数过多，请重新获取',
      );
    }
    if (this.hash(code) !== row.codeHash) {
      await this.prisma.verifyCode.update({
        where: { id: row.id },
        data: { failCount: { increment: 1 } },
      });
      throw new BusinessException(ErrorCode.BAD_REQUEST, '验证码不正确');
    }
    await this.prisma.verifyCode.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
  }

  private async assertResendAllowed(
    channel: VerifyChannel,
    target: string,
    dailyLimit = 20,
  ) {
    const last = await this.prisma.verifyCode.findFirst({
      where: { channel, target },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_GAP_MS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '发送太频繁，请稍后再试',
      );
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = await this.prisma.verifyCode.count({
      where: { channel, target, createdAt: { gte: dayStart } },
    });
    if (today >= dailyLimit) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '今日发送次数已达上限',
      );
    }
  }

  private async storeCode(
    scene: VerifyScene,
    channel: VerifyChannel,
    target: string,
    code: string,
    ttlMs: number,
  ) {
    await this.prisma.verifyCode.create({
      data: {
        scene,
        channel,
        target,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
  }

  /** 阿里云短信 Dysmsapi（RPC 风格 HMAC-SHA1 签名，无需 SDK）。 */
  private async aliyunSms(
    phone: string,
    signName: string,
    templateCode: string,
    code: string,
  ): Promise<void> {
    const settings = await this.settings.sms();
    if (!settings) throw new Error('短信未配置');
    const secret = this.settings.smsSecret(settings);
    const percent = (value: string) =>
      encodeURIComponent(value)
        .replace(/\+/g, '%20')
        .replace(/\*/g, '%2A')
        .replace(/%7E/g, '~');
    const params: Record<string, string> = {
      Action: 'SendSms',
      Version: '2017-05-25',
      Format: 'JSON',
      RegionId: 'cn-hangzhou',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomBytes(16).toString('hex'),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      AccessKeyId: settings.accessKeyId,
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
    };
    const sorted = Object.keys(params)
      .sort()
      .map((key) => `${percent(key)}=${percent(params[key])}`)
      .join('&');
    const stringToSign = `GET&%2F&${percent(sorted)}`;
    const signature = createHmac('sha1', `${secret}&`)
      .update(stringToSign)
      .digest('base64');
    const url = `https://dysmsapi.aliyuncs.com/?Signature=${percent(signature)}&${sorted}`;
    return new Promise<void>((resolve, reject) => {
      const req = request(url, { method: 'GET', timeout: 8000 }, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const payload = JSON.parse(raw) as {
              Code?: string;
              Message?: string;
            };
            if (payload.Code === 'OK') resolve();
            else
              reject(
                new BusinessException(
                  ErrorCode.BAD_REQUEST,
                  `短信发送失败：${payload.Message || payload.Code || '未知错误'}`,
                ),
              );
          } catch {
            reject(
              new BusinessException(
                ErrorCode.BAD_REQUEST,
                '短信服务返回内容异常',
              ),
            );
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('短信服务超时')));
      req.on('error', (error) =>
        reject(
          error instanceof BusinessException
            ? error
            : new BusinessException(
                ErrorCode.SERVICE_UNAVAILABLE,
                '短信服务暂时不可用',
              ),
        ),
      );
      req.end();
    });
  }
}
