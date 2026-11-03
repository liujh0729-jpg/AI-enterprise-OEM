import { Logger } from '../common/logger';
import { text } from '../common/api';
import { RpaTaskService } from './rpa-task.service';

/**
 * RPA 定时任务调度（进程内定时器）：
 * 每分钟 tick 一次，扫描 scheduleType=recurring 且 scheduledAt <= now 的任务，
 * 按 scheduleConfig.freq 计算下一次执行时刻并更新 scheduledAt。
 * 时区 Asia/Shanghai，错过周期不补跑（直接推到下一个未来时刻）。
 * 可用 RPA_SCHEDULER_DISABLED=1 关闭、RPA_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class RpaTaskScheduler {
  private readonly logger = new Logger(RpaTaskScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly taskService: RpaTaskService) {}
  onModuleInit() {
    if (String(process.env.RPA_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('RPA 定时调度已禁用（RPA_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.RPA_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `RPA 定时调度已启动：每 ${intervalMs}ms 扫描一次，时区 Asia/Shanghai`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.taskService.advanceRecurringTasks();
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`RPA 调度 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
