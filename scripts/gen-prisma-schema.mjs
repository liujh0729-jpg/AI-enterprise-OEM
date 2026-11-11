// 从唯一的 MySQL 权威 schema 派生 PostgreSQL schema：
// 开源版把 schema.prisma（provider=mysql）作为唯一事实源，安装选 PostgreSQL 时
// 由本脚本确定性地产出 schema.postgres.prisma，避免手工维护两份 6000 行 schema 漂移。
// 仅做「方言必需」的最小改写：datasource provider + MySQL 独有原生类型映射。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '../backend');
const srcFile = resolve(backendDir, 'prisma/schema.prisma');
const outFile = resolve(backendDir, 'prisma/schema.postgres.prisma');

const source = readFileSync(srcFile, 'utf8');

let result = source;

// 1) datasource provider：mysql → postgresql（只改 datasource 块内那一行）。
result = result.replace(
  /(datasource\s+\w+\s*\{[^}]*?provider\s*=\s*)"[^"]*"/m,
  '$1"postgresql"',
);

// 2) 原生类型改写：Prisma 在 PostgreSQL 下不认识以下 MySQL 独有标注。
//    - @db.TinyInt    → @db.SmallInt（PG 无 tinyint）
//    - @db.MediumText / @db.LongText → @db.Text（PG 无这两种 text，Text 本身无长度上限）
//    - @db.DateTime(n)/@db.DateTime → @db.Timestamp(n)/@db.Timestamp(3)
result = result
  .replace(/@db\.TinyInt\b/g, '@db.SmallInt')
  .replace(/@db\.(?:Medium|Long)Text\b/g, '@db.Text')
  .replace(/@db\.DateTime\((\d+)\)/g, '@db.Timestamp($1)')
  .replace(/@db\.DateTime\b(?![(.])/g, '@db.Timestamp(3)');

const header =
  '// 自动生成，请勿手改：由 node scripts/gen-prisma-schema.mjs 从 schema.prisma 派生。\n'
  + '// 事实源是 MySQL 版 schema.prisma；此处仅切换 provider 并映射 MySQL 独有原生类型。\n';

writeFileSync(outFile, header + result, 'utf8');

const countOf = (re) => (result.match(re) || []).length;
console.log('已生成 ' + outFile);
console.log(
  '  provider=postgresql, @db.SmallInt×' + countOf(/@db\.SmallInt/g)
    + ', @db.Text×' + countOf(/@db\.Text\b/g)
    + ', @db.Timestamp×' + countOf(/@db\.Timestamp/g)
    + '（原 MySQL 独有类型已映射）',
);
