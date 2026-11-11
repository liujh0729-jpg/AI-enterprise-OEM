import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * 微信服务号敏感配置与回调报文处理。
 *
 * 凭据加解密沿用 EXTERNAL_CRED_KEY，但上下文单独用 `oem-wechat-mp`，
 * 与账号、IM、BI 等模块的密文互不可解。
 */
export class WechatMpCrypto {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.EXTERNAL_CRED_KEY ?? '').trim();
    if (!secret) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：微信服务号凭据加密需要独立的 AES-256-GCM 密钥来源',
      );
    }
    this.key = createHash('sha256').update(`oem-wechat-mp|${secret}`).digest();
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
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '微信凭据密文格式非法',
      );
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

  /** 网页授权 state 签名：不落库，靠 HMAC + 时间戳 + nonce Cookie 防篡改与重放。 */
  signState(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  verifyState(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.signState(payload));
    const actual = Buffer.from(String(signature || ''));
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

function sha1Signature(parts: string[]) {
  return createHash('sha1').update(parts.sort().join('')).digest('hex');
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 微信服务器配置验证与消息回调的统一验签（安全模式下把 Encrypt 一起参与）。 */
export function assertWechatMpSignature(
  token: string,
  query: Record<string, string>,
  field: 'signature' | 'msg_signature',
  encrypted = '',
) {
  const timestamp = String(query.timestamp || '');
  const nonce = String(query.nonce || '');
  const signature = String(query[field] || '');
  if (!timestamp || !nonce || !signature) {
    throw new BusinessException(ErrorCode.FORBIDDEN, '微信回调缺少签名参数');
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) {
    throw new BusinessException(ErrorCode.FORBIDDEN, '微信回调时间戳已过期');
  }
  const expected = sha1Signature(
    encrypted
      ? [token, timestamp, nonce, encrypted]
      : [token, timestamp, nonce],
  );
  if (!sameSecret(expected, signature)) {
    throw new BusinessException(ErrorCode.FORBIDDEN, '微信回调签名校验失败');
  }
}

export function wechatMpAesKey(encodingAesKey: string) {
  const value = String(encodingAesKey || '').trim();
  if (value.length !== 43) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'EncodingAESKey 需要 43 位',
    );
  }
  return Buffer.from(`${value}=`, 'base64');
}

/** 解密安全模式的 XML 密文，并校验尾部 AppID。 */
export function decryptWechatMpXml(
  sealed: string,
  encodingAesKey: string,
  appId: string,
) {
  const key = wechatMpAesKey(encodingAesKey);
  const buffer = Buffer.from(String(sealed || ''), 'base64');
  if (!buffer.length) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '微信回文密文为空');
  }
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(buffer), decipher.final()]);
    const pad = plain[plain.length - 1];
    if (pad < 1 || pad > 32) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '微信回文密文填充非法',
      );
    }
    const content = plain.subarray(0, plain.length - pad);
    const length = content.readUInt32BE(16);
    const message = content.subarray(20, 20 + length).toString('utf8');
    const receiveId = content.subarray(20 + length).toString('utf8');
    if (appId && receiveId && receiveId !== appId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '微信回调与当前服务号不匹配',
      );
    }
    return message;
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '微信回调解密失败，请核对 Token / EncodingAESKey',
    );
  }
}

export function xmlValue(xml: string, tag: string) {
  const matched = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!matched) return '';
  return matched[1]
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim();
}

function cdata(value: string) {
  return `<![CDATA[${String(value || '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** 被动回复文本消息（5 秒内同步返回）。 */
export function buildWechatMpTextReply(input: {
  toUser: string;
  fromUser: string;
  content: string;
}) {
  const content = String(input.content || '').slice(0, 2000);
  return [
    '<xml>',
    `<ToUserName>${cdata(input.toUser)}</ToUserName>`,
    `<FromUserName>${cdata(input.fromUser)}</FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    '<MsgType><![CDATA[text]]></MsgType>',
    `<Content>${cdata(content)}</Content>`,
    '</xml>',
  ].join('');
}

export function maskOpenId(openId: string) {
  const value = String(openId || '');
  if (value.length <= 10) return value ? `${value.slice(0, 2)}***` : '';
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}
