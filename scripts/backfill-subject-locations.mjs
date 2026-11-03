/**
 * 三类主体（用户 / 职员·代理人 / 服务商）所在省、市回填（一次性维护脚本）。
 * 2026-09-25 起省、市为申请必填（提交认证 / 个人资料 / 备案时选好），
 * 字段上线前提交的存量行仍是空值：空值行在名录里显示「所在地待补充」，且不被省市筛选命中。
 * 本脚本只从行内已有文本（机构名称 / 简介 / 资质 / 所在地区 / 注册地址）里取证据：
 * 命中字典城市 → 省 + 市；只命中省 → 只填省、市留空（不猜城市）；都没有 → 跳过并打印。
 * 字典与界面下拉同源（后端未连接 AIworkin 时的省市回落字典）。
 * 用法：node scripts/backfill-subject-locations.mjs [--dry] [--limit=N]
 */
import { createRequire } from "node:module";
import { join } from "node:path";

import { createPrisma, ROOT } from "./harness.mjs";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { DEMO_LOCATIONS } = require(join(ROOT, "backend/dist/aiworkin/connections-demo.js"));

const dry = process.argv.includes("--dry");
const limitArg = process.argv.find((item) => item.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
const prisma = createPrisma();

/** 字典 → 「短名（去 省/市 后缀）→ {province, city}」查找表（长名优先，避免「江市」误命中）。 */
const CITY_KEYS = [];
const PROVINCE_KEYS = [];
const short = (value) => value.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, "");
for (const province of DEMO_LOCATIONS) {
  PROVINCE_KEYS.push([short(province.value), province.value]);
  for (const city of province.children || []) {
    CITY_KEYS.push([short(city.value), { province: province.value, city: city.value }]);
  }
}
CITY_KEYS.sort((a, b) => b[0].length - a[0].length);
PROVINCE_KEYS.sort((a, b) => b[0].length - a[0].length);

/** 直辖市（省名以「市」结尾）：市级值就用它自己（＝界面下拉里的「全市」，与 AIworkin 演示资源一致）。 */
const cityOfProvince = (value) => (value.endsWith("市") ? value : "");

/** 从一段文本里取省市证据：先城市后省份（城市自带省份）。 */
function detect(text) {
  const hay = String(text || "").replace(/\s/g, "");
  if (!hay) return { province: "", city: "", source: "" };
  for (const [key, hit] of CITY_KEYS) {
    if (key && hay.includes(key)) {
      return { ...hit, source: `城市「${key}」` };
    }
  }
  for (const [key, value] of PROVINCE_KEYS) {
    if (key && hay.includes(key)) {
      return {
        province: value,
        city: cityOfProvince(value),
        source: `省份「${key}」`,
      };
    }
  }
  return { province: "", city: "", source: "" };
}

/** 只回填空值行；已有省市的行不动（用户自己选过就以用户为准）。 */
const needLocation = { OR: [{ province: "" }, { city: "" }] };

const jobs = [
  {
    label: "服务商备案行",
    model: prisma.providerApplication,
    // 服务商名录按省市筛选，只有审核通过的行会进名录
    where: { status: "APPROVED", ...needLocation },
    texts: (row) => [row.orgName, row.intro, row.qualification],
    key: (row) => `${row.orgName}（${row.providerType}）`,
  },
  {
    label: "职员/代理人资料",
    model: prisma.staffProfile,
    where: needLocation,
    texts: (row) => [row.region, row.intro, row.qualification],
    key: (row) => `${row.realName}（地区「${row.region || "—"}」）`,
  },
  {
    label: "用户档案",
    model: prisma.enterpriseProfile,
    where: needLocation,
    texts: (row) => [row.address, row.name, row.industry],
    key: (row) => `${row.name}（地址「${row.address || "—"}」）`,
  },
];

let filled = 0;
let undecided = 0;
for (const job of jobs) {
  const rows = await job.model.findMany({
    where: job.where,
    orderBy: { id: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`\n== ${job.label}：待补 ${rows.length} 行 ==`);
  for (const row of rows) {
    let hit = { province: "", city: "", source: "" };
    for (const text of job.texts(row)) {
      hit = detect(text);
      if (hit.province) break;
    }
    if (!hit.province) {
      undecided += 1;
      console.log(`#${row.id} ${job.key(row)} → 无省市证据，留空（界面显示「所在地待补充」）`);
      continue;
    }
    filled += 1;
    console.log(
      `#${row.id} ${job.key(row)} → ${hit.province}${hit.city || "（市待补）"} [${hit.source}]`,
    );
    if (dry) continue;
    await job.model.update({
      where: { id: row.id },
      data: { province: hit.province, city: hit.city },
    });
  }
}

console.log(
  `\n汇总：可回填 ${filled} 行、无证据 ${undecided} 行（${dry ? "演练模式，未写库" : "已写库"}）`,
);
await prisma.$disconnect();
