import { deflateRawSync } from 'node:zlib';

/**
 * 极简 ZIP 打包（stored / deflate 两种方式），与 `zip-read.ts` 同一口径：
 * 不引第三方依赖、不调系统命令，只用来生成根目录带 SKILL.md 的技能包。
 */

export type ZipWriteEntry = {
  /** 相对路径，统一用 `/`；绝对路径、盘符与 `..` 直接拒绝 */
  path: string;
  content: string | Uint8Array;
};

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
/** bit 11：文件名按 UTF-8 编码（中文说明会出现在 SKILL.md 文件名之外，但保持规范） */
const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 500;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safePath(raw: string) {
  const path = raw.replaceAll('\\', '/').replaceAll('\u0000', '').trim();
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`zip 条目路径不安全：${raw}`);
  }
  const segments = path.split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`zip 条目路径不安全：${raw}`);
  }
  return path;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1);
  const day =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** 生成 zip 字节；条目顺序即调用顺序，SKILL.md 一般放第一位。 */
export function createZip(entries: ZipWriteEntry[], now = new Date()): Buffer {
  if (!entries.length) throw new Error('zip 至少需要一个文件');
  if (entries.length > MAX_ENTRIES) throw new Error('zip 条目过多');
  const { time, day } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  let total = 0;

  for (const entry of entries) {
    const name = Buffer.from(safePath(entry.path), 'utf8');
    const data =
      typeof entry.content === 'string'
        ? Buffer.from(entry.content, 'utf8')
        : Buffer.from(entry.content);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('zip 内容超过 10MB');

    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}
