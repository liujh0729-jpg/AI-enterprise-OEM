import { inflateRawSync } from 'node:zlib';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** 中央目录里声明的条目数上限（防畸形包）；真正收多少由 maxEntries 决定。 */
const HARD_ENTRY_LIMIT = 4000;

export type ZipEntry = { path: string; bytes: Uint8Array };

export type ZipReadOptions = {
  /** 只收这些后缀（小写、含点）；不传＝全部条目 */
  extensions?: string[];
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

/**
 * 解包文件名净化：绝对路径、盘符、`..` 穿越、空段一律丢弃。
 * 返回空串＝这个条目不安全，调用方直接跳过（不解压、不入库）。
 */
function safeEntryName(raw: string): string {
  const name = raw.replaceAll('\\', '/').replaceAll('\u0000', '');
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return '';
  const segments = name.split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  )
    return '';
  if (segments.some((segment) => segment.length > 200)) return '';
  return segments.join('/');
}

/**
 * 极简 ZIP 读取（只支持 stored / deflate 两种压缩方式）。
 * 不引第三方依赖、不调系统命令：技能包与 office 文档都是标准 zip，够用即可。
 */
export function readZipEntries(
  buffer: Buffer,
  options: ZipReadOptions = {},
): ZipEntry[] {
  const maxEntries = options.maxEntries ?? 200;
  const maxFileBytes = options.maxFileBytes ?? 200 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 600 * 1024;
  const extensions = options.extensions?.map((ext) => ext.toLowerCase());

  if (buffer.length < 22) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '这不是有效的 zip 文件');
  }
  let eocd = -1;
  for (
    let index = buffer.length - 22;
    index >= Math.max(0, buffer.length - 66_000);
    index -= 1
  ) {
    if (buffer.readUInt32LE(index) === EOCD) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '这不是有效的 zip 文件');
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (!count || count > HARD_ENTRY_LIMIT) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, 'zip 里的文件数量异常');
  }
  const entries: ZipEntry[] = [];
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL)
      break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const rawSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!rawName || rawName.endsWith('/')) continue;
    const name = safeEntryName(rawName);
    // 路径穿越/绝对路径条目直接丢弃，绝不落进技能包文件清单
    if (!name) continue;
    if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) continue;
    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name)) continue;
    if (extensions) {
      const lower = name.toLowerCase();
      if (!extensions.some((ext) => lower.endsWith(ext))) continue;
    }

    if (!rawSize || rawSize > maxFileBytes) continue;
    if (total + rawSize > maxTotalBytes) break;

    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== LOCAL
    )
      continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) continue;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    let bytes: Uint8Array;
    try {
      bytes =
        method === 0
          ? new Uint8Array(data)
          : new Uint8Array(
              inflateRawSync(data, { maxOutputLength: maxFileBytes }),
            );
    } catch {
      continue;
    }
    entries.push({ path: name, bytes });
    total += rawSize;
    if (entries.length >= maxEntries) break;
  }
  return entries;
}
