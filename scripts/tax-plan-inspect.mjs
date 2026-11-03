/** 只读巡检：申报计划相关表（用户 / 企业档案 / 服务商备案 / 签约 / 分派 / 账套 / 申报计划）。 */
import { createPrisma } from "./harness.mjs";

const prisma = createPrisma();
const show = (title, rows) => {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  rows.forEach((row) => console.log(JSON.stringify(row)));
};

const main = async () => {
  show(
    "演示账号",
    await prisma.userDirectory.findMany({
      where: { username: { contains: "demo" } },
      select: { userId: true, username: true, displayName: true },
    }),
  );
  show(
    "企业档案",
    await prisma.enterpriseProfile.findMany({
      select: {
        id: true,
        userId: true,
        name: true,
        subjectType: true,
        taxpayerType: true,
        status: true,
      },
    }),
  );
  show(
    "服务商备案",
    await prisma.providerApplication.findMany({
      select: {
        id: true,
        userId: true,
        orgName: true,
        providerType: true,
        status: true,
      },
    }),
  );
  show(
    "签约（财税）",
    await prisma.contract.findMany({
      where: { serviceType: "TAX_FINANCE" },
      select: {
        id: true,
        contractNo: true,
        providerUserId: true,
        providerOrg: true,
        enterpriseId: true,
        enterpriseName: true,
        status: true,
      },
    }),
  );
  show(
    "分派关系",
    await prisma.providerAssignment.findMany(),
  );
  show(
    "账套",
    await prisma.accountSet.findMany({
      select: {
        id: true,
        name: true,
        enterpriseId: true,
        providerUserId: true,
        staffUserId: true,
        status: true,
      },
    }),
  );
  show(
    "申报计划",
    await prisma.taxPlan.findMany({
      orderBy: [{ enterpriseId: "asc" }, { period: "asc" }, { taxType: "asc" }],
    }),
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
