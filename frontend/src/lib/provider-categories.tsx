import {
  AimOutlined,
  ApiOutlined,
  BankOutlined,
  CarOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FileDoneOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HomeOutlined,
  InboxOutlined,
  LineChartOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  TruckOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { EnterpriseMe } from "./session";

/** 出海六项分区定义（名录分区与「更多」列表页共用；与 MARKETING_SUB_ITEMS 同构）。 */
export const OVERSEAS_SUB_ITEMS = [
  {
    type: "EXPORT_REFUND",
    name: "出口退税",
    icon: <DollarOutlined aria-hidden />,
    desc: "出口报关单退税、免抵退/免税办理，服务商受理送审与进度跟踪",
  },
  {
    type: "COMPANY_REG",
    name: "海外公司注册",
    icon: <BankOutlined aria-hidden />,
    desc: "香港/新加坡/美国等地公司注册、年审秘书与主体架构方案",
  },
  {
    type: "SETTLEMENT",
    name: "跨境结算",
    icon: <SwapOutlined aria-hidden />,
    desc: "跨境收付汇、结汇与多币种资金通道合规方案",
  },
  {
    type: "TAX_COMPLIANCE",
    name: "海外税务合规",
    icon: <FileProtectOutlined aria-hidden />,
    desc: "海外 VAT/所得税申报、税务合规体检与风险应对",
  },
  {
    type: "QUALIFICATION",
    name: "出口资质备案",
    icon: <FileDoneOutlined aria-hidden />,
    desc: "进出口经营权、海关备案、原产地证等资质办理",
  },
  {
    type: "BANK_ACCOUNT",
    name: "海外银行开户",
    icon: <BankOutlined aria-hidden />,
    desc: "境外银行账户开立与跨境收款账户配置",
  },
] as const;

/** 出海六项（备案 providerType＝EXPORT_REFUND，细项写在 serviceItems）—— 整组归到「跨境出海」。 */
export const OVERSEAS_TYPES = [
  "EXPORT_REFUND",
  "COMPANY_REG",
  "SETTLEMENT",
  "TAX_COMPLIANCE",
  "QUALIFICATION",
  "BANK_ACCOUNT",
];

/**
 * 营销六项（备案 providerType＝MARKETING，细项写在 serviceItems）—— 与出海同构：
 * 备案必选细项、平台逐项审核、名录按细项分区、按细项独立签约。
 */
export const MARKETING_TYPES = [
  "INFLUENCER_VISIT",
  "LIVE_SELLING",
  "CONTENT_MARKETING",
  "GEO_OPTIMIZATION",
  "PRECISION_MARKETING",
  "PRIVATE_DOMAIN",
];

/** 营销细项分区定义（名录一细项一个分区、一细项一份独立签约；与出海 OVERSEAS_SERVICES 同构）。 */
export const MARKETING_SUB_ITEMS = [
  {
    type: "INFLUENCER_VISIT",
    name: "达人探店",
    icon: <EnvironmentOutlined aria-hidden />,
    desc: "本地生活/门店探店达人筛选与邀约到店，按类目、平台、粉丝数建联",
  },
  {
    type: "LIVE_SELLING",
    name: "直播带货",
    icon: <VideoCameraOutlined aria-hidden />,
    desc: "主播与直播间选品排期、坑位与佣金方案、直播数据复盘",
  },
  {
    type: "CONTENT_MARKETING",
    name: "内容营销",
    icon: <EditOutlined aria-hidden />,
    desc: "图文/短视频内容策划与批量分发、种草笔记与账号代运营",
  },
  {
    type: "GEO_OPTIMIZATION",
    name: "GEO优化",
    icon: <GlobalOutlined aria-hidden />,
    desc: "生成式引擎优化：品牌在 AI 问答中的提及率/上榜率、采集批次与选题池",
  },
  {
    type: "PRECISION_MARKETING",
    name: "精准营销",
    icon: <AimOutlined aria-hidden />,
    desc: "广告投放与人群定向、线索获取与转化链路优化",
  },
  {
    type: "PRIVATE_DOMAIN",
    name: "私域营销",
    icon: <TeamOutlined aria-hidden />,
    desc: "社群/企微私域承接、会员运营与复购激活",
  },
];

/**
 * 物流三项 / 资产交易五项细项 code（备案 providerType＝LOGISTICS 或 MICRO、ASSET_TRADE，
 * 细项写在 serviceItems）—— 与出海、营销同构：备案必选、平台逐项审核、名录分区、按细项签约。
 */
export const LOGISTICS_TYPES = [
  "DOMESTIC_LAND",
  "CROSS_BORDER_FORWARDER",
  "WAREHOUSING",
];
export const ASSET_TYPES = [
  "REAL_ESTATE",
  "INSURANCE",
  "INVESTMENT",
  "NON_PERFORMING_ASSET",
  "AUTO_TRADE",
];

/**
 * IT服务五项细项 code（备案 providerType＝SMART_SERVICE，细项写在 serviceItems）——
 * 与物流同构：备案必选、平台逐项审核、名录分区、按细项各签且不限家数。
 */
export const SMART_TYPES = [
  "AI_DEPLOY",
  "SOFTWARE_DEV",
  "COMPUTE",
  "HARDWARE",
  "DATA_SERVICE",
];

/** 物流服务细项分区（物流服务商与小微服务商的备案行都可承载这三个细项）。 */
export const LOGISTICS_SUB_ITEMS = [
  {
    type: "DOMESTIC_LAND",
    name: "境内陆运",
    icon: <TruckOutlined aria-hidden />,
    desc: "国内干线与城配陆运：整车/零担报价、在途跟踪、签收与回单",
  },
  {
    type: "CROSS_BORDER_FORWARDER",
    name: "跨境货代",
    icon: <GlobalOutlined aria-hidden />,
    desc: "海运/空运/铁路与报关报检：订舱、拖车、海外仓与清关",
  },
  {
    type: "WAREHOUSING",
    name: "仓储",
    icon: <InboxOutlined aria-hidden />,
    desc: "仓库与库内作业：入出库、库存与条码管理、代发与仓配一体、装卸暂存",
  },
];

/** 资产交易细项分区（一个细项一个分区、一份独立签约）。 */
export const ASSET_SUB_ITEMS = [
  {
    type: "REAL_ESTATE",
    name: "房产销售/租赁",
    icon: <HomeOutlined aria-hidden />,
    desc: "厂房/商铺/写字楼与住宅的出售、租赁与居间撮合",
  },
  {
    type: "INSURANCE",
    name: "保险",
    icon: <SafetyCertificateOutlined aria-hidden />,
    desc: "财产险/责任险/团体险的方案配置与投保续保",
  },
  {
    type: "INVESTMENT",
    name: "投资理财",
    icon: <LineChartOutlined aria-hidden />,
    desc: "资金配置与理财方案、尽调材料与投后跟踪",
  },
  {
    type: "NON_PERFORMING_ASSET",
    name: "不良资产",
    icon: <FileTextOutlined aria-hidden />,
    desc: "不良债权与资产的尽调、处置与撮合转让",
  },
  {
    type: "AUTO_TRADE",
    name: "汽车交易",
    icon: <CarOutlined aria-hidden />,
    desc: "商用车辆与办公用车的购置、过户与租赁",
  },
];

/**
 * IT服务细项分区（一个细项一个分区、一份独立签约，按细项各签不限家数）。
 */
export const SMART_SUB_ITEMS = [
  {
    type: "AI_DEPLOY",
    name: "AI实施",
    icon: <RobotOutlined aria-hidden />,
    desc: "大模型与智能体落地：业务场景梳理、模型选型与微调、部署上线与效果调优",
  },
  {
    type: "SOFTWARE_DEV",
    name: "软件开发",
    icon: <CodeOutlined aria-hidden />,
    desc: "定制开发与系统集成：需求梳理、方案与报价、迭代交付与验收运维",
  },
  {
    type: "COMPUTE",
    name: "算力服务",
    icon: <ThunderboltOutlined aria-hidden />,
    desc: "GPU/推理算力租用与集群托管：卡型配置、按量或包月、弹性扩缩容",
  },
  {
    type: "HARDWARE",
    name: "硬件服务",
    icon: <ApiOutlined aria-hidden />,
    desc: "服务器/边缘设备与物联网：选型采购、上架调试、维保与备件更换",
  },
  {
    type: "DATA_SERVICE",
    name: "数据服务",
    icon: <DatabaseOutlined aria-hidden />,
    desc: "数据采集、治理与标注：数据资产盘点、清洗标注、合规与资产化",
  },
];

/**
 * 名录分区「更多」进入的独立列表页所在板块（2026-09-25 用户指令：点更多＝进新页面，不弹层）。
 * `exclusive`＝该板块按细项「一个企业一家服务商」独占（物流、IT服务不限家数，见准入与签约口径）。
 */
export type DirectoryBoardKey =
  | "overseas"
  | "marketing"
  | "logistics"
  | "smart"
  | "asset";

export const DIRECTORY_BOARDS: Record<
  DirectoryBoardKey,
  { name: string; href: string; exclusive: boolean }
> = {
  overseas: { name: "跨境出海", href: "/overseas", exclusive: true },
  marketing: { name: "营销服务", href: "/marketing", exclusive: true },
  logistics: { name: "物流服务", href: "/logistics", exclusive: false },
  smart: { name: "IT服务", href: "/smart", exclusive: false },
  asset: { name: "资产交易", href: "/asset", exclusive: true },
};

/** 全站 25 个名录细项（出海 6 + 营销 6 + 物流 3 + IT服务 5 + 资产 5）→ 分区定义 + 所属板块。 */
export type DirectoryItem = {
  type: string;
  name: string;
  icon: ReactNode;
  desc: string;
  board: DirectoryBoardKey;
};

const withBoard = (
  board: DirectoryBoardKey,
  items: readonly { type: string; name: string; icon: ReactNode; desc: string }[],
): DirectoryItem[] => items.map((item) => ({ ...item, board }));

export const DIRECTORY_ITEMS: Record<string, DirectoryItem> = Object.fromEntries(
  [
    ...withBoard("overseas", OVERSEAS_SUB_ITEMS),
    ...withBoard("marketing", MARKETING_SUB_ITEMS),
    ...withBoard("logistics", LOGISTICS_SUB_ITEMS),
    ...withBoard("smart", SMART_SUB_ITEMS),
    ...withBoard("asset", ASSET_SUB_ITEMS),
  ].map((item) => [item.type, item] as const),
);

/** 细项 code → 中文（界面禁裸枚举；与后端 CATEGORY_LABELS 同源）。 */
export const SUBITEM_LABELS: Record<string, string> = {
  EXPORT_REFUND: "出口退税",
  COMPANY_REG: "海外公司注册",
  SETTLEMENT: "跨境结算",
  TAX_COMPLIANCE: "海外税务合规",
  QUALIFICATION: "出口资质备案",
  BANK_ACCOUNT: "海外银行开户",
  INFLUENCER_VISIT: "达人探店",
  LIVE_SELLING: "直播带货",
  CONTENT_MARKETING: "内容营销",
  GEO_OPTIMIZATION: "GEO优化",
  PRECISION_MARKETING: "精准营销",
  PRIVATE_DOMAIN: "私域营销",
  DOMESTIC_LAND: "境内陆运",
  CROSS_BORDER_FORWARDER: "跨境货代",
  WAREHOUSING: "仓储",
  AI_DEPLOY: "AI实施",
  SOFTWARE_DEV: "软件开发",
  COMPUTE: "算力服务",
  HARDWARE: "硬件服务",
  DATA_SERVICE: "数据服务",
  REAL_ESTATE: "房产销售/租赁",
  INSURANCE: "保险",
  INVESTMENT: "投资理财",
  NON_PERFORMING_ASSET: "不良资产",
  AUTO_TRADE: "汽车交易",
};

/**
 * 业务板块 → 所需服务类目（**备案审核通过即「开通」**；MICRO＝小微服务商，可做物流 / 供销）。
 * 侧栏菜单与高管驾驶舱「我的待办」卡片同源，避免两处口径漂移。
 * 出海 / 营销 / 物流 / IT服务 / 资产的职员按细项挂靠，故这些板块同时列「备案类目 ∪ 细项」。
 */
export const DOMAIN_TYPES: Record<string, string[]> = {
  tax: ["TAX_FINANCE"],
  overseas: OVERSEAS_TYPES,
  logistics: ["LOGISTICS", "MICRO", ...LOGISTICS_TYPES],
  smart: ["SMART_SERVICE", ...SMART_TYPES],
  legal: ["LEGAL_SERVICE"],
  ip: ["IP_SERVICE"],
  "think-tank": ["THINK_TANK_SERVICE"],
  flex: ["FLEX_WORK"],
  supply: ["SUPPLY_NETWORK", "MICRO"],
  marketing: ["MARKETING", ...MARKETING_TYPES],
  asset: ["ASSET_TRADE", ...ASSET_TYPES],
};

/** 服务商已备案通过的服务类型（providerApps 里 status=APPROVED 的行）。 */
export function registeredTypes(apps: unknown[] = []): Set<string> {
  const out = new Set<string>();
  for (const raw of apps) {
    const row = (raw || {}) as Record<string, unknown>;
    if (String(row.status || "") !== "APPROVED") continue;
    const type = String(row.providerType || "").trim();
    if (type) out.add(type);
  }
  return out;
}

/**
 * 备案类目（落 `providerType` 的十项 + 小微服务商类型）；细项 code 不在此列。
 * 「一个清单一个维度」：管理后台的服务类目清单与停用/恢复只按这里走。
 */
export const PROVIDER_CATEGORY_CODES = [
  "TAX_FINANCE",
  "EXPORT_REFUND",
  "LOGISTICS",
  "SMART_SERVICE",
  "LEGAL_SERVICE",
  "IP_SERVICE",
  "THINK_TANK_SERVICE",
  "FLEX_WORK",
  "SUPPLY_NETWORK",
  "MARKETING",
  "ASSET_TRADE",
  "MICRO",
];

/**
 * `MICRO`（小微服务商）直营覆盖的服务类目：物流 / 供销 —— 与 `DOMAIN_TYPES` 同源，
 * 服务商名录（`providerDirectory`）也按「类目 ∪ MICRO」取人，两处口径一致。
 * 只取备案类目：物流细项虽由小微行承载，但不是可单独停用的类目。
 */
export const MICRO_DIRECT_TYPES: string[] = [
  ...new Set(
    Object.entries(DOMAIN_TYPES)
      .filter(([, types]) => types.includes("MICRO"))
      .flatMap(([, types]) =>
        types.filter(
          (type) => type !== "MICRO" && PROVIDER_CATEGORY_CODES.includes(type),
        ),
      ),
  ),
];

/** 绑定角色名 → 服务类目（与后端 STAFF_ROLE_BY_TYPE / SUBITEM_STAFF_ROLE 一致）。 */
const ROLE_TYPES: Record<string, string> = {
  财税专员: "TAX_FINANCE",
  法律顾问: "LEGAL_SERVICE",
  知识产权专员: "IP_SERVICE",
  智库顾问: "THINK_TANK_SERVICE",
  灵活用工专员: "FLEX_WORK",
  供销专员: "SUPPLY_NETWORK",
  出口退税专员: "EXPORT_REFUND",
  海外公司注册专员: "COMPANY_REG",
  跨境结算专员: "SETTLEMENT",
  海外税务合规专员: "TAX_COMPLIANCE",
  出口资质备案专员: "QUALIFICATION",
  海外银行开户专员: "BANK_ACCOUNT",
  达人探店专员: "INFLUENCER_VISIT",
  直播带货专员: "LIVE_SELLING",
  内容营销专员: "CONTENT_MARKETING",
  "GEO优化专员": "GEO_OPTIMIZATION",
  精准营销专员: "PRECISION_MARKETING",
  私域营销专员: "PRIVATE_DOMAIN",
  境内陆运专员: "DOMESTIC_LAND",
  跨境货代专员: "CROSS_BORDER_FORWARDER",
  仓储专员: "WAREHOUSING",
  AI实施专员: "AI_DEPLOY",
  软件开发专员: "SOFTWARE_DEV",
  算力服务专员: "COMPUTE",
  硬件服务专员: "HARDWARE",
  数据服务专员: "DATA_SERVICE",
  房产交易专员: "REAL_ESTATE",
  保险专员: "INSURANCE",
  投资理财专员: "INVESTMENT",
  不良资产专员: "NON_PERFORMING_ASSET",
  汽车交易专员: "AUTO_TRADE",
};

/**
 * 该身份已开通的服务类目；`null`＝不受类目门控（用户 / 平台管理员，含其切换后的业务身份）。
 * - 服务商：备案审核通过的类目（与侧栏菜单同口径）；
 * - 职员 / 代理人：本人服务类目（个人资料里勾选）∪ 已生效绑定记录的类目（机构开通什么就能承办什么）。
 */
export function openedTypes(
  me: Pick<EnterpriseMe, "providerApps" | "staffProfile" | "staffOf" | "identities"> | null,
  identity: string,
): Set<string> | null {
  if (me?.identities.includes("PLATFORM_ADMIN")) return null;
  if (identity === "SERVICE_PROVIDER") {
    return registeredTypes(me?.providerApps || []);
  }
  if (identity === "PROVIDER_STAFF") {
    const out = new Set<string>();
    const profile = (me?.staffProfile || null) as {
      categories?: unknown;
    } | null;
    if (Array.isArray(profile?.categories)) {
      for (const item of profile.categories) out.add(String(item));
    }
    for (const raw of me?.staffOf || []) {
      const bind = (raw || {}) as { status?: string; roles?: unknown };
      if (String(bind.status || "") !== "ACTIVE") continue;
      if (!Array.isArray(bind.roles)) continue;
      for (const role of bind.roles) {
        const type = ROLE_TYPES[String(role).trim()];
        if (type) out.add(type);
      }
    }
    return out;
  }
  return null;
}

/** 板块是否已开通（`opened` 为 null 或卡片未挂板块时不受门控）。 */
export function isDomainOpened(
  opened: Set<string> | null,
  domain?: string,
): boolean {
  if (!opened || !domain) return true;
  return (DOMAIN_TYPES[domain] || []).some((type) => opened.has(type));
}

/**
 * 「🛠️ 服务发布」栏目门控（2026-09-25 收口）：**当前身份为服务商、且该板块的服务类目已备案通过**
 * 才渲染该栏目（用户 / 职员 / 平台管理员一律不渲染，与后端 `services.create()` 同口径）。
 * 资产交易板块不走本函数——按用户指令「除了资产交易以外」保留企业侧发布入口（§6.9 双身份）。
 */
export function canPublishService(
  me: Pick<EnterpriseMe, "currentIdentity" | "providerApps"> | null,
  domain: string,
): boolean {
  if (!me || me.currentIdentity !== "SERVICE_PROVIDER") return false;
  return isDomainOpened(
    registeredTypes(me.providerApps || []),
    domain.toLowerCase(),
  );
}
