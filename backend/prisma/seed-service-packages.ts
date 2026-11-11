import type { PrismaClient } from '../generated/prisma';

/**
 * 官方服务套餐升级种子：把原「财税服务包 · 参考价格」两条写死套餐迁进 service_packages，
 * 保证升级后财税板块不空、可积分直购。MySQL 侧由 0053 迁移直接 INSERT；PostgreSQL 走 db push
 * 不跑迁移 SQL，故这里再幂等补一次（按 serviceType+taxpayerType 判存，重跑不产生重复行）。
 * 13 项服务与价格取自 frontend/src/app/tax/_components/common.ts（TAX_PLANS / TAX_SERVICES）。
 */
const TAX_FEATURES = [
  '增值税及附加税',
  '企业所得税',
  '印花税',
  '财务报表',
  '个人所得税',
  '残保金申报',
  '税务年度汇算清缴',
  '工商年检',
  '电子凭证及财务报表的下载',
  '旧账导入',
  '账套管理（记账）',
  '代扣代缴税款',
  '财务老师线上咨询',
];

const TAX_PACKAGES = [
  {
    taxpayerType: 'SMALL',
    name: '小规模纳税人',
    description: '面向小规模纳税人的全年财税代理服务，含记账报税与财务咨询。',
    priceCents: 36000,
    sortOrder: 1,
  },
  {
    taxpayerType: 'GENERAL',
    name: '一般纳税人',
    description: '面向一般纳税人的全年财税代理服务，含记账报税与财务咨询。',
    priceCents: 99000,
    sortOrder: 2,
  },
];

export async function seedServicePackages(prisma: PrismaClient) {
  for (const item of TAX_PACKAGES) {
    const exists = await prisma.servicePackage.findFirst({
      where: { serviceType: 'TAX_FINANCE', taxpayerType: item.taxpayerType },
    });
    if (exists) continue;
    await prisma.servicePackage.create({
      data: {
        serviceType: 'TAX_FINANCE',
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        unit: '年',
        features: TAX_FEATURES,
        deliveryItems: [{ code: 'TAX_FINANCE', label: '企业财税服务' }],
        deliveryDesc:
          '本套餐由平台整合优质服务商完成交付：采购后平台主持企业与财税服务商签约兑现。',
        autoInitiate: false,
        taxpayerType: item.taxpayerType,
        perUserLimit: 0,
        status: 'ACTIVE',
        sortOrder: item.sortOrder,
      },
    });
  }
}