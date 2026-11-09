import { Prisma } from '../../generated/prisma';
import { Logger } from '../common/logger';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DigitalAssetService } from '../content/digital-asset.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_DOWNLOAD_BYTES,
  type ComfyJob,
  type ComfyOutput,
  ComfyClient,
} from './comfy.client';
import { CommunityService } from './community.service';

/**
 * 创意社区运行调度器（进程内定时器）。
 *
 * 为什么必须有它：Comfy Cloud 的产物是**短命签名 URL（约 6 小时）且需要带 Key 才能读**，
 * 浏览器直挂 `<img>` 必 401。所以任务成功后必须由后端取回来转进本站 OSS，
 * 再登记进作者的数字资产台账——否则用户明天就打不开今天跑出来的图。
 *
 * 可用 `COMMUNITY_SCHEDULER_DISABLED=1` 关闭、`COMMUNITY_SCHEDULER_TICK_MS` 调整间隔。
 */

const DEFAULT_TICK_MS = 20_000;
/** 一轮最多处理这么多条，剩下的下一轮再来（别把上游连接池和内存占满）。 */
const BATCH = 20;
/** 单条 run 一次最多转存这么多产物。 */
const OUTPUT_LIMIT = 20;
/** 超过这个时间还没终态，主动替用户取消（上游排队可能一直排着）。 */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

type ActiveRun = {
  id: number;
  workflowId: number;
  userId: string;
  jobId: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
};

function outputName(output: ComfyOutput): string {
  const base =
    text(output.name)
      .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      .slice(0, 120) || output.kind;
  // putLocal 靠扩展名判类型：没有后缀就按产物种类补一个，避免全落进「文件」
  return /\.[A-Za-z0-9]{1,5}$/.test(base)
    ? base
    : `${base}${
        output.kind === 'video'
          ? '.mp4'
          : output.kind === 'audio'
            ? '.mp3'
            : output.kind === 'image'
              ? '.png'
              : '.bin'
      }`;
}

export class CommunityRunScheduler {
  private readonly logger = new Logger(CommunityRunScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly comfy: ComfyClient,
    private readonly community: CommunityService,
    private readonly assets: DigitalAssetService,
  ) {}

  onModuleInit() {
    if (String(process.env.COMMUNITY_SCHEDULER_DISABLED || '').trim() === '1') {
      this.logger.warn(
        '创意社区运行调度已禁用（COMMUNITY_SCHEDULER_DISABLED=1）：运行产物将不会转存进本站 OSS',
      );
      return;
    }
    const configured = Number(
      process.env.COMMUNITY_SCHEDULER_TICK_MS || DEFAULT_TICK_MS,
    );
    const intervalMs =
      Number.isFinite(configured) && configured >= 5000
        ? configured
        : DEFAULT_TICK_MS;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(
      `创意社区运行调度已启动：每 ${intervalMs}ms 轮询一次进行中的运行`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const runs = await this.prisma.communityRun.findMany({
        where: { status: { in: ['queued', 'running'] }, jobId: { not: '' } },
        orderBy: { updatedAt: 'asc' },
        take: BATCH,
        select: {
          id: true,
          workflowId: true,
          userId: true,
          jobId: true,
          status: true,
          startedAt: true,
          createdAt: true,
        },
      });
      for (const run of runs) {
        try {
          await this.poll(run);
        } catch (error) {
          // 单条失败不影响同轮其它运行；下一轮会再试
          this.logger.warn(
            `运行轮询失败：run=${run.id} ${error instanceof Error ? error.message : text(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `创意社区运行调度 tick 失败：${error instanceof Error ? error.message : text(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  private async poll(run: ActiveRun) {
    const apiKey = await this.community.comfyKeyOf(run.userId);
    if (!apiKey) {
      // Key 已被解除：拿不到结果，按失败收口，别把记录永远留在「进行中」
      await this.prisma.communityRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorText: 'Comfy Cloud 连接已解除，无法继续获取这次运行的结果',
          finishedAt: new Date(),
        },
      });
      return;
    }
    const job = await this.comfy.getJob(apiKey, run.jobId);
    const data: Prisma.CommunityRunUpdateInput = {
      progressCurrent: job.progressCurrent,
      progressTotal: job.progressTotal,
      queuePosition: job.queuePosition,
    };
    if (job.status === 'succeeded') {
      const transferred = await this.transferOutputs(apiKey, run, job);
      if (job.outputs.length && !transferred.done) {
        // 一个都没转存成功：保持进行中，下一轮重试（30 分钟后由超时兜底取消）
        data.errorText = `产物转存失败 ${transferred.failed} 件，正在重试`;
        await this.prisma.communityRun.update({ where: { id: run.id }, data });
        return;
      }
      data.status = 'succeeded';
      data.finishedAt = new Date();
      data.errorText = transferred.failed
        ? `有 ${transferred.failed} 件产物没能转存到本站`
        : '';
      if (!run.startedAt) data.startedAt = new Date();
    } else if (job.status === 'failed' || job.status === 'canceled') {
      data.status = job.status;
      data.errorText = (job.errorText || 'Comfy Cloud 已结束这次运行').slice(
        0,
        500,
      );
      data.finishedAt = new Date();
    } else {
      if (job.status === 'running' && !run.startedAt)
        data.startedAt = new Date();
      // 排队/执行超过上限：主动取消，用户不必一直盯着「生成中」
      if (Date.now() - run.createdAt.getTime() > RUN_TIMEOUT_MS) {
        try {
          await this.comfy.cancelJob(apiKey, run.jobId);
        } catch (error) {
          // 取消失败也要落终态，否则这条记录永远不会被扫到
          this.logger.warn(
            `超时取消失败：run=${run.id} ${error instanceof Error ? error.message : text(error)}`,
          );
        }
        data.status = 'canceled';
        data.errorText =
          '超过 30 分钟还没有完成，本站已主动取消（Comfy Cloud 排队可能拥堵）';
        data.finishedAt = new Date();
      }
    }
    await this.prisma.communityRun.update({ where: { id: run.id }, data });
  }

  /**
   * 逐个取回产物：下载 → 交数字资产台账（内部转存本站 OSS）→ 落 `CommunityRunOutput`。
   * 已转存过的同名产物直接跳过，重试轮不会产生重复行。
   */
  private async transferOutputs(
    apiKey: string,
    run: ActiveRun,
    job: ComfyJob,
  ): Promise<{ done: number; failed: number }> {
    const existing = await this.prisma.communityRunOutput.findMany({
      where: { runId: run.id },
      select: { name: true },
      take: 100,
    });
    const done = new Set(existing.map((row) => row.name));
    let ok = 0;
    let failed = 0;
    for (const output of job.outputs.slice(0, OUTPUT_LIMIT)) {
      const name = outputName(output);
      if (done.has(name)) {
        ok += 1;
        continue;
      }
      try {
        const downloaded = await this.comfy.fetchOutputBytes(
          apiKey,
          output,
          MAX_DOWNLOAD_BYTES[output.kind] ?? MAX_DOWNLOAD_BYTES.file,
        );
        const asset = await this.assets.registerDeliverable(run.userId, {
          bytes: downloaded.bytes,
          filename: name,
          labels: ['创意社区', 'Comfy Cloud'],
          dir: 'community',
          source: `community_run:${run.id}`,
        });
        if (!asset) {
          // registerDeliverable 是尽力而为：没落成台账就说明没进本站桶，算失败，下一轮重试
          throw new BusinessException(
            ErrorCode.SERVICE_UNAVAILABLE,
            '产物未能存入本站文件存储',
          );
        }
        // putLocal 自己决定对象键，这里回读台账拿键，避免重复上传一次
        const entry = await this.prisma.digitalAssetEntry.findFirst({
          where: { userId: run.userId, aipddAssetId: asset.id },
          select: { ossKey: true },
        });
        await this.prisma.communityRunOutput.create({
          data: {
            runId: run.id,
            kind: output.kind,
            name,
            ossKey: entry?.ossKey || '',
            url: asset.url || '',
            sizeBytes: BigInt(downloaded.bytes.length),
            assetId: asset.id,
          },
        });
        ok += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `产物转存失败：run=${run.id} name=${name} ${error instanceof Error ? error.message : text(error)}`,
        );
      }
    }
    return { done: ok, failed };
  }
}
