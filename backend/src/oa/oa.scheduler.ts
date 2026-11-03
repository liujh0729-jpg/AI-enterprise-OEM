import { text } from '../common/api';
import { Logger } from '../common/logger';
import { OaService } from './oa.service';

/**
 * OA 审批超时提醒调度（进程内定时器）：
 * 每 1 分钟扫描一次停在当前节点、超过节点（或组织设置）时限且未提醒过的待办任务，
 * 给审批人补一条系统消息；每条任务只提醒一次（oa_tasks.remindedAt 落库）。
 * 可用 OA_SCHEDULER_DISABLED=1 关闭、OA_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class OaReminderScheduler {
  private readonly logger = new Logger(OaReminderScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly service: OaService) {}

  onModuleInit() {
    if (String(process.env.OA_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('OA 超时提醒调度已禁用（OA_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.OA_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`OA 超时提醒调度已启动：每 ${intervalMs}ms 扫描一次`);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const sent = await this.service.runReminders();
      if (sent) this.logger.log(`OA 超时提醒已发送 ${sent} 条`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`OA 超时提醒扫描失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
