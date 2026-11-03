import { inflateRawSync, inflateSync } from 'node:zlib';
import { readZipEntries } from './zip-read';

/** 资料库只收「能读出文字」的文档；图片/音视频不进资料库。 */
export const LIBRARY_TYPES = [
  'md',
  'txt',
  'csv',
  'json',
  'html',
  'htm',
  'docx',
  'pptx',
  'xlsx',
  'pdf',
] as const;

export const LIBRARY_TYPE_LABELS: Record<string, string> = {
  md: 'Markdown',
  txt: '文本',
  csv: 'CSV',
  json: 'JSON',
  html: '网页',
  htm: '网页',
  docx: 'Word',
  pptx: '演示文稿',
  xlsx: '表格',
  pdf: 'PDF',
};

export type LibraryBlockKind =
  'section' | 'paragraph' | 'table' | 'page' | 'slide' | 'sheet';

export type LibraryBlock = {
  kind: LibraryBlockKind;
  path: string;
  content: string;
};

export type Extraction = {
  type: string;
  /** 全文（超长截断），整篇改写时以它为底 */
  text: string;
  /** 抽取阶段自带的天然单元（幻灯片 / 工作表 / PDF 片段）；为空表示按正文再切 */
  blocks: LibraryBlock[];
  /** 抽取过程中的提醒（中文，正常时为空） */
  note: string;
};

const MAX_TEXT_CHARS = 400_000;
const MAX_ZIP_FILE_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 80 * 1024 * 1024;

export function libraryTypeOf(name: string, url = ''): string {
  const source =
    String(name || '').trim() || decodeURIComponent(String(url || ''));
  const file = source.split('?')[0].split('#')[0].split('/').pop() || '';
  const ext = file.toLowerCase().split('.').pop() || '';
  return (LIBRARY_TYPES as readonly string[]).includes(ext) ? ext : '';
}

function decode(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_: string, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match: string, name: string) => named[name.toLowerCase()] ?? match,
    );
}

function tidy(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function zipOf(bytes: Uint8Array, extensions: string[]) {
  return readZipEntries(Buffer.from(bytes), {
    extensions,
    maxEntries: 600,
    maxFileBytes: MAX_ZIP_FILE_BYTES,
    maxTotalBytes: MAX_ZIP_TOTAL_BYTES,
  });
}

function htmlToText(html: string) {
  return tidy(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    ),
  );
}

function docxText(bytes: Uint8Array) {
  const entries = zipOf(bytes, ['.xml']);
  const doc = entries.find((entry) => entry.path === 'word/document.xml');
  if (!doc) return '';
  const xml = Buffer.from(doc.bytes).toString('utf8');
  return tidy(
    decodeEntities(
      xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]*>/g, ''),
    ),
  );
}

function pptxSlides(bytes: Uint8Array) {
  const entries = zipOf(bytes, ['.xml']);
  const slides = entries
    .map((entry) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(entry.path);
      return match ? { index: Number(match[1]), entry } : null;
    })
    .filter(
      (item): item is { index: number; entry: (typeof entries)[number] } =>
        Boolean(item),
    )
    .sort((left, right) => left.index - right.index);
  const blocks: LibraryBlock[] = [];
  for (const [position, slide] of slides.entries()) {
    const xml = Buffer.from(slide.entry.bytes).toString('utf8');
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(
      (match) => decodeEntities(match[1]),
    );
    const content = tidy(texts.join('\n'));
    if (!content) continue;
    blocks.push({
      kind: 'slide',
      path: `第 ${position + 1} 张幻灯片`,
      content,
    });
  }
  return blocks;
}

function xlsxSheets(bytes: Uint8Array) {
  const entries = zipOf(bytes, ['.xml']);
  const sharedEntry = entries.find(
    (entry) => entry.path === 'xl/sharedStrings.xml',
  );
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = Buffer.from(sharedEntry.bytes).toString('utf8');
    for (const item of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = Array.from(
        item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g),
      ).map((match) => decodeEntities(match[1]));
      shared.push(parts.join(''));
    }
  }
  const sheets = entries
    .map((entry) => {
      const match = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(entry.path);
      return match ? { index: Number(match[1]), entry } : null;
    })
    .filter(
      (item): item is { index: number; entry: (typeof entries)[number] } =>
        Boolean(item),
    )
    .sort((left, right) => left.index - right.index);
  const blocks: LibraryBlock[] = [];
  for (const [position, sheet] of sheets.entries()) {
    const xml = Buffer.from(sheet.entry.bytes).toString('utf8');
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1];
        const body = cell[2];
        const type = /t="([^"]+)"/.exec(attrs)?.[1] || '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        if (type === 's') {
          const index = Number(raw);
          cells.push(shared[index] ?? '');
        } else if (type === 'inlineStr') {
          cells.push(
            Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
              .map((match) => decodeEntities(match[1]))
              .join(''),
          );
        } else {
          cells.push(decodeEntities(raw));
        }
      }
      const line = cells.join(' | ').trim();
      if (line.replace(/\|/g, '').trim()) rows.push(line);
    }
    const content = tidy(rows.join('\n'));
    if (!content) continue;
    blocks.push({
      kind: 'sheet',
      path: `工作表 ${position + 1}`,
      content,
    });
  }
  return blocks;
}

/** PDF 字符串：只处理 `(...)Tj` 与 `[ ... ]TJ` 两种最常见写法。 */
function unescapePdfString(value: string) {
  return value
    .replace(/\\([nrt])/g, (_, flag) =>
      flag === 'n' ? '\n' : flag === 'r' ? '\r' : '\t',
    )
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\[0-9]{1,3}/g, '');
}

function pdfStreamText(stream: string) {
  const pieces: string[] = [];
  for (const match of stream.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    pieces.push(unescapePdfString(match[1]));
  }
  for (const match of stream.matchAll(/\[((?:[^[\]\\]|\\.)*)\]\s*TJ/g)) {
    const inner = Array.from(match[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)).map(
      (item) => unescapePdfString(item[1]),
    );
    pieces.push(inner.join(''));
  }
  return tidy(pieces.join(' '));
}

function pdfPages(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const pages: LibraryBlock[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf('stream', cursor, 'latin1');
    if (start < 0) break;
    const end = buffer.indexOf('endstream', start + 6, 'latin1');
    if (end < 0) break;
    let dataStart = start + 6;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const chunk = buffer.subarray(dataStart, end);
    let inflated: Buffer | null = null;
    try {
      inflated = inflateSync(chunk);
    } catch {
      try {
        inflated = inflateRawSync(chunk);
      } catch {
        inflated = null;
      }
    }
    const source = inflated ?? chunk;
    const content = pdfStreamText(source.toString('latin1'));
    if (content) {
      pages.push({
        kind: 'page',
        path: `片段 ${pages.length + 1}`,
        content,
      });
    }
    cursor = end + 9;
  }
  return pages;
}

const MAX_NODE_CHARS = 2000;
const MERGE_TARGET_CHARS = 900;

/** 一段正文按段落合并成节点：太小就并、太大就切，保证每个节点可独立检索。 */
function pushBody(
  out: LibraryBlock[],
  body: string,
  path: string,
  kind: LibraryBlockKind,
) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  let current = '';
  const flush = () => {
    if (current.trim()) out.push({ kind, path, content: current.trim() });
    current = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_NODE_CHARS) {
      flush();
      for (let index = 0; index < paragraph.length; index += MAX_NODE_CHARS) {
        out.push({
          kind,
          path,
          content: paragraph.slice(index, index + MAX_NODE_CHARS).trim(),
        });
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > MERGE_TARGET_CHARS) {
      flush();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
}

/** Markdown：按标题层级切 section，表格单独成块，标题路径写成「一级 > 二级」。 */
function chunkMarkdown(text: string) {
  const blocks: LibraryBlock[] = [];
  const headings: { level: number; title: string }[] = [];
  let buffer: string[] = [];
  let path = '正文';
  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) return;
    const lines = body.split('\n').filter((line) => line.trim());
    const tableLines = lines.filter((line) => line.trim().startsWith('|'));
    const kind: LibraryBlockKind =
      lines.length >= 2 && tableLines.length / lines.length >= 0.8
        ? 'table'
        : 'section';
    pushBody(blocks, body, path, kind);
  };
  for (const line of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) {
        headings.pop();
      }
      headings.push({ level, title: heading[2].trim() });
      path = headings
        .map((item) => item.title)
        .join(' > ')
        .slice(0, 300);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** 抽取 + 切块：`blocks` 非空时直接按天然单元切，否则按正文段落切。 */
export function extractLibraryText(
  bytes: Uint8Array,
  type: string,
  options: { name?: string } = {},
): Extraction {
  let note = '';
  let text = '';
  let blocks: LibraryBlock[] = [];
  try {
    if (type === 'docx') {
      text = docxText(bytes);
    } else if (type === 'pptx') {
      blocks = pptxSlides(bytes);
      text = blocks.map((block) => block.content).join('\n\n');
    } else if (type === 'xlsx') {
      blocks = xlsxSheets(bytes);
      text = blocks.map((block) => block.content).join('\n\n');
    } else if (type === 'pdf') {
      blocks = pdfPages(bytes);
      text = blocks.map((block) => block.content).join('\n\n');
      if (!text) {
        note =
          'PDF 里没能抽出文字（多为扫描件或使用了 CID 字体），这篇暂时检索不到内容';
      }
    } else if (type === 'html' || type === 'htm') {
      text = htmlToText(decode(bytes));
    } else if (type === 'json') {
      const raw = decode(bytes).trim();
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        text = raw;
      }
    } else {
      text = tidy(decode(bytes));
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `解析失败：${error.message}`
        : '解析失败：文件格式不支持',
    );
  }
  text = text.slice(0, MAX_TEXT_CHARS);
  if (!blocks.length && text) {
    blocks =
      type === 'md'
        ? chunkMarkdown(text)
        : (() => {
            const out: LibraryBlock[] = [];
            pushBody(out, text, options.name || '正文', 'paragraph');
            return out;
          })();
  }
  return { type, text, blocks, note };
}
