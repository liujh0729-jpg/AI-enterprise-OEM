import { Logger } from '../common/logger';
import { text } from '../common/api';
import type { TaskRouterService } from './task-router.service';
import type { TaskCenterService } from './task-center.service';

/**
 * 任务中心定时扫描：
 * 1. 机构待派超时落实（决策 D4=A）：24 小时无人接的机构队列任务按规则/轮询自动落到在职职员，
 *    没有可用职员就提醒负责人；
 * 2. 任务逾期：回看窗口内的逾期未办任务发 `overdue` 事件，命中已发布工作流的 `trigger.task`。
 * 用 TASK_ASSIGN_SCHEDULER_DISABLED=1 关闭、TASK_ASSIGN_SWEEP_MS 调整间隔、
 * TASK_OVERDUE_LOOKBACK_MS 调整逾期回看窗口（默认 2 倍间隔）。
 */
export class TaskAssignmentScheduler {
  private readonly logger = new Logger(TaskAssignmentScheduler.name);
  private timer?: NodeJS.Timeout;
  private intervalMs = 600_000;
  private busy = false;

  constructor(
    private readonly router: TaskRouterService,
    private readonly tasks: TaskCenterService,
  ) {}

  onModuleInit() {
    if (
      String(process.env.TASK_ASSIGN_SCHEDULER_DISABLED || '').trim() === '1'
    ) {
      this.logger.warn(
        '任务中心定时扫描已禁用（TASK_ASSIGN_SCHEDULER_DISABLED=1）',
      );
      return;
    }
    this.intervalMs = Number(process.env.TASK_ASSIGN_SWEEP_MS || 600_000);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
    this.logger.log(`任务中心定时扫描已启动：每 ${this.intervalMs}ms 一次`);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const assigned = await this.router.sweepUnassigned();
      if (assigned > 0) {
        this.logger.log(`机构待派超时落实：本轮自动派给 ${assigned} 条`);
      }
      const lookbackMs = Number(
        process.env.TASK_OVERDUE_LOOKBACK_MS || this.intervalMs * 2,
      );
      const overdue = await this.tasks.sweepOverdue(lookbackMs);
      if (overdue > 0) {
        this.logger.log(`任务逾期扫描：本轮发出 ${overdue} 条逾期事件`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`任务中心扫描失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
