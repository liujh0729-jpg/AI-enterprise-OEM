import { Logger } from '../common/logger';
import type { AcquisitionFollowUpService } from './follow-up.service';
import type { AcquisitionOutreachService } from './outreach.service';
import type { AcquisitionRadarService } from './radar.service';

/**
 * 获客调度（进程内定时器，仿 PointsDailyScheduler）：
 * - 每分钟：到点的监控源建批次、到点的邮件/企微触达补执行；
 * - 每 5 分钟：到期跟进 + 回执对账；
 * - 每 10 分钟：超时的采集/触达批次按部分完成关闭。
 * 环境开关 ACQ_SCHEDULER_DISABLED=1 / ACQ_SCHEDULER_TICK_MS 调整 tick。
 */
export class AcquisitionScheduler {
  private readonly logger = new Logger(AcquisitionScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastSources = 0;
  private lastFollowUp = 0;
  private lastStale = 0;

  constructor(
    private readonly radar: AcquisitionRadarService,
    private readonly outreach: AcquisitionOutreachService,
    private readonly followUps: AcquisitionFollowUpService,
  ) {}

  onModuleInit() {
    if (String(process.env.ACQ_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn('获客调度已禁用（ACQ_SCHEDULER_DISABLED=1）');
      return;
    }
    const intervalMs = Math.max(
      10_000,
      Number(process.env.ACQ_SCHEDULER_TICK_MS || 60_000) || 60_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(`获客调度已启动：每 ${intervalMs}ms tick 一次`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 单飞：上一轮没跑完就跳过本轮，避免并发重复建批次/重复发送。 */
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    const now = Date.now();
    try {
      if (now - this.lastSources >= 60_000) {
        this.lastSources = now;
        try {
          const runs = await this.radar.dueSources(new Date());
          if (runs.length)
            this.logger.log(`已为 ${runs.length} 个监控源建采集批次`);
        } catch (error) {
          this.report('source', error);
        }
        try {
          await this.outreach.runDueServerTasks(new Date());
        } catch (error) {
          this.report('outreach', error);
        }
      }
      if (now - this.lastFollowUp >= 5 * 60_000) {
        this.lastFollowUp = now;
        try {
          const sent = await this.followUps.runDue(new Date());
          if (sent) this.logger.log(`已发送 ${sent} 条到期跟进`);
        } catch (error) {
          this.report('follow-up', error);
        }
        try {
          await this.followUps.reconcile(new Date());
          await this.outreach.reconcileUnknown(new Date());
        } catch (error) {
          this.report('reconcile', error);
        }
      }
      if (now - this.lastStale >= 10 * 60_000) {
        this.lastStale = now;
        try {
          await this.radar.timeoutStaleRuns(new Date());
        } catch (error) {
          this.report('stale', error);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private report(step: string, error: unknown) {
    this.logger.error(
      `获客调度 ${step} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
