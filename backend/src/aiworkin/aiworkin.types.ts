/** AIworkin 需求（市场挂单 direction=DEMAND）—— 字段以其 normalize() 契约为准。 */
export interface MarketListing {
  id: string;
  userId?: string;
  direction?: string;
  demandMode?: string;
  status?: string;
  title?: string;
  description?: string;
  subcategoryId?: string | null;
  categoryId?: string | null;
  moneyMode?: string;
  currency?: string;
  amountMin?: number | null;
  amountMax?: number | null;
  unitLabel?: string | null;
  tags?: string[];
  expectedOutcome?: string | null;
  mustHaves?: string[];
  startAt?: string | null;
  deadline?: string | null;
  deliverables?: string | null;
  acceptanceCriteria?: string | null;
  referenceLinks?: string[];
  /** 仅 SUPPLY（服务亮点） */
  highlights?: string[];
  attributes?: Record<string, unknown> | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactWechat?: string | null;
  contactEmail?: string | null;
  replyEmailEnabled?: boolean;
  replyEmail?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
/** 挂单方向：DEMAND＝用户端发布需求，SUPPLY＝服务商端发布服务。 */
export type ListingDirection = 'DEMAND' | 'SUPPLY';
/** 计价方式（平台必填枚举；NEGOTIABLE 会清空金额）。 */
export type MoneyMode = 'FIXED' | 'STARTING' | 'RANGE' | 'NEGOTIABLE';
export type DeliveryMode = 'REMOTE' | 'ONSITE' | 'HYBRID';
/**
 * 服务范围（平台口径）：`NATIONWIDE` 不限制 / `REGION` 指定地区 / `RADIUS` 经纬度坐标。
 * `REMOTE`（远程交付）为平台存量取值，本平台界面不再提供，按「不限制」处理。
 */
export type ServiceAreaMode = 'REMOTE' | 'NATIONWIDE' | 'REGION' | 'RADIUS';
/** 服务范围（仅 SUPPLY 用；平台必填 serviceArea.mode）。 */
export interface ServiceAreaInput {
  mode: ServiceAreaMode;
  province?: string;
  city?: string;
  addressDetail?: string;
  longitude?: number;
  latitude?: number;
  radiusKm?: number;
}
/**
 * 需求地域匹配（仅 DEMAND 用；平台 `request.a2aConfig`）。
 * 平台只接受 `geoMatchMode ∈ {NONE, REGION, RADIUS}`，RADIUS 必须同时给经纬度与正半径；
 * 平台**不会**把坐标反解析成省市，因此 `RADIUS` 的省市由本系统解析后一并传（仅本地展示/筛选依赖）。
 */
export interface DemandGeoConfig {
  geoMatchMode: 'NONE' | 'REGION' | 'RADIUS';
  province?: string;
  city?: string;
  addressDetail?: string;
  longitude?: number;
  latitude?: number;
  radiusKm?: number;
}
/**
 * 发布草稿（DEMAND / SUPPLY 共用平台唯一入口 `POST /market/listings`）：
 * - 平台必填：`subcategoryId`（二级类目）、`moneyMode`、`title`、`description`；
 * - DEMAND 发布态还需 ≥1 种联系方式（电话 / 微信 / 邮箱）与未来截止时间；
 * - SUPPLY 发布态还需 `priceDescription`，且 `serviceArea.mode` 必填；
 * - 顶层 `categoryKey` / `locationMode` / `province` / `city` 由平台按类目与范围反推，
 *   传入会被拒（`rejectLegacyPublishFields`），因此这里不声明；
 *   地域范围同理：DEMAND 走 `a2aConfig`，SUPPLY 走 `serviceArea`。
 */
export interface DemandDraft {
  title: string;
  description: string;
  direction?: ListingDirection;
  /** AIworkin 二级类目 UUID（平台必填，见 category-catalog.ts） */
  subcategoryId?: string;
  demandMode?: 'STANDARD' | 'BOUNTY';
  moneyMode?: MoneyMode;
  /** 平台当前仅支持 AWCOIN（整数金额） */
  currency?: string;
  amountMin?: number;
  amountMax?: number;
  unitLabel?: string;
  tags?: string[];
  expectedOutcome?: string;
  mustHaves?: string[];
  startAt?: string;
  deadline?: string;
  deliverables?: string;
  acceptanceCriteria?: string;
  referenceLinks?: string[];
  attributes?: Record<string, unknown>;
  /** 需求地域范围（不限制 / 指定地区 / 经纬度坐标），必须走 a2aConfig，不能放顶层 */
  a2aConfig?: DemandGeoConfig;
  contactName?: string;
  contactPhone?: string;
  contactWechat?: string;
  contactEmail?: string;
  replyEmailEnabled?: boolean;
  replyEmail?: string;
  expiresAt?: string;
  publishAction?: 'DRAFT' | 'PUBLISH';
  // —— 以下仅 SUPPLY（服务发布）用 ——
  priceDescription?: string;
  highlights?: string[];
  cases?: string;
  deliveryMode?: DeliveryMode;
  responseTime?: string;
  qualifications?: string;
  serviceArea?: ServiceAreaInput;
}
export interface MarketListingPage {
  list: MarketListing[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PublishDemandResult {
  listing: MarketListing;
  initialMatchRunId?: string | null;
}
export interface AgentMessage {
  id: string;
  conversationId?: string;
  roundNo?: number;
  role?: string;
  content?: string;
  status?: string;
  automatic?: boolean;
  createdAt?: string;
  sentAt?: string | null;
  [key: string]: unknown;
}
export interface AgentConversation {
  id: string;
  listingId?: string;
  matchRunId?: string | null;
  status?: string;
  completedRounds?: number;
  effectiveMaxRounds?: number;
  messages?: AgentMessage[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
export interface AgentConversationPage {
  list: AgentConversation[];
  total: number;
  page: number;
  pageSize: number;
}
/** 一次匹配批次（平台 MatchRun）：会话收件箱按 `matchRunId` 归组，本系统只取号。 */
export interface MatchRun {
  id: string;
  listingId?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}
export interface MatchRunPage {
  list: MatchRun[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ConnectionProfileItem {
  kind?: string;
  titleZh?: string;
  titleEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  proofUrl?: string;
  url?: string;
  sortOrder?: number;
}
export interface IdentityDetailsInput {
  kind: 'personal' | 'company';
  occupationTitle?: string;
  experienceRange?: string;
  organizationName?: string;
  industryKey?: string;
  companySizeKey?: string;
  foundedYear?: number;
  websiteUrl?: string;
}
/** 企业档案（AIworkin /connections/profile）保存入参：全量替换语义。 */
export interface ConnectionProfileInput {
  primaryLocale?: string;
  publicNameZh?: string;
  publicNameEn?: string;
  headlineZh?: string;
  headlineEn?: string;
  introductionZh?: string;
  introductionEn?: string;
  tagsZh?: string[];
  tagsEn?: string[];
  avatarOrLogoUrl?: string;
  province?: string;
  city?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactWechat?: string;
  emailVisible?: boolean;
  phoneVisible?: boolean;
  wechatVisible?: boolean;
  identityDetails?: IdentityDetailsInput;
  capabilities?: ConnectionProfileItem[];
  credentials?: ConnectionProfileItem[];
  cases?: ConnectionProfileItem[];
  links?: ConnectionProfileItem[];
}
export interface ConnectionProfile {
  userId?: string;
  profileId?: string | null;
  accountType?: string;
  slug?: string;
  displayEnabled?: boolean;
  connectionMarketEnabled?: boolean;
  primaryLocale?: string;
  publicNameZh?: string | null;
  publicNameEn?: string | null;
  headlineZh?: string | null;
  headlineEn?: string | null;
  introductionZh?: string | null;
  introductionEn?: string | null;
  tagsZh?: string[];
  tagsEn?: string[];
  avatarOrLogoUrl?: string | null;
  province?: string | null;
  city?: string | null;
  identityDetails?: IdentityDetailsInput | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWechat?: string | null;
  emailVisible?: boolean;
  phoneVisible?: boolean;
  wechatVisible?: boolean;
  capabilities?: ConnectionProfileItem[];
  credentials?: ConnectionProfileItem[];
  cases?: ConnectionProfileItem[];
  links?: ConnectionProfileItem[];
  completeness?: Record<string, unknown>;
  updatedAt?: string;
  [key: string]: unknown;
}
export interface ApiKeyRecord {
  id: string;
  name?: string;
  enabled?: boolean;
  fullKey?: string;
  key?: string;
  [key: string]: unknown;
}
