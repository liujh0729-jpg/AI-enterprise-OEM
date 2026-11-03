import { text } from '../common/api';
/** 只取传入的字段（前端字段名 → 数据库列名），未传的保持原值。 */
export function pickEditable(
  body: Record<string, unknown>,
  map: Record<string, string>,
) {
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    if (body[key] !== undefined) {
      data[column] = text(body[key] ?? '');
    }
  }
  return data;
}
/** 取正整数（用于 headcount 一类字段）。 */
export function pickPositiveInt(
  body: Record<string, unknown>,
  key: string,
  current: number,
) {
  if (body[key] === undefined) return current;
  const value = Number(body[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : current;
}
