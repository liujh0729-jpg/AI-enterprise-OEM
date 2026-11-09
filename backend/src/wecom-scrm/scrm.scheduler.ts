import { Logger } from '../common/logger';
import type { ScrmMassService } from './scrm-mass.service';
import type { ScrmTransferService } from './scrm-transfer.service';
import type { ScrmSopService } from './scrm-sop.service';
import type { ScrmCodeService } from './scrm-code.service';

/**
 * SCRM 调度（进程内定时器）：
 * - 每分钟：到点的群发任务、离职继承轮询、SOP 定时触发（当天同客户去重）；
 * - 每 10 分钟：群发结果对账、SOP 逾期提醒；
 * - 每天 03:00：活码成员承载量再平衡（超出日上限的成员摘出引流名单）。
 * 环境开关 SCRM_SCHEDULER_DISABLED=1 / SCRM_SCHEDULER_TICK_MS 调整 tick。
 */
export class ScrmScheduler {
  private readonly logger = new Logger(ScrmScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastMinute = 0;
  private lastReconcile = 0;
  private lastRebalanceDay = '';

  constructor(
    private readonly mass: ScrmMassService,
    private readonly transfers: ScrmTransferService,
    private readonly sops: ScrmSopService,
    private readonly codes: ScrmCodeService,
  ) {}

  onModuleInit() {
    if (String(process.env.SCRM_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('SCRM 调度已禁用（SCRM_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Math.max(
      10_000,
      Number(process.env.SCRM_SCHEDULER_TICK_MS || 60_000) || 60_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(`SCRM 调度已启动：每 ${intervalMs}ms tick 一次`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 单飞：上一轮没跑完就跳过本轮，避免重复发送/重复建待办。 */
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    const now = Date.now();
    try {
      if (now - this.lastMinute >= 60_000) {
        this.lastMinute = now;
        try {
          const sent = await this.mass.runDue(new Date());
          if (sent) this.logger.log(`已提交 ${sent} 个到点的企微群发任务`);
        } catch (error) {
          this.report('mass-due', error);
        }
        try {
          const created = await this.transfers.runDue(new Date());
          if (created) this.logger.log(`离职继承已推进 ${created} 个任务`);
        } catch (error) {
          this.report('transfer-due', error);
        }
        try {
          const fired = await this.sops.runScheduled(new Date());
          if (fired) this.logger.log(`SOP 定时触发 ${fired} 个客户`);
        } catch (error) {
          this.report('sop-schedule', error);
        }
      }
      if (now - this.lastReconcile >= 10 * 60_000) {
        this.lastReconcile = now;
        try {
          await this.mass.reconcileRunning();
        } catch (error) {
          this.report('mass-reconcile', error);
        }
        try {
          await this.sops.remindOverdue(new Date());
        } catch (error) {
          this.report('sop-remind', error);
        }
      }
      const day = this.dayKey(new Date());
      if (this.hourOf(new Date()) >= 3 && this.lastRebalanceDay !== day) {
        this.lastRebalanceDay = day;
        try {
          const shifted = await this.codes.rebalanceAll();
          if (shifted) this.logger.log(`活码再平衡：调整 ${shifted} 人`);
        } catch (error) {
          this.report('code-rebalance', error);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private dayKey(now: Date): string {
    return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  }

  private hourOf(now: Date): number {
    return new Date(now.getTime() + 8 * 3600_000).getUTCHours();
  }

  private report(step: string, error: unknown) {
    this.logger.error(
      `SCRM 调度 ${step} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
