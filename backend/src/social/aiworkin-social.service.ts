import { PrismaService } from '../prisma/prisma.service';
import { AipddKeyService } from '../account/aipdd-key.service';
import { McpClient, McpClientError } from '../content/agent-mcp.client';
import { aiworkinBaseUrl } from '../aiworkin/aiworkin.config';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 上游 UUID 形态；本地 dev- 占位、手机号、昵称一律不算。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentityState =
  | 'UNBOUND'
  | 'KEY_INACTIVE'
  | 'PLACEHOLDER_ID'
  | 'SNS_GRANT_MISSING'
  | 'READY'
  | 'REVOKED';

export type SocialIdentity = {
  state: IdentityState;
  keyId: number;
  upstreamUserId: string;
  upstreamUsername: string;
  /** 是否已用读工具验证过 SNS 授权（缓存 24h）。 */
  verified: boolean;
  verifiedAt: Date | null;
  mailAddress: string;
};

export type UpstreamFriend = {
  userId: string;
  username: string;
  status: string;
  requestId: string;
};

export type UpstreamMail = {
  id: string;
  fromUserId: string;
  toUserId: string;
  subject: string;
  body: string;
  linkCards: Array<{ title: string; url: string }>;
  aiGenerated: boolean;
  read: boolean;
  createdAt: string;
};

/** 上游错误分类：决定 outbox 是重试还是直接 DEAD。 */
export class SocialUpstreamError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'grant' | 'rate' | 'server' | 'network' | 'invalid',
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SocialUpstreamError';
  }
}

const str = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';

const bool = (value: unknown): boolean => value === true || value === 'true';

const pickArray = (
  result: Record<string, unknown>,
  keys: string[],
): unknown[] => {
  for (const key of keys) {
    const value = result[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const pickObject = (
  result: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null => {
  for (const key of keys) {
    const value = result[key];
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  }
  return null;
};

/** 只保留 http/https 的链接卡片；不抓取，不做域名之外的处理。 */
const safeCards = (raw: unknown) => {
  if (!Array.isArray(raw)) return [];
  const cards: Array<{ title: string; url: string }> = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = str(row.url ?? row.link ?? row.href);
    if (!/^https?:\/\//i.test(url)) continue;
    cards.push({
      title: str(row.title ?? row.name ?? '链接').slice(0, 120),
      url: url.slice(0, 500),
    });
  }
  return cards;
};

/**
 * AIworkin SNS 工具封装：**只用个人 Key**（AipddKeyService.resolveToken），
 * 不注入平台 Key；Key 只在本方法栈内存活，不写日志 / 不落 job。
 * 返回结构未完全固化，见 docs/api/aiworkin-sns-tool-contract.md，一律防御式解析。
 */
export class AiworkinSocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: AipddKeyService,
  ) {}

  isUpstreamUserId(value: string): boolean {
    return UUID_RE.test(value);
  }

  /** 本地用户 → 上游 SNS 身份（读库，不发起网络验证）。 */
  async resolveIdentity(userId: string): Promise<SocialIdentity> {
    const binding = await this.prisma.userAipddBinding.findUnique({
      where: { userId },
    });
    const empty = (state: IdentityState): SocialIdentity => ({
      state,
      keyId: 0,
      upstreamUserId: '',
      upstreamUsername: '',
      verified: false,
      verifiedAt: null,
      mailAddress: '',
    });
    if (!binding) return empty('UNBOUND');
    const key = await this.prisma.aipddKey.findUnique({
      where: { id: binding.keyId },
    });
    if (!key || key.status !== 'ACTIVE') return empty('KEY_INACTIVE');
    const upstreamUserId = String(key.aipddUserId || '').trim();
    if (!this.isUpstreamUserId(upstreamUserId)) return empty('PLACEHOLDER_ID');
    const cached = await this.prisma.socialUpstreamIdentity.findUnique({
      where: { userId },
    });
    // 换绑到另一把 Key 后，旧身份的昵称/邮箱/审核态都不能继续复用
    const cacheMatches =
      cached?.keyId === key.id && cached?.upstreamUserId === upstreamUserId;
    const verifiedAt = cacheMatches ? cached?.verifiedAt || null : null;
    const verifiedFresh =
      cacheMatches &&
      cached?.state === 'READY' &&
      verifiedAt &&
      Date.now() - verifiedAt.getTime() < 24 * 3600_000;
    const grantMissingFresh =
      cacheMatches &&
      cached?.state === 'SNS_GRANT_MISSING' &&
      verifiedAt &&
      Date.now() - verifiedAt.getTime() < 24 * 3600_000;
    if (grantMissingFresh)
      return {
        ...empty('SNS_GRANT_MISSING'),
        keyId: key.id,
        upstreamUserId,
      };
    const snapshot = (
      cacheMatches ? cached?.profileSnapshot || {} : {}
    ) as Record<string, unknown>;
    return {
      state: 'READY',
      keyId: key.id,
      upstreamUserId,
      upstreamUsername: cached?.upstreamUsername || str(snapshot.username),
      verified: Boolean(verifiedFresh),
      verifiedAt,
      mailAddress: str(snapshot.mailAddress),
    };
  }

  /** 对方能否接收同步：绑了 Key 且 aipddUserId 是 UUID 即可，不要求已在线验证。 */
  async peerReady(
    userId: string,
  ): Promise<{ ready: boolean; upstreamUserId: string; keyId: number }> {
    const identity = await this.resolveIdentity(userId);
    return {
      ready: identity.state === 'READY',
      upstreamUserId: identity.upstreamUserId,
      keyId: identity.keyId,
    };
  }

  /** 显式验证 SNS 授权：成功缓存 24h；权限缺失落 SNS_GRANT_MISSING。 */
  async verifyIdentity(userId: string): Promise<SocialIdentity> {
    const identity = await this.resolveIdentity(userId);
    if (identity.state !== 'READY') return identity;
    const token = await this.keys.resolveToken(userId);
    try {
      const address = await this.mailAddress(token);
      const profile = await this.getProfile(token, identity.upstreamUserId);
      const username = profile.username || identity.upstreamUsername || '';
      await this.prisma.socialUpstreamIdentity.upsert({
        where: { userId },
        create: {
          userId,
          keyId: identity.keyId,
          upstreamUserId: identity.upstreamUserId,
          upstreamUsername: username,
          state: 'READY',
          profileSnapshot: {
            username,
            mailAddress: address,
          },
          verifiedAt: new Date(),
        },
        update: {
          keyId: identity.keyId,
          upstreamUserId: identity.upstreamUserId,
          upstreamUsername: username,
          state: 'READY',
          profileSnapshot: {
            username,
            mailAddress: address,
          },
          verifiedAt: new Date(),
          lastError: '',
        },
      });
      return {
        ...identity,
        upstreamUsername: username,
        verified: true,
        verifiedAt: new Date(),
        mailAddress: address,
      };
    } catch (error) {
      if (error instanceof SocialUpstreamError && error.kind === 'grant') {
        await this.prisma.socialUpstreamIdentity.upsert({
          where: { userId },
          create: {
            userId,
            keyId: identity.keyId,
            upstreamUserId: identity.upstreamUserId,
            state: 'SNS_GRANT_MISSING',
            lastError: error.message.slice(0, 500),
            verifiedAt: new Date(),
          },
          update: {
            keyId: identity.keyId,
            upstreamUserId: identity.upstreamUserId,
            state: 'SNS_GRANT_MISSING',
            lastError: error.message.slice(0, 500),
            verifiedAt: new Date(),
          },
        });
        return { ...identity, state: 'SNS_GRANT_MISSING' };
      }
      throw error;
    }
  }

  /** 解绑/换 Key 时调用：身份作废，未执行的 outbox 一并终止。 */
  async revokeIdentity(userId: string) {
    await this.prisma.socialUpstreamIdentity
      .updateMany({
        where: { userId },
        data: { state: 'REVOKED', lastError: '绑定已解除' },
      })
      .catch(() => undefined);
    await this.prisma.socialSyncJob.updateMany({
      where: { userId, status: 'PENDING' },
      data: {
        status: 'DEAD',
        lastError: '绑定已解除',
        completedAt: new Date(),
      },
    });
  }

  private async call(
    token: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const client = new McpClient({
      transport: 'http',
      url: `${aiworkinBaseUrl()}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    });
    try {
      const raw = await client.callToolRaw(tool, args);
      const result = raw || {};
      const content = Array.isArray(result.content) ? result.content : [];
      const textParts = content
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object',
        )
        .map((item) => str(item.text))
        .filter(Boolean);
      if (result.isError === true) {
        const message = textParts.join(' ') || 'AIworkin 社交接口返回失败结果';
        throw this.classifyMessage(message);
      }
      const structured = result.structuredContent;
      if (structured && typeof structured === 'object')
        return structured as Record<string, unknown>;
      const joined = textParts.join('\n').trim();
      if (joined) {
        try {
          const parsed = JSON.parse(joined) as unknown;
          if (parsed && typeof parsed === 'object')
            return parsed as Record<string, unknown>;
        } catch {
          return { text: joined };
        }
        return { text: joined };
      }
      return {};
    } catch (error) {
      if (error instanceof SocialUpstreamError) throw error;
      throw this.classifyError(error);
    } finally {
      client.close();
    }
  }

  private classifyMessage(message: string): SocialUpstreamError {
    const lowered = message.toLowerCase();
    if (
      lowered.includes('scope') ||
      lowered.includes('permission') ||
      lowered.includes('forbidden') ||
      message.includes('授权') ||
      message.includes('权限') ||
      message.includes('开通')
    )
      return new SocialUpstreamError(
        '当前 API Key 未开通 SNS 权限，请在 AIworkin 授权社交读写后重试',
        'grant',
        false,
      );
    if (
      lowered.includes('rate') ||
      lowered.includes('limit') ||
      message.includes('限流')
    )
      return new SocialUpstreamError(
        'AIworkin 社交接口限流，稍后自动重试',
        'rate',
        true,
      );
    return new SocialUpstreamError(message, 'invalid', false);
  }

  private classifyError(error: unknown): SocialUpstreamError {
    if (error instanceof SocialUpstreamError) return error;
    if (error instanceof McpClientError) {
      const message = error.message;
      if (error.kind === 'auth')
        return new SocialUpstreamError(
          'API Key 无效或已过期，请重新绑定',
          'auth',
          false,
        );
      if (error.kind === 'timeout' || error.kind === 'network')
        return new SocialUpstreamError(
          `AIworkin 社交接口暂不可用：${message}`,
          'network',
          true,
        );
      if (/401|403/.test(message))
        return new SocialUpstreamError(message, 'auth', false);
      if (/429/.test(message))
        return new SocialUpstreamError(message, 'rate', true);
      if (/5\d\d/.test(message))
        return new SocialUpstreamError(message, 'server', true);
      const classified = this.classifyMessage(message);
      return classified.kind === 'invalid'
        ? new SocialUpstreamError(message, 'invalid', false)
        : classified;
    }
    return new SocialUpstreamError(
      error instanceof Error ? error.message : String(error),
      'network',
      true,
    );
  }

  async getProfile(token: string, userId: string) {
    const result = await this.call(token, 'sns_get_profile', { userId });
    const data = pickObject(result, ['profile', 'user', 'data']) || result;
    return {
      userId: str(data.userId ?? data.id) || userId,
      username: str(data.username ?? data.nickName ?? data.name),
      avatar: str(data.avatar ?? data.avatarUrl),
      bio: str(data.bio ?? data.intro ?? data.summary),
    };
  }

  async mailAddress(token: string): Promise<string> {
    const result = await this.call(token, 'sns_get_my_mail_address', {});
    return str(
      result.address ??
        result.email ??
        (result.data as Record<string, unknown>)?.address,
    );
  }

  async listRelationships(token: string): Promise<UpstreamFriend[]> {
    const result = await this.call(token, 'sns_list_relationships', {});
    const rows = pickArray(result, [
      'items',
      'relationships',
      'friends',
      'data',
    ]);
    const seen = new Set<string>();
    const list: UpstreamFriend[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const peer = pickObject(row, ['user', 'peer', 'target', 'friend']);
      const userId = str(
        row.userId ??
          row.targetUserId ??
          row.friendUserId ??
          peer?.userId ??
          peer?.id,
      );
      if (!this.isUpstreamUserId(userId) || seen.has(userId)) continue;
      seen.add(userId);
      const status = str(row.status ?? row.relation ?? row.state).toUpperCase();
      list.push({
        userId,
        username: str(
          row.username ?? row.nickName ?? peer?.username ?? peer?.nickName,
        ),
        status,
        requestId: str(row.requestId ?? row.id),
      });
    }
    return list;
  }

  async sendFriendRequest(
    token: string,
    toUserId: string,
    message: string,
    idempotencyKey: string,
  ): Promise<{ requestId: string; status: string }> {
    const result = await this.call(token, 'sns_send_friend_request', {
      toUserId,
      message: message.slice(0, 200),
      idempotencyKey,
    });
    return {
      requestId: str(result.requestId ?? result.id),
      status: str(result.status ?? result.relation ?? ''),
    };
  }

  async handleFriendRequest(
    token: string,
    requestId: string,
    action: 'ACCEPT' | 'REJECT',
    idempotencyKey: string,
  ): Promise<void> {
    const numeric = Number(requestId);
    if (!Number.isInteger(numeric) || numeric <= 0)
      throw new SocialUpstreamError('上游好友申请编号无效', 'invalid', false);
    await this.call(token, 'sns_handle_friend_request', {
      requestId: numeric,
      action,
      idempotencyKey,
    });
  }

  async sendSocialMail(
    token: string,
    input: {
      toUserId: string;
      subject: string;
      body: string;
      linkCards: Array<{ title: string; url: string }>;
      idempotencyKey: string;
    },
  ): Promise<{ messageId: string; threadId: string }> {
    const result = await this.call(token, 'sns_send_social_mail', {
      toUserId: input.toUserId,
      subject: input.subject.slice(0, 200),
      body: input.body.slice(0, 3000),
      aiGenerated: false,
      linkCards: input.linkCards.slice(0, 5).map((card) => ({
        type: 'LINK',
        title: card.title,
        url: card.url,
      })),
      idempotencyKey: input.idempotencyKey,
    });
    return {
      messageId: str(result.messageId ?? result.id),
      threadId: str(result.threadId ?? result.conversationId),
    };
  }

  async listMail(
    token: string,
    direction: 'INBOX' | 'SENT',
  ): Promise<UpstreamMail[]> {
    const result = await this.call(
      token,
      direction === 'INBOX' ? 'sns_list_mail_inbox' : 'sns_list_mail_sent',
      {},
    );
    const rows = pickArray(result, ['items', 'messages', 'mails', 'data']);
    const list: UpstreamMail[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const id = str(row.id ?? row.messageId ?? row.mailId);
      if (!id) continue;
      list.push({
        id,
        fromUserId: str(row.fromUserId ?? row.senderId ?? row.from),
        toUserId: str(row.toUserId ?? row.recipientId ?? row.to),
        subject: str(row.subject ?? row.title),
        body: str(row.body ?? row.content ?? row.text),
        linkCards: safeCards(row.linkCards ?? row.cards ?? row.links),
        aiGenerated: bool(row.aiGenerated ?? row.ai_generated),
        read: bool(row.read ?? row.isRead),
        createdAt: str(row.createdAt ?? row.sentAt ?? row.time),
      });
    }
    return list;
  }

  /** 供调度器/路由统一把异常转成中文提示，不泄露 Key 或上游原文细节。 */
  toBusinessException(error: unknown): BusinessException {
    if (error instanceof BusinessException) return error;
    if (error instanceof SocialUpstreamError)
      return new BusinessException(
        error.kind === 'grant' || error.kind === 'auth'
          ? ErrorCode.FORBIDDEN
          : ErrorCode.SERVICE_UNAVAILABLE,
        error.message,
      );
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'AIworkin 社交同步暂时不可用，请稍后重试',
    );
  }
}
