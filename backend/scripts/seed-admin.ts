/**
 * 平台管理员初始化（开源版首个管理员由部署者通过 CLI 种子创建）：
 *   backend/.env 配 ADMIN_USERNAME / ADMIN_PASSWORD 后执行：pnpm tsx scripts/seed-admin.ts
 * 幂等：已存在同名账户则跳过；--reset 时重置其密码并强制首登改密。
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
import { PrismaClient } from '../generated/prisma';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';

async function main() {
  // 与账户系统同口径：用户名小写存储，避免 PG 大小写敏感导致管理员无法登录。
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  let password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!username) {
    console.error('请在 backend/.env 配置 ADMIN_USERNAME 后重试');
    process.exitCode = 1;
    return;
  }
  const generated = !password;
  if (generated) password = `${randomBytes(9).toString('base64url')}aA1`;
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.account.findUnique({ where: { username } });
    const hash = await bcrypt.hash(password, 10);
    if (existing) {
      if (!process.argv.includes('--reset')) {
        console.log(`管理员 ${username} 已存在（id=${existing.id}），跳过。如需重置密码加 --reset`);
        return;
      }
      await prisma.account.update({
        where: { id: existing.id },
        data: {
          passwordHash: hash,
          role: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
          tokenVersion: { increment: 1 },
          mustChangePassword: 1,
        },
      });
      console.log(`管理员 ${username} 密码已重置，首登需强制改密。`);
    } else {
      const created = await prisma.account.create({
        data: { username, passwordHash: hash, role: 'PLATFORM_ADMIN' },
      });
      await prisma.userDirectory.upsert({
        where: { userId: String(created.id) },
        update: { enabled: 1, displayName: username, username },
        create: {
          userId: String(created.id),
          username,
          displayName: username,
          email: '',
          avatarUrl: '',
          role: '',
          enabled: 1,
        },
      });
      console.log(`管理员 ${username} 已创建（userId=${created.id}）。`);
    }
    if (generated) {
      // 明文只在控制台输出一次；同时给出 sha256 便于核对而不泄露
      console.log(`一次性初始密码：${password}`);
      console.log(`（指纹 ${createHash('sha256').update(password).digest('hex').slice(0, 12)}，登录后请立即修改）`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
