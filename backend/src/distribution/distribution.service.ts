import { pageOf, pageParam, text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { DistributionContent, DistributionPublishLog } from '../../generated/prisma';
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
} from '@enterprise/contracts';

/**
 * 多平台内容分发（营销工具）：内容台账在服务器落库，实际发布由 AIPDD Enterprise
 * 浏览器插件在本地完成（复用浏览器已登录的媒体平台会话，账号凭据不出本机）。
 * 平台注册表复用契约 DISTRIBUTION_PLATFORMS，前端勾选清单、meta 接口与插件按 code 对齐。
 * 正文统一存「受限 HTML」（见契约 rich-text.ts）：支持样式的文章渠道直接投递，
 * 不支持样式的渠道由插件投递前降纯文本（简书降 Markdown）。
 */

/** 插件发布信息：zip 由前端 public 静态目录分发，上架商店后补 chromeStoreUrl。 */
const EXTENSION_INFO = {
  name: 'AIPDD Enterprise',
  version: '1.2.0',
  downloadPath: '/downloads/aipdd-enterprise-v1.2.0.zip',
  chromeStoreUrl: '',
};

const platformByCode = new Map(
  DISTRIBUTION_PLATFORMS.map((platform) => [platform.code, platform]),
);

function labelOf(
  labels: Record<string, string>,
  value: string,
): string {
  return labels[value] ?? value;
}

function isoOf(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 平台与插件元信息 ----------

  async meta(_user: CurrentUser) {
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
    return pageOf(rows.map((row) => this.viewOf(row)), total, page, pageSize);
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
    return this.viewOf(row);
  }

  async update(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
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
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
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
    return this.viewOf(updated);
  }

  async detail(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    const logs = await this.prisma.distributionPublishLog.findMany({
      where: { contentId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    return { content: this.viewOf(row), logs: logs.map((log) => this.logOf(log)) };
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.distributionPublishLog.deleteMany({ where: { contentId: row.id } });
      await tx.distributionContent.delete({ where: { id: row.id } });
    });
    return { removed: true };
  }

  // ---------- 分发与结果回写 ----------

  /** 页面把内容推给插件（剪贴板/消息投递）后调用：状态置为已分发并留推送时间。 */
  async mark(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    const updated = await this.prisma.distributionContent.update({
      where: { id: row.id },
      data: { status: 'DISTRIBUTED', lastDistributedAt: new Date() },
    });
    return this.viewOf(updated);
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
    const input = distributionEndpoints.Distribution_reportLogs.body.parse(
      body,
    );
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
          platformName: platformByCode.get(log.platformCode)?.name ?? log.platformCode,
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
          result.push(
            await tx.distributionPublishLog.create({ data }),
          );
        }
      }
    });
    return result.map((log) => this.logOf(log));
  }

  // ---------- 内部 ----------

  private async mustGet(
    user: CurrentUser,
    id: number,
  ): Promise<DistributionContent> {
    const row = await this.prisma.distributionContent.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '分发内容不存在或已删除');
    }
    return row;
  }

  /** 平台编码必须已登记，且与内容类型匹配（动态只能发 MOMENT 平台，文章同理）。 */
  private assertPlatforms(mediaType: string, platformCodes: string[]) {
    for (const code of platformCodes) {
      const platform = platformByCode.get(code);
      if (!platform) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, `不支持的平台：${code}`);
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

  private viewOf(row: DistributionContent) {
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
      errorMsg: row.errorMsg,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
