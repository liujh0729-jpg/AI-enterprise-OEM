import { text } from '../common/api';
import { Logger } from '../common/logger';
import { TencentQidianService } from './tp.service';

/**
 * 腾讯企点任务台账调度（进程内定时器）：
 * 每 1 分钟扫描一次排队超 1 分钟的任务重新投入执行、执行中且 2 分钟没更新的只查一次上游状态，
 * 覆盖进程重启后丢失的内存执行器与上游批量任务的轮询缺口。
 * 可用 TP_SCHEDULER_DISABLED=1 关闭、TP_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class TencentQidianScheduler {
  private readonly logger = new Logger(TencentQidianScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly service: TencentQidianService) {}

  onModuleInit() {
    if (String(process.env.TP_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('腾讯企点任务调度已禁用（TP_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.TP_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`腾讯企点任务调度已启动：每 ${intervalMs}ms 扫描一次`);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const handled = await this.service.runScheduled();
      if (handled) this.logger.log(`腾讯企点任务调度处理了 ${handled} 个任务`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`腾讯企点任务调度扫描失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
