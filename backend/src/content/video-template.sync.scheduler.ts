import { Logger } from '../common/logger';
import { VideoTemplateService } from './video-template.service';

const TICK_MS = 60_000;

/**
 * AIworkin 平台模版同步调度：每分钟看一眼「是否开启 + 到点」。
 * 开关在平台后台，真正拉取与状态回写都在 service，调度器只负责触发，
 * 进程重启后从 system_settings 的 lastSyncAt 续上，不额外存内存状态。
 */
export class VideoTemplateSyncScheduler {
  private readonly logger = new Logger(VideoTemplateSyncScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly service: VideoTemplateService) {}

  onModuleInit() {
    if (String(process.env.VIDEO_TEMPLATE_SYNC_DISABLED || '').trim() === '1') {
      this.logger.warn(
        'AIworkin 模版同步调度已禁用（VIDEO_TEMPLATE_SYNC_DISABLED=1）',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.service.syncIfDue();
    } catch (error) {
      this.logger.warn(
        `AIworkin 模版同步触发失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }
}
