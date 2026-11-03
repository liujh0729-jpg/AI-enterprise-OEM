// 三张资源表（律所·律师 / 知产代理机构·代理人 / 灵工服务商机构·代理人）的「所在省、市」显式对齐。
// 依据：历史 region 自由文本里的城市名，其次机构名/人名里的城市线索；规则外的一律留空并打印
// （界面显示「所在地待补充」，该行不参与省市筛选），不凭空造数。
// 顺带归一 flex_providers.kind：一列两套词汇（HR/STAFFING/OUTSOURCING/CROWD/PLATFORM vs COMPANY/INDIVIDUAL），
// 按 recordType 归一为 COMPANY（机构）/ INDIVIDUAL（代理人），与登记表单下拉同源。
// 用法：node scripts/align-resource-locations.mjs [--dry]
import { createPrisma } from './harness.mjs';

const prisma = createPrisma();
const dry = process.argv.includes('--dry');

/** 关键词 → 省、市（命中即取，顺序即优先级）。 */
const CITY_RULES = [
  ['杭州', '浙江省', '杭州市'],
  ['宁波', '浙江省', '宁波市'],
  ['温州', '浙江省', '温州市'],
  ['金华', '浙江省', '金华市'],
  ['上海', '上海市', '上海市'],
  ['深圳', '广东省', '深圳市'],
  ['广州', '广东省', '广州市'],
  ['东莞', '广东省', '东莞市'],
  ['北京', '北京市', '北京市'],
];

function locate(...texts) {
  const blob = texts.filter(Boolean).join(' ');
  for (const [key, province, city] of CITY_RULES) {
    if (blob.includes(key)) return { province, city };
  }
  return null;
}

let done = 0;
const skipped = [];

async function align(model, label, rows, describe) {
  for (const row of rows) {
    if (row.province && row.city) continue;
    const loc = locate(row.region, row.name, row.organization);
    if (!loc) {
      skipped.push(`${label} ${describe(row)}`);
      continue;
    }
    console.log(`${label} ${describe(row)} → ${loc.province}/${loc.city}`);
    if (!dry) {
      await model.update({ where: { id: row.id }, data: loc });
    }
    done++;
  }
}

await align(
  prisma.lawyerResource,
  '律所/律师',
  await prisma.lawyerResource.findMany({ orderBy: { id: 'asc' } }),
  (row) => `#${row.id} ${row.kind === 'LAW_FIRM' ? '律所' : '律师'} ${row.name}`,
);
await align(
  prisma.ipAgency,
  '知产机构/代理人',
  await prisma.ipAgency.findMany({ orderBy: { id: 'asc' } }),
  (row) => `#${row.id} ${row.kind === 'AGENCY' ? '机构' : '代理人'} ${row.name}`,
);
await align(
  prisma.flexProvider,
  '灵工资源',
  await prisma.flexProvider.findMany({ orderBy: { id: 'asc' } }),
  (row) => `#${row.id} ${row.recordType === 'ORG' ? '机构' : '代理人'} ${row.name}`,
);

const FLEX_KINDS = ['COMPANY', 'INDIVIDUAL'];
const flexRows = await prisma.flexProvider.findMany({ orderBy: { id: 'asc' } });
for (const row of flexRows) {
  if (FLEX_KINDS.includes(row.kind)) continue;
  const kind = row.recordType === 'AGENT' ? 'INDIVIDUAL' : 'COMPANY';
  console.log(`灵工资源 #${row.id} ${row.name}：kind ${row.kind} → ${kind}`);
  if (!dry) await prisma.flexProvider.update({ where: { id: row.id }, data: { kind } });
  done++;
}

console.log(
  `\n汇总：对齐 ${done} 行${dry ? '（--dry 未写库）' : '（已写库）'}；无法判定城市、留空 ${skipped.length} 行`,
);
for (const item of skipped) console.log('  留空：', item);
await prisma.$disconnect();
