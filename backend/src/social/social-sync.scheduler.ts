import { Logger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';
import { SocialSyncService } from './social-sync.service';

const BATCH = 20;
const CONCURRENCY = 2;
const LEASE_MS = 5 * 60_000;

/**
 * 社交跨站同步调度器：每 15 秒领取一批 PENDING job，用「条件更新 + lockedAt 租约」
 * 跨 MySQL/PostgreSQL 安全领取；RUNNING 超过 5 分钟视为进程中断，回收重投。
 * 上游写失败由 SocialSyncService 退避；本调度器只负责节奏与并发。
 */
export class SocialSyncScheduler {
  private readonly logger = new Logger(SocialSyncScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SocialSyncService,
  ) {}

  onModuleInit() {
    if (String(process.env.SOCIAL_SYNC_DISABLED || '').trim() === '1') {
      this.logger.warn('社交同步调度已禁用（SOCIAL_SYNC_DISABLED=1）');
      return;
    }
    const intervalMs = Number(process.env.SOCIAL_SYNC_TICK_MS || 15000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`社交同步调度已启动：每 ${intervalMs}ms 领取一批任务`);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.prisma.socialSyncJob.updateMany({
        where: {
          status: 'RUNNING',
          lockedAt: { lt: new Date(Date.now() - LEASE_MS) },
        },
        data: { status: 'PENDING', lockedAt: null },
      });
      const candidates = await this.prisma.socialSyncJob.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true },
      });
      for (let index = 0; index < candidates.length; index += CONCURRENCY) {
        const slice = candidates.slice(index, index + CONCURRENCY);
        await Promise.all(
          slice.map(async (candidate) => {
            const claimed = await this.prisma.socialSyncJob.updateMany({
              where: { id: candidate.id, status: 'PENDING' },
              data: {
                status: 'RUNNING',
                lockedAt: new Date(),
                attempts: { increment: 1 },
              },
            });
            if (claimed.count === 0) return;
            await this.sync.execute(candidate.id);
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        `社交同步调度失败:${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
