import { PrismaService } from '../src/prisma/prisma.service';
import { ContactResolver } from '../src/shared/contacts.service';
async function prepare() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (
    process.env.ISOLATED_TEST !== '1' ||
    url.hostname !== '127.0.0.1' ||
    !url.pathname.startsWith('/enterprise_migration_')
  )
    throw new Error('拒绝修改非隔离测试库');
  const prisma = new PrismaService();
  try {
    const contacts = new ContactResolver(prisma);
    for (const row of await prisma.contract.findMany()) {
      await prisma.contract.update({
        where: { id: row.id },
        data: await contacts.stage({
          enterpriseId: row.enterpriseId,
          providerUserId: row.providerUserId,
        }),
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
void prepare();
