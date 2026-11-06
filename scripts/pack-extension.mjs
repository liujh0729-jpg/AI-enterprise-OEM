/**
 * 打包 AIPDD Enterprise 浏览器插件 → zip（供 frontend/public/downloads/ 分发）。
 *
 * 为什么不用 PowerShell Compress-Archive：它把条目名写成 `dir\file.js`（反斜杠），
 * 违反 ZIP APPNOTE（路径分隔符必须是 `/`）；macOS「归档实用工具」与 Linux unzip
 * 会把反斜杠当普通字符，解压出一堆扁平怪名文件、没有目录，用户按 README 就无法加载。
 * 这里用零依赖的 store（不压缩）zip 写入器，条目名固定用 POSIX 分隔符。
 *
 * 用法：node scripts/pack-extension.mjs
 * 产物文件名取自 extensions/aipdd-enterprise/manifest.json 的 version，
 * 需与 backend EXTENSION_INFO.downloadPath 一致（verify-distribution.mjs 会断言）。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extensions", "aipdd-enterprise");
// zip 内保留 aipdd-enterprise/ 这层目录（README 安装第 3 步按该文件夹加载）。
const dirInZip = "aipdd-enterprise";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date → DOS 时间/日期（zip 字段只支持 1980 年起）。 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** store（method 0）条目：插件文件都是几十 KB 的文本，压缩收益小，先求实现可靠。 */
function buildEntry(name, content, dos, mtime) {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // flags: UTF-8 名称
  local.writeUInt16LE(0, 8); // method: store
  local.writeUInt16LE(dos.time, 10);
  local.writeUInt16LE(dos.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  return { nameBuf, content, crc, local, offset: 0, mtime };
}

function centralHeader(entry) {
  const dos = dosDateTime(entry.mtime);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(0, 10); // store
  head.writeUInt16LE(dos.time, 12);
  head.writeUInt16LE(dos.date, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(entry.content.length, 20);
  head.writeUInt32LE(entry.content.length, 24);
  head.writeUInt16LE(entry.nameBuf.length, 28);
  head.writeUInt32LE(entry.offset, 42);
  return head;
}

/** 递归收集目录下文件，返回 { zip 内 POSIX 路径: 内容, mtime } 。 */
function collectFiles(base, prefix, out) {
  for (const item of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name === "__MACOSX" || item.name.startsWith(".")) continue;
    const abs = join(base, item.name);
    const name = posix.join(prefix, item.name);
    if (item.isDirectory()) collectFiles(abs, name, out);
    else out.push({ name, content: readFileSync(abs), mtime: statSync(abs).mtime });
  }
  return out;
}

/** 解析 zip 本地头序列，返回条目名列表（verify 脚本据此断言分隔符合规）。 */
export function listZipEntries(file) {
  const buf = readFileSync(file);
  const names = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const flags = buf.readUInt16LE(6);
    const method = buf.readUInt16LE(8);
    const compSize = buf.readUInt32LE(18);
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const encoding = (flags & 0x0800) ? "utf8" : "latin1";
    names.push(buf.subarray(p + 30, p + 30 + nameLen).toString(encoding));
    p += 30 + nameLen + extraLen + compSize;
    if (method === 8) {
      // store 打包器不会产出 deflate 条目；真遇到说明来源不对，让调用方看到异常名即可。
      continue;
    }
  }
  return names;
}

const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
const files = collectFiles(extDir, dirInZip, []);
if (!files.some((f) => f.name.endsWith("manifest.json"))) {
  console.error("extensions/aipdd-enterprise/manifest.json 不存在，无法打包");
  process.exit(1);
}

// 条目名固定用 `/` 分隔；mtime 取各源文件自身时间，内容未变时重打包结果可预期。
const built = [];
let offset = 0;
for (const file of files) {
  const entry = buildEntry(file.name, Buffer.from(file.content), dosDateTime(file.mtime), file.mtime);
  entry.offset = offset;
  offset += entry.local.length + entry.nameBuf.length + entry.content.length;
  built.push(entry);
}
const locals = [];
for (const entry of built) locals.push(entry.local, entry.nameBuf, entry.content);
const localBlob = Buffer.concat(locals);
const centralBlob = Buffer.concat(
  built.map((entry) => Buffer.concat([centralHeader(entry), entry.nameBuf])),
);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(built.length, 8);
eocd.writeUInt16LE(built.length, 10);
eocd.writeUInt32LE(centralBlob.length, 12);
eocd.writeUInt32LE(localBlob.length, 16);

const out = join(root, "frontend", "public", "downloads", `aipdd-enterprise-v${manifest.version}.zip`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([localBlob, centralBlob, eocd]));

const backslash = built.filter((entry) => entry.nameBuf.includes(0x5c)).length;
console.log(`已打包 ${built.length} 个条目 → ${out.replace(root + "\\", "")}（v${manifest.version}，反斜杠条目 ${backslash}）`);
if (backslash) process.exit(1);
