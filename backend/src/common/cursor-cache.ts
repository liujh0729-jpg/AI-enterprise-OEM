import { randomUUID } from 'node:crypto';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
/** Single-process, bounded continuation cache. Tokens carry no account data or credentials. */
export class CursorCache<T> {
  private readonly entries = new Map<
    string,
    { owner: string; expires: number; value: T; bytes: number }
  >();
  constructor(
    private readonly ttlMs = 300000,
    private readonly maxEntries = 128,
    private readonly maxBytes = 16 * 1024 * 1024,
  ) {}
  put(owner: string, value: T) {
    this.prune();
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > this.maxBytes)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '扫描结果过大，请缩小筛选范围后重新加载',
      );
    while (
      this.entries.size >= this.maxEntries ||
      [...this.entries.values()].reduce((n, e) => n + e.bytes, 0) + bytes >
        this.maxBytes
    ) {
      const [key] = this.entries.keys();
      if (!key) break;
      this.entries.delete(key);
    }
    const cursor = randomUUID();
    this.entries.set(cursor, {
      owner,
      expires: Date.now() + this.ttlMs,
      value,
      bytes,
    });
    return cursor;
  }
  get(owner: string, cursor: string) {
    this.prune();
    const entry = this.entries.get(cursor);
    if (!entry || entry.owner !== owner)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '列表游标已过期，请重新加载',
      );
    return entry.value;
  }
  private prune() {
    for (const [key, entry] of this.entries)
      if (entry.expires <= Date.now()) this.entries.delete(key);
  }
}
