import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
const database = new URL(process.env.DATABASE_URL || '');
assert.equal(database.hostname, '127.0.0.1');
assert.match(database.pathname, /^\/enterprise_migration_\d+_\d+$/);
assert.equal(process.env.ISOLATED_TEST, '1');
const prisma = new PrismaService();
type Explain = {
  'QUERY PLAN': { Plan: unknown; 'Execution Time': number }[];
}[];
async function explain(sql: string) {
  return (
    await prisma.$queryRawUnsafe<Explain>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    )
  )[0]['QUERY PLAN'][0];
}
async function run() {
  const reports = [];
  for (const [table, no, body] of [
    ['marketing_orders', 'order_no', 'description'],
    ['logistics_orders', 'order_no', 'remark'],
    ['smart_service_orders', 'order_no', 'description'],
    ['asset_requests', 'request_no', 'description'],
  ]) {
    // 标识符只取本文件固定白名单；数据库是本脚本所属的一次性隔离库。
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" ("${no}",enterprise_id,staff_user_id,created_by,title,"${body}") SELECT 'idx-'||n,10000+n%1000,'idx-staff-'||(n%1000),'idx-user-'||(n%1000),'isolated','isolated' FROM generate_series(1,20000) AS n`,
    );
    await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
    for (const [column, value] of [
      ['enterprise_id', '10123'],
      ['staff_user_id', "'idx-staff-123'"],
    ]) {
      const name = `${table}_${column}_id_idx`;
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
      const sql = `SELECT id FROM "${table}" WHERE "${column}"=${value} ORDER BY id DESC LIMIT 20`;
      const before = await explain(sql);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX "${name}" ON "${table}" ("${column}",id)`,
      );
      const after = await explain(sql);
      assert(
        JSON.stringify(after.Plan).includes(name),
        `${name} 未用于稀疏租户查询`,
      );
      reports.push({
        table,
        column,
        index: name,
        beforeMs: before['Execution Time'],
        afterMs: after['Execution Time'],
        beforePlan: before.Plan,
        afterPlan: after.Plan,
      });
    }
  }
  await prisma.$executeRawUnsafe(
    "INSERT INTO tax_plans (enterprise_id,provider_user_id,staff_user_id,account_set_id,tax_type,period) SELECT 10000+n,'idx-provider-'||(n%1000),'idx-staff-'||(n%1000),10000+n%1000,'VAT','2026-10' FROM generate_series(1,20000) AS n",
  );
  await prisma.$executeRawUnsafe('ANALYZE tax_plans');
  for (const [column, value] of [
    ['provider_user_id', "'idx-provider-123'"],
    ['staff_user_id', "'idx-staff-123'"],
    ['account_set_id', '10123'],
  ]) {
    const name = `tax_plans_${column}_period_id_idx`;
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
    const sql = `SELECT id FROM tax_plans WHERE "${column}"=${value} AND period='2026-10' ORDER BY id DESC LIMIT 20`;
    const before = await explain(sql);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "${name}" ON tax_plans ("${column}",period,id)`,
    );
    const after = await explain(sql);
    assert(JSON.stringify(after.Plan).includes(name), `${name} 未用于查询`);
    reports.push({
      table: 'tax_plans',
      column,
      index: name,
      beforeMs: before['Execution Time'],
      afterMs: after['Execution Time'],
      beforePlan: before.Plan,
      afterPlan: after.Plan,
    });
  }
  const dir = resolve(
    process.env.ENTERPRISE_TEMP_DIR || '/Volumes/Projects/tmp',
    'enterprise-hono-migration',
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(dir, 'query-plans.json'),
    JSON.stringify(reports, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      reports.map(({ beforePlan, afterPlan, ...summary }) => {
        void beforePlan;
        void afterPlan;
        return summary;
      }),
      null,
      2,
    ),
  );
}
void run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : '执行计划验证失败');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
