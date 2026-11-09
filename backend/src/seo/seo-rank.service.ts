import type { CurrentUser } from '../auth/current-user';
import type { SeoRankRun, SeoRankTracker } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  COST_NOTE,
  dfsUnitPrice,
  json,
  medianPosition,
  nextRunDate,
  normalizeDomain,
  num,
  sameSite,
  strArr,
  text,
  type Row,
} from './seo-shared';

const STALE_HEARTBEAT_MS = 10 * 60_000;

/** 排名跟踪：DataForSEO SERP 实测，单飞 + 心跳，夜间窗口由调度器触发。 */
export class SeoRankService extends SeoBase {
  async createTracker(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const tracker = await this.prisma.seoRankTracker.create({
      data: {
        ...orgKeyOf(org),
        projectId: project.id,
        domain: normalizeDomain(text(body.domain) || project.domain),
        locationCode: num(body.locationCode, project.locationCode),
        languageCode: clip(body.languageCode, 12) || project.languageCode,
        device: body.device === 'DESKTOP' ? 'DESKTOP' : 'MOBILE',
        depth: Math.min(100, Math.max(10, num(body.depth, 20))),
        frequency: this.frequency(body.frequency),
        reads: Math.min(3, Math.max(1, num(body.reads, 1))),
        enabled: body.enabled !== false,
        nextRunAt: nextRunDate(this.frequency(body.frequency)),
      },
    });
    return this.trackerView(tracker, 0, null);
  }

  async updateTracker(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const existing = await this.prisma.seoRankTracker.findFirst({
      where: { id: num(body.id), ...orgKeyOf(org) },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '排名跟踪器不存在');
    const frequency = this.frequency(body.frequency ?? existing.frequency);
    const tracker = await this.prisma.seoRankTracker.update({
      where: { id: existing.id },
      data: {
        domain: normalizeDomain(text(body.domain) || existing.domain),
        locationCode: num(body.locationCode, existing.locationCode),
        languageCode: clip(body.languageCode, 12) || existing.languageCode,
        device: body.device === 'DESKTOP' ? 'DESKTOP' : 'MOBILE',
        depth: Math.min(100, Math.max(10, num(body.depth, existing.depth))),
        frequency,
        reads: Math.min(3, Math.max(1, num(body.reads, existing.reads))),
        enabled:
          body.enabled === undefined ? existing.enabled : Boolean(body.enabled),
        nextRunAt:
          frequency === existing.frequency
            ? existing.nextRunAt
            : nextRunDate(frequency),
      },
    });
    return this.trackerView(tracker, await this.keywordCount(tracker.id), null);
  }

  async removeTracker(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const tracker = await this.prisma.seoRankTracker.findFirst({
      where: { id: num(body.id), ...orgKeyOf(org) },
    });
    if (!tracker)
      throw new BusinessException(ErrorCode.NOT_FOUND, '排名跟踪器不存在');
    const runs = await this.prisma.seoRankRun.findMany({
      where: { trackerId: tracker.id },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.seoRankSnapshot.deleteMany({
        where: { runId: { in: runs.map((run) => run.id) } },
      }),
      this.prisma.seoRankRun.deleteMany({ where: { trackerId: tracker.id } }),
      this.prisma.seoRankKeyword.deleteMany({
        where: { trackerId: tracker.id },
      }),
      this.prisma.seoRankTracker.delete({ where: { id: tracker.id } }),
    ]);
    return this.ok('排名跟踪器及其历史已删除');
  }

  async listTrackers(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const trackers = await this.prisma.seoRankTracker.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: { id: 'desc' },
    });
    if (!trackers.length) return [];
    const ids = trackers.map((tracker) => tracker.id);
    const [counts, latest] = await Promise.all([
      this.prisma.seoRankKeyword.groupBy({
        by: ['trackerId'],
        where: { trackerId: { in: ids } },
        _count: { id: true },
      }),
      this.prisma.seoRankSnapshot.groupBy({
        by: ['trackerId'],
        where: { trackerId: { in: ids }, position: { not: null } },
        _avg: { position: true },
      }),
    ]);
    const countOf = new Map(
      counts.map((item) => [item.trackerId, item._count.id]),
    );
    const avgOf = new Map(
      latest.map((item) => [item.trackerId, item._avg.position]),
    );
    return trackers.map((tracker) =>
      this.trackerView(
        tracker,
        countOf.get(tracker.id) || 0,
        avgOf.get(tracker.id) ?? null,
      ),
    );
  }

  async listRankKeywords(user: CurrentUser, query: Row) {
    const tracker = await this.tracker(user, num(query.trackerId));
    const [rows, latest] = await Promise.all([
      this.prisma.seoRankKeyword.findMany({
        where: { trackerId: tracker.id },
        orderBy: [{ pinned: 'desc' }, { id: 'asc' }],
        take: 500,
      }),
      this.prisma.seoRankSnapshot.findMany({
        where: { trackerId: tracker.id },
        orderBy: { checkedAt: 'desc' },
        take: 2000,
        select: { keyword: true, position: true },
      }),
    ]);
    const positionOf = new Map<string, number | null>();
    for (const snapshot of latest)
      if (!positionOf.has(snapshot.keyword))
        positionOf.set(snapshot.keyword, snapshot.position);
    return rows.map((row) => ({
      id: row.id,
      trackerId: row.trackerId,
      keyword: row.keyword,
      pinned: row.pinned,
      lastPosition: positionOf.get(row.keyword) ?? null,
    }));
  }

  async addRankKeywords(user: CurrentUser, body: Row) {
    const tracker = await this.tracker(user, num(body.trackerId));
    const words = [
      ...new Set(strArr(body.keywords).map((word) => clip(word, 200).trim())),
    ].filter(Boolean);
    if (!words.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写要跟踪的关键词',
      );
    const existing = await this.prisma.seoRankKeyword.findMany({
      where: { trackerId: tracker.id, keyword: { in: words } },
      select: { keyword: true },
    });
    const known = new Set(existing.map((item) => item.keyword));
    const fresh = words.filter((word) => !known.has(word)).slice(0, 200);
    if (fresh.length)
      await this.prisma.seoRankKeyword.createMany({
        data: fresh.map((keyword) => ({ trackerId: tracker.id, keyword })),
      });
    return { added: fresh.length };
  }

  async removeRankKeyword(user: CurrentUser, body: Row) {
    const row = await this.prisma.seoRankKeyword.findFirst({
      where: { id: num(body.id) },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '跟踪词不存在');
    await this.tracker(user, row.trackerId);
    await this.prisma.seoRankKeyword.delete({ where: { id: row.id } });
    return this.ok('跟踪词已删除（历史快照保留）');
  }

  async estimateRankCost(user: CurrentUser, query: Row) {
    const tracker = await this.tracker(user, num(query.trackerId));
    const count = await this.keywordCount(tracker.id);
    const calls = count * tracker.reads;
    return {
      calls,
      estimatedUsd: Math.round(calls * dfsUnitPrice('serp') * 10000) / 10000,
      note: `${count} 个词 × ${tracker.reads} 次读取。${COST_NOTE}`,
    };
  }

  async runRankCheck(user: CurrentUser, body: Row) {
    const tracker = await this.tracker(user, num(body.trackerId));
    // 付费步骤不设审批闸：先给预估，用户点「立即检查」即视为同意本次扣费
    await this.requireDfs(user);
    const run = await this.claim(tracker.id, 'MANUAL');
    void this.execute(run.id, tracker, user.userId).catch(() => undefined);
    return this.runView(run);
  }

  async rankHistory(user: CurrentUser, query: Row) {
    const tracker = await this.tracker(user, num(query.trackerId));
    const runs = await this.prisma.seoRankRun.findMany({
      where: { trackerId: tracker.id },
      orderBy: { id: 'desc' },
      take: 30,
    });
    const snapshots = await this.prisma.seoRankSnapshot.findMany({
      where: { trackerId: tracker.id },
      orderBy: { checkedAt: 'desc' },
      take: 2000,
    });
    const byDate = new Map<string, { sum: number; count: number }>();
    for (const snapshot of snapshots) {
      if (snapshot.position === null) continue;
      const date = snapshot.checkedAt.toISOString().slice(0, 10);
      const bucket = byDate.get(date) || { sum: 0, count: 0 };
      bucket.sum += snapshot.position;
      bucket.count += 1;
      byDate.set(date, bucket);
    }
    return {
      runs: runs.map((run) => this.runView(run)),
      snapshots: snapshots.slice(0, 500).map((snapshot) => ({
        keyword: snapshot.keyword,
        device: snapshot.device,
        position: snapshot.position,
        url: snapshot.url,
        checkedAt: snapshot.checkedAt.toISOString(),
      })),
      trend: [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, bucket]) => ({
          date,
          avgPosition: Math.round((bucket.sum / bucket.count) * 10) / 10,
        })),
    };
  }

  // ---------- 调度器入口 ----------

  /** 到期的启用跟踪器（调度器在 03:00–05:00 窗口内逐个认领）。 */
  async dueTrackers(limit = 20) {
    return this.prisma.seoRankTracker.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** 夜间窗口自动检查：凭据按账号取组织主体账号；没配数据源就顺延一天，不空转、不造假。 */
  async runScheduled(tracker: SeoRankTracker) {
    const credential = await this.ctx.dfs.credential(tracker.orgUserId);
    if (!credential) {
      await this.prisma.seoRankTracker.update({
        where: { id: tracker.id },
        data: { nextRunAt: nextRunDate('DAILY') },
      });
      return { skipped: true, runId: 0, reason: '未配置 DataForSEO 数据源' };
    }
    const run = await this.claim(tracker.id, 'SCHEDULED');
    await this.execute(run.id, tracker, tracker.orgUserId);
    return { skipped: false, runId: run.id, reason: '' };
  }

  /** 单飞认领：activeLock 唯一约束保证同一跟踪器同时只有一个批次在跑。 */
  async claim(trackerId: number, trigger: 'MANUAL' | 'SCHEDULED') {
    const running = await this.prisma.seoRankRun.findFirst({
      where: { trackerId, activeLock: trackerId },
    });
    if (running) {
      const heartbeat =
        running.heartbeatAt?.getTime() || running.startedAt.getTime();
      if (Date.now() - heartbeat < STALE_HEARTBEAT_MS)
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该跟踪器已有检查在进行中，请等待完成',
        );
      await this.prisma.seoRankRun.update({
        where: { id: running.id },
        data: {
          status: 'FAILED',
          activeLock: null,
          errorCode: '心跳超时，任务已回收',
          finishedAt: new Date(),
        },
      });
    }
    const tracker = await this.prisma.seoRankTracker.findUnique({
      where: { id: trackerId },
    });
    if (!tracker)
      throw new BusinessException(ErrorCode.NOT_FOUND, '排名跟踪器不存在');
    const count = await this.keywordCount(trackerId);
    if (!count)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '跟踪器还没有关键词，请先添加跟踪词',
      );
    return this.prisma.seoRankRun.create({
      data: {
        trackerId,
        status: 'PENDING',
        trigger,
        costEstimate:
          Math.round(count * tracker.reads * dfsUnitPrice('serp') * 10000) /
          10000,
        activeLock: trackerId,
        heartbeatAt: new Date(),
      },
    });
  }

  async execute(runId: number, tracker: SeoRankTracker, ownerUserId: string) {
    const credential = await this.ctx.dfs.credential(ownerUserId);
    if (!credential) {
      await this.fail(runId, '未配置 DataForSEO 数据源，无法实测排名');
      return;
    }
    const keywords = await this.prisma.seoRankKeyword.findMany({
      where: { trackerId: tracker.id },
      orderBy: [{ pinned: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    await this.prisma.seoRankRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', heartbeatAt: new Date() },
    });
    try {
      for (const item of keywords) {
        const reads: Array<number | null> = [];
        let url = '';
        let features: string[] = [];
        for (let attempt = 0; attempt < tracker.reads; attempt += 1) {
          const serp = await this.ctx.dfs.serp(credential, {
            keyword: item.keyword,
            locationCode: tracker.locationCode,
            languageCode: tracker.languageCode,
            device: tracker.device === 'DESKTOP' ? 'DESKTOP' : 'MOBILE',
            depth: tracker.depth,
          });
          const hit = serp.items.find((result) =>
            sameSite(
              result.url || `https://${result.domain}`,
              tracker.domain,
              true,
            ),
          );
          reads.push(hit ? hit.rank_group || hit.rank_absolute : null);
          if (hit) url = clip(hit.url, 500);
          features = serp.features;
        }
        await this.prisma.seoRankSnapshot.create({
          data: {
            runId,
            trackerId: tracker.id,
            keyword: item.keyword,
            device: tracker.device,
            position: medianPosition(reads),
            url,
            serpFeatures: json(features),
          },
        });
        await this.prisma.seoRankRun.update({
          where: { id: runId },
          data: { heartbeatAt: new Date() },
        });
      }
      await this.prisma.seoRankRun.update({
        where: { id: runId },
        data: { status: 'DONE', activeLock: null, finishedAt: new Date() },
      });
      await this.prisma.seoRankTracker.update({
        where: { id: tracker.id },
        data: { nextRunAt: nextRunDate(tracker.frequency) },
      });
    } catch (error) {
      await this.fail(
        runId,
        error instanceof Error ? error.message : '排名检查失败',
      );
    }
  }

  private async fail(runId: number, message: string) {
    await this.prisma.seoRankRun
      .update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          activeLock: null,
          errorCode: clip(message, 200),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  private async tracker(user: CurrentUser, trackerId: number) {
    const org = await this.org(user);
    const row = await this.prisma.seoRankTracker.findFirst({
      where: { id: Number(trackerId), ...orgKeyOf(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '排名跟踪器不存在');
    return row;
  }

  private keywordCount(trackerId: number) {
    return this.prisma.seoRankKeyword.count({ where: { trackerId } });
  }

  private frequency(value: unknown): string {
    return ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(value))
      ? String(value)
      : 'WEEKLY';
  }

  private trackerView(
    row: SeoRankTracker,
    keywordCount: number,
    lastPosition: number | null,
  ) {
    return {
      id: row.id,
      projectId: row.projectId,
      domain: row.domain,
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      device: row.device,
      depth: row.depth,
      frequency: row.frequency,
      reads: row.reads,
      nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
      enabled: row.enabled,
      keywordCount,
      lastPosition:
        lastPosition === null ? null : Math.round(lastPosition * 10) / 10,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private runView(row: SeoRankRun) {
    return {
      id: row.id,
      trackerId: row.trackerId,
      status: row.status,
      trigger: row.trigger,
      costEstimate: row.costEstimate,
      errorCode: row.errorCode,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }
}
