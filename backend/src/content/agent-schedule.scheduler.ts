import { Logger } from '../common/logger';
import { text } from '../common/api';
import { ContentAgentScheduleService } from './agent-schedule.service';

/**
 * Agent 定时任务调度（进程内定时器）：
 * 每分钟 tick 一次，扫描启用中且 scheduledAt <= now 的任务各跑一轮对话，
 * 再按 scheduleConfig.freq 把 scheduledAt 推到下一次（定时一次跑完即置空，不会重复触发）。
 * 时区 Asia/Shanghai，错过周期不补跑。
 * 可用 AGENT_SCHEDULER_DISABLED=1 关闭、AGENT_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class ContentAgentScheduleScheduler {
  private readonly logger = new Logger(ContentAgentScheduleScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly scheduleService: ContentAgentScheduleService) {}
  onModuleInit() {
    if (String(process.env.AGENT_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn(
        'Agent 定时任务调度已禁用（AGENT_SCHEDULER_DISABLED=1）',
      );
      return;
    }
    const intervalMs = Number(process.env.AGENT_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `Agent 定时任务调度已启动：每 ${intervalMs}ms 扫描一次，时区 Asia/Shanghai`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const executed = await this.scheduleService.advanceDue();
      if (executed > 0) {
        this.logger.log(`Agent 定时任务：本轮执行 ${executed} 条`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`Agent 定时任务调度 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
