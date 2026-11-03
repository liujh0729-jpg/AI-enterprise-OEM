import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * RPA 侧凭据（平台账号口令、AIPDD API Key）的落库加解密。
 *
 * 密钥源沿用 EXTERNAL_CRED_KEY，但上下文单独用 `aiworkin-rpa-cred`：
 * 已有的三套密文（外报 / 企享云 / GEO）都把自己的上下文烧进了密钥，
 * 换上下文即换密钥，所以不能复用它们的实现，否则已存密文一律解不开。
 */
export class RpaCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：RPA 凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-rpa-cred|${secret}`)
      .digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString('base64'))
      .join(':');
  }

  decrypt(sealed: string): string {
    const [ivB64, tagB64, bodyB64] = String(sealed || '').split(':');
    if (!ivB64 || !tagB64 || !bodyB64) {
      throw new BusinessException(ErrorCode.INTERNAL_ERROR, '凭据密文格式非法');
    }
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
  }
}

/** 掩码：只露首尾各 4 位，界面用它回显「已配置的是哪把 Key」。 */
export function maskKey(plain: string) {
  const value = String(plain || '');
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
