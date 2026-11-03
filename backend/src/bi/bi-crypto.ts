import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** BI 外部数据源连接配置（含密码）落库加解密，上下文与其它模块隔离。 */
export class BiCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：BI 数据源凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-bi-datasource|${secret}`)
      .digest();
  }

  encrypt(plain: string) {
    if (!plain) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString('base64'))
      .join(':');
  }

  decrypt(sealed: string) {
    if (!sealed) return '';
    const [ivB64, tagB64, bodyB64] = String(sealed).split(':');
    if (!ivB64 || !tagB64 || !bodyB64) {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '数据源密文格式非法',
      );
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
        '数据源密文无法解密（凭据加密密钥变更？），请重新保存该数据源',
      );
    }
  }
}
