import { Logger } from '../common/logger';
import { text } from '../common/api';
import { WorkbuddyPlanService } from './workbuddy-plan.service';

/**
 * Workbuddy 定时任务调度（进程内定时器）：
 * 每分钟 tick 一次，扫描 kind=scheduled 且 scheduledAt <= now 的计划，按所属账号派发一轮，
 * 再按 scheduleConfig.freq 把 scheduledAt 推到下一次（一次性计划消费掉时间，不会重复触发）。
 * 时区 Asia/Shanghai，错过周期不补跑。
 * 可用 WORKBUDDY_SCHEDULER_DISABLED=1 关闭、WORKBUDDY_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class WorkbuddyPlanScheduler {
  private readonly logger = new Logger(WorkbuddyPlanScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly planService: WorkbuddyPlanService) {}
  onModuleInit() {
    if (String(process.env.WORKBUDDY_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn(
        'Workbuddy 定时调度已禁用（WORKBUDDY_SCHEDULER_DISABLED=1）',
      );
      return;
    }
    const intervalMs = Number(process.env.WORKBUDDY_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `Workbuddy 定时调度已启动：每 ${intervalMs}ms 扫描一次，时区 Asia/Shanghai`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const dispatched = await this.planService.advanceScheduledPlans();
      if (dispatched > 0) {
        this.logger.log(`Workbuddy 定时派发：本轮下发 ${dispatched} 条任务`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`Workbuddy 调度 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
