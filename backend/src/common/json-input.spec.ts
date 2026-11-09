import { Prisma } from '../../generated/prisma';
import { toJsonInput } from './json-input';

describe('toJsonInput', () => {
  it('保留 JSON 原生标量', () => {
    expect(toJsonInput('a')).toBe('a');
    expect(toJsonInput(1.5)).toBe(1.5);
    expect(toJsonInput(true)).toBe(true);
  });

  it('顶层 null 用 Prisma 的 JSON null 哨兵表达', () => {
    expect(toJsonInput(null)).toBe(Prisma.JsonNull);
  });

  it('递归保留对象与数组，丢弃 undefined 键', () => {
    expect(
      toJsonInput({ a: 1, b: { c: [1, 'x', null] }, d: undefined }),
    ).toEqual({ a: 1, b: { c: [1, 'x', null] } });
  });

  it('不可序列化的值按 JSON 语义降级：NaN/Infinity → null', () => {
    expect(toJsonInput(Number.NaN)).toBe(Prisma.JsonNull);
    expect(toJsonInput({ n: Number.POSITIVE_INFINITY })).toEqual({ n: null });
  });

  it('Date 按 JSON.stringify 语义转 ISO 字符串', () => {
    expect(toJsonInput(new Date('2026-11-08T00:00:00.000Z'))).toBe(
      '2026-11-08T00:00:00.000Z',
    );
  });

  it('函数/symbol/bigint 无法用 JSON 表达，降级为 null', () => {
    expect(toJsonInput(() => 1)).toBe(Prisma.JsonNull);
    expect(toJsonInput(Symbol('x'))).toBe(Prisma.JsonNull);
    expect(toJsonInput(BigInt(1))).toBe(Prisma.JsonNull);
  });

  it('数组里的 undefined 按 JSON.stringify 语义落 null，保持下标', () => {
    expect(toJsonInput([1, undefined, 3])).toEqual([1, null, 3]);
  });
});
