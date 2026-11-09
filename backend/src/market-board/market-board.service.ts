import { CursorCache } from '../common/cursor-cache';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { DemandQuery, DemandService } from '../aiworkin/demand.service';
import {
  buildDraftFromFields,
  splitList,
  toChannelConversation,
} from '../aiworkin/demand-sync.service';
import {
  AgentConversation,
  DemandDraft,
  DemandGeoConfig,
  MarketListing,
  MarketListingPage,
  MoneyMode,
  PublishDemandResult,
  ServiceAreaInput,
} from '../aiworkin/aiworkin.types';
import {
  MarketCategoryModule,
  categoryLabels,
  hubSubCategoryId,
  leafById,
  marketplacePoolScope,
  moduleCategory,
  poolCategoryKey,
  requireSubCategoryId,
} from '../aiworkin/category-catalog';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import {
  CATEGORY_LABELS,
  MARKETPLACE_DOMAINS,
  PLATFORM_DIRECT_DOMAINS,
  SERVICE_PUBLISH_CATEGORY_BY_DOMAIN,
  SUBITEM_CATEGORY_LABELS,
} from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { ContactResolver } from '../shared/contacts.service';
import {
  MarketListingRecordService,
  recordToListing,
} from './market-listing-record.service';
import {
  ContactPair,
  contactStr,
  mergeContact,
  readContact,
} from '../shared/contacts';
import { ChannelConversation } from '../shared/channel-message';
import {
  RegionFilter,
  RegionScope,
  demandGeoConfig,
  regionForCreate,
  regionFromServiceBody,
  serviceAreaPayload,
} from '../shared/region-scope';
/** 平台 `pageParam` 上限 200，这里取 100 并限页，避免把整个市场拖进一次列表请求。 */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
/** 供需市场（跨板块）：接口仍走 `/enterprise/market/:domain/...`，HUB 表示不按板块收窄。 */
export const MARKET_HUB_DOMAIN = 'HUB';
/**
 * 列表筛选：地域（省 / 市）＋类目（二级类目 id）。
 * `categoryId` 只有供需市场会传（跨板块公开池按二级类目收窄）；单一板块的看板/市集
 * 已由板块本身收窄，不传该参数。
 */
export type MarketListFilter = RegionFilter & {
  categoryId?: string;
  /**
   * 取数范围：`all`＝只扫 AIworkin 公开池，`mine`＝只读本地发布台账（「我发布的」）。
   * 供需市场用它切「全部 / 我发布的」；不传＝各板块既有口径。
   */
  scope?: 'all' | 'mine';
};
/** 自有行补取的并发上限（列表行的联系方式平台已脱敏，要逐条读属主详情）。 */
const DETAIL_CONCURRENCY = 8;
const MONEY_MODES: MoneyMode[] = ['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'];
const DELIVERY_MODES = ['REMOTE', 'ONSITE', 'HYBRID'];
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20000;
/** 平台的挂单编号一律是 UUID；畸形编号在本地挡住，别让平台的 5xx 变成界面中的「服务器内部错误」。 */
const LISTING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 需求看板行：字段名与前端 `DemandFields` 一一对应，页面 `toDemand` 直接透传。
 * `id` 是平台挂单 UUID（本系统无单号，列表「需求编号」列显示它）。
 */
export type MarketDemandRow = {
  id: string;
  listingId: string;
  mine: boolean;
  status: string;
  subCategoryId: string;
  category1: string;
  category2: string;
  title: string;
  description: string;
  tags: string;
  budget: string;
  expectedOutcome: string;
  mustHaves: string;
  startAt: string;
  deadline: string;
  regionScope: string;
  regionMode: string;
  province: string;
  city: string;
  longitude: number | null;
  latitude: number | null;
  radiusKm: number | null;
  contactName: string;
  contactPhone: string;
  contactWechat: string;
  contactEmail: string;
  emailSync: number;
  conversationCount: number | null;
  createdAt: string;
};
/** 服务发布行：沿用 `ServicePublishTab` 的字段名，`id` 同为平台挂单 UUID。 */
export type MarketServiceRow = {
  id: string;
  listingId: string;
  mine: boolean;
  status: string;
  subCategoryId: string;
  category1: string;
  category2: string;
  credentialTypes: string;
  title: string;
  description: string;
  tags: string;
  moneyMode: string;
  amountMin: number;
  amountMax: number;
  unitLabel: string;
  priceDescription: string;
  serviceAreaMode: string;
  province: string;
  city: string;
  longitude: number | null;
  latitude: number | null;
  radiusKm: number | null;
  deliveryMode: string;
  responseTime: string;
  qualifications: string;
  highlights: string[];
  cases: string;
  referenceLinks: string[];
  contactName: string;
  contactPhone: string;
  contactWechat: string;
  contactEmail: string;
  createdAt: string;
};
type MarketPage = {
  list: (MarketDemandRow | MarketServiceRow)[];
  nextCursor: string | null;
  hasMore: boolean;
};
type MarketScanState = {
  source: 'mine' | 'pool' | 'done';
  minePage: number;
  poolPage: number;
  buffer: (MarketDemandRow | MarketServiceRow)[];
  seen: string[];
};
type PageFetcher = (
  query: DemandQuery,
) => Promise<MarketListingPage | null | undefined>;
/**
 * 平台直连看板（财税 / 供销 / 出海）：「需求信息」与「服务发布」的**发布**走 AIworkin MCP
 * （REST 写被平台 401 拦死），**本地留台账**（`market_listing_records`，存平台挂单号），
 * 列表与明细再按挂单号读回平台公开池；本系统不审核发布内容的资质（2026-09-26 用户口径：
 * 本系统只审「能不能成为服务商」）。其余板块仍是本地台账 + 通道同步，等 #227 再统一切到
 * 平台数据源；这些板块再走本地台账路由的写入已在 `services.service.ts` 拒收
 * （写进去就是任何看板都读不到的孤行）。
 *
 * 出海（2026-09-26 并入）只用「需求信息」：该板块的「服务发布」界面未开，但接口与门控
 * 同口径，不留未门控的发布路径。
 *
 * 需求列表 = 我发布的（本地台账按本板块筛）∪ 平台公开池
 * （`/market/listings?category=一级类目key&province=&city=`）。
 *
 * 为什么「我发布的」不能读平台：`GET /market/listings/mine`（与 `/mine/{id}`）对 API Key
 * 一律 401，谁扫谁整页报「通道鉴权失败」（2026-11-09 实测）。平台也没开放按属主读回挂单，
 * 所以本地台账就是归属的唯一来源。
 *
 * 已发布到平台的挂单**不支持在本系统改删**（2026-11-09 用户裁定）：平台 REST 写
 * （PATCH / DELETE）对 API Key 一律 401，MCP 也没有修改/删除工具，改删只会造成本地与
 * 平台不一致，所以这些行只给「查看」。
 *
 * 凭证口径：列表 / 明细这类「平台数据」走基础数据通道（平台 Key 优先，未配置回落本人
 * 绑定 Key），平台配一次 Key 后未绑定的用户也能浏览；**发布**必须用本人绑定的 Key
 * （平台把挂单挂在本人 Key 对应的 AIworkin 域下）。
 */
export class MarketBoardService {
  private readonly cursors = new CursorCache<MarketScanState>();
  private readonly pages = new Map<
    string,
    { expires: number; promise: Promise<MarketPage> }
  >();
  private async page(
    user: CurrentUser,
    module: MarketCategoryModule | null,
    ownerTag: string,
    poolToken: string,
    direction: 'DEMAND' | 'SUPPLY',
    filter: MarketListFilter,
    cursor?: string,
    pageSize = 20,
    scope: 'all' | 'mine' = 'mine',
    poolScope: 'parent' | 'leaf' = 'leaf',
  ): Promise<MarketPage> {
    // 本地台账（scope=mine）整页只读本系统 `market_listing_records`，不碰平台通道，
    // 因此未配平台 Key 也能列「我发布的」；只有读公开池（scope=all）才校验通道。
    if (scope === 'all') this.requireChannel();
    // `module=null` 即供需市场：列表只按方向收窄，不限定单一板块的二级类目。
    const owner = createHash('sha256')
      .update(
        JSON.stringify([
          user.userId,
          await this.identity.currentIdentity(user),
          ownerTag,
          direction,
          filter,
          pageSize,
        ]),
      )
      .digest('hex');
    const state: MarketScanState = cursor
      ? this.cursors.get(owner, cursor)
      : {
          source: scope === 'all' ? 'pool' : 'mine',
          minePage: 1,
          poolPage: 1,
          buffer: [],
          seen: [],
        };
    for (const [id, page] of this.pages)
      if (page.expires <= Date.now()) this.pages.delete(id);
    const key = cursor ? `${owner}:${cursor}` : '';
    const cached = this.pages.get(key);
    if (cached) return cached.promise;
    const load = async () => {
      // Clone: a failed upstream call must leave the input cursor replayable.
      const next: MarketScanState = {
        ...state,
        buffer: [...state.buffer],
        seen: [...state.seen],
      };
      const seen = new Set(next.seen);
      /**
       * 公开池的一级类目参数：单一板块按板块的一级类目收窄；供需市场选了二级类目时
       * 按该叶子的父类目收窄（平台未收录该一级类目则不带，回落到本地叶子精确过滤）。
       */
      const category = module
        ? module.poolFilterable !== false
          ? module.parentKey
          : undefined
        : filter.categoryId
          ? poolCategoryKey(filter.categoryId)
          : undefined;
      let scans = 0;
      const list: (MarketDemandRow | MarketServiceRow)[] = [];
      while (list.length < pageSize) {
        if (next.buffer.length) {
          list.push(next.buffer.shift()!);
          continue;
        }
        if (next.source === 'done' || scans >= 5) break;
        const mine = next.source === 'mine';
        const page = mine ? next.minePage++ : next.poolPage++;
        const result = mine
          ? await this.localMinePage(user.userId, module, direction, page)
          : await this.demands.listPublic(poolToken, {
              page,
              pageSize: PAGE_SIZE,
              direction,
              // 平台未收录该板块一级类目时不带 `category`（会被判 400 请求参数错误）。
              category,
              province: filter.province,
              city: filter.city,
            });
        scans++;
        if (!result || !Array.isArray(result.list))
          throw new BusinessException(
            ErrorCode.AIWORKIN_UNAVAILABLE,
            '平台未返回有效列表',
          );
        const scoped = !module
          ? this.inDirection(direction, result.list)
          : mine || direction === 'DEMAND' || poolScope === 'leaf'
            ? this.inModule(module, direction, result.list)
            : this.inPoolModule(module, result.list);
        for (const item of scoped) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const row =
            direction === 'DEMAND'
              ? toDemandRow(item, mine)
              : toServiceRow(item, mine);
          if (
            matchesRegion(row, filter) &&
            matchesCategory(row, filter.categoryId)
          )
            next.buffer.push(row);
        }
        const upstreamSize = Number(result.pageSize) || PAGE_SIZE;
        const exhausted =
          Number.isFinite(result.total) && result.total >= result.list.length
            ? page * upstreamSize >= result.total
            : result.list.length < upstreamSize;
        if (exhausted) next.source = 'done';
        if (seen.size > 10000)
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '本次扫描量过大，请缩小筛选范围后重新加载',
          );
      }
      next.seen = [...seen];
      const hasMore = next.buffer.length > 0 || next.source !== 'done';
      return {
        list,
        nextCursor: hasMore ? this.cursors.put(owner, next) : null,
        hasMore,
      };
    };
    const pending = load();
    if (key) {
      this.pages.set(key, { expires: Date.now() + 300000, promise: pending });
      while (this.pages.size > 128) {
        const [oldest] = this.pages.keys();
        if (oldest) this.pages.delete(oldest);
      }
      void pending.catch(() => this.pages.delete(key));
    }
    return pending;
  }
  /**
   * 「我发布的」一页：来自本地发布台账（存平台挂单号），不再打平台的 `/market/listings/mine`
   * —— 那个接口对 API Key 一律 401，扫它只会让整页报「通道鉴权失败」。
   * 台账是内存以外的小数据（一个账号在一个板块的一个方向），一次全量给完，上游不参与分页。
   */
  private async localMinePage(
    userId: string,
    module: MarketCategoryModule | null,
    direction: 'DEMAND' | 'SUPPLY',
    page: number,
  ): Promise<MarketListingPage> {
    if (page > 1) return { list: [], total: 0, page, pageSize: 1 };
    const domain = module ? module.domain : MARKET_HUB_DOMAIN;
    const rows = await this.records.list(userId, domain, direction);
    const list = rows.map((row) => recordToListing(row, domain));
    return {
      list,
      total: list.length,
      page: 1,
      pageSize: Math.max(list.length, 1),
    };
  }
  async detail(
    user: CurrentUser,
    domain: string,
    id: string,
    poolToken: string,
    direction: 'DEMAND' | 'SUPPLY',
  ) {
    if (this.isHub(domain)) return this.hubDetail(id, poolToken, direction);
    const module = this.moduleOf(domain);
    this.requireChannel();
    if (!LISTING_ID_PATTERN.test(id))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '挂单编号格式不正确');
    // 归属只看本地台账（平台没有可按属主读回挂单的接口）；内容按挂单号读平台公开池，
    // 平台读不回（草稿 / 已下架）时用台账快照回显。
    const record = await this.records.find(user.userId, id);
    let listing: MarketListing | undefined;
    try {
      listing = await this.demands.getPublic(poolToken, id);
    } catch (error) {
      if (!record) throw error;
    }
    if (!listing && record) listing = recordToListing(record, module.domain);
    if (!listing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该板块下未找到挂单');
    if (!this.inModule(module, direction, [listing]).length)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该板块下未找到挂单');
    const mine = Boolean(record);
    return direction === 'DEMAND'
      ? toDemandRow(listing, mine)
      : toServiceRow(listing, mine);
  }
  /** 供需市场明细：跨板块，只读平台公开池（平台 Key），不做板块类目收窄。 */
  private async hubDetail(
    id: string,
    poolToken: string,
    direction: 'DEMAND' | 'SUPPLY',
  ) {
    this.requireChannel();
    if (!LISTING_ID_PATTERN.test(id))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '挂单编号格式不正确');
    // 只走公开池：供需市场的行都来自公开池，读取用平台 Key，绝不带本人 Key 打 `/market/listings/mine`。
    const listing = await this.demands.getPublic(poolToken, id);
    if (String(listing.direction || '').toUpperCase() !== direction)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该方向下未找到挂单');
    return direction === 'DEMAND'
      ? toDemandRow(listing, false)
      : toServiceRow(listing, false);
  }

  constructor(
    private readonly client: AiworkinClient,
    private readonly demands: DemandService,
    private readonly identity: IdentityService,
    private readonly contacts: ContactResolver,
    private readonly records: MarketListingRecordService,
  ) {}
  // —— 需求信息（direction=DEMAND）——
  async listDemands(
    user: CurrentUser,
    domain: string,
    poolToken: string,
    filter: MarketListFilter = {},
    cursor?: string,
    pageSize = 20,
  ) {
    if (this.isHub(domain))
      return this.page(
        user,
        null,
        `${MARKET_HUB_DOMAIN}:demands`,
        // 需求读取一律走基础数据通道（平台 Key）：公开池与自有行都按挂单号读回平台。
        poolToken,
        'DEMAND',
        filter,
        cursor,
        pageSize,
        // 供需市场按 scope 切「全部需求 / 我发布的需求」；不传＝只扫公开池（既有口径）。
        filter.scope ?? 'all',
      );
    // 直连板块（财税 / 供销 / 出海）：需求列表＝本地发布台账（与同板块服务列表同口径），
    // 平台公开池不进这张表；发布时仍同步 AIworkin 并记回挂单号（内容 ID）。
    return this.page(
      user,
      this.moduleOf(domain),
      domain,
      poolToken,
      'DEMAND',
      filter,
      cursor,
      pageSize,
      filter.scope ?? 'mine',
    );
  }
  async createDemand(
    user: CurrentUser,
    domain: string,
    body: Record<string, unknown>,
    token: string,
  ) {
    // 供需市场是跨板块公开市集：不做单一板块的发布资质门控，其余板块沿用原口径。
    const module = this.isHub(domain)
      ? null
      : await this.requireDemandAction(user, domain);
    this.requireChannel();
    if (module) await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const draft = await this.demandDraft(user, module, body);
    const result = await this.demands.publish(token, draft);
    await this.recordListing(user, module, 'DEMAND', draft, result);
    const where = module ? `${module.label}板块` : '供需市场';
    return {
      id: result.listing.id,
      listing_id: result.listing.id,
      status: String(result.listing.status || 'ONLINE'),
      tip:
        result.listing.status === 'DRAFT'
          ? `需求已存为平台草稿（补齐截止时间后即可发布匹配）`
          : `需求已发布至 AIworkin ${where}`,
    };
  }
  async updateDemand(
    user: CurrentUser,
    domain: string,
    id: string,
    body: Record<string, unknown>,
    token: string,
  ) {
    const module = this.isHub(domain)
      ? null
      : await this.requireDemandAction(user, domain);
    this.requireChannel();
    const existing = await this.requireOwn(token, id);
    const draft = await this.demandDraft(user, module, body, existing);
    await this.demands.updateListing(token, id, draft, editKey(id, draft));
    return { id, tip: '修改已同步至 AIworkin 平台' };
  }
  async removeDemand(
    user: CurrentUser,
    domain: string,
    id: string,
    token: string,
  ) {
    if (!this.isHub(domain)) await this.requireDemandAction(user, domain);
    this.requireChannel();
    await this.requireOwn(token, id);
    await this.demands.removeListing(token, id);
    return { id, deleted: true };
  }
  /**
   * 一条自有需求的会话清单（一位回复方一条）：平台的收件箱不给 `listingId`，
   * 因此按「本单的匹配批次 ∩ 收件箱」定位，再逐条取详情拿消息正文。
   */
  async demandMessages(
    user: CurrentUser,
    domain: string,
    id: string,
    token: string,
  ): Promise<{
    listingId: string;
    conversations: ChannelConversation[];
  }> {
    if (!this.isHub(domain)) this.moduleOf(domain);
    this.requireChannel();
    await this.requireOwn(token, id);
    const runIds = await this.matchRunIds(token, id);
    const hits = (await this.collectConversations(token)).filter((item) =>
      ownsConversation(item, id, runIds),
    );
    const conversations = await mapBounded(
      hits,
      DETAIL_CONCURRENCY,
      async (item) =>
        toChannelConversation(
          await this.demands.getConversation(token, item.id),
        ),
    );
    return { listingId: id, conversations };
  }
  // —— 服务发布（direction=SUPPLY）——
  /**
   * 其余板块：本栏目只列「我已发布的服务」，公开池不进这张表。
   * 供需市场：公开市集，列表 = 平台公开池（读取只用平台 Key，不扫「我发布的」）。
   */
  async listServices(
    user: CurrentUser,
    domain: string,
    poolToken: string,
    filter: MarketListFilter = {},
    cursor?: string,
    pageSize = 20,
  ) {
    if (this.isHub(domain))
      return this.page(
        user,
        null,
        `${MARKET_HUB_DOMAIN}:services`,
        // 供需市场列表＝平台公开池（默认）；按 scope 切「全部服务 / 我发布的服务」。
        poolToken,
        'SUPPLY',
        filter,
        cursor,
        pageSize,
        filter.scope ?? 'all',
      );
    // 其余板块只列「我已发布的服务」：读本地台账，平台公开池不进这张表。
    return this.page(
      user,
      this.moduleOf(domain),
      domain,
      poolToken,
      'SUPPLY',
      filter,
      cursor,
      pageSize,
      filter.scope ?? 'mine',
    );
  }
  /**
   * 「××服务市集」＝服务发布栏目的平台口径（营销 / 出海 / 灵工 / IT / 知产 / 法律 / 智库）：
   * 列表读 AIworkin 的 SUPPLY 公开池，展示全平台服务商在该板块已发布的服务，
   * **不落一行本地数据、也不做主体/类目门控**（市集＝公开逛，所有登录用户可见）。
   * 与「服务发布」栏目的区别：本方法只从 `pool` 起步（不看 `mine`），板块解析
   * 走 `marketplaceModule`（放行七个市集板块，绕过平台直连看板专用的 `domainKey`），
   * 且按 `marketplacePoolScope` 决定公开池是按一级类目整棵子树还是按本板块二级类目收窄。
   * 发布 / 修改 / 删除仍走本系统台账（`/enterprise/services`），见前端 `ServicePublishTab`。
   */
  async listMarketplace(
    user: CurrentUser,
    domain: string,
    poolToken: string,
    filter: RegionFilter = {},
    cursor?: string,
    pageSize = 20,
  ) {
    const module = this.marketplaceModule(domain);
    return this.page(
      user,
      module,
      `marketplace:${domain}`,
      poolToken,
      'SUPPLY',
      filter,
      cursor,
      pageSize,
      'all',
      marketplacePoolScope(module),
    );
  }
  /** 服务市集明细：只读公开池挂单（非属主），因此只走 `getPublic`，不补属主详情。 */
  async marketplaceDetail(
    user: CurrentUser,
    domain: string,
    id: string,
    poolToken: string,
  ) {
    const module = this.marketplaceModule(domain);
    this.requireChannel();
    if (!LISTING_ID_PATTERN.test(id))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '挂单编号格式不正确');
    const listing = await this.demands.getPublic(poolToken, id);
    const hit =
      marketplacePoolScope(module) === 'parent'
        ? this.inPoolModule(module, [listing])
        : this.inModule(module, 'SUPPLY', [listing]);
    if (!hit.length)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该板块下未找到已发布服务',
      );
    return toServiceRow(listing, false);
  }
  async createService(
    user: CurrentUser,
    domain: string,
    body: Record<string, unknown>,
    token: string,
  ) {
    // 供需市场是跨板块公开市集：不做单一板块的服务商备案门控。
    const module = this.isHub(domain) ? null : this.moduleOf(domain);
    this.requireChannel();
    if (module) await this.assertPublishAllowed(user, module.domain);
    const draft = await this.serviceDraft(user, module, body);
    const result = await this.demands.publish(token, draft);
    await this.recordListing(user, module, 'SUPPLY', draft, result);
    const where = module ? `${module.label}板块` : '供需市场';
    return {
      id: result.listing.id,
      platform_listing_id: result.listing.id,
      status: String(result.listing.status || 'ONLINE'),
      tip:
        result.listing.status === 'DRAFT'
          ? `${where}服务已存为平台草稿（补齐报价说明后即可发布）`
          : `服务已发布至 AIworkin ${where}`,
    };
  }
  async updateService(
    user: CurrentUser,
    domain: string,
    id: string,
    body: Record<string, unknown>,
    token: string,
  ) {
    const module = this.isHub(domain) ? null : this.moduleOf(domain);
    this.requireChannel();
    if (module) await this.assertPublishAllowed(user, module.domain);
    const existing = await this.requireOwn(token, id);
    const draft = await this.serviceDraft(user, module, body, existing);
    await this.demands.updateListing(token, id, draft, editKey(id, draft));
    return { id, tip: '修改已同步至 AIworkin 平台' };
  }
  async removeService(
    user: CurrentUser,
    domain: string,
    id: string,
    token: string,
  ) {
    if (!this.isHub(domain)) this.moduleOf(domain);
    this.requireChannel();
    await this.requireOwn(token, id);
    await this.demands.removeListing(token, id);
    return { id, deleted: true };
  }
  // —— 板块 / 通道 / 属主 ——

  /**
   * 板块解析：只放行平台直连的板块，其余板块走本地台账（#227 前不双开一条发布路径）。
   * 这里不做主体类型门控——个人主体照常浏览需求信息；门控只落在「发布需求」上
   * （见 `requireDemandAction`）。
   */
  private moduleOf(value: unknown) {
    const key = this.domainKey(value);
    return moduleCategory(key);
  }

  /** 供需市场＝跨板块公开市集：同一套接口，`HUB` 只表示不按单一板块收窄。 */
  private isHub(value: unknown) {
    return (
      text(value || '')
        .trim()
        .toUpperCase() === MARKET_HUB_DOMAIN
    );
  }

  /** 供需市场的行归属：只按方向收窄，不限定板块类目。 */
  private inDirection(direction: 'DEMAND' | 'SUPPLY', rows: MarketListing[]) {
    return rows.filter(
      (item) =>
        item.id && String(item.direction || '').toUpperCase() === direction,
    );
  }

  /**
   * 服务市集板块解析：与 `moduleOf` 分开——平台直连看板只放行 TAX/SUPPLY/OVERSEAS，
   * 而市集是只读公开浏览，需放行 `MARKETPLACE_DOMAINS`（物流 / 营销 / 出海 / 灵工 /
   * IT / 知产 / 法律 / 智库）。类目镜像（`moduleCategory`）本就覆盖全部十一个域，
   * 这里只放宽白名单，不改类目树。
   */
  private marketplaceModule(value: unknown) {
    const key = text(value || '')
      .trim()
      .toUpperCase();
    if (!MARKETPLACE_DOMAINS.includes(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `板块不合法：${text(value || '')}（服务市集只开放 ${MARKETPLACE_DOMAINS.join(' / ')}）`,
      );
    }
    return moduleCategory(key);
  }

  private domainKey(value: unknown) {
    const key = text(value || '')
      .trim()
      .toUpperCase();
    if (!PLATFORM_DIRECT_DOMAINS.includes(key)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `板块不合法：${text(value || '')}（平台直连只开放 ${PLATFORM_DIRECT_DOMAINS.join(' / ')}）`,
      );
    }
    return key;
  }

  /**
   * 发布 / 修改 / 撤回需求属于办理动作：**个人主体不开放财税与出海的需求发布**。
   * 口径是「放开整页、只锁办理」——浏览名录与「申请加入服务商」照常放行。
   */
  private async requireDemandAction(user: CurrentUser, value: unknown) {
    const key = this.domainKey(value);
    if (key === 'TAX') {
      await this.identity.requireSubjectService(user, '财税服务');
    }
    if (key === 'OVERSEAS') {
      await this.identity.requireSubjectService(user, '跨境出海');
    }
    return moduleCategory(key);
  }
  private requireChannel() {
    if (!this.client.isEnabled()) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        'AIworkin 能力暂不可用',
      );
    }
  }
  /** 属主前置：平台的属主详情读不到，就不是这张单的属主（改删与看消息同一判据）。 */
  private async requireOwn(token: string, id: string) {
    const listingId = String(id || '').trim();
    if (!listingId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少挂单编号');
    }
    // 平台单号一律是 UUID：畸形编号在这里挡住，否则平台的 /mine/:id 回 5xx，
    // 界面只能显示「服务器内部错误」（改删与看消息同一判据）。
    if (!LISTING_ID_PATTERN.test(listingId)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '挂单编号格式不合法');
    }
    try {
      return await this.demands.getMine(token, listingId);
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode === ErrorCode.NOT_FOUND
      ) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '该挂单不存在，或不属于当前账号',
        );
      }
      throw error;
    }
  }
  /** 列表行的联系方式平台已脱敏，自有行补读属主详情拿明文与完整地域。 */
  private async ownDetail(token: string, listingId: string) {
    try {
      return await this.demands.getMine(token, listingId);
    } catch {
      // 并发下架：列表刚取到、详情已读不到，按列表行展示即可
      return null;
    }
  }
  /** 平台 `/mine` 不接受类目过滤，板块级筛选在这里做（二级类目属本板块才进列表）。 */
  private inModule(
    module: MarketCategoryModule,
    direction: 'DEMAND' | 'SUPPLY',
    rows: MarketListing[],
  ) {
    const ids = new Set(module.children.map((item) => item.id));
    return rows.filter(
      (item) =>
        item.id &&
        String(item.direction || '').toUpperCase() === direction &&
        ids.has(String(item.subcategoryId || '')),
    );
  }
  /**
   * 服务市集的公开池归属判定：按挂单自带的一级类目 key（`categoryKey`）。
   * 一个板块在平台侧是一整棵一级子树，本系统只镜像其中一部分二级类目作发布出口，
   * 按二级类目收窄会把同行服务商在该板块已发布的服务全部隐藏；共用同一父类目的
   * 板块（财税／知产／灵工）不适用本判定，见 `marketplacePoolScope`。
   */
  private inPoolModule(module: MarketCategoryModule, rows: MarketListing[]) {
    const ids = new Set(module.children.map((item) => item.id));
    return rows.filter(
      (item) =>
        item.id &&
        String(item.direction || '').toUpperCase() === 'SUPPLY' &&
        (text(item.categoryKey) === module.parentKey ||
          ids.has(String(item.subcategoryId || ''))),
    );
  }
  // —— 报文 ——
  private async demandDraft(
    user: CurrentUser,
    module: MarketCategoryModule | null,
    body: Record<string, unknown>,
    existing?: MarketListing | null,
  ): Promise<DemandDraft> {
    const title = this.requireText(body.title, '需求标题', TITLE_MAX);
    const description = this.requireText(
      body.description || title,
      '详细说明',
      DESCRIPTION_MAX,
    );
    const region = regionForCreate(body);
    const pair = await this.publishContact(user, body);
    return buildDraftFromFields(
      {
        ...body,
        title,
        description,
        contact_name: pair.name,
        contact_phone: pair.phone,
      },
      {
        title,
        categoryLabel: module ? module.parentName : '供需市场',
        subcategoryId: module
          ? requireSubCategoryId(
              module.domain,
              body.sub_category_id ?? existing?.subcategoryId,
            )
          : hubSubCategoryId(body.sub_category_id ?? existing?.subcategoryId),
        attributes: { board: module ? module.domain : MARKET_HUB_DOMAIN },
        a2aConfig: demandGeoConfig(regionColumnsOf(region)),
      },
    );
  }
  private async serviceDraft(
    user: CurrentUser,
    module: MarketCategoryModule | null,
    body: Record<string, unknown>,
    existing?: MarketListing | null,
  ): Promise<DemandDraft> {
    const title = this.requireText(body.title, '服务标题', TITLE_MAX);
    const description = this.requireText(
      body.description,
      '服务说明',
      DESCRIPTION_MAX,
    );
    const moneyMode = text(body.money_mode || '').toUpperCase();
    if (!MONEY_MODES.includes(moneyMode as MoneyMode)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择计价方式（固定价格 / 起价 / 区间 / 面议）',
      );
    }
    const amounts = normalizeAmounts(
      moneyMode as MoneyMode,
      body.amount_min,
      body.amount_max,
    );
    const deliveryMode = text(body.delivery_mode || '').toUpperCase();
    if (deliveryMode && !DELIVERY_MODES.includes(deliveryMode)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '交付方式取值不合法');
    }
    const region = regionFromServiceBody(body);
    const pair = await this.publishContact(user, body);
    const draft: DemandDraft = {
      title,
      description,
      direction: 'SUPPLY',
      subcategoryId: module
        ? requireSubCategoryId(
            module.domain,
            body.sub_category_id ?? existing?.subcategoryId,
          )
        : hubSubCategoryId(body.sub_category_id ?? existing?.subcategoryId),
      publishAction:
        text(body.publish_action || '').toUpperCase() === 'DRAFT'
          ? 'DRAFT'
          : 'PUBLISH',
      moneyMode: moneyMode as MoneyMode,
      currency: 'AWCOIN',
      tags: splitList(text(body.tags || '')),
      unitLabel: contactStr(body.unit_label) || undefined,
      priceDescription: contactStr(body.price_description) || undefined,
      highlights: splitList(text(body.highlights || '')),
      cases: contactStr(body.cases) || undefined,
      referenceLinks: splitList(text(body.reference_links || '')),
      deliveryMode: (deliveryMode || undefined) as DemandDraft['deliveryMode'],
      responseTime: contactStr(body.response_time) || undefined,
      qualifications: contactStr(body.qualifications) || undefined,
      serviceArea: serviceAreaPayload({
        ...regionColumnsOf(region),
        serviceAreaMode: region.mode,
      }),
      contactName: pair.name || undefined,
      contactPhone: pair.phone || undefined,
      contactWechat:
        contactStr(body.contact_wechat ?? body.contactWechat) || undefined,
      contactEmail:
        contactStr(body.contact_email ?? body.contactEmail) || undefined,
      attributes: { board: module ? module.domain : MARKET_HUB_DOMAIN },
    };
    if (amounts.amountMin !== undefined) draft.amountMin = amounts.amountMin;
    if (amounts.amountMax !== undefined) draft.amountMax = amounts.amountMax;
    return draft;
  }
  /**
   * 发布成功即落本地台账：平台挂单号 + 提交报文快照。
   * 列表的「我发布的」与明细都以它为准（平台没有可按属主读回挂单的接口）。
   */
  private async recordListing(
    user: CurrentUser,
    module: MarketCategoryModule | null,
    direction: 'DEMAND' | 'SUPPLY',
    draft: DemandDraft,
    result: PublishDemandResult,
  ) {
    await this.records.record({
      userId: user.userId,
      domain: module ? module.domain : MARKET_HUB_DOMAIN,
      direction,
      listingId: result.listing.id,
      matchRunId: String(result.initialMatchRunId || ''),
      status: String(result.listing.status || 'ONLINE'),
      title: draft.title,
      subCategoryId: draft.subcategoryId || '',
      snapshot: draft,
    });
  }
  /** 联系方式：按发布人档案自动带出，入参显式给出的逐字段覆盖（临时换人可改）。 */
  private async publishContact(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<ContactPair> {
    const provider = await this.contacts.provider(user.userId, user.userId);
    const auto =
      provider.name || provider.phone
        ? provider
        : await this.contacts.enterprise(user.userId, 0);
    return mergeContact(auto, readContact(body, 'contact'));
  }
  private requireText(value: unknown, label: string, max: number) {
    const normalized = text(value ?? '').trim();
    if (!normalized) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, `请填写${label}`);
    }
    if (normalized.length > max) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${label}不可超过 ${max} 字`,
      );
    }
    return normalized;
  }
  /**
   * 「服务发布」门控（与其余六板块同口径）：服务商身份 + 该板块类目**备案**通过。
   * 审的是「能不能成为服务商」；发布内容所需资质的核验在平台侧，本系统不复制。
   * 文案取整块业务名（`SUBITEM_CATEGORY_LABELS`）：出海的备案类目 EXPORT_REFUND 同时也是
   * 「出口退税」细项，直接用 `CATEGORY_LABELS` 会把细项名当成板块名说出来。
   */
  private async assertPublishAllowed(user: CurrentUser, domain: string) {
    const category = SERVICE_PUBLISH_CATEGORY_BY_DOMAIN[domain];
    if (!category) return;
    const label =
      SUBITEM_CATEGORY_LABELS[category] ||
      CATEGORY_LABELS[category] ||
      category;
    if ((await this.identity.currentIdentity(user)) !== 'SERVICE_PROVIDER') {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        `${label}的「服务发布」只对服务商身份开放：请先在右上角切换到「服务商」身份`,
      );
    }
    if (!(await this.identity.hasServiceType(user.userId, category))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `未通过${label}备案审核，无法在该板块发布服务`,
      );
    }
  }
  // —— 翻页与映射 ——
  private async collectPages(fetcher: PageFetcher) {
    const list: MarketListing[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await fetcher({ page, pageSize: PAGE_SIZE });
      const rows = result?.list || [];
      list.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return list;
  }
  /** 会话收件箱：平台一条会话只给摘要（不含消息正文），按页取回后由调用方筛归属。 */
  private async collectConversations(
    token: string,
  ): Promise<AgentConversation[]> {
    const list: AgentConversation[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.demands.listConversations(token, {
        page,
        pageSize: PAGE_SIZE,
      });
      const rows = result?.list || [];
      list.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return list;
  }
  private async matchRunIds(token: string, listingId: string) {
    const runs = await this.demands
      .listMatchRuns(token, listingId)
      .catch(() => null);
    return new Set((runs?.list || []).map((item) => String(item.id)));
  }
  /**
   * 自有行的「查看消息（n）」：收件箱只取一次，本单的匹配批次逐单查。
   * 平台的收件箱不给 `listingId`，因此 n 只对「本账号自己发的单」精确。
   */
  private async conversationCounts(
    token: string,
    owned: MarketListing[],
  ): Promise<number[]> {
    if (!owned.length) return [];
    const inbox = await this.collectConversations(token).catch(() => []);
    if (!inbox.length) return owned.map(() => 0);
    return mapBounded(owned, DETAIL_CONCURRENCY, async (listing) => {
      const runIds = await this.matchRunIds(token, listing.id);
      return inbox.filter((item) => ownsConversation(item, listing.id, runIds))
        .length;
    });
  }
  private async decorateDemands(
    token: string,
    listings: MarketListing[],
    mine: boolean,
  ): Promise<MarketDemandRow[]> {
    return mapBounded(listings, DETAIL_CONCURRENCY, async (listing) =>
      toDemandRow(
        mine ? (await this.ownDetail(token, listing.id)) || listing : listing,
        mine,
      ),
    );
  }
  private async decorateServices(
    token: string,
    listings: MarketListing[],
    mine: boolean,
  ): Promise<MarketServiceRow[]> {
    return mapBounded(listings, DETAIL_CONCURRENCY, async (listing) =>
      toServiceRow(
        mine ? (await this.ownDetail(token, listing.id)) || listing : listing,
        mine,
      ),
    );
  }
}
function toDemandRow(listing: MarketListing, mine: boolean): MarketDemandRow {
  const labels = categoryLabels(String(listing.subcategoryId || ''));
  const contact = contactOf(listing);
  const region = regionOf(listing);
  return {
    id: listing.id,
    listingId: listing.id,
    mine,
    status: String(listing.status || ''),
    subCategoryId: String(listing.subcategoryId || ''),
    category1: labels?.category1 || '',
    category2: labels?.category2 || '',
    title: String(listing.title || ''),
    description: String(listing.description || ''),
    tags: (listing.tags || []).map((item) => String(item)).join(','),
    budget: budgetText(listing),
    expectedOutcome: String(listing.expectedOutcome || ''),
    mustHaves: (listing.mustHaves || []).map((item) => String(item)).join(','),
    startAt: dayText(listing.startAt),
    deadline: dayText(listing.deadline),
    regionScope: region.scope,
    regionMode: region.mode,
    province: region.province,
    city: region.city,
    longitude: region.longitude,
    latitude: region.latitude,
    radiusKm: region.radiusKm,
    contactName: contact.name,
    contactPhone: contact.phone,
    contactWechat: contact.wechat,
    contactEmail: contact.email,
    emailSync: listing.replyEmailEnabled ? 1 : 0,
    conversationCount: null,
    createdAt: String(listing.createdAt || ''),
  };
}
function toServiceRow(listing: MarketListing, mine: boolean): MarketServiceRow {
  const region = regionOf(listing);
  const contact = contactOf(listing);
  return {
    id: listing.id,
    listingId: listing.id,
    mine,
    status: String(listing.status || ''),
    subCategoryId: String(listing.subcategoryId || ''),
    category1:
      categoryLabels(String(listing.subcategoryId || ''))?.category1 || '',
    category2:
      categoryLabels(String(listing.subcategoryId || ''))?.category2 || '',
    credentialTypes: credentialTypesOf(String(listing.subcategoryId || '')),
    title: String(listing.title || ''),
    description: String(listing.description || ''),
    tags: (listing.tags || []).map((item) => String(item)).join(','),
    moneyMode: String(listing.moneyMode || ''),
    amountMin: Number(listing.amountMin || 0),
    amountMax: Number(listing.amountMax || 0),
    unitLabel: String(listing.unitLabel || ''),
    priceDescription: text(listing.priceDescription || ''),
    serviceAreaMode: region.mode,
    province: region.province,
    city: region.city,
    longitude: region.longitude,
    latitude: region.latitude,
    radiusKm: region.radiusKm,
    deliveryMode: text(listing.deliveryMode || ''),
    responseTime: text(listing.responseTime || ''),
    qualifications: text(listing.qualifications || ''),
    highlights: (listing.highlights || []).map((item) => String(item)),
    cases: text(listing.cases || ''),
    referenceLinks: (listing.referenceLinks || []).map((item) => String(item)),
    contactName: contact.name,
    contactPhone: contact.phone,
    contactWechat: contact.wechat,
    contactEmail: contact.email,
    createdAt: String(listing.createdAt || ''),
  };
}
/** 平台列表行的联系方式已脱敏（只有属主详情给明文），因此优先取明文、回落脱敏值。 */
function contactOf(listing: MarketListing) {
  const masked = (listing.maskedContact || {}) as Record<string, unknown>;
  return {
    name: contactStr(listing.contactName) || contactStr(masked.contactName),
    phone: contactStr(listing.contactPhone) || contactStr(masked.contactPhone),
    wechat:
      contactStr(listing.contactWechat) || contactStr(masked.contactWechat),
    email: contactStr(listing.contactEmail) || contactStr(masked.contactEmail),
  };
}
/**
 * 地域三态回读：需求侧优先 `a2aConfig`（属主详情里省市最全），服务侧优先 `serviceArea`，
 * 公开池行只剩平台投影的 `locationMode/province/city`（只对 REGION 模式存省市）。
 */
function regionOf(listing: MarketListing) {
  const config = listing.a2aConfig as DemandGeoConfig | undefined;
  const area = listing.serviceArea as ServiceAreaInput | undefined;
  const raw = text(
    config?.geoMatchMode || area?.mode || listing.locationMode || '',
  ).toUpperCase();
  const mode = raw === 'REGION' || raw === 'RADIUS' ? raw : 'NONE';
  const province = contactStr(
    config?.province ?? area?.province ?? listing.province,
  );
  const city = contactStr(config?.city ?? area?.city ?? listing.city);
  const longitude = numberOrNull(
    config?.longitude ?? area?.longitude ?? listing.longitude,
  );
  const latitude = numberOrNull(
    config?.latitude ?? area?.latitude ?? listing.latitude,
  );
  const radiusKm = numberOrNull(
    config?.radiusKm ?? area?.radiusKm ?? listing.radiusKm,
  );
  const place = [province, city].filter(Boolean).join(' ');
  const scope =
    mode === 'REGION'
      ? place || '指定地区'
      : mode === 'RADIUS'
        ? `${place ? `${place} · ` : ''}经纬度 ${longitude ?? ''}, ${latitude ?? ''}（半径 ${radiusKm ?? ''} 公里）`
        : '不限制';
  return { mode, province, city, longitude, latitude, radiusKm, scope };
}
/** 预算文案：本系统发布时把人民币预算原文放进 `attributes.budget`，平台金额只在选 AWCOIN 时有值。 */
function budgetText(listing: MarketListing) {
  const attributes: Record<string, unknown> = listing.attributes || {};
  const raw = contactStr(attributes.budget);
  if (raw) return raw;
  const mode = String(listing.moneyMode || '').toUpperCase();
  const unit = contactStr(listing.unitLabel);
  const suffix = unit ? ` / ${unit}` : '';
  const min = numberOrNull(listing.amountMin);
  const max = numberOrNull(listing.amountMax);
  if (mode === 'NEGOTIABLE')
    return contactStr(listing.priceDescription) || '面议';
  if (mode === 'RANGE' && min !== null && max !== null) {
    return `${min} - ${max} AWCOIN${suffix}`;
  }
  if (mode === 'STARTING' && min !== null) return `${min} AWCOIN 起${suffix}`;
  if (mode === 'FIXED' && min !== null) return `${min} AWCOIN${suffix}`;
  return contactStr(listing.priceDescription);
}
function credentialTypesOf(subCategoryId: string) {
  return (leafById(subCategoryId)?.credentialTypes || []).join(',');
}
/** YYYY-MM-DD：平台存 UTC，按北京时间取日，否则 +08 的零点会显示成前一天。 */
function dayText(value: unknown) {
  const raw = contactStr(value);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return raw.slice(0, 10);
  return new Date(parsed + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
/** 平台金额规则：AWCOIN 只收正整数，面议清零，FIXED 上下限同值，起价只留下限。 */
function normalizeAmounts(mode: MoneyMode, min: unknown, max: unknown) {
  if (mode === 'NEGOTIABLE') return {};
  const low = Number(min);
  const high = Number(max);
  if (mode === 'RANGE') {
    if (!Number.isSafeInteger(low) || low <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写有效的价格下限',
      );
    }
    if (!Number.isSafeInteger(high) || high < low) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '价格上限需为不小于下限的整数',
      );
    }
    return { amountMin: low, amountMax: high };
  }
  if (!Number.isSafeInteger(low) || low <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写有效的价格');
  }
  return { amountMin: low, amountMax: mode === 'FIXED' ? low : undefined };
}
function regionColumnsOf(region: RegionScope) {
  return {
    regionMode: region.mode,
    province: region.province,
    city: region.city,
    longitude: region.longitude,
    latitude: region.latitude,
    radiusKm: region.radiusKm,
  };
}
/** 会话归属：平台收件箱不给 `listingId`，自有单只能按「本单的匹配批次」认。 */
function ownsConversation(
  item: AgentConversation,
  listingId: string,
  runIds: Set<string>,
) {
  return (
    item.listingId === listingId ||
    (item.matchRunId ? runIds.has(String(item.matchRunId)) : false)
  );
}
function matchesRegion(
  row: {
    province: string;
    city: string;
  },
  filter: RegionFilter,
) {
  const province = contactStr(filter.province);
  const city = contactStr(filter.city);
  if (province && row.province !== province) return false;
  if (city && row.city !== city) return false;
  return true;
}
/** 类目筛选：传了二级类目 id 时只看挂在该叶子下的行（供需市场跨板块公开池用）。 */
function matchesCategory(row: { subCategoryId: string }, categoryId?: string) {
  if (!categoryId) return true;
  return row.subCategoryId.toLowerCase() === categoryId.toLowerCase();
}
/** 修改的幂等键：内容哈希，改过内容必然是新键（否则平台按幂等重放旧版本）。 */
function editKey(id: string, draft: DemandDraft) {
  const digest = createHash('sha256')
    .update(`${id}|${JSON.stringify(draft)}`)
    .digest('hex')
    .slice(0, 32);
  return `edt_${digest}`;
}
/** 并发受限的批量映射：详情补取按 8 条一组，不把整块压力压到平台。 */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return out;
}
