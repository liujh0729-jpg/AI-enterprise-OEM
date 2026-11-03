import { randomUUID } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';

/**
 * 邮件协议层：收信（IMAP / POP3）、取信、存草稿（IMAP APPEND）、发信（SMTP）。
 * 这里只做协议动作，不碰数据库：正文、主题、附件一律不落库。
 * IMAP 用 `imap` + `mailparser`，SMTP 用 `nodemailer`，POP3 无可用 CJS 客户端，自己按 RFC 1939 手写。
 */

const log = new Logger('MailboxProtocol');
const CONNECT_TIMEOUT_MS = 15000;
const SOCKET_TIMEOUT_MS = 30000;
const SNIPPET_LENGTH = 160;

export type MailAccountConfig = {
  address: string;
  displayName: string;
  protocol: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecurity: string;
  incomingUsername: string;
  incomingPassword: string;
  inboxFolder: string;
  draftsFolder: string;
  sentFolder: string;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecurity: string;
  outgoingUsername: string;
  outgoingPassword: string;
};

export type MailAttachmentInfo = {
  name: string;
  size: number;
  contentType: string;
};

export type MailSummary = {
  key: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  receivedAt: Date;
  snippet: string;
  unread: boolean;
  hasAttachments: boolean;
  messageId: string;
  to: string[];
  cc: string[];
};

export type MailDetail = MailSummary & {
  text: string;
  attachments: MailAttachmentInfo[];
  inReplyTo: string;
  references: string[];
  autoSubmitted: string;
  listId: string;
};

export type MailDraft = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
};

type EnvelopeAddress = { name?: string; address?: string };

type ImapEnvelope = {
  subject?: string;
  date?: string | Date;
  messageId?: string;
  from?: EnvelopeAddress[];
  to?: EnvelopeAddress[];
  cc?: EnvelopeAddress[];
  inReplyTo?: string;
};

type MimeNode = {
  partID?: string;
  type?: string;
  subtype?: string;
  encoding?: string;
  size?: number;
  disposition?: string;
  childNodes?: MimeNode[];
  parameters?: { name?: string };
};

type FetchAttributes = {
  uid?: number;
  flags?: string[];
  envelope?: ImapEnvelope;
  struct?: MimeNode[];
  size?: number;
};

type FetchBody = { which?: string; body: Buffer };

// ---------------------------------------------------------------- 错误与解码

class MailProtocolError extends Error {
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
  }
}

/** 上游报错一律翻成中文；原文只进服务日志，不进界面。 */
function wrapError(error: unknown, action: string): MailProtocolError {
  if (error instanceof MailProtocolError) return error;
  const raw = error instanceof Error ? error.message : text(error);
  log.warn({ action, error: raw.slice(0, 400) });
  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return new MailProtocolError(
      `连不上邮件服务器（${action}），请检查主机、端口与加密方式`,
      raw,
    );
  }
  if (/ENOTFOUND/i.test(raw)) {
    return new MailProtocolError(
      `邮件服务器地址解析失败（${action}），请检查主机名`,
      raw,
    );
  }
  if (
    /auth|login|credentials|password|user(?:name)?\b|LOGIN|AUTHENTICATIONFAILED/i.test(
      raw,
    )
  ) {
    return new MailProtocolError(
      `邮箱账号或密码被拒绝（${action}）：多数邮箱要用「授权码」而不是网页登录密码`,
      raw,
    );
  }
  if (/certificate|self signed|TLS|SSL/i.test(raw)) {
    return new MailProtocolError(
      `邮件服务器证书校验失败（${action}），请确认端口与加密方式是否匹配`,
      raw,
    );
  }
  return new MailProtocolError(
    `邮件服务器返回错误（${action}），请稍后重试`,
    raw,
  );
}

function decodeQuotedPrintable(input: string): string {
  const unified = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < unified.length; index += 1) {
    const char = unified[index];
    const hex = unified.slice(index + 1, index + 3);
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(unified.charCodeAt(index) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** 按 part 的 transfer-encoding 解码正文片段。 */
function decodePart(buffer: Buffer, encoding?: string): string {
  const value = String(encoding ?? '').toLowerCase();
  if (value === 'base64') {
    const cleaned = buffer.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
    return Buffer.from(cleaned, 'base64').toString('utf8');
  }
  if (value === 'quoted-printable') {
    return decodeQuotedPrintable(buffer.toString('latin1'));
  }
  return buffer.toString('utf8');
}

function snippetOf(text: string): string {
  const plain = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, SNIPPET_LENGTH);
}

function nameOf(address: EnvelopeAddress | undefined): string {
  const name = String(address?.name ?? '').trim();
  return name ? name.replace(/^"(.*)"$/, '$1') : '';
}

function addressOf(address: EnvelopeAddress | undefined): string {
  return String(address?.address ?? '').trim();
}

function dateOf(value: string | Date | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** 在 MIME 结构里找第一个纯文本 part；没有就用第一个 text/*。 */
function findTextPart(nodes: MimeNode[] | undefined): MimeNode | null {
  if (!Array.isArray(nodes)) return null;
  const queue = [...nodes];
  let fallback: MimeNode | null = null;
  while (queue.length) {
    const node = queue.shift() as MimeNode;
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      queue.push(...node.childNodes);
      continue;
    }
    const type = String(node.type ?? '').toLowerCase();
    const disposition = String(node.disposition ?? '').toLowerCase();
    if (type === 'text' && disposition !== 'attachment') {
      if (String(node.subtype ?? '').toLowerCase() === 'plain') return node;
      if (!fallback) fallback = node;
    }
  }
  return fallback;
}

/** 附件只看名称与大小，不下载内容。 */
function attachmentsOf(nodes: MimeNode[] | undefined): MailAttachmentInfo[] {
  const list: MailAttachmentInfo[] = [];
  const walk = (items: MimeNode[]) => {
    for (const node of items) {
      if (Array.isArray(node.childNodes) && node.childNodes.length) {
        walk(node.childNodes);
        continue;
      }
      const disposition = String(node.disposition ?? '').toLowerCase();
      const filename = String(node.parameters?.name ?? '').trim();
      if (disposition === 'attachment' || filename) {
        list.push({
          name: filename || '未命名附件',
          size: Number(node.size) || 0,
          contentType: `${node.type ?? 'application'}/${node.subtype ?? 'octet-stream'}`,
        });
      }
    }
  };
  if (Array.isArray(nodes)) walk(nodes);
  return list.slice(0, 50);
}

// ---------------------------------------------------------------- 原始报文

function encodeHeaderText(value: string): string {
  // 纯 ASCII 直接写；含中文等非 ASCII 用 RFC 2047 Base64 编码字

  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

/** 拼一封最简 MIME 报文：存草稿与发信共用，保证两处内容完全一致。 */
function buildRawMessage(
  from: { name: string; address: string },
  draft: MailDraft,
): string {
  const fromName = from.name.trim();
  const headers = [
    `From: ${fromName ? `${encodeHeaderText(fromName)} <${from.address}>` : `<${from.address}>`}`,
    `To: ${draft.to.join(', ')}`,
    ...(draft.cc && draft.cc.length ? [`Cc: ${draft.cc.join(', ')}`] : []),
    `Subject: ${encodeHeaderText(draft.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${from.address.split('@')[1] || 'aiworkin.local'}>`,
    ...(draft.inReplyTo ? [`In-Reply-To: ${draft.inReplyTo}`] : []),
    ...(draft.references && draft.references.length
      ? [`References: ${draft.references.join(' ')}`]
      : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(draft.body)}\r\n`;
}

// ---------------------------------------------------------------- IMAP

function imapConfig(conn: MailAccountConfig): Imap.Config {
  const security = conn.incomingSecurity;
  return {
    user: conn.incomingUsername,
    password: conn.incomingPassword,
    host: conn.incomingHost,
    port: conn.incomingPort,
    tls: security === 'ssl',
    autotls: security === 'starttls' ? 'always' : undefined,
    tlsOptions: { servername: conn.incomingHost },
    connTimeout: CONNECT_TIMEOUT_MS,
    authTimeout: CONNECT_TIMEOUT_MS,
  };
}

async function openImap(conn: MailAccountConfig): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const client = new Imap(imapConfig(conn));
    let settled = false;
    // 连上之后仍可能出错：必须有常驻监听器，否则 node-imap 的 error 事件没人接会让进程直接退出
    client.on('error', (error: unknown) => {
      if (settled) {
        log.warn({ action: '收信', error: text(error).slice(0, 200) });
        return;
      }
      settled = true;
      try {
        client.end();
      } catch {
        // 连接本就失败，end 只是尽力收尾
      }
      reject(wrapError(error, '收信'));
    });
    client.on('end', () => {
      if (settled) return;
      settled = true;
      reject(wrapError(new Error('邮件服务器提前断开连接'), '收信'));
    });
    client.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });
    client.connect();
  });
}

function openBox(client: Imap, folder: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.openBox(folder, false, (error) => {
      if (error) reject(wrapError(error, `打开文件夹 ${folder}`));
      else resolve();
    });
  });
}

function searchUids(client: Imap, criteria: unknown[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    client.search(criteria as never, (error, uids) => {
      if (error) reject(wrapError(error, '检索邮件'));
      else resolve((uids ?? []).map((item) => Number(item)));
    });
  });
}

type FetchResult = { attributes: FetchAttributes; body: Buffer | null };

function fetchMessages(
  client: Imap,
  uids: number[],
  options: Record<string, unknown>,
): Promise<Map<number, FetchResult>> {
  return new Promise((resolve, reject) => {
    if (!uids.length) {
      resolve(new Map());
      return;
    }
    const results = new Map<number, FetchResult>();
    const fetcher = client.fetch(uids, options);
    fetcher.on('message', (message) => {
      let seqno = 0;
      let attributes: FetchAttributes = {};
      const chunks: Buffer[] = [];
      message.on('attributes', (attrs) => {
        // node-imap 实际会带 envelope（类型声明里漏了），按自己的形状读
        const parsed = attrs as unknown as FetchAttributes;
        attributes = parsed;
        seqno = Number(parsed.uid ?? 0);
      });
      message.on('body', (stream: NodeJS.ReadableStream, info?: FetchBody) => {
        void info;
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      });
      message.on('end', () => {
        if (!seqno) return;
        results.set(seqno, {
          attributes,
          body: chunks.length ? Buffer.concat(chunks) : null,
        });
      });
    });
    fetcher.once('error', (error: Error) =>
      reject(wrapError(error, '读取邮件')),
    );
    fetcher.once('end', () => resolve(results));
  });
}

function summarise(
  uid: number,
  folder: string,
  result: FetchResult,
  snippet: string,
): MailSummary {
  const envelope = result.attributes.envelope ?? {};
  const flags = result.attributes.flags ?? [];
  const from = envelope.from?.[0];
  const struct = result.attributes.struct ?? [];
  const messageId = String(envelope.messageId ?? '').trim();
  return {
    key: messageId ? `mid:${messageId}` : `uid:${folder}:${uid}`,
    subject: String(envelope.subject ?? '').trim() || '（无主题）',
    fromName: nameOf(from) || addressOf(from),
    fromAddress: addressOf(from),
    receivedAt: dateOf(envelope.date),
    snippet: snippetOf(snippet),
    unread: !flags.includes('\\Seen'),
    hasAttachments: attachmentsOf(struct).length > 0,
    messageId,
    to: (envelope.to ?? []).map((item) => addressOf(item)).filter(Boolean),
    cc: (envelope.cc ?? []).map((item) => addressOf(item)).filter(Boolean),
  };
}

async function imapList(
  conn: MailAccountConfig,
  folder: string,
  limit: number,
  unreadOnly: boolean,
  sinceHours: number,
): Promise<MailSummary[]> {
  const client = await openImap(conn);
  try {
    await openBox(client, folder);
    const since = new Date(Date.now() - sinceHours * 3600_000);
    const criteria: unknown[] = [];
    if (unreadOnly) criteria.push('UNSEEN');
    if (sinceHours > 0) {
      criteria.push([
        'SINCE',
        since.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      ]);
    }
    if (!criteria.length) criteria.push('ALL');
    const uids = (await searchUids(client, criteria)).sort((a, b) => b - a);
    const page = uids.slice(0, limit);
    if (!page.length) return [];
    const fetched = await fetchMessages(client, page, {
      envelope: true,
      flags: true,
      struct: true,
      markSeen: false,
    });
    const summaries: MailSummary[] = [];
    for (const uid of page) {
      const result = fetched.get(uid);
      if (!result) continue;
      const part = findTextPart(result.attributes.struct);
      let snippet = '';
      if (part?.partID) {
        try {
          const body = await fetchMessages(client, [uid], {
            bodies: [part.partID],
            markSeen: false,
          });
          const chunk = body.get(uid)?.body;
          if (chunk) snippet = decodePart(chunk, part.encoding);
        } catch (error) {
          log.warn({ action: '摘要', error: String(error).slice(0, 200) });
        }
      }
      summaries.push(summarise(uid, folder, result, snippet));
    }
    return summaries;
  } finally {
    client.end();
  }
}

async function imapRead(
  conn: MailAccountConfig,
  key: string,
  folder: string,
): Promise<MailDetail> {
  const client = await openImap(conn);
  try {
    await openBox(client, folder);
    const uids = await searchByKey(client, key, folder);
    if (!uids.length) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件不存在或已被删除');
    }
    const fetched = await fetchMessages(client, [uids[0]], {
      bodies: '',
      markSeen: false,
    });
    const result = fetched.get(uids[0]);
    const raw = result?.body;
    if (!result || !raw) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件内容读取失败');
    }
    const parsed = await simpleParser(raw);
    const from = parsed.from?.value?.[0];
    const struct = result.attributes.struct ?? [];
    const messageId = String(
      parsed.messageId ?? result.attributes.envelope?.messageId ?? '',
    ).trim();
    const referencesHeader = parsed.headers.get('references');
    const references = Array.isArray(referencesHeader)
      ? referencesHeader.map((item) => text(item))
      : typeof referencesHeader === 'string'
        ? referencesHeader.split(/\s+/).filter(Boolean)
        : [];
    const autoSubmitted = text(parsed.headers.get('auto-submitted'));
    const listId = text(parsed.headers.get('list-id'));
    return {
      key: messageId ? `mid:${messageId}` : `uid:${folder}:${uids[0]}`,
      subject:
        String(
          parsed.subject ?? result.attributes.envelope?.subject ?? '',
        ).trim() || '（无主题）',
      fromName: String(from?.name ?? '') || String(from?.address ?? ''),
      fromAddress: String(from?.address ?? ''),
      receivedAt: parsed.date ?? dateOf(result.attributes.envelope?.date),
      snippet: snippetOf(String(parsed.text ?? '')),
      unread: !(result.attributes.flags ?? []).includes('\\Seen'),
      hasAttachments:
        (parsed.attachments ?? []).length > 0 ||
        attachmentsOf(struct).length > 0,
      messageId,
      to: (parsed.to && !Array.isArray(parsed.to) ? parsed.to.value : []).map(
        (item) => item.address ?? '',
      ),
      cc: (parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc.value : []).map(
        (item) => item.address ?? '',
      ),
      text:
        String(parsed.text ?? '').trim() ||
        snippetOf(String(parsed.html ?? '')),
      attachments: (parsed.attachments ?? []).map((item) => ({
        name: item.filename || '未命名附件',
        size: item.size ?? 0,
        contentType: item.contentType || 'application/octet-stream',
      })),
      inReplyTo: String(parsed.inReplyTo ?? ''),
      references,
      autoSubmitted,
      listId,
    };
  } finally {
    client.end();
  }
}

/** key 有两种：`mid:<Message-ID>` 与 `uid:<文件夹>:<uid>`。 */
async function searchByKey(
  client: Imap,
  key: string,
  folder: string,
): Promise<number[]> {
  if (key.startsWith('uid:')) {
    const [, scope, uid] = key.split(':');
    if (scope && scope !== folder) {
      // 别的文件夹里的 uid 在这边无意义，按找不到处理
      return [];
    }
    const value = Number(uid);
    return Number.isInteger(value) && value > 0 ? [value] : [];
  }
  const messageId = key.startsWith('mid:') ? key.slice(4) : key;
  if (!messageId) return [];
  return searchUids(client, [['HEADER', 'MESSAGE-ID', messageId]]);
}

async function imapAppend(
  conn: MailAccountConfig,
  folder: string,
  raw: string,
  flags: string[],
): Promise<boolean> {
  const client = await openImap(conn);
  try {
    await openBox(client, 'INBOX');
    await new Promise<void>((resolve, reject) => {
      client.append(raw, { mailbox: folder, flags }, (error) => {
        if (error) reject(wrapError(error, `保存到 ${folder}`));
        else resolve();
      });
    });
    return true;
  } finally {
    client.end();
  }
}

// ---------------------------------------------------------------- POP3

type Pop3Reply = { ok: boolean; lines: string[] };

/** 最小 POP3 客户端：USER/PASS、UIDL、TOP、RETR，够读信与起草用。 */
class Pop3Client {
  private socket: Socket | TLSSocket | null = null;
  private buffer = '';
  private lines: string[] = [];
  private waiter: {
    resolve: (reply: Pop3Reply) => void;
    reject: (error: Error) => void;
  } | null = null;
  private expectMulti = false;
  private multiline = false;

  constructor(private readonly conn: MailAccountConfig) {}

  async connect(): Promise<void> {
    const security = this.conn.incomingSecurity;
    const reply = this.awaitReply(false);
    this.socket =
      security === 'ssl'
        ? tlsConnect({
            host: this.conn.incomingHost,
            port: this.conn.incomingPort,
            servername: this.conn.incomingHost,
          })
        : netConnect({
            host: this.conn.incomingHost,
            port: this.conn.incomingPort,
          });
    this.bind(this.socket);
    const greeting = await reply;
    if (!greeting.ok) throw new MailProtocolError('邮件服务器拒绝连接（收信）');
    if (security === 'starttls') {
      await this.upgradeTls();
    }
    const user = await this.command(
      `USER ${this.conn.incomingUsername}`,
      false,
    );
    if (!user.ok) throw new MailProtocolError('邮箱账号被拒绝（收信）');
    const pass = await this.command(
      `PASS ${this.conn.incomingPassword}`,
      false,
    );
    if (!pass.ok) {
      throw new MailProtocolError(
        '邮箱账号或密码被拒绝（收信）：多数邮箱要用「授权码」而不是网页登录密码',
      );
    }
  }

  private bind(socket: Socket | TLSSocket) {
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
      this.fail(new Error('邮件服务器响应超时'));
    });
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('邮件服务器提前断开连接')));
  }

  private async upgradeTls(): Promise<void> {
    const reply = await this.command('STLS', false);
    if (!reply.ok)
      throw new MailProtocolError('邮件服务器不支持 STARTTLS（收信）');
    const previous = this.socket;
    if (!previous) throw new MailProtocolError('连接已断开（收信）');
    previous.removeAllListeners('data');
    previous.removeAllListeners('error');
    previous.removeAllListeners('close');
    this.buffer = '';
    const secured = tlsConnect({
      socket: previous,
      servername: this.conn.incomingHost,
    });
    const ready = new Promise<void>((resolve, reject) => {
      secured.once('secureConnect', () => resolve());
      secured.once('error', reject);
    });
    this.socket = secured;
    this.bind(secured);
    try {
      await ready;
    } catch (error) {
      throw wrapError(error, 'STARTTLS 加密');
    }
  }

  async command(text: string, multi: boolean): Promise<Pop3Reply> {
    if (!this.socket) throw new MailProtocolError('连接已断开（收信）');
    const reply = this.awaitReply(multi);
    this.socket.write(`${text}\r\n`);
    return reply;
  }

  private awaitReply(multi: boolean): Promise<Pop3Reply> {
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.lines = [];
      this.expectMulti = multi;
      this.multiline = false;
    });
  }

  private fail(error: Error) {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(wrapError(error, '收信'));
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString('binary');
    let index = this.buffer.indexOf('\r\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const done = this.handleLine(line);
      if (done) return;
      index = this.buffer.indexOf('\r\n');
    }
  }

  private handleLine(line: string): boolean {
    const waiter = this.waiter;
    if (!waiter) return true;
    if (this.multiline) {
      if (line === '.') {
        this.waiter = null;
        this.multiline = false;
        waiter.resolve({ ok: true, lines: this.lines });
        return true;
      }
      this.lines.push(line.startsWith('..') ? line.slice(1) : line);
      return false;
    }
    if (line.startsWith('+OK')) {
      if (this.expectMulti) {
        this.multiline = true;
        this.lines = [];
        return false;
      }
      this.waiter = null;
      waiter.resolve({ ok: true, lines: [line] });
      return true;
    }
    this.waiter = null;
    waiter.resolve({ ok: false, lines: [line] });
    return true;
  }

  end() {
    try {
      this.socket?.write('QUIT\r\n');
      this.socket?.end();
    } catch {
      // 已断开时忽略
    }
    this.socket = null;
  }
}

function parseHeaderBlock(lines: string[]): Map<string, string> {
  const headers = new Map<string, string>();
  let current = '';
  for (const line of lines) {
    if (!line) break;
    if (/^\s/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ''} ${line.trim()}`);
      continue;
    }
    const index = line.indexOf(':');
    if (index > 0) {
      current = line.slice(0, index).trim().toLowerCase();
      headers.set(current, line.slice(index + 1).trim());
    }
  }
  return headers;
}

/** RFC 2047 编码字解码（=?UTF-8?B?...?= / =?UTF-8?Q?...?=）。 */
function decodeHeaderValue(raw: string): string {
  return raw.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, _charset: string, encoding: string, payload: string) =>
      encoding.toUpperCase() === 'B'
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeQuotedPrintable(payload.replace(/_/g, ' ')),
  );
}

function splitAddress(raw: string): EnvelopeAddress {
  const value = decodeHeaderValue(raw).trim();
  const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(value);
  if (match) {
    return { name: match[1]?.trim(), address: match[2]?.trim() };
  }
  return { address: value };
}

function pop3Summary(
  index: number,
  uidl: string,
  headers: Map<string, string>,
  bodyLines: string[],
): MailSummary {
  const from = splitAddress(headers.get('from') ?? '');
  const messageId = (headers.get('message-id') ?? '').trim();
  return {
    key: messageId ? `mid:${messageId}` : `uidl:${uidl}`,
    subject:
      decodeHeaderValue(headers.get('subject') ?? '').trim() || '（无主题）',
    fromName: from.name || from.address || '',
    fromAddress: from.address || '',
    receivedAt: dateOf(headers.get('date')),
    snippet: snippetOf(decodeHeaderValue(bodyLines.join('\n'))),
    // POP3 没有已读标记：没进台账就算未处理
    unread: true,
    hasAttachments: /multipart\/mixed/i.test(headers.get('content-type') ?? ''),
    messageId,
    to: (headers.get('to') ?? '')
      .split(',')
      .map((item) => splitAddress(item).address ?? '')
      .filter(Boolean),
    cc: (headers.get('cc') ?? '')
      .split(',')
      .map((item) => splitAddress(item).address ?? '')
      .filter(Boolean),
  };
}

async function pop3List(
  conn: MailAccountConfig,
  limit: number,
  unreadOnly: boolean,
  sinceHours: number,
): Promise<MailSummary[]> {
  const client = new Pop3Client(conn);
  try {
    await client.connect();
    const uidlReply = await client.command('UIDL', true);
    if (!uidlReply.ok) throw new MailProtocolError('读取邮件清单失败（收信）');
    const entries = uidlReply.lines
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2 && /^\d+$/.test(parts[0]))
      .map((parts) => ({ index: Number(parts[0]), uidl: parts[1] }))
      .reverse();
    const since = Date.now() - sinceHours * 3600_000;
    const summaries: MailSummary[] = [];
    for (const entry of entries) {
      if (summaries.length >= limit) break;
      const top = await client.command(`TOP ${entry.index} 20`, true);
      if (!top.ok) continue;
      const headerEnd = top.lines.findIndex((line) => line === '');
      const headerLines =
        headerEnd >= 0 ? top.lines.slice(0, headerEnd) : top.lines;
      const bodyLines = headerEnd >= 0 ? top.lines.slice(headerEnd + 1) : [];
      const summary = pop3Summary(
        entry.index,
        entry.uidl,
        parseHeaderBlock(headerLines),
        bodyLines,
      );
      if (sinceHours > 0 && summary.receivedAt.getTime() < since) continue;
      if (unreadOnly && summary.receivedAt.getTime() < since) continue;
      summaries.push(summary);
    }
    return summaries;
  } finally {
    client.end();
  }
}

async function pop3Read(
  conn: MailAccountConfig,
  key: string,
): Promise<MailDetail> {
  const client = new Pop3Client(conn);
  try {
    await client.connect();
    const uidlReply = await client.command('UIDL', true);
    if (!uidlReply.ok) throw new MailProtocolError('读取邮件清单失败（收信）');
    const entries = uidlReply.lines
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2 && /^\d+$/.test(parts[0]));
    const wanted = key.startsWith('uidl:') ? key.slice(5) : '';
    const messageId = key.startsWith('mid:') ? key.slice(4) : key;
    let target = entries.find((parts) => parts[1] === wanted);
    if (!target && messageId) {
      for (const entry of entries) {
        const top = await client.command(`TOP ${entry[0]} 0`, true);
        const headerEnd = top.lines.findIndex((line) => line === '');
        const headers = parseHeaderBlock(
          headerEnd >= 0 ? top.lines.slice(0, headerEnd) : top.lines,
        );
        if ((headers.get('message-id') ?? '').includes(messageId)) {
          target = entry;
          break;
        }
      }
    }
    if (!target) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件不存在或已被删除');
    }
    const reply = await client.command(`RETR ${target[0]}`, true);
    if (!reply.ok) throw new MailProtocolError('读取邮件正文失败（收信）');
    const parsed = await simpleParser(Buffer.from(reply.lines.join('\r\n')));
    const from = parsed.from?.value?.[0];
    const messageIdHeader = String(parsed.messageId ?? '');
    const referencesHeader = parsed.headers.get('references');
    const references = Array.isArray(referencesHeader)
      ? referencesHeader.map((item) => text(item))
      : typeof referencesHeader === 'string'
        ? referencesHeader.split(/\s+/).filter(Boolean)
        : [];
    return {
      key: messageIdHeader ? `mid:${messageIdHeader}` : `uidl:${target[1]}`,
      subject: String(parsed.subject ?? '').trim() || '（无主题）',
      fromName: String(from?.name ?? '') || String(from?.address ?? ''),
      fromAddress: String(from?.address ?? ''),
      receivedAt: parsed.date ?? new Date(),
      snippet: snippetOf(String(parsed.text ?? '')),
      unread: true,
      hasAttachments: (parsed.attachments ?? []).length > 0,
      messageId: messageIdHeader,
      to: (parsed.to && !Array.isArray(parsed.to) ? parsed.to.value : []).map(
        (item) => item.address ?? '',
      ),
      cc: (parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc.value : []).map(
        (item) => item.address ?? '',
      ),
      text:
        String(parsed.text ?? '').trim() ||
        snippetOf(String(parsed.html ?? '')),
      attachments: (parsed.attachments ?? []).map((item) => ({
        name: item.filename || '未命名附件',
        size: item.size ?? 0,
        contentType: item.contentType || 'application/octet-stream',
      })),
      inReplyTo: String(parsed.inReplyTo ?? ''),
      references,
      autoSubmitted: text(parsed.headers.get('auto-submitted')),
      listId: text(parsed.headers.get('list-id')),
    };
  } finally {
    client.end();
  }
}

// ---------------------------------------------------------------- SMTP

function transportOf(conn: MailAccountConfig) {
  const security = conn.outgoingSecurity;
  return nodemailer.createTransport({
    host: conn.outgoingHost,
    port: conn.outgoingPort,
    secure: security === 'ssl',
    requireTLS: security === 'starttls',
    auth: {
      user: conn.outgoingUsername || conn.incomingUsername,
      pass: conn.outgoingPassword || conn.incomingPassword,
    },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

async function smtpSend(
  conn: MailAccountConfig,
  draft: MailDraft,
  from: { name: string; address: string },
): Promise<void> {
  const transport = transportOf(conn);
  try {
    await transport.sendMail({
      from: from.name ? `${from.name} <${from.address}>` : from.address,
      to: draft.to.join(', '),
      cc: (draft.cc ?? []).join(', ') || undefined,
      subject: draft.subject,
      text: draft.body,
      inReplyTo: draft.inReplyTo || undefined,
      references: draft.references?.length ? draft.references : undefined,
    });
  } catch (error) {
    throw wrapError(error, '发信');
  } finally {
    transport.close();
  }
}

async function smtpVerify(conn: MailAccountConfig): Promise<void> {
  const transport = transportOf(conn);
  try {
    await transport.verify();
  } catch (error) {
    throw wrapError(error, '发信');
  } finally {
    transport.close();
  }
}

// ---------------------------------------------------------------- 对外接口

export const mailProtocol = {
  async testIncoming(conn: MailAccountConfig): Promise<void> {
    if (conn.protocol === 'pop3') {
      const client = new Pop3Client(conn);
      try {
        await client.connect();
      } finally {
        client.end();
      }
      return;
    }
    const client = await openImap(conn);
    try {
      await openBox(client, conn.inboxFolder || 'INBOX');
    } finally {
      client.end();
    }
  },

  async testOutgoing(conn: MailAccountConfig): Promise<void> {
    if (!conn.outgoingHost.trim()) {
      throw new MailProtocolError('还没有填写发信服务器（SMTP）');
    }
    await smtpVerify(conn);
  },

  async listInbox(
    conn: MailAccountConfig,
    options: { limit: number; unreadOnly: boolean; sinceHours: number },
  ): Promise<MailSummary[]> {
    if (conn.protocol === 'pop3') {
      return pop3List(
        conn,
        options.limit,
        options.unreadOnly,
        options.sinceHours,
      );
    }
    return imapList(
      conn,
      conn.inboxFolder || 'INBOX',
      options.limit,
      options.unreadOnly,
      options.sinceHours,
    );
  },

  async listDrafts(
    conn: MailAccountConfig,
    limit: number,
  ): Promise<MailSummary[]> {
    if (conn.protocol === 'pop3') return [];
    return imapList(conn, conn.draftsFolder || 'Drafts', limit, false, 0);
  },

  async read(
    conn: MailAccountConfig,
    key: string,
    folder?: string,
  ): Promise<MailDetail> {
    if (conn.protocol === 'pop3') return pop3Read(conn, key);
    return imapRead(conn, key, folder || conn.inboxFolder || 'INBOX');
  },

  /** 存草稿：IMAP 用 APPEND 进服务器草稿箱；POP3 没有文件夹，交给上层把正文回给用户。 */
  async saveDraft(
    conn: MailAccountConfig,
    draft: MailDraft,
  ): Promise<{ savedTo: string }> {
    const raw = buildRawMessage(
      { name: conn.displayName, address: conn.address },
      draft,
    );
    if (conn.protocol === 'pop3') return { savedTo: '' };
    const folder = conn.draftsFolder || 'Drafts';
    await imapAppend(conn, folder, raw, ['\\Draft', '\\Seen']);
    return { savedTo: folder };
  },

  /** 发信：SMTP 发出，IMAP 再往发件箱留一份副本（失败不回滚发送结果）。 */
  async send(
    conn: MailAccountConfig,
    draft: MailDraft,
  ): Promise<{ savedTo: string }> {
    if (!conn.outgoingHost.trim()) {
      throw new MailProtocolError('还没有填写发信服务器（SMTP），无法直接发送');
    }
    await smtpSend(conn, draft, {
      name: conn.displayName,
      address: conn.address,
    });
    if (conn.protocol === 'pop3' || !conn.sentFolder.trim()) {
      return { savedTo: '' };
    }
    const raw = buildRawMessage(
      { name: conn.displayName, address: conn.address },
      draft,
    );
    try {
      await imapAppend(conn, conn.sentFolder, raw, ['\\Seen']);
      return { savedTo: conn.sentFolder };
    } catch (error) {
      log.warn({
        action: '发件箱副本',
        error: (error as Error)?.message?.slice(0, 200),
      });
      return { savedTo: '' };
    }
  },
};

export { buildRawMessage };
