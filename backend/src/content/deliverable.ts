/**
 * 营销工具产物 → 数字资产的登记通道（公开可变属性，先例：services.builtinMcp.current）。
 * 任务类工具（大数据查询/潜客挖掘等）在后台执行、无请求上下文，产物归档统一走这里；
 * services.ts 装配时把 DigitalAssetService.registerDeliverable 接进来。
 */
export type DeliverableSink = (
  userId: string,
  input: {
    bytes: Buffer;
    filename: string;
    labels?: string[];
    dir?: string;
    source?: string;
  },
) => Promise<unknown>;

/** 工具任务共用的 CSV 构建小工具：与 crm toCsv 同口径（带 BOM、防公式注入）。 */
export function buildDeliverableCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): Buffer {
  const escape = (value: unknown) => {
    const raw =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    columns.map((column) => escape(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf-8');
}
