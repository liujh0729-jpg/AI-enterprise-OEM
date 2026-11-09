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
  isoOr,
  Row,
  safeStatus,
} from './gaps.helpers';

const CATEGORIES = ['SERVICE', 'PRIVACY', 'REGISTRATION', 'OTHER'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  SERVICE: '服务协议',
  PRIVACY: '隐私政策',
  REGISTRATION: '注册协议',
  OTHER: '其他条款',
};
const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

type DocRow = {
  id: number;
  code: string;
  version: string;
  title: string;
  category: string;
  content: string;
  requireReaccept: boolean;
  effectiveAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * B3#26 条款接受留痕：条款按 code + version 存版本；发布新版本时同 code 旧版本自动归档，
 * 待办只认「每个 code 的最新 ACTIVE 版本」，接受记录写版本/时间/IP/UA。
 */
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private baseView(row: DocRow, acceptedCount: number, myAccepted: boolean) {
    return {
      id: row.id,
      code: row.code,
      version: row.version,
      title: row.title,
      category: row.category,
      categoryLabel: CATEGORY_LABELS[row.category] || row.category,
      content: row.content,
      requireReaccept: row.requireReaccept,
      effectiveAt: isoOr(row.effectiveAt),
      status: row.status,
      acceptedCount,
      myAccepted,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async documents(user: CurrentUser, query: Row) {
    const admin = this.scope.platformAdmin(user);
    const status = asText(query.status).trim().toUpperCase();
    const category = asText(query.category).trim().toUpperCase();
    const rows = await this.prisma.termsDocument.findMany({
      where: {
        ...(admin ? {} : { status: 'ACTIVE' }),
        ...(status && (admin || status === 'ACTIVE') ? { status } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
    });
    const [counts, mine] = await Promise.all([
      this.prisma.termsAcceptance.groupBy({
        by: ['code', 'version'],
        _count: { _all: true },
      }),
      this.prisma.termsAcceptance.findMany({
        where: { userId: user.userId },
        select: { code: true, version: true },
      }),
    ]);
    const countMap = new Map(
      counts.map((row) => [`${row.code}@${row.version}`, row._count._all]),
    );
    const mineSet = new Set(mine.map((row) => `${row.code}@${row.version}`));
    return rows.map((row) =>
      this.baseView(
        row,
        countMap.get(`${row.code}@${row.version}`) || 0,
        mineSet.has(`${row.code}@${row.version}`),
      ),
    );
  }

  async saveDocument(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const id = asInt(body.id);
    const code = asText(body.code).trim().toUpperCase().slice(0, 32);
    const version = asText(body.version).trim().slice(0, 24);
    const title = clip(body.title, 160).trim();
    const content = asText(body.content);
    if (code.length < 2)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写条款编码');
    if (!version)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写版本号');
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写条款标题');
    if (!content.trim())
      throw new BusinessException(ErrorCode.BAD_REQUEST, '条款正文不能为空');
    const data = {
      code,
      version,
      title,
      category: safeStatus(body.category, CATEGORIES, 'SERVICE'),
      content,
      requireReaccept: body.requireReaccept !== false,
      effectiveAt: asDate(body.effectiveAt),
      status: safeStatus(body.status, STATUSES, 'DRAFT'),
      createdBy: user.userId,
    };
    const existing = id
      ? await this.prisma.termsDocument.findUnique({ where: { id } })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '条款不存在');
    const conflict = await this.prisma.termsDocument.findUnique({
      where: { code_version: { code, version } },
    });
    if (conflict && conflict.id !== existing?.id) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '同编码、同版本号的条款已存在',
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (data.status === 'ACTIVE') {
        await tx.termsDocument.updateMany({
          where: {
            code,
            status: 'ACTIVE',
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { status: 'ARCHIVED' },
        });
      }
      if (existing) {
        return tx.termsDocument.update({
          where: { id: existing.id },
          data: { ...data, createdBy: existing.createdBy },
        });
      }
      return tx.termsDocument.create({ data });
    });
    const acceptedCount = await this.prisma.termsAcceptance.count({
      where: { code: row.code, version: row.version },
    });
    return this.baseView(row, acceptedCount, false);
  }

  async removeDocument(user: CurrentUser, idRaw: number) {
    this.scope.requirePlatformAdmin(user);
    const row = await this.prisma.termsDocument.findUnique({
      where: { id: asInt(idRaw) },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '条款不存在');
    await this.prisma.$transaction([
      this.prisma.termsAcceptance.deleteMany({
        where: { code: row.code, version: row.version },
      }),
      this.prisma.termsDocument.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  async accept(
    user: CurrentUser,
    body: Row,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const code = asText(body.code).trim().toUpperCase();
    const version = asText(body.version).trim();
    const doc = await this.prisma.termsDocument.findUnique({
      where: { code_version: { code, version } },
    });
    if (!doc || doc.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '条款不存在或未生效');
    }
    const row = await this.prisma.termsAcceptance.upsert({
      where: { userId_code_version: { userId: user.userId, code, version } },
      create: {
        documentId: doc.id,
        code,
        version,
        userId: user.userId,
        ip: clip(meta.ip, 64),
        userAgent: clip(meta.userAgent, 300),
      },
      update: {
        ip: clip(meta.ip, 64),
        userAgent: clip(meta.userAgent, 300),
        acceptedAt: new Date(),
      },
    });
    return {
      id: row.id,
      code: row.code,
      version: row.version,
      title: doc.title,
      acceptedAt: iso(row.acceptedAt),
      ip: row.ip,
    };
  }

  async my(user: CurrentUser) {
    const rows = await this.prisma.termsAcceptance.findMany({
      where: { userId: user.userId },
      orderBy: { acceptedAt: 'desc' },
    });
    const titles = await this.prisma.termsDocument.findMany({
      where: { code: { in: [...new Set(rows.map((row) => row.code))] } },
      select: { code: true, version: true, title: true },
    });
    const titleMap = new Map(
      titles.map((row) => [`${row.code}@${row.version}`, row.title]),
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      version: row.version,
      title: titleMap.get(`${row.code}@${row.version}`) || row.code,
      acceptedAt: iso(row.acceptedAt),
      ip: row.ip,
    }));
  }

  async pending(user: CurrentUser) {
    const docs = await this.prisma.termsDocument.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ code: 'asc' }, { effectiveAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, DocRow>();
    for (const doc of docs)
      if (!latest.has(doc.code)) latest.set(doc.code, doc);
    const accepted = await this.prisma.termsAcceptance.findMany({
      where: { userId: user.userId },
      select: { code: true, version: true },
    });
    const acceptedSet = new Set(
      accepted.map((row) => `${row.code}@${row.version}`),
    );
    return [...latest.values()]
      .filter((doc) => !acceptedSet.has(`${doc.code}@${doc.version}`))
      .map((doc) => this.baseView(doc, 0, false));
  }

  /** 登录/注册页的公开读取：只返回最新 ACTIVE，正文与版本号。 */
  async publicLatest(code: string) {
    const doc = await this.prisma.termsDocument.findFirst({
      where: {
        code: String(code || '')
          .trim()
          .toUpperCase(),
        status: 'ACTIVE',
      },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
    });
    if (!doc) throw new BusinessException(ErrorCode.NOT_FOUND, '条款不存在');
    return {
      id: doc.id,
      code: doc.code,
      version: doc.version,
      title: doc.title,
      category: doc.category,
      categoryLabel: CATEGORY_LABELS[doc.category] || doc.category,
      content: doc.content,
      requireReaccept: doc.requireReaccept,
      effectiveAt: isoOr(doc.effectiveAt),
    };
  }
}
