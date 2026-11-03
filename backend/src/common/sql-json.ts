import { Prisma } from '../../generated/prisma';
import { isPostgres } from './db-provider';

/**
 * 数据库方言无关的 JSON 取值助手。
 *
 * 背景：`data_table_rows.data` 是 Prisma `Json` 列（MySQL 落 `JSON`、PostgreSQL 落 `jsonb`）。
 * 想在 SQL 侧只投影某个键（不把整块 JSON 拉回应用层），过去直接写了 PostgreSQL 的 `data->>'key'`，
 * 但 MySQL 的 `->>`/`JSON_EXTRACT` 路径必须以 `$` 开头，`'key'` 是非法路径会直接报错——即该查询
 * 只在 PG 上成立，切到 MySQL 就崩。这里按当前方言生成对应路径，两侧都成立：
 *   - PostgreSQL(jsonb)：`"data"->>'key'`
 *   - MySQL(JSON)      ：`` `data`->>'$.key' ``
 * 两边同为 `->>` 操作符，仅右值路径写法不同。
 */
const SAFE_KEY = /^[A-Za-z0-9_]+$/;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 生成「取 JSON 列某键的文本值」的原生 SQL 片段（`Prisma.Sql`），可直接内联进 `Prisma.sql\`...\``。
 * @param column JSON 列名（物理列，如 `data`）；限定为安全标识符（因为作为原生 SQL 片段拼接，不走绑定参数）
 * @param key    要取的键；限定标识符安全字符（字母/数字/下划线），因为操作符右值需为路径字面量而非绑定参数
 */
export function jsonText(column: string, key: string): Prisma.Sql {
  if (!SAFE_IDENT.test(column)) {
    throw new Error(`jsonText: 非法列名 ${JSON.stringify(column)}`);
  }
  if (!SAFE_KEY.test(key)) {
    throw new Error(`jsonText: 非法 JSON 键 ${JSON.stringify(key)}`);
  }
  const pg = isPostgres();
  // 标识符已白名单校验（不含引用符），路径字面量按方言加/不加 `$.` 前缀。
  const col = Prisma.raw(pg ? `"${column}"` : `\`${column}\``);
  const path = Prisma.raw(pg ? `'${key}'` : `'$.${key}'`);
  return Prisma.sql`${col}->>${path}`;
}
