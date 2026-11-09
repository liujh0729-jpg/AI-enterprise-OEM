import { Prisma } from '../../generated/prisma';

/** JSON 列的写入值：普通 JSON，或 Prisma 的「JSON null」哨兵（顶层 null 必须用它表达）。 */
export type JsonInput = Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;

/**
 * 把外部输入收敛成 Prisma 可写的 JSON 值。
 *
 * 语义与 `JSON.stringify` 对齐：对象里 `undefined` 的键被丢弃、数组里落 `null`、
 * `Date` 转 ISO 字符串、`NaN`/`Infinity` 落 `null`；函数、symbol、bigint 无法用 JSON
 * 表达，同样降级为 `null`。顶层 `null` 用 `Prisma.JsonNull`，因为 Prisma 的
 * `InputJsonValue` 不接受裸 `null`（那是数据库 NULL 与 JSON null 的歧义点）。
 * 这样写入 JSON 列的值一定可序列化，调用点无需再做类型断言。
 */
export function toJsonInput(value: unknown): JsonInput {
  const mapped = jsonValueOf(value);
  return mapped === null ? Prisma.JsonNull : mapped;
}

/**
 * 读回 JSON 列时的边界断言，与 `toJsonInput` 成对。
 *
 * Prisma 把 Json 列读成 `Prisma.JsonValue`，与业务形状没有结构交叠，普通 `as` 过不去，
 * 过去就地在每个读取点写双重断言。这些列由本系统写入、形状受契约约束，属于
 * 「进来时校验一次」的边界：集中在这里做一次断言，读侧不再散落强制断言。
 */
export function fromJson<T>(value: unknown): T {
  return value as T;
}

function jsonValueOf(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValueOf);
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (item === undefined) continue;
      out[key] = jsonValueOf(item);
    }
    return out;
  }
  return null;
}
