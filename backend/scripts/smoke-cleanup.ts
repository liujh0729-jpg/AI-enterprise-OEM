/**
 * M2 冒烟前置清理：删除测试账户（保留 id=1 管理员）并重置自增，清空验证码/登录日志/Key 绑定。
 * 用法：pnpm exec tsx scripts/smoke-cleanup.ts
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
import { PrismaClient } from '../generated/prisma';

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id > 1`);
    await prisma.$executeRawUnsafe(`ALTER TABLE users AUTO_INCREMENT = 2`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE login_logs`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE verify_codes`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE user_aipdd_bindings`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE aipdd_keys`);
    await prisma.$executeRawUnsafe(`DELETE FROM api_keys WHERE user_id <> '1'`);
    const users = await prisma.account.findMany({ select: { id: true, username: true, role: true } });
    console.log('cleanup done, users left:', JSON.stringify(users));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
