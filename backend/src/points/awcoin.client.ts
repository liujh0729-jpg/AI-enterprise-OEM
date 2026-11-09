import { PrismaService } from '../prisma/prisma.service';
import { AccountCrypto } from '../account/account-crypto';
import { AipddAssetClient } from '../content/aipdd-asset.client';
import { aipddBaseUrl } from '../content/content-shared';
import { httpRequest } from '../http/transport';

/**
 * 候选余额端点（相对上游站点根，X-API-Key / Bearer 同一把 sk- Key）：
 * 上游用户信息口 `/user/info` 的 `availableBalance` 就是可用余额（实测 2026-11-03），
 * 其余钱包类路径是早期探测遗留；可用 AIPDD_BALANCE_PATH 直接指定跳过探测。
 */
const CANDIDATE_PATHS = [
  '/user/info',
  '/wallet',
  '/wallet/balance',
  '/balance',
  '/user/balance',
  '/account/balance',
];
/**
 * 余额字段按名称优先级取（大小写/下划线不敏感）：
 * `availableBalance` 是上游用户信息里的可用余额，`frozenBalance` 不参与（冻结额不是可用数）。
 */
const BALANCE_FIELDS = [
  'awcoin',
  'awcoinbalance',
  'availablebalance',
  'balance',
  'coin',
  'amount',
];
const CACHE_TTL_MS = 60_000;

function extractNumber(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const flat = new Map<string, unknown>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      const name = key.toLowerCase().replace(/_/g, '');
      if (!flat.has(name)) flat.set(name, value);
      if (value && typeof value === 'object' && depth < 2)
        walk(value, depth + 1);
    }
  };
  walk(raw, 0);
  for (const field of BALANCE_FIELDS) {
    const value = flat.get(field);
    const num = Number(value);
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      Number.isFinite(num)
    ) {
      return num;
    }
  }
  return null;
}

/**
 * AWcoin 只读展示：绑定 AIPDD Key 后取上游 `/user/info` 的可用余额（探测结果按 Key 指纹缓存，
 * 60 秒余额缓存防打爆上游）。取不到返回 null——界面显示 --，绝不伪造数字；
 * 站内积分消费永不扣 AWcoin（双币隔离，设计 §6）。
 */
export class AwcoinClient {
  /** keyId → { path, probedAt }：探测成功的端点复用。 */
  private readonly pathCache = new Map<
    number,
    { path: string; probedAt: number }
  >();
  /** userId → { value, source, fetchedAt }：缓存也记住原始来源，命中时仍报接口路径而不是 cache。 */
  private readonly balanceCache = new Map<
    string,
    { value: number | null; source: string; fetchedAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AccountCrypto,
  ) {}

  private async keyOf(userId: string) {
    const binding = await this.prisma.userAipddBinding.findUnique({
      where: { userId },
    });
    if (!binding) return null;
    const key = await this.prisma.aipddKey.findUnique({
      where: { id: binding.keyId },
    });
    if (!key || key.status !== 'ACTIVE') return null;
    return {
      id: key.id,
      plain: this.crypto.decrypt(key.keyCipher),
      profile: key.aipddProfile,
    };
  }

  /** 单次探测：拿不到（非 2xx / 业务码非 0 / 网络异常）返回 null，拿到了返回上游 data 原样。 */
  private async fetchOnce(plain: string, url: string): Promise<unknown> {
    try {
      const response = await httpRequest<Record<string, unknown>>(url, {
        headers: { 'X-API-Key': plain, Accept: 'application/json' },
        cache: 'no-store',
        timeoutMs: 8000,
        operation: 'aipdd:balance',
      });
      if (!response.ok) return null;
      const body = response.data;
      const code = Number(body?.code);
      if (code !== 0 && code !== 200) return null;
      return body?.data ?? body;
    } catch {
      return null;
    }
  }

  /** 当前绑定账号的 AWcoin 余额（60 秒缓存；未绑定/上游无接口返回 null）。 */
  async balance(
    userId: string,
  ): Promise<{ value: number | null; source: string }> {
    const cached = this.balanceCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { value: cached.value, source: cached.source };
    }
    const key = await this.keyOf(userId);
    if (!key) {
      return { value: null, source: 'unbound' };
    }
    const origin = AipddAssetClient.origin(aipddBaseUrl());
    const configured = String(process.env.AIPDD_BALANCE_PATH || '').trim();
    const candidates = configured
      ? [`${origin}/${configured.replace(/^\/+/, '')}`]
      : CANDIDATE_PATHS.map((path) => `${origin}${path}`);
    const known = this.pathCache.get(key.id);
    if (known && Date.now() - known.probedAt < 24 * 3600_000) {
      candidates.unshift(`${origin}${known.path}`);
    }
    for (const url of candidates) {
      const data = await this.fetchOnce(key.plain, url);
      const value = extractNumber(data);
      if (value !== null) {
        const path = url.replace(origin, '');
        this.pathCache.set(key.id, { path, probedAt: Date.now() });
        this.balanceCache.set(userId, {
          value,
          source: path,
          fetchedAt: Date.now(),
        });
        return { value, source: path };
      }
    }
    // 端点都拿不到：回落绑定时的上游资料快照（快照里有余额字段才显示）
    const snapshot = extractNumber(key.profile ?? null);
    const source = snapshot === null ? 'unavailable' : 'profile';
    this.balanceCache.set(userId, {
      value: snapshot,
      source,
      fetchedAt: Date.now(),
    });
    return { value: snapshot, source };
  }
}
