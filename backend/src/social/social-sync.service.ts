import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { AipddKeyService } from '../account/aipdd-key.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  AiworkinSocialService,
  SocialUpstreamError,
} from './aiworkin-social.service';

const WRITE_ACTIONS = [
  'FRIEND_REQUEST_SEND',
  'FRIEND_REQUEST_HANDLE',
  'MAIL_SEND',
  'BACKFILL_FRIEND',
];

/** 上游 Skill 标注的写额度：5/Key/小时、20/用户/天。 */
const WRITE_LIMIT_PER_HOUR = 5;
const WRITE_LIMIT_PER_DAY = 20;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

export type SyncState =
  'NONE' | 'PENDING' | 'SYNCED' | 'FAILED' | 'SKIPPED' | 'DEAD';

export type SyncOutcome = {
  state: SyncState;
  peerHasKey: boolean;
  reason: string;
};

export type SyncPreferences = {
  discoverable: boolean;
  recommendEnabled: boolean;
  businessReasonVisible: boolean;
  friendRequestOutbound: boolean;
  friendRelationOutbound: boolean;
  friendRelationInbound: boolean;
  mailOutboundDefault: boolean;
  mailInbound: boolean;
  channel: string;
};

const DEFAULT_PREFERENCES: SyncPreferences = {
  discoverable: true,
  recommendEnabled: true,
  businessReasonVisible: true,
  friendRequestOutbound: true,
  friendRelationOutbound: true,
  friendRelationInbound: false,
  mailOutboundDefault: false,
  mailInbound: false,
  channel: 'AUTO',
};

const hash16 = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

const friendKey = (a: string, b: string) =>
  a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };

/** 幂等键需 16–100 字符：短 key 补齐，长 key 截断。 */
export const normalizeIdempotencyKey = (raw: string): string =>
  raw.padEnd(16, '0').slice(0, 100);

/** 队列负载里的标量取文本：上游 payload 是任意 JSON，只认字符串 / 数字 / 布尔。 */
const payloadText = (value: unknown, fallback = ''): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : fallback;

/**
 * 跨站同步编排：
 * - 域表的 `syncState` 面向列表展示，`social_sync_jobs` 负责可靠投递与重试；
 * - 所有写操作先入队，本地成功不依赖上游；入站只做 additive，不删除本地数据；
 * - 额度在入队时检查，超额顺延而不是失败。
 */
export class SocialSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upstream: AiworkinSocialService,
    private readonly keys: AipddKeyService,
  ) {}

  // ---------- 偏好 ----------
  async preferences(userId: string): Promise<SyncPreferences> {
    const row = await this.prisma.socialSyncPreference.findUnique({
      where: { userId },
    });
    if (!row) return { ...DEFAULT_PREFERENCES };
    return {
      discoverable: row.discoverable,
      recommendEnabled: row.recommendEnabled,
      businessReasonVisible: row.businessReasonVisible,
      friendRequestOutbound: row.friendRequestOutbound,
      friendRelationOutbound: row.friendRelationOutbound,
      friendRelationInbound: row.friendRelationInbound,
      mailOutboundDefault: row.mailOutboundDefault,
      mailInbound: row.mailInbound,
      channel: row.channel,
    };
  }

  async savePreferences(
    userId: string,
    input: Partial<SyncPreferences>,
  ): Promise<SyncPreferences> {
    const current = await this.preferences(userId);
    const next: SyncPreferences = { ...current };
    for (const key of Object.keys(DEFAULT_PREFERENCES) as Array<
      keyof SyncPreferences
    >) {
      const value = input[key];
      if (value === undefined) continue;
      if (key === 'channel') {
        const channel = payloadText(value);
        next.channel = ['AUTO', 'MCP', 'LEGACY'].includes(channel)
          ? channel
          : current.channel;
      } else if (value !== null && typeof value === 'object') {
        continue;
      } else {
        next[key] = Boolean(value);
      }
    }
    await this.prisma.socialSyncPreference.upsert({
      where: { userId },
      create: { userId, ...next },
      update: next,
    });
    // 关闭开关后，已入队未执行的同类任务立即取消，避免“关了还发”
    const cancels: Prisma.SocialSyncJobWhereInput[] = [];
    if (!next.friendRequestOutbound)
      cancels.push({ action: 'FRIEND_REQUEST_SEND' });
    if (!next.friendRelationOutbound)
      cancels.push({ action: 'FRIEND_REQUEST_HANDLE' });
    if (!next.friendRelationInbound) cancels.push({ action: 'RELATION_PULL' });
    if (!next.mailInbound) cancels.push({ action: 'MAIL_PULL' });
    if (cancels.length) {
      await this.prisma.socialSyncJob.updateMany({
        where: { userId, status: 'PENDING', OR: cancels },
        data: {
          status: 'DEAD',
          lastError: '用户已关闭对应同步开关',
          completedAt: new Date(),
        },
      });
    }
    return next;
  }

  // ---------- 入队 ----------
  private async quota(userId: string, keyId: number) {
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0);
    const [hourUsed, dayUsed] = await Promise.all([
      this.prisma.socialSyncJob.count({
        where: {
          keyId,
          action: { in: WRITE_ACTIONS },
          createdAt: { gte: hourStart },
        },
      }),
      this.prisma.socialSyncJob.count({
        where: {
          userId,
          action: { in: WRITE_ACTIONS },
          createdAt: { gte: dayStart },
        },
      }),
    ]);
    return {
      writesUsedThisHour: hourUsed,
      writesLimitPerHour: WRITE_LIMIT_PER_HOUR,
      writesUsedToday: dayUsed,
      writesLimitPerDay: WRITE_LIMIT_PER_DAY,
    };
  }

  /** 超额写任务顺延到下一小时 / 次日，保持 PENDING，不丢也不绕过限流。 */
  private async nextAttemptAt(userId: string, keyId: number): Promise<Date> {
    const quota = await this.quota(userId, keyId);
    if (quota.writesUsedToday >= WRITE_LIMIT_PER_DAY) {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(0, 5, 0, 0);
      return next;
    }
    if (quota.writesUsedThisHour >= WRITE_LIMIT_PER_HOUR) {
      const next = new Date();
      next.setHours(next.getHours() + 1, 5, 0, 0);
      return next;
    }
    return new Date();
  }

  private async enqueue(input: {
    userId: string;
    keyId: number;
    action: string;
    localType: string;
    localId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    direction?: 'OUTBOUND' | 'INBOUND';
  }) {
    const key = normalizeIdempotencyKey(input.idempotencyKey);
    const existing = await this.prisma.socialSyncJob.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return existing;
    const nextAttemptAt =
      input.direction === 'INBOUND'
        ? new Date()
        : await this.nextAttemptAt(input.userId, input.keyId);
    return this.prisma.socialSyncJob.create({
      data: {
        userId: input.userId,
        keyId: input.keyId,
        direction: input.direction || 'OUTBOUND',
        action: input.action,
        localType: input.localType,
        localId: input.localId,
        payload: input.payload as Prisma.InputJsonValue,
        idempotencyKey: key,
        nextAttemptAt,
      },
    });
  }

  // ---------- 好友申请：出站 ----------
  async afterFriendRequest(input: {
    fromUserId: string;
    toUserId: string;
    requestId: number;
    message: string;
    syncUpstream?: boolean;
  }): Promise<SyncOutcome> {
    const pref = await this.preferences(input.fromUserId);
    const enabled = input.syncUpstream ?? pref.friendRequestOutbound;
    if (!enabled)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'USER_DISABLED',
      };
    const sender = await this.upstream.resolveIdentity(input.fromUserId);
    if (sender.state !== 'READY')
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: sender.state,
      };
    const peer = await this.upstream.peerReady(input.toUserId);
    if (!peer.ready)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'PEER_NO_KEY',
      };
    await this.enqueue({
      userId: input.fromUserId,
      keyId: sender.keyId,
      action: 'FRIEND_REQUEST_SEND',
      localType: 'FRIEND_REQUEST',
      localId: String(input.requestId),
      payload: {
        toUpstreamUserId: peer.upstreamUserId,
        message: input.message.slice(0, 200),
      },
      idempotencyKey: `sns-fr-${input.requestId}-${hash16(input.message)}`,
    });
    await this.prisma.friendRequest.update({
      where: { id: input.requestId },
      data: { syncState: 'PENDING' },
    });
    return { state: 'PENDING', peerHasKey: true, reason: '' };
  }

  // ---------- 好友申请：接受/拒绝回写 ----------
  async afterFriendHandle(input: {
    userId: string;
    requestId: number;
    fromUserId: string;
    upstreamRequestId: string;
    action: 'ACCEPT' | 'REJECT';
    syncUpstream?: boolean;
  }): Promise<SyncOutcome> {
    const pref = await this.preferences(input.userId);
    const enabled = input.syncUpstream ?? pref.friendRelationOutbound;
    if (!enabled)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'USER_DISABLED',
      };
    if (!input.upstreamRequestId)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'NO_REMOTE_REQUEST',
      };
    const handler = await this.upstream.resolveIdentity(input.userId);
    if (handler.state !== 'READY')
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: handler.state,
      };
    const peer = await this.upstream.peerReady(input.fromUserId);
    if (!peer.ready)
      return {
        state: 'SKIPPED',
        peerHasKey: true,
        reason: 'PEER_NO_KEY',
      };
    await this.enqueue({
      userId: input.userId,
      keyId: handler.keyId,
      action: 'FRIEND_REQUEST_HANDLE',
      localType: 'FRIEND_REQUEST',
      localId: String(input.requestId),
      payload: {
        remoteRequestId: input.upstreamRequestId,
        action: input.action,
      },
      idempotencyKey: `sns-frh-${input.requestId}-${input.action}`,
    });
    await this.prisma.friendRequest.update({
      where: { id: input.requestId },
      data: { syncState: 'PENDING' },
    });
    return { state: 'PENDING', peerHasKey: true, reason: '' };
  }

  // ---------- 私信：出站 ----------
  async afterMail(input: {
    fromUserId: string;
    toUserId: string;
    messageId: number;
    threadId: number;
    subject: string;
    body: string;
    linkCards: Array<Record<string, unknown>>;
    syncUpstream?: boolean;
  }): Promise<SyncOutcome> {
    const pref = await this.preferences(input.fromUserId);
    const enabled = input.syncUpstream ?? pref.mailOutboundDefault;
    if (!enabled)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'USER_DISABLED',
      };
    const sender = await this.upstream.resolveIdentity(input.fromUserId);
    if (sender.state !== 'READY')
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: sender.state,
      };
    if (input.body.length > 3000)
      return {
        state: 'SKIPPED',
        peerHasKey: true,
        reason: 'BODY_TOO_LONG',
      };
    if (input.subject.length > 200)
      return {
        state: 'SKIPPED',
        peerHasKey: true,
        reason: 'SUBJECT_TOO_LONG',
      };
    const cards = input.linkCards
      .filter((card) => /^https?:\/\//i.test(payloadText(card.url)))
      .slice(0, 5)
      .map((card) => ({
        title: payloadText(card.title, '链接').slice(0, 120),
        url: payloadText(card.url).slice(0, 500),
      }));
    if (input.linkCards.length > 5)
      return {
        state: 'SKIPPED',
        peerHasKey: true,
        reason: 'TOO_MANY_CARDS',
      };
    const peer = await this.upstream.peerReady(input.toUserId);
    if (!peer.ready)
      return {
        state: 'SKIPPED',
        peerHasKey: false,
        reason: 'PEER_NO_KEY',
      };
    await this.enqueue({
      userId: input.fromUserId,
      keyId: sender.keyId,
      action: 'MAIL_SEND',
      localType: 'MAIL_MESSAGE',
      localId: String(input.messageId),
      payload: {
        toUpstreamUserId: peer.upstreamUserId,
        subject: input.subject,
        body: input.body,
        linkCards: cards,
        threadId: input.threadId,
      },
      idempotencyKey: `sns-mail-${input.messageId}-${hash16(input.body)}`,
    });
    await this.prisma.snsMessage.update({
      where: { id: input.messageId },
      data: { syncState: 'PENDING' },
    });
    return { state: 'PENDING', peerHasKey: true, reason: '' };
  }

  // ---------- 入站 ----------
  private async localIdentityMap(upstreamIds: string[]) {
    if (!upstreamIds.length) return new Map<string, string>();
    const rows = await this.prisma.socialUpstreamIdentity.findMany({
      where: { upstreamUserId: { in: upstreamIds } },
      select: { userId: true, upstreamUserId: true },
    });
    return new Map(rows.map((row) => [row.upstreamUserId, row.userId]));
  }

  async pullRelationships(userId: string, token: string) {
    const relations = await this.upstream.listRelationships(token);
    const map = await this.localIdentityMap(relations.map((row) => row.userId));
    const accepted = relations.filter((row) => {
      const status = row.status;
      if (!status) return true;
      return /FRIEND|ACCEPT|MUTUAL|CONNECTED/.test(status);
    });
    let imported = 0;
    let linked = 0;
    let conflicts = 0;
    let skipped = 0;
    for (const relation of accepted) {
      const peerLocalId = map.get(relation.userId);
      if (!peerLocalId || peerLocalId === userId) {
        skipped += 1;
        continue;
      }
      const [blocked, existing] = await Promise.all([
        this.prisma.block.findFirst({
          where: {
            OR: [
              { userId, blockedUserId: peerLocalId },
              { userId: peerLocalId, blockedUserId: userId },
            ],
          },
          select: { id: true },
        }),
        this.prisma.friendship.findUnique({
          where: { userAId_userBId: friendKey(userId, peerLocalId) },
        }),
      ]);
      if (blocked) {
        conflicts += 1;
        await this.prisma.socialSyncLink.upsert({
          where: {
            userId_kind_localId: {
              userId,
              kind: 'FRIENDSHIP',
              localId: `${friendKey(userId, peerLocalId).userAId}:${friendKey(userId, peerLocalId).userBId}`,
            },
          },
          create: {
            userId,
            kind: 'FRIENDSHIP',
            localId: `${friendKey(userId, peerLocalId).userAId}:${friendKey(userId, peerLocalId).userBId}`,
            remoteId: relation.userId,
            direction: 'INBOUND',
            state: 'CONFLICT',
            lastSyncedAt: new Date(),
          },
          update: { state: 'CONFLICT', lastSyncedAt: new Date() },
        });
        continue;
      }
      if (existing) {
        await this.prisma.friendship.update({
          where: { id: existing.id },
          data: {
            syncState: 'SYNCED',
            source: existing.source === 'LOCAL' ? 'BOTH' : existing.source,
          },
        });
        linked += 1;
      } else {
        await this.prisma.friendship.create({
          data: {
            ...friendKey(userId, peerLocalId),
            source: 'AIWORKIN',
            syncState: 'SYNCED',
          },
        });
        imported += 1;
      }
      const key = friendKey(userId, peerLocalId);
      await this.prisma.socialSyncLink.upsert({
        where: {
          userId_kind_localId: {
            userId,
            kind: 'FRIENDSHIP',
            localId: `${key.userAId}:${key.userBId}`,
          },
        },
        create: {
          userId,
          kind: 'FRIENDSHIP',
          localId: `${key.userAId}:${key.userBId}`,
          remoteId: relation.userId,
          direction: 'INBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
        update: {
          remoteId: relation.userId,
          direction: 'INBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
    }
    await this.touchIdentity(userId);
    return { imported, linked, conflicts, skipped, total: accepted.length };
  }

  async pullMail(userId: string, token: string) {
    const [inbox, sent] = await Promise.all([
      this.upstream.listMail(token, 'INBOX'),
      this.upstream.listMail(token, 'SENT'),
    ]);
    const rows = [
      ...inbox.map((row) => ({ ...row, direction: 'INBOX' as const })),
      ...sent.map((row) => ({ ...row, direction: 'SENT' as const })),
    ];
    const peerIds = rows.map((row) =>
      row.direction === 'INBOX' ? row.fromUserId : row.toUserId,
    );
    const map = await this.localIdentityMap(peerIds);
    const remoteIds = [...new Set(rows.map((row) => row.id))];
    const existing = remoteIds.length
      ? await this.prisma.socialSyncLink.findMany({
          where: {
            userId,
            kind: 'MAIL_MESSAGE',
            remoteId: { in: remoteIds },
          },
          select: { remoteId: true },
        })
      : [];
    const seen = new Set(existing.map((row) => row.remoteId));
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const peerUpstream =
        row.direction === 'INBOX' ? row.fromUserId : row.toUserId;
      const peerLocal = map.get(peerUpstream);
      if (!peerLocal || peerLocal === userId) {
        skipped += 1;
        continue;
      }
      const localFrom = row.direction === 'INBOX' ? peerLocal : userId;
      const localTo = row.direction === 'INBOX' ? userId : peerLocal;
      if (!row.body.trim()) {
        skipped += 1;
        continue;
      }
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const when = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
      const key = friendKey(localFrom, localTo);
      const thread = await this.prisma.mailThread.upsert({
        where: { userAId_userBId: key },
        create: {
          ...key,
          subject: row.subject.slice(0, 200),
          lastMessageAt: when,
        },
        update: {
          lastMessageAt: when,
        },
      });
      const cards = row.linkCards.map((card) => ({
        kind: 'LINK' as const,
        title: card.title,
        url: card.url,
      }));
      const message = await this.prisma.snsMessage.create({
        data: {
          threadId: thread.id,
          fromUserId: localFrom,
          toUserId: localTo,
          subject: row.subject.slice(0, 200),
          body: row.body.slice(0, 20000),
          linkCards: cards,
          aiGenerated: row.aiGenerated,
          readUserIds: row.direction === 'SENT' || row.read ? [userId] : [],
          source: 'AIWORKIN',
          upstreamMessageId: row.id.slice(0, 120),
          syncState: 'SYNCED',
          createdAt: when,
        },
      });
      await this.prisma.socialSyncLink.create({
        data: {
          userId,
          kind: 'MAIL_MESSAGE',
          localId: String(message.id),
          remoteId: row.id.slice(0, 120),
          remoteParentId: '',
          direction: 'INBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
      imported += 1;
    }
    await this.touchIdentity(userId);
    return { imported, skipped, total: rows.length };
  }

  private async touchIdentity(userId: string) {
    await this.prisma.socialUpstreamIdentity
      .updateMany({
        where: { userId },
        data: { lastSyncedAt: new Date() },
      })
      .catch(() => undefined);
  }

  // ---------- 概览 / 任务 ----------
  async overview(userId: string) {
    const identity = await this.upstream.resolveIdentity(userId);
    const preferences = await this.preferences(userId);
    const [quota, groups, lastFailed, identityRow] = await Promise.all([
      identity.keyId
        ? this.quota(userId, identity.keyId)
        : Promise.resolve({
            writesUsedThisHour: 0,
            writesLimitPerHour: WRITE_LIMIT_PER_HOUR,
            writesUsedToday: 0,
            writesLimitPerDay: WRITE_LIMIT_PER_DAY,
          }),
      this.prisma.socialSyncJob.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.socialSyncJob.findFirst({
        where: { userId, status: { in: ['FAILED', 'DEAD'] } },
        orderBy: { updatedAt: 'desc' },
        select: { lastError: true, updatedAt: true },
      }),
      this.prisma.socialUpstreamIdentity.findUnique({
        where: { userId },
        select: { lastSyncedAt: true },
      }),
    ]);
    const counts = { pending: 0, failed: 0, dead: 0 };
    for (const row of groups) {
      if (row.status === 'PENDING' || row.status === 'RUNNING')
        counts.pending += row._count._all;
      else if (row.status === 'FAILED') counts.failed += row._count._all;
      else if (row.status === 'DEAD') counts.dead += row._count._all;
    }
    return {
      identity: {
        state: identity.state,
        upstreamUserId: identity.upstreamUserId,
        upstreamUsername: identity.upstreamUsername,
        mailAddress: identity.mailAddress,
        verified: identity.verified,
        verifiedAt: identity.verifiedAt?.toISOString() || null,
      },
      quota,
      counts,
      lastPullAt: identityRow?.lastSyncedAt?.toISOString() || null,
      lastError: lastFailed?.lastError || '',
      lastErrorAt: lastFailed?.updatedAt.toISOString() || null,
      preferences,
      keyBound: Boolean(identity.keyId),
    };
  }

  async jobs(userId: string, status?: string, take = 20) {
    const rows = await this.prisma.socialSyncJob.findMany({
      where: {
        userId,
        ...(status && status !== 'ALL' ? { status } : {}),
      },
      orderBy: { id: 'desc' },
      take: Math.max(1, Math.min(50, take)),
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      direction: row.direction,
      localType: row.localType,
      localId: row.localId,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      lastError: row.lastError,
      remoteId: row.remoteId,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() || null,
    }));
  }

  async retry(userId: string, jobId: number) {
    const row = await this.prisma.socialSyncJob.findUnique({
      where: { id: jobId },
    });
    if (!row || row.userId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步任务不存在');
    if (row.status !== 'FAILED' && row.status !== 'DEAD')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有失败任务可以重试',
      );
    await this.prisma.socialSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lastError: '',
        completedAt: null,
      },
    });
    return { retried: true };
  }

  // ---------- 立即拉取 ----------
  async pull(userId: string) {
    const identity = await this.upstream.resolveIdentity(userId);
    if (identity.state !== 'READY')
      throw new BusinessException(
        identity.state === 'UNBOUND' || identity.state === 'KEY_INACTIVE'
          ? ErrorCode.FORBIDDEN
          : ErrorCode.SERVICE_UNAVAILABLE,
        identity.state === 'PLACEHOLDER_ID'
          ? '当前 Key 未返回真实 AIworkin 用户编号，无法拉取社交数据；请重新验证 Key 或联系管理员'
          : '尚未绑定有效的 AIPDD API Key，请先到「模型服务 → API Key 管理」完成绑定',
      );
    const pref = await this.preferences(userId);
    if (!pref.friendRelationInbound && !pref.mailInbound)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先在同步设置中开启「好友关系回流」或「私信回流」',
      );
    const actions: string[] = [];
    if (pref.friendRelationInbound) {
      await this.enqueue({
        userId,
        keyId: identity.keyId,
        action: 'RELATION_PULL',
        localType: 'FRIENDSHIP',
        localId: '',
        payload: {},
        idempotencyKey: `sns-rp-${userId}-${Date.now()}`,
        direction: 'INBOUND',
      });
      actions.push('RELATION_PULL');
    }
    if (pref.mailInbound) {
      await this.enqueue({
        userId,
        keyId: identity.keyId,
        action: 'MAIL_PULL',
        localType: 'MAIL_MESSAGE',
        localId: '',
        payload: {},
        idempotencyKey: `sns-mp-${userId}-${Date.now()}`,
        direction: 'INBOUND',
      });
      actions.push('MAIL_PULL');
    }
    return { queued: actions };
  }

  /** 显式验证身份：调用一次读工具并把状态落库。 */
  async verify(userId: string) {
    const identity = await this.upstream.verifyIdentity(userId);
    return {
      state: identity.state,
      verified: identity.verified,
      upstreamUsername: identity.upstreamUsername,
      mailAddress: identity.mailAddress,
    };
  }

  // ---------- 好友批量回填 ----------
  private async backfillCandidates(userId: string) {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      take: 500,
    });
    const friendIds = rows.map((row) =>
      row.userAId === userId ? row.userBId : row.userAId,
    );
    if (!friendIds.length) return [];
    const bindings = await this.prisma.userAipddBinding.findMany({
      where: { userId: { in: friendIds } },
    });
    const keys = await this.prisma.aipddKey.findMany({
      where: { id: { in: bindings.map((row) => row.keyId) } },
    });
    const keyMap = new Map(keys.map((row) => [row.id, row]));
    const ready = new Map<string, string>();
    for (const binding of bindings) {
      const key = keyMap.get(binding.keyId);
      const upstreamUserId = String(key?.aipddUserId || '').trim();
      if (
        key &&
        key.status === 'ACTIVE' &&
        this.upstream.isUpstreamUserId(upstreamUserId)
      )
        ready.set(binding.userId, upstreamUserId);
    }
    const links = await this.prisma.socialSyncLink.findMany({
      where: { userId, kind: 'FRIENDSHIP' },
      select: { localId: true },
    });
    const linkedFriends = new Set(
      links.map((row) => row.localId.split(':')).flat(),
    );
    return friendIds
      .filter((id) => ready.has(id) && !linkedFriends.has(id))
      .map((id) => ({ friendId: id, upstreamUserId: ready.get(id)! }));
  }

  async backfillEstimate(userId: string) {
    const candidates = await this.backfillCandidates(userId);
    return {
      total: candidates.length,
      syncable: candidates.length,
      estimatedDays: Math.ceil(candidates.length / WRITE_LIMIT_PER_DAY),
    };
  }

  async backfillStart(userId: string, confirm: boolean) {
    const estimate = await this.backfillEstimate(userId);
    if (!confirm) return { ...estimate, started: false, queued: 0 };
    const identity = await this.upstream.resolveIdentity(userId);
    if (identity.state !== 'READY')
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '请先绑定并验证个人 API Key，再批量回填好友',
      );
    const candidates = (await this.backfillCandidates(userId)).slice(0, 100);
    let queued = 0;
    for (const row of candidates) {
      await this.enqueue({
        userId,
        keyId: identity.keyId,
        action: 'BACKFILL_FRIEND',
        localType: 'FRIENDSHIP',
        localId:
          friendKey(userId, row.friendId).userAId +
          ':' +
          friendKey(userId, row.friendId).userBId,
        payload: {
          toUpstreamUserId: row.upstreamUserId,
          peerUserId: row.friendId,
        },
        idempotencyKey: `sns-bf-${userId}-${row.friendId}`,
      });
      queued += 1;
    }
    return { ...estimate, started: true, queued };
  }

  async backfillProgress(userId: string) {
    const [estimate, rows] = await Promise.all([
      this.backfillEstimate(userId),
      this.prisma.socialSyncJob.groupBy({
        by: ['status'],
        where: { userId, action: 'BACKFILL_FRIEND' },
        _count: { _all: true },
      }),
    ]);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row._count._all;
    return {
      ...estimate,
      pending: (counts.PENDING || 0) + (counts.RUNNING || 0),
      succeeded: counts.SUCCEEDED || 0,
      failed: counts.FAILED || 0,
      dead: counts.DEAD || 0,
    };
  }

  // ---------- 调度器执行 ----------
  async execute(jobId: number): Promise<void> {
    const job = await this.prisma.socialSyncJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.status !== 'RUNNING') return;
    const payload = (job.payload || {}) as Record<string, unknown>;
    try {
      const binding = await this.prisma.userAipddBinding.findUnique({
        where: { userId: job.userId },
      });
      if (!binding || binding.keyId !== job.keyId)
        throw new SocialUpstreamError(
          '绑定关系已变化，任务终止',
          'auth',
          false,
        );
      const token = await this.keys.resolveToken(job.userId);
      switch (job.action) {
        case 'FRIEND_REQUEST_SEND':
          await this.runFriendRequestSend(job, payload, token);
          break;
        case 'FRIEND_REQUEST_HANDLE':
          await this.runFriendHandle(job, payload, token);
          break;
        case 'MAIL_SEND':
          await this.runMailSend(job, payload, token);
          break;
        case 'RELATION_PULL':
          await this.pullRelationships(job.userId, token);
          break;
        case 'MAIL_PULL':
          await this.pullMail(job.userId, token);
          break;
        case 'BACKFILL_FRIEND':
          await this.runBackfill(job, payload, token);
          break;
        default:
          throw new SocialUpstreamError(
            `未知同步动作：${job.action}`,
            'invalid',
            false,
          );
      }
      await this.prisma.socialSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          lastError: '',
          lockedAt: null,
        },
      });
    } catch (error) {
      await this.fail(job, error, payload);
    }
  }

  private async runFriendRequestSend(
    job: { userId: string; localId: string; idempotencyKey: string },
    payload: Record<string, unknown>,
    token: string,
  ) {
    const result = await this.upstream.sendFriendRequest(
      token,
      payloadText(payload.toUpstreamUserId),
      payloadText(payload.message),
      job.idempotencyKey,
    );
    const requestId = Number(job.localId);
    if (Number.isInteger(requestId) && requestId > 0) {
      await this.prisma.friendRequest.updateMany({
        where: { id: requestId },
        data: {
          upstreamRequestId: result.requestId.slice(0, 64),
          syncState: 'SYNCED',
        },
      });
      await this.prisma.socialSyncLink.upsert({
        where: {
          userId_kind_localId: {
            userId: job.userId,
            kind: 'FRIEND_REQUEST',
            localId: job.localId,
          },
        },
        create: {
          userId: job.userId,
          kind: 'FRIEND_REQUEST',
          localId: job.localId,
          remoteId: result.requestId,
          direction: 'OUTBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
        update: {
          remoteId: result.requestId,
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  private async runFriendHandle(
    job: { localId: string; idempotencyKey: string },
    payload: Record<string, unknown>,
    token: string,
  ) {
    await this.upstream.handleFriendRequest(
      token,
      payloadText(payload.remoteRequestId),
      String(payload.action) === 'REJECT' ? 'REJECT' : 'ACCEPT',
      job.idempotencyKey,
    );
    const requestId = Number(job.localId);
    if (Number.isInteger(requestId) && requestId > 0) {
      await this.prisma.friendRequest.updateMany({
        where: { id: requestId },
        data: { syncState: 'SYNCED' },
      });
    }
  }

  private async runMailSend(
    job: { localId: string; userId: string; idempotencyKey: string },
    payload: Record<string, unknown>,
    token: string,
  ) {
    const result = await this.upstream.sendSocialMail(token, {
      toUserId: payloadText(payload.toUpstreamUserId),
      subject: payloadText(payload.subject),
      body: payloadText(payload.body),
      linkCards: Array.isArray(payload.linkCards)
        ? (payload.linkCards as Array<{ title: string; url: string }>)
        : [],
      idempotencyKey: job.idempotencyKey,
    });
    const messageId = Number(job.localId);
    if (Number.isInteger(messageId) && messageId > 0) {
      await this.prisma.snsMessage.updateMany({
        where: { id: messageId },
        data: {
          syncState: 'SYNCED',
          upstreamMessageId: result.messageId.slice(0, 120),
        },
      });
      await this.prisma.socialSyncLink.upsert({
        where: {
          userId_kind_localId: {
            userId: job.userId,
            kind: 'MAIL_MESSAGE',
            localId: job.localId,
          },
        },
        create: {
          userId: job.userId,
          kind: 'MAIL_MESSAGE',
          localId: job.localId,
          remoteId: result.messageId,
          remoteParentId: result.threadId,
          direction: 'OUTBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
        update: {
          remoteId: result.messageId,
          remoteParentId: result.threadId,
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  private async runBackfill(
    job: { userId: string; localId: string; idempotencyKey: string },
    payload: Record<string, unknown>,
    token: string,
  ) {
    await this.upstream.sendFriendRequest(
      token,
      payloadText(payload.toUpstreamUserId),
      '我们也是站内好友，一起在 AIworkin 保持联系吧',
      job.idempotencyKey,
    );
    const peerUserId = payloadText(payload.peerUserId);
    if (peerUserId) {
      const key = friendKey(job.userId, peerUserId);
      await this.prisma.friendship.updateMany({
        where: { userAId: key.userAId, userBId: key.userBId },
        data: { syncState: 'SYNCED' },
      });
      await this.prisma.socialSyncLink.upsert({
        where: {
          userId_kind_localId: {
            userId: job.userId,
            kind: 'FRIENDSHIP',
            localId: job.localId,
          },
        },
        create: {
          userId: job.userId,
          kind: 'FRIENDSHIP',
          localId: job.localId,
          remoteId: payloadText(payload.toUpstreamUserId),
          direction: 'OUTBOUND',
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
        update: {
          remoteId: payloadText(payload.toUpstreamUserId),
          state: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  private async fail(
    job: {
      id: number;
      userId: string;
      attempts: number;
      localId: string;
      action: string;
    },
    error: unknown,
    payload: Record<string, unknown>,
  ) {
    const upstream =
      error instanceof SocialUpstreamError
        ? error
        : new SocialUpstreamError(
            error instanceof Error ? error.message : String(error),
            'network',
            true,
          );
    await this.markDomainFailure(job, payload);
    if (upstream.kind === 'grant') {
      await this.prisma.socialUpstreamIdentity
        .updateMany({
          where: { userId: job.userId },
          data: {
            state: 'SNS_GRANT_MISSING',
            lastError: upstream.message.slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
    if (!upstream.retryable || job.attempts >= MAX_ATTEMPTS) {
      await this.prisma.socialSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'DEAD',
          lastError: upstream.message.slice(0, 1000),
          lockedAt: null,
          completedAt: new Date(),
        },
      });
      return;
    }
    const backoff =
      BACKOFF_MS[
        Math.min(BACKOFF_MS.length - 1, Math.max(0, job.attempts - 1))
      ];
    await this.prisma.socialSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() + backoff),
        lastError: upstream.message.slice(0, 1000),
        lockedAt: null,
      },
    });
  }

  private async markDomainFailure(
    job: { localId: string; action: string; userId: string },
    payload: Record<string, unknown>,
  ) {
    const id = Number(job.localId);
    if (!Number.isInteger(id) || id <= 0) return;
    if (job.action === 'MAIL_SEND') {
      await this.prisma.snsMessage
        .updateMany({ where: { id }, data: { syncState: 'FAILED' } })
        .catch(() => undefined);
    } else if (
      job.action === 'FRIEND_REQUEST_SEND' ||
      job.action === 'FRIEND_REQUEST_HANDLE'
    ) {
      await this.prisma.friendRequest
        .updateMany({
          where: { id },
          data: {
            syncState: 'FAILED',
          },
        })
        .catch(() => undefined);
    } else if (job.action === 'BACKFILL_FRIEND') {
      const peerUserId = payloadText(payload.peerUserId);
      if (!peerUserId) return;
      const key = friendKey(job.userId, peerUserId);
      await this.prisma.friendship
        .updateMany({
          where: {
            userAId: key.userAId,
            userBId: key.userBId,
            syncState: 'PENDING',
          },
          data: { syncState: 'FAILED' },
        })
        .catch(() => undefined);
    }
  }
}
