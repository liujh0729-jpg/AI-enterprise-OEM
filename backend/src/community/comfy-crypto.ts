import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * Comfy Cloud API Key 的落库加解密（创意社区·纯 BYOK）。
 * 算法与 ContentCrypto / RpaCrypto 同构（AES-256-GCM），密钥源沿用 EXTERNAL_CRED_KEY，
 * 但上下文单独用 `aiworkin-comfy-community`：一处密钥泄漏不会把别的域一起解开。
 */
export class ComfyCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：Comfy Cloud 凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-comfy-community|${secret}`)
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
        'Comfy Cloud 凭据无法解密（凭据加密密钥已变更？），请重新保存 API Key',
      );
    }
  }

  /** 缓存/日志用的稳定指纹：绝不落原文，也便于按 Key 维度分桶而不把 Key 放进内存 Map 的键。 */
  fingerprint(plain: string): string {
    return createHash('sha256')
      .update(`aiworkin-comfy-community|${plain}`)
      .digest('hex')
      .slice(0, 32);
  }
}

/** 掩码口径与全站一致（前 4 + … + 后 4）：社区域单独引一份，避免 content 模块被拖进依赖图。 */
export function maskComfyKey(plain: string) {
  const value = String(plain || '');
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
