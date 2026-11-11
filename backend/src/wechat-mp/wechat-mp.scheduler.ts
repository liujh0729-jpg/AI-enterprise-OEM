import type { WechatMpPushService } from './wechat-mp.push.service';

/**
 * 失败推送重试：近 24 小时、未超 3 次的 failed 记录每 60 秒扫一次。
 * 只在单进程内跑；多实例部署时每条记录可能被并发重试，但微信侧有幂等与频控兜底。
 */
export class WechatMpRetryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly push: WechatMpPushService) {}

  onModuleInit() {
    if (process.env.WECHAT_MP_RETRY_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.push.retryDue();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'wechat_mp_retry_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.busy = false;
    }
  }
}
