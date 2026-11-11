import { Logger } from '../common/logger';
import { text } from '../common/api';
import type { WorkflowService } from './workflow.service';

/**
 * 工作流定时触发调度（进程内定时器）：
 * 每分钟 tick 一次，扫描已发布工作流图里的 `trigger.schedule` 节点，
 * 按 cron（Asia/Shanghai）命中的分钟槽起运行，幂等锚＝工作流 + 分钟槽。
 * 只回看最近 5 分钟补 tick 漂移，长时间停机错过的周期不补跑。
 * 可用 WORKFLOW_SCHEDULER_DISABLED=1 关闭、WORKFLOW_SCHEDULER_TICK_MS 调整 tick 间隔。
 */
export class WorkflowScheduler {
  private readonly logger = new Logger(WorkflowScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly workflows: WorkflowService) {}

  onModuleInit() {
    if (String(process.env.WORKFLOW_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('工作流定时触发已禁用（WORKFLOW_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.WORKFLOW_SCHEDULER_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `工作流定时触发已启动：每 ${intervalMs}ms 扫描一次，时区 Asia/Shanghai`,
    );
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const started = await this.workflows.runScheduled();
      if (started > 0) {
        this.logger.log(`工作流定时触发：本轮起 ${started} 个运行`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`工作流定时触发 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
