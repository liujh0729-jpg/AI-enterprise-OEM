import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  publicEncrypt,
  constants as cryptoConstants,
} from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export type BiDbType = 'PG' | 'MYSQL';
export type BiDbConfig = {
  host: string;
  port: number;
  database: string;
  schema?: string;
  username: string;
  password: string;
  ssl?: boolean;
};
export type BiColumn = { key: string; label: string; type: string };
export type BiQueryResult = {
  columns: BiColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  version: string;
};

const CONNECT_TIMEOUT = 8000;

// ---------------------------------------------------------------- PostgreSQL

const PG_INT_TYPES = new Set([20, 21, 23, 26, 28, 29]);
const PG_NUM_TYPES = new Set([700, 701, 1700]);
const PG_BOOL_TYPES = new Set([16]);

class PgClient {
  private socket: Socket | TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private messages: Buffer[] = [];
  private closed = false;
  version = '';
  constructor(private readonly config: BiDbConfig) {}

  private async waitForData() {
    if (this.messages.length) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('数据库连接超时')),
        CONNECT_TIMEOUT,
      );
      const done = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((item) => item !== done);
        resolve();
      };
      this.waiters.push(done);
    });
  }

  private async nextMessage() {
    for (;;) {
      const message = this.decode();
      if (message) return message;
      if (this.closed) throw new Error('数据库连接已断开');
      await this.waitForData();
    }
  }

  private decode(): Buffer | null {
    if (this.buffer.length < 5) return null;
    const length = this.buffer.readInt32BE(1);
    if (length < 4) throw new Error('数据库返回报文非法');
    const total = length + 1;
    if (this.buffer.length < total) return null;
    const message = this.buffer.subarray(0, total);
    this.buffer = this.buffer.subarray(total);
    return message;
  }

  private write(payload: Buffer) {
    if (!this.socket) throw new Error('数据库尚未连接');
    this.socket.write(payload);
  }

  private writeMessage(type: string, body: Buffer, lengthOffset = false) {
    if (lengthOffset) {
      this.write(body);
      return;
    }
    const header = Buffer.alloc(5);
    header.write(type, 0, 'latin1');
    header.writeInt32BE(body.length + 4, 1);
    this.write(Buffer.concat([header, body]));
  }

  private cstr(value: string) {
    return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
  }

  async connect() {
    this.socket = await new Promise<Socket>((resolve, reject) => {
      const socket = netConnect(
        {
          host: this.config.host,
          port: this.config.port,
          timeout: CONNECT_TIMEOUT,
        },
        () => resolve(socket),
      );
      socket.setNoDelay(true);
      socket.on('error', (error: Error) => {
        this.closed = true;
        reject(error);
        for (const waiter of this.waiters) waiter();
      });
      socket.on('close', () => {
        this.closed = true;
        for (const waiter of this.waiters) waiter();
      });
      socket.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (const waiter of [...this.waiters]) waiter();
      });
      socket.on('timeout', () => reject(new Error('数据库连接超时')));
    });
    if (this.config.ssl) {
      await this.startTls();
    }
    await this.startup();
  }

  private async startTls() {
    const socket = this.socket as Socket;
    const request = Buffer.alloc(8);
    request.writeInt32BE(8, 0);
    request.writeInt32BE(80877103, 4);
    socket.write(request);
    const answer = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('数据库 SSL 协商超时')),
        CONNECT_TIMEOUT,
      );
      socket.once('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk.toString('latin1', 0, 1));
      });
    });
    if (answer !== 'S') throw new Error('数据库不支持 SSL 连接');
    this.socket = await new Promise<TLSSocket>((resolve, reject) => {
      const secure = tlsConnect(
        {
          socket,
          servername: this.config.host,
          rejectUnauthorized: false,
        },
        () => resolve(secure),
      );
      secure.on('error', reject);
      secure.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (const waiter of [...this.waiters]) waiter();
      });
    });
    this.buffer = Buffer.alloc(0);
  }

  private async startup() {
    const params: Array<[string, string]> = [
      ['user', this.config.username],
      ['database', this.config.database],
      ['client_encoding', 'UTF8'],
      ['application_name', 'aiworkin-bi'],
    ];
    const parts = [Buffer.from([0, 3, 0, 0])];
    for (const [key, value] of params) {
      parts.push(this.cstr(key), this.cstr(value));
    }
    parts.push(Buffer.from([0]));
    const body = Buffer.concat(parts);
    const header = Buffer.alloc(4);
    header.writeInt32BE(body.length + 4, 0);
    this.write(Buffer.concat([header, body]));

    let scram: {
      clientFirstBare: string;
      nonce: string;
      serverFirst: string;
    } | null = null;

    for (;;) {
      const message = await this.nextMessage();
      const type = String.fromCharCode(message[0]);
      const payload = message.subarray(5);
      if (type === 'R') {
        const code = payload.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) {
          this.writeMessage('p', this.cstr(this.config.password));
          continue;
        }
        if (code === 5) {
          const salt = payload.subarray(4, 8);
          const inner = createHash('md5')
            .update(this.config.password + this.config.username)
            .digest('hex');
          const outer = createHash('md5')
            .update(Buffer.concat([Buffer.from(inner), salt]))
            .digest('hex');
          this.writeMessage('p', this.cstr(`md5${outer}`));
          continue;
        }
        if (code === 10) {
          const mechanisms = payload
            .subarray(4)
            .toString('utf8')
            .split('\0')
            .filter(Boolean);
          if (!mechanisms.includes('SCRAM-SHA-256')) {
            throw new Error('数据库只支持不兼容的认证方式');
          }
          const nonce = randomBytes(18).toString('base64');
          const clientFirstBare = `n=,r=${nonce}`;
          const initial = Buffer.from(`n,,${clientFirstBare}`, 'utf8');
          const mechanism = this.cstr('SCRAM-SHA-256');
          const len = Buffer.alloc(4);
          len.writeInt32BE(initial.length, 0);
          this.writeMessage('p', Buffer.concat([mechanism, len, initial]));
          scram = { clientFirstBare, nonce, serverFirst: '' };
          continue;
        }
        if (code === 11 && scram) {
          const serverFirst = payload.subarray(4).toString('utf8');
          scram.serverFirst = serverFirst;
          const attrs = new Map(
            serverFirst.split(',').map((item) => {
              const index = item.indexOf('=');
              return [item.slice(0, index), item.slice(index + 1)];
            }),
          );
          const salt = Buffer.from(String(attrs.get('s') || ''), 'base64');
          const iterations = Number(attrs.get('i') || 4096);
          const serverNonce = String(attrs.get('r') || '');
          const salted = pbkdf2Sync(
            this.config.password,
            salt,
            iterations,
            32,
            'sha256',
          );
          const clientKey = createHmac('sha256', salted)
            .update('Client Key')
            .digest();
          const storedKey = createHash('sha256').update(clientKey).digest();
          const finalWithoutProof = `c=biws,r=${serverNonce}`;
          const authMessage = `${scram.clientFirstBare},${serverFirst},${finalWithoutProof}`;
          const clientSignature = createHmac('sha256', storedKey)
            .update(authMessage)
            .digest();
          const proof = Buffer.alloc(clientKey.length);
          for (let i = 0; i < proof.length; i++)
            proof[i] = clientKey[i] ^ clientSignature[i];
          const final = `${finalWithoutProof},p=${proof.toString('base64')}`;
          this.writeMessage('p', Buffer.from(final, 'utf8'));
          continue;
        }
        if (code === 12 && scram) {
          const serverFinal = payload.subarray(4).toString('utf8');
          const proof = /v=([^,]+)/.exec(serverFinal)?.[1];
          if (proof) {
            const attrs = new Map(
              scram.serverFirst.split(',').map((item) => {
                const index = item.indexOf('=');
                return [item.slice(0, index), item.slice(index + 1)];
              }),
            );
            const salt = Buffer.from(String(attrs.get('s') || ''), 'base64');
            const iterations = Number(attrs.get('i') || 4096);
            const salted = pbkdf2Sync(
              this.config.password,
              salt,
              iterations,
              32,
              'sha256',
            );
            const serverKey = createHmac('sha256', salted)
              .update('Server Key')
              .digest();
            const authMessage = `${scram.clientFirstBare},${scram.serverFirst},c=biws,r=${String(attrs.get('r') || '')}`;
            const expected = createHmac('sha256', serverKey)
              .update(authMessage)
              .digest('base64');
            if (proof !== expected) {
              throw new Error('数据库身份校验失败');
            }
          }
          continue;
        }
        throw new Error(`数据库认证方式不支持（${code}）`);
      }
      if (type === 'S') {
        const raw = payload.toString('utf8').split('\0');
        if (raw[0] === 'server_version') this.version = raw[1] || '';
        continue;
      }
      if (type === 'E') {
        throw new Error(this.errorMessage(payload));
      }
      if (type === 'Z') return;
    }
  }

  private errorMessage(payload: Buffer) {
    let index = 0;
    let message = '';
    while (index < payload.length) {
      const code = payload[index];
      if (!code) break;
      const end = payload.indexOf(0, index + 1);
      const value = payload.toString(
        'utf8',
        index + 1,
        end < 0 ? payload.length : end,
      );
      if (code === 77) message = value;
      index = end < 0 ? payload.length : end + 1;
    }
    return message || '数据库返回错误';
  }

  async query(
    sql: string,
    timeoutMs: number,
    maxRows: number,
  ): Promise<BiQueryResult> {
    const clean = sql.trim().replace(/;+\s*$/, '');
    const wrapped = `SELECT * FROM (${clean}) AS __bi_query LIMIT ${maxRows + 1}`;
    this.writeMessage('Q', this.cstr(wrapped));
    const columns: BiColumn[] = [];
    const rows: Record<string, unknown>[] = [];
    let commandTag = '';
    for (;;) {
      const message = await this.nextMessage();
      const type = String.fromCharCode(message[0]);
      const payload = message.subarray(5);
      if (type === 'T') {
        const count = payload.readInt16BE(0);
        let offset = 2;
        for (let i = 0; i < count; i++) {
          const end = payload.indexOf(0, offset);
          const name = payload.toString('utf8', offset, end);
          offset = end + 1;
          const tableOid = payload.readInt32BE(offset);
          void tableOid;
          offset += 4;
          const columnId = payload.readInt16BE(offset);
          void columnId;
          offset += 2;
          const typeOid = payload.readInt32BE(offset);
          offset += 4;
          const typeSize = payload.readInt16BE(offset);
          void typeSize;
          offset += 2;
          const modifier = payload.readInt32BE(offset);
          void modifier;
          offset += 4;
          offset += 2;
          columns.push({ key: name, label: name, type: this.pgType(typeOid) });
        }
        continue;
      }
      if (type === 'D') {
        const count = payload.readInt16BE(0);
        let offset = 2;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const length = payload.readInt32BE(offset);
          offset += 4;
          if (length < 0) {
            row[columns[i]?.key || `c${i}`] = null;
            continue;
          }
          const raw = payload.toString('utf8', offset, offset + length);
          offset += length;
          row[columns[i]?.key || `c${i}`] = this.pgValue(
            raw,
            columns[i]?.type || 'text',
          );
        }
        rows.push(row);
        continue;
      }
      if (type === 'C') {
        commandTag = payload.toString('utf8').split('\0')[0] || '';
        continue;
      }
      if (type === 'E') {
        throw new Error(this.errorMessage(payload));
      }
      if (type === 'Z') break;
    }
    void commandTag;
    const truncated = rows.length > maxRows;
    return {
      columns,
      rows: truncated ? rows.slice(0, maxRows) : rows,
      rowCount: Math.min(rows.length, maxRows),
      truncated,
      version: this.version,
    };
  }

  private pgType(oid: number) {
    if (PG_INT_TYPES.has(oid)) return 'number';
    if (PG_NUM_TYPES.has(oid)) return 'number';
    if (PG_BOOL_TYPES.has(oid)) return 'boolean';
    if ([1082, 1114, 1184, 1083].includes(oid)) return 'date';
    return 'text';
  }

  private pgValue(raw: string, type: string) {
    if (type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (type === 'boolean') return raw === 't' || raw === 'true';
    return raw;
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}

// ---------------------------------------------------------------- MySQL

const MYSQL_CAP = {
  LONG_PASSWORD: 1,
  FOUND_ROWS: 2,
  LONG_FLAG: 4,
  CONNECT_WITH_DB: 8,
  PROTOCOL_41: 0x200,
  TRANSACTIONS: 0x2000,
  SECURE_CONNECTION: 0x8000,
  MULTI_RESULTS: 0x20000,
  PLUGIN_AUTH: 0x80000,
  CONNECT_ATTRS: 0x100000,
};

class MySqlClient {
  private socket: Socket | TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private closed = false;
  private sequence = 0;
  version = '';
  constructor(private readonly config: BiDbConfig) {}

  private async waitForData() {
    if (this.hasPacket()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('数据库连接超时')),
        CONNECT_TIMEOUT,
      );
      const done = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((item) => item !== done);
        resolve();
      };
      this.waiters.push(done);
    });
  }

  private hasPacket() {
    return this.buffer.length >= 4;
  }

  private takePacket(): Buffer | null {
    if (this.buffer.length < 4) return null;
    const length = this.buffer.readUIntLE(0, 3);
    if (this.buffer.length < 4 + length) return null;
    const payload = this.buffer.subarray(4, 4 + length);
    this.buffer = this.buffer.subarray(4 + length);
    return payload;
  }

  private async nextPacket() {
    for (;;) {
      const packet = this.takePacket();
      if (packet) return packet;
      if (this.closed) throw new Error('数据库连接已断开');
      await this.waitForData();
    }
  }

  private writePacket(payload: Buffer, reset = false) {
    if (!this.socket) throw new Error('数据库尚未连接');
    if (reset) this.sequence = 0;
    const header = Buffer.alloc(4);
    header.writeUIntLE(payload.length, 0, 3);
    header[3] = this.sequence++ & 0xff;
    this.socket.write(Buffer.concat([header, payload]));
  }

  async connect() {
    this.socket = await new Promise<Socket>((resolve, reject) => {
      const socket = netConnect(
        {
          host: this.config.host,
          port: this.config.port,
          timeout: CONNECT_TIMEOUT,
        },
        () => resolve(socket),
      );
      socket.setNoDelay(true);
      socket.on('error', (error: Error) => {
        this.closed = true;
        reject(error);
        for (const waiter of this.waiters) waiter();
      });
      socket.on('close', () => {
        this.closed = true;
        for (const waiter of this.waiters) waiter();
      });
      socket.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (const waiter of [...this.waiters]) waiter();
      });
    });
    await this.handshake();
  }

  private async handshake() {
    const packet = await this.nextPacket();
    if (packet[0] === 0xff) throw new Error(this.errorMessage(packet));
    let offset = 1;
    const versionEnd = packet.indexOf(0, offset);
    this.version = packet.toString('utf8', offset, versionEnd);
    offset = versionEnd + 1 + 4;
    const authPart1 = packet.subarray(offset, offset + 8);
    offset += 8 + 1;
    const capabilityLower = packet.readUInt16LE(offset);
    offset += 2;
    offset += 1 + 2;
    const capabilityUpper = packet.readUInt16LE(offset);
    offset += 2;
    const capabilities = capabilityLower | (capabilityUpper << 16);
    const authLength = packet[offset];
    offset += 1 + 10;
    const authPart2Length = Math.max(13, authLength - 8);
    const authPart2 = packet.subarray(offset, offset + authPart2Length);
    offset += authPart2Length;
    const pluginEnd = packet.indexOf(0, offset);
    const plugin =
      pluginEnd >= 0
        ? packet.toString('utf8', offset, pluginEnd)
        : 'mysql_native_password';
    const scramble = Buffer.concat([authPart1, authPart2]).subarray(0, 20);
    const clientCaps =
      MYSQL_CAP.LONG_PASSWORD |
      MYSQL_CAP.LONG_FLAG |
      MYSQL_CAP.CONNECT_WITH_DB |
      MYSQL_CAP.PROTOCOL_41 |
      MYSQL_CAP.TRANSACTIONS |
      MYSQL_CAP.SECURE_CONNECTION |
      MYSQL_CAP.MULTI_RESULTS |
      MYSQL_CAP.PLUGIN_AUTH;
    const authResponse = this.authResponse(plugin, scramble);
    const head = Buffer.alloc(4 + 4 + 1 + 23 + 1);
    head.writeUInt32LE(clientCaps, 0);
    head.writeUInt32LE(0x01000000, 4);
    head[8] = 45;
    head.fill(0, 9, 32);
    head[32] = 0;
    const parts = [
      head,
      Buffer.from(this.config.username, 'utf8'),
      Buffer.from([0]),
      Buffer.from([authResponse.length]),
      authResponse,
      Buffer.from(this.config.database, 'utf8'),
      Buffer.from([0]),
      Buffer.from(plugin, 'utf8'),
      Buffer.from([0]),
    ];
    this.writePacket(Buffer.concat(parts));
    await this.authLoop(plugin, scramble);
    void capabilities;
  }

  private authResponse(plugin: string, scramble: Buffer) {
    if (plugin === 'mysql_native_password') {
      const stage1 = createHash('sha1').update(this.config.password).digest();
      const stage2 = createHash('sha1').update(stage1).digest();
      const stage3 = createHash('sha1')
        .update(Buffer.concat([scramble, stage2]))
        .digest();
      const result = Buffer.alloc(stage1.length);
      for (let i = 0; i < result.length; i++) result[i] = stage1[i] ^ stage3[i];
      return result;
    }
    if (plugin === 'caching_sha2_password' || plugin === 'sha256_password') {
      const stage1 = createHash('sha256').update(this.config.password).digest();
      const stage2 = createHash('sha256').update(stage1).digest();
      const stage3 = createHash('sha256')
        .update(Buffer.concat([stage2, scramble]))
        .digest();
      const result = Buffer.alloc(stage1.length);
      for (let i = 0; i < result.length; i++) result[i] = stage1[i] ^ stage3[i];
      return result;
    }
    return Buffer.from(this.config.password, 'utf8');
  }

  private async authLoop(initialPlugin: string, initialScramble: Buffer) {
    let plugin = initialPlugin;
    let scramble = initialScramble;
    for (;;) {
      const packet = await this.nextPacket();
      if (!packet.length) continue;
      const marker = packet[0];
      if (marker === 0x00) return;
      if (marker === 0xff) throw new Error(this.errorMessage(packet));
      if (marker === 0xfe) {
        // AuthSwitchRequest
        const nameEnd = packet.indexOf(0, 1);
        const nextPlugin = packet.toString('utf8', 1, nameEnd);
        const data = packet.subarray(nameEnd + 1, nameEnd + 1 + 20);
        const response = this.authResponse(nextPlugin, data);
        this.writePacket(response);
        plugin = nextPlugin;
        scramble = data;
        continue;
      }
      if (marker === 0x01) {
        // AuthMoreData
        const data = packet.subarray(1);
        if (plugin === 'caching_sha2_password') {
          if (data[0] === 0x03) continue;
          if (data[0] === 0x04) {
            if (this.config.ssl) {
              this.writePacket(Buffer.from(this.config.password, 'utf8'));
              continue;
            }
            this.writePacket(Buffer.from([0x02]));
            const keyPacket = await this.nextPacket();
            if (keyPacket[0] === 0xff)
              throw new Error(this.errorMessage(keyPacket));
            const pem = keyPacket.subarray(1).toString('utf8');
            const encrypted = this.rsaEncrypt(pem, scramble);
            this.writePacket(encrypted);
            continue;
          }
        }
        if (plugin === 'sha256_password') {
          if (this.config.ssl) {
            this.writePacket(Buffer.from(`${this.config.password}\0`, 'utf8'));
          } else {
            this.writePacket(Buffer.from([0x01]));
            const keyPacket = await this.nextPacket();
            if (keyPacket[0] === 0xff)
              throw new Error(this.errorMessage(keyPacket));
            const pem = keyPacket.subarray(1).toString('utf8');
            this.writePacket(this.rsaEncrypt(pem, scramble));
          }
          continue;
        }
      }
      throw new Error('数据库认证失败');
    }
  }

  private rsaEncrypt(pem: string, scramble: Buffer) {
    const plain = Buffer.concat([
      Buffer.from(`${this.config.password}\0`, 'utf8'),
      scramble,
    ]);
    for (let i = 0; i < plain.length; i++)
      plain[i] ^= scramble[i % scramble.length];
    return publicEncrypt(
      {
        key: pem,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1',
      },
      plain,
    );
  }

  private lenenc(
    buffer: Buffer,
    offset: number,
  ): { value: number; next: number } {
    const first = buffer[offset];
    if (first < 0xfb) return { value: first, next: offset + 1 };
    if (first === 0xfc)
      return { value: buffer.readUInt16LE(offset + 1), next: offset + 3 };
    if (first === 0xfd)
      return { value: buffer.readUIntLE(offset + 1, 3), next: offset + 4 };
    return {
      value: Number(buffer.readBigUInt64LE(offset + 1)),
      next: offset + 9,
    };
  }

  private lenencString(buffer: Buffer, offset: number) {
    const first = buffer[offset];
    if (first === 0xfb)
      return { value: null as string | null, next: offset + 1 };
    const length = this.lenenc(buffer, offset);
    return {
      value: buffer.toString('utf8', length.next, length.next + length.value),
      next: length.next + length.value,
    };
  }

  private errorMessage(packet: Buffer) {
    let offset = 1;
    if (packet.length > 3) offset = 3;
    const code = packet.length >= offset + 2 ? packet.readUInt16LE(offset) : 0;
    const message = packet
      .toString('utf8', offset + 2)
      .replace(/^#\w{5}/, '')
      .trim();
    return `${code ? `[${code}] ` : ''}${message || '数据库返回错误'}`;
  }

  private isEof(packet: Buffer) {
    return packet[0] === 0xfe && packet.length < 9;
  }

  async query(
    sql: string,
    timeoutMs: number,
    maxRows: number,
  ): Promise<BiQueryResult> {
    void timeoutMs;
    const clean = sql.trim().replace(/;+\s*$/, '');
    const wrapped = `SELECT * FROM (${clean}) AS __bi_query LIMIT ${maxRows + 1}`;
    const payload = Buffer.concat([
      Buffer.from([0x03]),
      Buffer.from(wrapped, 'utf8'),
    ]);
    this.writePacket(payload, true);
    const first = await this.nextPacket();
    if (first[0] === 0xff) throw new Error(this.errorMessage(first));
    if (first[0] === 0x00) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        version: this.version,
      };
    }
    const count = this.lenenc(first, 0).value;
    const columns: BiColumn[] = [];
    for (let i = 0; i < count; i++) {
      const packet = await this.nextPacket();
      let offset = 0;
      let name = '';
      for (let part = 0; part < 6; part++) {
        const item = this.lenencString(packet, offset);
        offset = item.next;
        if (part === 4) name = item.value || '';
      }
      const fixed = this.lenenc(packet, offset);
      offset = fixed.next + fixed.value;
      const typeByte = packet[offset + 6];
      columns.push({
        key: name || `col_${i}`,
        label: name || `col_${i}`,
        type: this.mysqlType(typeByte),
      });
    }
    const afterColumns = await this.nextPacket();
    if (
      !this.isEof(afterColumns) &&
      !(afterColumns[0] === 0x00 && afterColumns.length < 9)
    ) {
      this.buffer = Buffer.concat([
        this.packetAgain(afterColumns),
        this.buffer,
      ]);
    }
    const rows: Record<string, unknown>[] = [];
    for (;;) {
      const packet = await this.nextPacket();
      if (packet[0] === 0xff) throw new Error(this.errorMessage(packet));
      if (this.isEof(packet)) break;
      if (packet[0] === 0x00 && packet.length < 9) break;
      const row: Record<string, unknown> = {};
      let offset = 0;
      for (let i = 0; i < columns.length; i++) {
        const item = this.lenencString(packet, offset);
        offset = item.next;
        row[columns[i].key] = this.mysqlValue(item.value, columns[i].type);
      }
      rows.push(row);
      if (rows.length > maxRows + 100) break;
    }
    const truncated = rows.length > maxRows;
    return {
      columns,
      rows: truncated ? rows.slice(0, maxRows) : rows,
      rowCount: Math.min(rows.length, maxRows),
      truncated,
      version: this.version,
    };
  }

  private packetAgain(packet: Buffer) {
    const header = Buffer.alloc(4);
    header.writeUIntLE(packet.length, 0, 3);
    return Buffer.concat([header, packet]);
  }

  private mysqlType(type: number) {
    if ([1, 2, 3, 8, 9, 13].includes(type)) return 'number';
    if ([4, 5].includes(type)) return 'number';
    if ([7, 10, 11, 12].includes(type)) return 'date';
    if (type === 245) return 'json';
    return 'text';
  }

  private mysqlValue(value: string | null, type: string) {
    if (value === null) return null;
    if (type === 'number') {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}

// ---------------------------------------------------------------- 对外 API

const pools = new Map<string, Array<PgClient | MySqlClient>>();

const keyOf = (type: BiDbType, config: BiDbConfig) =>
  `${type}|${config.host}|${config.port}|${config.database}|${config.username}|${config.ssl ? 1 : 0}`;

const acquire = async (type: BiDbType, config: BiDbConfig) => {
  const key = keyOf(type, config);
  const pool = pools.get(key) || [];
  const client = pool.pop();
  if (client) return { key, client };
  const created =
    type === 'PG' ? new PgClient(config) : new MySqlClient(config);
  await created.connect();
  return { key, client: created };
};

const release = (
  key: string,
  client: PgClient | MySqlClient,
  broken = false,
) => {
  if (broken) {
    client.close();
    return;
  }
  const pool = pools.get(key) || [];
  if (pool.length >= 3) {
    client.close();
    return;
  }
  pool.push(client);
  pools.set(key, pool);
};

export async function biTestConnection(type: BiDbType, config: BiDbConfig) {
  const startedAt = Date.now();
  const { key, client } = await acquire(type, config);
  try {
    const sql =
      type === 'PG'
        ? 'SELECT current_database() AS database, version() AS version'
        : 'SELECT DATABASE() AS `database`, VERSION() AS version';
    const result = await client.query(sql, 8000, 1);
    release(key, client);
    return {
      ok: true,
      message: `连接正常，共可读取 ${result.rows.length} 行`,
      version:
        typeof result.rows[0]?.version === 'string'
          ? result.rows[0].version
          : client.version || '',
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    release(key, client, true);
    return {
      ok: false,
      message: (error as Error)?.message || '连接失败',
      version: '',
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export async function biQuery(
  type: BiDbType,
  config: BiDbConfig,
  sql: string,
  options: { timeoutMs?: number; maxRows?: number } = {},
) {
  const startedAt = Date.now();
  const { key, client } = await acquire(type, config);
  try {
    const result = await client.query(
      sql,
      options.timeoutMs || 30000,
      options.maxRows || 10000,
    );
    release(key, client);
    return { ...result, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    release(key, client, true);
    throw error;
  }
}

export function closeBiPool() {
  for (const pool of pools.values()) {
    for (const client of pool) client.close();
  }
  pools.clear();
}
