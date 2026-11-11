import { pageOf, pageParam, text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ExtensionCatalogService } from '../platform/extension-catalog.service';
import {
  DistributionContent,
  DistributionPublishLog,
} from '../../generated/prisma';
import { EXTENSION_RELEASE } from './extension-release';
import type { BrowserTaskService } from '../platform/browser-task.service';
import {
  DISTRIBUTION_MEDIA_TYPE_LABELS,
  DISTRIBUTION_LOG_STATUS_LABELS,
  DISTRIBUTION_CONTENT_STATUS_LABELS,
  DISTRIBUTION_CONTENT_VISIBLE_MAX,
  DISTRIBUTION_PLATFORMS,
  distributionEndpoints,
  looksLikeRichHtml,
  plainTextToRichHtml,
  richTextVisibleLength,
  sanitizeRichTextHtml,
  type BrowserResultStatus,
} from '@enterprise/contracts';

/** 内容资产统计（D8 效果回流聚合）：逐平台效果之和 + 最近回写时间。 */
type MetricsAgg = {
  views: number;
  likes: number;
  comments: number;
  last: Date | null;
};

/**
 * 多平台内容分发（营销工具）：内容台账在服务器落库，实际发布由 AIPDD Enterprise
 * 浏览器插件在本地完成（复用浏览器已登录的媒体平台会话，账号凭据不出本机）。
 * 平台注册表复用契约 DISTRIBUTION_PLATFORMS，前端勾选清单、meta 接口与插件按 code 对齐。
 * 正文统一存「受限 HTML」（见契约 rich-text.ts）：支持样式的文章渠道直接投递，
 * 不支持样式的渠道由插件投递前降纯文本（简书降 Markdown）。
 */

/**
 * 插件发布信息（版本/下载路径）：与顶部统一插件入口同源，见 extension-release.ts。
 * v1.3.0 起同一个插件同时承担分发与 AI 获客（采集/触达），v1.4.0 再加本地 Chrome 控制；始终不是第二个插件。
 */
export const EXTENSION_INFO = {
  name: EXTENSION_RELEASE.name,
  version: EXTENSION_RELEASE.version,
  downloadPath: EXTENSION_RELEASE.downloadPath,
  chromeStoreUrl: EXTENSION_RELEASE.chromeStoreUrl,
};

const platformByCode = new Map(
  DISTRIBUTION_PLATFORMS.map((platform) => [platform.code, platform]),
);

function labelOf(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

function isoOf(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** 效果抓取时间：缺省或非法一律按当前时间落库，避免插件传坏串把列写坏。 */
function parseCapturedAt(raw: string | undefined): Date {
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** JSON 列 → 图片清单：脏数据按 name/url 文本兜底，非对象条目丢弃。 */
function imagesOf(value: unknown): { name: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name: readText((item as Record<string, unknown>)['name']),
      url: readText((item as Record<string, unknown>)['url']),
    }))
    .filter((image) => image.url !== '');
}

function codesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readText(item)).filter((item) => item !== '');
}

/** 浏览器任务来源锚：与内容台账一一对应，同一内容同时只保留一条在办任务。 */
function sourceOf(contentId: number): string {
  return `distribution:#${contentId}`;
}

/**
 * 分发结果口径 → 统一浏览器结果口径（设计 §17 三态严格区分）：
 * SUCCESS＝插件点了发布但结果未核实，落 SUBMITTED；FILLED＝已填充待确认；
 * 其余（失败/未知）落 FAILED，不冒充成功。
 */
function browserResultStatusOf(status: string): BrowserResultStatus {
  if (status === 'SUCCESS') return 'SUBMITTED';
  if (status === 'FILLED') return 'FILLED';
  return 'FAILED';
}

/**
 * 正文落库前的归一与清洗（安全边界在这里，不在前端）：
 * - 富文本串按标签/属性白名单重写，脚本、事件属性、javascript: 链接全剥掉——
 *   这段 HTML 会被插件投递到第三方平台页面，也会被本页预览；
 * - 纯文本（老调用方 / MCP 直传）转成 <p>/<br>，保证插件侧只处理一种形态；
 * - 额度按可见字数卡，不让样式标记撑爆平台正文上限。
 */
function contentForSave(raw: string): string {
  const text = raw.trim();
  const html = looksLikeRichHtml(text)
    ? sanitizeRichTextHtml(text)
    : plainTextToRichHtml(text);
  const visible = richTextVisibleLength(html);
  if (visible === 0) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '正文没有可发布的内容（只剩样式标记或含非法代码）',
    );
  }
  if (visible > DISTRIBUTION_CONTENT_VISIBLE_MAX) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `正文超出 ${DISTRIBUTION_CONTENT_VISIBLE_MAX} 字（当前 ${visible} 字）`,
    );
  }
  return html;
}

export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ExtensionCatalogService,
    private readonly browserTask: BrowserTaskService,
  ) {}

  // ---------- 平台与插件元信息 ----------

  meta() {
    return {
      platforms: DISTRIBUTION_PLATFORMS.map((platform) => ({
        code: platform.code,
        name: platform.name,
        mediaType: platform.mediaType,
        mediaTypeLabel: labelOf(
          DISTRIBUTION_MEDIA_TYPE_LABELS,
          platform.mediaType,
        ),
        publishUrl: platform.publishUrl,
        homepage: platform.homepage,
      })),
      extension: EXTENSION_INFO,
    };
  }

  // ---------- 内容台账 ----------

  async list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      mediaType?: string;
      status?: string;
      keyword?: string;
    },
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const keyword = readText(query.keyword).trim();
    const where = {
      userId: user.userId,
      ...(query.mediaType ? { mediaType: query.mediaType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(keyword ? { title: { contains: keyword } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.distributionContent.count({ where }),
      this.prisma.distributionContent.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const aggs = await this.metricsAggOf(rows.map((row) => row.id));
    return pageOf(
      rows.map((row) => this.viewOf(row, aggs.get(row.id))),
      total,
      page,
      pageSize,
    );
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const input = distributionEndpoints.Distribution_create.body.parse(body);
    this.assertPlatforms(input.mediaType, input.platformCodes);
    const row = await this.prisma.distributionContent.create({
      data: {
        userId: user.userId,
        title: input.title.trim(),
        content: contentForSave(input.content),
        mediaType: input.mediaType,
        images: input.images,
        platformCodes: input.platformCodes,
        autoPublish: input.autoPublish,
        tags: input.tags.trim(),
      },
    });
    return this.viewOf(row, { views: 0, likes: 0, comments: 0, last: null });
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const input = distributionEndpoints.Distribution_update.body.parse(body);
    const row = await this.mustGet(user, id);
    const mediaType = input.mediaType ?? row.mediaType;
    const platformCodes = input.platformCodes ?? codesOf(row.platformCodes);
    this.assertPlatforms(mediaType, platformCodes);
    const updated = await this.prisma.distributionContent.update({
      where: { id: row.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.content !== undefined
          ? { content: contentForSave(input.content) }
          : {}),
        ...(input.mediaType !== undefined
          ? { mediaType: input.mediaType }
          : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.platformCodes !== undefined
          ? { platformCodes: input.platformCodes }
          : {}),
        ...(input.autoPublish !== undefined
          ? { autoPublish: input.autoPublish }
          : {}),
        ...(input.tags !== undefined ? { tags: input.tags.trim() } : {}),
      },
    });
    return this.viewOf(updated, await this.aggOfOne(updated.id));
  }

  async detail(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    const logs = await this.prisma.distributionPublishLog.findMany({
      where: { contentId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      content: this.viewOf(row, await this.aggOfOne(row.id)),
      logs: logs.map((log) => this.logOf(log)),
    };
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.distributionPublishLog.deleteMany({
        where: { contentId: row.id },
      });
      await tx.distributionContent.delete({ where: { id: row.id } });
    });
    // 内容删除即取消该内容的在办任务（§10.3 业务侧取消）：插件再回执也挂不到已删内容上。
    await this.browserTask.cancelBySource(
      user.userId,
      'distribution',
      sourceOf(row.id),
    );
    return { removed: true };
  }

  // ---------- 分发与结果回写 ----------

  /** 页面把内容推给插件（剪贴板/消息投递）后调用：状态置为已分发并留推送时间。 */
  async mark(user: CurrentUser, id: number, pluginVersion?: string) {
    const row = await this.mustGet(user, id);
    const codes = codesOf(row.platformCodes);
    // 服务器落一条持久浏览器任务并认领租约（§10.3 / §10.7）：能力门槛（下线/灰度/最低版本）
    // 由任务服务统一校验；页面关闭或插件失联时任务不丢，逐平台结果回写时终结任务。
    // 同内容重复分发会把旧的未终结任务按 EXPIRED 收尾，不重复占位。
    await this.browserTask.dispatch(user, {
      capability: 'distribution',
      action: row.autoPublish ? 'publish' : 'fill',
      platforms: codes,
      source: sourceOf(row.id),
      // 载荷与前端 distributeViaExtension 的 DistributePayload 同构：契约对 fill/publish
      // 声明了必填的 title/content，派发前统一校验会拦缺字段，故这里按台账补全（images 可空）。
      payload: {
        contentId: row.id,
        title: row.title,
        content: row.content,
        images: imagesOf(row.images),
        platformCodes: codes,
        autoPublish: row.autoPublish,
      },
      pluginVersion: readText(pluginVersion),
    });
    const updated = await this.prisma.distributionContent.update({
      where: { id: row.id },
      data: { status: 'DISTRIBUTED', lastDistributedAt: new Date() },
    });
    return this.viewOf(updated, await this.aggOfOne(updated.id));
  }

  /**
   * 回写逐平台发布结果：同一内容同一平台只保留最新一条（重复上报覆盖），
   * EXTENSION＝插件回调，MANUAL＝人工补记；MCP 通道经 Distribution_reportLogs 同样可调。
   */
  async reportLogs(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const input =
      distributionEndpoints.Distribution_reportLogs.body.parse(body);
    const row = await this.mustGet(user, id);
    const allowed = new Set(codesOf(row.platformCodes));
    for (const log of input.logs) {
      if (!platformByCode.has(log.platformCode)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `不支持的平台编码：${log.platformCode}`,
        );
      }
      // 只能回写该内容实际勾选的平台，防止伪造日志把结果记到未勾的平台行上。
      if (!allowed.has(log.platformCode)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `平台「${log.platformCode}」未在该内容勾选，拒写回`,
        );
      }
    }
    const result: DistributionPublishLog[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const log of input.logs) {
        const existing = await tx.distributionPublishLog.findFirst({
          where: { contentId: row.id, platformCode: log.platformCode },
          orderBy: { id: 'desc' },
        });
        const data = {
          contentId: row.id,
          userId: row.userId,
          platformCode: log.platformCode,
          platformName:
            platformByCode.get(log.platformCode)?.name ?? log.platformCode,
          status: log.status,
          publishedUrl: log.publishedUrl.trim(),
          errorMsg: log.errorMsg.trim(),
          source: input.source,
        };
        if (existing) {
          result.push(
            await tx.distributionPublishLog.update({
              where: { id: existing.id },
              data: {
                status: data.status,
                publishedUrl: data.publishedUrl,
                errorMsg: data.errorMsg,
                source: data.source,
              },
            }),
          );
        } else {
          result.push(await tx.distributionPublishLog.create({ data }));
        }
      }
    });
    // 逐平台结果回写即任务回执：把结果挂到该内容的在办任务上，终结持久队列（§10.3）。
    // 人工补记时通常无在办任务（openForSource 返回 null），此处自然跳过。
    const open = await this.browserTask.openForSource(
      user.userId,
      'distribution',
      sourceOf(row.id),
    );
    if (open) {
      await this.browserTask.report(user, open.id, {
        results: result.map((log) => ({
          platform: log.platformCode,
          status: browserResultStatusOf(log.status),
          url: log.publishedUrl,
        })),
        evidence: result
          .filter((log) => log.publishedUrl !== '')
          .map((log) => ({
            kind: 'URL',
            value: log.publishedUrl,
            note: log.platformName,
          })),
      });
    }
    return result.map((log) => this.logOf(log));
  }

  /**
   * 回写分发效果（D8）：插件从平台创作中心读阅读/点赞/评论后上报，也可人工补录。
   * 同一内容同一平台只有一行结果（reportLogs 建立），这里按「内容+平台」定位并覆盖效果列；
   * 该平台尚无结果行（如人工补录效果却漏记发布）时按当前时间补建一行 FILLED，
   * publishedItemId 记录平台作品标识，重复上报天然幂等。
   */
  async reportMetrics(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const input =
      distributionEndpoints.Distribution_reportMetrics.body.parse(body);
    const row = await this.mustGet(user, id);
    const allowed = new Set(codesOf(row.platformCodes));
    for (const item of input.metrics) {
      if (!platformByCode.has(item.platformCode)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `不支持的平台编码：${item.platformCode}`,
        );
      }
      // 与 reportLogs 同一护栏：只能回写该内容实际勾选的平台，防止伪造效果记到未勾的平台行。
      if (!allowed.has(item.platformCode)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `平台「${item.platformCode}」未在该内容勾选，拒写回`,
        );
      }
    }
    const result: DistributionPublishLog[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const item of input.metrics) {
        const capturedAt = parseCapturedAt(item.capturedAt);
        const data = {
          publishedItemId: item.publishedItemId.trim(),
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          metricsSource: input.source,
          metricsCapturedAt: capturedAt,
        };
        const existing = await tx.distributionPublishLog.findFirst({
          where: { contentId: row.id, platformCode: item.platformCode },
          orderBy: { id: 'desc' },
        });
        if (existing) {
          result.push(
            await tx.distributionPublishLog.update({
              where: { id: existing.id },
              data,
            }),
          );
        } else {
          result.push(
            await tx.distributionPublishLog.create({
              data: {
                contentId: row.id,
                userId: row.userId,
                platformCode: item.platformCode,
                platformName:
                  platformByCode.get(item.platformCode)?.name ??
                  item.platformCode,
                status: 'FILLED',
                publishedUrl: '',
                errorMsg: '',
                source: input.source,
                ...data,
              },
            }),
          );
        }
      }
    });
    return result.map((log) => this.logOf(log));
  }

  // ---------- 内部 ----------

  /** 一批内容的效果聚合（按 contentId 分组求和 views/likes/comments，并取最近回写时间）。 */
  private async metricsAggOf(ids: number[]): Promise<Map<number, MetricsAgg>> {
    const map = new Map<number, MetricsAgg>();
    if (!ids.length) return map;
    const grouped = await this.prisma.distributionPublishLog.groupBy({
      by: ['contentId'],
      where: { contentId: { in: ids } },
      _sum: { views: true, likes: true, comments: true },
      _max: { metricsCapturedAt: true },
    });
    for (const item of grouped) {
      map.set(item.contentId, {
        views: item._sum.views ?? 0,
        likes: item._sum.likes ?? 0,
        comments: item._sum.comments ?? 0,
        last: item._max.metricsCapturedAt ?? null,
      });
    }
    return map;
  }

  private async aggOfOne(id: number): Promise<MetricsAgg> {
    const map = await this.metricsAggOf([id]);
    return map.get(id) ?? { views: 0, likes: 0, comments: 0, last: null };
  }

  private async mustGet(
    user: CurrentUser,
    id: number,
  ): Promise<DistributionContent> {
    const row = await this.prisma.distributionContent.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '分发内容不存在或已删除',
      );
    }
    return row;
  }

  /** 平台编码必须已登记，且与内容类型匹配（动态只能发 MOMENT 平台，文章同理）。 */
  private assertPlatforms(mediaType: string, platformCodes: string[]) {
    for (const code of platformCodes) {
      const platform = platformByCode.get(code);
      if (!platform) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `不支持的平台：${code}`,
        );
      }
      if (platform.mediaType !== mediaType) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `平台「${platform.name}」不支持该内容类型，请换 ${labelOf(
            DISTRIBUTION_MEDIA_TYPE_LABELS,
            mediaType,
          )} 对应平台`,
        );
      }
    }
  }

  private viewOf(row: DistributionContent, agg?: MetricsAgg) {
    const codes = codesOf(row.platformCodes);
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      mediaType: row.mediaType,
      mediaTypeLabel: labelOf(DISTRIBUTION_MEDIA_TYPE_LABELS, row.mediaType),
      images: imagesOf(row.images),
      platformCodes: codes,
      platformNames: codes.map(
        (code) => platformByCode.get(code)?.name ?? code,
      ),
      autoPublish: row.autoPublish,
      status: row.status,
      statusLabel: labelOf(DISTRIBUTION_CONTENT_STATUS_LABELS, row.status),
      tags: row.tags,
      lastDistributedAt: isoOf(row.lastDistributedAt),
      totalViews: agg?.views ?? 0,
      totalLikes: agg?.likes ?? 0,
      totalComments: agg?.comments ?? 0,
      lastMetricsAt: isoOf(agg?.last ?? null),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private logOf(row: DistributionPublishLog) {
    return {
      id: row.id,
      contentId: row.contentId,
      platformCode: row.platformCode,
      platformName: row.platformName,
      status: row.status,
      statusLabel: labelOf(DISTRIBUTION_LOG_STATUS_LABELS, row.status),
      publishedUrl: row.publishedUrl,
      publishedItemId: row.publishedItemId,
      errorMsg: row.errorMsg,
      source: row.source,
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      metricsSource: row.metricsSource,
      metricsCapturedAt: isoOf(row.metricsCapturedAt),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
