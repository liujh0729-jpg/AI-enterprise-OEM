/**
 * 零依赖 PDF 1.4 生成器：只做报价单需要的「中文段落 + 金额表 + 页脚」。
 * 字体用 PDF 标准 CJK 字体 STSong-Light（Type0 / UniGB-UCS2-H），
 * 阅读器自带，不嵌入字体文件，因此不需要额外依赖或系统组件。
 */

export type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  gap?: number;
  align?: 'left' | 'right' | 'center';
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_GAP = 6;

const hex = (text: string): string =>
  Buffer.from(text, 'utf16le').swap16().toString('hex').toUpperCase();

/** 文本宽度：中文/全角按 1em，ASCII 按 0.55em 估算。 */
const textWidth = (text: string, size: number) => {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) < 256 ? 0.55 : 1;
  return units * size;
};

const wrap = (text: string, size: number, width: number): string[] => {
  const out: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of paragraph) {
      if (textWidth(line + ch, size) > width && line) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
};

type Placed = {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  color: [number, number, number];
};

function layout(lines: PdfLine[]) {
  const pages: Placed[][] = [];
  let current: Placed[] = [];
  let y = PAGE_H - MARGIN - 24;
  const pushPage = () => {
    pages.push(current);
    current = [];
    y = PAGE_H - MARGIN - 24;
  };
  for (const line of lines) {
    const size = line.size ?? 11;
    const bold = Boolean(line.bold);
    const color = line.color ?? [0.1, 0.13, 0.18];
    const gap = line.gap ?? 0;
    y -= gap;
    for (const piece of wrap(line.text, size, CONTENT_W)) {
      if (y < MARGIN + 32) pushPage();
      const width = textWidth(piece, size);
      const x =
        line.align === 'right'
          ? PAGE_W - MARGIN - width
          : line.align === 'center'
            ? MARGIN + (CONTENT_W - width) / 2
            : MARGIN;
      current.push({ text: piece, x, y, size, bold, color });
      y -= size + LINE_GAP;
    }
  }
  if (current.length || !pages.length) pages.push(current);
  return pages;
}

function contentStream(items: Placed[], pageNo: number, total: number) {
  const commands: string[] = [];
  for (const item of items) {
    const [r, g, b] = item.color;
    commands.push(
      `BT /${item.bold ? 'F2' : 'F1'} ${item.size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm <${hex(item.text)}> Tj ET`,
    );
  }
  // 页脚：页码（ASCII 用 Helvetica，中文不参与）
  commands.push(
    `BT /F1 9 Tf 0.55 0.6 0.68 rg 1 0 0 1 ${(PAGE_W / 2 - 20).toFixed(2)} 24 Tm (${pageNo} / ${total}) Tj ET`,
  );
  return commands.join('\n');
}

/** 生成 PDF 二进制；`lines` 按顺序流式排版，超页自动分页。 */
export function buildPdf(lines: PdfLine[]): Buffer {
  const pages = layout(lines);
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegular = add(
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >> /DW 1000 >>] >>',
  );
  const fontBold = add(
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >> /DW 1000 >>] >>',
  );
  const helvetica = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const placeholderPages = add(''); // 占位，稍后回填

  pages.forEach((items, index) => {
    const stream = contentStream(items, index + 1, pages.length);
    const contentId = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    contentIds.push(contentId);
    const pageId = add(
      `<< /Type /Page /Parent ${placeholderPages} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${helvetica} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });

  objects[placeholderPages - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = add(`<< /Type /Catalog /Pages ${placeholderPages} 0 R >>`);

  // 交叉引用：等宽 10 位，偏移量按 latin1 字节累计
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
