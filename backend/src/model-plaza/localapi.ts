import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LocalAPI 内置渠道的进程内凭据。
 *
 * 用户在「模型设置」里选 LocalAPI 时不需要自己生成 API Key：渠道行里存的是这把由
 * 服务端派生、按 userId 绑定的 `lk_` 令牌（HMAC 签名，密钥源 EXTERNAL_CRED_KEY），
 * 对外网关校验签名即可定位到用户，不落 api_keys 表、也不出现在「API Key 管理」里。
 */
export const LOCALAPI_KEY_PREFIX = 'lk_';

/** 「模型设置」里 LocalAPI 虚拟渠道的编号（不落 content_model_channels 表）。 */
export const LOCALAPI_CHANNEL_ID = -1;

/**
 * 后端自调用本站 OpenAI 兼容网关的地址：优先 LOCALAPI_BASE_URL，其次本机监听端口。
 * 走回环而不是站点域名，避免部署后还要绕一圈 Nginx / DNS。
 */
export function localApiBaseUrl(): string {
  const override = String(process.env.LOCALAPI_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (override) return override;
  const port = String(process.env.PORT || '').trim() || '1690';
  return `http://127.0.0.1:${port}/v1`;
}

function secret() {
  return String(process.env.EXTERNAL_CRED_KEY || '').trim();
}

function signature(userId: string): string {
  const key = secret();
  if (!key) {
    throw new Error(
      'EXTERNAL_CRED_KEY 未配置：LocalAPI 内置凭据需要独立密钥来源',
    );
  }
  return createHmac('sha256', key)
    .update(`localapi|${userId}`)
    .digest('hex')
    .slice(0, 40);
}

export function mintLocalApiKey(userId: string): string {
  const encoded = Buffer.from(String(userId), 'utf8').toString('base64url');
  return `${LOCALAPI_KEY_PREFIX}${encoded}.${signature(String(userId))}`;
}

/** 校验 `lk_` 令牌并取出 userId；非法返回 null（不抛错，交给鉴权层统一 401）。 */
export function parseLocalApiKey(token: string): string | null {
  if (!token.startsWith(LOCALAPI_KEY_PREFIX)) return null;
  const [encoded, sig] = token.slice(LOCALAPI_KEY_PREFIX.length).split('.');
  if (!encoded || !sig) return null;
  let userId = '';
  try {
    userId = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!userId) return null;
  let expected = '';
  try {
    expected = signature(userId);
  } catch {
    return null;
  }
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    return null;
  return userId;
}

export function isLocalApiKey(token: string | undefined): boolean {
  return Boolean(token && token.startsWith(LOCALAPI_KEY_PREFIX));
}
