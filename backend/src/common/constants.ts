export const BUSINESS_IDENTITIES = [
  'ENTERPRISE_USER',
  'SERVICE_PROVIDER',
  'PROVIDER_STAFF',
] as const;
export type BusinessIdentity = (typeof BUSINESS_IDENTITIES)[number];
/**
 * 默认身份优先级（账号本身是什么类型就进什么 tab）：服务商 > 职员/代理人 > 用户。
 * 与 `BUSINESS_IDENTITIES`（切换器展示顺序）是两个维度，不要合并。
 */
export const IDENTITY_PRIORITY: BusinessIdentity[] = [
  'SERVICE_PROVIDER',
  'PROVIDER_STAFF',
  'ENTERPRISE_USER',
];
export const SERVICE_TYPES = [
  'TAX_FINANCE',
  'EXPORT_REFUND',
  'LOGISTICS',
  'LEGAL_SERVICE',
  'IP_SERVICE',
  'FLEX_WORK',
  'SUPPLY_NETWORK',
  'MARKETING',
  'ASSET_TRADE',
  'MICRO',
  'SMART_SERVICE',
  'THINK_TANK_SERVICE',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const OVERSEAS_SERVICE_TYPES = [
  'EXPORT_REFUND',
  'COMPANY_REG',
  'SETTLEMENT',
  'TAX_COMPLIANCE',
  'QUALIFICATION',
  'BANK_ACCOUNT',
] as const;
export type OverseasServiceType = (typeof OVERSEAS_SERVICE_TYPES)[number];
/**
 * 营销服务细项（与出海同构：备案时必选、平台逐项审核、名录按细项分区、按细项独立签约）。
 * 细项不落 `providerType`，记在 `MARKETING` 行的 `serviceItems` 里。
 */
export const MARKETING_SERVICE_TYPES = [
  'INFLUENCER_VISIT',
  'LIVE_SELLING',
  'CONTENT_MARKETING',
  'GEO_OPTIMIZATION',
  'PRECISION_MARKETING',
  'PRIVATE_DOMAIN',
] as const;
export type MarketingServiceType = (typeof MARKETING_SERVICE_TYPES)[number];
/**
 * 物流服务细项（与出海 / 营销同构）。承载备案行有两种：
 * 「物流服务商」（`LOGISTICS`）与「小微服务商」（`MICRO`，个人主体直营）——小微同样必须勾细项。
 */
export const LOGISTICS_SERVICE_TYPES = [
  'DOMESTIC_LAND',
  'CROSS_BORDER_FORWARDER',
  'WAREHOUSING',
] as const;
export type LogisticsServiceType = (typeof LOGISTICS_SERVICE_TYPES)[number];
/** 资产交易细项（承载备案行＝`ASSET_TRADE`）。 */
export const ASSET_SERVICE_TYPES = [
  'REAL_ESTATE',
  'INSURANCE',
  'INVESTMENT',
  'NON_PERFORMING_ASSET',
  'AUTO_TRADE',
] as const;
export type AssetServiceType = (typeof ASSET_SERVICE_TYPES)[number];
/**
 * IT服务细项（板块流程 1:1 参照物流：备案时必选、平台逐项审核、名录按细项分区、按细项独立签约）。
 * 承载备案行＝`SMART_SERVICE`。
 */
export const SMART_SERVICE_TYPES = [
  'AI_DEPLOY',
  'SOFTWARE_DEV',
  'COMPUTE',
  'HARDWARE',
  'DATA_SERVICE',
] as const;
export type SmartServiceType = (typeof SMART_SERVICE_TYPES)[number];
/**
 * 细项 code → 承载它的备案行 `providerType`（细项不落库为独立备案行）。
 * 物流细项有两个承载行（`LOGISTICS` / `MICRO`），同一机构任一备案行生效即可。
 */
export const SUBITEM_OWNERS: Record<string, string[]> = {
  ...Object.fromEntries(
    OVERSEAS_SERVICE_TYPES.map((item) => [item, ['EXPORT_REFUND']]),
  ),
  ...Object.fromEntries(
    MARKETING_SERVICE_TYPES.map((item) => [item, ['MARKETING']]),
  ),
  ...Object.fromEntries(
    LOGISTICS_SERVICE_TYPES.map((item) => [item, ['LOGISTICS', 'MICRO']]),
  ),
  ...Object.fromEntries(
    ASSET_SERVICE_TYPES.map((item) => [item, ['ASSET_TRADE']]),
  ),
  ...Object.fromEntries(
    SMART_SERVICE_TYPES.map((item) => [item, ['SMART_SERVICE']]),
  ),
};
/**
 * 该分类（备案类目或细项 code）由哪些备案行承载：
 * 细项查 `SUBITEM_OWNERS`；裸类目里物流 / 供销另并入小微（MICRO）直营兜底。
 */
export function bearingRowsOf(type: string): string[] {
  const owners = SUBITEM_OWNERS[type];
  if (owners) return [...owners];
  return type === 'LOGISTICS' || type === 'SUPPLY_NETWORK'
    ? [type, 'MICRO']
    : [type];
}
/**
 * 与该备案行绑定的签约分类集合（判定「该类目是否已有生效签约」用）：
 * 细项类目＝其细项；小微另含存量裸「LOGISTICS」签约（历史数据）。
 */
export function contractTypesOfBearingRow(providerType: string): string[] {
  const items = subItemsOf(providerType);
  if (providerType === 'MICRO') return [...items, 'LOGISTICS'];
  return items.length ? items : [providerType];
}
/** 备案时必须选细项、且细项逐条独立生效的类目（出海 / 营销 / 物流 / 小微 / 资产交易 / IT服务）。 */
export const SUBITEM_BEARING_CATEGORIES = [
  'EXPORT_REFUND',
  'MARKETING',
  'LOGISTICS',
  'MICRO',
  'ASSET_TRADE',
  'SMART_SERVICE',
];
/**
 * 细项类目的界面名（整块业务，已含「服务」）：`CATEGORY_LABELS.EXPORT_REFUND`
 * 是细项「出口退税」，备案/审核文案要说的是整块业务，故单列一张表。
 */
export const SUBITEM_CATEGORY_LABELS: Record<string, string> = {
  EXPORT_REFUND: '跨境出海服务',
  MARKETING: '营销服务',
  LOGISTICS: '物流服务',
  MICRO: '物流服务',
  ASSET_TRADE: '资产交易',
  SMART_SERVICE: 'IT服务',
};
/** 备案类目 → 该类目下合法的细项集合；非细项类目返回空数组。 */
export function subItemsOf(providerType: string): string[] {
  if (providerType === 'EXPORT_REFUND') return [...OVERSEAS_SERVICE_TYPES];
  if (providerType === 'MARKETING') return [...MARKETING_SERVICE_TYPES];
  if (providerType === 'LOGISTICS' || providerType === 'MICRO')
    return [...LOGISTICS_SERVICE_TYPES];
  if (providerType === 'ASSET_TRADE') return [...ASSET_SERVICE_TYPES];
  if (providerType === 'SMART_SERVICE') return [...SMART_SERVICE_TYPES];
  return [];
}
/** 该备案类目是否按细项作业（备案必填细项、平台逐项审核）。 */
export function hasSubItems(providerType: string) {
  return SUBITEM_BEARING_CATEGORIES.includes(providerType);
}
/**
 * 「🛠️ 服务发布」栏目的资质门控（2026-09-25 收口）：业务域 → 该板块的备案类目
 * （承载备案行由 `bearingRowsOf` 决定，物流含小微直营行）。
 * 前端 `lib/provider-categories.canPublishService` 与本表同源。
 * **资产交易不在本表**：按 §6.9 双身份口径，用户侧同样可发布，不受服务商资质门控。
 */
export const SERVICE_PUBLISH_CATEGORY_BY_DOMAIN: Record<string, string> = {
  LOGISTICS: 'LOGISTICS',
  IP: 'IP_SERVICE',
  LEGAL: 'LEGAL_SERVICE',
  FLEX: 'FLEX_WORK',
  MARKETING: 'MARKETING',
  SMART: 'SMART_SERVICE',
  TAX: 'TAX_FINANCE',
  SUPPLY: 'SUPPLY_NETWORK',
  OVERSEAS: 'EXPORT_REFUND',
};
/**
 * 平台直连板块（2026-09-26 用户口径）：「需求信息」与「服务发布」都直接调用 AIworkin
 * 运行时接口（`/enterprise/market/<板块>/…`），本系统不审核发布资质、也不落一行数据。
 * 出海因新增「需求信息」栏目并入本表（服务发布界面未开，但接口门控与其余两块同口径，
 * 不留未门控的发布路径）。其余板块仍是过渡期本地台账（#227 统一下线，见对接说明 §4.10）。
 */
export const PLATFORM_DIRECT_DOMAINS: string[] = ['TAX', 'SUPPLY', 'OVERSEAS'];
/**
 * 服务市集板块（2026-10-28 用户口径）：各板块的「××服务市集」栏目只读扫 AIworkin 的
 * SUPPLY 公开池，列出全平台服务商在本板块已发布的服务，本系统不落库、不做主体/类目门控。
 * 与 `PLATFORM_DIRECT_DOMAINS` 不同：这里的板块不开放本系统的「服务发布」写入，只读浏览。
 * 物流 2026-10-28 追加（用户：「物流也应该有物流服务市集」），财税 / 供销仍叫「服务发布」。
 */
export const MARKETPLACE_DOMAINS: string[] = [
  'LOGISTICS',
  'MARKETING',
  'OVERSEAS',
  'FLEX',
  'SMART',
  'IP',
  'LEGAL',
  'THINK_TANK',
];
export const CONTRACT_CATEGORIES: string[] = [
  ...new Set([
    ...SERVICE_TYPES,
    ...OVERSEAS_SERVICE_TYPES,
    ...MARKETING_SERVICE_TYPES,
    ...LOGISTICS_SERVICE_TYPES,
    ...ASSET_SERVICE_TYPES,
    ...SMART_SERVICE_TYPES,
  ]),
  // 出海 / 营销 / 物流 / IT服务只在细项级签约（类目本身不作为签约分类）；资产交易同样只按细项签约
].filter(
  (item) =>
    item !== 'MICRO' &&
    item !== 'ASSET_TRADE' &&
    item !== 'MARKETING' &&
    item !== 'LOGISTICS' &&
    item !== 'SMART_SERVICE',
);
export const EXCLUSIVE_CATEGORIES = [
  'TAX_FINANCE',
  ...OVERSEAS_SERVICE_TYPES,
  ...MARKETING_SERVICE_TYPES,
  // 物流 / IT服务按细项各签、不限家数（不进独占）；资产交易按细项一细项一家
  ...ASSET_SERVICE_TYPES,
] as const;
export const MULTI_SERVICE_TYPES = [
  'LOGISTICS',
  'LEGAL_SERVICE',
  'IP_SERVICE',
  'FLEX_WORK',
  'SUPPLY_NETWORK',
  'SMART_SERVICE',
] as const;
/**
 * 职员/代理人可申报的服务板块（个人资料里的「服务类目」，十一个板块一项不少）。
 * 维度＝板块：出海 / 营销 / 物流 / 资产 / IT服务下的具体细项不在此列——
 * 细项是「申请加入」与挂靠那一头的粒度（`AFFILIATION_CATEGORIES`），
 * 申报了板块即代表可承接该板块下的任一细项。
 */
export const STAFF_CATEGORIES = [
  'TAX_FINANCE',
  'EXPORT_REFUND',
  'LOGISTICS',
  'LEGAL_SERVICE',
  'IP_SERVICE',
  'THINK_TANK_SERVICE',
  'FLEX_WORK',
  'SUPPLY_NETWORK',
  'MARKETING',
  'ASSET_TRADE',
  'SMART_SERVICE',
] as const;
/**
 * 该分类（板块或细项 code）归入的板块集合：细项归到承载它的备案类目（小微不单列为板块），
 * 板块自身返回自己。用于判定「职员申报的板块是否覆盖要申请的分类」。
 */
export function staffBoardsOf(code: string): string[] {
  const owners = SUBITEM_OWNERS[code];
  if (!owners) return [code];
  return [...new Set(owners.filter((owner) => owner !== 'MICRO'))];
}
/** 职员申报的板块清单是否覆盖该分类（板块本身，或该板块下的任一细项）。 */
export function staffCategoryCovers(
  declared: readonly string[],
  code: string,
): boolean {
  const target = staffBoardsOf(code);
  return declared.some((item) =>
    staffBoardsOf(item).some((board) => target.includes(board)),
  );
}
export const CATEGORY_LABELS: Record<string, string> = {
  TAX_FINANCE: '企业财税服务',
  LOGISTICS: '物流服务',
  LEGAL_SERVICE: '法律服务',
  IP_SERVICE: '知识产权服务',
  THINK_TANK_SERVICE: '智库服务',
  FLEX_WORK: '灵活用工服务',
  SUPPLY_NETWORK: '供销服务',
  MARKETING: '营销服务',
  ASSET_TRADE: '资产交易',
  MICRO: '小微服务商',
  EXPORT_REFUND: '出口退税',
  COMPANY_REG: '海外公司注册',
  SETTLEMENT: '跨境结算',
  TAX_COMPLIANCE: '海外税务合规',
  QUALIFICATION: '出口资质备案',
  BANK_ACCOUNT: '海外银行开户',
  INFLUENCER_VISIT: '达人探店',
  LIVE_SELLING: '直播带货',
  CONTENT_MARKETING: '内容营销',
  GEO_OPTIMIZATION: 'GEO优化',
  PRECISION_MARKETING: '精准营销',
  PRIVATE_DOMAIN: '私域营销',
  DOMESTIC_LAND: '境内陆运',
  CROSS_BORDER_FORWARDER: '跨境货代',
  WAREHOUSING: '仓储',
  REAL_ESTATE: '房产销售/租赁',
  INSURANCE: '保险',
  INVESTMENT: '投资理财',
  NON_PERFORMING_ASSET: '不良资产',
  AUTO_TRADE: '汽车交易',
  SMART_SERVICE: 'IT服务',
  AI_DEPLOY: 'AI实施',
  SOFTWARE_DEV: '软件开发',
  COMPUTE: '算力服务',
  HARDWARE: '硬件服务',
  DATA_SERVICE: '数据服务',
};
/**
 * 板块启停开关（system_settings.key）：平台管理员在管理后台控制，
 * **缺省（无该行）= 启用**，只有显式写入 'false' 才算停用。
 */
export const FLEX_PAYROLL_ENABLED_KEY = 'flex_payroll_enabled';
export const TAX_FORM_TYPES = [
  'vat_general',
  'vat_small',
  'cit_quarter',
  'cit_annual',
  'stamp_duty',
  'surtax',
  'iit_withholding',
  'iit_operating_a',
  'iit_operating_b',
  'iit_operating_c',
  'ibp',
] as const;
export function isExclusiveCategory(category: string) {
  return (EXCLUSIVE_CATEGORIES as readonly string[]).includes(category);
}
export function isContractCategory(category: string) {
  return CONTRACT_CATEGORIES.includes(category);
}
export function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(value);
}
export function isOverseasType(value: string): value is OverseasServiceType {
  return (OVERSEAS_SERVICE_TYPES as readonly string[]).includes(value);
}
export function isMarketingType(value: string): value is MarketingServiceType {
  return (MARKETING_SERVICE_TYPES as readonly string[]).includes(value);
}
/** 是否为「细项」code（出海 6 / 营销 6 / 物流 3 / 资产 5 / IT服务 5）：细项不落独立备案行。 */
export function isSubItemType(value: string) {
  return SUBITEM_OWNERS[value] !== undefined;
}
export function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}
export function genNo(prefix: string, seq: number) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}${day}-${String(seq).padStart(4, '0')}`;
}
/** 当日单据号前缀，如 WL20260922-，用于按当日号段查询已用序号。 */
export function noDayPrefix(prefix: string) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}${day}-`;
}
/**
 * 当日单据号 = 前缀 + 当日已用最大序号 + 1。
 * 不能用表行数当序号：删除历史单据会留下空洞，行数 + 1 会与既有号重号（唯一索引直接报错）。
 */
export function nextNo(prefix: string, existingNos: string[]) {
  const head = noDayPrefix(prefix);
  const max = existingNos.reduce((acc, no) => {
    const seq = Number(String(no).slice(head.length));
    return Number.isFinite(seq) && seq > acc ? seq : acc;
  }, 0);
  return genNo(prefix, max + 1);
}
