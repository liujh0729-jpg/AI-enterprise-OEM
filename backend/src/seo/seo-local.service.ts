import type { CurrentUser } from '../auth/current-user';
import type { SeoLocalTracker } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  COST_NOTE,
  dfsUnitPrice,
  gridPoints,
  json,
  num,
  type Row,
} from './seo-shared';

type StoredCompetitor = { name: string; rank: number; address: string };

const STALE_MS = 15 * 60_000;

/** 本地 SEO：以门店坐标铺 3×3 / 5×5 网格，逐点查 Google Maps SERP，看服务半径内的真实名次分布。 */
export class SeoLocalService extends SeoBase {
  async createLocalTracker(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const tracker = await this.prisma.seoLocalTracker.create({
      data: {
        ...orgKeyOf(org),
        projectId: project.id,
        businessName: clip(body.businessName, 120),
        keyword: clip(body.keyword, 200),
        centerLat: num(body.centerLat),
        centerLng: num(body.centerLng),
        gridSize: num(body.gridSize) === 5 ? 5 : 3,
        radiusKm: Math.min(50, Math.max(0.5, num(body.radiusKm, 5))),
      },
    });
    return this.trackerView(tracker);
  }

  async listLocalTrackers(user: CurrentUser, query: Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const rows = await this.prisma.seoLocalTracker.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((item) => this.trackerView(item));
  }

  async removeLocalTracker(user: CurrentUser, body: Row) {
    const tracker = await this.tracker(user, num(body.id));
    const runs = await this.prisma.seoLocalRun.findMany({
      where: { trackerId: tracker.id },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.seoLocalPoint.deleteMany({
        where: { runId: { in: runs.map((run) => run.id) } },
      }),
      this.prisma.seoLocalRun.deleteMany({ where: { trackerId: tracker.id } }),
      this.prisma.seoLocalTracker.delete({ where: { id: tracker.id } }),
    ]);
    return this.ok('本地网格跟踪器及其历史已删除');
  }

  async estimateLocalCost(user: CurrentUser, query: Row) {
    const tracker = await this.tracker(user, num(query.trackerId));
    const calls = tracker.gridSize * tracker.gridSize;
    return {
      calls,
      estimatedUsd: Math.round(calls * dfsUnitPrice('maps') * 10000) / 10000,
      note: `${tracker.gridSize}×${tracker.gridSize} 网格 = ${calls} 次 Maps 查询。${COST_NOTE}`,
    };
  }

  async runLocalCheck(user: CurrentUser, body: Row) {
    const tracker = await this.tracker(user, num(body.trackerId));
    await this.requireDfs(user);
    const run = await this.claim(tracker.id);
    void this.execute(run.id, tracker, user.userId).catch(() => undefined);
    return this.gridView(tracker, run.id, [], null);
  }

  async localGrid(user: CurrentUser, query: Row) {
    const tracker = await this.tracker(user, num(query.trackerId));
    const runId = num(query.runId, 0);
    const run = runId
      ? await this.prisma.seoLocalRun.findFirst({
          where: { id: runId, trackerId: tracker.id },
        })
      : await this.prisma.seoLocalRun.findFirst({
          where: { trackerId: tracker.id, status: 'DONE' },
          orderBy: { id: 'desc' },
        });
    if (!run) return this.gridView(tracker, null, [], null);
    const points = await this.prisma.seoLocalPoint.findMany({
      where: { runId: run.id },
      orderBy: [{ row: 'asc' }, { col: 'asc' }],
    });
    if (run.status !== 'DONE' && !points.length)
      return this.gridView(tracker, run.id, [], null);
    const half = (tracker.gridSize - 1) / 2;
    const center = points.find(
      (point) => point.row === half && point.col === half,
    );
    const centerResults: Array<{
      name: string;
      rank: number;
      address: string;
    }> = [];
    if (center) {
      if (center.rank !== null)
        centerResults.push({
          name: tracker.businessName,
          rank: center.rank,
          address: center.address,
        });
      centerResults.push(...this.competitorsOf(center.competitors));
    }
    const view = this.gridView(
      tracker,
      run.id,
      points.map((point) => ({
        row: point.row,
        col: point.col,
        lat: point.lat,
        lng: point.lng,
        rank: point.rank,
        competitors: this.competitorsOf(point.competitors).map((item) => ({
          name: item.name,
          rank: item.rank,
        })),
      })),
      run.finishedAt
        ? run.finishedAt.toISOString()
        : run.startedAt.toISOString(),
    );
    return { ...view, centerResults };
  }

  private async claim(trackerId: number) {
    const running = await this.prisma.seoLocalRun.findFirst({
      where: { trackerId, activeLock: trackerId },
    });
    if (running) {
      if (Date.now() - running.startedAt.getTime() < STALE_MS)
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该门店已有网格检查在进行中，请等待完成',
        );
      await this.prisma.seoLocalRun.update({
        where: { id: running.id },
        data: {
          status: 'FAILED',
          activeLock: null,
          errorCode: '任务超时未完成，已回收',
          finishedAt: new Date(),
        },
      });
    }
    const tracker = await this.prisma.seoLocalTracker.findUnique({
      where: { id: trackerId },
    });
    if (!tracker)
      throw new BusinessException(ErrorCode.NOT_FOUND, '本地网格跟踪器不存在');
    return this.prisma.seoLocalRun.create({
      data: {
        trackerId,
        status: 'PENDING',
        costEstimate:
          Math.round(
            tracker.gridSize * tracker.gridSize * dfsUnitPrice('maps') * 10000,
          ) / 10000,
        activeLock: trackerId,
      },
    });
  }

  private async execute(
    runId: number,
    tracker: SeoLocalTracker,
    ownerUserId: string,
  ) {
    const credential = await this.ctx.dfs.credential(ownerUserId);
    if (!credential) {
      await this.fail(runId, '未配置 DataForSEO 数据源，无法查询 Maps 名次');
      return;
    }
    await this.prisma.seoLocalRun.update({
      where: { id: runId },
      data: { status: 'RUNNING' },
    });
    const points = gridPoints(tracker);
    const target = tracker.businessName.trim().toLowerCase();
    const project = await this.prisma.seoProject.findUnique({
      where: { id: tracker.projectId },
      select: { languageCode: true },
    });
    const languageCode = project?.languageCode || 'en';
    try {
      for (let index = 0; index < points.length; index += 4) {
        const batch = points.slice(index, index + 4);
        const results = await Promise.all(
          batch.map(async (point) => {
            const items = await this.ctx.dfs.mapsSerp(credential, {
              keyword: tracker.keyword,
              lat: point.lat,
              lng: point.lng,
              languageCode,
              depth: 20,
            });
            const mine = items.find((item) =>
              String(item.title || '')
                .toLowerCase()
                .includes(target),
            );
            const others: StoredCompetitor[] = items
              .filter((item) => item !== mine)
              .slice(0, 10)
              .map((item) => ({
                name: clip(item.title, 200),
                rank: item.rank_group || item.rank_absolute,
                address: clip(item.address, 300),
              }));
            return {
              runId,
              trackerId: tracker.id,
              row: point.row,
              col: point.col,
              lat: point.lat,
              lng: point.lng,
              rank: mine ? mine.rank_group || mine.rank_absolute : null,
              competitors: json(others),
              address: clip(mine?.address || '', 300),
            };
          }),
        );
        await this.prisma.seoLocalPoint.createMany({ data: results });
      }
      await this.prisma.seoLocalRun.update({
        where: { id: runId },
        data: { status: 'DONE', activeLock: null, finishedAt: new Date() },
      });
    } catch (error) {
      await this.fail(
        runId,
        error instanceof Error ? error.message : '本地网格检查失败',
      );
    }
  }

  private async fail(runId: number, message: string) {
    await this.prisma.seoLocalRun
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
    const row = await this.prisma.seoLocalTracker.findFirst({
      where: { id: Number(trackerId), ...orgKeyOf(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '本地网格跟踪器不存在');
    return row;
  }

  private competitorsOf(value: unknown): StoredCompetitor[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = (item || {}) as Row;
      return {
        name: clip(row.name, 200),
        rank: num(row.rank),
        address: clip(row.address, 300),
      };
    });
  }

  private trackerView(row: SeoLocalTracker) {
    return {
      id: row.id,
      projectId: row.projectId,
      businessName: row.businessName,
      keyword: row.keyword,
      centerLat: row.centerLat,
      centerLng: row.centerLng,
      gridSize: row.gridSize,
      radiusKm: row.radiusKm,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private gridView(
    tracker: SeoLocalTracker,
    runId: number | null,
    points: Array<{
      row: number;
      col: number;
      lat: number;
      lng: number;
      rank: number | null;
      competitors: Array<{ name: string; rank: number }>;
    }>,
    checkedAt: string | null,
  ) {
    const ranks = points
      .map((point) => point.rank)
      .filter((rank): rank is number => rank !== null);
    return {
      tracker: this.trackerView(tracker),
      runId,
      gridSize: tracker.gridSize,
      points,
      stats: {
        avgRank: ranks.length
          ? Math.round(
              (ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length) * 10,
            ) / 10
          : null,
        top1: ranks.filter((rank) => rank === 1).length,
        top3: ranks.filter((rank) => rank <= 3).length,
        covered: ranks.length,
        total: tracker.gridSize * tracker.gridSize,
      },
      centerResults: [] as Array<{
        name: string;
        rank: number;
        address: string;
      }>,
      checkedAt,
    };
  }
}
