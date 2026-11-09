import type { PrismaService } from '../prisma/prisma.service';
import { Logger } from '../common/logger';
import type { SeoRankService } from './seo-rank.service';
import type { SeoGoogleService } from './seo-google.service';

const WINDOW_START = 3;
const WINDOW_END = 5;
const RESEARCH_RETENTION_DAYS = 90;
const GOOGLE_SYNC_MIN_INTERVAL_MS = 20 * 3_600_000;

/**
 * SEO 夜间调度（照 geo-collection.scheduler：进程内 setInterval + busy 闸，不引第三方 cron）：
 * 凌晨 03:00–05:00 窗口内跑到期排名检查（claim + 心跳单飞）与 Google 每日同步；
 * 窗口外只按天清理 90 天前的研究日志。SEO_RANK_DISABLED=1 关闭、SEO_RANK_TICK_MS 调 tick。
 * 多实例同库靠 SeoRankRun.activeLock + 心跳互斥，不会重复扣费。
 */
export class SeoRankScheduler {
  private readonly logger = new Logger(SeoRankScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastCleanup = 0;
  /** 失败也节流：lastSyncAt 只在成功时更新，靠这张表避免窗口内每分钟重试坏凭证。 */
  private readonly lastAttempt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rank: SeoRankService,
    private readonly google: SeoGoogleService,
  ) {}

  onModuleInit() {
    if (String(process.env.SEO_RANK_DISABLED || '').trim() === '1') {
      this.logger.warn('SEO 排名调度已禁用（SEO_RANK_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.SEO_RANK_TICK_MS || 60_000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
    this.logger.log(
      `SEO 排名调度已启动：每日 ${WINDOW_START}:00–${WINDOW_END}:00 窗口，tick ${intervalMs}ms`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** /health/ready 用：到期未跑的跟踪器数。 */
  async backlog(): Promise<number> {
    return this.prisma.seoRankTracker.count({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
    });
  }

  private inWindow(now: Date): boolean {
    const hour = now.getHours();
    return hour >= WINDOW_START && hour < WINDOW_END;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      await this.cleanup(now);
      if (!this.inWindow(now)) return;
      await this.runDueTrackers();
      await this.syncGoogleDaily(now);
    } catch (error) {
      this.logger.error(
        `SEO 调度 tick 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  private async cleanup(now: Date) {
    if (now.getTime() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = now.getTime();
    const cutoff = new Date(
      now.getTime() - RESEARCH_RETENTION_DAYS * 86_400_000,
    );
    const removed = await this.prisma.seoResearchLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (removed.count)
      this.logger.log(`SEO 研究日志清理：删除 ${removed.count} 条 90 天前记录`);
  }

  private async runDueTrackers() {
    const due = await this.rank.dueTrackers(20);
    for (const tracker of due) {
      try {
        const result = await this.rank.runScheduled(tracker);
        if (result.skipped)
          this.logger.log(
            `SEO 排名跟踪器 #${tracker.id} 顺延：${result.reason}`,
          );
      } catch (error) {
        this.logger.error(
          `SEO 排名跟踪器 #${tracker.id} 自动检查失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** 每个组织每天最多同步一次：lastSyncAt 距今不足 20 小时就跳过。 */
  private async syncGoogleDaily(now: Date) {
    const connections = await this.prisma.seoGoogleConnection.findMany({
      where: { refreshTokenCipher: { not: '' } },
      select: { orgType: true, orgUserId: true, lastSyncAt: true },
    });
    const orgs = new Map<
      string,
      { orgType: string; orgUserId: string; lastSyncAt: Date | null }
    >();
    for (const row of connections) {
      const key = `${row.orgType}:${row.orgUserId}`;
      const existing = orgs.get(key);
      if (
        !existing ||
        (row.lastSyncAt &&
          (!existing.lastSyncAt || row.lastSyncAt > existing.lastSyncAt))
      )
        orgs.set(key, row);
    }
    for (const org of orgs.values()) {
      const key = `${org.orgType}:${org.orgUserId}`;
      if (
        org.lastSyncAt &&
        now.getTime() - org.lastSyncAt.getTime() < GOOGLE_SYNC_MIN_INTERVAL_MS
      )
        continue;
      const attempted = this.lastAttempt.get(key) || 0;
      if (now.getTime() - attempted < GOOGLE_SYNC_MIN_INTERVAL_MS) continue;
      this.lastAttempt.set(key, now.getTime());
      try {
        const messages = await this.google.syncAll({
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        });
        if (messages.length)
          this.logger.log(
            `SEO Google 同步 ${org.orgUserId}：${messages.join('；')}`,
          );
      } catch (error) {
        this.logger.error(
          `SEO Google 同步 ${org.orgUserId} 失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
