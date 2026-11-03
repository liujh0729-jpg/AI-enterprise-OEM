/**
 * 营销备案细项归一（一次性维护脚本）：
 * 存量 `providerApplications(providerType='MARKETING')` 的 serviceItems 是自由文本，
 * 新口径要求细项 code（达人探店＝INFLUENCER_VISIT 等 6 项）——否则该服务商不出现在任何细项分区。
 * 已登记的中文/别名 → code；无法识别的项丢弃并打印（不猜、不保留裸文本）。
 * 用法：node scripts/normalize-marketing-subitems.mjs [--dry]
 */
import { createPrisma } from "./harness.mjs";

const dry = process.argv.includes("--dry");
const prisma = createPrisma();

/** 中文细项（含常见别名）→ 细项 code。 */
const TO_CODE = {
  达人探店: "INFLUENCER_VISIT",
  探店: "INFLUENCER_VISIT",
  达人建联: "INFLUENCER_VISIT",
  直播带货: "LIVE_SELLING",
  直播: "LIVE_SELLING",
  内容营销: "CONTENT_MARKETING",
  geo优化: "GEO_OPTIMIZATION",
  GEO优化: "GEO_OPTIMIZATION",
  geo: "GEO_OPTIMIZATION",
  精准营销: "PRECISION_MARKETING",
  私域营销: "PRIVATE_DOMAIN",
  私域: "PRIVATE_DOMAIN",
};

/** 已是 code 的原样保留。 */
const CODES = [
  "INFLUENCER_VISIT",
  "LIVE_SELLING",
  "CONTENT_MARKETING",
  "GEO_OPTIMIZATION",
  "PRECISION_MARKETING",
  "PRIVATE_DOMAIN",
];

function toCode(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (CODES.includes(value.toUpperCase())) return value.toUpperCase();
  return TO_CODE[value] || null;
}

const rows = await prisma.providerApplication.findMany({
  where: { providerType: "MARKETING" },
  orderBy: { id: "asc" },
  select: { id: true, userId: true, orgName: true, status: true, serviceItems: true },
});

for (const row of rows) {
  const before = String(row.serviceItems || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const mapped = [];
  const dropped = [];
  for (const item of before) {
    const code = toCode(item);
    if (code && !mapped.includes(code)) mapped.push(code);
    if (!code) dropped.push(item);
  }
  const after = mapped.join(",");
  console.log(
    `#${row.id} ${row.orgName}（${row.status}）: 「${row.serviceItems || ""}」→「${after}」` +
      (dropped.length ? ` 丢弃无法识别项：${dropped.join("、")}` : ""),
  );
  if (dry || after === row.serviceItems) continue;
  await prisma.providerApplication.update({
    where: { id: row.id },
    data: { serviceItems: after },
  });
}

await prisma.$disconnect();
