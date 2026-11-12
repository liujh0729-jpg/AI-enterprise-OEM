import { Logger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';
import { ContentJobService } from './content-job.service';

const logger = new Logger('ContentJobPool');

const DEFAULT_TICK_MS = 3_000;
const DEFAULT_CONCURRENCY = 4;
/** 一轮最多捞这么多条，剩下的下一轮再来。 */
const BATCH = 20;

/**
 * 内容生成任务的调度池（进程内定时器，不是 MQ，也不是纯内存队列）。
 *
 * - DB 是唯一真值：待办永远是 `content_generation_jobs` 里 `status='PENDING'` 的行；
 * - 进程内只保存「并发槽 + 在跑 jobId」，重启只把在跑的置中断（healStale），排队任务下一轮接着捞；
 * - 多 worker 同时捞到同一条时，`UPDATE ... WHERE status='PENDING'` 只有一个 count=1，天然互斥。
 *
 * 可用 `CONTENT_JOB_SCHEDULER_DISABLED=1` 关闭、`CONTENT_JOB_TICK_MS` 调间隔、
 * `CONTENT_JOB_CONCURRENCY` 调每个 worker 的并发。
 */
export class ContentJobWorkerPool {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly limit: number;
  private readonly tickMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ContentJobService,
  ) {
    const limit = Number(
      process.env.CONTENT_JOB_CONCURRENCY || DEFAULT_CONCURRENCY,
    );
    this.limit =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : DEFAULT_CONCURRENCY;
    const tick = Number(process.env.CONTENT_JOB_TICK_MS || DEFAULT_TICK_MS);
    this.tickMs =
      Number.isFinite(tick) && tick >= 500 ? Math.floor(tick) : DEFAULT_TICK_MS;
  }

  onModuleInit() {
    if (
      String(process.env.CONTENT_JOB_SCHEDULER_DISABLED || '').trim() === '1'
    ) {
      logger.warn('内容任务调度已禁用（CONTENT_JOB_SCHEDULER_DISABLED=1）');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    void this.tick();
    logger.log(
      `内容任务调度已启动：每 ${this.tickMs}ms 取一次，单进程并发 ${this.limit}`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 一轮：收口僵尸任务 → 按剩余并发槽捞最老的 PENDING → 条件更新占坑后起跑。 */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.jobs.healStale();
      const free = this.limit - this.jobs.inflight();
      if (free <= 0) return;
      const pending = await this.prisma.contentGenerationJob.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: Math.min(free, BATCH),
      });
      for (const row of pending) {
        if (this.jobs.inflight() >= this.limit) break;
        if (!(await this.jobs.claim(row.id))) continue;
        this.jobs.start(row.id);
      }
    } catch (error) {
      logger.error(
        `内容任务调度 tick 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.busy = false;
    }
  }
}
