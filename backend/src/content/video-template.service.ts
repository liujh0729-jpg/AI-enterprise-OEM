import type { Prisma } from '../../generated/prisma';
import {
  VIDEO_TEMPLATE_TYPE_LABELS,
  type VideoTemplateCard,
  type VideoTemplateDetail,
  type VideoTemplateSort,
  type VideoTemplateSyncMode,
  type VideoTemplateSyncStatus,
  type VideoTemplateType,
} from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { toJsonInput } from '../common/json-input';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { PointsService } from '../points/points.service';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { ContentJobService } from './content-job.service';

const logger = new Logger('VideoTemplate');

/** 列表里简介只留这么多字，详情再给全文。 */
const LIST_DESCRIPTION_MAX = 120;
/** AIWORKIN 补充模版的固定 owner：没有本地账号，不参与积分结算。 */
export const AIWORKIN_OWNER_ID = 'aiworkin';
export const AIWORKIN_OWNER_NAME = 'AIWORKIN 平台';
/** 上游同步分页：一次 100 条、最多 20 页，防上游翻页配置异常时无限循环。 */
const SYNC_PAGE_SIZE = 100;
const SYNC_MAX_PAGES = 20;

type TemplateRow = {
  id: number;
  userId: string;
  source: string;
  upstreamId: string | null;
  title: string;
  description: string;
  videoType: string;
  sampleUrl: string;
  coverUrl: string;
  referenceImages: unknown;
  prompt: string;
  modelChannelName: string;
  modelName: string;
  viewCost: number;
  viewCount: number;
  useCount: number;
  favoriteCount: number;
  ratingSum: number;
  ratingCount: number;
  createdAt: Date;
};

/** 上游可能还没上线，路径做成环境变量；默认值按 AIworkin 的域内命名约定先占位。 */
function upstreamPath() {
  return (
    String(process.env.AIWORKIN_VIDEO_TEMPLATE_PATH || '').trim() ||
    '/content/video-templates/market'
  );
}

/** 定时同步没有当前用户，用平台级服务令牌；未配置时状态写 SKIPPED，不阻断后台。 */
export function videoTemplateSyncToken() {
  return String(
    process.env.AIWORKIN_VIDEO_TEMPLATE_TOKEN ||
      process.env.AIWORKIN_SERVICE_TOKEN ||
      '',
  ).trim();
}

function imageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object')
        return text((item as Record<string, unknown>).url).trim();
      return '';
    })
    .filter((url) => /^https?:\/\//i.test(url));
}

function videoTypeOf(value: unknown): VideoTemplateType {
  const raw = text(value).trim();
  const keys = Object.keys(VIDEO_TEMPLATE_TYPE_LABELS) as VideoTemplateType[];
  if (keys.includes(raw as VideoTemplateType)) return raw as VideoTemplateType;
  const hit = keys.find((key) => VIDEO_TEMPLATE_TYPE_LABELS[key] === raw);
  return hit || 'other';
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function isUniqueError(error: unknown) {
  return (error as { code?: string })?.code === 'P2002';
}

/** 模版一行的前端形状；收藏 / 评分 / 本次查看记录由批量查询补。 */
function cardOf(
  row: TemplateRow,
  ownerName: string,
  mine: boolean,
  favorited: boolean,
  myRating: number,
): VideoTemplateCard {
  return {
    id: row.id,
    title: row.title,
    description:
      row.description.length > LIST_DESCRIPTION_MAX
        ? `${row.description.slice(0, LIST_DESCRIPTION_MAX)}…`
        : row.description,
    videoType: row.videoType,
    videoTypeLabel:
      VIDEO_TEMPLATE_TYPE_LABELS[row.videoType as VideoTemplateType] || '其他',
    coverUrl: row.coverUrl,
    source: row.source === 'AIWORKIN' ? 'AIWORKIN' : 'LOCAL',
    ownerName,
    viewCost: row.viewCost,
    useCount: row.useCount,
    favoriteCount: row.favoriteCount,
    viewCount: row.viewCount,
    ratingAvg: row.ratingCount ? round1(row.ratingSum / row.ratingCount) : 0,
    ratingCount: row.ratingCount,
    createdAt: row.createdAt.toISOString(),
    mine,
    favorited,
    myRating,
  };
}

/**
 * 视频模版社区：发布 / 列表 / 详情 / 付费查看 / 收藏 / 评分 / 复刻。
 *
 * 查看积分的结算放在**一个事务**里完成（建查看记录 → 扣查看者 → 给发布者入账 →
 * 两条流水 → 浏览数），唯一键 `[userId, templateId]` 负责并发去重：
 * 同一账号同时点两次只会成一笔，另一笔整事务回滚后按「已查看」返回。
 *
 * AIWORKIN 来源的模版不参与积分：固定 owner、免费、始终解锁；
 * 平台管理员在后台开关控制是否展示，并按策略自动拉取补充。
 */
export class VideoTemplateService {
  static readonly SHOW_AIWORKIN_KEY = 'video_template_show_aiworkin';
  static readonly SYNC_MODE_KEY = 'video_template_sync_mode';
  static readonly SYNC_INTERVAL_KEY = 'video_template_sync_interval_minutes';
  static readonly SYNC_STATUS_KEY = 'video_template_sync_status';

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    private readonly points: PointsService,
    private readonly jobs: ContentJobService,
    private readonly client: AiworkinClient,
  ) {}

  // ---------------------------------------------------------------- 列表 / 详情

  async list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      type?: string;
      sort?: string;
      mine?: boolean;
      favorite?: boolean;
    },
  ) {
    const page = pageParam(query.page, query.pageSize, 20);
    const showAiworkin = await this.showAiworkin();
    const and: Prisma.VideoTemplateWhereInput[] = [];
    if (!showAiworkin) and.push({ source: 'LOCAL' });
    if (query.type) and.push({ videoType: query.type });
    if (query.mine === true) {
      and.push({ source: 'LOCAL', userId: user.userId });
    }
    if (query.favorite === true) {
      const favorites = await this.prisma.videoTemplateFavorite.findMany({
        where: { userId: user.userId },
        select: { templateId: true },
        take: 2000,
      });
      and.push({ id: { in: favorites.map((row) => row.templateId) } });
    }
    const keyword = text(query.keyword).trim().slice(0, 120);
    if (keyword) {
      // 只搜标题与简介：提示词是付费配方，不能拿搜索当免费探测通道
      and.push({
        OR: [
          { title: { contains: keyword } },
          { description: { contains: keyword } },
        ],
      });
    }
    const where: Prisma.VideoTemplateWhereInput = and.length
      ? { AND: and }
      : {};
    const sort = (query.sort || 'latest') as VideoTemplateSort;
    const orderBy: Prisma.VideoTemplateOrderByWithRelationInput[] =
      sort === 'hot'
        ? [
            { useCount: 'desc' },
            { viewCount: 'desc' },
            { favoriteCount: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ]
        : sort === 'favorite'
          ? [
              { favoriteCount: 'desc' },
              { useCount: 'desc' },
              { createdAt: 'desc' },
              { id: 'desc' },
            ]
          : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [total, rows] = await Promise.all([
      this.prisma.videoTemplate.count({ where }),
      this.prisma.videoTemplate.findMany({
        where,
        orderBy,
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    const cards = await this.shapeCards(rows, user);
    return pageOf(cards, total, page.page, page.pageSize);
  }

  async detail(user: CurrentUser, id: number): Promise<VideoTemplateDetail> {
    const row = await this.visibleRow(id);
    return this.detailOf(row, user);
  }

  /** 付费查看入口：已解锁直接回详情；未解锁则原子扣分并落查看记录。 */
  async view(user: CurrentUser, id: number): Promise<VideoTemplateDetail> {
    const row = await this.visibleRow(id);
    if (row.source === 'AIWORKIN' || row.userId === user.userId) {
      await this.recordView(row.id, user.userId, 0);
      return this.detailOf(await this.visibleRow(id), user);
    }
    const existing = await this.prisma.videoTemplateView.findUnique({
      where: { userId_templateId: { userId: user.userId, templateId: row.id } },
    });
    if (existing) return this.detailOf(row, user);
    if (row.viewCost <= 0) {
      await this.recordView(row.id, user.userId, 0);
    } else {
      await this.payAndRecord(row, user);
    }
    return this.detailOf(await this.visibleRow(id), user);
  }

  // ---------------------------------------------------------------- 发布 / 删除

  async publish(
    user: CurrentUser,
    body: {
      title: string;
      description?: string;
      videoType?: string;
      sampleUrl: string;
      coverUrl?: string;
      referenceImages?: string[];
      prompt: string;
      modelChannelName?: string;
      modelName: string;
      viewCost?: number;
    },
  ): Promise<VideoTemplateDetail> {
    const row = await this.prisma.videoTemplate.create({
      data: {
        userId: user.userId,
        source: 'LOCAL',
        title: body.title.trim(),
        description: text(body.description).trim(),
        videoType: videoTypeOf(body.videoType),
        sampleUrl: body.sampleUrl.trim(),
        coverUrl: body.coverUrl?.trim() || '',
        referenceImages: toJsonInput(
          (body.referenceImages || []).map((url) => url.trim()).filter(Boolean),
        ),
        prompt: body.prompt.trim(),
        modelChannelName: text(body.modelChannelName).trim(),
        modelName: body.modelName.trim(),
        viewCost: Math.max(0, Math.trunc(Number(body.viewCost) || 0)),
      },
    });
    return this.detailOf(row, user);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.prisma.videoTemplate.findUnique({ where: { id } });
    if (!row || row.source === 'AIWORKIN') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模版不存在');
    }
    if (row.userId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己发布的模版',
      );
    }
    await this.prisma.$transaction([
      this.prisma.videoTemplateFavorite.deleteMany({
        where: { templateId: id },
      }),
      this.prisma.videoTemplateRating.deleteMany({ where: { templateId: id } }),
      this.prisma.videoTemplateView.deleteMany({ where: { templateId: id } }),
      this.prisma.videoTemplate.delete({ where: { id } }),
    ]);
    return { removed: true };
  }

  // ---------------------------------------------------------------- 收藏 / 评分

  async setFavorite(user: CurrentUser, id: number, on: boolean) {
    const row = await this.visibleRow(id);
    if (on) {
      const inserted = await this.prisma.videoTemplateFavorite.createMany({
        data: [{ userId: user.userId, templateId: row.id }],
        skipDuplicates: true,
      });
      if (inserted.count) {
        await this.prisma.videoTemplate.update({
          where: { id: row.id },
          data: { favoriteCount: { increment: 1 } },
        });
      }
    } else {
      const removed = await this.prisma.videoTemplateFavorite.deleteMany({
        where: { userId: user.userId, templateId: row.id },
      });
      if (removed.count) {
        // clamp：历史脏数据导致计数为 0 时不能减成负数
        await this.prisma.videoTemplate.updateMany({
          where: { id: row.id, favoriteCount: { gte: 1 } },
          data: { favoriteCount: { decrement: 1 } },
        });
      }
    }
    const fresh = await this.prisma.videoTemplate.findUnique({
      where: { id: row.id },
    });
    return {
      favorited: on,
      favoriteCount: Math.max(0, fresh?.favoriteCount ?? 0),
    };
  }

  async rate(user: CurrentUser, id: number, score: number) {
    const row = await this.visibleRow(id);
    const unlocked = await this.unlockedFor(row, user);
    if (!unlocked) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '先查看模版配方再评分');
    }
    const existing = await this.prisma.videoTemplateRating.findUnique({
      where: { userId_templateId: { userId: user.userId, templateId: row.id } },
    });
    if (!existing) {
      try {
        await this.prisma.$transaction([
          this.prisma.videoTemplateRating.create({
            data: { userId: user.userId, templateId: row.id, score },
          }),
          this.prisma.videoTemplate.update({
            where: { id: row.id },
            data: {
              ratingSum: { increment: score },
              ratingCount: { increment: 1 },
            },
          }),
        ]);
      } catch (error) {
        // 并发提交同一条评分：唯一键会拦住第二条，按「已评分」回读即可
        if (!isUniqueError(error)) throw error;
      }
    } else if (existing.score !== score) {
      await this.prisma.$transaction([
        this.prisma.videoTemplateRating.update({
          where: { id: existing.id },
          data: { score },
        }),
        this.prisma.videoTemplate.update({
          where: { id: row.id },
          data: { ratingSum: { increment: score - existing.score } },
        }),
      ]);
    }
    const fresh = await this.prisma.videoTemplate.findUnique({
      where: { id: row.id },
    });
    const mine = await this.prisma.videoTemplateRating.findUnique({
      where: { userId_templateId: { userId: user.userId, templateId: row.id } },
    });
    return {
      myRating: mine?.score ?? 0,
      ratingAvg: fresh?.ratingCount
        ? round1(fresh.ratingSum / fresh.ratingCount)
        : 0,
      ratingCount: fresh?.ratingCount ?? 0,
    };
  }

  // ---------------------------------------------------------------- 复刻生成

  async generate(
    user: CurrentUser,
    token: string | undefined,
    id: number,
    body: {
      prompt?: string;
      referenceImages?: string[];
      duration?: number;
      ratio?: string;
      resolution?: string;
      models: { video: { channelId: number; model: string } };
    },
  ) {
    const row = await this.visibleRow(id);
    if (!(await this.unlockedFor(row, user))) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '先查看模版配方再复刻');
    }
    const references = (
      body.referenceImages?.length
        ? body.referenceImages
        : imageList(row.referenceImages)
    ).slice(0, 6);
    const job = await this.jobs.create(user, token, {
      tool: 'video-ref',
      input: {
        prompt: text(body.prompt).trim() || row.prompt,
        references,
        duration: body.duration,
        ratio: body.ratio,
        resolution: body.resolution,
      },
      models: body.models,
    });
    const updated = await this.prisma.videoTemplate.update({
      where: { id: row.id },
      data: { useCount: { increment: 1 } },
    });
    return { jobId: job.id, useCount: updated.useCount };
  }

  // ---------------------------------------------------------------- 平台后台：AIworkin 开关与同步

  private async read(key: string) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value || '';
  }

  private async write(key: string, value: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async showAiworkin() {
    return (
      (await this.read(VideoTemplateService.SHOW_AIWORKIN_KEY)).trim() ===
      'true'
    );
  }

  private async syncMode(): Promise<VideoTemplateSyncMode> {
    const raw = (await this.read(VideoTemplateService.SYNC_MODE_KEY)).trim();
    return raw === 'MANUAL' ? 'MANUAL' : 'SCHEDULED';
  }

  private async intervalMinutes() {
    const value = Number(
      await this.read(VideoTemplateService.SYNC_INTERVAL_KEY),
    );
    return Number.isFinite(value) && value >= 5
      ? Math.min(Math.trunc(value), 1440)
      : 360;
  }

  async settings(): Promise<VideoTemplateSyncStatus> {
    const [showAiworkin, mode, intervalMinutes] = await Promise.all([
      this.showAiworkin(),
      this.syncMode(),
      this.intervalMinutes(),
    ]);
    let stored: Partial<VideoTemplateSyncStatus> = {};
    try {
      stored = (JSON.parse(
        await this.read(VideoTemplateService.SYNC_STATUS_KEY),
      ) || {}) as Partial<VideoTemplateSyncStatus>;
    } catch {
      stored = {};
    }
    return {
      showAiworkin,
      mode,
      intervalMinutes,
      lastSyncAt: text(stored.lastSyncAt),
      lastResult:
        (stored.lastResult as VideoTemplateSyncStatus['lastResult']) || '',
      lastError: text(stored.lastError),
      lastCount: Number(stored.lastCount) || 0,
    };
  }

  /**
   * 保存后台设置。首次勾选「显示 AIworkin 模版」时立即拉一次上游，
   * 让管理员马上看到结果；接口还没上线只记 SKIPPED，不抛错。
   */
  async saveSettings(
    input: {
      showAiworkin?: boolean;
      mode?: VideoTemplateSyncMode;
      intervalMinutes?: number;
    },
    token: string | undefined,
  ) {
    const before = await this.showAiworkin();
    if (input.showAiworkin !== undefined) {
      await this.write(
        VideoTemplateService.SHOW_AIWORKIN_KEY,
        input.showAiworkin ? 'true' : 'false',
      );
    }
    if (input.mode !== undefined) {
      await this.write(VideoTemplateService.SYNC_MODE_KEY, input.mode);
    }
    if (input.intervalMinutes !== undefined) {
      const value = Math.min(
        Math.max(Math.trunc(input.intervalMinutes), 5),
        1440,
      );
      await this.write(VideoTemplateService.SYNC_INTERVAL_KEY, String(value));
    }
    if (input.showAiworkin === true && !before) {
      await this.syncNow(token, 'ENABLE');
      return this.settings();
    }
    return this.settings();
  }

  /** 定时调度入口：按策略判断是否到点；没开或手动模式直接跳过。 */
  async syncIfDue() {
    const status = await this.settings();
    if (!status.showAiworkin || status.mode !== 'SCHEDULED') return status;
    const last = status.lastSyncAt ? Date.parse(status.lastSyncAt) : 0;
    const due = !last || Date.now() - last >= status.intervalMinutes * 60_000;
    if (!due) return status;
    return this.syncNow(videoTemplateSyncToken(), 'SCHEDULED');
  }

  /**
   * 立即同步：AIworkin 接口已就绪时按 `upstreamId` upsert 补充到列表；
   * 404 / 501 视为「上游还没上线」，写 SKIPPED 并保留提示，下次到点自动重试。
   */
  async syncNow(
    token: string | undefined,
    trigger: 'MANUAL' | 'SCHEDULED' | 'ENABLE' = 'MANUAL',
  ): Promise<VideoTemplateSyncStatus> {
    const at = new Date().toISOString();
    const base = await this.settings();
    const skipped = async (reason: string) => {
      const status: VideoTemplateSyncStatus = {
        ...base,
        lastSyncAt: at,
        lastResult: 'SKIPPED',
        lastError: reason,
        lastCount: 0,
      };
      await this.write(
        VideoTemplateService.SYNC_STATUS_KEY,
        JSON.stringify(status),
      );
      return this.settings();
    };
    if (trigger === 'SCHEDULED') {
      const current = await this.showAiworkin();
      if (!current) return this.settings();
    }
    if (!this.client.isEnabled()) {
      return skipped('AIworkin 通道已关闭（AIWORKIN_ENABLED=false）');
    }
    if (!token) {
      return skipped(
        trigger === 'SCHEDULED'
          ? '未配置平台级 AIWORKIN_VIDEO_TEMPLATE_TOKEN，无法定时拉取'
          : '未配置平台级 AIWORKIN_VIDEO_TEMPLATE_TOKEN（AIworkin 服务 Token），无法拉取上游',
      );
    }
    try {
      const items = await this.fetchUpstream(token);
      let count = 0;
      for (const item of items) {
        if (await this.upsertUpstream(item)) count += 1;
      }
      const status: VideoTemplateSyncStatus = {
        ...base,
        lastSyncAt: at,
        lastResult: 'SUCCESS',
        lastError: '',
        lastCount: count,
      };
      await this.write(
        VideoTemplateService.SYNC_STATUS_KEY,
        JSON.stringify(status),
      );
      logger.log(`AIworkin 模版同步完成：${count} 条（${trigger}）`);
      return this.settings();
    } catch (error) {
      const code =
        error instanceof BusinessException ? error.errorCode.code : 0;
      if (
        code === ErrorCode.NOT_FOUND.code ||
        code === ErrorCode.NOT_IMPLEMENTED.code
      ) {
        return skipped('AIworkin 平台模版接口尚未上线，上线后会自动接入');
      }
      const message =
        error instanceof BusinessException
          ? error.message
          : 'AIworkin 模版同步失败';
      const status: VideoTemplateSyncStatus = {
        ...base,
        lastSyncAt: at,
        lastResult: 'FAILED',
        lastError: message.slice(0, 300),
        lastCount: 0,
      };
      await this.write(
        VideoTemplateService.SYNC_STATUS_KEY,
        JSON.stringify(status),
      );
      logger.warn(`AIworkin 模版同步失败：${message}`);
      return this.settings();
    }
  }

  private async fetchUpstream(
    token: string,
  ): Promise<Record<string, unknown>[]> {
    const path = upstreamPath();
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= SYNC_MAX_PAGES; page += 1) {
      const payload = await this.client.request<unknown>(
        `${path}?page=${page}&pageSize=${SYNC_PAGE_SIZE}`,
        { token, retry: 0 },
      );
      const batch = this.upstreamBatch(payload);
      all.push(...batch);
      if (batch.length < SYNC_PAGE_SIZE) break;
    }
    return all;
  }

  /** 上游报文容忍三种常见形状：数组、{list}、{items}。 */
  private upstreamBatch(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object',
      );
    }
    if (payload && typeof payload === 'object') {
      const page = payload as Record<string, unknown>;
      const list = page.list ?? page.items ?? page.records;
      if (Array.isArray(list)) {
        return list.filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === 'object',
        );
      }
    }
    return [];
  }

  private async upsertUpstream(item: Record<string, unknown>) {
    const upstreamId = text(
      item.upstreamId ?? item.templateId ?? item.id,
    ).trim();
    const title = text(item.title ?? item.name)
      .trim()
      .slice(0, 200);
    const sampleUrl = text(item.sampleUrl ?? item.videoUrl ?? item.url).trim();
    const prompt = text(item.prompt).trim();
    if (!upstreamId || !title || !prompt || !/^https?:\/\//i.test(sampleUrl)) {
      return false;
    }
    const referenceImages = imageList(
      item.referenceImages ?? item.images ?? item.refImages,
    ).slice(0, 6);
    const videoType = videoTypeOf(item.videoType ?? item.type);
    const data = {
      userId: AIWORKIN_OWNER_ID,
      source: 'AIWORKIN',
      title,
      description: text(item.description ?? item.summary)
        .trim()
        .slice(0, 4000),
      videoType,
      sampleUrl,
      coverUrl: text(item.coverUrl ?? item.cover ?? item.coverImage).trim(),
      referenceImages: toJsonInput(referenceImages),
      prompt,
      modelChannelName: text(item.modelChannelName ?? item.channelName)
        .trim()
        .slice(0, 120),
      modelName: text(item.modelName ?? item.model)
        .trim()
        .slice(0, 200),
      viewCost: 0,
    };
    await this.prisma.videoTemplate.upsert({
      where: { upstreamId },
      create: { ...data, upstreamId },
      update: data,
    });
    return true;
  }

  // ---------------------------------------------------------------- 内部

  private async visibleRow(id: number) {
    const row = await this.prisma.videoTemplate.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '模版不存在');
    if (row.source === 'AIWORKIN' && !(await this.showAiworkin())) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模版不存在');
    }
    return row as TemplateRow;
  }

  private async unlockedFor(row: TemplateRow, user: CurrentUser) {
    if (row.source === 'AIWORKIN') return true;
    if (row.userId === user.userId) return true;
    if (row.viewCost <= 0) return true;
    const view = await this.prisma.videoTemplateView.findUnique({
      where: {
        userId_templateId: { userId: user.userId, templateId: row.id },
      },
    });
    return Boolean(view);
  }

  private async detailOf(
    row: TemplateRow,
    user: CurrentUser,
  ): Promise<VideoTemplateDetail> {
    const [ownerName, favorited, rating, unlocked] = await Promise.all([
      row.source === 'AIWORKIN'
        ? Promise.resolve(AIWORKIN_OWNER_NAME)
        : this.users.displayName(row.userId),
      this.prisma.videoTemplateFavorite
        .findUnique({
          where: {
            userId_templateId: { userId: user.userId, templateId: row.id },
          },
        })
        .then(Boolean),
      this.prisma.videoTemplateRating.findUnique({
        where: {
          userId_templateId: { userId: user.userId, templateId: row.id },
        },
      }),
      this.unlockedFor(row, user),
    ]);
    return {
      ...cardOf(
        row,
        ownerName,
        row.source !== 'AIWORKIN' && row.userId === user.userId,
        favorited,
        rating?.score ?? 0,
      ),
      description: row.description,
      locked: !unlocked,
      viewed: unlocked,
      sampleUrl: row.sampleUrl,
      prompt: unlocked ? row.prompt : '',
      referenceImages: unlocked ? imageList(row.referenceImages) : [],
      modelChannelName: unlocked ? row.modelChannelName : '',
      modelName: unlocked ? row.modelName : '',
      canManage: row.source !== 'AIWORKIN' && row.userId === user.userId,
    };
  }

  private async shapeCards(rows: TemplateRow[], user: CurrentUser) {
    if (!rows.length) return [] as VideoTemplateCard[];
    const ids = rows.map((row) => row.id);
    const localUserIds = rows
      .filter((row) => row.source !== 'AIWORKIN')
      .map((row) => row.userId);
    const [names, favorites, ratings] = await Promise.all([
      this.users.displayNames(localUserIds),
      this.prisma.videoTemplateFavorite.findMany({
        where: { userId: user.userId, templateId: { in: ids } },
        select: { templateId: true },
      }),
      this.prisma.videoTemplateRating.findMany({
        where: { userId: user.userId, templateId: { in: ids } },
        select: { templateId: true, score: true },
      }),
    ]);
    const favoriteSet = new Set(favorites.map((row) => row.templateId));
    const ratingMap = new Map(
      ratings.map((row) => [row.templateId, row.score]),
    );
    return rows.map((row) =>
      cardOf(
        row,
        row.source === 'AIWORKIN'
          ? AIWORKIN_OWNER_NAME
          : names.get(row.userId) || row.userId,
        row.source !== 'AIWORKIN' && row.userId === user.userId,
        favoriteSet.has(row.id),
        ratingMap.get(row.id) ?? 0,
      ),
    );
  }

  /** 免费查看 / 发布者本人：只记一行查看记录，按新增条数累加浏览数。 */
  private async recordView(templateId: number, userId: string, points: number) {
    const inserted = await this.prisma.videoTemplateView.createMany({
      data: [{ userId, templateId, points }],
      skipDuplicates: true,
    });
    if (inserted.count) {
      await this.prisma.videoTemplate.update({
        where: { id: templateId },
        data: { viewCount: { increment: 1 } },
      });
    }
  }

  /**
   * 付费查看：一个事务完成「查重 + 扣分 + 入账 + 两条流水 + 浏览数」。
   * 唯一键冲突说明另一个并发请求已经付过，整笔回滚后按已查看处理。
   */
  private async payAndRecord(row: TemplateRow, user: CurrentUser) {
    const cost = row.viewCost;
    const ownerId = row.userId;
    await this.points.ensureAccount(user.userId);
    await this.points.ensureAccount(ownerId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.videoTemplateView.create({
          data: { userId: user.userId, templateId: row.id, points: cost },
        });
        const paid = await tx.pointAccount.updateMany({
          where: {
            userId: user.userId,
            balanceAmount: { gte: cost },
          },
          data: {
            balanceAmount: { decrement: cost },
            totalSpendAmount: { increment: cost },
          },
        });
        if (paid.count === 0) {
          throw new BusinessException(ErrorCode.POINTS_INSUFFICIENT);
        }
        const viewer = await tx.pointAccount.findUniqueOrThrow({
          where: { userId: user.userId },
        });
        await tx.pointTransaction.create({
          data: {
            userId: user.userId,
            type: 'SPEND',
            scene: '视频模版查看',
            amount: -cost,
            balanceAmount: viewer.balanceAmount,
            counterparty: ownerId,
            refType: 'video_template',
            refId: String(row.id),
            remark: `查看模版「${row.title}」`,
          },
        });
        const owner = await tx.pointAccount.update({
          where: { userId: ownerId },
          data: {
            balanceAmount: { increment: cost },
            totalEarnAmount: { increment: cost },
          },
        });
        await tx.pointTransaction.create({
          data: {
            userId: ownerId,
            type: 'EARN',
            scene: '视频模版被查看',
            amount: cost,
            balanceAmount: owner.balanceAmount,
            counterparty: user.userId,
            refType: 'video_template',
            refId: String(row.id),
            remark: `「${row.title}」被查看`,
          },
        });
        await tx.videoTemplate.update({
          where: { id: row.id },
          data: { viewCount: { increment: 1 } },
        });
      });
    } catch (error) {
      if (isUniqueError(error)) return;
      throw error;
    }
  }
}
