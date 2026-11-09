import { allocateNo } from '../common/document-number';
import { Prisma } from '../../generated/prisma';
import {
  findModuleCategory,
  moduleCategory,
  requireSubCategoryId,
} from '../aiworkin/category-catalog';
import { DemandSyncService, splitList } from '../aiworkin/demand-sync.service';
import { DemandDraft, MoneyMode } from '../aiworkin/aiworkin.types';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import {
  CATEGORY_LABELS,
  MARKETPLACE_DOMAINS,
  PLATFORM_DIRECT_DOMAINS,
  SERVICE_PUBLISH_CATEGORY_BY_DOMAIN,
} from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { pickEditable } from '../shared/pick-editable';
import { ContactResolver } from '../shared/contacts.service';
import { contactStr, mergeContact, readContact } from '../shared/contacts';
import {
  regionFromServiceBody,
  serviceAreaPayload,
} from '../shared/region-scope';
const MONEY_MODES: MoneyMode[] = ['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'];
/**
 * 服务范围三态（跟着服务本身走）：`NATIONWIDE` 不限制 / `REGION` 指定地区（省、市）/
 * `RADIUS` 经纬度坐标（省市由坐标解析得到）。`REMOTE`（远程交付）为存量取值，
 * 与平台口径一致按「不限制」处理，界面不再提供该选项。
 */
const SERVICE_AREA_MODES = ['NATIONWIDE', 'REGION', 'RADIUS', 'REMOTE'];
const DELIVERY_MODES = ['', 'REMOTE', 'ONSITE', 'HYBRID'];
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20000;
/** 服务侧结构化字段（发布校验与落库共用同一份输入）。 */
interface ServiceFieldInput {
  tags: string;
  money_mode: unknown;
  amount_min: unknown;
  amount_max: unknown;
  unit_label: string;
  price_description: string;
  service_area_mode: unknown;
  province: string;
  city: string;
  longitude: unknown;
  latitude: unknown;
  radius_km: unknown;
  delivery_mode: unknown;
  response_time: string;
  qualifications: string;
  highlights: string;
  cases: string;
  reference_links: string;
}
/**
 * 服务商发布服务（AIworkin direction=SUPPLY）：六个业务域共用一张表，发布走平台通道。
 * 平台契约（见 aipdd-aiworkin-master unified-market）：
 * - 必填 `subcategoryId` / `moneyMode` / `title` / `description`；
 * - 发布态必填 `priceDescription` 与 `serviceArea.mode`；
 * - 需资质的二级类目只能先存草稿，平台侧绑定已核验资质后才可发布；
 * - 服务归属发布人的「企业档案」，由平台按其当前档案自动绑定，无需前端传；
 * - 「服务发布」是服务商资质栏目：**除资产交易外**，五个板块只对「当前身份＝服务商 + 该板块类目备案通过」
 *   的账号开放（`assertPublishAllowed`）；资产交易按 §6.9 双身份口径，用户侧同样可发布。
 */
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly demandSync: DemandSyncService,
    private readonly contacts: ContactResolver,
  ) {}
  async list(user: CurrentUser, domain?: string) {
    const where = this.listWhere(user, domain);
    const rows = await this.prisma.providerServiceListing.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return rows.map(decorateService);
  }
  private listWhere(
    user: CurrentUser,
    domain?: string,
  ): Prisma.ProviderServiceListingWhereInput {
    const normalized = domain ? String(domain).toUpperCase() : '';
    if (normalized && !findModuleCategory(normalized)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `未知业务域：${domain}`,
      );
    }
    const where = this.identity.isPlatformAdmin(user)
      ? normalized
        ? { domain: normalized }
        : {}
      : {
          providerUserId: user.userId,
          ...(normalized ? { domain: normalized } : {}),
        };
    return where;
  }
  async page(
    user: CurrentUser,
    query: { domain?: string; page: number; pageSize: number },
  ) {
    const { page, pageSize } = query;
    const where = this.listWhere(user, query.domain);
    const [rows, total] = await Promise.all([
      this.prisma.providerServiceListing.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.providerServiceListing.count({ where }),
    ]);
    return { list: rows.map(decorateService), total, page, pageSize };
  }
  async detail(user: CurrentUser, id: number) {
    const row = await this.prisma.providerServiceListing.findFirst({
      where: { AND: [this.listWhere(user), { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.FORBIDDEN, '无权查看此服务');
    return decorateService(row);
  }
  async create(user: CurrentUser, body: Record<string, unknown>, token = '') {
    const module = this.requireModule(body.domain);
    // 平台直连板块里「尚未并入服务市集」的那一块（当前只剩出海，服务界面未开）：写本地台账
    // 就成了没有栏目可读的孤行。财税 / 供销自 2026-11-09 起并入「服务市集」（读本地台账 +
    // 公开池），不再拦截。
    if (
      PLATFORM_DIRECT_DOMAINS.includes(module.domain) &&
      !MARKETPLACE_DOMAINS.includes(module.domain)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${module.label}的服务发布走平台直连接口，本系统不写本地台账`,
      );
    }
    await this.assertPublishAllowed(user, module.domain);
    const title = this.requireTitle(body.title);
    const description = this.requireDescription(body.description);
    const publishAction =
      text(body.publish_action || '').toUpperCase() === 'PUBLISH'
        ? 'PUBLISH'
        : 'DRAFT';

    const record = await this.prisma.providerServiceListing.create({
      data: {
        serviceNo: await allocateNo(this.prisma, 'FW'),
        domain: module.domain,
        createdBy: user.userId,
        providerUserId: user.userId,
        // 发布服务的账号即服务方承办人（临时换人可改联系方式）
        staffUserId: user.userId,
        subCategoryId: requireSubCategoryId(
          module.domain,
          body.sub_category_id,
        ),
        title,
        description,
        credentialTypes: credentialTypesOf(module.domain, body.sub_category_id),
        currency: 'AWCOIN',
        status: 'DRAFT',
        ...this.mergeFields(body),
        ...(await this.contactFields(user.userId, body)),
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildServiceDraft(record, publishAction),
      `service:${record.id}`,
    );
    const status =
      sync.status === 'SYNCED' && publishAction === 'PUBLISH'
        ? 'ONLINE'
        : 'DRAFT';
    await this.prisma.providerServiceListing.update({
      where: { id: record.id },
      data: {
        aiworkinPublished: sync.published,
        platformListingId: sync.listingId,
        platformMatchRunId: sync.matchRunId,
        aiworkinSyncStatus: sync.status,
        aiworkinSyncError: sync.error,
        status,
      },
    });
    return {
      id: record.id,
      service_no: record.serviceNo,
      status,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: this.tipOf(
        sync.status,
        publishAction,
        module.label,
        record.credentialTypes,
      ),
    };
  }
  /** 编辑服务：仅发布人或平台管理员；已发布的服务改后需重新发布才在平台生效。 */
  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.requireOwner(user, id);
    const data: Prisma.ProviderServiceListingUpdateInput = {
      ...this.mergeFields({ ...rowFields(row), ...body }),
    };
    if (body.title !== undefined) {
      data.title = this.requireTitle(body.title);
    }
    if (body.description !== undefined) {
      data.description = this.requireDescription(body.description);
    }
    if (body.sub_category_id !== undefined) {
      data.subCategoryId = requireSubCategoryId(
        row.domain,
        body.sub_category_id,
      );
      data.credentialTypes = credentialTypesOf(
        row.domain,
        body.sub_category_id,
      );
    }
    Object.assign(
      data,
      pickEditable(
        normalizeContactEdit(row.serviceAreaMode, body),
        SERVICE_CONTACT_EDITABLE,
      ),
    );
    const updated = await this.prisma.providerServiceListing.update({
      where: { id },
      data,
    });
    await this.identity.audit(
      user.userId,
      'PROVIDER_SERVICE_UPDATE',
      `#${id} ${row.serviceNo}`,
    );
    return {
      id,
      service_no: updated.serviceNo,
      status: updated.status,
      tip: updated.platformListingId
        ? '该服务已发布至 AIworkin 平台通道，修改将在重新发布后生效'
        : '已保存',
    };
  }
  /** 发布/重新发布：草稿转平台发布态，或改动后再次同步（平台按幂等键新建版本）。 */
  async publish(user: CurrentUser, id: number, token = '') {
    const row = await this.requireOwner(user, id);
    const sync = await this.demandSync.publish(
      token,
      buildServiceDraft(row, 'PUBLISH'),
      `service:${id}`,
    );
    const status = sync.status === 'SYNCED' ? 'ONLINE' : 'DRAFT';
    await this.prisma.providerServiceListing.update({
      where: { id },
      data: {
        aiworkinPublished: sync.published,
        platformListingId: sync.listingId,
        platformMatchRunId: sync.matchRunId,
        aiworkinSyncStatus: sync.status,
        aiworkinSyncError: sync.error,
        status,
      },
    });
    return {
      id,
      service_no: row.serviceNo,
      status,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: this.tipOf(
        sync.status,
        'PUBLISH',
        moduleCategory(row.domain).label,
        row.credentialTypes,
      ),
    };
  }
  async remove(user: CurrentUser, id: number) {
    const row = await this.requireOwner(user, id);
    await this.prisma.providerServiceListing.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'PROVIDER_SERVICE_DELETE',
      `#${id} ${row.serviceNo}`,
    );
    return { id, deleted: true };
  }
  /**
   * 服务侧联系方式：按发布人档案自动带出（承办职员 → 服务商备案联系人），
   * 入参显式给出的逐字段覆盖（临时换人可改）。
   */
  private async contactFields(userId: string, body: Record<string, unknown>) {
    // 企业身份发布资产服务时本人无服务商备案，联系方式回退企业档案（法定代表人 + 档案电话）
    const profile = await this.contacts.provider(userId, userId);
    const pair = mergeContact(
      profile.name || profile.phone
        ? profile
        : await this.contacts.enterprise(userId, 0),
      readContact(body, 'contact'),
    );
    return {
      contactName: pair.name,
      contactPhone: pair.phone,
      contactWechat: contactStr(body.contact_wechat ?? body.contactWechat),
      contactEmail: contactStr(body.contact_email ?? body.contactEmail),
    };
  }
  /**
   * 「服务发布」资质门控（与前端 `lib/provider-categories.canPublishService` 同口径）：
   * **除资产交易外**，五个板块要求「当前身份＝服务商」且「该板块服务类目备案审核通过」
   * （物流含小微直营行）。资产交易按 §6.9 双身份口径，用户侧同样可发布，故不在门控表内。
   */
  private async assertPublishAllowed(user: CurrentUser, domain: string) {
    const category = SERVICE_PUBLISH_CATEGORY_BY_DOMAIN[domain];
    if (!category) return;
    if ((await this.identity.currentIdentity(user)) !== 'SERVICE_PROVIDER') {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        `${CATEGORY_LABELS[category]}的「服务发布」只对服务商身份开放：请先在右上角切换到「服务商」身份`,
      );
    }
    if (!(await this.identity.hasServiceType(user.userId, category))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `未通过${CATEGORY_LABELS[category]}备案审核，无法在该板块发布服务`,
      );
    }
  }
  private requireModule(domain: unknown) {
    const key = text(domain || '').toUpperCase();
    const module = findModuleCategory(key);
    if (!module) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择业务域');
    }
    return module;
  }
  private requireTitle(value: unknown) {
    const title = text(value || '').trim();
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写服务标题');
    }
    if (title.length > TITLE_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `服务标题不可超过 ${TITLE_MAX} 字`,
      );
    }
    return title;
  }
  private requireDescription(value: unknown) {
    const description = text(value || '').trim();
    if (!description) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写服务说明');
    }
    if (description.length > DESCRIPTION_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `服务说明不可超过 ${DESCRIPTION_MAX} 字`,
      );
    }
    return description;
  }
  /** 校验并归一化服务结构化字段（创建与编辑共用，保证落库即平台可用）。 */
  private mergeFields(
    input: Partial<Record<keyof ServiceFieldInput, unknown>>,
  ) {
    const moneyMode = this.requireMoneyMode(input.money_mode);
    const amounts = this.normalizeAmounts(
      moneyMode,
      input.amount_min,
      input.amount_max,
    );
    const serviceAreaMode = this.enumOf(
      input.service_area_mode,
      SERVICE_AREA_MODES,
      '服务范围',
      'NATIONWIDE',
    );
    // RADIUS 的省、市由经纬度解析得到（与需求侧同一套城市中心点表）
    const area = regionFromServiceBody({
      ...input,
      service_area_mode: serviceAreaMode,
    });
    return {
      tags: text(input.tags || ''),
      moneyMode,
      // 平台金额规则：AWCOIN 只收正整数；FIXED 上下限同为一口价，起价只保留下限
      amountMin: amounts.amountMin,
      amountMax: amounts.amountMax,
      unitLabel: text(input.unit_label || ''),
      priceDescription: text(input.price_description || ''),
      serviceAreaMode,
      province: area.province,
      city: area.city,
      longitude: area.longitude,
      latitude: area.latitude,
      radiusKm: area.radiusKm,
      deliveryMode: this.enumOf(
        input.delivery_mode,
        DELIVERY_MODES,
        '交付方式',
        '',
      ),
      responseTime: text(input.response_time || ''),
      qualifications: text(input.qualifications || ''),
      highlights: text(input.highlights || ''),
      cases: text(input.cases || ''),
      referenceLinks: text(input.reference_links || ''),
    };
  }
  private requireMoneyMode(value: unknown): MoneyMode {
    const key = text(value || '').toUpperCase();
    if (!MONEY_MODES.includes(key as MoneyMode)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择计价方式（固定价格 / 起价 / 区间 / 面议）',
      );
    }
    return key as MoneyMode;
  }
  private enumOf(
    value: unknown,
    allowed: string[],
    label: string,
    fallback: string,
  ) {
    const key = text(value || '').toUpperCase();
    if (!key) return fallback;
    if (!allowed.includes(key)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}取值不合法`);
    }
    return key;
  }
  /** 平台金额规则：AWCOIN 只收正整数，面议清零，区间需上下限齐全。 */
  private normalizeAmounts(mode: MoneyMode, min: unknown, max: unknown) {
    if (mode === 'NEGOTIABLE') return { amountMin: 0, amountMax: 0 };
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
    return { amountMin: low, amountMax: mode === 'FIXED' ? low : 0 };
  }
  private tipOf(
    status: string,
    publishAction: string,
    label: string,
    credentialTypes = '',
  ) {
    if (status === 'SYNCED') {
      const base =
        publishAction === 'PUBLISH'
          ? `服务已发布至 AIworkin 平台通道（${label}）`
          : `服务草稿已同步至 AIworkin 平台通道（${label}）`;
      // 平台对需资质类目照常受理，但资质未核验前不参与匹配展示
      const required = splitList(credentialTypes).join(' / ');
      return publishAction === 'PUBLISH' && required
        ? `${base}；该类目需资质核验（${required}）通过后才会参与匹配展示`
        : base;
    }
    if (status === 'SKIPPED') {
      return '';
    }
    return 'AIworkin 服务发布失败，已本地留痕待重发';
  }
  /** 编辑/删除/发布前置：记录存在 + 发布人或平台管理员。 */
  private async requireOwner(user: CurrentUser, id: number) {
    const row = await this.prisma.providerServiceListing.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '服务不存在');
    }
    if (
      row.providerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅服务发布人或平台管理员可操作',
      );
    }
    return row;
  }
}
/** 可单独修改的联系方式（临时换人），业务字段走 mergeFields 统一校验。 */
const SERVICE_CONTACT_EDITABLE: Record<string, string> = {
  contact_name: 'contactName',
  contact_phone: 'contactPhone',
  contact_wechat: 'contactWechat',
  contact_email: 'contactEmail',
};
/** 已发布行 → 校验入参（编辑时先摊平旧值，再叠加入参）。 */
function rowFields(row: {
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
  highlights: string;
  cases: string;
  referenceLinks: string;
}): Record<string, unknown> {
  return {
    tags: row.tags,
    money_mode: row.moneyMode,
    amount_min: row.amountMin,
    amount_max: row.amountMax,
    unit_label: row.unitLabel,
    price_description: row.priceDescription,
    service_area_mode: row.serviceAreaMode,
    province: row.province,
    city: row.city,
    longitude: row.longitude,
    latitude: row.latitude,
    radius_km: row.radiusKm,
    delivery_mode: row.deliveryMode,
    response_time: row.responseTime,
    qualifications: row.qualifications,
    highlights: row.highlights,
    cases: row.cases,
    reference_links: row.referenceLinks,
  };
}
/** 非区域服务不保留省市（平台只在 REGION 模式下取用）。 */
function normalizeContactEdit(
  serviceAreaMode: string,
  body: Record<string, unknown>,
) {
  if (
    text(body.service_area_mode || serviceAreaMode).toUpperCase() === 'REGION'
  ) {
    return body;
  }
  return { ...body, province: '', city: '' };
}
function credentialTypesOf(domain: string, value: unknown) {
  const subCategoryId = requireSubCategoryId(domain, value);
  const leaf = moduleCategory(domain).children.find(
    (item) => item.id === subCategoryId,
  );
  return (leaf?.credentialTypes || []).join(',');
}
function decorateService(row: {
  domain: string;
  subCategoryId: string;
  highlights: string;
  referenceLinks: string;
  [key: string]: unknown;
}) {
  const module = findModuleCategory(row.domain);
  const leaf = module?.children.find((item) => item.id === row.subCategoryId);
  return {
    ...row,
    domain_label: module?.label || row.domain,
    category1: module?.parentName || '',
    category2: leaf?.name || '',
    highlights: splitList(row.highlights),
    reference_links: splitList(row.referenceLinks),
  };
}
/** 服务 → AIworkin 服务草稿（direction=SUPPLY）。 */
function buildServiceDraft(
  row: {
    domain: string;
    subCategoryId: string;
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
    highlights: string;
    cases: string;
    referenceLinks: string;
    contactName: string;
    contactPhone: string;
    contactWechat: string;
    contactEmail: string;
  },
  publishAction: 'DRAFT' | 'PUBLISH',
): DemandDraft {
  const moneyMode = row.moneyMode as MoneyMode;
  const draft: DemandDraft = {
    title: row.title,
    description: row.description,
    direction: 'SUPPLY',
    subcategoryId: requireSubCategoryId(row.domain, row.subCategoryId),
    publishAction,
    moneyMode,
    currency: 'AWCOIN',
    tags: splitList(row.tags),
    unitLabel: row.unitLabel || undefined,
    highlights: splitList(row.highlights),
    cases: row.cases || undefined,
    referenceLinks: splitList(row.referenceLinks),
    deliveryMode: (row.deliveryMode ||
      undefined) as DemandDraft['deliveryMode'],
    responseTime: row.responseTime || undefined,
    qualifications: row.qualifications || undefined,
    contactName: row.contactName || undefined,
    contactPhone: row.contactPhone || undefined,
    contactWechat: row.contactWechat || undefined,
    contactEmail: row.contactEmail || undefined,
    serviceArea: serviceAreaPayload(row),
  };
  if (row.priceDescription) draft.priceDescription = row.priceDescription;
  // 金额随计价方式给：面议不带金额，起价只给下限，区间给全（平台规则）
  if (moneyMode === 'FIXED' || moneyMode === 'STARTING') {
    draft.amountMin = row.amountMin || undefined;
  }
  if (moneyMode === 'RANGE') {
    draft.amountMin = row.amountMin || undefined;
    draft.amountMax = row.amountMax || undefined;
  }
  return draft;
}
