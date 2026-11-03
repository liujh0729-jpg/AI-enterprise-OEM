import { Prisma } from '../../generated/prisma';
/** 表单里的多选文本/数组 → JSON 数组列（法律/知产资源与需求共用）。 */
export function toJsonArray(value: unknown): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value as Prisma.InputJsonValue;
  if (typeof value === 'string') {
    const items = value
      .split(/[,，、;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return items;
  }
  return [] as Prisma.InputJsonValue;
}
/** 已存 JSON 列 → 数组（非数组视作空）。 */
export function asJsonArray(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}
/** 内存对象 → JSON 列：只接受纯对象，数组与标量一律按空对象处理。 */
export function toJsonObject(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
