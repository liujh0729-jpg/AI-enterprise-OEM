/**
 * 生成 AIPDD Enterprise 插件图标（深色底 + 白色 AI 字标）→ extensions/aipdd-enterprise/icons/。
 *
 * 为什么自己画而不用图片工具：插件此前没有 icons 声明，Chrome 只能给一个灰色占位字母，
 * 与本系统深色导航的观感不符。图标只有「圆角深色方块 + 两字母」这一个造型，用零依赖的
 * PNG 写入器（Node 内置 zlib + 手写 CRC）程序化生成，既能进版本库又不需要任何图像依赖。
 *
 * 用法：node scripts/gen-extension-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "extensions", "aipdd-enterprise", "icons");
const SIZES = [16, 32, 48, 128];

/** 深色底与白色字标：深色取本系统深色导航的墨蓝，字标纯白保证小尺寸下可辨。 */
const BG = [15, 23, 42, 255];
const INK = [255, 255, 255, 255];

/** 4×4 超采样后盒式降采样：圆角与字标边缘平滑，避免小尺寸出现锯齿。 */
const SS = 4;

/** 5×7 点阵字模（1 为着墨）。16px 图标只放 A，其余放 AI，避免小尺寸糊成一团。 */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
};

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

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  // 块布局：长度(4) + 类型(4) + 数据；CRC 覆盖「类型 + 数据」。
  const body = Buffer.concat([typeBuf, data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

/** RGBA 像素缓冲 → PNG（8 位真彩 + Alpha）。 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 圆角方块的内部判定（用超采样坐标，边界不外扩）。 */
function insideRoundedRect(x, y, side, radius) {
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  const cx = Math.min(Math.max(x, radius), side - radius);
  const cy = Math.min(Math.max(y, radius), side - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size) {
  const side = size * SS;
  const radius = side * 0.22;
  const letters = size <= 20 ? ["A"] : ["A", "I"];
  const cols = letters.reduce((sum, key) => sum + GLYPHS[key][0].length, 0) + (letters.length - 1);
  const rows = GLYPHS.A.length;

  const pad = Math.round(side * 0.24);
  const scale = Math.max(
    1,
    Math.min(
      Math.floor((side - 2 * pad) / cols),
      Math.floor((side - 2 * pad) / rows),
    ),
  );
  const textW = cols * scale;
  const textH = rows * scale;
  const originX = Math.round((side - textW) / 2);
  const originY = Math.round((side - textH) / 2);

  // 超采样画布：先逐子像素决定归属，再按 4×4 盒式降采样。
  const hi = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (!insideRoundedRect(x + 0.5, y + 0.5, side, radius)) continue;
      let ink = false;
      let col = originX;
      for (const key of letters) {
        const glyph = GLYPHS[key];
        for (let gy = 0; gy < rows && !ink; gy += 1) {
          for (let gx = 0; gx < glyph[0].length && !ink; gx += 1) {
            if (glyph[gy][gx] !== "1") continue;
            const px = col + gx * scale;
            const py = originY + gy * scale;
            if (x >= px && x < px + scale && y >= py && y < py + scale) ink = true;
          }
        }
        col += glyph[0].length * scale + scale;
      }
      const color = ink ? INK : BG;
      const at = (y * side + x) * 4;
      hi[at] = color[0];
      hi[at + 1] = color[1];
      hi[at + 2] = color[2];
      hi[at + 3] = 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const cells = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const at = ((y * SS + sy) * side + (x * SS + sx)) * 4;
          const alpha = hi[at + 3];
          r += hi[at] * alpha;
          g += hi[at + 1] * alpha;
          b += hi[at + 2] * alpha;
          a += alpha;
        }
      }
      const at = (y * size + x) * 4;
      // 透明角落：按 alpha 加权还原颜色，避免边缘泛黑。
      out[at] = a ? Math.round(r / a) : 0;
      out[at + 1] = a ? Math.round(g / a) : 0;
      out[at + 2] = a ? Math.round(b / a) : 0;
      out[at + 3] = Math.round(a / cells);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(outDir, { recursive: true });
const written = SIZES.map((size) => {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, renderIcon(size));
  return `icon-${size}.png`;
});
console.log(`已生成 ${written.length} 个图标 → extensions/aipdd-enterprise/icons/：${written.join(", ")}`);
