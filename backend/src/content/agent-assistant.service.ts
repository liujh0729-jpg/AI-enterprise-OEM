import {
  CONTENT_AGENT_ASSISTANT_KIND_SPECS,
  type ContentAgentAssistantChannel,
  type ContentAgentAssistantKind,
  type ContentAgentAssistantMessage,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { AgentAssistantCrypto } from './agent-assistant-crypto';
import {
  createAssistantToken,
  receiveAssistantMessage,
  sendAssistantMessage,
  testAssistantChannel,
  type AssistantConfig,
  type AssistantHttpResponse,
  type AssistantInbound,
  type AssistantRequest,
} from './agent-assistant.channel';
import { ContentAgentService } from './agent.service';

const NAME_MAX = 40;
const WEBHOOK_PREFIX = '/api/backend/enterprise/agent/assistant/';
const INBOUND_MAX = 4000;
const MESSAGES_LIMIT = 50;
const ERROR_MAX = 500;
const CONVERSATION_TITLE_MAX = 30;
/** 微信客服的增量游标按通道存，借用一条保留聊天行（不参与消息日志）。 */
const CURSOR_CHAT = '#cursor#';
/** 回调报文上限：第三方推来的都是短消息，超过这个大小直接拒收。 */
const BODY_MAX = 256 * 1024;

type ChannelRow = {
  id: number;
  userId: string;
  kind: string;
  name: string;
  webhookToken: string;
  configCipher: string;
  /// 回复用的数字分身；0＝自动
  personaId: number;
  channelId: number;
  model: string;
  allowedUsers: string;
  enabled: boolean;
  lastEventAt: Date | null;
  lastError: string;
  eventCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: number;
  channelId: number;
  externalChatId: string;
  externalMsgId: string | null;
  direction: string;
  content: string;
  status: string;
  error: string;
  conversationId: number;
  createdAt: Date;
};

/**
 * Agent 助理：把企业微信 / 钉钉 / 飞书 / QQ / 微信客服 / 公众号这些消息通道挂到 Agent 上。
 * 入站消息当一轮对话交给 Agent，回答原路回给对方；群机器人只出不进，只用来推结果。
 *
 * 执行走 `runSilent`，没有浏览器登录态可借，所以通道必须绑定自建模型渠道（channelId>0），
 * 否则无人值守时取不到账号 Key —— 这与定时任务是同一条约束。
 */
export class ContentAgentAssistantService {
  /** 同一个外部聊天串行执行，避免两条指令交叉写进同一段上下文。 */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly agent: ContentAgentService,
    private readonly crypto = new AgentAssistantCrypto(),
  ) {}

  private specOf(kind: string) {
    return CONTENT_AGENT_ASSISTANT_KIND_SPECS.find(
      (item) => item.kind === kind,
    );
  }

  private configOf(row: ChannelRow): AssistantConfig {
    if (!row.configCipher) return {};
    try {
      const parsed = JSON.parse(
        this.crypto.decrypt(row.configCipher),
      ) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') return {};
      const config: AssistantConfig = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') config[key] = value;
      }
      return config;
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '助理通道的凭据无法解密，请重新保存这条通道',
      );
    }
  }

  private shape(row: ChannelRow): ContentAgentAssistantChannel {
    const spec = this.specOf(row.kind);
    const config = this.configOf(row);
    const visible: Record<string, string> = {};
    const secretKeys: string[] = [];
    for (const field of spec?.fields ?? []) {
      const value = text(config[field.key]);
      if (field.secret) {
        if (value.trim()) secretKeys.push(field.key);
      } else {
        visible[field.key] = value;
      }
    }
    return {
      id: row.id,
      kind: row.kind as ContentAgentAssistantKind,
      kindLabel: spec?.label || row.kind,
      name: row.name,
      webhookToken: row.webhookToken,
      webhookPath: `${WEBHOOK_PREFIX}${row.webhookToken}`,
      config: visible,
      secretKeys,
      personaId: row.personaId,
      channelId: row.channelId,
      model: row.model,
      allowedUsers: row.allowedUsers,
      enabled: row.enabled,
      lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
      lastError: row.lastError,
      eventCount: row.eventCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private shapeMessage(row: MessageRow): ContentAgentAssistantMessage {
    return {
      id: row.id,
      channelId: row.channelId,
      externalChatId: row.externalChatId,
      externalMsgId: row.externalMsgId,
      direction: row.direction === 'out' ? 'out' : 'in',
      content: row.content,
      status: row.status,
      error: row.error,
      conversationId: row.conversationId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentAssistantChannel.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.shape(row));
  }

  private readKind(raw: unknown): ContentAgentAssistantKind {
    const kind = text(raw).trim() as ContentAgentAssistantKind;
    if (!this.specOf(kind)) badKind();
    return kind;
  }

  /**
   * 合并配置：敏感项留空＝沿用已保存的值（界面永远不回显密文），
   * 其余项按提交值覆盖；最后按 spec 校验必填项。
   */
  private mergeConfig(
    kind: ContentAgentAssistantKind,
    incoming: unknown,
    existing: AssistantConfig,
  ) {
    const spec = this.specOf(kind);
    const source =
      incoming && typeof incoming === 'object' && !Array.isArray(incoming)
        ? (incoming as Record<string, unknown>)
        : {};
    const config: AssistantConfig = {};
    const missing: string[] = [];
    for (const field of spec?.fields ?? []) {
      const raw = text(source[field.key]).trim();
      const value = field.secret && !raw ? text(existing[field.key]) : raw;
      config[field.key] = value;
      if (field.required && !value) missing.push(field.label);
    }
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写「${missing.join('」「')}」`,
      );
    }
    return config;
  }

  /** 助理是无人值守执行：只能绑自建渠道，且必须定死模型。 */
  private async readExecution(user: CurrentUser, raw: Record<string, unknown>) {
    const channelId = Number(raw.channelId ?? 0);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '助理执行要选择具体的模型渠道（不能取「模型设置」里的默认槽位，无人值守时拿不到账号 Key）',
      );
    }
    const channel = await this.prisma.contentModelChannel.findFirst({
      where: { id: channelId, userId: user.userId },
      select: { id: true, enabled: true },
    });
    if (!channel) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '模型渠道不存在，请到「模型设置」确认',
      );
    }
    if (!channel.enabled) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该模型渠道已停用');
    }
    const model = text(raw.model).trim().slice(0, 128);
    if (!model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '助理执行要选定具体模型',
      );
    }
    return { channelId, model };
  }

  /** 绑定回复用的数字分身：0＝自动；只能绑自己的分身。 */
  private async readPersona(user: CurrentUser, raw: unknown) {
    const id = Number(raw ?? 0);
    if (!Number.isInteger(id) || id <= 0) return 0;
    const row = await this.prisma.contentAgentPersona.findFirst({
      where: { id, userId: user.userId },
      select: { id: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '数字分身不存在或已被删除',
      );
    }
    return row.id;
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const kind = this.readKind(body.kind);
    const spec = this.specOf(kind);
    const name =
      text(body.name).trim().slice(0, NAME_MAX) || spec?.label || '助理通道';
    const config = this.mergeConfig(kind, body.config, {});
    const execution = await this.readExecution(user, body);
    const personaId = await this.readPersona(user, body.personaId);
    const row = await this.prisma.contentAgentAssistantChannel.create({
      data: {
        userId: user.userId,
        kind,
        name,
        webhookToken: createAssistantToken(),
        configCipher: this.crypto.encrypt(JSON.stringify(config)),
        personaId,
        channelId: execution.channelId,
        model: execution.model,
        allowedUsers: text(body.allowedUsers).trim().slice(0, 500),
        enabled: body.enabled === false ? false : true,
      },
    });
    await this.identity.audit(
      user.userId,
      'Agent助理通道新建',
      `#${row.id} ${row.name}（${spec?.label || kind}）`,
    );
    return this.shape(row);
  }

  private async ownedChannel(user: CurrentUser, id: string) {
    const channelId = Number(id);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '助理通道编号无效');
    }
    const row = await this.prisma.contentAgentAssistantChannel.findFirst({
      where: { id: channelId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '助理通道不存在');
    }
    return row;
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const existing = await this.ownedChannel(user, id);
    const data: Prisma.ContentAgentAssistantChannelUncheckedUpdateInput = {};
    if (body.kind !== undefined && text(body.kind).trim() !== existing.kind) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '通道类型不能修改，请新建一条通道',
      );
    }
    if (body.name !== undefined) {
      const name = text(body.name).trim().slice(0, NAME_MAX);
      if (!name) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请给通道起个名字');
      }
      data.name = name;
    }
    if (body.config !== undefined) {
      const config = this.mergeConfig(
        existing.kind as ContentAgentAssistantKind,
        body.config,
        this.configOf(existing),
      );
      data.configCipher = this.crypto.encrypt(JSON.stringify(config));
    }
    if (body.channelId !== undefined || body.model !== undefined) {
      const execution = await this.readExecution(user, {
        channelId: body.channelId ?? existing.channelId,
        model: body.model ?? existing.model,
      });
      data.channelId = execution.channelId;
      data.model = execution.model;
    }
    if (body.allowedUsers !== undefined) {
      data.allowedUsers = text(body.allowedUsers).trim().slice(0, 500);
    }
    if (body.personaId !== undefined) {
      data.personaId = await this.readPersona(user, body.personaId);
    }
    if (body.enabled !== undefined) data.enabled = body.enabled !== false;
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有要改的内容');
    }
    const row = await this.prisma.contentAgentAssistantChannel.update({
      where: { id: existing.id },
      data,
    });
    return this.shape(row);
  }

  async remove(user: CurrentUser, id: string) {
    const existing = await this.ownedChannel(user, id);
    await this.prisma.$transaction([
      this.prisma.contentAgentAssistantMessage.deleteMany({
        where: { channelId: existing.id, userId: user.userId },
      }),
      this.prisma.contentAgentAssistantChat.deleteMany({
        where: { channelId: existing.id, userId: user.userId },
      }),
      this.prisma.contentAgentAssistantChannel.delete({
        where: { id: existing.id },
      }),
    ]);
    await this.identity.audit(
      user.userId,
      'Agent助理通道删除',
      `#${existing.id} ${existing.name}`,
    );
    return { removed: true };
  }

  async test(user: CurrentUser, id: string) {
    const row = await this.ownedChannel(user, id);
    return testAssistantChannel(
      row.kind as ContentAgentAssistantKind,
      this.configOf(row),
    );
  }

  async messages(user: CurrentUser, id: string) {
    const row = await this.ownedChannel(user, id);
    const rows = await this.prisma.contentAgentAssistantMessage.findMany({
      where: { channelId: row.id, userId: user.userId },
      orderBy: { id: 'desc' },
      take: MESSAGES_LIMIT,
    });
    return rows.map((item) => this.shapeMessage(item));
  }

  /** 第三方回调统一入口：校验平台签名 → 解析成事件 → 交回异步执行。 */
  async handleCallback(
    token: string,
    request: AssistantRequest,
  ): Promise<AssistantHttpResponse> {
    if (request.rawBody.length > BODY_MAX) {
      return { status: 413, body: 'payload too large' };
    }
    const row = await this.prisma.contentAgentAssistantChannel.findUnique({
      where: { webhookToken: token },
    });
    if (!row) return { status: 404, body: 'invalid callback' };
    const kind = row.kind as ContentAgentAssistantKind;
    if (!this.specOf(kind)) return { status: 404, body: 'unsupported channel' };

    const cursor = kind === 'wecom_kf' ? await this.cursorOf(row.id) : '';
    let received;
    try {
      received = await receiveAssistantMessage(
        kind,
        this.configOf(row),
        request,
        cursor,
      );
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : '助理回调处理失败，请检查通道配置';
      await this.rememberError(row.id, message);
      return {
        status:
          error instanceof BusinessException ? error.errorCode.httpStatus : 500,
        body: message,
      };
    }
    if (received.cursor && received.cursor !== cursor) {
      await this.saveCursor(row, received.cursor);
    }
    const events = received.events.filter((event) => event.text.trim());
    if (!row.enabled || !events.length) return received.response;
    for (const event of events) {
      await this.accept(row, event);
    }
    return received.response;
  }

  private async cursorOf(channelId: number) {
    const row = await this.prisma.contentAgentAssistantChat.findUnique({
      where: {
        channelId_externalChatId: { channelId, externalChatId: CURSOR_CHAT },
      },
      select: { cursor: true },
    });
    return row?.cursor || '';
  }

  private async saveCursor(row: ChannelRow, cursor: string) {
    await this.prisma.contentAgentAssistantChat.upsert({
      where: {
        channelId_externalChatId: {
          channelId: row.id,
          externalChatId: CURSOR_CHAT,
        },
      },
      create: {
        channelId: row.id,
        userId: row.userId,
        externalChatId: CURSOR_CHAT,
        conversationId: 0,
        cursor: cursor.slice(0, 191),
      },
      update: { cursor: cursor.slice(0, 191) },
    });
  }

  private async rememberError(channelId: number, message: string) {
    await this.prisma.contentAgentAssistantChannel
      .update({
        where: { id: channelId },
        data: { lastError: message.slice(0, ERROR_MAX) },
      })
      .catch(() => undefined);
  }

  /** 白名单 → 去重 → 落一条入站日志 → 排队执行。 */
  private async accept(row: ChannelRow, event: AssistantInbound) {
    const allowed = row.allowedUsers
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const chatId = event.chatId.slice(0, 191);
    const externalMsgId = event.messageId
      ? event.messageId.slice(0, 191)
      : null;
    if (
      allowed.length &&
      !allowed.includes(event.userId) &&
      !allowed.includes(event.chatId)
    ) {
      await this.prisma.contentAgentAssistantMessage
        .create({
          data: {
            channelId: row.id,
            userId: row.userId,
            externalChatId: chatId,
            externalMsgId,
            direction: 'in',
            content: event.text.slice(0, INBOUND_MAX),
            status: 'ignored',
            error: '发送者不在允许名单内',
          },
        })
        .catch(() => undefined);
      return;
    }
    try {
      await this.prisma.contentAgentAssistantMessage.create({
        data: {
          channelId: row.id,
          userId: row.userId,
          externalChatId: chatId,
          externalMsgId,
          direction: 'in',
          content: event.text.slice(0, INBOUND_MAX),
          status: 'received',
        },
      });
    } catch (error) {
      // 同一个外部消息 ID 重复推送（平台重试）：已经处理过，直接丢掉。
      if ((error as { code?: string }).code === 'P2002') return;
      throw error;
    }
    await this.prisma.contentAgentAssistantChannel.update({
      where: { id: row.id },
      data: { lastEventAt: new Date(), eventCount: { increment: 1 } },
    });
    this.enqueue(row, event);
  }

  private enqueue(row: ChannelRow, event: AssistantInbound) {
    const key = `${row.id}:${event.chatId}`;
    const prev = this.chains.get(key) || Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.execute(row, event))
      .catch(() => undefined);
    this.chains.set(key, next);
    void next.then(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  private async execute(row: ChannelRow, event: AssistantInbound) {
    const user = new CurrentUser(row.userId, '', '');
    let conversationId = 0;
    try {
      const chat = await this.ensureChat(row, event);
      conversationId = chat.conversationId;
      await this.touchInbound(row, event, conversationId, 'running', '');
      const result = await this.agent.runSilent(
        user,
        undefined,
        conversationId,
        event.text,
        {
          channelId: row.channelId > 0 ? row.channelId : undefined,
          model: row.model,
          personaId: row.personaId > 0 ? row.personaId : undefined,
        },
      );
      const reply = text(result.text).trim() || '（这一轮没有产出文字回复）';
      await sendAssistantMessage(
        row.kind as ContentAgentAssistantKind,
        this.configOf(row),
        {
          chatId: event.chatId,
          userId: event.userId,
          replyTarget: event.replyTarget,
          messageId: event.messageId,
        },
        reply,
      );
      await this.prisma.contentAgentAssistantMessage.create({
        data: {
          channelId: row.id,
          userId: row.userId,
          externalChatId: event.chatId.slice(0, 191),
          direction: 'out',
          content: reply.slice(0, INBOUND_MAX),
          status: 'succeeded',
          conversationId,
        },
      });
      await this.touchInbound(row, event, conversationId, 'succeeded', '');
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : (error as Error)?.message || '执行失败，请稍后重试';
      await this.touchInbound(
        row,
        event,
        conversationId,
        'failed',
        message.slice(0, ERROR_MAX),
      );
      await this.rememberError(row.id, message);
      // 失败也要回一句，否则对方发完指令就再也等不到任何反馈。
      try {
        await sendAssistantMessage(
          row.kind as ContentAgentAssistantKind,
          this.configOf(row),
          {
            chatId: event.chatId,
            userId: event.userId,
            replyTarget: event.replyTarget,
            messageId: event.messageId,
          },
          `「${row.name}」执行失败：${message}`,
        );
      } catch {
        /* 回不去就当日志里记着了 */
      }
    }
  }

  private async touchInbound(
    row: ChannelRow,
    event: AssistantInbound,
    conversationId: number,
    status: string,
    error: string,
  ) {
    await this.prisma.contentAgentAssistantMessage
      .updateMany({
        where: {
          channelId: row.id,
          userId: row.userId,
          externalChatId: event.chatId.slice(0, 191),
          externalMsgId: event.messageId ? event.messageId.slice(0, 191) : null,
          direction: 'in',
        },
        data: { status, error, conversationId },
      })
      .catch(() => undefined);
  }

  /** 一个外部聊天复用同一条 Agent 会话，远程对话才有上下文。 */
  private async ensureChat(row: ChannelRow, event: AssistantInbound) {
    const externalChatId = event.chatId.slice(0, 191);
    const existing = await this.prisma.contentAgentAssistantChat.findUnique({
      where: {
        channelId_externalChatId: { channelId: row.id, externalChatId },
      },
    });
    if (existing && existing.conversationId > 0) {
      const conversation = await this.prisma.contentAgentConversation.findFirst(
        {
          where: { id: existing.conversationId, userId: row.userId },
          select: { id: true },
        },
      );
      if (conversation) {
        await this.prisma.contentAgentAssistantChat.update({
          where: { id: existing.id },
          data: {
            lastUserId: event.userId.slice(0, 191),
            lastMessageAt: new Date(),
            messageCount: { increment: 1 },
          },
        });
        return existing;
      }
    }
    const title =
      `${row.name} · ${event.userName || event.userId || externalChatId}`.slice(
        0,
        CONVERSATION_TITLE_MAX,
      );
    const conversation = await this.prisma.contentAgentConversation.create({
      data: {
        userId: row.userId,
        title,
        model: row.model,
        expertId: 0,
        expertName: '',
      },
    });
    const saved = await this.prisma.contentAgentAssistantChat.upsert({
      where: {
        channelId_externalChatId: { channelId: row.id, externalChatId },
      },
      create: {
        channelId: row.id,
        userId: row.userId,
        externalChatId,
        conversationId: conversation.id,
        title,
        lastUserId: event.userId.slice(0, 191),
        lastMessageAt: new Date(),
        messageCount: 1,
      },
      update: {
        conversationId: conversation.id,
        title,
        lastUserId: event.userId.slice(0, 191),
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
      },
    });
    return saved;
  }
}

function badKind(): never {
  throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持的助理通道类型');
}
