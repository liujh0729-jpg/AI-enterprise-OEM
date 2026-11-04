import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';

/**
 * 进程内固定窗口计数：给「会真实出站或写库」的低频操作兜底限流。
 * 与注册/登录、活码公开入口用的是同一口径（不引外部依赖，单进程够用）；
 * 多实例部署时窗口彼此独立，只能挡住单账号的连点，不能当全局配额。
 */
export class RateWindow {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** 未超限返回剩余额度；超限直接抛业务异常，文案由调用方给（要能告诉用户下一步怎么做）。 */
  consume(key: string, message: string): number {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      // 窗口是固定长度的，顺手清掉已过期的键，避免账号数无限增长
      if (this.hits.size > 10_000) {
        for (const [stored, row] of this.hits) {
          if (row.resetAt <= now) this.hits.delete(stored);
        }
      }
      return this.max - 1;
    }
    if (entry.count >= this.max) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, message);
    }
    entry.count += 1;
    return this.max - entry.count;
  }

  /** 回滚一次计数：请求还没真正发生（比如随后校验失败）时用它，避免误占额度。 */
  refund(key: string) {
    const entry = this.hits.get(key);
    if (entry && entry.count > 1) entry.count -= 1;
  }
}
