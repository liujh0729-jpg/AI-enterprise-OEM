import { Logger } from '../common/logger';
import { PointsBillingService } from './points-billing.service';

/**
 * 积分计费每日批处理调度（进程内定时器）：
 * 每小时 tick 一次，runDailyBatch 内部用 last_daily_batch_date 保证「今天只跑一次」；
 * 未到当日批次点则直接返回，错过时刻（如重启）也能在下次 tick 补跑。
 * 可用 POINTS_SCHEDULER_DISABLED=1 关闭、POINTS_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class PointsDailyScheduler {
  private readonly logger = new Logger(PointsDailyScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly billing: PointsBillingService) {}
  onModuleInit() {
    if (String(process.env.POINTS_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('积分计费日批已禁用（POINTS_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.POINTS_SCHEDULER_TICK_MS || 3600000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `积分计费日批已启动：每 ${intervalMs}ms 扫描一次，当日未跑则执行`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.billing.runDailyBatch();
    } catch (error) {
      this.logger.error(
        `积分计费日批 tick 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
