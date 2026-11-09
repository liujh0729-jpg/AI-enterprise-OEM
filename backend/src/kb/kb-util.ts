/** kb 模块公共小工具：视图转换与文本裁剪（金额/时间一律出 string，防精度与时区歧义）。 */

export const iso = (d: Date | null | undefined): string =>
  d ? d.toISOString() : '';

export const clip = (s: string, n: number): string => {
  const v = String(s ?? '');
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

/** 摘要：压掉换行后取前 n 字（列表行 excerpt 统一口径）。 */
export const excerptOf = (text: string, n = 160): string =>
  clip(
    String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    n,
  );

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((item) => String(item)).filter(Boolean) : [];

export const objMap = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** slug 规范化：小写、连字符化、夹长度；空串回落随机名（调用方保证非空场景）。 */
export const normalizeSlug = (s: string): string => {
  const v = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return v || `page-${Date.now().toString(36)}`;
};
