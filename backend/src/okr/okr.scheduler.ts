import { Logger } from '../common/logger';
import { text } from '../common/api';
import { OkrMetricsService } from './okr.metrics.service';

/**
 * OKR 每日批处理调度（进程内定时器）：
 * 每 10 分钟 tick 一次，按各账号设置里的 metricRefreshHour（默认 05:00）触发
 * 自动指标刷新、逾期计划提醒、日报待填提醒；同一账号同一天只跑一次。
 * 可用 OKR_SCHEDULER_DISABLED=1 关闭、OKR_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class OkrDailyScheduler {
  private readonly logger = new Logger(OkrDailyScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly metrics: OkrMetricsService) {}
  onModuleInit() {
    if (String(process.env.OKR_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('OKR 每日批处理已禁用（OKR_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.OKR_SCHEDULER_TICK_MS || 600000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `OKR 每日批处理已启动：每 ${intervalMs}ms 扫描一次，按账号设置的刷新时刻执行`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.metrics.runDailyBatch();
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`OKR 每日批处理 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
