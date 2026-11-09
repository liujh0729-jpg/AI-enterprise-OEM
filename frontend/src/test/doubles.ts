/**
 * 单测替身：只实现被测代码实际用到的成员。
 *
 * 组件/工具声明的是完整依赖类型，单测不可能也不该实现全部成员；
 * 把「部分实现」这一约定收口到一处，调用点直接按目标类型使用，避免散落的强制断言。
 */
export function stub<T>(value: object | null | undefined = {}): T {
  return value as unknown as T;
}
