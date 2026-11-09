import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmScopeService } from '../crm/crm.scope';
import type { CrmContext } from '../crm/crm.scope';
import { buildPdf, type PdfLine } from './pdf';
import {
  asInt,
  asText,
  clip,
  iso,
  pageParams,
  publicUrlOf,
  randomToken,
  Row,
} from './gaps.helpers';

const TEMPLATES = ['CLASSIC', 'MODERN', 'MINIMAL'] as const;
type TemplateCode = (typeof TEMPLATES)[number];

const ACCENT: Record<TemplateCode, [number, number, number]> = {
  CLASSIC: [0.12, 0.22, 0.4],
  MODERN: [0.05, 0.45, 0.38],
  MINIMAL: [0.15, 0.15, 0.15],
};

const money = (value: unknown): string =>
  `¥ ${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const dateText = (value: Date | null | undefined): string =>
  value instanceof Date
    ? new Date(value.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
    : '';

/**
 * B3#18 报价单模板化 PDF 与发送跟踪：
 * 模板只换版式（配色/抬头），内容一律取报价单快照；发送只生成对外令牌，
 * 客户打开公开链接时才计一次浏览并回写首次阅读时间。
 */
export class QuotationDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmScopeService,
  ) {}

  private async owned(user: CurrentUser, idRaw: string | number) {
    const ctx = await this.crm.requireMember(user);
    const row = await this.prisma.crmQuotation.findFirst({
      where: { id: asInt(idRaw), ownerUserId: ctx.ownerUserId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '报价单不存在');
    return { ctx, row };
  }

  private lines(
    ctx: CrmContext,
    row: {
      name: string;
      customerName: string;
      untilAt: Date | null;
      amount: unknown;
      note: string;
      templateCode: string;
      createdAt: Date;
      items: {
        nameSnapshot: string;
        qty: unknown;
        price: unknown;
        amount: unknown;
      }[];
    },
  ): PdfLine[] {
    const template = (TEMPLATES as readonly string[]).includes(row.templateCode)
      ? (row.templateCode as TemplateCode)
      : 'CLASSIC';
    const accent = ACCENT[template];
    const lines: PdfLine[] = [];
    lines.push({
      text: template === 'MINIMAL' ? '报价单' : '报 价 单',
      size: 22,
      bold: true,
      color: accent,
      align: 'center',
      gap: 10,
    });
    lines.push({ text: row.name, size: 14, align: 'center', gap: 18 });
    lines.push({ text: `客户：${row.customerName || '—'}`, size: 11 });
    lines.push({
      text: `报价日期：${dateText(row.createdAt)}    有效期至：${dateText(row.untilAt) || '—'}`,
      size: 10,
      color: [0.35, 0.35, 0.35],
      gap: 12,
    });
    lines.push({ text: '明细', size: 12, bold: true, color: accent, gap: 6 });
    lines.push({
      text: '序号    品名                                        数量        单价              金额',
      size: 9,
      bold: true,
      color: [0.25, 0.25, 0.25],
    });
    row.items.forEach((item, index) => {
      const name = clip(item.nameSnapshot, 26).padEnd(24, ' ');
      lines.push({
        text: `${String(index + 1).padEnd(7, ' ')}${name}${String(Number(item.qty || 0)).padEnd(12, ' ')}${money(item.price).padEnd(18, ' ')}${money(item.amount)}`,
        size: 9,
        gap: 2,
      });
    });
    lines.push({ text: '', gap: 4 });
    lines.push({
      text: `合计：${money(row.amount)}`,
      size: 12,
      bold: true,
      align: 'right',
      color: accent,
    });
    if (row.note.trim()) {
      lines.push({ text: '', gap: 8 });
      lines.push({
        text: '商务条款',
        size: 11,
        bold: true,
        color: accent,
        gap: 4,
      });
      lines.push({ text: row.note, size: 9, color: [0.3, 0.3, 0.3] });
    }
    lines.push({ text: '', gap: 14 });
    lines.push({
      text: `出具方：${ctx.ownerUserId}`,
      size: 9,
      color: [0.45, 0.45, 0.45],
      align: 'right',
    });
    return lines;
  }

  async document(user: CurrentUser, idRaw: string) {
    const { ctx, row } = await this.owned(user, idRaw);
    const buffer = buildPdf(this.lines(ctx, row));
    const safeName = (row.name || `quotation-${row.id}`).replace(
      /[\\/:*?"<>|]/g,
      '_',
    );
    return {
      fileName: `${safeName}.pdf`,
      contentType: 'application/pdf',
      base64: buffer.toString('base64'),
    };
  }

  async send(user: CurrentUser, idRaw: string, body: Row) {
    const { row } = await this.owned(user, idRaw);
    const customerName = clip(body.customerName, 120).trim();
    const note = clip(body.note, 1000).trim();
    const templateCode = (TEMPLATES as readonly string[]).includes(
      asText(body.templateCode),
    )
      ? (asText(body.templateCode) as TemplateCode)
      : 'CLASSIC';
    const publicToken = row.publicToken || randomToken(20);
    const sentAt = new Date();
    await this.prisma.crmQuotation.update({
      where: { id: row.id },
      data: {
        customerName: customerName || row.customerName,
        note: note || row.note,
        templateCode,
        publicToken,
        sentAt,
      },
    });
    return {
      publicToken,
      publicUrl: publicUrlOf(`/api/public/quotation/${publicToken}`),
      sentAt: sentAt.toISOString(),
    };
  }

  async tracking(user: CurrentUser, query: Row) {
    const ctx = await this.crm.requireMember(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = { ownerUserId: ctx.ownerUserId, publicToken: { not: '' } };
    const [rows, total] = await Promise.all([
      this.prisma.crmQuotation.findMany({
        where,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.crmQuotation.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        customerName: row.customerName,
        amount: Number(row.amount),
        sentAt: iso(row.sentAt),
        readAt: iso(row.readAt),
        viewCount: row.viewCount,
        publicUrl: publicUrlOf(`/api/public/quotation/${row.publicToken}`),
        opportunityId: row.opportunityId,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 公开链接：每次打开计一次浏览；首次阅读回写 readAt（只前移不覆盖）。 */
  async publicPdf(token: string) {
    const row = await this.prisma.crmQuotation.findFirst({
      where: { publicToken: String(token || '') },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '链接无效或已失效');
    const now = new Date();
    await this.prisma.crmQuotation.update({
      where: { id: row.id },
      data: {
        viewCount: { increment: 1 },
        ...(row.readAt ? {} : { readAt: now }),
      },
    });
    const buffer = buildPdf(
      this.lines({ ownerUserId: row.ownerUserId } as CrmContext, row),
    );
    const safeName = (row.name || `quotation-${row.id}`).replace(
      /[\\/:*?"<>|]/g,
      '_',
    );
    return { buffer, fileName: `${safeName}.pdf` };
  }
}
