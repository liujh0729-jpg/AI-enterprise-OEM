// 把「省、市字段上线前的历史演示数据」补齐到与 prisma/seed.ts 同一口径（不重跑 seed）。
// 依据：机构名里的城市、统一社会信用代码前缀（91330100=杭州 / 9131=上海 / 914403=深圳 / 9111=北京）、
// 身份证前缀（3301=杭州）；职员跟随其绑定服务商。规则外的一律留空并打印，不凭空造数。
// 用法：node scripts/align-subject-locations.mjs [--dry]
import { createPrisma } from './harness.mjs';

const prisma = createPrisma();
const dry = process.argv.includes('--dry');

const ORG_CITY = [
  ['上海', '上海市', '上海市'],
  ['深圳', '广东省', '深圳市'],
  ['北京', '北京市', '北京市'],
  ['宁波', '浙江省', '宁波市'],
  ['甬城', '浙江省', '宁波市'],
];
const USCC_CITY = [
  ['91330100', '浙江省', '杭州市'],
  ['91330200', '浙江省', '宁波市'],
  ['91310', '上海市', '上海市'],
  ['914403', '广东省', '深圳市'],
  ['91110', '北京市', '北京市'],
];

function fromName(org) {
  for (const [key, province, city] of ORG_CITY) {
    if (org.includes(key)) return { province, city };
  }
  return null;
}
function fromCode(code) {
  for (const [prefix, province, city] of USCC_CITY) {
    if (code.startsWith(prefix)) return { province, city };
  }
  if (code.startsWith('3301')) return { province: '浙江省', city: '杭州市' };
  return null;
}

const providers = await prisma.providerApplication.findMany({
  where: { OR: [{ province: '' }, { city: '' }] },
  orderBy: { id: 'asc' },
});
let done = 0;
const skipped = [];
for (const row of providers) {
  const loc =
    fromName(row.orgName) ||
    fromCode(row.uscc || '') ||
    fromCode(row.idCard || '');
  if (!loc) {
    skipped.push(`服务商 #${row.id} ${row.orgName}（${row.providerType}）`);
    continue;
  }
  console.log(`服务商 #${row.id} ${row.orgName}（${row.providerType}）→ ${loc.province}/${loc.city}`);
  if (!dry) {
    await prisma.providerApplication.update({
      where: { id: row.id },
      data: { province: loc.province, city: loc.city },
    });
  }
  done++;
}

const locatedProviders = await prisma.providerApplication.findMany({
  where: { province: { not: '' } },
  select: { id: true, userId: true, orgName: true, province: true, city: true },
});
const byUser = new Map();
for (const row of locatedProviders) {
  if (!byUser.has(row.userId)) byUser.set(row.userId, row);
}
const bindings = await prisma.providerStaff.findMany();
const staffRows = await prisma.staffProfile.findMany({
  where: { OR: [{ province: '' }, { city: '' }] },
});
for (const row of staffRows) {
  const bound = bindings
    .filter((item) => item.staffUserId === row.userId)
    .map((item) => byUser.get(item.providerUserId))
    .filter(Boolean)
    .sort((a, b) => b.id - a.id)[0];
  if (!bound) {
    skipped.push(`职员 ${row.realName}（${row.userId}）无已填省市的绑定服务商`);
    continue;
  }
  console.log(`职员 ${row.realName} → ${bound.province}/${bound.city}（跟随服务商 ${bound.orgName}）`);
  if (!dry) {
    await prisma.staffProfile.update({
      where: { userId: row.userId },
      data: { province: bound.province, city: bound.city },
    });
  }
  done++;
}

for (const row of await prisma.enterpriseProfile.findMany({
  where: { OR: [{ province: '' }, { city: '' }] },
})) {
  const loc =
    fromName(row.name) ||
    fromCode(row.uscc || '') ||
    fromCode(row.idCard || '') ||
    fromName(row.address || '');
  if (!loc) {
    skipped.push(`用户 ${row.name}（${row.userId}）`);
    continue;
  }
  console.log(`用户 ${row.name} → ${loc.province}/${loc.city}`);
  if (!dry) {
    await prisma.enterpriseProfile.update({
      where: { id: row.id },
      data: { province: loc.province, city: loc.city },
    });
  }
  done++;
}

console.log(
  `\n汇总：补齐 ${done} 行${dry ? '（--dry 未写库）' : '（已写库）'}；规则外留空 ${skipped.length} 行`,
);
for (const item of skipped) console.log('  留空：', item);
await prisma.$disconnect();
