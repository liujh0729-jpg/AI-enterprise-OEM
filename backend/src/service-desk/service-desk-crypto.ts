import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * AI客服渠道凭据落库加解密。
 * 密钥源沿用 EXTERNAL_CRED_KEY，上下文单独用 `aiworkin-service-desk`，
 * 与 Agent 助理等模块互不复用。
 */
export class ServiceDeskCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：AI客服渠道凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-service-desk|${secret}`)
      .digest();
  }

  encrypt(plain: string): string {
    if (!plain) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString('base64'))
      .join(':');
  }

  decrypt(sealed: string): string {
    if (!sealed) return '';
    const [ivB64, tagB64, bodyB64] = String(sealed).split(':');
    if (!ivB64 || !tagB64 || !bodyB64) {
      throw new BusinessException(ErrorCode.INTERNAL_ERROR, '凭据密文格式非法');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivB64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(bodyB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '凭据密文无法解密（凭据加密密钥已变更？），请重新保存这条渠道',
      );
    }
  }

  sealConfig(config: Record<string, string>): string {
    const entries = Object.entries(config).filter(
      ([, value]) => String(value).trim() !== '',
    );
    return this.encrypt(JSON.stringify(Object.fromEntries(entries)));
  }

  openConfig(sealed: string): Record<string, string> {
    const raw = this.decrypt(sealed);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '渠道凭据内容损坏，请重新保存这条渠道',
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '渠道凭据内容损坏，请重新保存这条渠道',
      );
    }
    const config: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') config[key] = value;
    }
    return config;
  }
}
