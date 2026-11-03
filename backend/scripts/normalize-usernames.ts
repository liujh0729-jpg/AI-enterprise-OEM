/**
 * 一次性回填：把 account.username 归一为小写（与注册/登录的小写口径对齐）。
 * 背景：MySQL 默认排序规则大小写不敏感、PostgreSQL 敏感——混合大小写的存量账号切到 PG 后，
 * 登录按小写精确匹配会查不到。本脚本纯 Prisma 增删改，两种库上均可安全重复执行（幂等）。
 * 撞名（小写后与他账号相同）时跳过并列出，需人工改名处理。
 * 用法：pnpm --filter aiworkin-enterprise-api db:normalize-usernames
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
import { PrismaClient } from '../generated/prisma';

async function main() {
  const prisma = new PrismaClient();
  try {
    const accounts = await prisma.account.findMany({
      select: { id: true, username: true },
    });
    let updated = 0;
    const conflicts: string[] = [];
    for (const a of accounts) {
      const lower = a.username.toLowerCase();
      if (a.username === lower) continue;
      // 与小写同名的其它账号相撞则跳过报告（唯一约束决定了无法自动消解）。
      const clash = accounts.find(
        (x) => x.id !== a.id && x.username.toLowerCase() === lower,
      );
      if (clash) {
        conflicts.push(`${a.username}（id=${a.id}，与小写账号 id=${clash.id} 同名）`);
        continue;
      }
      await prisma.account.update({
        where: { id: a.id },
        data: { username: lower },
      });
      // 用户目录镜像同步（displayName 属展示名，保留原样不动）。
      await prisma.userDirectory
        .update({ where: { userId: String(a.id) }, data: { username: lower } })
        .catch(() => undefined);
      updated += 1;
      console.log(`已归一：${a.username} -> ${lower}（id=${a.id}）`);
    }
    console.log(`完成：更新 ${updated} 个，撞名跳过 ${conflicts.length} 个。`);
    if (conflicts.length) {
      console.log('以下账号小写化后与既有账号撞名，请人工处理：');
      conflicts.forEach((item) => console.log(' - ' + item));
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
