import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import {
  asBool,
  asDate,
  asInt,
  asText,
  clip,
  iso,
  pageParams,
  publicUrlOf,
  randomToken,
  Row,
} from './gaps.helpers';

const PURPOSE_LABELS: Record<string, string> = {
  INTERVIEW: '面试',
  SERVICE: '客户会面',
  MEETING: '项目会议',
};
const STATUS_LABELS: Record<string, string> = {
  BOOKED: '已预约',
  DONE: '已完成',
  CANCELED: '已取消',
};

type EventRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  slug: string;
  title: string;
  purpose: string;
  durationMin: number;
  bufferMin: number;
  location: string;
  description: string;
  horizonDays: number;
  active: boolean;
  createdAt: Date;
};

type BookingRow = {
  id: number;
  eventId: number;
  slotId: number;
  name: string;
  phone: string;
  email: string;
  company: string;
  note: string;
  refType: string;
  refId: string;
  status: string;
  createdAt: Date;
};

/** 北京时间时间片：`2026-11-08` + `09:30` → Date。 */
const at = (date: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const HHMM = (value: string): string => String(value || '').slice(0, 5);

/**
 * B1#7 预约 / 忙闲：面试、客户会面、项目会议共用一套「可约事件 + 时间片 + 预约单」。
 * 预约页对外免登录（slug 随机公开路径），管理侧落在 HRM / 项目 / CRM 的宿主页签里。
 */
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private async counters(ids: number[]) {
    if (!ids.length)
      return {
        slots: new Map<number, number>(),
        bookings: new Map<number, number>(),
      };
    const [slots, bookings] = await Promise.all([
      this.prisma.appointmentSlot.groupBy({
        by: ['eventId'],
        where: {
          eventId: { in: ids },
          booked: false,
          startAt: { gte: new Date() },
        },
        _count: { _all: true },
      }),
      this.prisma.appointmentBooking.groupBy({
        by: ['eventId'],
        where: { eventId: { in: ids }, status: 'BOOKED' },
        _count: { _all: true },
      }),
    ]);
    return {
      slots: new Map(slots.map((row) => [row.eventId, row._count._all])),
      bookings: new Map(bookings.map((row) => [row.eventId, row._count._all])),
    };
  }

  private view(
    row: EventRow,
    counters?: { slots: Map<number, number>; bookings: Map<number, number> },
  ) {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      purpose: row.purpose,
      purposeLabel: PURPOSE_LABELS[row.purpose] || row.purpose,
      durationMin: row.durationMin,
      bufferMin: row.bufferMin,
      location: row.location,
      description: row.description,
      horizonDays: row.horizonDays,
      active: row.active,
      publicUrl: publicUrlOf(`/book/${row.slug}`),
      upcomingSlots: counters?.slots.get(row.id) || 0,
      upcomingBookings: counters?.bookings.get(row.id) || 0,
      createdAt: iso(row.createdAt),
    };
  }

  async events(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.appointmentEvent.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: [{ active: 'desc' }, { id: 'desc' }],
    });
    const counters = await this.counters(rows.map((row) => row.id));
    return rows.map((row) => this.view(row, counters));
  }

  async saveEvent(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const id = asInt(body.id);
    const title = clip(body.title, 120).trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写预约事件名称');
    const existing = id
      ? await this.prisma.appointmentEvent.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '预约事件不存在');
    let slug = asText(body.slug).trim().toLowerCase();
    if (!/^[a-z0-9-]{3,48}$/.test(slug))
      slug = existing?.slug || randomToken(8);
    const taken = await this.prisma.appointmentEvent.findUnique({
      where: { slug },
    });
    if (taken && taken.id !== existing?.id) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该预约链接已被占用，请换一个',
      );
    }
    const data = {
      title,
      slug,
      purpose: ['INTERVIEW', 'SERVICE', 'MEETING'].includes(
        asText(body.purpose),
      )
        ? asText(body.purpose)
        : 'MEETING',
      durationMin: Math.min(480, Math.max(10, asInt(body.durationMin, 30))),
      bufferMin: Math.min(120, Math.max(0, asInt(body.bufferMin, 10))),
      location: clip(body.location, 200),
      description: clip(body.description, 1000),
      horizonDays: Math.min(180, Math.max(1, asInt(body.horizonDays, 30))),
      active: asBool(body.active, true),
    };
    const row = existing
      ? await this.prisma.appointmentEvent.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.appointmentEvent.create({
          data: {
            ...data,
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdBy: org.actorId,
          },
        });
    const counters = await this.counters([row.id]);
    return this.view(row, counters);
  }

  async removeEvent(user: CurrentUser, idRaw: number) {
    const org = await this.scope.requireAdmin(user);
    const row = await this.prisma.appointmentEvent.findFirst({
      where: { id: idRaw, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '预约事件不存在');
    await this.prisma.$transaction([
      this.prisma.appointmentBooking.deleteMany({ where: { eventId: row.id } }),
      this.prisma.appointmentSlot.deleteMany({ where: { eventId: row.id } }),
      this.prisma.appointmentEvent.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  async slots(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const eventId = asInt(query.eventId);
    const from = asDate(query.from) || new Date();
    const to = asDate(query.to) || new Date(Date.now() + 60 * 86_400_000);
    const rows = await this.prisma.appointmentSlot.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        eventId,
        startAt: { gte: from, lte: to },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      startAt: iso(row.startAt),
      endAt: iso(row.endAt),
      booked: row.booked,
    }));
  }

  async generateSlots(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const eventId = asInt(body.eventId);
    const event = await this.prisma.appointmentEvent.findFirst({
      where: { id: eventId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!event)
      throw new BusinessException(ErrorCode.NOT_FOUND, '预约事件不存在');
    const date = asText(body.date);
    const start = at(date, asText(body.startTime));
    const end = at(date, asText(body.endTime));
    if (!start || !end || end.getTime() <= start.getTime()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写有效的日期与起止时间',
      );
    }
    const step = Math.min(
      240,
      Math.max(5, asInt(body.stepMin, event.durationMin)),
    );
    if (step < event.durationMin + event.bufferMin) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `时间片间隔不能小于「时长 + 缓冲」（${event.durationMin}+${event.bufferMin} 分钟）`,
      );
    }
    const data: Array<{ startAt: Date; endAt: Date }> = [];
    for (
      let cursor = start.getTime();
      cursor + event.durationMin * 60_000 <= end.getTime();
      cursor += step * 60_000
    ) {
      data.push({
        startAt: new Date(cursor),
        endAt: new Date(cursor + event.durationMin * 60_000),
      });
    }
    if (!data.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这段时间放不下一个完整的时间片',
      );
    }
    await this.prisma.appointmentSlot.createMany({
      data: data.map((slot) => ({
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        eventId: event.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.appointmentSlot.findMany({
      where: {
        eventId: event.id,
        startAt: { gte: start, lte: end },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      startAt: iso(row.startAt),
      endAt: iso(row.endAt),
      booked: row.booked,
    }));
  }

  private async bookingView(rows: BookingRow[]) {
    if (!rows.length) return [];
    const eventIds = [...new Set(rows.map((row) => row.eventId))];
    const slotIds = [...new Set(rows.map((row) => row.slotId))];
    const [events, slots] = await Promise.all([
      this.prisma.appointmentEvent.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, title: true },
      }),
      this.prisma.appointmentSlot.findMany({
        where: { id: { in: slotIds } },
        select: { id: true, startAt: true, endAt: true },
      }),
    ]);
    const titles = new Map(events.map((row) => [row.id, row.title]));
    const times = new Map(slots.map((row) => [row.id, row]));
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      slotId: row.slotId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      company: row.company,
      note: row.note,
      refType: row.refType,
      refId: row.refId,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      startAt: iso(times.get(row.slotId)?.startAt),
      endAt: iso(times.get(row.slotId)?.endAt),
      eventTitle: titles.get(row.eventId) || '',
      createdAt: iso(row.createdAt),
    }));
  }

  async bookings(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(asInt(query.eventId) ? { eventId: asInt(query.eventId) } : {}),
      ...(asText(query.status) ? { status: asText(query.status) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.appointmentBooking.count({ where }),
      this.prisma.appointmentBooking.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    return { list: await this.bookingView(rows), total, page, pageSize };
  }

  async book(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    return this.createBooking(
      org.orgType,
      org.orgUserId,
      asInt(body.slotId),
      body,
      org.actorId,
    );
  }

  private async createBooking(
    orgType: string,
    orgUserId: string,
    slotId: number,
    body: Row,
    createdBy: string,
  ) {
    const name = clip(body.name, 64).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写预约人姓名');
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: { id: slotId, orgType, orgUserId },
    });
    if (!slot)
      throw new BusinessException(ErrorCode.NOT_FOUND, '时间段不存在或已失效');
    if (slot.booked)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该时间段刚被约走，请换一个',
      );
    if (slot.startAt.getTime() < Date.now()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该时间段已过，请选择后面的时间',
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.appointmentSlot.updateMany({
        where: { id: slot.id, booked: false },
        data: { booked: true },
      });
      if (claimed.count === 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该时间段刚被约走，请换一个',
        );
      }
      const booking = await tx.appointmentBooking.create({
        data: {
          orgType,
          orgUserId,
          eventId: slot.eventId,
          slotId: slot.id,
          name,
          phone: clip(body.phone, 32),
          email: clip(body.email, 120),
          company: clip(body.company, 120),
          note: clip(body.note, 1000),
          refType: clip(body.refType, 24),
          refId: clip(body.refId, 64),
          status: 'BOOKED',
          createdBy,
        },
      });
      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data: { bookingId: booking.id },
      });
      return booking;
    });
    const [view] = await this.bookingView([created]);
    return view;
  }

  async cancelBooking(user: CurrentUser, idRaw: number, note = '') {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.appointmentBooking.findFirst({
      where: { id: idRaw, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '预约不存在');
    if (row.status === 'CANCELED') {
      const [view] = await this.bookingView([row]);
      return view;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentSlot.updateMany({
        where: { id: row.slotId },
        data: { booked: false, bookingId: 0 },
      });
      const canceledNote = String(note || '').trim();
      return tx.appointmentBooking.update({
        where: { id: row.id },
        data: {
          status: 'CANCELED',
          ...(canceledNote
            ? { note: clip(`${row.note}\n[取消] ${canceledNote}`, 1000) }
            : {}),
        },
      });
    });
    const [view] = await this.bookingView([updated]);
    return view;
  }

  // ---------------------------------------------------------------- 公开预约

  async publicEvent(slug: string) {
    const event = await this.prisma.appointmentEvent.findUnique({
      where: {
        slug: String(slug || '')
          .trim()
          .toLowerCase(),
      },
    });
    if (!event || !event.active) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '预约链接不存在或已关闭',
      );
    }
    const now = new Date();
    const horizon = new Date(now.getTime() + event.horizonDays * 86_400_000);
    const slots = await this.prisma.appointmentSlot.findMany({
      where: {
        eventId: event.id,
        booked: false,
        startAt: { gte: now, lte: horizon },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });
    return {
      title: event.title,
      purpose: event.purpose,
      purposeLabel: PURPOSE_LABELS[event.purpose] || event.purpose,
      durationMin: event.durationMin,
      location: event.location,
      description: event.description,
      slots: slots.map((row) => ({
        id: row.id,
        startAt: iso(row.startAt),
        endAt: iso(row.endAt),
        label: `${iso(row.startAt).slice(5, 10)} ${HHMM(
          new Date(row.startAt.getTime() + 8 * 3600_000)
            .toISOString()
            .slice(11, 16),
        )}`,
      })),
    };
  }

  async publicBook(slug: string, body: Row) {
    const event = await this.prisma.appointmentEvent.findUnique({
      where: {
        slug: String(slug || '')
          .trim()
          .toLowerCase(),
      },
    });
    if (!event || !event.active) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '预约链接不存在或已关闭',
      );
    }
    const slotId = asInt(body.slotId);
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: {
        id: slotId,
        eventId: event.id,
        orgType: event.orgType,
        orgUserId: event.orgUserId,
      },
    });
    if (!slot)
      throw new BusinessException(ErrorCode.NOT_FOUND, '时间段不存在或已失效');
    return this.createBooking(
      event.orgType,
      event.orgUserId,
      slot.id,
      body,
      '',
    );
  }
}
