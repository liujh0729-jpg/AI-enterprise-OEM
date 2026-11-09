import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import {
  asDate,
  asInt,
  asText,
  clip,
  iso,
  pageParams,
  Row,
  safeStatus,
} from './gaps.helpers';

const CATEGORIES = ['PRODUCT', 'MODULE', 'FIX', 'SECURITY'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  PRODUCT: '产品功能',
  MODULE: '模块更新',
  FIX: '问题修复',
  SECURITY: '安全更新',
};

type EntryRow = {
  id: number;
  version: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  releasedAt: Date;
  status: string;
  createdAt: Date;
};

/**
 * B3#28 产品更新日志：平台统一维护，按版本 + 分类唯一；未发布（DRAFT）仅管理员可见。
 */
export class ChangelogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private view(row: EntryRow) {
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      body: row.body,
      category: row.category,
      categoryLabel: CATEGORY_LABELS[row.category] || row.category,
      releasedAt: iso(row.releasedAt),
      status: row.status,
      createdAt: iso(row.createdAt),
    };
  }

  async entries(user: CurrentUser, query: Row) {
    const admin = this.scope.platformAdmin(user);
    const { page, pageSize, offset } = pageParams(query);
    const status = asText(query.status).trim().toUpperCase();
    const where = {
      ...(admin ? (status ? { status } : {}) : { status: 'PUBLISHED' }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.helpChangelog.findMany({
        where,
        orderBy: [{ releasedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.helpChangelog.count({ where }),
    ]);
    return { list: rows.map((row) => this.view(row)), total, page, pageSize };
  }

  async save(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const id = asInt(body.id);
    const version = clip(body.version, 32).trim();
    const title = clip(body.title, 160).trim();
    if (!version)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写版本号');
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写更新标题');
    const data = {
      version,
      title,
      summary: asText(body.summary).slice(0, 5000),
      body: asText(body.body).slice(0, 100_000),
      category: safeStatus(body.category, CATEGORIES, 'PRODUCT'),
      releasedAt: asDate(body.releasedAt) || new Date(),
      status: safeStatus(
        body.status,
        ['DRAFT', 'PUBLISHED'] as const,
        'PUBLISHED',
      ),
      createdBy: user.userId,
    };
    const existing = id
      ? await this.prisma.helpChangelog.findUnique({ where: { id } })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '更新记录不存在');
    const conflict = await this.prisma.helpChangelog.findUnique({
      where: { version_category: { version, category: data.category } },
    });
    if (conflict && conflict.id !== existing?.id) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '同版本、同分类的更新记录已存在',
      );
    }
    const row = existing
      ? await this.prisma.helpChangelog.update({
          where: { id: existing.id },
          data: { ...data, createdBy: existing.createdBy },
        })
      : await this.prisma.helpChangelog.create({ data });
    return this.view(row);
  }

  async remove(user: CurrentUser, idRaw: number) {
    this.scope.requirePlatformAdmin(user);
    const row = await this.prisma.helpChangelog.findUnique({
      where: { id: asInt(idRaw) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '更新记录不存在');
    await this.prisma.helpChangelog.delete({ where: { id: row.id } });
    return { removed: true };
  }
}
