import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import {
  asInt,
  asNum,
  asText,
  clip,
  iso,
  pageParams,
  Row,
  safeStatus,
} from './gaps.helpers';

const KINDS = ['RETURN', 'REPAIR', 'REFUND', 'EXCHANGE'] as const;
const KIND_LABELS: Record<string, string> = {
  RETURN: '退货',
  REPAIR: '维修',
  REFUND: '退款',
  EXCHANGE: '换货',
};
const STATUSES = [
  'PENDING',
  'REVIEWING',
  'APPROVED',
  'REJECTED',
  'RECEIVED',
  'SHIPPED',
  'COMPLETED',
  'CANCELED',
] as const;
const STATUS_LABELS: Record<string, string> = {
  PENDING: '待受理',
  REVIEWING: '处理中',
  APPROVED: '已同意',
  REJECTED: '已拒绝',
  RECEIVED: '已收货',
  SHIPPED: '已寄回',
  COMPLETED: '已完成',
  CANCELED: '已取消',
};

/** 售后状态机：只允许业务上可走的下一步，跳步一律拒绝。 */
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ['REVIEWING', 'APPROVED', 'REJECTED', 'CANCELED'],
  REVIEWING: ['APPROVED', 'REJECTED', 'CANCELED'],
  APPROVED: ['RECEIVED', 'SHIPPED', 'CANCELED'],
  RECEIVED: ['SHIPPED', 'COMPLETED', 'CANCELED'],
  SHIPPED: ['COMPLETED', 'CANCELED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELED: [],
};

type TicketRow = {
  id: number;
  conversationId: number;
  orderNo: string;
  kind: string;
  reason: string;
  amount: unknown;
  contact: string;
  note: string;
  status: string;
  assigneeUserId: string;
  createdAt: Date;
  updatedAt: Date;
  events?: {
    id: number;
    fromStatus: string;
    toStatus: string;
    note: string;
    operatorId: string;
    createdAt: Date;
  }[];
};

/**
 * B3#22② 售后状态机：服务台会话/订单 → 售后工单 → 逐步推进并逐条留事件。
 * 工单挂在服务台账号（ownerUserId）下，与现有会话列表同口径。
 */
export class AfterSalesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(row: TicketRow) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      orderNo: row.orderNo,
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind] || row.kind,
      reason: row.reason,
      amount: Number(row.amount),
      contact: row.contact,
      note: row.note,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      assigneeUserId: row.assigneeUserId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      events: (row.events || []).map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        operatorId: event.operatorId,
        createdAt: iso(event.createdAt),
      })),
    };
  }

  async tickets(user: CurrentUser, query: Row) {
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      ownerUserId: user.userId,
      ...(asText(query.status).trim()
        ? { status: safeStatus(query.status, STATUSES, 'PENDING') }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.serviceAfterSalesTicket.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
        include: { events: { orderBy: { id: 'asc' } } },
      }),
      this.prisma.serviceAfterSalesTicket.count({ where }),
    ]);
    return { list: rows.map((row) => this.view(row)), total, page, pageSize };
  }

  private async owned(user: CurrentUser, idRaw: string | number) {
    const row = await this.prisma.serviceAfterSalesTicket.findFirst({
      where: { id: asInt(idRaw), ownerUserId: user.userId },
      include: { events: { orderBy: { id: 'asc' } } },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '售后工单不存在');
    return row;
  }

  async ticket(user: CurrentUser, idRaw: string) {
    return this.view(await this.owned(user, idRaw));
  }

  async saveTicket(user: CurrentUser, body: Row) {
    const id = asInt(body.id);
    const data = {
      conversationId: Math.max(0, asInt(body.conversationId)),
      orderNo: clip(body.orderNo, 64),
      kind: safeStatus(body.kind, KINDS, 'RETURN'),
      reason: clip(body.reason, 500),
      amount: Math.max(0, asNum(body.amount)),
      contact: clip(body.contact, 80),
      note: clip(body.note, 1000),
      assigneeUserId: clip(body.assigneeUserId, 64),
    };
    if (id) {
      const existing = await this.owned(user, id);
      if (['COMPLETED', 'CANCELED'].includes(existing.status)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '已完结或已取消的工单不能再修改',
        );
      }
      const row = await this.prisma.serviceAfterSalesTicket.update({
        where: { id: existing.id },
        data,
        include: { events: { orderBy: { id: 'asc' } } },
      });
      return this.view(row);
    }
    const row = await this.prisma.serviceAfterSalesTicket.create({
      data: {
        ...data,
        ownerUserId: user.userId,
        status: 'PENDING',
        createdBy: user.userId,
      },
      include: { events: true },
    });
    await this.prisma.serviceAfterSalesEvent.create({
      data: {
        ticketId: row.id,
        fromStatus: '',
        toStatus: 'PENDING',
        note: '工单创建',
        operatorId: user.userId,
      },
    });
    const created = await this.prisma.serviceAfterSalesTicket.findUnique({
      where: { id: row.id },
      include: { events: { orderBy: { id: 'asc' } } },
    });
    return this.view(created || { ...row, events: [] });
  }

  async advance(user: CurrentUser, idRaw: string, body: Row) {
    const row = await this.owned(user, idRaw);
    const toStatus = safeStatus(body.toStatus, STATUSES, 'PENDING');
    const allowed = TRANSITIONS[row.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前状态（${STATUS_LABELS[row.status] || row.status}）不能推进到「${STATUS_LABELS[toStatus] || toStatus}」`,
      );
    }
    const note = clip(body.note, 500);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.serviceAfterSalesEvent.create({
        data: {
          ticketId: row.id,
          fromStatus: row.status,
          toStatus,
          note,
          operatorId: user.userId,
        },
      });
      return tx.serviceAfterSalesTicket.update({
        where: { id: row.id },
        data: { status: toStatus, note: note || row.note },
        include: { events: { orderBy: { id: 'asc' } } },
      });
    });
    return this.view(updated);
  }
}
