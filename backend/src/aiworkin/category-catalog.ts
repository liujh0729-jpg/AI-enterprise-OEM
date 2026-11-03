import { createHash } from 'crypto';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
/**
 * AIworkin 供需市场类目树镜像（只镜像本系统十个业务模块用到的子树）。
 *
 * 来源：`aipdd-aiworkin-master` 的
 * `backend/prisma/migrations/20260901000000_a2a_requirement_category_reset/migration.sql`
 * （生成源 `backend/src/unified-market/a2a-category-catalog.ts`）。
 * ID 算法与平台完全一致，因此本地选出的 `subcategoryId` 在平台上必然存在：
 *   md5('a2a-requirement-parent:' || key)::uuid
 *   md5('a2a-requirement-child:'  || key)::uuid
 * 平台发布接口 `POST /market/listings` 必填 subcategoryId，并按 ID 反查
 * 「level=2 + enabled + applicableDirections 含本方向 + 父类目 enabled」。
 */
export type MarketCategoryDomain =
  | 'LOGISTICS'
  | 'IP'
  | 'LEGAL'
  | 'FLEX'
  | 'MARKETING'
  | 'ASSET'
  | 'SMART'
  | 'TAX'
  | 'SUPPLY'
  | 'OVERSEAS'
  | 'THINK_TANK';
export interface MarketCategoryLeaf {
  /** AIworkin `market_category.key`，形如 `父key.子key` */
  key: string;
  /** AIworkin `market_category.id`（确定性 UUID） */
  id: string;
  name: string;
  /** 平台要求先绑定已核验资质才能发布（服务发布场景） */
  credentialTypes: string[];
  /** 平台限制只能人工沟通（unified-market 的 agentCommunication=MANUAL_ONLY） */
  manualOnly: boolean;
}
export interface MarketCategoryGroup {
  parentKey: string;
  parentId: string;
  parentName: string;
  children: MarketCategoryLeaf[];
}
export interface MarketCategoryModule extends MarketCategoryGroup {
  domain: MarketCategoryDomain;
  label: string;
  /** 见 `MODULE_SEEDS` 同名字段：公开池是否可按本模块一级类目过滤。 */
  poolFilterable?: boolean;
}
const PARENT_NAMES: Record<string, string> = {
  logistics_warehousing: '物流仓储',
  corporate_commercial_tax: '企业商事财税公司',
  legal_services: '法律服务公司',
  content_marketing_ecommerce: '内容 / 营销广告 / 电商公司',
  asset_brokerage: '资产租售与居间服务',
  software_ai_development: '软件 / AI开发公司',
  wholesale_businesses: '批发业务公司',
  cross_border_services: '跨境出海服务公司',
  consulting_services: '咨询服务',
};
interface LeafSeed {
  key: string;
  name: string;
  credentials?: string[];
  manualOnly?: boolean;
}
const LEAF_SEEDS: LeafSeed[] = [
  {
    key: 'logistics_warehousing.logistics_freight',
    name: '物流 / 货运',
    credentials: ['ROAD_TRANSPORT_BUSINESS_LICENSE'],
  },
  { key: 'logistics_warehousing.warehousing', name: '仓储' },
  {
    key: 'cross_border_services.overseas_marketing_web_ecommerce',
    name: '海外推广 / 跨境建站 / 跨境电商代运营',
  },
  {
    key: 'cross_border_services.overseas_warehousing',
    name: '海外仓储',
  },
  {
    key: 'cross_border_services.customs_declaration',
    name: '报关',
    credentials: ['CUSTOMS_DECLARATION_REGISTRATION'],
  },
  { key: 'cross_border_services.visa_services', name: '签证服务' },
  {
    key: 'cross_border_services.business_interpretation',
    name: '随行商务翻译',
  },
  {
    key: 'corporate_commercial_tax.corporate_tax',
    name: '工商财税',
    credentials: ['AGENCY_BOOKKEEPING_LICENSE'],
  },
  {
    key: 'corporate_commercial_tax.intellectual_property',
    name: '知识产权',
    credentials: ['IP_AGENCY_QUALIFICATION'],
  },
  {
    key: 'corporate_commercial_tax.flexible_staffing',
    name: '灵活用工',
    credentials: ['HUMAN_RESOURCES_SERVICE_LICENSE'],
  },
  {
    key: 'corporate_commercial_tax.licenses_project_applications',
    name: '资质许可 / 项目申报',
  },
  {
    key: 'legal_services.legal_services',
    name: '法律服务',
    credentials: ['LEGAL_PRACTICE_LICENSE'],
    manualOnly: true,
  },
  {
    key: 'content_marketing_ecommerce.marketing_promotion',
    name: '营销推广',
  },
  { key: 'asset_brokerage.real_estate', name: '房产销售 / 租赁' },
  {
    key: 'asset_brokerage.insurance',
    name: '保险',
    credentials: ['INSURANCE_BUSINESS_LICENSE'],
    manualOnly: true,
  },
  {
    key: 'asset_brokerage.investment',
    name: '投资理财',
    credentials: ['FINANCIAL_SERVICES_LICENSE'],
    manualOnly: true,
  },
  {
    key: 'asset_brokerage.distressed_assets',
    name: '不良资产',
    credentials: ['ASSET_MANAGEMENT_QUALIFICATION'],
    manualOnly: true,
  },
  { key: 'asset_brokerage.automobile_trading', name: '汽车交易' },
  {
    key: 'software_ai_development.software_ai_development',
    name: '软件开发 / AI开发',
  },
  {
    key: 'software_ai_development.software_data_asset_trading',
    name: '软件 / 数据资产交易',
  },
  {
    key: 'wholesale_businesses.food_general_merchandise',
    name: '食品百货批发',
    credentials: ['FOOD_BUSINESS_LICENSE'],
  },
  { key: 'wholesale_businesses.beauty_personal_care', name: '美妆日化批发' },
  { key: 'wholesale_businesses.apparel_footwear', name: '服装鞋帽批发' },
  { key: 'wholesale_businesses.maternal_child', name: '亲子母婴批发' },
  {
    key: 'consulting_services.enterprise_consulting',
    name: '企业咨询',
  },
];
/**
 * 平台已收录、但本系统不作为「发布出口」的二级类目（只用于列表类目名展示）。
 * 来源：正式平台 `GET /market/categories` 实测 2026-10-28，其 ID 与
 * `deterministicId('child', key)` 逐个相符。本系统的发布表单只列 `MODULE_SEEDS`
 * 里各板块自己的二级类目（营销六细项统一发往「营销推广」），所以这些类目
 * 不进入 `children`，只登记进 `LEAVES` 供 `categoryLabels` 反查名称——
 * 否则服务市集列出平台同行在该子树发布的服务时，「一级类目 / 二级类目」两列会是空白。
 */
const DISPLAY_ONLY_LEAF_SEEDS: LeafSeed[] = [
  {
    key: 'content_marketing_ecommerce.new_media_video_operations',
    name: '新媒体制作 / 短视频制作 / 新媒体代运营',
  },
  {
    key: 'content_marketing_ecommerce.ai_drama_film_production',
    name: 'AI短剧 / 影视内容制作',
  },
  {
    key: 'content_marketing_ecommerce.graphic_logo_poster_ecommerce_design',
    name: '平面设计 / LOGO / 海报 / 电商美工外包',
  },
  { key: 'content_marketing_ecommerce.photography', name: '摄影' },
  {
    key: 'content_marketing_ecommerce.printing_signage',
    name: '打印 / 门头招牌 / 灯箱 / 喷绘 / 锦旗',
  },
  {
    key: 'content_marketing_ecommerce.3d_printing_coloring',
    name: '3D打印 / 3D模型上色',
  },
  { key: 'content_marketing_ecommerce.art_design', name: '艺术设计' },
  {
    key: 'content_marketing_ecommerce.ecommerce_operations',
    name: '电商代运营',
  },
];
function deterministicId(kind: 'parent' | 'child', key: string) {
  const hex = createHash('md5')
    .update(`a2a-requirement-${kind}:${key}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
const LEAVES = new Map<string, MarketCategoryLeaf>();
for (const seed of [...LEAF_SEEDS, ...DISPLAY_ONLY_LEAF_SEEDS]) {
  LEAVES.set(seed.key, {
    key: seed.key,
    id: deterministicId('child', seed.key),
    name: seed.name,
    credentialTypes: seed.credentials || [],
    manualOnly: seed.manualOnly === true,
  });
}
/** 模块 → 一级类目（AIworkin 父类目）与可用二级类目；第一个为默认值。 */
const MODULE_SEEDS: Array<{
  domain: MarketCategoryDomain;
  label: string;
  parentKey: string;
  children: MarketCategoryLeaf[];
  /**
   * 公开池能否按本模块的一级类目过滤（平台 `GET /market/listings?category=`）。
   * 实测 2026-10-28：正式平台 `/market/categories` 只有 17 个一级类目，未收录
   * `consulting_services`（智库/咨询），带该参数会被判 `400 请求参数错误`。
   * 标为 false 的板块扫描公开池时不带 `category`，改由挂单自带的 `categoryKey`
   * 判定板块归属（见 `marketplacePoolScope`）。
   */
  poolFilterable?: boolean;
}> = [
  {
    domain: 'LOGISTICS',
    label: '物流服务',
    parentKey: 'logistics_warehousing',
    children: [
      LEAVES.get('logistics_warehousing.logistics_freight')!,
      LEAVES.get('logistics_warehousing.warehousing')!,
    ],
  },
  {
    domain: 'IP',
    label: '知识产权',
    parentKey: 'corporate_commercial_tax',
    children: [LEAVES.get('corporate_commercial_tax.intellectual_property')!],
  },
  {
    domain: 'LEGAL',
    label: '法律服务',
    parentKey: 'legal_services',
    children: [LEAVES.get('legal_services.legal_services')!],
  },
  {
    domain: 'FLEX',
    label: '灵活用工',
    parentKey: 'corporate_commercial_tax',
    children: [LEAVES.get('corporate_commercial_tax.flexible_staffing')!],
  },
  {
    domain: 'MARKETING',
    label: '营销服务',
    parentKey: 'content_marketing_ecommerce',
    children: [LEAVES.get('content_marketing_ecommerce.marketing_promotion')!],
  },
  {
    domain: 'ASSET',
    label: '资产交易',
    parentKey: 'asset_brokerage',
    children: [
      LEAVES.get('asset_brokerage.real_estate')!,
      LEAVES.get('asset_brokerage.insurance')!,
      LEAVES.get('asset_brokerage.investment')!,
      LEAVES.get('asset_brokerage.distressed_assets')!,
      LEAVES.get('asset_brokerage.automobile_trading')!,
    ],
  },
  {
    // IT服务五个细项（AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务）共用平台
    // 「软件 / AI开发公司」子树：平台侧没有算力·硬件·数据服务的专属二级类目，
    // 与营销（六细项共用「营销推广」）同构，细项维度只在本系统落库与审核。
    domain: 'SMART',
    label: 'IT服务',
    parentKey: 'software_ai_development',
    children: [
      LEAVES.get('software_ai_development.software_ai_development')!,
      LEAVES.get('software_ai_development.software_data_asset_trading')!,
    ],
  },
  {
    // 财税挂在平台「企业商事财税公司」下的「工商财税」，另给「资质许可 / 项目申报」
    // 一个出口（工商代办、资质申办本就是财税服务商的常规业务）。
    // 同父类目的「知识产权」「灵活用工」已由 IP / FLEX 两个域各自占用，不在此重复。
    domain: 'TAX',
    label: '财税服务',
    parentKey: 'corporate_commercial_tax',
    children: [
      LEAVES.get('corporate_commercial_tax.corporate_tax')!,
      LEAVES.get('corporate_commercial_tax.licenses_project_applications')!,
    ],
  },
  {
    // 供销（供货）网络挂在平台「批发业务公司」的四个批发二级类目下。
    domain: 'SUPPLY',
    label: '供销服务',
    parentKey: 'wholesale_businesses',
    children: [
      LEAVES.get('wholesale_businesses.food_general_merchandise')!,
      LEAVES.get('wholesale_businesses.beauty_personal_care')!,
      LEAVES.get('wholesale_businesses.apparel_footwear')!,
      LEAVES.get('wholesale_businesses.maternal_child')!,
    ],
  },
  {
    // 跨境出海挂在平台专属一级类目「跨境出海服务公司」下，五个二级类目与本系统
    // 出海板块的服务目录同构（报关细项在平台侧要求 CUSTOMS_DECLARATION_REGISTRATION 资质）。
    domain: 'OVERSEAS',
    label: '跨境出海',
    parentKey: 'cross_border_services',
    children: [
      LEAVES.get('cross_border_services.overseas_marketing_web_ecommerce')!,
      LEAVES.get('cross_border_services.overseas_warehousing')!,
      LEAVES.get('cross_border_services.customs_declaration')!,
      LEAVES.get('cross_border_services.visa_services')!,
      LEAVES.get('cross_border_services.business_interpretation')!,
    ],
  },
  {
    // 智库服务（咨询）挂在平台专属一级类目「咨询服务」下，二级类目「企业咨询」。
    // 该一级类目目前只存在于类目镜像（需求清单要求平台新增），正式平台尚未收录，
    // 因此公开池不能按它过滤——见 `poolFilterable`。
    domain: 'THINK_TANK',
    label: '智库服务',
    parentKey: 'consulting_services',
    children: [LEAVES.get('consulting_services.enterprise_consulting')!],
    poolFilterable: false,
  },
];
export const MODULE_CATEGORIES: MarketCategoryModule[] = MODULE_SEEDS.map(
  (item) => ({
    ...item,
    parentId: deterministicId('parent', item.parentKey),
    parentName: PARENT_NAMES[item.parentKey] || item.parentKey,
  }),
);
export const MARKET_DOMAINS = MODULE_CATEGORIES.map((item) => item.domain);
/** 一级类目被哪几个业务板块共用（市集按一级类目收窄公开池的前提）。 */
const PARENT_DOMAINS: Record<string, string[]> = {};
for (const item of MODULE_CATEGORIES)
  (PARENT_DOMAINS[item.parentKey] ||= []).push(item.domain);
/**
 * 「服务市集」扫描平台公开池时的板块归属判定：
 * - `parent`：看挂单自带的一级类目 key。平台 `?category=` 返回的整棵子树都属本板块，
 *   而本系统只镜像其中一个二级类目作发布出口时，按二级类目收窄会把服务商在该板块
 *   已发布的服务全部隐藏（实测 2026-10-28：营销公开池 9 条，按「营销推广」收窄剩 0 条）。
 * - `leaf`：仍按本板块镜像的二级类目判定。「企业商事财税公司」一个一级类目被
 *   财税／知产／灵工三个板块共用，不切分会让三个市集列出同一批服务。
 */
export function marketplacePoolScope(
  module: MarketCategoryModule,
): 'parent' | 'leaf' {
  return (PARENT_DOMAINS[module.parentKey] || []).length === 1
    ? 'parent'
    : 'leaf';
}
export function findModuleCategory(
  domain: string,
): MarketCategoryModule | undefined {
  return MODULE_CATEGORIES.find((item) => item.domain === domain);
}
export function moduleCategory(domain: string): MarketCategoryModule {
  const anchor = findModuleCategory(domain);
  if (!anchor) {
    throw new Error(`未知业务域：${domain}`);
  }
  return anchor;
}
export function leafByKey(key: string): MarketCategoryLeaf | undefined {
  return LEAVES.get(key);
}
export function leafById(id: string): MarketCategoryLeaf | undefined {
  const lower = String(id || '').toLowerCase();
  for (const leaf of LEAVES.values()) {
    if (leaf.id === lower) return leaf;
  }
  return undefined;
}
/** 模块默认二级类目（表单未选时使用）。 */
export function defaultSubCategoryId(domain: string) {
  return moduleCategory(domain).children[0].id;
}
/** 按模块校验并归一化 subcategoryId；只允许该模块自己的二级类目（未选时取模块默认）。 */
export function requireSubCategoryId(domain: string, value: unknown) {
  const raw = text(value || '')
    .trim()
    .toLowerCase();
  const module = moduleCategory(domain);
  if (raw) {
    const hit = module.children.find((item) => item.id === raw);
    if (hit) return hit.id;
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `二级类目不属于「${module.parentName}」，请重新选择`,
    );
  }
  return module.children[0].id;
}
/** 列表展示用：一级 / 二级类目名（副标题固定取一级类目名）。 */
export function categoryLabels(subCategoryId: string) {
  const leaf = leafById(subCategoryId);
  if (!leaf) return null;
  const parentKey = leaf.key.split('.')[0];
  return {
    category1: PARENT_NAMES[parentKey] || parentKey,
    category2: leaf.name,
  };
}
/** 编辑入参归一化：仅当传了 sub_category_id 时按模块校验，未传保持原值。 */
export function normalizeCategoryEdit(
  domain: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.sub_category_id === undefined) return body;
  return {
    ...body,
    sub_category_id: requireSubCategoryId(domain, body.sub_category_id),
  };
}
/** 列表行补平台类目名（一级 / 二级），前端列直接取用。 */
export function withCategoryLabels<T extends object>(row: T) {
  const raw = (
    row as {
      subCategoryId?: string | null;
    }
  ).subCategoryId;
  const labels = categoryLabels(String(raw || ''));
  return {
    ...row,
    category1: labels?.category1 || '',
    category2: labels?.category2 || '',
  };
}
