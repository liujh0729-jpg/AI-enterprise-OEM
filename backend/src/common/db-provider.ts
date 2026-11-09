/**
 * 运行期数据库方言判定：安装时写入 DB_PROVIDER，缺失则由 DATABASE_URL 协议推断。
 * 开源版同时兼容 MySQL 与 PostgreSQL，绝大多数数据访问经 Prisma 抽象无需关心方言；
 * 仅少数原生 SQL（单据号自增）需按方言分支，这里给出唯一权威判定入口。
 */
export type DbProvider = 'mysql' | 'postgres';

function fromUrl(url: string | undefined): DbProvider | null {
  if (!url) return null;
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'mysql:') return 'mysql';
    if (protocol === 'postgres:' || protocol === 'postgresql:')
      return 'postgres';
  } catch {
    return null;
  }
  return null;
}

/** 当前生效方言：显式 DB_PROVIDER 优先，回落 DATABASE_URL 协议，最终默认 mysql（保持既有行为）。 */
export function dbProvider(): DbProvider {
  const explicit = (process.env.DB_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'postgres' || explicit === 'postgresql') return 'postgres';
  if (explicit === 'mysql') return 'mysql';
  return fromUrl(process.env.DATABASE_URL) || 'mysql';
}

export function isPostgres(): boolean {
  return dbProvider() === 'postgres';
}
