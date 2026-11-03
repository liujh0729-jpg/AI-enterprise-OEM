/**
 * 物流 / 资产交易备案细项归一（一次性维护脚本）：
 * 新口径下「物流服务（含小微服务商）」必须勾选 2 个细项（境内陆运 / 跨境货代）、
 * 「资产交易」必须勾选 5 个细项（房产销售/租赁 / 保险 / 投资理财 / 不良资产 / 汽车交易），
 * 细项 code 记在承载备案行的 serviceItems 上——没勾过细项的存量行不出现在任何分区、也不能被签约。
 * 已登记的中文/别名 → code；无法识别的项丢弃并打印（不猜、不保留裸文本）；
 * 一行有效细项都没有时按该类目全部细项补齐（存量都是通用演示机构，无专业方向证据）。
 * 用法：node scripts/normalize-logistics-asset-subitems.mjs [--dry]
 */
import { createPrisma } from "./harness.mjs";

const dry = process.argv.includes("--dry");
const prisma = createPrisma();

/** 备案类目 → 该类目合法细项 code（与后端 constants.ts 的 subItemsOf 同源）。 */
const BEARING = {
  LOGISTICS: ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER"],
  MICRO: ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER"],
  ASSET_TRADE: [
    "REAL_ESTATE",
    "INSURANCE",
    "INVESTMENT",
    "NON_PERFORMING_ASSET",
    "AUTO_TRADE",
  ],
};

/** 中文细项（含常见别名）→ code。 */
const TO_CODE = {
  境内陆运: "DOMESTIC_LAND",
  国内陆运: "DOMESTIC_LAND",
  国内物流: "DOMESTIC_LAND",
  干线运输: "DOMESTIC_LAND",
  城配: "DOMESTIC_LAND",
  整车: "DOMESTIC_LAND",
  零担: "DOMESTIC_LAND",
  跨境货代: "CROSS_BORDER_FORWARDER",
  国际货代: "CROSS_BORDER_FORWARDER",
  货运代理: "CROSS_BORDER_FORWARDER",
  海运: "CROSS_BORDER_FORWARDER",
  空运: "CROSS_BORDER_FORWARDER",
  铁路: "CROSS_BORDER_FORWARDER",
  报关报检: "CROSS_BORDER_FORWARDER",
  房产销售: "REAL_ESTATE",
  房产租赁: "REAL_ESTATE",
  房产销售租赁: "REAL_ESTATE",
  房产租售: "REAL_ESTATE",
  房屋租赁: "REAL_ESTATE",
  不动产: "REAL_ESTATE",
  保险: "INSURANCE",
  财产保险: "INSURANCE",
  责任险: "INSURANCE",
  团体险: "INSURANCE",
  投资理财: "INVESTMENT",
  理财: "INVESTMENT",
  投资: "INVESTMENT",
  资金配置: "INVESTMENT",
  不良资产: "NON_PERFORMING_ASSET",
  不良债权: "NON_PERFORMING_ASSET",
  资产处置: "NON_PERFORMING_ASSET",
  汽车交易: "AUTO_TRADE",
  车辆交易: "AUTO_TRADE",
  汽车租售: "AUTO_TRADE",
};

function toCode(raw, allowed) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  if (allowed.includes(upper)) return upper;
  const mapped = TO_CODE[value] || TO_CODE[value.replace(/[\s/、，,]/g, "")];
  return mapped && allowed.includes(mapped) ? mapped : null;
}

const rows = await prisma.providerApplication.findMany({
  where: { providerType: { in: Object.keys(BEARING) } },
  orderBy: { id: "asc" },
  select: {
    id: true,
    userId: true,
    orgName: true,
    providerType: true,
    status: true,
    serviceItems: true,
  },
});

console.log(`命中承载备案行 ${rows.length} 条（${dry ? "演练模式，不写库" : "将写库"}）`);

for (const row of rows) {
  const allowed = BEARING[row.providerType];
  const before = String(row.serviceItems || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const mapped = [];
  const dropped = [];
  for (const item of before) {
    const code = toCode(item, allowed);
    if (code && !mapped.includes(code)) mapped.push(code);
    if (!code) dropped.push(item);
  }
  // 一条有效细项都没有＝存量从没勾过：按该类目全部细项补齐（否则该行在任何分区都不出现）
  const filled = mapped.length ? [] : allowed.filter((code) => !mapped.includes(code));
  const after = [...mapped, ...filled].join(",");
  if (after === row.serviceItems && !dropped.length) {
    console.log(`#${row.id} ${row.orgName}（${row.providerType}/${row.status}）无需变更`);
    continue;
  }
  console.log(
    `#${row.id} ${row.orgName}（${row.providerType}/${row.status}）: ` +
      `「${row.serviceItems || ""}」→「${after}」` +
      (filled.length ? ` 补齐 ${filled.length} 项` : "") +
      (dropped.length ? ` 丢弃无法识别项：${dropped.join("、")}` : ""),
  );
  if (dry) continue;
  await prisma.providerApplication.update({
    where: { id: row.id },
    data: { serviceItems: after },
  });
}

await prisma.$disconnect();
