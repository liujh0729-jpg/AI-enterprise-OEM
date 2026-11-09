import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * SCRM 企业凭据（两个 Secret / 回调 Token / EncodingAESKey / 存档私钥）的落库加解密。
 * 密钥源仍是 EXTERNAL_CRED_KEY，上下文单独用 `wecom-scrm`，与 IM / 飞书 / 外报等互不可解。
 */
export class ScrmCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：企微 SCRM 凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256').update(`wecom-scrm|${secret}`).digest();
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
