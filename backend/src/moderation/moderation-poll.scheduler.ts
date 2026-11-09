import { Logger } from '../common/logger';
import { DigitalAssetService } from '../content/digital-asset.service';

/**
 * 视频内容安全轮询（进程内定时器）：视频送审是异步的，提交后先记 pending + taskId，
 * 由本调度每 2 分钟拉一次结论，命中 block/pass 写回台账。未配置内容安全时无 pending 行，空转。
 * 可用 MODERATION_POLL_DISABLED=1 关闭、MODERATION_POLL_TICK_MS 调整间隔。
 */
export class ModerationPollScheduler {
  private readonly logger = new Logger(ModerationPollScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly assets: DigitalAssetService) {}

  onModuleInit() {
    if (String(process.env.MODERATION_POLL_DISABLED || '').trim() === '1') {
      this.logger.warn('视频内容安全轮询已禁用（MODERATION_POLL_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.MODERATION_POLL_TICK_MS || 120000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`视频内容安全轮询已启动：每 ${intervalMs}ms 拉一次结论`);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const updated = await this.assets.pollPendingModeration();
      if (updated > 0) this.logger.log(`视频内容安全结论更新 ${updated} 条`);
    } catch (error) {
      this.logger.error(
        `视频内容安全轮询失败:${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
