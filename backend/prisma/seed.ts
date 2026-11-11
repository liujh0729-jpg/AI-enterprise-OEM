import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../generated/prisma';
import { seedSupplyNetwork } from './seed-supply';
import { seedCreativeCommunity } from './seed-creative-community';
import { seedServicePackages } from './seed-service-packages';

const prisma = new PrismaClient();
const seedUsers = JSON.parse(
  readFileSync(join(__dirname, 'seed-users.json'), 'utf8'),
) as Record<string, { userId: string }>;
const uid = (name: string) => seedUsers[name].userId;

async function main() {
  await prisma.systemSetting.upsert({
    where: { key: 'oss_base_url' },
    create: { key: 'oss_base_url', value: 'https://oss.demo.local' },
    update: { value: 'https://oss.demo.local' },
  });

  await prisma.enterpriseProfile.deleteMany();
  await prisma.enterpriseProfile.createMany({
    data: [
      {
        userId: uid('demo_enterprise'),
        name: '杭州智造科技有限公司',
        uscc: '91330100MA2XXXXX01',
        taxpayerType: 'GENERAL',
        industry: '智能制造',
        legalPerson: '张明',
        phone: '0571-88880001',
        address: '杭州市余杭区',
        // 所在省、市：申请时必选（名录按省市筛选），信用代码 330100 与地址都在杭州
        province: '浙江省',
        city: '杭州市',
        status: 'APPROVED',
      },
      {
        userId: uid('demo_dual'),
        name: '双身份演示企业',
        uscc: '91330100MA2DUAL001',
        taxpayerType: 'SMALL',
        province: '浙江省',
        city: '杭州市',
        status: 'APPROVED',
      },
    ],
  });

  const enterprise = await prisma.enterpriseProfile.findFirstOrThrow({
    where: { userId: uid('demo_enterprise') },
  });

  await prisma.providerApplication.deleteMany();
  const providerSeeds: Array<{
    user: keyof typeof seedUsers;
    type: string;
    org: string;
    items?: string;
    subject?: 'COMPANY' | 'PERSONAL';
    idCard?: string;
    province?: string;
    city?: string;
    staff?: { name: string; title: string; phone: string; email: string }[];
  }> = [
    {
      user: 'demo_provider',
      type: 'TAX_FINANCE',
      org: '中瑞财税',
      staff: [
        {
          name: '陈丽华',
          title: '主管会计',
          phone: '13800001111',
          email: 'chen@zr.local',
        },
      ],
    },
    {
      user: 'demo_provider',
      type: 'EXPORT_REFUND',
      org: '中瑞财税',
      items: 'EXPORT_REFUND,SETTLEMENT',
    },
    {
      user: 'demo_tax2',
      type: 'TAX_FINANCE',
      org: '上海申税通',
      province: '上海市',
      city: '上海市',
    },
    {
      user: 'demo_tax3',
      type: 'TAX_FINANCE',
      org: '深圳华算',
      province: '广东省',
      city: '深圳市',
    },
    {
      user: 'demo_tax4',
      type: 'TAX_FINANCE',
      org: '北京恒信',
      province: '北京市',
      city: '北京市',
    },
    {
      user: 'demo_overseas2',
      type: 'EXPORT_REFUND',
      org: '上海桥联',
      province: '上海市',
      city: '上海市',
      items: 'COMPANY_REG,SETTLEMENT,BANK_ACCOUNT,QUALIFICATION',
    },
    {
      user: 'demo_overseas3',
      type: 'EXPORT_REFUND',
      org: '深圳湾区',
      province: '广东省',
      city: '深圳市',
      items: 'EXPORT_REFUND,TAX_COMPLIANCE,SETTLEMENT',
    },
    // 物流细项（境内陆运 / 跨境货代）与资产细项都要落 code：承载行没细项就不出现在任何分区
    {
      user: 'demo_logistics',
      type: 'MICRO',
      org: '环球联运',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    {
      user: 'demo_logistics2',
      type: 'MICRO',
      org: '宁波远洋',
      province: '浙江省',
      city: '宁波市',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    {
      user: 'demo_logistics3',
      type: 'MICRO',
      org: '飞驰物流',
      subject: 'PERSONAL',
      idCard: '330106199001011234',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    { user: 'demo_legal', type: 'LEGAL_SERVICE', org: '秉正法律' },
    { user: 'demo_legal2', type: 'LEGAL_SERVICE', org: '浙江六和律师事务所' },
    {
      user: 'demo_legal3',
      type: 'LEGAL_SERVICE',
      org: '深圳恒法',
      province: '广东省',
      city: '深圳市',
    },
    { user: 'demo_ip', type: 'IP_SERVICE', org: '杭州知产汇' },
    { user: 'demo_flex', type: 'FLEX_WORK', org: '杭州聚力人力资源' },
    {
      user: 'demo_flex2',
      type: 'FLEX_WORK',
      org: '上海优才',
      province: '上海市',
      city: '上海市',
    },
    { user: 'demo_flex3', type: 'FLEX_WORK', org: '杭州众鑫劳务派遣' },
    {
      user: 'demo_agent',
      type: 'FLEX_WORK',
      org: '顾晓雨',
      subject: 'PERSONAL',
      idCard: '330102198801018888',
    },
    {
      user: 'demo_agent',
      type: 'MICRO',
      org: '顾晓雨',
      subject: 'PERSONAL',
      idCard: '330102198801018888',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    { user: 'demo_supply', type: 'SUPPLY_NETWORK', org: '华东供销服务社' },
    {
      user: 'demo_supply2',
      type: 'MICRO',
      org: '张丰收',
      subject: 'PERSONAL',
      idCard: '330185199203055617',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    {
      user: 'demo_asset',
      type: 'ASSET_TRADE',
      org: '甬城资产',
      province: '浙江省',
      city: '宁波市',
      items: 'REAL_ESTATE,INSURANCE,INVESTMENT,NON_PERFORMING_ASSET,AUTO_TRADE',
    },
    {
      user: 'demo_marketing',
      type: 'MARKETING',
      org: '星链传媒',
      items: 'INFLUENCER_VISIT,LIVE_SELLING,CONTENT_MARKETING',
    },
    {
      user: 'demo_marketing2',
      type: 'MARKETING',
      org: '云播 MCN',
      items: 'LIVE_SELLING',
    },
    // IT服务五细项（AI实施/软件开发/算力/硬件/数据）：承载行必须写细项 code，否则不出现在任何名录分区
    {
      user: 'demo_dual',
      type: 'SMART_SERVICE',
      org: '双身份服务商',
      items: 'AI_DEPLOY,SOFTWARE_DEV,COMPUTE',
    },
    // 全类目演示服务商：九个业务类目全部 APPROVED（出海 / 营销各 6 细项、物流 3 细项、资产 5 细项、IT服务 5 细项），用于一次登录测遍所有类目
    { user: 'demo_all', type: 'TAX_FINANCE', org: '万象综合服务' },
    {
      user: 'demo_all',
      type: 'LOGISTICS',
      org: '万象综合服务',
      items: 'DOMESTIC_LAND,CROSS_BORDER_FORWARDER,WAREHOUSING',
    },
    { user: 'demo_all', type: 'LEGAL_SERVICE', org: '万象综合服务' },
    { user: 'demo_all', type: 'IP_SERVICE', org: '万象综合服务' },
    { user: 'demo_all', type: 'FLEX_WORK', org: '万象综合服务' },
    {
      user: 'demo_all',
      type: 'MARKETING',
      org: '万象综合服务',
      items:
        'INFLUENCER_VISIT,LIVE_SELLING,CONTENT_MARKETING,GEO_OPTIMIZATION,PRECISION_MARKETING,PRIVATE_DOMAIN',
    },
    { user: 'demo_all', type: 'SUPPLY_NETWORK', org: '万象综合服务' },
    {
      user: 'demo_all',
      type: 'ASSET_TRADE',
      org: '万象综合服务',
      items: 'REAL_ESTATE,INSURANCE,INVESTMENT,NON_PERFORMING_ASSET,AUTO_TRADE',
    },
    {
      user: 'demo_all',
      type: 'SMART_SERVICE',
      org: '万象综合服务',
      items: 'AI_DEPLOY,SOFTWARE_DEV,COMPUTE,HARDWARE,DATA_SERVICE',
    },
    {
      user: 'demo_all',
      type: 'EXPORT_REFUND',
      org: '万象综合服务',
      items:
        'EXPORT_REFUND,COMPANY_REG,SETTLEMENT,TAX_COMPLIANCE,QUALIFICATION,BANK_ACCOUNT',
    },
    { user: 'demo_dual', type: 'TAX_FINANCE', org: '双身份服务商' },
  ];
  await prisma.providerApplication.createMany({
    data: providerSeeds.map((item) => ({
      userId: uid(item.user),
      providerType: item.type,
      orgName: item.org,
      uscc: item.subject === 'PERSONAL' ? '' : '91330000MA00000000',
      contactName: item.org,
      contactPhone: '13800000000',
      contactEmail: `${item.user}@demo.local`,
      intro: `${item.org} 演示服务商`,
      // 所在省、市备案时必选；演示数据统一落在浙江杭州（信用代码 9133 / 身份证 3301 前缀一致），
      // 机构名里带城市的（上海/深圳/北京/宁波）逐行覆写
      province: item.province || '浙江省',
      city: item.city || '杭州市',
      status: 'APPROVED',
      serviceItems: item.items || '',
      subjectType: item.subject || 'COMPANY',
      idCard: item.idCard || '',
      businessStaff: item.staff || [],
    })),
  });

  await prisma.staffProfile.deleteMany();
  // 职员/代理人的省市取其绑定服务商所在地（服务商按地域派单、企业按省市查找职员）
  await prisma.staffProfile.createMany({
    data: [
      {
        userId: uid('demo_staff'),
        realName: '李芳',
        phone: '13900000001',
        categories: ['TAX_FINANCE', 'FLEX_WORK'],
        province: '浙江省',
        city: '杭州市',
        intro: '财税与灵工',
      },
      {
        userId: uid('demo_staff2'),
        realName: '周凯',
        phone: '13900000002',
        categories: ['TAX_FINANCE', 'LEGAL_SERVICE'],
        province: '浙江省',
        city: '杭州市',
        intro: '财税专员',
      },
      {
        userId: uid('demo_staff4'),
        realName: '赵倩',
        phone: '13900000004',
        categories: ['LEGAL_SERVICE'],
        province: '浙江省',
        city: '杭州市',
        intro: '法律顾问',
      },
      {
        userId: uid('demo_staff5'),
        realName: '王建国',
        phone: '13900000005',
        categories: ['LEGAL_SERVICE'],
        province: '浙江省',
        city: '杭州市',
        intro: '六和律师',
      },
      {
        userId: uid('demo_staff6'),
        realName: '陈正涛',
        phone: '13900000006',
        categories: ['LEGAL_SERVICE'],
        province: '广东省',
        city: '深圳市',
        intro: '恒法律师',
      },
      {
        userId: uid('demo_staff7'),
        realName: '李敏',
        phone: '13900000007',
        categories: ['LEGAL_SERVICE'],
        province: '浙江省',
        city: '杭州市',
        intro: '秉正律师',
      },
      {
        userId: uid('demo_staff3'),
        realName: '吴桐',
        phone: '13900000003',
        categories: ['SUPPLY_NETWORK'],
        province: '浙江省',
        city: '杭州市',
        intro: '供销专员：农资供销与飞防作业调度',
      },
      {
        userId: uid('demo_staff_all'),
        realName: '许静',
        phone: '13900000008',
        categories: [
          'TAX_FINANCE',
          'EXPORT_REFUND',
          'LOGISTICS',
          'LEGAL_SERVICE',
          'IP_SERVICE',
          'FLEX_WORK',
          'SUPPLY_NETWORK',
        ],
        province: '浙江省',
        city: '杭州市',
        intro: '全类目承办演示：已与「万象综合服务」绑定生效',
      },
    ],
  });

  await prisma.providerStaff.deleteMany();
  await prisma.providerStaff.createMany({
    data: [
      {
        providerUserId: uid('demo_provider'),
        staffUserId: uid('demo_staff'),
        roles: ['财税专员'],
      },
      {
        providerUserId: uid('demo_legal'),
        staffUserId: uid('demo_staff'),
        roles: ['法律顾问'],
      },
      {
        providerUserId: uid('demo_provider'),
        staffUserId: uid('demo_staff2'),
        roles: ['财税专员'],
      },
      {
        providerUserId: uid('demo_legal'),
        staffUserId: uid('demo_staff4'),
        roles: ['法律顾问'],
      },
      {
        providerUserId: uid('demo_legal2'),
        staffUserId: uid('demo_staff5'),
        roles: ['法律顾问'],
      },
      {
        providerUserId: uid('demo_legal3'),
        staffUserId: uid('demo_staff6'),
        roles: ['法律顾问'],
      },
      {
        providerUserId: uid('demo_legal'),
        staffUserId: uid('demo_staff7'),
        roles: ['法律顾问'],
      },
      {
        providerUserId: uid('demo_supply'),
        staffUserId: uid('demo_staff3'),
        roles: ['供销专员'],
      },
      // 「万象综合服务」全类目职员：绑定已生效（ACTIVE），角色＝该服务商全部已备案类目对应角色
      {
        providerUserId: uid('demo_all'),
        staffUserId: uid('demo_staff_all'),
        roles: [
          '财税专员',
          '出口退税专员',
          '海外公司注册专员',
          '跨境结算专员',
          '海外税务合规专员',
          '出口资质备案专员',
          '海外银行开户专员',
          '法律顾问',
          '知识产权专员',
          '灵活用工专员',
          '供销专员',
        ],
        status: 'ACTIVE',
      },
    ],
  });

  await prisma.staffApplication.deleteMany();
  await prisma.staffApplication.create({
    data: {
      staffUserId: uid('demo_staff'),
      providerUserId: uid('demo_flex'),
      category: 'FLEX_WORK',
      status: 'PENDING',
    },
  });

  await prisma.contract.deleteMany();
  await prisma.contract.createMany({
    data: [
      {
        contractNo: 'HT20260101-0001',
        providerUserId: uid('demo_provider'),
        providerOrg: '中瑞财税',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'TAX_FINANCE',
        status: 'ACTIVE',
        startDate: '2026-01-01',
        // 对接人只能是该服务商「职员/代理人管理」里已绑定生效的职员（财税→财税专员），
        // 不读备案名录里的业务人员；演示申报由已绑定的周凯承办。
        designatedStaff: {
          name: '周凯',
          title: '财税专员',
          phone: '13900000002',
          email: '',
        },
      },
      {
        contractNo: 'HT20260101-0002',
        providerUserId: uid('demo_provider'),
        providerOrg: '中瑞财税',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'EXPORT_REFUND',
        status: 'ACTIVE',
        startDate: '2026-01-01',
      },
      {
        contractNo: 'HT20260101-0003',
        providerUserId: uid('demo_legal'),
        providerOrg: '秉正法律',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'LEGAL_SERVICE',
        status: 'ACTIVE',
        startDate: '2026-01-01',
        designatedAgentId: 0,
        designatedAgentName: '李敏',
      },
      {
        contractNo: 'HT20260101-0004',
        providerUserId: uid('demo_ip'),
        providerOrg: '杭州知产汇',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'IP_SERVICE',
        status: 'ACTIVE',
        startDate: '2026-01-01',
      },
      {
        contractNo: 'HT20260101-0005',
        providerUserId: uid('demo_agent'),
        providerOrg: '顾晓雨',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'FLEX_WORK',
        status: 'ACTIVE',
        startDate: '2026-01-01',
        designatedAgentName: '顾晓雨',
      },
      {
        contractNo: 'HT20260101-0006',
        providerUserId: uid('demo_logistics'),
        providerOrg: '环球联运',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'LOGISTICS',
        status: 'PENDING',
      },
      {
        contractNo: 'HT20260101-0007',
        providerUserId: uid('demo_supply'),
        providerOrg: '华东供销服务社',
        enterpriseId: enterprise.id,
        enterpriseName: enterprise.name,
        serviceType: 'SUPPLY_NETWORK',
        status: 'ACTIVE',
        startDate: '2026-09-01',
      },
    ],
  });

  // 申报、开票及出海操作需要企业分配记录；只填签约对接人不足以授予承办权限。
  await prisma.providerAssignment.upsert({
    where: {
      providerUserId_enterpriseId: {
        providerUserId: uid('demo_provider'),
        enterpriseId: enterprise.id,
      },
    },
    create: {
      providerUserId: uid('demo_provider'),
      enterpriseId: enterprise.id,
      staffUserId: uid('demo_staff2'),
    },
    update: { staffUserId: uid('demo_staff2') },
  });

  const caseItem = (title: string) => [{ title, result: '已办结' }];

  await prisma.lawyerResource.deleteMany();
  await prisma.lawyerResource.createMany({
    data: [
      {
        kind: 'LAW_FIRM',
        name: '浙江六和律师事务所',
        organization: '浙江六和律师事务所',
        province: '浙江省',
        city: '杭州市',
        areas: ['企业法务', '股权投融资', '出海合规'],
        licenseNo: '3310100******',
        intro:
          '综合性律所，执业律师 200+，企业法律顾问、投融资与跨境业务团队成熟。',
        cases: caseItem('为 30+ 制造企业提供常年法律顾问与股权架构设计'),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal2'),
      },
      {
        kind: 'LAW_FIRM',
        name: '深圳恒法',
        organization: '深圳恒法',
        province: '广东省',
        city: '深圳市',
        areas: ['出海合规', '知识产权'],
        licenseNo: '3310100******',
        intro: '专注出海合规与知识产权布局，服务大湾区外贸企业。',
        cases: caseItem('协助 10+ 企业完成出口目的国合规尽调'),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal3'),
      },
      {
        kind: 'LAW_FIRM',
        name: '秉正法律',
        organization: '秉正法律',
        province: '浙江省',
        city: '杭州市',
        areas: ['合同审查', '劳动用工'],
        licenseNo: '3310100******',
        intro: '企业合同审查与劳动用工风险防范团队，常年服务制造业客户。',
        cases: caseItem(
          '为制造业企业搭建劳动用工合规体系，代理劳动争议 30+ 件',
        ),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal'),
      },
      {
        kind: 'LAWYER',
        name: '王建国',
        organization: '浙江六和律师事务所',
        province: '浙江省',
        city: '杭州市',
        areas: ['合同审查', '企业法务'],
        licenseNo: '1330120******',
        intro: '专注合同审查与商务谈判，擅长中英文合同起草与风险防控。',
        cases: caseItem('为跨境电商企业审查海外销售协议 40+ 份'),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal2'),
        staffUserId: uid('demo_staff5'),
      },
      {
        kind: 'LAWYER',
        name: '陈正涛',
        organization: '深圳恒法',
        province: '广东省',
        city: '深圳市',
        areas: ['税务争议', '出海合规'],
        licenseNo: '1310120******',
        intro:
          '十五年执业经验，专注涉税争议与跨境合规，服务外贸企业 120 余家。',
        cases: caseItem('跨境电商出口退税争议代理，追回退税款 186 万元'),
        auditNote: '执业资质核验通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal3'),
        staffUserId: uid('demo_staff6'),
      },
      {
        kind: 'LAWYER',
        name: '李敏',
        organization: '秉正法律',
        province: '浙江省',
        city: '杭州市',
        areas: ['知识产权', '劳动用工'],
        licenseNo: '1330120******',
        intro: '知识产权布局维权与劳动用工合规双领域执业。',
        cases: caseItem('商标异议与劳动仲裁代理合计 60+ 件'),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_legal'),
        staffUserId: uid('demo_staff7'),
      },
    ],
  });

  await prisma.ipAgency.deleteMany();
  await prisma.ipAgency.createMany({
    data: [
      {
        kind: 'AGENCY',
        name: '杭州知产汇',
        organization: '杭州知产汇',
        province: '浙江省',
        city: '杭州市',
        fields: ['商标注册', '商标异议', '专利检索'],
        licenseNo: '专利代理机构代码：33012XXX',
        intro:
          '专注企业商标品牌保护与涉外商标布局，年均代理商标申请 2000+ 件。',
        cases: caseItem('助力某制造企业完成马德里国际商标注册 28 件'),
        auditNote: '资质核验通过',
        status: 'APPROVED',
        ownerUserId: uid('demo_ip'),
      },
      {
        kind: 'AGENT',
        name: '孙悦',
        organization: '杭州知产汇',
        province: '浙江省',
        city: '杭州市',
        fields: ['海外商标布局', '亚马逊品牌备案'],
        licenseNo: '商标代理从业人员备案：浙商代 XXXX',
        intro:
          '知产汇资深商标代理人：涉外商标布局、亚马逊品牌备案与侵权投诉应对。',
        cases: caseItem('为 30+ 跨境电商企业完成美国/欧盟商标布局与品牌备案'),
        auditNote: '执业资质核验通过',
        status: 'APPROVED',
        ownerUserId: uid('demo_ip'),
      },
    ],
  });

  await prisma.flexProvider.deleteMany();
  await prisma.flexProvider.createMany({
    data: [
      {
        recordType: 'ORG',
        kind: 'COMPANY',
        name: '杭州聚力·制造业灵活用工中心',
        organization: '杭州聚力',
        province: '浙江省',
        city: '杭州市',
        fields: ['产线临时工', '旺季用工调配', '薪酬结算', '用工风险提示'],
        licenseNo: '服务商自营团队（平台已核验）',
        intro:
          '平台核验服务商自营团队：制造业灵活用工一站式交付，覆盖招聘调配、入职管理、薪酬结算与合规风控。',
        cases: caseItem('为 40+ 制造企业完成旺季用工调配与结算'),
        auditNote: '服务商自营团队核验通过',
        status: 'APPROVED',
        providerUserId: uid('demo_flex'),
      },
      {
        recordType: 'ORG',
        kind: 'COMPANY',
        name: '上海优才',
        organization: '上海优才',
        province: '上海市',
        city: '上海市',
        fields: ['全职招聘', '中高端人才寻访', '入职背调'],
        licenseNo: '人力资源服务许可证：沪人服 XXXX',
        intro:
          '专注技术与管理岗位的猎头寻访与批量招聘，覆盖长三角制造与跨境电商行业。',
        cases: caseItem('为中高端制造企业寻访技术与管理人才 300+ 人'),
        auditNote: '资质核验通过',
        status: 'APPROVED',
        providerUserId: uid('demo_flex2'),
      },
      {
        recordType: 'ORG',
        kind: 'COMPANY',
        name: '杭州众鑫劳务派遣',
        organization: '杭州众鑫',
        province: '浙江省',
        city: '杭州市',
        fields: ['劳务派遣', '产线临时工', '社保代缴', '用工合规咨询'],
        licenseNo: '劳务派遣经营许可证：浙派 XXXX',
        intro: '制造业旺季用工一条龙：劳务派遣、社保代缴与用工风险合规咨询。',
        cases: caseItem('为制造企业年均派遣产线员工 1200+ 人次'),
        auditNote: '审核通过',
        status: 'APPROVED',
        providerUserId: uid('demo_flex3'),
      },
      {
        recordType: 'AGENT',
        kind: 'INDIVIDUAL',
        name: '顾晓雨',
        organization: '顾晓雨',
        province: '浙江省',
        city: '杭州市',
        fields: ['产线临时工', '劳务派遣', '用工合规咨询'],
        licenseNo: '人力资源服务从业资格：浙人服 XXXX',
        intro:
          '资深劳务派遣顾问：制造业旺季用工调配与用工合规方案（个人主体小微服务商，平台已核验资格）。',
        cases: caseItem('为制造企业年均调配产线临时工 800+ 人次'),
        auditNote: '资格核验通过',
        status: 'APPROVED',
        providerUserId: uid('demo_agent'),
      },
    ],
  });

  const agent = await prisma.flexProvider.findFirstOrThrow({
    where: { providerUserId: uid('demo_agent'), recordType: 'AGENT' },
  });
  await prisma.contract.updateMany({
    where: { contractNo: 'HT20260101-0005' },
    data: { designatedAgentId: agent.id, designatedAgentName: '顾晓雨' },
  });

  await prisma.logisticsOrder.deleteMany();
  await prisma.logisticsOrder.create({
    data: {
      orderNo: 'WL20260905-0001',
      enterpriseId: enterprise.id,
      createdBy: uid('demo_enterprise'),
      providerUserId: uid('demo_logistics2'),
      carrier: '宁波远洋',
      title: '跨境样品运输',
      remark: '',
      status: 'IN_TRANSIT',
      messages: [
        {
          role: 'PROVIDER',
          name: '宁波远洋',
          time: '2026-09-05 10:00:00',
          text: '报价 ¥18,500',
        },
        {
          role: 'ENTERPRISE',
          name: '杭州智造',
          time: '2026-09-05 11:00:00',
          text: '还价 ¥17,000',
        },
        {
          role: 'PROVIDER',
          name: '宁波远洋',
          time: '2026-09-05 12:00:00',
          text: '底价 ¥17,800',
        },
        {
          role: 'ENTERPRISE',
          name: '杭州智造',
          time: '2026-09-05 13:00:00',
          text: '成交',
        },
      ],
      events: [
        { time: '2026-09-05 09:00:00', status: 'PENDING', text: '已接收' },
      ],
    },
  });

  await seedSupplyNetwork(prisma);
  // 创意社区官方模板：按 code 幂等 upsert，重跑不产生重复行、不抹掉热度
  await seedCreativeCommunity(prisma);
  // 官方服务套餐：财税两条参考套餐幂等迁入目录（PG db push 路径补种，MySQL 由 0053 迁移插入）
  await seedServicePackages(prisma);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
