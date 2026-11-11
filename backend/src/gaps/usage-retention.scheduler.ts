import { Logger } from '../common/logger';
import type { UsageService } from './usage.service';
import { dayKey } from './gaps.helpers';

/**
 * 使用埋点留存清理（进程内定时器）：每小时 tick 一次，按自然日（东八区）每日最多执行一次。
 * 留存天数在后台设置里维护，这里只负责让「定期清理」真正发生。
 * 可用 USAGE_RETENTION_SCHEDULER_DISABLED=1 关闭、USAGE_RETENTION_TICK_MS 调整 tick 间隔。
 */
export class UsageRetentionScheduler {
  private readonly logger = new Logger(UsageRetentionScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastDay = '';

  constructor(private readonly usage: UsageService) {}

  onModuleInit() {
    if (
      String(process.env.USAGE_RETENTION_SCHEDULER_DISABLED || '').trim() ===
      '1'
    ) {
      this.logger.warn(
        '使用埋点留存清理已禁用（USAGE_RETENTION_SCHEDULER_DISABLED=1）',
      );
      return;
    }
    const intervalMs = Number(process.env.USAGE_RETENTION_TICK_MS || 3600000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `使用埋点留存清理已启动：每 ${intervalMs}ms 检查一次，每日最多执行一次`,
    );
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const today = dayKey();
      if (today === this.lastDay) return;
      const deleted = await this.usage.prune();
      this.lastDay = today;
      if (deleted > 0) {
        this.logger.log(`使用埋点留存清理完成：删除 ${deleted} 条过期事件`);
      }
    } catch (error) {
      this.logger.error(
        `使用埋点留存清理失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
