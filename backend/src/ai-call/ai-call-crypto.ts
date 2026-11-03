import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * AI 调用账号凭据的落库加解密。
 *
 * 密钥源仍是 EXTERNAL_CRED_KEY，上下文单独用 `aiworkin-ai-call-cred`：
 * 上下文烧进了派生密钥，与外报 / RPA / Workbuddy 的密文互不可解。
 */
export class AiCallCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：AI 调用账号凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-ai-call-cred|${secret}`)
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
