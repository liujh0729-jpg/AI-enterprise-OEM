import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** 访客粘性 Cookie：`base64url(payload).base64url(hmac)`，密钥由 EXTERNAL_CRED_KEY 派生。 */
const secret = () =>
  createHash('sha256')
    .update(
      `${process.env.EXTERNAL_CRED_KEY || 'livecode'}:aiworkin-livecode-sticky`,
    )
    .digest();

export type StickyPayload = {
  /** 访客随机 id */
  v: string;
  /** 活码 id */
  c: number;
  /** 命中的子码 id */
  k: number;
  /** 过期时间（毫秒时间戳） */
  exp: number;
};

export const LIVE_CALLBACK_COOKIE = 'lk_v';

export function newVisitorId() {
  return createHash('sha256')
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest('hex')
    .slice(0, 24);
}

export function signSticky(payload: StickyPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySticky(value: string | undefined): StickyPayload | null {
  if (!value) return null;
  const [body, mac] = value.split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', secret())
    .update(body)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as StickyPayload;
    if (!payload?.v || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 派生的访客哈希：统计去重用，不保存原始 id。 */
export function visitorHash(visitorId: string) {
  return createHash('sha256')
    .update(`lk:${visitorId}`)
    .digest('hex')
    .slice(0, 40);
}

export function ipHash(ip: string) {
  return createHash('sha256').update(`ip:${ip}`).digest('hex').slice(0, 32);
}
