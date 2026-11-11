import type {
  WechatMpAdminStats,
  WechatMpEventKey,
  WechatMpMessageRow,
} from '@enterprise/contracts';
import { WECHAT_MP_EVENT_KEYS } from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import type { WechatMpRuntime } from './wechat-mp.settings';
import { startOfToday } from './wechat-mp.binding.service';
import type { WechatMpBindingService } from './wechat-mp.binding.service';
import type { WechatMpClient } from './wechat-mp.client';
import type { WechatMpSettingsService } from './wechat-mp.settings';

/** NotificationService 只知道这个形状：推送失败不影响站内消息落库。 */
export type WechatMpPushInput = {
  userId: string;
  title: string;
  body?: string;
  link?: string;
  category?: string;
  entityType?: string;
  entityId?: string;
  /** 业务侧已知事件时可直接指定，省略时按通知类别/实体推断。 */
  eventKey?: WechatMpEventKey;
};

type DispatchOptions = { force?: boolean };

const EVENT_SET = new Set<string>(WECHAT_MP_EVENT_KEYS);
const MAX_ATTEMPTS = 3;
const WINDOW_48H = 48 * 3600 * 1000;

/** 通知 → 微信事件：未识别的一律走平台公告映射，后台可单独关闭该映射。 */
export function resolveWechatMpEventKey(
  input: WechatMpPushInput,
): WechatMpEventKey {
  if (input.eventKey && EVENT_SET.has(input.eventKey)) return input.eventKey;
  const entity = String(input.entityType || '');
  const title = String(input.title || '');
  if (entity === 'my_task') {
    return /到期|逾期|截止/.test(title) ? 'task.due' : 'task.assigned';
  }
  if (entity.startsWith('oa_')) {
    return /oa_(approved|rejected|returned)|oa_result/.test(entity)
      ? 'oa.result'
      : 'oa.approval';
  }
  if (input.category === 'oa') return 'oa.approval';
  if (input.category === 'service_desk') return 'service_desk.reply';
  if (input.category === 'account') return 'account.security';
  if (input.category === 'question') return 'question.reply';
  if (input.category === 'collab') return 'collab.mention';
  return 'platform.notice';
}

function render(value: string, context: Record<string, string>) {
  return String(value || '').replace(
    /\{(title|body|user|time|link|entityId)\}/g,
    (_, key: string) => context[key] || '',
  );
}

function quietNow(
  quiet: { enabled: boolean; start: string; end: string },
  date = new Date(),
) {
  if (!quiet.enabled) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const parse = (value: string) => {
    const [h, m] = String(value || '')
      .split(':')
      .map(Number);
    return Number.isFinite(h) && Number.isFinite(m)
      ? (h % 24) * 60 + (m % 60)
      : 0;
  };
  const start = parse(quiet.start);
  const end = parse(quiet.end);
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/**
 * 微信消息推送：站内通知落库后作为旁路调用，只有绑定且关注、未退订的用户才出站。
 * 每次尝试都写 wechat_mp_messages，跳过原因也留痕，便于后台排查「为什么没收到」。
 */
export class WechatMpPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WechatMpSettingsService,
    private readonly client: WechatMpClient,
    private readonly bindings: WechatMpBindingService,
    private readonly users: UserLookupService,
  ) {}

  async pushNotification(input: WechatMpPushInput) {
    await this.dispatch(input).catch((error) => {
      console.error(
        JSON.stringify({
          event: 'wechat_mp_push_failed',
          userId: input.userId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  async dispatch(
    input: WechatMpPushInput,
    options: DispatchOptions = {},
  ): Promise<{ status: string; errmsg: string }> {
    const settings = await this.settings.load();
    if (!settings.enabled) return { status: 'skipped', errmsg: 'disabled' };
    const binding = await this.prisma.wechatMpBinding.findUnique({
      where: { userId: input.userId },
    });
    // 未绑定用户不写跳过记录：否则每个站内通知都会产生一条噪声。
    if (!binding) return { status: 'skipped', errmsg: 'unbound' };
    if (!binding.subscribed) {
      return this.recordSkipped(
        input,
        binding.openId,
        'unsubscribed',
        settings,
      );
    }
    if (binding.pushMuted) {
      return this.recordSkipped(input, binding.openId, 'muted', settings);
    }
    const eventKey = resolveWechatMpEventKey(input);
    if (
      !options.force &&
      eventKey !== 'account.security' &&
      quietNow(settings.quietHours)
    ) {
      return this.recordSkipped(input, binding.openId, 'quiet_hours', settings);
    }
    if (
      !options.force &&
      (await this.overDailyCap(input.userId, settings.dailyCap))
    ) {
      return this.recordSkipped(input, binding.openId, 'daily_cap', settings);
    }
    if (
      !options.force &&
      settings.dedupeSeconds > 0 &&
      (await this.isDuplicate(input, eventKey, settings.dedupeSeconds))
    ) {
      return this.recordSkipped(input, binding.openId, 'duplicate', settings);
    }
    const runtime = await this.settings.runtime();
    if (!runtime) return { status: 'skipped', errmsg: 'disabled' };
    const mapping = settings.templates.find(
      (item) => item.eventKey === eventKey,
    );
    const siteUrl = await resolveSiteUrl(this.prisma);
    const mobileLink = this.mobileLink(input, eventKey, settings);
    if (mapping?.enabled && mapping.templateId && mapping.fields.length) {
      const context = {
        title: input.title || '',
        body: input.body || '',
        user: input.userId,
        time: new Date().toLocaleString('zh-CN', { hour12: false }),
        link: mobileLink,
        entityId: String(input.entityId || ''),
      };
      const data: Record<string, { value: string }> = {};
      for (const field of mapping.fields) {
        data[field.key] = {
          value: (render(field.value, context) || '-').slice(0, 200),
        };
      }
      const url = this.absoluteUrl(mapping.url || mobileLink, siteUrl);
      const payload = JSON.stringify({
        templateId: mapping.templateId,
        url,
        data,
      });
      return this.createAndSend(runtime, {
        userId: input.userId,
        openId: binding.openId,
        kind: 'template',
        eventKey,
        templateId: mapping.templateId,
        title: input.title,
        content: input.body || '',
        link: url,
        payload,
        entityType: input.entityType || '',
        entityId: String(input.entityId || ''),
      });
    }
    if (mapping && mapping.customFallback === false) {
      return this.recordSkipped(input, binding.openId, 'no_template', settings);
    }
    const withinWindow =
      binding.lastInteractionAt &&
      Date.now() - binding.lastInteractionAt.getTime() < WINDOW_48H;
    if (!withinWindow && !options.force) {
      return this.recordSkipped(
        input,
        binding.openId,
        'outside_48h_window',
        settings,
      );
    }
    const content = [
      input.title || '',
      input.body || '',
      mobileLink ? `详情：${this.absoluteUrl(mobileLink, siteUrl)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1800);
    return this.createAndSend(runtime, {
      userId: input.userId,
      openId: binding.openId,
      kind: 'custom',
      eventKey,
      templateId: '',
      title: input.title,
      content,
      link: mobileLink,
      payload: '',
      entityType: input.entityType || '',
      entityId: String(input.entityId || ''),
    });
  }

  private async createAndSend(
    runtime: WechatMpRuntime,
    row: {
      userId: string;
      openId: string;
      kind: string;
      eventKey: string;
      templateId: string;
      title: string;
      content: string;
      link: string;
      payload: string;
      entityType: string;
      entityId: string;
    },
  ) {
    const created = await this.prisma.wechatMpMessage.create({
      data: { ...row, status: 'pending' },
    });
    return this.deliver(runtime, created);
  }

  private async deliver(
    runtime: WechatMpRuntime,
    row: {
      id: number;
      openId: string;
      kind: string;
      content: string;
      link: string;
      payload: string;
      templateId: string;
    },
  ): Promise<{ status: string; errmsg: string }> {
    try {
      let result;
      if (row.kind === 'template') {
        const payload = JSON.parse(row.payload || '{}') as {
          templateId?: string;
          url?: string;
          data?: Record<string, { value: string }>;
        };
        result = await this.client.sendTemplate(runtime, {
          openId: row.openId,
          templateId: payload.templateId || row.templateId,
          url: payload.url || row.link,
          data: payload.data || {},
        });
      } else {
        result = await this.client.sendCustomText(
          runtime,
          row.openId,
          row.content,
        );
      }
      if (result.errcode === 0) {
        await this.prisma.wechatMpMessage.update({
          where: { id: row.id },
          data: {
            status: 'sent',
            attempts: { increment: 1 },
            errcode: 0,
            errmsg: '',
            msgId: result.msgId,
            sentAt: new Date(),
          },
        });
        return { status: 'sent', errmsg: '' };
      }
      if ([40003, 43004].includes(result.errcode)) {
        await this.bindings.markUnsubscribed(row.openId);
      }
      await this.prisma.wechatMpMessage.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          errcode: result.errcode,
          errmsg: result.errmsg.slice(0, 300),
        },
      });
      return { status: 'failed', errmsg: result.errmsg };
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : error instanceof Error
            ? error.message
            : '发送失败';
      await this.prisma.wechatMpMessage
        .update({
          where: { id: row.id },
          data: {
            status: 'failed',
            attempts: { increment: 1 },
            errmsg: message.slice(0, 300),
          },
        })
        .catch(() => undefined);
      return { status: 'failed', errmsg: message };
    }
  }

  private async recordSkipped(
    input: WechatMpPushInput,
    openId: string,
    reason: string,
    settings: { templates: { eventKey: string }[] },
  ) {
    const eventKey = resolveWechatMpEventKey(input);
    const mapping = settings.templates.find(
      (item) => item.eventKey === eventKey,
    );
    await this.prisma.wechatMpMessage
      .create({
        data: {
          userId: input.userId,
          openId,
          kind: mapping ? 'template' : 'custom',
          eventKey,
          templateId: '',
          title: String(input.title || '').slice(0, 200),
          content: String(input.body || '').slice(0, 1800),
          link: String(input.link || '').slice(0, 500),
          status: 'skipped',
          errmsg: reason,
          entityType: String(input.entityType || '').slice(0, 32),
          entityId: String(input.entityId || '').slice(0, 64),
        },
      })
      .catch(() => undefined);
    return { status: 'skipped', errmsg: reason };
  }

  private async overDailyCap(userId: string, cap: number) {
    if (cap <= 0) return true;
    const count = await this.prisma.wechatMpMessage.count({
      where: {
        userId,
        createdAt: { gte: startOfToday() },
        status: { in: ['sent', 'failed', 'pending'] },
      },
    });
    return count >= cap;
  }

  private async isDuplicate(
    input: WechatMpPushInput,
    eventKey: string,
    seconds: number,
  ) {
    const since = new Date(Date.now() - seconds * 1000);
    const row = await this.prisma.wechatMpMessage.findFirst({
      where: {
        userId: input.userId,
        eventKey,
        entityType: String(input.entityType || ''),
        entityId: String(input.entityId || ''),
        createdAt: { gte: since },
        status: { not: 'skipped' },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  private mobileLink(
    input: WechatMpPushInput,
    eventKey: string,
    settings: { mobileLinks: Record<string, string> },
  ) {
    const link = String(input.link || '');
    const oa = /\/oa\?[^#]*\bid=(\d+)/.exec(link);
    if (oa) return `/m/oa/${oa[1]}`;
    const service = /\/service-desk\?[^#]*\bconversation=(\d+)/.exec(link);
    if (service) return `/m/service/${service[1]}`;
    if (
      input.entityType === 'my_task' &&
      /^\d+$/.test(String(input.entityId || ''))
    ) {
      return `/m/task/${input.entityId}`;
    }
    return (
      settings.mobileLinks[eventKey] ||
      settings.mobileLinks.default ||
      '/m/inbox'
    );
  }

  private absoluteUrl(link: string, siteUrl: string) {
    const value = String(link || '').trim();
    if (!value) return '';
    if (value.startsWith('/') && !value.startsWith('//')) {
      return joinSiteUrl(siteUrl, value);
    }
    return /^https:\/\//i.test(value) ? value : '';
  }

  async testSend(
    user: CurrentUser,
    body: { eventKey?: WechatMpEventKey; userId?: string },
  ): Promise<{ sent: boolean; status: string; message: string }> {
    const targetUserId = String(body.userId || '').trim();
    const binding = targetUserId
      ? await this.prisma.wechatMpBinding.findUnique({
          where: { userId: targetUserId },
        })
      : await this.prisma.wechatMpBinding.findFirst({
          where: { subscribed: true, pushMuted: false },
          orderBy: { updatedAt: 'desc' },
        });
    if (!binding) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有用户绑定并关注服务号，请先用右上角二维码完成绑定',
      );
    }
    const result = await this.dispatch(
      {
        userId: binding.userId,
        title: '微信服务号测试消息',
        body: `这是一条由 ${user.username || user.userId} 触发的测试消息。`,
        link: '/m/inbox',
        category: 'platform',
        eventKey: body.eventKey,
      },
      { force: true },
    );
    return {
      sent: result.status === 'sent',
      status: result.status,
      message: result.status === 'sent' ? '测试消息已发出' : result.errmsg,
    };
  }

  async listMessages(query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      query.page as string | number | undefined,
      query.pageSize as string | number | undefined,
      20,
    );
    const status = text(query.status, 'all');
    const eventKey = text(query.eventKey).trim();
    const keyword = text(query.keyword).trim().slice(0, 80);
    const where = {
      ...(status !== 'all' ? { status } : {}),
      ...(eventKey ? { eventKey } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { userId: { contains: keyword } },
              { errmsg: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.wechatMpMessage.count({ where }),
      this.prisma.wechatMpMessage.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const names = await this.users.displayNames(rows.map((row) => row.userId));
    return pageOf(
      rows.map((row) =>
        this.messageRow(row, names.get(row.userId) || row.userId),
      ),
      total,
      page,
      pageSize,
    );
  }

  async retry(user: CurrentUser, id: string) {
    void user;
    const numeric = Number(id);
    const row = Number.isInteger(numeric)
      ? await this.prisma.wechatMpMessage.findUnique({ where: { id: numeric } })
      : null;
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '推送记录不存在');
    const result = await this.retryRow(row);
    const latest = await this.prisma.wechatMpMessage.findUnique({
      where: { id: row.id },
    });
    const name = (await this.users.displayNames([row.userId])).get(row.userId);
    return this.messageRow(latest || row, name || row.userId, result.errmsg);
  }

  private async retryRow(row: {
    id: number;
    userId: string;
    openId: string;
    kind: string;
    eventKey: string;
    templateId: string;
    title: string;
    content: string;
    link: string;
    payload: string;
    entityType: string;
    entityId: string;
    status: string;
    errmsg: string;
    attempts: number;
    sentAt: Date | null;
    createdAt: Date;
    errcode: number | null;
    msgId: string;
  }) {
    const binding = await this.prisma.wechatMpBinding.findUnique({
      where: { userId: row.userId },
    });
    if (!binding || !binding.subscribed || binding.pushMuted) {
      await this.prisma.wechatMpMessage.update({
        where: { id: row.id },
        data: {
          status: 'skipped',
          errmsg: 'retry_invalid_binding',
        },
      });
      return { status: 'skipped', errmsg: '绑定已失效或已退订，无法重试' };
    }
    const runtime = await this.settings.runtime();
    if (!runtime) return { status: 'skipped', errmsg: '服务号未启用' };
    await this.prisma.wechatMpMessage.update({
      where: { id: row.id },
      data: { status: 'pending', errmsg: '' },
    });
    return this.deliver(runtime, { ...row, openId: binding.openId });
  }

  /** 调度器入口：只重试近 24 小时内、未超过 3 次的失败记录。 */
  async retryDue() {
    const rows = await this.prisma.wechatMpMessage.findMany({
      where: {
        status: 'failed',
        attempts: { lt: MAX_ATTEMPTS },
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
      orderBy: { id: 'asc' },
      take: 20,
    });
    for (const row of rows) {
      await this.retryRow(row).catch(() => undefined);
    }
    return rows.length;
  }

  async stats(): Promise<WechatMpAdminStats> {
    const [settings, counts, todaySent, todayFailed] = await Promise.all([
      this.settings.load(),
      this.bindings.counts(),
      this.prisma.wechatMpMessage.count({
        where: { status: 'sent', createdAt: { gte: startOfToday() } },
      }),
      this.prisma.wechatMpMessage.count({
        where: { status: 'failed', createdAt: { gte: startOfToday() } },
      }),
    ]);
    return {
      enabled: settings.enabled,
      boundCount: counts.boundCount,
      subscribedCount: counts.subscribedCount,
      mutedCount: counts.mutedCount,
      todaySent,
      todayFailed,
      templateCount: settings.templates.filter((item) => item.enabled).length,
      menuPublished: Boolean(settings.menu.publishedAt),
    };
  }

  private messageRow(
    row: {
      id: number;
      userId: string;
      kind: string;
      eventKey: string;
      templateId: string;
      title: string;
      status: string;
      errcode: number | null;
      errmsg: string;
      attempts: number;
      entityType: string;
      entityId: string;
      createdAt: Date;
      sentAt: Date | null;
    },
    userName: string,
    overrideMessage = '',
  ): WechatMpMessageRow {
    return {
      id: row.id,
      userId: row.userId,
      userName,
      kind: row.kind,
      eventKey: row.eventKey,
      templateId: row.templateId,
      title: row.title,
      status: row.status,
      errcode: row.errcode,
      errmsg: overrideMessage || row.errmsg,
      attempts: row.attempts,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() || null,
    };
  }
}
