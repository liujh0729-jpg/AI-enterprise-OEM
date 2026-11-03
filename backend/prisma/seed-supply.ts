import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../generated/prisma';

const seedUsers = JSON.parse(
  readFileSync(join(__dirname, 'seed-users.json'), 'utf8'),
) as Record<string, { userId: string }>;
const uid = (name: string) => seedUsers[name].userId;

/**
 * 供销网络演示数据：服务站 / 商品(SPU·SKU·站点上下架) / 服务项目 / 费用科目 / 订货单 / 预约单。
 * 独立成模块便于「全新安装（prisma db seed）」与「本地增量补齐」两条路径复用同一份数据。
 */
export async function seedSupplyNetwork(prisma: PrismaClient) {
  const enterprise = await prisma.enterpriseProfile.findFirst({
    where: { userId: uid('demo_enterprise') },
    orderBy: { id: 'asc' },
  });
  const dual = await prisma.enterpriseProfile.findFirst({
    where: { userId: uid('demo_dual') },
    orderBy: { id: 'asc' },
  });
  if (!enterprise) return;

  await prisma.supplyOrderLog.deleteMany();
  await prisma.supplyOrderItem.deleteMany();
  await prisma.supplyOrder.deleteMany();
  await prisma.supplyBooking.deleteMany();
  await prisma.supplyProductStation.deleteMany();
  await prisma.supplySku.deleteMany();
  await prisma.supplyProduct.deleteMany();
  await prisma.supplyService.deleteMany();
  await prisma.supplyStation.deleteMany();

  const org = uid('demo_supply');
  const farmer = uid('demo_supply2');

  await prisma.supplyStation.createMany({
    data: [
      {
        providerUserId: org,
        name: '华东供销·萧山服务站',
        region: '浙江 杭州',
        address: '萧山区新街街道供销路 18 号',
        contactName: '吴桐',
        contactPhone: '13800002201',
        status: 'ACTIVE',
        remark: '农资仓储 + 飞防作业调度中心',
      },
      {
        providerUserId: org,
        name: '华东供销·北仑服务站',
        region: '浙江 宁波',
        address: '北仑区港区大道 66 号',
        contactName: '周海',
        contactPhone: '13800002202',
        status: 'ACTIVE',
        remark: '粮食烘干代储与港口集散',
      },
      {
        providerUserId: farmer,
        name: '丰收农资服务站',
        region: '浙江 杭州',
        address: '临安区青山湖街道种苗路 9 号',
        contactName: '张丰收',
        contactPhone: '13800002203',
        status: 'ACTIVE',
        remark: '山地种苗与果园托管',
      },
    ],
  });
  const stations = await prisma.supplyStation.findMany({
    where: { providerUserId: { in: [org, farmer] } },
    orderBy: { id: 'asc' },
  });
  const stationOf = (name: string) =>
    stations.find((item) => item.name.includes(name))!;
  const sXiaoshan = stationOf('萧山');
  const sBeilun = stationOf('北仑');
  const sFengshou = stationOf('丰收');

  const marketing = (title: string, summary: string, content: string) => ({
    marketingTitle: title,
    marketingSummary: summary,
    marketingContent: content,
    aiworkinSyncStatus: 'SKIPPED' as const,
    aiworkinSyncNote:
      'AIworkin 通道未启用（AIWORKIN_ENABLED=false），独立站展示待接通后同步',
  });

  await prisma.supplyProduct.create({
    data: {
      providerUserId: org,
      name: '有机复合肥（缓释型）',
      category: '农资',
      basePrice: 168,
      unit: '袋',
      attrs: [
        { name: '品牌', value: '禾丰' },
        { name: '肥效', value: '缓释型' },
        { name: '适用作物', value: '水稻 / 蔬菜' },
      ],
      status: 'ONLINE',
      featured: true,
      ...marketing(
        '禾丰有机复合肥 · 缓释型',
        '有机质含量 45%，缓释控氮，适合水稻与设施蔬菜底肥，萧山站当日提货。',
        '华东供销自营农资：与禾丰合作定制缓释复合肥，有机质含量 45%、氮磷钾配比 15-5-10。萧山服务站常年库存 800 吨，支持批量订货与田间配送。',
      ),
    },
  });
  await prisma.supplyProduct.create({
    data: {
      providerUserId: org,
      name: '农用 PO 防草地膜',
      category: '农资',
      basePrice: 320,
      unit: '卷',
      attrs: [
        { name: '材质', value: 'PO 树脂' },
        { name: '颜色', value: '黑白双色' },
      ],
      status: 'ONLINE',
      ...marketing(
        'PO 防草地膜 · 黑白双色',
        'PO 树脂基材，耐候期 12 个月，抑草率 90%+，适配水稻直播与蔬菜覆膜。',
        '农用 PO 防草地膜：0.012mm 厚度、耐候期 12 个月，黑白双色可选，批发价含站点自提，宁波北仑站支持冷链外发。',
      ),
    },
  });
  await prisma.supplyProduct.create({
    data: {
      providerUserId: org,
      name: '智能灌溉控制器',
      category: '农机具',
      basePrice: 1280,
      unit: '台',
      attrs: [
        { name: '通道数', value: '1 / 2 通道可选' },
        { name: '联网', value: '4G' },
      ],
      status: 'ONLINE',
      ...marketing(
        '4G 智能灌溉控制器',
        '手机远程控制电磁阀，支持土壤湿度联动与定时灌溉，双通道可选。',
        '4G 智能灌溉控制器：支持定时灌溉、土壤湿度联动与手机远程控制，单/双通道两种规格，含站点安装指导。',
      ),
    },
  });
  await prisma.supplyProduct.create({
    data: {
      providerUserId: farmer,
      name: '山核桃嫁接苗木',
      category: '苗木',
      basePrice: 26,
      unit: '株',
      attrs: [
        { name: '砧木', value: '本砧嫁接' },
        { name: '苗龄', value: '2 年生' },
      ],
      status: 'ONLINE',
      featured: true,
      ...marketing(
        '临安山核桃 · 2 年嫁接苗',
        '临安本地薄壳山核桃嫁接苗，成活率 92%+，含山地种植技术指导。',
        '临安山核桃 2 年生嫁接苗，苗高 80cm 以上、地径 1.2cm 以上，成活率 92%+，张丰收本人提供上山种植指导。',
      ),
    },
  });
  const products = await prisma.supplyProduct.findMany({
    where: { providerUserId: { in: [org, farmer] } },
    orderBy: { id: 'asc' },
  });
  const productOf = (name: string) =>
    products.find((item) => item.name.includes(name))!;
  const pFertilizer = productOf('复合肥');
  const pFilm = productOf('地膜');
  const pIrrigation = productOf('灌溉控制器');
  const pSapling = productOf('山核桃');

  await prisma.supplyProductStation.createMany({
    data: [
      { productId: pFertilizer.id, stationId: sXiaoshan.id, status: 'ONLINE' },
      { productId: pFertilizer.id, stationId: sBeilun.id, status: 'ONLINE' },
      { productId: pFilm.id, stationId: sXiaoshan.id, status: 'ONLINE' },
      { productId: pIrrigation.id, stationId: sBeilun.id, status: 'ONLINE' },
      { productId: pSapling.id, stationId: sFengshou.id, status: 'ONLINE' },
    ],
  });

  await prisma.supplySku.createMany({
    data: [
      {
        productId: pFertilizer.id,
        specName: '40kg 标准装',
        supplyPrice: 168,
        unit: '袋',
        scene: '大田底肥',
      },
      {
        productId: pFertilizer.id,
        specName: '25kg 经济装',
        supplyPrice: 108,
        unit: '袋',
        scene: '设施蔬菜追肥',
      },
      {
        productId: pFilm.id,
        specName: '1.2m × 500m',
        supplyPrice: 320,
        unit: '卷',
        scene: '蔬菜覆膜',
      },
      {
        productId: pFilm.id,
        specName: '1.5m × 500m',
        supplyPrice: 385,
        unit: '卷',
        scene: '水稻直播覆膜',
      },
      {
        productId: pIrrigation.id,
        specName: '单通道',
        supplyPrice: 1280,
        unit: '台',
        scene: '小地块灌溉',
      },
      {
        productId: pIrrigation.id,
        specName: '双通道',
        supplyPrice: 1980,
        unit: '台',
        scene: '连片果园分区灌溉',
      },
      {
        productId: pSapling.id,
        specName: '2 年生嫁接苗',
        supplyPrice: 26,
        unit: '株',
        scene: '山地新建果园',
      },
    ],
  });
  const skus = await prisma.supplySku.findMany({ orderBy: { id: 'asc' } });
  const skuOf = (spec: string) => skus.find((item) => item.specName === spec)!;

  await prisma.supplyService.createMany({
    data: [
      {
        providerUserId: org,
        stationId: sXiaoshan.id,
        name: '农田飞防植保作业',
        priceUnit: '亩',
        basePrice: 12,
        intro:
          '大疆 T50 植保无人机连片作业，含药剂配比与作业记录回传；连片 200 亩以上享阶梯价。',
        scene: '水稻 / 小麦 / 果园病虫害防治',
        status: 'ONLINE',
        ...marketing(
          '农田飞防植保作业 · 连片 200 亩起',
          '植保无人机连片作业，12 元/亩起，含药剂配比与作业记录回传。',
          '华东供销飞防队：大疆 T50 植保无人机 6 架，日作业能力 3000 亩，支持水稻、小麦与果园病虫害防治，作业记录可溯源。',
        ),
      },
      {
        providerUserId: org,
        stationId: sBeilun.id,
        name: '稻谷烘干代储服务',
        priceUnit: '吨',
        basePrice: 80,
        intro:
          '北仑站 30 吨循环式烘干机 + 恒温仓储，含水率降至 14% 以内，支持代储 60 天。',
        scene: '稻谷收获期烘干与短期代储',
        status: 'ONLINE',
        ...marketing(
          '稻谷烘干代储 · 北仑站',
          '30 吨循环式烘干机，含水率降至 14% 以内，代储 60 天免费。',
          '北仑服务站粮食烘干代储：循环式烘干机日处理 30 吨，含水率降至 14% 以内，配套恒温仓储可代储 60 天，支持粮食收购企业批量预约。',
        ),
      },
      {
        providerUserId: farmer,
        stationId: sFengshou.id,
        name: '果园修剪托管',
        priceUnit: '亩',
        basePrice: 260,
        intro:
          '山核桃/香榧果园冬季修剪 + 施肥 + 病虫害托管，按亩计价，季节性排期紧张请提前预约。',
        scene: '山地果园年度托管',
        status: 'ONLINE',
        ...marketing(
          '山地果园修剪托管 · 260 元/亩',
          '山核桃/香榧果园冬季修剪、施肥与病虫害一站式托管。',
          '丰收农资山地果园托管：冬季修剪 + 施肥 + 病虫害防治一站式服务，按亩计价 260 元，季节性排期紧张，建议提前 15 天预约。',
        ),
      },
    ],
  });

  const day = '20260918';
  const no = (prefix: string, seq: number) =>
    `${prefix}${day}-${String(seq).padStart(4, '0')}`;

  const orderSeeds: Array<{
    seq: number;
    status: string;
    staffUserId: string;
    items: Array<{
      productId: number;
      skuId: number;
      productName: string;
      specName: string;
      unit: string;
      price: number;
      quantity: number;
      stockState?: string;
      shortageNote?: string;
      restockCycle?: string;
    }>;
    remark: string;
    promisedShipDate?: string;
    quoteNote?: string;
    otherFees?: Array<{ name: string; amount: number; note: string }>;
    confirmNote?: string;
  }> = [
    {
      seq: 1,
      status: 'SUBMITTED',
      staffUserId: '',
      remark: '秋季底肥备货，请按站内库存报一口价',
      items: [
        {
          productId: pFertilizer.id,
          skuId: skuOf('40kg 标准装').id,
          productName: pFertilizer.name,
          specName: '40kg 标准装',
          unit: '袋',
          price: 168,
          quantity: 120,
        },
        {
          productId: pFilm.id,
          skuId: skuOf('1.2m × 500m').id,
          productName: pFilm.name,
          specName: '1.2m × 500m',
          unit: '卷',
          price: 320,
          quantity: 40,
        },
      ],
    },
    {
      seq: 2,
      status: 'QUOTED',
      staffUserId: uid('demo_staff3'),
      remark: '灌溉控制器需在北仑站提货，双通道优先',
      promisedShipDate: '2026-09-25',
      quoteNote:
        '复合肥 40kg 标准装现货充足；地膜 1.5m 规格缺货，已按 1.2m 同价替代并让利 200 元',
      otherFees: [
        { name: '运费', amount: 680, note: '萧山站至余杭基地 42km' },
        { name: '上山运输费', amount: 260, note: '山地二次转运' },
        { name: '优惠减免', amount: -200, note: '规格替代让利' },
      ],
      items: [
        {
          productId: pFertilizer.id,
          skuId: skuOf('40kg 标准装').id,
          productName: pFertilizer.name,
          specName: '40kg 标准装',
          unit: '袋',
          price: 165,
          quantity: 200,
        },
        {
          productId: pFilm.id,
          skuId: skuOf('1.5m × 500m').id,
          productName: pFilm.name,
          specName: '1.5m × 500m',
          unit: '卷',
          price: 385,
          quantity: 30,
          stockState: 'PARTIAL',
          shortageNote: '产线换季，1.5m 规格仅余 12 卷',
          restockCycle: '补货周期 10 天（10 月中旬到货）',
        },
      ],
    },
    {
      seq: 3,
      status: 'ACTIVE',
      staffUserId: uid('demo_staff3'),
      remark: '飞防作业配套灌溉改造',
      promisedShipDate: '2026-09-16',
      quoteNote: '双通道现货 6 台，含站点安装指导',
      confirmNote: '确认报价，按承诺日期发运',
      otherFees: [{ name: '运费', amount: 180, note: '北仑站至余杭基地' }],
      items: [
        {
          productId: pIrrigation.id,
          skuId: skuOf('双通道').id,
          productName: pIrrigation.name,
          specName: '双通道',
          unit: '台',
          price: 1950,
          quantity: 4,
        },
      ],
    },
    {
      seq: 4,
      status: 'DRAFT',
      staffUserId: '',
      remark: '待确认地块面积后再提交',
      items: [
        {
          productId: pFertilizer.id,
          skuId: skuOf('25kg 经济装').id,
          productName: pFertilizer.name,
          specName: '25kg 经济装',
          unit: '袋',
          price: 108,
          quantity: 60,
        },
      ],
    },
    {
      seq: 5,
      status: 'VETOED',
      staffUserId: uid('demo_staff3'),
      remark: '临时调整种植计划',
      quoteNote: '按 40kg 标准装 168 元/袋报价，5 日内发运',
      confirmNote: '本季种植计划调整，本次订货不再执行',
      items: [
        {
          productId: pFertilizer.id,
          skuId: skuOf('40kg 标准装').id,
          productName: pFertilizer.name,
          specName: '40kg 标准装',
          unit: '袋',
          price: 168,
          quantity: 80,
        },
      ],
    },
  ];

  for (const seed of orderSeeds) {
    const productAmount = seed.items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    const feeAmount = (seed.otherFees || []).reduce(
      (acc, item) => acc + item.amount,
      0,
    );
    const quoted = seed.status === 'QUOTED' || seed.status === 'ACTIVE';
    const order = await prisma.supplyOrder.create({
      data: {
        orderNo: no('DH', seed.seq),
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        createdBy: uid('demo_enterprise'),
        providerUserId: org,
        staffUserId: seed.staffUserId,
        stationId: sXiaoshan.id,
        stationName: sXiaoshan.name,
        expectedDate: '2026-09-28',
        remark: seed.remark,
        status: seed.status,
        revision: seed.status === 'VETOED' ? 2 : 1,
        quotedAt: quoted ? new Date('2026-09-19T02:00:00Z') : null,
        promisedShipDate: seed.promisedShipDate || '',
        quoteNote: seed.quoteNote || '',
        productAmount,
        otherFees: seed.otherFees || [],
        feeAmount,
        totalAmount: productAmount + feeAmount,
        confirmNote: seed.confirmNote || '',
        confirmedAt:
          seed.status === 'ACTIVE' ? new Date('2026-09-20T03:00:00Z') : null,
      },
    });
    await prisma.supplyOrderItem.createMany({
      data: seed.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        skuId: item.skuId,
        productName: item.productName,
        specName: item.specName,
        unit: item.unit,
        price: item.price,
        quantity: item.quantity,
        amount: item.price * item.quantity,
        stockState: item.stockState || 'SUFFICIENT',
        shortageNote: item.shortageNote || '',
        restockCycle: item.restockCycle || '',
      })),
    });
    await prisma.supplyOrderLog.createMany({
      data: [
        {
          bizType: 'ORDER',
          bizId: order.id,
          action: seed.status === 'DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT',
          operatorUserId: uid('demo_enterprise'),
          operatorName: '杭州智造',
          detail: `${order.orderNo} · ${seed.items.length} 条明细`,
        },
        ...(quoted
          ? [
              {
                bizType: 'ORDER',
                bizId: order.id,
                action: 'QUOTE',
                operatorUserId: seed.staffUserId || org,
                operatorName: seed.staffUserId ? '吴桐' : '华东供销服务社',
                detail: `${order.orderNo} · 报价 ${(productAmount + feeAmount).toFixed(2)} 元（承诺发货 ${seed.promisedShipDate || '—'}）`,
              },
            ]
          : []),
        ...(seed.status === 'ACTIVE'
          ? [
              {
                bizType: 'ORDER',
                bizId: order.id,
                action: 'CONFIRM',
                operatorUserId: uid('demo_enterprise'),
                operatorName: '杭州智造',
                detail: `${order.orderNo} · 订单生效`,
              },
            ]
          : []),
        ...(seed.status === 'VETOED'
          ? [
              {
                bizType: 'ORDER',
                bizId: order.id,
                action: 'VETO',
                operatorUserId: uid('demo_enterprise'),
                operatorName: '杭州智造',
                detail: `${order.orderNo} · ${seed.confirmNote || '已否决'}`,
              },
            ]
          : []),
      ],
    });
  }

  const services = await prisma.supplyService.findMany({
    orderBy: { id: 'asc' },
  });
  const svcOf = (name: string) =>
    services.find((item) => item.name.includes(name))!;
  const svcFly = svcOf('飞防');
  const svcDry = svcOf('烘干');

  const bookingSeeds: Array<{
    seq: number;
    service: typeof svcFly;
    stationName: string;
    status: string;
    staffUserId: string;
    planDate: string;
    siteAddress: string;
    scale: string;
    remark: string;
    basePrice: number;
    otherFees?: Array<{ name: string; amount: number; note: string }>;
    quoteNote?: string;
    confirmNote?: string;
  }> = [
    {
      seq: 1,
      service: svcFly,
      stationName: sXiaoshan.name,
      status: 'SUBMITTED',
      staffUserId: '',
      planDate: '2026-09-27',
      siteAddress: '余杭区瓶窑镇南山村 3 组稻田',
      scale: '320 亩（连片）',
      remark: '稻飞虱防治，请带足药剂',
      basePrice: 12,
    },
    {
      seq: 2,
      service: svcFly,
      stationName: sXiaoshan.name,
      status: 'QUOTED',
      staffUserId: uid('demo_staff3'),
      planDate: '2026-09-29',
      siteAddress: '临安区青山湖街道果园片区',
      scale: '180 亩（山地）',
      remark: '果园红蜘蛛防治，需要傍晚作业',
      basePrice: 15,
      otherFees: [
        { name: '加急费', amount: 600, note: '农时窗口加急排期' },
        { name: '上山运输费', amount: 300, note: '山地转场' },
      ],
      quoteNote: '山地作业单价上浮至 15 元/亩，安排 9/29 傍晚两架次',
    },
    {
      seq: 3,
      service: svcDry,
      stationName: sBeilun.name,
      status: 'ACTIVE',
      staffUserId: uid('demo_staff3'),
      planDate: '2026-09-15',
      siteAddress: '北仑区春晓街道粮站',
      scale: '86 吨',
      remark: '含水率 22%，需降至 14% 以内',
      basePrice: 80,
      quoteNote: '烘干 80 元/吨，代储 60 天内免费',
      confirmNote: '确认报价，9/15 上午送粮',
    },
  ];

  for (const seed of bookingSeeds) {
    const baseAmount =
      seed.basePrice * Number(seed.scale.match(/\d+/)?.[0] || 0);
    const feeAmount = (seed.otherFees || []).reduce(
      (acc, item) => acc + item.amount,
      0,
    );
    const quoted = seed.status === 'QUOTED' || seed.status === 'ACTIVE';
    const booking = await prisma.supplyBooking.create({
      data: {
        bookingNo: no('YY', seed.seq),
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        createdBy: uid('demo_enterprise'),
        providerUserId: seed.service.providerUserId,
        staffUserId: seed.staffUserId,
        stationId: seed.service.stationId,
        stationName: seed.stationName,
        serviceId: seed.service.id,
        serviceName: seed.service.name,
        priceUnit: seed.service.priceUnit,
        planDate: seed.planDate,
        siteAddress: seed.siteAddress,
        scale: seed.scale,
        remark: seed.remark,
        status: seed.status,
        revision: 1,
        quotedAt: quoted ? new Date('2026-09-13T01:00:00Z') : null,
        baseAmount,
        otherFees: seed.otherFees || [],
        feeAmount,
        totalAmount: baseAmount + feeAmount,
        quoteNote: seed.quoteNote || '',
        confirmNote: seed.confirmNote || '',
        confirmedAt:
          seed.status === 'ACTIVE' ? new Date('2026-09-13T05:00:00Z') : null,
      },
    });
    await prisma.supplyOrderLog.createMany({
      data: [
        {
          bizType: 'BOOKING',
          bizId: booking.id,
          action: 'SUBMIT',
          operatorUserId: uid('demo_enterprise'),
          operatorName: '杭州智造',
          detail: `${booking.bookingNo} · ${seed.service.name}（${seed.scale}）`,
        },
        ...(quoted
          ? [
              {
                bizType: 'BOOKING',
                bizId: booking.id,
                action: 'QUOTE',
                operatorUserId: seed.staffUserId || seed.service.providerUserId,
                operatorName: seed.staffUserId ? '吴桐' : '华东供销服务社',
                detail: `${booking.bookingNo} · 报价 ${(baseAmount + feeAmount).toFixed(2)} 元`,
              },
            ]
          : []),
        ...(seed.status === 'ACTIVE'
          ? [
              {
                bizType: 'BOOKING',
                bizId: booking.id,
                action: 'CONFIRM',
                operatorUserId: uid('demo_enterprise'),
                operatorName: '杭州智造',
                detail: `${booking.bookingNo} · 预约生效`,
              },
            ]
          : []),
      ],
    });
  }

  // 双身份演示企业：与个人小微服务商的供销签约（待服务商确认）
  if (dual) {
    const existing = await prisma.contract.findFirst({
      where: {
        enterpriseId: dual.id,
        providerUserId: farmer,
        serviceType: 'SUPPLY_NETWORK',
      },
    });
    if (!existing) {
      await prisma.contract.create({
        data: {
          contractNo: `HT${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-9001`,
          providerUserId: farmer,
          providerOrg: '张丰收',
          enterpriseId: dual.id,
          enterpriseName: dual.name,
          serviceType: 'SUPPLY_NETWORK',
          status: 'PENDING',
          startDate: '2026-09-18',
        },
      });
    }
  }
}
