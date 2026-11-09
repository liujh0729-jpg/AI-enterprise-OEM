import { randomBytes } from 'node:crypto';
import {
  ACQ_FOLLOW_UP_STATUSES,
  ACQ_FOLLOW_UP_TIME_RULES,
  ACQ_OUTREACH_CHANNELS,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { PublishReviewService } from '../moderation/publish-review.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aiJson } from '../ai/ai-gateway';
import {
  AcquisitionSettingsService,
  type AcqSettings,
} from './acquisition-settings.service';
import {
  clip,
  dateOr,
  int,
  iso,
  json,
  oneOf,
  orgKey,
  pageArgs,
  pageResult,
  text,
  withinActiveHours,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

type FollowUpRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  profileId: number;
  channelPeerKey: string;
  externalUserId: string;
  channel: string;
  accountId: string;
  followUpAt: Date;
  reason: string;
  contextSummary: string;
  status: string;
  sentText: string;
  retryCount: number;
  playbookId: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 调度器外发钩子：WECOM 借用服务台渠道，未装配时如实失败，不假装已发。 */
export type FollowUpChannelSender = (input: {
  ownerUserId: string;
  channel: string;
  externalUserId: string;
  text: string;
}) => Promise<{ ok: boolean; ref?: string; error?: string }>;

const DELAY_WORDS = [
  '明天',
  '后天',
  '下周',
  '下午',
  '晚上',
  '晚点',
  '稍后',
  '过两天',
  '几天后',
  '工资',
  '月底',
  '再说',
  '再聊',
  '考虑一下',
  '想一想',
];

const BUYING_WORDS = [
  '价格',
  '多少钱',
  '怎么买',
  '购买',
  '下单',
  '报价',
  '套餐',
  '版本',
  '优惠',
  '试用',
  '付款',
  '支付',
  '合作',
  '报价单',
  '采购',
];

/** 客户说法 → 跟进时间，逐条对齐设计里的时间映射表。 */
export function resolveFollowUpAt(
  ruleKey: string,
  raw = '',
  now = new Date(),
): Date {
  const explicit = dateOr(raw);
  if (explicit) return explicit;
  const rule =
    ACQ_FOLLOW_UP_TIME_RULES.find((item) => item.key === ruleKey) ||
    ACQ_FOLLOW_UP_TIME_RULES[0];
  const at = new Date(now);
  const cut = (hour: number) => {
    if (at.getHours() >= hour) at.setDate(at.getDate() + 1);
  };
  switch (rule.key) {
    case 'AFTERNOON':
      cut(13);
      at.setHours(14, 0, 0, 0);
      return at;
    case 'EVENING':
      cut(18);
      at.setHours(19, 0, 0, 0);
      return at;
    case 'LATER':
      if (at.getHours() >= 13) {
        at.setDate(at.getDate() + 1);
        at.setHours(10, 0, 0, 0);
      } else {
        at.setHours(14, 0, 0, 0);
      }
      return at;
    case 'EXPLICIT':
      at.setDate(at.getDate() + 1);
      at.setHours(10, 0, 0, 0);
      return at;
    default:
      at.setDate(at.getDate() + rule.offsetDays);
      at.setHours(rule.hour, 0, 0, 0);
      return at;
  }
}

/** 从客户原话识别时间规则；识别不出返回空串，由调用方决定是否建跟进。 */
export function detectTimeRule(message: string): string {
  const content = text(message);
  if (!content) return '';
  if (/后天/.test(content)) return 'DAY_AFTER';
  if (/明天/.test(content)) return 'TOMORROW';
  if (/下周/.test(content)) return 'NEXT_WEEK';
  if (/工资|月底/.test(content)) return 'PAYDAY';
  if (/过两天|几天后|过几天/.test(content)) return 'IN_A_FEW_DAYS';
  if (/晚点|稍后|回头|再说|再聊/.test(content)) return 'LATER';
  if (/下午/.test(content)) return 'AFTERNOON';
  if (/晚上/.test(content)) return 'EVENING';
  const date = content.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (date) return 'EXPLICIT';
  return '';
}

export const hasBuyingIntent = (message: string): boolean => {
  const content = text(message);
  return BUYING_WORDS.some((word) => content.includes(word));
};

export const hasDelaySignal = (message: string): boolean => {
  const content = text(message);
  return DELAY_WORDS.some((word) => content.includes(word));
};

/** channelPeerKey = `渠道:外部用户ID`；拆回来喂给插件定位会话。 */
function peerParts(key: string) {
  const at = key.indexOf(':');
  return at < 0
    ? { channel: '', externalUserId: key }
    : { channel: key.slice(0, at), externalUserId: key.slice(at + 1) };
}

/** 渠道会话键 → 可外发的跟进渠道；官网 widget 没有对外发送能力，不自动建跟进。 */
export function followUpChannelOf(channelPeerKey: string): string {
  const { channel } = peerParts(channelPeerKey);
  const upper = channel.toUpperCase();
  if (upper.includes('WECOM') || upper.includes('WECHAT')) return 'WECOM';
  if (upper.includes('XHS')) return 'XHS_DM';
  if (upper.includes('EMAIL')) return 'EMAIL';
  return '';
}

const GENERATE_SYSTEM = [
  '你在写一条客户跟进消息。要求：不超过三句话、不承诺价格/时效/赔付、不编造优惠，语气像上次接待的同一个人。',
  '只输出 JSON：{"text":"跟进消息"}',
].join('\n');

/**
 * 跟进计划：客户表达购买意向且明确要等一段时间才建。
 * 状态机 pending → sent_once → completed；同一客户新建前先取消旧 pending。
 * 回执账本 AcqFollowUpReceipt 记录每次发送意图，attempt 唯一约束本身就是发送单飞闸。
 */
export class AcquisitionFollowUpService {
  private readonly warned = new Set<string>();

  /** 服务台渠道外发（WECOM），由 services.ts 装配；未装配则企微跟进如实失败。 */
  sendChannel?: FollowUpChannelSender;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly publishReview: PublishReviewService,
  ) {}

  async list(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const now = new Date();
    const where = {
      ...orgKey(org),
      ...(int(query.profileId) > 0 ? { profileId: int(query.profileId) } : {}),
      ...(text(query.status) ? { status: text(query.status) } : {}),
      ...(query.due === true || query.due === 'true'
        ? { status: 'pending', followUpAt: { lte: now } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqFollowUp.count({ where }),
      this.prisma.acqFollowUp.findMany({
        where,
        orderBy: [{ followUpAt: 'asc' }, { id: 'desc' }],
        skip: args.skip,
        take: args.take,
      }),
    ]);
    const names = await this.profileNames(
      org,
      rows.map((row) => row.profileId),
    );
    return pageResult(
      rows.map((row) => this.view(row, names.get(row.profileId) || '')),
      total,
      args,
    );
  }

  async create(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '获客已关闭，请先在设置里开启',
      );
    }
    const profile = await this.prisma.acqProfile.findFirst({
      where: { id: int(body.profileId), ...orgKey(org), deletedAt: null },
    });
    if (!profile) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户档案不存在');
    }
    const channel = oneOf(body.channel, ACQ_OUTREACH_CHANNELS, 'XHS_DM');
    if (channel === 'DOUYIN_COMMENT') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '评论渠道不做回访：请改用私信或留资渠道建跟进',
      );
    }
    const timeRule = oneOf(
      body.timeRule,
      ACQ_FOLLOW_UP_TIME_RULES.map((item) => item.key),
      'TOMORROW',
    );
    const followUpAt = resolveFollowUpAt(timeRule, text(body.followUpAt));
    await this.cancelPending(
      org,
      profile.id,
      '同一客户新建了跟进计划，旧计划自动取消',
    );
    const parts = peerParts(text(profile.channelPeerKey));
    const row = await this.prisma.acqFollowUp.create({
      data: {
        ...orgKey(org),
        profileId: profile.id,
        channelPeerKey: clip(text(profile.channelPeerKey), 200),
        externalUserId: clip(parts.externalUserId, 160),
        channel,
        accountId: clip(text(body.accountId), 80),
        followUpAt,
        reason: clip(text(body.reason), 300) || '客户表示稍后继续沟通',
        contextSummary: clip(text(body.contextSummary), 4000),
        status: 'pending',
        playbookId: int(body.playbookId) || settings.defaultPlaybookId,
      },
    });
    await this.event(org, profile.id, row.id, 'FOLLOW_UP', {
      summary: `新建跟进：${iso(followUpAt)} · ${row.reason}`,
      payload: { channel, followUpAt: iso(followUpAt) },
    });
    await this.audit(
      user.userId,
      '获客跟进新建',
      `#${row.id} ${channel} ${iso(followUpAt)}`,
    );
    return this.view(row, clip(text(profile.displayName), 120));
  }

  /**
   * 接待侧自动建跟进：客户已表达购买意向，且明确说「等一段时间」。
   * 同一档案先取消旧 pending，避免多条计划同时催同一个客户。
   */
  async createAuto(
    org: HrmOrg | OrgKey,
    profile: { id: number; channelPeerKey: string },
    input: {
      message: string;
      contextSummary: string;
      playbookId?: number;
    },
  ) {
    const message = text(input.message);
    if (!hasBuyingIntent(message)) return null;
    const timeRule = detectTimeRule(message);
    if (!timeRule) return null;
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled) return null;
    const channel = followUpChannelOf(profile.channelPeerKey);
    if (!channel) return null;
    await this.cancelPending(
      org,
      profile.id,
      '客户重新约定了时间，旧计划自动取消',
    );
    const parts = peerParts(profile.channelPeerKey);
    const followUpAt = resolveFollowUpAt(timeRule);
    const row = await this.prisma.acqFollowUp.create({
      data: {
        ...orgKey(org),
        profileId: profile.id,
        channelPeerKey: clip(text(profile.channelPeerKey), 200),
        externalUserId: clip(parts.externalUserId, 160),
        channel,
        accountId: '',
        followUpAt,
        reason: clip(`客户表示「${clip(message, 80)}」`, 300),
        contextSummary: clip(text(input.contextSummary), 4000),
        status: 'pending',
        playbookId: int(input.playbookId) || settings.defaultPlaybookId,
      },
    });
    await this.event(org, profile.id, row.id, 'FOLLOW_UP', {
      summary: `按客户说法自动建跟进：${iso(followUpAt)}`,
      payload: { channel, followUpAt: iso(followUpAt), timeRule },
    });
    return row;
  }

  async cancel(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const row = await this.requireRow(org, id);
    if (['completed', 'cancelled'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该跟进已结束，不能取消',
      );
    }
    const reason = clip(text(body.reason), 200) || '人工取消';
    const updated = await this.prisma.acqFollowUp.update({
      where: { id: row.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    await this.event(org, row.profileId, row.id, 'FOLLOW_UP', {
      summary: `跟进已取消：${reason}`,
      payload: { status: 'cancelled' },
    });
    await this.audit(user.userId, '获客跟进取消', `#${row.id} ${reason}`);
    return this.view(
      updated,
      (await this.profileNames(org, [row.profileId])).get(row.profileId) || '',
    );
  }

  /** 完成：客户主动回复、明确说不用跟了、或人工判断已闭环。 */
  async complete(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const row = await this.requireRow(org, id);
    const reason =
      clip(text(body.reason), 200) || '客户已回复或确认无需继续跟进';
    const updated = await this.prisma.acqFollowUp.update({
      where: { id: row.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await this.event(org, row.profileId, row.id, 'FOLLOW_UP', {
      summary: `跟进完成：${reason}`,
      payload: { status: 'completed' },
    });
    await this.audit(user.userId, '获客跟进完成', `#${row.id} ${reason}`);
    const receipts = await this.prisma.acqFollowUpReceipt.findMany({
      where: { followUpId: row.id },
      orderBy: { attempt: 'asc' },
    });
    return {
      ...this.view(
        updated,
        (await this.profileNames(org, [row.profileId])).get(row.profileId) ||
          '',
      ),
      receipts: receipts.map((item) => ({
        id: item.id,
        followUpId: item.followUpId,
        attempt: item.attempt,
        text: item.text,
        accountId: item.accountId,
        operationId: item.operationId,
        status: item.status,
        createdAt: iso(item.createdAt),
      })),
    };
  }

  /** 客户一回复就把未完成的跟进收口，避免「客户都回来了还在定时催」。 */
  async completeByPeer(
    org: HrmOrg | OrgKey,
    channelPeerKey: string,
    reason: string,
  ) {
    const key = clip(channelPeerKey, 200);
    if (!key) return 0;
    const rows = await this.prisma.acqFollowUp.findMany({
      where: {
        ...orgKey(org),
        channelPeerKey: key,
        status: { in: ['pending', 'sent_once'] },
      },
      select: { id: true, profileId: true },
    });
    if (!rows.length) return 0;
    await this.prisma.acqFollowUp.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { status: 'completed', completedAt: new Date() },
    });
    for (const row of rows) {
      await this.event(orgOfKey(org), row.profileId, row.id, 'FOLLOW_UP', {
        summary: `跟进完成：${reason}`,
        payload: { status: 'completed' },
      });
    }
    return rows.length;
  }

  /** 调度器入口：只发到点且仍在活跃时段的跟进；最多 followUpMaxRounds 轮。 */
  async runDue(now = new Date()): Promise<number> {
    const rows = await this.prisma.acqFollowUp.findMany({
      where: { status: 'pending', followUpAt: { lte: now } },
      orderBy: [{ followUpAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    let sent = 0;
    const settingsCache = new Map<string, AcqSettings>();
    for (const row of rows) {
      const key = `${row.orgType}:${row.orgUserId}`;
      let settings = settingsCache.get(key);
      if (!settings) {
        settings = await this.settings.forOrg(row);
        settingsCache.set(key, settings);
      }
      if (!settings.enabled) continue;
      if (
        !withinActiveHours(
          now,
          settings.activeHoursStart,
          settings.activeHoursEnd,
        )
      ) {
        continue;
      }
      const attempt = row.retryCount + 1;
      if (attempt > settings.followUpMaxRounds) {
        await this.finish(
          orgOfKey(row),
          row,
          'cancelled',
          '已达到跟进轮次上限',
        );
        continue;
      }
      const text = await this.compose(row, settings);
      const blocked = await this.moderate(row.orgUserId, text);
      if (blocked) {
        await this.prisma.acqFollowUpReceipt.create({
          data: {
            followUpId: row.id,
            attempt,
            text: clip(text, 4000),
            accountId: row.accountId,
            operationId: '',
            status: 'blocked',
          },
        });
        await this.finish(
          orgOfKey(row),
          row,
          'cancelled',
          `内容安全拦截：${blocked}`,
          attempt,
        );
        continue;
      }
      const operationId = `acq-fu-${row.id}-${attempt}-${randomBytes(3).toString('hex')}`;
      try {
        await this.prisma.acqFollowUpReceipt.create({
          data: {
            followUpId: row.id,
            attempt,
            text: clip(text, 4000),
            accountId: row.accountId,
            operationId,
            status: 'intent',
          },
        });
      } catch (error) {
        // 账本已有同轮记录：说明上一次已发过，绝不重发
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }
      const delivery = await this.deliver(row, text, operationId);
      if (delivery.ok) {
        await this.prisma.acqFollowUp.update({
          where: { id: row.id },
          data: { status: 'sent_once', retryCount: attempt, sentText: text },
        });
        await this.prisma.acqFollowUpReceipt.updateMany({
          where: { followUpId: row.id, attempt },
          data: { status: 'submitted' },
        });
        await this.event(orgOfKey(row), row.profileId, row.id, 'FOLLOW_UP', {
          summary: `跟进已发出（第 ${attempt} 轮）`,
          payload: { operationId, text: clip(text, 200) },
        });
        await this.touchContact(row.profileId);
        sent += 1;
      } else {
        await this.prisma.acqFollowUpReceipt.updateMany({
          where: { followUpId: row.id, attempt },
          data: { status: 'failed' },
        });
        await this.retryOrStop(
          orgOfKey(row),
          row,
          attempt,
          delivery.error || '发送失败',
          settings.followUpMaxRounds,
        );
      }
    }
    return sent;
  }

  /** 插件/邮件回执：按账本 operationId 落结果；unknown 不重发。 */
  async receipt(input: {
    followUpId: number;
    status: 'submitted' | 'succeeded' | 'failed' | 'unknown';
    ref?: string;
    error?: string;
  }) {
    const row = await this.prisma.acqFollowUp.findUnique({
      where: { id: input.followUpId },
    });
    if (!row || ['completed', 'cancelled'].includes(row.status)) return;
    await this.prisma.acqFollowUpReceipt.updateMany({
      where: {
        followUpId: row.id,
        attempt: input.status === 'unknown' ? undefined : row.retryCount,
        ...(input.status === 'unknown' ? { status: 'intent' } : {}),
      },
      data: { status: input.status },
    });
    if (input.status === 'succeeded') {
      await this.touchContact(row.profileId);
      return;
    }
    if (input.status === 'failed') {
      const settings = await this.settings.forOrg(row);
      await this.retryOrStop(
        orgOfKey(row),
        row,
        row.retryCount,
        input.error || '发送失败',
        settings.followUpMaxRounds,
      );
    }
  }

  /** 对账：有意图无回执超过 30 分钟记 unknown，不覆盖旧账本、不自动重发。 */
  async reconcile(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - 30 * 60_000);
    const result = await this.prisma.acqFollowUpReceipt.updateMany({
      where: { status: 'intent', createdAt: { lt: before } },
      data: { status: 'unknown' },
    });
    if (result.count) {
      this.warnOnce(
        'follow-up-reconcile',
        new Error(
          `${result.count} 条跟进回执超时未回，已记 unknown，不自动重发`,
        ),
      );
    }
    return result.count;
  }

  private async compose(
    row: FollowUpRow,
    settings: { aiModel: string; aiChannelId: number },
  ) {
    const profile = await this.prisma.acqProfile.findUnique({
      where: { id: row.profileId },
    });
    const prompt = [
      `客户：${profile?.displayName || row.channelPeerKey}`,
      `上次沟通：${row.contextSummary || row.reason}`,
      `这次要跟进的原因：${row.reason}`,
      `已发过的内容：${row.sentText || '（无）'}`,
    ].join('\n');
    const ai = await aiJson<{ text: string }>(this.prisma, {
      userId: row.orgUserId,
      model: settings.aiModel || undefined,
      channelId: settings.aiChannelId || undefined,
      messages: [
        { role: 'system', content: GENERATE_SYSTEM },
        { role: 'user', content: prompt },
      ],
      purpose: 'chat',
      module: 'acquisition',
      operation: 'follow_up_text',
      validate: (raw) => {
        const value = clip(raw.text, 300);
        return value ? { text: value } : null;
      },
    }).catch(() => null);
    if (ai) return ai.data.text;
    const name = clip(text(profile?.displayName), 20);
    return clip(
      `${name ? `${name}你好，` : '你好，'}上次你提到「${clip(row.reason, 60)}」，今天方便继续聊一下吗？`,
      300,
    );
  }

  private async moderate(ownerUserId: string, content: string) {
    try {
      await this.publishReview.guard({
        userId: ownerUserId,
        scene: 'acquisition_outreach',
        texts: [content],
      });
      return '';
    } catch (error) {
      const message = (error as Error)?.message || '内容安全拦截';
      // 未配置内容安全时 guard 会放行；真正拦截才停发
      if (
        error instanceof BusinessException &&
        error.errorCode === ErrorCode.CONTENT_MODERATION_BLOCKED
      ) {
        return message;
      }
      this.warnOnce('follow-up-moderation', error);
      return '';
    }
  }

  private async deliver(
    row: FollowUpRow,
    content: string,
    operationId: string,
  ) {
    try {
      if (row.channel === 'XHS_DM') {
        await this.enqueueCheck(row, content, operationId, 'XHS_DM', 'DM');
        return { ok: true };
      }
      if (row.channel === 'EMAIL') {
        const email = await this.emailOf(row);
        if (!email) {
          return {
            ok: false,
            error: '该客户没有邮箱：先在 CRM 补全邮箱再发跟进',
          };
        }
        await this.enqueueCheck(row, content, operationId, 'EMAIL', 'EMAIL', {
          toEmail: email,
        });
        return { ok: true };
      }
      if (row.channel === 'WECOM') {
        if (!this.sendChannel) {
          return {
            ok: false,
            error: '企微通道未接入：请在服务台配置渠道后重试',
          };
        }
        const result = await this.sendChannel({
          ownerUserId: row.orgUserId,
          channel: row.channel,
          externalUserId: row.externalUserId,
          text: content,
        });
        return result.ok
          ? { ok: true }
          : { ok: false, error: result.error || '企微通道发送失败' };
      }
      return { ok: false, error: `不支持的跟进渠道：${row.channel}` };
    } catch (error) {
      return { ok: false, error: (error as Error)?.message || '发送失败' };
    }
  }

  /** 插件/邮件都复用触达任务表与既有回执链路，不另造一套发送器。 */
  private async enqueueCheck(
    row: FollowUpRow,
    content: string,
    operationId: string,
    channel: string,
    action: string,
    payload: Row = {},
  ) {
    const leadId = await this.leadIdOf(row);
    await this.prisma.acqOutreachTask.create({
      data: {
        orgType: row.orgType,
        orgUserId: row.orgUserId,
        leadId,
        channel,
        action,
        targetUrl: '',
        externalUserId: clip(row.externalUserId, 160),
        draft: content,
        finalText: content,
        status: 'QUEUED',
        moderation: 'pass',
        moderationNote: '跟进消息已在服务端通过内容安全',
        jobId: operationId,
        payload: json({ ...payload, followUpId: row.id }),
        costConfirmed: true,
        playbookId: row.playbookId,
        scheduledAt: new Date(),
        logs: json([
          {
            at: iso(new Date()),
            step: '跟进',
            result: '已入队',
            detail: clip(`跟进 #${row.id} 第 ${row.retryCount + 1} 轮`, 300),
          },
        ]),
        createdBy: row.orgUserId,
      },
    });
  }

  private async leadIdOf(row: FollowUpRow) {
    const profile = await this.prisma.acqProfile.findUnique({
      where: { id: row.profileId },
      select: { crmLeadId: true },
    });
    if (!profile?.crmLeadId) return 0;
    const lead = await this.prisma.acqLead.findFirst({
      where: {
        orgType: row.orgType,
        orgUserId: row.orgUserId,
        crmLeadId: profile.crmLeadId,
        deletedAt: null,
      },
      select: { id: true },
    });
    return lead?.id || 0;
  }

  private async emailOf(row: FollowUpRow) {
    const profile = await this.prisma.acqProfile.findUnique({
      where: { id: row.profileId },
      select: { crmLeadId: true },
    });
    if (!profile?.crmLeadId) return '';
    const lead = await this.prisma.crmLead.findUnique({
      where: { id: profile.crmLeadId },
      select: { email: true },
    });
    return clip(text(lead?.email), 120);
  }

  private async retryOrStop(
    org: OrgKey,
    row: FollowUpRow,
    attempt: number,
    error: string,
    maxRounds: number,
  ) {
    if (attempt >= maxRounds) {
      await this.finish(
        org,
        row,
        'cancelled',
        `跟进失败且已达轮次上限：${error}`,
        attempt,
      );
      return;
    }
    await this.prisma.acqFollowUp.update({
      where: { id: row.id },
      data: {
        status: 'pending',
        retryCount: attempt,
        followUpAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    await this.event(org, row.profileId, row.id, 'FOLLOW_UP', {
      summary: `跟发送失败，${maxRounds - attempt} 轮后仍失败将停止：${error}`,
      payload: { status: 'retry', attempt },
    });
  }

  private async finish(
    org: OrgKey,
    row: FollowUpRow,
    status: 'cancelled' | 'completed',
    reason: string,
    attempt = row.retryCount,
  ) {
    await this.prisma.acqFollowUp.update({
      where: { id: row.id },
      data: {
        status,
        retryCount: attempt,
        completedAt: new Date(),
        reason: clip(`${row.reason}｜${reason}`, 300),
      },
    });
    await this.event(org, row.profileId, row.id, 'FOLLOW_UP', {
      summary: reason,
      payload: { status },
    });
  }

  private async cancelPending(org: OrgKey, profileId: number, reason: string) {
    const rows = await this.prisma.acqFollowUp.findMany({
      where: { ...orgKey(org), profileId, status: 'pending' },
      select: { id: true, profileId: true },
    });
    if (!rows.length) return;
    await this.prisma.acqFollowUp.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    for (const row of rows) {
      await this.event(org, row.profileId, row.id, 'FOLLOW_UP', {
        summary: `跟进已取消：${reason}`,
        payload: { status: 'cancelled' },
      });
    }
  }

  private async event(
    org: OrgKey,
    profileId: number,
    refId: number,
    kind: string,
    input: { summary: string; payload: Row },
  ) {
    await this.prisma.acqProfileEvent
      .create({
        data: {
          profileId,
          ...orgKey(org),
          kind,
          refId,
          summary: clip(input.summary, 500),
          payload: json(input.payload),
        },
      })
      .catch((error) => this.warnOnce(`follow-up-event-${refId}`, error));
  }

  private async touchContact(profileId: number) {
    await this.prisma.acqProfile
      .update({ where: { id: profileId }, data: { lastContactAt: new Date() } })
      .catch(() => undefined);
  }

  private async profileNames(org: HrmOrg | OrgKey, ids: number[]) {
    const unique = [...new Set(ids.filter((id) => id > 0))];
    if (!unique.length) return new Map<number, string>();
    const rows = await this.prisma.acqProfile.findMany({
      where: { id: { in: unique }, ...orgKey(org) },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  private async requireRow(org: HrmOrg | OrgKey, id: number) {
    const row = await this.prisma.acqFollowUp.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '跟进计划不存在');
    return row;
  }

  private async audit(userId: string, action: string, detail: string) {
    await this.prisma.auditLog
      .create({ data: { userId, action, detail: clip(detail, 500) } })
      .catch((error) => this.warnOnce(`follow-up-audit-${action}`, error));
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'acquisition_follow_up_warning',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private view(row: FollowUpRow, profileName: string) {
    return {
      id: row.id,
      profileId: row.profileId,
      profileName,
      channelPeerKey: row.channelPeerKey,
      externalUserId: row.externalUserId,
      channel: row.channel,
      accountId: row.accountId,
      followUpAt: iso(row.followUpAt),
      reason: row.reason,
      contextSummary: row.contextSummary,
      status: oneOf(row.status, ACQ_FOLLOW_UP_STATUSES, 'pending'),
      sentText: row.sentText,
      retryCount: row.retryCount,
      completedAt: row.completedAt ? iso(row.completedAt) : '',
      createdAt: iso(row.createdAt),
    };
  }
}

const orgOfKey = (row: OrgKey) => ({
  orgType: row.orgType,
  orgUserId: row.orgUserId,
});
