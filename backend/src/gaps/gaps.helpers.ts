import type { Prisma } from '../../generated/prisma';
import { randomBytes } from 'node:crypto';

/**
 * 附录 B 补齐项的公用口径：
 * - 文本截断 / 数字收口 / 日期解析（继承 HRM 的 `clip`、`iso`）
 * - 分页扫描（与 `pageQuerySchema` 的上限保持一致）
 * - 组织键、标签映射
 */

export { clip, iso } from '../hrm/hrm.helpers';

export type Row = Record<string, unknown>;
export type OrgKey = { orgType: string; orgUserId: string };

export const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

export const asNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const asInt = (v: unknown, fallback = 0): number =>
  Math.trunc(asNum(v, fallback));

export const asBool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean'
    ? v
    : v === 'true'
      ? true
      : v === 'false'
        ? false
        : fallback;

export const asDate = (v: unknown): Date | null => {
  const raw = asText(v).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isoOr = (v: Date | null | undefined): string =>
  v instanceof Date ? v.toISOString() : '';

export const jsonBlock = (v: unknown): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};

export const jsonArray = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x): x is Row => !!x && typeof x === 'object')
    : [];

export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export const pageParams = (query: Row, fallback = 20) => {
  const page = Math.min(100_000, Math.max(1, asInt(query.page, 1) || 1));
  const pageSize = Math.min(
    200,
    Math.max(1, asInt(query.pageSize, fallback) || fallback),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
};

/** 当前自然月（YYYY-MM），配额与用量按它分桶。 */
export const periodOf = (now = new Date()): string => {
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 7);
};

export const dayKey = (at: Date = new Date()): string => {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 10);
};

export const publicBase = (): string =>
  String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

/** 对外链接一律走配置里的站点地址；没配就返回相对路径，界面可直接跳。 */
export const publicUrlOf = (path: string): string => `${publicBase()}${path}`;

export const randomToken = (bytes = 24): string =>
  randomBytes(bytes).toString('hex');

/** 简单 HTML → 纯文本：邮件通道只发纯文本兜底时用。 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** 模板变量：{{key}} 替换；返回替换后的文本与缺失变量（required 场景由调用方拦截）。 */
export const renderVars = (
  template: string,
  vars: Record<string, unknown>,
): { text: string; missing: string[] } => {
  const missing = new Set<string>();
  const text = template.replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_all, key: string) => {
      const value = vars[key];
      if (value === undefined || value === null || value === '') {
        missing.add(key);
        return '';
      }
      return asText(value);
    },
  );
  return { text, missing: [...missing] };
};

/** 从模板里收集变量名（保存时校准声明列表）。 */
export const varsIn = (text: string): string[] => {
  const out = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g))
    out.add(match[1]);
  return [...out];
};

export const safeStatus = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  allowed.includes(asText(value) as T) ? (asText(value) as T) : fallback;
