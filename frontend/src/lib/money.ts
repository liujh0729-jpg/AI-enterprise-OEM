/**
 * 金额展示口径（全站唯一实现，各模块 common.ts 统一再导出）：
 * 千分位 + 固定小数位，跟随 `zh-CN` 分组。
 */
export function money(value: unknown, digits = 2): string {
  const num = Number(value || 0);
  return num.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 带人民币符号的金额；没有值（null/undefined/空串）显示「—」而不是 ¥0.00。 */
export function moneyCny(value: unknown, digits = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  return `¥${money(value, digits)}`;
}
