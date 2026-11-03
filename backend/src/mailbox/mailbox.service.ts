import {
  MAIL_MESSAGE_STATUS_LABELS,
  MAIL_PROTOCOL_LABELS,
  MAIL_REPLY_MODE_LABELS,
  MAIL_SECURITY_LABELS,
  type MailAccount,
  type MailDraftResult,
  type MailHandleLog,
  type MailMessage,
  type MailMessageSummary,
  type MailScript,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { MailCrypto } from './mail-crypto';
import {
  mailProtocol,
  type MailAccountConfig,
  type MailDetail,
  type MailDraft,
  type MailSummary,
} from './mail-protocol';

const MAX_ACCOUNTS = 20;
const MAX_SCRIPT_CONTENT = 8000;
const MAX_SIGNATURE = 1000;
const MAX_BODY = 8000;
const LEDGER_LIMIT = 100;
const SECURITY_MODES = ['ssl', 'starttls', 'none'];
const PROTOCOLS = ['imap', 'pop3'];
const REPLY_MODES = ['draft_only', 'auto_send'];
/** 自动回复的安全闸：单轮最多处理多少封、同一发件人每天最多自动回几次。 */
const AUTO_REPLY_PER_SENDER_PER_DAY = 1;

type AccountRow = {
  id: number;
  userId: string;
  address: string;
  displayName: string;
  protocol: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecurity: string;
  incomingUsername: string;
  incomingSecret: string;
  inboxFolder: string;
  draftsFolder: string;
  sentFolder: string;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecurity: string;
  outgoingUsername: string;
  outgoingSecret: string;
  signature: string;
  replyMode: string;
  maxPerRun: number;
  enabled: boolean;
  libraryIds: unknown;
  lastRunAt: Date | null;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
};

type ScriptRow = {
  id: number;
  mailboxId: number;
  mailboxIds: unknown;
  userId: string;
  name: string;
  keywords: string;
  senderPattern: string;
  priority: number;
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** 上海时区的今天 0 点（台账按天去重与统计都按这个口径）。 */
function dayStart(offsetDays = 0): Date {
  const shifted = new Date(Date.now() + 8 * 3600_000 - offsetDays * 86_400_000);
  return new Date(`${shifted.toISOString().slice(0, 10)}T00:00:00+08:00`);
}

function monthStart(): Date {
  const shifted = new Date(Date.now() + 8 * 3600_000);
  return new Date(`${shifted.toISOString().slice(0, 7)}-01T00:00:00+08:00`);
}

function intInRange(raw: unknown, min: number, max: number, fallback: number) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function idList(raw: unknown, limit: number) {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const item of raw) {
    const value = Number(item);
    if (Number.isInteger(value) && value > 0 && !ids.includes(value)) {
      ids.push(value);
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** 回复正文：去掉原始引用，保留模型/用户写的内容，并在末尾补上签名。 */
function withSignature(body: string, signature: string): string {
  const trimmed = body.trim().slice(0, MAX_BODY);
  const sign = signature.trim().slice(0, MAX_SIGNATURE);
  return sign ? `${trimmed}\n\n${sign}` : trimmed;
}

/**
 * AI邮箱服务：多邮箱账号、实时读信、起草与发送、场景话术与最小处理台账。
 * 正文、主题、附件一律不落库；落库的只有账号凭据密文、话术和只含去重键与结果的台账。
 */
export class MailboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: MailCrypto,
  ) {}

  // ---------------------------------------------------------------- 账号

  private shapeAccount(
    row: AccountRow,
    stats: { todaySent: number; todayDraft: number; monthHandled: number },
  ): MailAccount {
    return {
      id: row.id,
      address: row.address,
      displayName: row.displayName,
      protocol: row.protocol === 'pop3' ? 'pop3' : 'imap',
      protocolLabel: MAIL_PROTOCOL_LABELS[row.protocol] || row.protocol,
      incomingHost: row.incomingHost,
      incomingPort: row.incomingPort,
      incomingSecurity: row.incomingSecurity,
      incomingSecurityLabel:
        MAIL_SECURITY_LABELS[row.incomingSecurity] || row.incomingSecurity,
      incomingUsername: row.incomingUsername,
      inboxFolder: row.inboxFolder,
      draftsFolder: row.draftsFolder,
      sentFolder: row.sentFolder,
      outgoingHost: row.outgoingHost,
      outgoingPort: row.outgoingPort,
      outgoingSecurity: row.outgoingSecurity,
      outgoingUsername: row.outgoingUsername,
      hasIncomingSecret: Boolean(row.incomingSecret),
      hasOutgoingSecret: Boolean(row.outgoingSecret),
      signature: row.signature,
      replyMode: row.replyMode === 'auto_send' ? 'auto_send' : 'draft_only',
      replyModeLabel:
        MAIL_REPLY_MODE_LABELS[row.replyMode] ||
        MAIL_REPLY_MODE_LABELS['draft_only'],
      maxPerRun: row.maxPerRun,
      enabled: row.enabled,
      libraryIds: idList(row.libraryIds, 50),
      todaySent: stats.todaySent,
      todayDraft: stats.todayDraft,
      monthHandled: stats.monthHandled,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 今日/本月处理计数：一次分组查询，不给每个邮箱单独查三遍。 */
  private async statsOf(mailboxIds: number[]) {
    const empty = new Map<
      number,
      { todaySent: number; todayDraft: number; monthHandled: number }
    >();
    if (!mailboxIds.length) return empty;
    const rows = await this.prisma.mailHandleLog.findMany({
      where: {
        mailboxId: { in: mailboxIds },
        handledOn: { gte: monthStart() },
        result: { in: ['draft', 'sent'] },
      },
      select: { mailboxId: true, result: true, handledOn: true },
    });
    const today = dayStart().getTime();
    for (const row of rows) {
      const stats = empty.get(row.mailboxId) ?? {
        todaySent: 0,
        todayDraft: 0,
        monthHandled: 0,
      };
      stats.monthHandled += 1;
      if (row.handledOn.getTime() === today) {
        if (row.result === 'sent') stats.todaySent += 1;
        else stats.todayDraft += 1;
      }
      empty.set(row.mailboxId, stats);
    }
    return empty;
  }

  async listAccounts(user: CurrentUser): Promise<MailAccount[]> {
    const rows = await this.prisma.mailAccount.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
      take: MAX_ACCOUNTS,
    });
    const stats = await this.statsOf(rows.map((row) => row.id));
    return rows.map((row) =>
      this.shapeAccount(
        row,
        stats.get(row.id) ?? { todaySent: 0, todayDraft: 0, monthHandled: 0 },
      ),
    );
  }

  private async ownedAccount(
    user: CurrentUser,
    id: string,
  ): Promise<AccountRow> {
    const accountId = Number(id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '邮箱编号无效');
    }
    const row = await this.prisma.mailAccount.findFirst({
      where: { id: accountId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮箱不存在或已被删除');
    }
    return row;
  }

  /** 请求体 → 账号字段；编辑时留空的密码保持原值。 */
  private readAccountBody(
    body: Record<string, unknown>,
    existing?: AccountRow,
  ): Record<string, unknown> {
    const address = text(body.address, existing?.address).trim().toLowerCase();
    if (!isEmail(address)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '邮箱地址格式不正确，例如 name@company.com',
      );
    }
    const protocol = text(body.protocol, existing?.protocol)
      .trim()
      .toLowerCase();
    if (!PROTOCOLS.includes(protocol)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '收信协议只能是 IMAP 或 POP3',
      );
    }
    const incomingSecurity = text(
      body.incomingSecurity,
      existing?.incomingSecurity,
    )
      .trim()
      .toLowerCase();
    if (!SECURITY_MODES.includes(incomingSecurity)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '收信加密方式只能是 SSL/TLS、STARTTLS 或不加密',
      );
    }
    const outgoingSecurity = text(
      body.outgoingSecurity,
      existing?.outgoingSecurity,
    )
      .trim()
      .toLowerCase();
    if (!SECURITY_MODES.includes(outgoingSecurity)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '发信加密方式只能是 SSL/TLS、STARTTLS 或不加密',
      );
    }
    const replyMode = text(body.replyMode, existing?.replyMode)
      .trim()
      .toLowerCase();
    if (!REPLY_MODES.includes(replyMode)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '回复方式只能是「只写草稿」或「写草稿并自动回复」',
      );
    }
    const incomingHost = text(body.incomingHost, existing?.incomingHost).trim();
    if (!incomingHost) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写收信服务器地址',
      );
    }
    const incomingUsername = text(
      body.incomingUsername,
      existing?.incomingUsername ?? address,
    ).trim();
    if (!incomingUsername) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写收信账号');
    }
    const incomingPassword = text(body.incomingPassword).trim();
    const outgoingPassword = text(body.outgoingPassword).trim();
    const outgoingHost = text(body.outgoingHost, existing?.outgoingHost).trim();
    const outgoingUsername = text(
      body.outgoingUsername,
      existing?.outgoingUsername ?? incomingUsername,
    ).trim();
    const data: Record<string, unknown> = {
      address,
      displayName: text(body.displayName, existing?.displayName)
        .trim()
        .slice(0, 80),
      protocol,
      incomingHost,
      incomingPort: intInRange(
        body.incomingPort,
        1,
        65535,
        existing?.incomingPort ?? (protocol === 'pop3' ? 995 : 993),
      ),
      incomingSecurity,
      incomingUsername,
      inboxFolder:
        text(body.inboxFolder, existing?.inboxFolder).trim().slice(0, 80) ||
        'INBOX',
      draftsFolder:
        text(body.draftsFolder, existing?.draftsFolder).trim().slice(0, 80) ||
        'Drafts',
      sentFolder:
        text(body.sentFolder, existing?.sentFolder).trim().slice(0, 80) ||
        'Sent',
      outgoingHost,
      outgoingPort: intInRange(
        body.outgoingPort,
        1,
        65535,
        existing?.outgoingPort ?? 465,
      ),
      outgoingSecurity,
      outgoingUsername,
      signature: text(body.signature, existing?.signature).slice(
        0,
        MAX_SIGNATURE,
      ),
      replyMode,
      maxPerRun: intInRange(body.maxPerRun, 1, 50, existing?.maxPerRun ?? 10),
      enabled:
        body.enabled === undefined
          ? (existing?.enabled ?? true)
          : body.enabled === true || text(body.enabled) === 'true',
      libraryIds: idList(
        body.libraryIds !== undefined ? body.libraryIds : existing?.libraryIds,
        50,
      ),
    };
    // 密码：只有真的填了新值才重新加密；留空＝沿用原密文
    if (incomingPassword) {
      data.incomingSecret = this.crypto.encrypt(incomingPassword);
    } else if (!existing) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写收信密码或授权码',
      );
    }
    if (outgoingPassword) {
      data.outgoingSecret = this.crypto.encrypt(outgoingPassword);
    }
    return data;
  }

  async saveAccount(user: CurrentUser, body: Record<string, unknown>) {
    const data = this.readAccountBody(body);
    const count = await this.prisma.mailAccount.count({
      where: { userId: user.userId },
    });
    if (count >= MAX_ACCOUNTS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `一个账号最多添加 ${MAX_ACCOUNTS} 个邮箱`,
      );
    }
    const duplicated = await this.prisma.mailAccount.findFirst({
      where: { userId: user.userId, address: String(data.address) },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个邮箱已经添加过了',
      );
    }
    const row = await this.prisma.mailAccount.create({
      data: { userId: user.userId, ...data } as never,
    });
    await this.identity.audit(user.userId, 'AI邮箱服务添加邮箱', row.address);
    return this.shapeAccount(row, {
      todaySent: 0,
      todayDraft: 0,
      monthHandled: 0,
    });
  }

  async updateAccount(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const existing = await this.ownedAccount(user, id);
    const data = this.readAccountBody(body, existing);
    const duplicated = await this.prisma.mailAccount.findFirst({
      where: {
        userId: user.userId,
        address: String(data.address),
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个邮箱已经添加过了',
      );
    }
    const row = await this.prisma.mailAccount.update({
      where: { id: existing.id },
      data: data as never,
    });
    const stats = await this.statsOf([row.id]);
    return this.shapeAccount(
      row,
      stats.get(row.id) ?? { todaySent: 0, todayDraft: 0, monthHandled: 0 },
    );
  }

  async removeAccount(user: CurrentUser, id: string) {
    const existing = await this.ownedAccount(user, id);
    await this.prisma.$transaction([
      this.prisma.mailScript.deleteMany({ where: { mailboxId: existing.id } }),
      this.prisma.mailHandleLog.deleteMany({
        where: { mailboxId: existing.id },
      }),
      this.prisma.mailAccount.delete({ where: { id: existing.id } }),
    ]);
    await this.identity.audit(
      user.userId,
      'AI邮箱服务删除邮箱',
      existing.address,
    );
    return { removed: true };
  }

  private configOf(row: AccountRow): MailAccountConfig {
    return {
      address: row.address,
      displayName: row.displayName,
      protocol: row.protocol,
      incomingHost: row.incomingHost,
      incomingPort: row.incomingPort,
      incomingSecurity: row.incomingSecurity,
      incomingUsername: row.incomingUsername,
      incomingPassword: this.crypto.decrypt(row.incomingSecret),
      inboxFolder: row.inboxFolder,
      draftsFolder: row.draftsFolder,
      sentFolder: row.sentFolder,
      outgoingHost: row.outgoingHost,
      outgoingPort: row.outgoingPort,
      outgoingSecurity: row.outgoingSecurity,
      outgoingUsername: row.outgoingUsername,
      outgoingPassword: row.outgoingSecret
        ? this.crypto.decrypt(row.outgoingSecret)
        : this.crypto.decrypt(row.incomingSecret),
    };
  }

  async testAccount(user: CurrentUser, id: string) {
    const row = await this.ownedAccount(user, id);
    const config = this.configOf(row);
    let incoming = true;
    let incomingMessage = '收信连接正常';
    try {
      await mailProtocol.testIncoming(config);
    } catch (error) {
      incoming = false;
      incomingMessage = (error as Error).message;
    }
    let outgoing = true;
    let outgoingMessage = '发信连接正常';
    try {
      await mailProtocol.testOutgoing(config);
    } catch (error) {
      outgoing = false;
      outgoingMessage = (error as Error).message;
    }
    const lastError = incoming
      ? outgoing
        ? ''
        : outgoingMessage
      : incomingMessage;
    await this.prisma.mailAccount.update({
      where: { id: row.id },
      data: { lastError },
    });
    return { incoming, incomingMessage, outgoing, outgoingMessage };
  }

  // ---------------------------------------------------------------- 读信

  /** 台账状态：key → result；台账没有这封＝未处理。 */
  private async ledgerOf(mailboxId: number, keys: string[]) {
    if (!keys.length) return new Map<string, string>();
    const rows = await this.prisma.mailHandleLog.findMany({
      where: { mailboxId, messageKey: { in: keys } },
      select: { messageKey: true, result: true },
    });
    return new Map(rows.map((row) => [row.messageKey, row.result] as const));
  }

  private statusLabel(result: string | undefined) {
    const key = result || 'pending';
    return {
      status: key,
      statusLabel: MAIL_MESSAGE_STATUS_LABELS[key] || key,
    };
  }

  private shapeSummary(
    summary: MailSummary,
    status: string | undefined,
  ): MailMessageSummary {
    return {
      key: summary.key,
      subject: summary.subject,
      fromName: summary.fromName,
      fromAddress: summary.fromAddress,
      receivedAt: summary.receivedAt.toISOString(),
      snippet: summary.snippet,
      unread: summary.unread,
      hasAttachments: summary.hasAttachments,
      ...this.statusLabel(status),
    };
  }

  private shapeMessage(
    detail: MailDetail,
    status: string | undefined,
  ): MailMessage {
    return {
      ...this.shapeSummary(detail, status),
      to: detail.to,
      cc: detail.cc,
      text: detail.text,
      attachments: detail.attachments,
    };
  }

  async messages(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    const row = await this.ownedAccount(user, id);
    if (!row.enabled) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个邮箱已停用');
    }
    const limit = intInRange(query.limit, 1, 100, 20);
    const unreadOnly = text(query.unreadOnly) === 'true';
    const list = await mailProtocol.listInbox(this.configOf(row), {
      limit,
      unreadOnly,
      sinceHours: 0,
    });
    const ledger = await this.ledgerOf(
      row.id,
      list.map((item) => item.key),
    );
    return list.map((item) => this.shapeSummary(item, ledger.get(item.key)));
  }

  async message(
    user: CurrentUser,
    id: string,
    key: string,
    query: Record<string, unknown>,
  ) {
    const row = await this.ownedAccount(user, id);
    const folder = text(query.folder).trim() || row.inboxFolder;
    const detail = await mailProtocol.read(this.configOf(row), key, folder);
    const ledger = await this.ledgerOf(row.id, [detail.key]);
    return this.shapeMessage(detail, ledger.get(detail.key));
  }

  async drafts(user: CurrentUser, id: string, query: Record<string, unknown>) {
    const row = await this.ownedAccount(user, id);
    if (row.protocol === 'pop3') return [];
    const limit = intInRange(query.limit, 1, 100, 20);
    const list = await mailProtocol.listDrafts(this.configOf(row), limit);
    const ledger = await this.ledgerOf(
      row.id,
      list.map((item) => item.key),
    );
    return list.map((item) => this.shapeSummary(item, ledger.get(item.key)));
  }

  // ---------------------------------------------------------------- 起草与发送

  private async recordLedger(
    row: AccountRow,
    messageKey: string,
    fromAddress: string,
    result: 'draft' | 'sent' | 'skipped',
    reason: string,
  ) {
    const handledOn = dayStart();
    await this.prisma.mailHandleLog.upsert({
      where: {
        mailboxId_messageKey: { mailboxId: row.id, messageKey },
      },
      create: {
        userId: row.userId,
        mailboxId: row.id,
        messageKey,
        fromAddress,
        result,
        reason,
        handledOn,
      },
      update: { result, reason, fromAddress, handledOn },
    });
  }

  /** 场景话术命中：关键词在主题/正文里，或发件人匹配；取优先级最小的一条。 */
  private async matchScript(row: AccountRow, detail: MailDetail) {
    const scripts = await this.prisma.mailScript.findMany({
      where: {
        userId: row.userId,
        enabled: true,
        OR: [
          { mailboxIds: { equals: [] } },
          { mailboxIds: { array_contains: [row.id] } },
        ],
      } as never,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const haystack =
      `${detail.subject}\n${detail.fromAddress}\n${detail.text}`.toLowerCase();
    for (const script of scripts) {
      const sender = script.senderPattern.trim().toLowerCase();
      if (sender && !detail.fromAddress.toLowerCase().includes(sender))
        continue;
      const keywords = script.keywords
        .split(/[,，、;；\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      if (
        keywords.length &&
        !keywords.some((item) => haystack.includes(item))
      ) {
        continue;
      }
      return script;
    }
    return null;
  }

  private replyDraft(
    detail: MailDetail,
    subject: string,
    body: string,
  ): MailDraft {
    const baseSubject = subject.trim() || detail.subject;
    return {
      to: [detail.fromAddress].filter(Boolean),
      subject: /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`,
      body,
      inReplyTo: detail.messageId || undefined,
      references: [...detail.references, detail.messageId].filter(Boolean),
    };
  }

  private async draftFor(
    row: AccountRow,
    body: Record<string, unknown>,
  ): Promise<{
    draft: MailDraft;
    matchedScript: string;
    key: string;
    fromAddress: string;
  }> {
    const key = text(body.key).trim();
    if (!key) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少要回复的邮件');
    }
    const config = this.configOf(row);
    const detail = await mailProtocol.read(config, key, row.inboxFolder);
    const script = await this.matchScript(row, detail);
    const rawBody = text(body.body).trim() || script?.content.trim() || '';
    if (!rawBody) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先写回复正文，或在「知识与话术」里配置命中这类邮件的话术',
      );
    }
    const subject = text(body.subject).trim() || detail.subject;
    const draft = this.replyDraft(
      detail,
      subject,
      withSignature(rawBody, row.signature),
    );
    if (!draft.to.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这封邮件没有可回复的发件人地址',
      );
    }
    return {
      draft,
      matchedScript: script?.name ?? '',
      key: detail.key || key,
      fromAddress: detail.fromAddress,
    };
  }

  async saveDraft(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<MailDraftResult> {
    const row = await this.ownedAccount(user, id);
    const prepared = await this.draftFor(row, body);
    const { savedTo } = await mailProtocol.saveDraft(
      this.configOf(row),
      prepared.draft,
    );
    await this.recordLedger(
      row,
      prepared.key,
      prepared.fromAddress,
      'draft',
      '手工生成草稿',
    );
    await this.prisma.mailAccount.update({
      where: { id: row.id },
      data: { lastRunAt: new Date(), lastError: '' },
    });
    return {
      ok: true,
      executed: true,
      result: 'draft',
      savedTo,
      message:
        row.protocol === 'pop3'
          ? 'POP3 没有草稿箱：正文已返回，可复制后手动发出'
          : `草稿已保存到 ${savedTo}`,
      matchedScript: prepared.matchedScript,
      body: prepared.draft.body,
    };
  }

  async sendReply(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<MailDraftResult> {
    const row = await this.ownedAccount(user, id);
    const prepared = await this.draftFor(row, body);
    const { savedTo } = await mailProtocol.send(
      this.configOf(row),
      prepared.draft,
    );
    await this.recordLedger(
      row,
      prepared.key,
      prepared.fromAddress,
      'sent',
      '手工发送',
    );
    await this.prisma.mailAccount.update({
      where: { id: row.id },
      data: { lastRunAt: new Date(), lastError: '' },
    });
    return {
      ok: true,
      executed: true,
      result: 'sent',
      savedTo,
      message: '回复已发送',
      matchedScript: prepared.matchedScript,
      body: prepared.draft.body,
    };
  }

  // ---------------------------------------------------------------- 话术

  private shapeScript(row: ScriptRow): MailScript {
    return {
      id: row.id,
      mailboxId: row.mailboxId,
      mailboxIds: idList(row.mailboxIds, 20),
      name: row.name,
      keywords: row.keywords,
      senderPattern: row.senderPattern,
      priority: row.priority,
      content: row.content,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async scripts(user: CurrentUser, query: Record<string, unknown> = {}) {
    const mailboxId = Number(query.mailboxId ?? 0);
    const rows = await this.prisma.mailScript.findMany({
      where: {
        userId: user.userId,
        ...(Number.isInteger(mailboxId) && mailboxId > 0
          ? {
              OR: [
                { mailboxIds: { equals: [] } },
                { mailboxIds: { array_contains: [mailboxId] } },
              ],
            }
          : {}),
      } as never,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((item) => this.shapeScript(item));
  }

  /** 生效邮箱必须都是本账号的邮箱；空数组＝全部邮箱。 */
  private async mailboxIdsOf(
    user: CurrentUser,
    raw: unknown,
    existing?: unknown,
  ) {
    if (raw === undefined) return idList(existing, 20);
    const ids = idList(raw, 20);
    if (ids.length) {
      const count = await this.prisma.mailAccount.count({
        where: { userId: user.userId, id: { in: ids } },
      });
      if (count !== ids.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '生效邮箱里包含不存在或不属于你的邮箱',
        );
      }
    }
    return ids;
  }

  private readScriptBody(body: Record<string, unknown>, existing?: ScriptRow) {
    const name = text(body.name, existing?.name).trim().slice(0, 80);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请给话术起个名字');
    }
    const content = text(body.content, existing?.content).trim();
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '话术内容不能为空');
    }
    if (content.length > MAX_SCRIPT_CONTENT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `话术内容请精简到 ${MAX_SCRIPT_CONTENT} 字以内`,
      );
    }
    return {
      name,
      keywords: text(body.keywords, existing?.keywords).trim().slice(0, 300),
      senderPattern: text(body.senderPattern, existing?.senderPattern)
        .trim()
        .slice(0, 160),
      priority: intInRange(body.priority, 1, 999, existing?.priority ?? 100),
      content,
      enabled:
        body.enabled === undefined
          ? (existing?.enabled ?? true)
          : body.enabled === true || text(body.enabled) === 'true',
    };
  }

  async saveScript(user: CurrentUser, body: Record<string, unknown>) {
    const data = this.readScriptBody(body);
    const mailboxIds = await this.mailboxIdsOf(user, body.mailboxIds);
    const created = await this.prisma.mailScript.create({
      data: {
        mailboxId: mailboxIds[0] ?? 0,
        mailboxIds: mailboxIds as never,
        userId: user.userId,
        ...data,
      },
    });
    return this.shapeScript(created);
  }

  private async ownedScript(user: CurrentUser, scriptId: string) {
    const id = Number(scriptId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '话术编号无效');
    }
    const row = await this.prisma.mailScript.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '话术不存在或已被删除');
    }
    return row;
  }

  async updateScript(
    user: CurrentUser,
    scriptId: string,
    body: Record<string, unknown>,
  ) {
    const existing = await this.ownedScript(user, scriptId);
    const data = this.readScriptBody(body, existing);
    const mailboxIds = await this.mailboxIdsOf(
      user,
      body.mailboxIds,
      existing.mailboxIds,
    );
    const row = await this.prisma.mailScript.update({
      where: { id: existing.id },
      data: {
        ...data,
        mailboxId: mailboxIds[0] ?? 0,
        mailboxIds: mailboxIds as never,
      },
    });
    return this.shapeScript(row);
  }

  async removeScript(user: CurrentUser, scriptId: string) {
    const existing = await this.ownedScript(user, scriptId);
    await this.prisma.mailScript.delete({ where: { id: existing.id } });
    return { removed: true };
  }

  // ---------------------------------------------------------------- 台账

  async ledger(user: CurrentUser, query: Record<string, unknown>) {
    const mailboxId = Number(query.mailboxId ?? 0);
    const limit = intInRange(query.limit, 1, 200, LEDGER_LIMIT);
    const rows = await this.prisma.mailHandleLog.findMany({
      where: {
        userId: user.userId,
        ...(Number.isInteger(mailboxId) && mailboxId > 0 ? { mailboxId } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
    const addresses = new Map<number, string>();
    const ids = [...new Set(rows.map((row) => row.mailboxId))];
    if (ids.length) {
      const accounts = await this.prisma.mailAccount.findMany({
        where: { id: { in: ids } },
        select: { id: true, address: true },
      });
      for (const account of accounts)
        addresses.set(account.id, account.address);
    }
    return rows.map((row): MailHandleLog => ({
      id: row.id,
      mailboxId: row.mailboxId,
      address: addresses.get(row.mailboxId) ?? '',
      fromAddress: row.fromAddress,
      result: row.result,
      resultLabel: MAIL_MESSAGE_STATUS_LABELS[row.result] || row.result,
      reason: row.reason,
      handledAt: row.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- MCP / 定时任务

  /** 只返回本账号（或本次任务指定范围内）的邮箱，MCP 与界面共用。 */
  async accountsForTools(user: CurrentUser, mailboxIds?: number[]) {
    const rows = await this.prisma.mailAccount.findMany({
      where: {
        userId: user.userId,
        ...(mailboxIds && mailboxIds.length ? { id: { in: mailboxIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: MAX_ACCOUNTS,
    });
    const stats = await this.statsOf(rows.map((row) => row.id));
    return rows.map((row) =>
      this.shapeAccount(
        row,
        stats.get(row.id) ?? { todaySent: 0, todayDraft: 0, monthHandled: 0 },
      ),
    );
  }

  async toolAccount(
    user: CurrentUser,
    mailboxId: number,
    mailboxIds?: number[],
  ): Promise<AccountRow> {
    if (mailboxIds && mailboxIds.length && !mailboxIds.includes(mailboxId)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '这个邮箱不在本次任务指定的邮箱范围内',
      );
    }
    const row = await this.prisma.mailAccount.findFirst({
      where: { id: mailboxId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮箱不存在或已被删除');
    }
    if (!row.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `邮箱 ${row.address} 已停用`,
      );
    }
    return row;
  }

  async toolMessages(
    user: CurrentUser,
    mailboxId: number,
    options: { unreadOnly: boolean; sinceHours: number; limit: number },
    mailboxIds?: number[],
  ) {
    const row = await this.toolAccount(user, mailboxId, mailboxIds);
    const list = await mailProtocol.listInbox(this.configOf(row), options);
    const ledger = await this.ledgerOf(
      row.id,
      list.map((item) => item.key),
    );
    return list.map((item) => this.shapeSummary(item, ledger.get(item.key)));
  }

  async toolRead(
    user: CurrentUser,
    mailboxId: number,
    key: string,
    mailboxIds?: number[],
  ) {
    const row = await this.toolAccount(user, mailboxId, mailboxIds);
    const detail = await mailProtocol.read(
      this.configOf(row),
      key,
      row.inboxFolder,
    );
    const ledger = await this.ledgerOf(row.id, [detail.key]);
    return {
      message: this.shapeMessage(detail, ledger.get(detail.key)),
      detail,
      account: row,
    };
  }

  /** MCP 起草：回复正文由调用方给，命中话术只作提示。 */
  async toolCreateDraft(
    user: CurrentUser,
    mailboxId: number,
    key: string,
    body: string,
    subject: string,
    mailboxIds?: number[],
  ): Promise<MailDraftResult & { alreadyHandled: boolean }> {
    const row = await this.toolAccount(user, mailboxId, mailboxIds);
    const existing = await this.prisma.mailHandleLog.findUnique({
      where: { mailboxId_messageKey: { mailboxId: row.id, messageKey: key } },
    });
    if (existing && existing.result !== 'skipped') {
      return {
        ok: true,
        executed: false,
        result: 'draft',
        savedTo: '',
        message: `这封邮件已经处理过（${MAIL_MESSAGE_STATUS_LABELS[existing.result] || existing.result}），本轮不重复生成草稿`,
        matchedScript: '',
        body: '',
        alreadyHandled: true,
      };
    }
    const prepared = await this.draftFor(row, { key, body, subject });
    const { savedTo } = await mailProtocol.saveDraft(
      this.configOf(row),
      prepared.draft,
    );
    await this.recordLedger(
      row,
      prepared.key,
      prepared.fromAddress,
      'draft',
      'AI 生成草稿',
    );
    await this.prisma.mailAccount.update({
      where: { id: row.id },
      data: { lastRunAt: new Date(), lastError: '' },
    });
    return {
      ok: true,
      executed: true,
      result: 'draft',
      savedTo,
      message:
        row.protocol === 'pop3'
          ? 'POP3 没有草稿箱：正文已返回，可复制后手动发出'
          : `草稿已保存到 ${savedTo}`,
      matchedScript: prepared.matchedScript,
      body: prepared.draft.body,
      alreadyHandled: false,
    };
  }

  /**
   * 自动回复的安全闸：自寄、自动提交、退信、邮件列表一律跳过；
   * 同一发件人每天最多 1 次；单轮封数上限由邮箱设置决定。
   */
  async toolSendReply(
    user: CurrentUser,
    mailboxId: number,
    key: string,
    body: string,
    subject: string,
    options: { granted: boolean; mailboxIds?: number[] },
  ): Promise<MailDraftResult & { blockedReason: string }> {
    const row = await this.toolAccount(user, mailboxId, options.mailboxIds);
    const detail = await mailProtocol.read(
      this.configOf(row),
      key,
      row.inboxFolder,
    );
    const existing = await this.prisma.mailHandleLog.findUnique({
      where: {
        mailboxId_messageKey: {
          mailboxId: row.id,
          messageKey: detail.key || key,
        },
      },
    });
    const blocked = await this.autoReplyBlocked(
      row,
      detail,
      existing,
      options.granted,
    );
    if (blocked) {
      if (!existing) {
        await this.recordLedger(
          row,
          detail.key || key,
          detail.fromAddress,
          'skipped',
          blocked,
        );
      }
      return {
        ok: true,
        executed: false,
        result: 'draft',
        savedTo: '',
        message: blocked,
        matchedScript: '',
        body: '',
        blockedReason: blocked,
      };
    }
    const prepared = await this.draftFor(row, { key, body, subject });
    const { savedTo } = await mailProtocol.send(
      this.configOf(row),
      prepared.draft,
    );
    await this.recordLedger(
      row,
      prepared.key,
      prepared.fromAddress,
      'sent',
      'AI 自动回复',
    );
    await this.prisma.mailAccount.update({
      where: { id: row.id },
      data: { lastRunAt: new Date(), lastError: '' },
    });
    return {
      ok: true,
      executed: true,
      result: 'sent',
      savedTo,
      message: '回复已发送',
      matchedScript: prepared.matchedScript,
      body: prepared.draft.body,
      blockedReason: '',
    };
  }

  /** 返回空串＝可以自动发送；否则是跳过的原因（中文，直接给模型与界面看）。 */
  private async autoReplyBlocked(
    row: AccountRow,
    detail: MailDetail,
    existing: { result: string } | null,
    granted: boolean,
  ): Promise<string> {
    if (!granted) {
      return '本账号没有勾选「发送邮件回复」自动执行，只能生成草稿；请在「智能体记忆 → 可自动执行的动作」里勾选 Mail_sendReply。';
    }
    if (row.replyMode !== 'auto_send') {
      return '这个邮箱的回复方式是「只写草稿」，不会自动发送。';
    }
    if (existing && existing.result === 'sent') {
      return '这封邮件已经回复过，本轮不重复发送。';
    }
    const from = detail.fromAddress.toLowerCase();
    if (!from || from === row.address.toLowerCase()) {
      return '自己发给自己的邮件不自动回复。';
    }
    if (detail.autoSubmitted && detail.autoSubmitted.toLowerCase() !== 'no') {
      return '自动提交/自动回复类邮件不自动回复。';
    }
    if (detail.listId || /mailer-daemon@|postmaster@/i.test(from)) {
      return '邮件列表与退信通知不自动回复。';
    }
    if (/^(undeliverable|undelivered|退信|自动回复)/i.test(detail.subject)) {
      return '退信与自动回复类邮件不自动回复。';
    }
    const repliedToday = await this.prisma.mailHandleLog.count({
      where: {
        mailboxId: row.id,
        fromAddress: detail.fromAddress,
        result: 'sent',
        handledOn: dayStart(),
      },
    });
    if (repliedToday >= AUTO_REPLY_PER_SENDER_PER_DAY) {
      return '同一发件人今天已经自动回复过，不再重复回复。';
    }
    const sentToday = await this.prisma.mailHandleLog.count({
      where: { mailboxId: row.id, result: 'sent', handledOn: dayStart() },
    });
    if (sentToday >= row.maxPerRun) {
      return `这个邮箱单轮最多自动发送 ${row.maxPerRun} 封，今天已经达到上限。`;
    }
    return '';
  }
}
