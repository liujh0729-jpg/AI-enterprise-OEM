import { Logger } from '../common/logger';
import { text } from '../common/api';
import { GeoCollectionService } from './geo-collection.service';
/**
 * GEO 自动采集调度（进程内定时器，不引第三方 cron 依赖）：
 * 每分钟 tick 一次——窗口外只做超时实例复位与本周排期，窗口内（周日 02:00–06:00，
 * 顺延日同窗口）逐个执行任务。多实例同库靠 run 行上的 claim + 心跳互斥，不会重复采集。
 * 可用 GEO_AUTO_COLLECT_DISABLED=1 关闭、GEO_AUTO_COLLECT_TICK_MS 调整 tick 间隔。
 */
export class GeoCollectionScheduler {
  private readonly logger = new Logger(GeoCollectionScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly collection: GeoCollectionService) {}
  onModuleInit() {
    if (String(process.env.GEO_AUTO_COLLECT_DISABLED || '').trim() === '1') {
      this.logger.warn('GEO 自动采集调度已禁用（GEO_AUTO_COLLECT_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.GEO_AUTO_COLLECT_TICK_MS || 60000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `GEO 自动采集调度已启动：周日 02:00–06:00 窗口（未跑完顺延次日同窗口），tick ${intervalMs}ms`,
    );
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.collection.tick();
    } catch (error) {
      const reason = error instanceof Error ? error.message : text(error);
      this.logger.error(`GEO 自动采集 tick 失败：${reason}`);
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
