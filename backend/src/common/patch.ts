/**
 * 单据 PATCH 请求体字段读取工具。
 * 字段名以 Prisma 列名（camelCase）为准，同时兼容同名 snake_case 与创建接口沿用的别名，
 * 未在请求体中出现的字段一律不写库（保持原值）。
 */
import { text } from './api';
export function patchValue(
  body: Record<string, unknown>,
  column: string,
  aliases: string[] = [],
): unknown {
  const snake = column.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
  for (const key of [column, snake, ...aliases]) {
    const value = body[key];
    if (value !== undefined) return value;
  }
  return undefined;
}
/** 仅收集请求体中显式传入的可编辑字段。 */
export function patchData(
  body: Record<string, unknown>,
  spec: Record<string, string[]>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [column, aliases] of Object.entries(spec)) {
    const value = patchValue(body, column, aliases);
    if (value === undefined) continue;
    data[column] = value;
  }
  return data;
}
/** 文本列归一化：数组按逗号拼接，null / 对象视为清空。 */
export function patchText(value: unknown): string {
  return text(value);
}
/** 数字列归一化：非正整数返回 null。 */
export function positiveInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}
