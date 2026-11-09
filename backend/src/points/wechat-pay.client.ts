import {
  createDecipheriv,
  createSign,
  randomBytes,
  verify as rsaVerify,
  X509Certificate,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';
import { httpRequest } from '../http/transport';

const HOST = 'https://api.mch.weixin.qq.com';
/** 平台证书缓存：拉取一次用 12 小时（微信官方建议 24h 内定时刷新，取保守值）。 */
const CERT_TTL_MS = 12 * 3600_000;

export type WechatCredentials = {
  appId: string;
  mchId: string;
  apiv3Key: string;
  certSerial: string;
  privateKey: string;
  notifyUrl: string;
  configured: boolean;
};

export type WechatTransaction = {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  amount?: { total?: number; payer_total?: number; currency?: string };
  success_time?: string;
};

/** RSA-SHA256 请求签名（v3 Authorization 头）。 */
function signRequest(
  credentials: WechatCredentials,
  method: string,
  urlPath: string,
  body: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const sign = createSign('RSA-SHA256');
  sign.update(message);
  const signature = sign.sign(credentials.privateKey, 'base64');
  return [
    `WECHATPAY2-SHA256-RSA2048 mchid="${credentials.mchId}",`,
    `nonce_str="${nonce}",`,
    `signature="${signature}",`,
    `timestamp="${timestamp}",`,
    `serial_no="${credentials.certSerial}"`,
  ].join('');
}

/** APIv3 密钥对称解密（回调 resource 与平台证书列表同一种密文格式）。 */
export function decryptApiV3(
  apiv3Key: string,
  associatedData: string,
  nonce: string,
  ciphertext: string,
): string {
  const key = Buffer.from(apiv3Key, 'utf8');
  if (key.length !== 32) {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '微信支付 APIv3 密钥长度不正确（应为 32 字符）',
    );
  }
  const data = Buffer.from(ciphertext, 'base64');
  const authTag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonce, 'utf8'),
  );
  decipher.setAuthTag(authTag);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * 微信支付 APIv3 精简客户端：Native 扫码 / H5 下单、查单、关单、
 * 平台证书下载缓存与回调验签。凭据由管理后台配置（密文存 point_settings）。
 */
export class WechatPayClient {
  private certCache: Map<string, X509Certificate> = new Map();
  private certFetchedAt = 0;

  private async call(
    credentials: WechatCredentials,
    method: 'GET' | 'POST',
    urlPath: string,
    body?: Record<string, unknown>,
    operation = 'wechat:pay',
  ) {
    const payload = body ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      Authorization: signRequest(credentials, method, urlPath, payload),
      Accept: 'application/json',
    };
    if (payload) headers['Content-Type'] = 'application/json';
    const response = await httpRequest<string>(`${HOST}${urlPath}`, {
      method,
      headers,
      body: payload || undefined,
      timeoutMs: 15000,
      readAs: 'text',
      operation,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(response.data || '{}') as {
          message?: unknown;
        };
        detail = text(parsed.message).slice(0, 200);
      } catch {
        // 非 JSON 错误体按状态码提示
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `微信支付接口失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
      );
    }
    return JSON.parse(response.data || '{}') as Record<string, unknown>;
  }

  /** Native 下单：返回 code_url（转二维码给 PC 端扫码）。 */
  async native(
    credentials: WechatCredentials,
    order: {
      outTradeNo: string;
      description: string;
      amountCents: number;
      notifyUrl: string;
    },
  ) {
    const data = await this.call(
      credentials,
      'POST',
      '/v3/pay/transactions/native',
      {
        appid: credentials.appId,
        mchid: credentials.mchId,
        description: order.description.slice(0, 120),
        out_trade_no: order.outTradeNo,
        notify_url: order.notifyUrl,
        amount: { total: order.amountCents, currency: 'CNY' },
      },
    );
    return text(data.code_url);
  }

  /** H5 下单：返回 h5_url（移动端浏览器跳转）。 */
  async h5(
    credentials: WechatCredentials,
    order: {
      outTradeNo: string;
      description: string;
      amountCents: number;
      notifyUrl: string;
      clientIp: string;
    },
  ) {
    const data = await this.call(
      credentials,
      'POST',
      '/v3/pay/transactions/h5',
      {
        appid: credentials.appId,
        mchid: credentials.mchId,
        description: order.description.slice(0, 120),
        out_trade_no: order.outTradeNo,
        notify_url: order.notifyUrl,
        amount: { total: order.amountCents, currency: 'CNY' },
        scene_info: {
          payer_client_ip: order.clientIp,
          h5_info: { type: 'Wap' },
        },
      },
    );
    return text(data.h5_url);
  }

  /** 商户订单号查单（前端轮询与回调丢失兜底）。 */
  async query(credentials: WechatCredentials, outTradeNo: string) {
    const urlPath = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${credentials.mchId}`;
    return (await this.call(
      credentials,
      'GET',
      urlPath,
      undefined,
      'wechat:query',
    )) as WechatTransaction;
  }

  /** 关单（超时未支付订单回收）。 */
  async close(credentials: WechatCredentials, outTradeNo: string) {
    await this.call(
      credentials,
      'POST',
      `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`,
      { mchid: credentials.mchId },
      'wechat:close',
    );
  }

  /** 平台证书列表：下载 + APIv3 解密 + 按序列号缓存，供回调验签。 */
  private async loadCertificates(credentials: WechatCredentials) {
    if (this.certCache.size && Date.now() - this.certFetchedAt < CERT_TTL_MS) {
      return this.certCache;
    }
    const data = await this.call(
      credentials,
      'GET',
      '/v3/certificates',
      undefined,
      'wechat:certs',
    );
    const list = Array.isArray(data?.list)
      ? (data.list as Record<string, unknown>[])
      : [];
    const next = new Map<string, X509Certificate>();
    for (const item of list) {
      const encrypt = (item?.encrypt_certificate || {}) as Record<
        string,
        unknown
      >;
      const pem = decryptApiV3(
        credentials.apiv3Key,
        text(encrypt.associated_data),
        text(encrypt.nonce),
        text(encrypt.ciphertext),
      );
      const serial = text(item?.serial_no);
      if (serial && pem.includes('BEGIN CERTIFICATE')) {
        next.set(serial, new X509Certificate(pem));
      }
    }
    if (!next.size) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付平台证书获取失败：返回列表为空',
      );
    }
    this.certCache = next;
    this.certFetchedAt = Date.now();
    return next;
  }

  /**
   * 回调处理：验签（平台证书公钥）→ 解密 resource → 返回交易明文。
   * 验签不过直接抛错，调用方按微信规范回 4xx/5xx 让其重试。
   */
  async parseNotify(
    credentials: WechatCredentials,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WechatTransaction> {
    const certs = await this.loadCertificates(credentials);
    const serial = headers['wechatpay-serial'] || '';
    const nonce = headers['wechatpay-nonce-str'] || '';
    const timestamp = headers['wechatpay-timestamp'] || '';
    const signature = headers['wechatpay-signature'] || '';
    const cert = certs.get(serial) || [...certs.values()][0];
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const verified = rsaVerify(
      'RSA-SHA256',
      Buffer.from(message, 'utf8'),
      cert.publicKey,
      Buffer.from(signature, 'base64'),
    );
    if (!verified) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '微信支付回调验签失败',
      );
    }
    // 时间戳容差 5 分钟，防重放
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > 300) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '微信支付回调时间戳异常',
      );
    }
    const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    const resource = (payload?.resource || {}) as Record<string, unknown>;
    const plain = decryptApiV3(
      credentials.apiv3Key,
      text(resource.associated_data),
      text(resource.nonce),
      text(resource.ciphertext),
    );
    return JSON.parse(plain) as WechatTransaction;
  }

  /** 测试连接：下载平台证书验证五项配置与签名链路（不产生交易）。 */
  async testConnection(credentials: WechatCredentials) {
    const certs = await this.loadCertificates(credentials);
    return { certificates: certs.size, serials: [...certs.keys()] };
  }
}
