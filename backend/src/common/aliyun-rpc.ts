import { createHmac, randomUUID } from 'node:crypto';

/**
 * 阿里云 RPC 风格接口的公共签名器（智能外呼 OutboundBot 与邮件推送 Direct Mail 共用）。
 *
 * 官方规则：参数按 key 字典序 → RFC3986 编码 → `POST&%2F&<query>` → HMAC-SHA1 → Base64。
 * 两个产品的区别只在 Host / Version / Action，签名流程一致。
 */

/** RFC3986：encodeURIComponent 之外还要编码 `! ' ( ) *`，并保留 `~` 不编码。 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%7E/g, '~');
}

/** 数组按 `Name.1`、`Name.2` 展开；对象一律 JSON 字符串（调用方负责明确语义）。 */
export function flattenParams(
  input: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach(
        (item, index) => (out[`${key}.${index + 1}`] = String(item)),
      );
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

export function signRpc(input: {
  params: Record<string, string>;
  accessKeySecret: string;
  method?: 'POST' | 'GET';
}): string {
  const method = input.method ?? 'POST';
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(
    canonicalQuery(input.params),
  )}`;
  return createHmac('sha1', `${input.accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
}

/** 阿里云要求的 UTC 时间：`YYYY-MM-DDThh:mm:ssZ`（不带毫秒）。 */
export function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type RpcRequest = {
  action: string;
  version: string;
  accessKeyId: string;
  accessKeySecret: string;
  params?: Record<string, unknown>;
};

/** 组装公共参数、签名并返回可直发的 form-urlencoded 报文。 */
export function buildSignedBody(input: RpcRequest): string {
  const common = flattenParams({
    ...(input.params || {}),
    Action: input.action,
    Version: input.version,
    Format: 'JSON',
    AccessKeyId: input.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: timestamp(),
  });
  const signature = signRpc({
    params: common,
    accessKeySecret: input.accessKeySecret,
  });
  return `${canonicalQuery(common)}&Signature=${percentEncode(signature)}`;
}
