import { pageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import { Prisma } from '../../generated/prisma';
import { toJsonInput, type JsonInput } from '../common/json-input';
import { text } from '../common/api';
import type { SupplyBooking, SupplyOrder } from '../../generated/prisma';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { ContractsService } from '../contracts/contracts.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TaskDispatchPort } from '../task-center/task-router.service';
import { readContact } from '../shared/contacts';
/** 单据状态（订货单与预约单共用；订货单另有「已否决」终态）。 */
export const SUPPLY_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交 · 待报价',
  QUOTED: '已审核报价 · 待确认',
  ACTIVE: '订单生效',
  RETURNED: '已驳回 · 待重新报价',
  VETOED: '已否决',
  CANCELLED: '已取消',
};
/** 服务商/承办职员可报价的状态。 */
const QUOTABLE_STATUSES = ['SUBMITTED', 'RETURNED'];
/** 企业可确认/驳回/否决的状态。 */
const CONFIRMABLE_STATUSES = ['QUOTED'];
/** 企业可修改并重新提交的状态（生效前均可继续磋商）。 */
const EDITABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'QUOTED', 'RETURNED'];
const STATION_STATUSES = ['ACTIVE', 'FROZEN'];
const LISTING_STATUSES = ['ONLINE', 'OFFLINE'];
const STOCK_STATES = ['SUFFICIENT', 'PARTIAL', 'SHORTAGE'];
type FeeEntry = {
  name: string;
  amount: number;
  note: string;
};
function str(value: unknown, fallback = '') {
  return value === undefined ? fallback : text(value ?? '').trim();
}
function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function bool(value: unknown, fallback = false) {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}
function round2(value: number) {
  return Math.round(value * 100) / 100;
}
function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value as Record<string, unknown>[]).filter(
        (item) => item && typeof item === 'object',
      )
    : [];
}
/**
 * 联系方式（需求 §三：双方商务磋商沟通用；见 shared/contacts.ts 全站口径）：
 * - contact：企业侧订货/预约联系人；
 * - provider_contact：服务商（或其承办职员）报价联系人。
 */
/** 单据必须带联系方式，缺失直接 400（便于双方商务磋商沟通）。 */
function requireContact(
  pair: {
    name: string;
    phone: string;
  },
  who: string,
) {
  if (!pair.name || !pair.phone) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${who}联系人及联系电话必填（便于双方商务磋商沟通）`,
    );
  }
  return pair;
}
/** JSON 列（attrs 等）写入用：把入参数组收敛为 Prisma 可接受的 JSON 值。 */
function jsonArray(value: unknown): JsonInput {
  return toJsonInput(asArray(value));
}
/** 明细快照：本地台账字段 + 订单主键（buildItems 产物）。 */
type OrderItemInput = {
  productId: number;
  skuId: number;
  productName: string;
  specName: string;
  unit: string;
  price: number;
  quantity: number;
  amount: number;
  stockState: string;
};
/**
 * 其他费用科目：正数为额外增收、负数为优惠减免（需求 §四.2），
 * 汇总时允许负数抵扣，明细全程回传给对方。
 */
function normalizeFees(value: unknown): FeeEntry[] {
  return asArray(value)
    .map((item) => ({
      name: str(item.name),
      amount: round2(num(item.amount)),
      note: str(item.note),
    }))
    .filter((item) => item.name);
}
/**
 * 供销网络：服务站为最小经营单元，商品/服务项目必须绑定站点；
 * 订货单/预约单由企业发起，服务商账号或**服务商指派的承办职员**报价，企业确认后生效。
 */
export class SupplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly aiworkin: AiworkinClient,
  ) {}

  /** 派单原语由 services.ts 装配后回填；未装配时（单测/脚本）跳过任务中心联动。 */
  private taskDispatch?: TaskDispatchPort;

  useTaskDispatch(port: TaskDispatchPort) {
    this.taskDispatch = port;
  }

  /** 派单失败不影响建单：任务中心是辅助链路，主链路照常可用。 */
  private dispatchTask(input: Parameters<TaskDispatchPort['dispatch']>[0]) {
    // 没有归属服务商就不是机构任务，不往任务中心塞孤儿行。
    if (!input.orgUserId) return Promise.resolve(null);
    return this.taskDispatch?.dispatch(input).catch(() => null);
  }

  private orderTask(row: SupplyOrder) {
    return {
      source: 'supply',
      sourceId: `so-${row.id}`,
      orgUserId: row.providerUserId,
      category: 'task',
      title: `订货单 ${row.orderNo} · ${row.stationName}`,
      description: `${row.enterpriseName || '企业'} 提交订货需求，期望 ${row.expectedDate} 到货`,
      link: '/supply?tab=orders',
      priority: 'NORMAL',
      dueAt: row.expectedDate || null,
      createdBy: row.createdBy,
      staffUserId: row.staffUserId,
      sourceStatus: row.status,
      sourceStatusLabel: SUPPLY_STATUS_LABELS[row.status] || row.status,
    };
  }

  private bookingTask(row: SupplyBooking) {
    return {
      source: 'supply-booking',
      sourceId: `sb-${row.id}`,
      orgUserId: row.providerUserId,
      category: 'task',
      title: `服务预约 ${row.bookingNo} · ${row.serviceName}`,
      description: `${row.enterpriseName || '企业'} 预约 ${row.planDate} 上门服务`,
      link: '/supply?tab=bookings',
      priority: 'NORMAL',
      dueAt: row.planDate || null,
      createdBy: row.createdBy,
      staffUserId: row.staffUserId,
      sourceStatus: row.status,
      sourceStatusLabel: SUPPLY_STATUS_LABELS[row.status] || row.status,
    };
  }
  /* ------------------------------------------------------------------ 服务站 */

  async bookingPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.bizWhere(user, {
      stationId: text(query.stationId ?? ''),
      provider: text(query.provider ?? ''),
    });
    const keyword = text(query.keyword ?? '').trim();
    const where = {
      AND: [
        scope ?? { id: -1 },
        {
          ...(query.status ? { status: text(query.status) } : {}),
          ...(keyword
            ? {
                OR: [
                  {
                    bookingNo: {
                      contains: keyword,
                    },
                  },
                  {
                    enterpriseName: {
                      contains: keyword,
                    },
                  },
                  {
                    serviceName: {
                      contains: keyword,
                    },
                  },
                ],
              }
            : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplyBooking.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.supplyBooking.count({ where }),
    ]);
    return { list: await this.decorateStaff(rows), total, page, pageSize };
  }
  async bookingStats(user: CurrentUser) {
    const scope = await this.bizWhere(user, {});
    const rows = await this.prisma.supplyBooking.groupBy({
      by: ['status'],
      where: scope ?? { id: -1 },
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        rows.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async bookingDetail(user: CurrentUser, id: number) {
    const scope = await this.bizWhere(user, {});
    const row = await this.prisma.supplyBooking.findFirst({
      where: { AND: [scope ?? { id: -1 }, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或不可访问');
    return (await this.decorateStaff([row]))[0];
  }
  async orderPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.bizWhere(user, {
      stationId: text(query.stationId ?? ''),
      provider: text(query.provider ?? ''),
    });
    const keyword = text(query.keyword ?? '').trim();
    const where = {
      AND: [
        scope ?? { id: -1 },
        {
          ...(query.status ? { status: text(query.status) } : {}),
          ...(keyword
            ? {
                OR: [
                  {
                    orderNo: {
                      contains: keyword,
                    },
                  },
                  {
                    enterpriseName: {
                      contains: keyword,
                    },
                  },
                  {
                    stationName: {
                      contains: keyword,
                    },
                  },
                ],
              }
            : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplyOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.supplyOrder.count({ where }),
    ]);
    return { list: await this.decorateOrders(rows), total, page, pageSize };
  }
  async orderStats(user: CurrentUser) {
    const scope = await this.bizWhere(user, {});
    const rows = await this.prisma.supplyOrder.groupBy({
      by: ['status'],
      where: scope ?? { id: -1 },
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        rows.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async orderDetail(user: CurrentUser, id: number) {
    const scope = await this.bizWhere(user, {});
    const row = await this.prisma.supplyOrder.findFirst({
      where: { AND: [scope ?? { id: -1 }, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或不可访问');
    return (await this.decorateOrders([row]))[0];
  }
  async listStations(
    user: CurrentUser,
    query: {
      provider?: string;
    } = {},
  ) {
    const provider = str(query.provider);
    if (this.identity.isPlatformAdmin(user)) {
      return this.prisma.supplyStation.findMany({
        where: provider ? { providerUserId: provider } : {},
        orderBy: { id: 'desc' },
      });
    }
    const scope = await this.supplierScope(user);
    const ids = scope.filter((item) => !provider || item === provider);
    if (!ids.length) return [];
    return this.prisma.supplyStation.findMany({
      where: { providerUserId: { in: ids } },
      orderBy: { id: 'desc' },
    });
  }
  async createStation(user: CurrentUser, body: Record<string, unknown>) {
    const providerUserId = await this.requireProviderAccount(user);
    const name = str(body.name);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '服务站名称必填');
    }
    const row = await this.prisma.supplyStation.create({
      data: {
        providerUserId,
        name,
        region: str(body.region),
        address: str(body.address),
        contactName: str(body.contact_name ?? body.contactName),
        contactPhone: str(body.contact_phone ?? body.contactPhone),
        remark: str(body.remark),
      },
    });
    await this.identity.audit(
      user.userId,
      'SUPPLY_STATION_CREATE',
      `#${row.id} ${row.name}`,
    );
    return row;
  }
  async updateStation(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    await this.requireStation(user, id);
    const status = str(body.status);
    if (status && !STATION_STATUSES.includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务站状态仅支持 ACTIVE（启用）/ FROZEN（停用）',
      );
    }
    const row = await this.prisma.supplyStation.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: str(body.name) }),
        ...(body.region === undefined ? {} : { region: str(body.region) }),
        ...(body.address === undefined ? {} : { address: str(body.address) }),
        ...(body.contact_name === undefined && body.contactName === undefined
          ? {}
          : { contactName: str(body.contact_name ?? body.contactName) }),
        ...(body.contact_phone === undefined && body.contactPhone === undefined
          ? {}
          : { contactPhone: str(body.contact_phone ?? body.contactPhone) }),
        ...(body.remark === undefined ? {} : { remark: str(body.remark) }),
        ...(status ? { status } : {}),
      },
    });
    await this.identity.audit(
      user.userId,
      'SUPPLY_STATION_UPDATE',
      `#${id} ${row.name}`,
    );
    return row;
  }
  async removeStation(user: CurrentUser, id: number) {
    await this.requireStation(user, id);
    const [products, services] = await Promise.all([
      this.prisma.supplyProductStation.count({ where: { stationId: id } }),
      this.prisma.supplyService.count({ where: { stationId: id } }),
    ]);
    if (products || services) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该服务站下仍有 ${products} 个商品归属、${services} 个服务项目，请先解除归属再删除`,
      );
    }
    const orders = await this.prisma.supplyOrder.count({
      where: { stationId: id },
    });
    const bookings = await this.prisma.supplyBooking.count({
      where: { stationId: id },
    });
    if (orders || bookings) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该服务站已有订货单/预约单，仅可停用不可删除',
      );
    }
    await this.prisma.supplyStation.delete({ where: { id } });
    await this.identity.audit(user.userId, 'SUPPLY_STATION_DELETE', `#${id}`);
    return { id, deleted: true };
  }
  /* -------------------------------------------------------------------- 商品 */
  async listProducts(user: CurrentUser, query: Record<string, string> = {}) {
    const stationId = num(query.stationId ?? query.station_id, 0);
    const keyword = str(query.keyword);
    const providerFilter = str(query.provider);
    const includeOffline =
      bool(query.all) && !(await this.enterpriseOnly(user));
    let providerIds: string[];
    if (this.identity.isPlatformAdmin(user)) {
      providerIds = providerFilter ? [providerFilter] : [];
    } else {
      const scope = await this.supplierScope(user);
      providerIds = providerFilter
        ? scope.filter((item) => item === providerFilter)
        : scope;
      if (!providerIds.length) return [];
    }
    const where: Prisma.SupplyProductWhereInput = {
      ...(providerIds.length ? { providerUserId: { in: providerIds } } : {}),
      ...(includeOffline ? {} : { status: 'ONLINE' }),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { category: { contains: keyword } },
            ],
          }
        : {}),
    };
    if (stationId) {
      const links = await this.prisma.supplyProductStation.findMany({
        where: {
          stationId,
          ...(includeOffline ? {} : { status: 'ONLINE' }),
        },
        select: { productId: true },
      });
      where.id = { in: links.map((item) => item.productId) };
    }
    const rows = await this.prisma.supplyProduct.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    const [links, skus] = await Promise.all([
      this.prisma.supplyProductStation.findMany({
        where: { productId: { in: rows.map((item) => item.id) } },
      }),
      this.prisma.supplySku.findMany({
        where: { productId: { in: rows.map((item) => item.id) } },
        orderBy: { id: 'asc' },
      }),
    ]);
    return rows.map((row) => ({
      ...row,
      stations: links
        .filter((item) => item.productId === row.id)
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          stationId: item.stationId,
          status: item.status,
        })),
      skus: skus.filter((item) => item.productId === row.id),
    }));
  }
  async createProduct(user: CurrentUser, body: Record<string, unknown>) {
    const providerUserId = await this.requireProviderAccount(user);
    const name = str(body.name);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '商品名称必填');
    }
    const stationIds = await this.normalizeStationIds(
      providerUserId,
      body.station_ids ?? body.stationIds,
    );
    if (!stationIds.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '商品必须绑定至少一个所属服务站',
      );
    }
    const sync = this.syncState();
    // 商品与它的归属站一起落库：只建成主行会留下「没有任何服务站的商品」
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplyProduct.create({
        data: {
          providerUserId,
          name,
          category: str(body.category),
          unit: str(body.unit, '件') || '件',
          attrs: jsonArray(body.attrs),
          status: LISTING_STATUSES.includes(str(body.status))
            ? str(body.status)
            : 'ONLINE',
          marketingTitle: str(body.marketing_title ?? body.marketingTitle),
          marketingSummary: str(
            body.marketing_summary ?? body.marketingSummary,
          ),
          marketingContent: str(
            body.marketing_content ?? body.marketingContent,
          ),
          coverUrl: str(body.cover_url ?? body.coverUrl),
          featured: bool(body.featured),
          aiworkinSyncStatus: sync.status,
          aiworkinSyncNote: sync.note,
        },
      });
      await tx.supplyProductStation.createMany({
        data: stationIds.map((stationId) => ({
          productId: created.id,
          stationId,
          status: 'ONLINE',
        })),
      });
      await this.identity.audit(
        user.userId,
        'SUPPLY_PRODUCT_CREATE',
        `#${created.id} ${created.name}`,
        tx,
      );
      return created;
    });
    return { id: row.id, tip: sync.tip };
  }
  async updateProduct(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    await this.requireProduct(user, id);
    const status = str(body.status);
    if (status && !LISTING_STATUSES.includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '商品状态仅支持 ONLINE（上架）/ OFFLINE（下架）',
      );
    }
    const sync = this.syncState();
    const row = await this.prisma.supplyProduct.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: str(body.name) }),
        ...(body.category === undefined
          ? {}
          : { category: str(body.category) }),
        ...(body.unit === undefined ? {} : { unit: str(body.unit) || '件' }),
        ...(body.attrs === undefined ? {} : { attrs: jsonArray(body.attrs) }),
        ...(status ? { status } : {}),
        ...(body.marketing_title === undefined &&
        body.marketingTitle === undefined
          ? {}
          : {
              marketingTitle: str(body.marketing_title ?? body.marketingTitle),
            }),
        ...(body.marketing_summary === undefined &&
        body.marketingSummary === undefined
          ? {}
          : {
              marketingSummary: str(
                body.marketing_summary ?? body.marketingSummary,
              ),
            }),
        ...(body.marketing_content === undefined &&
        body.marketingContent === undefined
          ? {}
          : {
              marketingContent: str(
                body.marketing_content ?? body.marketingContent,
              ),
            }),
        ...(body.cover_url === undefined && body.coverUrl === undefined
          ? {}
          : { coverUrl: str(body.cover_url ?? body.coverUrl) }),
        ...(body.featured === undefined
          ? {}
          : { featured: bool(body.featured) }),
        aiworkinSyncStatus: sync.status,
        aiworkinSyncNote: sync.note,
      },
    });
    if (body.station_ids !== undefined || body.stationIds !== undefined) {
      const stationIds = await this.normalizeStationIds(
        row.providerUserId,
        body.station_ids ?? body.stationIds,
      );
      if (!stationIds.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '商品必须绑定至少一个所属服务站',
        );
      }
      await this.setProductStations(user, id, stationIds);
    }
    await this.identity.audit(
      user.userId,
      'SUPPLY_PRODUCT_UPDATE',
      `#${id} ${row.name}`,
    );
    return { id, tip: sync.tip };
  }
  async removeProduct(user: CurrentUser, id: number) {
    await this.requireProduct(user, id);
    const used = await this.prisma.supplyOrderItem.count({
      where: { productId: id },
    });
    if (used) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该商品已有订货明细，仅可下架不可删除',
      );
    }
    // 归属·规格·商品三条删除必须一起成功：只删一半会留下孤儿明细或删不掉的主行
    await this.prisma.$transaction(async (tx) => {
      await tx.supplyProductStation.deleteMany({ where: { productId: id } });
      await tx.supplySku.deleteMany({ where: { productId: id } });
      await tx.supplyProduct.delete({ where: { id } });
      await this.identity.audit(
        user.userId,
        'SUPPLY_PRODUCT_DELETE',
        `#${id}`,
        tx,
      );
    });
    return { id, deleted: true };
  }
  /** 商品归属服务站整体设置（新增归属默认上架，移除归属即下架）。 */
  async setProductStations(
    user: CurrentUser,
    id: number,
    stationIds: number[],
  ) {
    const product = await this.requireProduct(user, id);
    const normalized = await this.normalizeStationIds(
      product.providerUserId,
      stationIds,
    );
    // 先删后加在一个事务里：中途失败会让商品凭空少掉几个服务站
    await this.prisma.$transaction(async (tx) => {
      await tx.supplyProductStation.deleteMany({
        where: { productId: id, stationId: { notIn: normalized } },
      });
      const existing = await tx.supplyProductStation.findMany({
        where: { productId: id },
      });
      const missing = normalized.filter(
        (stationId) => !existing.some((item) => item.stationId === stationId),
      );
      if (missing.length) {
        await tx.supplyProductStation.createMany({
          data: missing.map((stationId) => ({ productId: id, stationId })),
        });
      }
    });
    return this.listProducts(user, { all: '1' }).then((rows) =>
      rows.find((item) => item.id === id),
    );
  }
  /** 按站点维度独立上下架。 */
  async setProductStationStatus(
    user: CurrentUser,
    id: number,
    stationId: number,
    status: string,
  ) {
    await this.requireProduct(user, id);
    if (!LISTING_STATUSES.includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '上架状态仅支持 ONLINE / OFFLINE',
      );
    }
    const link = await this.prisma.supplyProductStation.findUnique({
      where: { productId_stationId: { productId: id, stationId } },
    });
    if (!link) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该商品未归属此服务站，请先添加归属',
      );
    }
    await this.prisma.supplyProductStation.update({
      where: { id: link.id },
      data: { status },
    });
    const sync = this.syncState();
    await this.prisma.supplyProduct.update({
      where: { id },
      data: { aiworkinSyncStatus: sync.status, aiworkinSyncNote: sync.note },
    });
    return { id, stationId, status, tip: sync.tip };
  }
  async addSku(
    user: CurrentUser,
    productId: number,
    body: Record<string, unknown>,
  ) {
    await this.requireProduct(user, productId);
    const specName = str(body.spec_name ?? body.specName);
    if (!specName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '规格参数必填');
    }
    const row = await this.prisma.supplySku.create({
      data: {
        productId,
        specName,
        supplyPrice: round2(num(body.supply_price ?? body.supplyPrice)),
        unit: str(body.unit, '件') || '件',
        scene: str(body.scene),
      },
    });
    return row;
  }
  async updateSku(
    user: CurrentUser,
    skuId: number,
    body: Record<string, unknown>,
  ) {
    const sku = await this.requireSku(user, skuId);
    return this.prisma.supplySku.update({
      where: { id: sku.id },
      data: {
        ...(body.spec_name === undefined && body.specName === undefined
          ? {}
          : { specName: str(body.spec_name ?? body.specName) }),
        ...(body.supply_price === undefined && body.supplyPrice === undefined
          ? {}
          : {
              supplyPrice: round2(num(body.supply_price ?? body.supplyPrice)),
            }),
        ...(body.unit === undefined ? {} : { unit: str(body.unit) || '件' }),
        ...(body.scene === undefined ? {} : { scene: str(body.scene) }),
      },
    });
  }
  async removeSku(user: CurrentUser, skuId: number) {
    const sku = await this.requireSku(user, skuId);
    const used = await this.prisma.supplyOrderItem.count({
      where: { skuId: sku.id },
    });
    if (used) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该规格已有订货明细，不可删除',
      );
    }
    await this.prisma.supplySku.delete({ where: { id: sku.id } });
    return { id: sku.id, deleted: true };
  }
  /* ---------------------------------------------------------------- 服务项目 */
  async listServices(user: CurrentUser, query: Record<string, string> = {}) {
    const stationId = num(query.stationId ?? query.station_id, 0);
    const keyword = str(query.keyword);
    const providerFilter = str(query.provider);
    const includeOffline =
      bool(query.all) && !(await this.enterpriseOnly(user));
    let providerIds: string[];
    if (this.identity.isPlatformAdmin(user)) {
      providerIds = providerFilter ? [providerFilter] : [];
    } else {
      const scope = await this.supplierScope(user);
      providerIds = providerFilter
        ? scope.filter((item) => item === providerFilter)
        : scope;
      if (!providerIds.length) return [];
    }
    const where: Prisma.SupplyServiceWhereInput = {
      ...(providerIds.length ? { providerUserId: { in: providerIds } } : {}),
      ...(includeOffline ? {} : { status: 'ONLINE' }),
      ...(stationId ? { stationId } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { scene: { contains: keyword } },
            ],
          }
        : {}),
    };
    if (stationId) {
      const station = await this.prisma.supplyStation.findUnique({
        where: { id: stationId },
      });
      if (station?.status === 'FROZEN' && !includeOffline) return [];
    }
    return this.prisma.supplyService.findMany({
      where,
      orderBy: { id: 'desc' },
    });
  }
  async createService(user: CurrentUser, body: Record<string, unknown>) {
    const providerUserId = await this.requireProviderAccount(user);
    const name = str(body.name);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '服务名称必填');
    }
    const stationId = num(body.station_id ?? body.stationId, 0);
    await this.requireOwnStation(providerUserId, stationId);
    const sync = this.syncState();
    const row = await this.prisma.supplyService.create({
      data: {
        providerUserId,
        stationId,
        name,
        priceUnit: str(body.price_unit ?? body.priceUnit, '次') || '次',
        basePrice: round2(num(body.base_price ?? body.basePrice)),
        intro: str(body.intro),
        scene: str(body.scene),
        status: LISTING_STATUSES.includes(str(body.status))
          ? str(body.status)
          : 'ONLINE',
        marketingTitle: str(body.marketing_title ?? body.marketingTitle),
        marketingSummary: str(body.marketing_summary ?? body.marketingSummary),
        marketingContent: str(body.marketing_content ?? body.marketingContent),
        coverUrl: str(body.cover_url ?? body.coverUrl),
        featured: bool(body.featured),
        aiworkinSyncStatus: sync.status,
        aiworkinSyncNote: sync.note,
      },
    });
    await this.identity.audit(
      user.userId,
      'SUPPLY_SERVICE_CREATE',
      `#${row.id} ${row.name}`,
    );
    return { id: row.id, tip: sync.tip };
  }
  async updateService(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const service = await this.requireService(user, id);
    const status = str(body.status);
    if (status && !LISTING_STATUSES.includes(status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务状态仅支持 ONLINE（上架）/ OFFLINE（下架）',
      );
    }
    const stationId =
      body.station_id === undefined && body.stationId === undefined
        ? service.stationId
        : num(body.station_id ?? body.stationId, 0);
    await this.requireOwnStation(service.providerUserId, stationId);
    const sync = this.syncState();
    const row = await this.prisma.supplyService.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: str(body.name) }),
        stationId,
        ...(body.price_unit === undefined && body.priceUnit === undefined
          ? {}
          : { priceUnit: str(body.price_unit ?? body.priceUnit) || '次' }),
        ...(body.base_price === undefined && body.basePrice === undefined
          ? {}
          : { basePrice: round2(num(body.base_price ?? body.basePrice)) }),
        ...(body.intro === undefined ? {} : { intro: str(body.intro) }),
        ...(body.scene === undefined ? {} : { scene: str(body.scene) }),
        ...(status ? { status } : {}),
        ...(body.marketing_title === undefined &&
        body.marketingTitle === undefined
          ? {}
          : {
              marketingTitle: str(body.marketing_title ?? body.marketingTitle),
            }),
        ...(body.marketing_summary === undefined &&
        body.marketingSummary === undefined
          ? {}
          : {
              marketingSummary: str(
                body.marketing_summary ?? body.marketingSummary,
              ),
            }),
        ...(body.marketing_content === undefined &&
        body.marketingContent === undefined
          ? {}
          : {
              marketingContent: str(
                body.marketing_content ?? body.marketingContent,
              ),
            }),
        ...(body.cover_url === undefined && body.coverUrl === undefined
          ? {}
          : { coverUrl: str(body.cover_url ?? body.coverUrl) }),
        ...(body.featured === undefined
          ? {}
          : { featured: bool(body.featured) }),
        aiworkinSyncStatus: sync.status,
        aiworkinSyncNote: sync.note,
      },
    });
    await this.identity.audit(
      user.userId,
      'SUPPLY_SERVICE_UPDATE',
      `#${id} ${row.name}`,
    );
    return { id, tip: sync.tip };
  }
  async removeService(user: CurrentUser, id: number) {
    await this.requireService(user, id);
    const used = await this.prisma.supplyBooking.count({
      where: { serviceId: id },
    });
    if (used) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该服务项目已有预约单，仅可下架不可删除',
      );
    }
    await this.prisma.supplyService.delete({ where: { id } });
    await this.identity.audit(user.userId, 'SUPPLY_SERVICE_DELETE', `#${id}`);
    return { id, deleted: true };
  }
  /* ------------------------------------------------------------------ 订货单 */
  async listOrders(user: CurrentUser, query: Record<string, string> = {}) {
    const where = await this.bizWhere(user, query);
    if (where === null) return [];
    const rows = await this.prisma.supplyOrder.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return this.decorateOrders(rows);
  }
  async createOrder(user: CurrentUser, body: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const ep = eps[0];
    const contact = requireContact(readContact(body, 'contact'), '订货');
    const stationId = num(body.station_id ?? body.stationId, 0);
    const station = await this.requireStationById(stationId);
    if (station.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该服务站已停用，无法下单',
      );
    }
    const contract = await this.contracts.activeContractBetween(
      ep.id,
      station.providerUserId,
      'SUPPLY_NETWORK',
    );
    if (!contract) {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_CONTRACT,
        '与该服务商尚无生效中的「供销服务」签约，请先在供销网络发起签约',
      );
    }
    const expectedDate = str(body.expected_date ?? body.expectedDate).slice(
      0,
      10,
    );
    if (!expectedDate) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '期望到货时间必填');
    }
    const items = await this.buildItems(
      station.providerUserId,
      body.items,
      stationId,
    );
    if (!items.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条订货明细',
      );
    }
    const draft = bool(body.draft);

    const staffUserId = await this.identity.assignedStaffFor(
      station.providerUserId,
      ep.id,
    );
    /**
     * 主表 + 明细必须同一条事务：中途失败会留下「有单据无明细」的订货单，
     * 金额（productAmount 由明细汇总）与明细对不上，报价与确认都无从进行。
     */
    const row = await this.prisma.$transaction(async (tx) => {
      const order = await tx.supplyOrder.create({
        data: {
          orderNo: await allocateNo(this.prisma, 'DH'),
          enterpriseId: ep.id,
          enterpriseName: ep.name,
          createdBy: user.userId,
          providerUserId: station.providerUserId,
          staffUserId,
          stationId,
          stationName: station.name,
          contactName: contact.name,
          contactPhone: contact.phone,
          expectedDate,
          remark: str(body.remark),
          status: draft ? 'DRAFT' : 'SUBMITTED',
          productAmount: round2(
            items.reduce((acc, item) => acc + item.amount, 0),
          ),
        },
      });
      await tx.supplyOrderItem.createMany({
        data: items.map((item) => ({ ...item, orderId: order.id })),
      });
      return order;
    });
    await this.writeLog(
      user,
      'ORDER',
      row.id,
      draft ? 'SAVE_DRAFT' : 'SUBMIT',
      `${row.orderNo} · ${items.length} 条明细${draft ? '（草稿）' : ''}`,
    );
    await this.identity.audit(
      user.userId,
      draft ? 'SUPPLY_ORDER_DRAFT' : 'SUPPLY_ORDER_CREATE',
      `#${row.id} ${row.orderNo}`,
    );
    if (!draft) await this.dispatchTask(this.orderTask(row));
    return { id: row.id, order_no: row.orderNo, status: row.status };
  }
  /** 草稿 → 已提交。 */
  async submitOrder(user: CurrentUser, id: number) {
    const row = await this.requireOwnOrder(user, id);
    if (row.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.CONFLICT, '仅草稿可提交');
    }
    const updated = await this.prisma.supplyOrder.update({
      where: { id },
      data: { status: 'SUBMITTED', revision: { increment: 1 } },
    });
    await this.writeLog(user, 'ORDER', id, 'SUBMIT', row.orderNo);
    await this.dispatchTask(this.orderTask(updated));
    return { id, status: updated.status, revision: updated.revision };
  }
  /** 企业修改需求并重新提交（数量/规格/期望到货时间/备注），多轮磋商。 */
  async updateOrder(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireOwnOrder(user, id);
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `订单已生效（或已终止），不可再修改；如需变更请与服务商另行约定`,
      );
    }
    const items = await this.buildItems(
      row.providerUserId,
      body.items,
      row.stationId,
    );
    if (!items.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少保留一条订货明细',
      );
    }
    const expectedDate = str(body.expected_date ?? body.expectedDate).slice(
      0,
      10,
    );
    const resubmit =
      row.status === 'SUBMITTED' ||
      row.status === 'QUOTED' ||
      row.status === 'RETURNED';
    /**
     * 明细整批替换与主表（金额汇总 + 状态/版本）在同一条事务里完成：
     * 分开写会在中途失败时留下「明细已清空、主表仍挂着旧金额旧版本」的订货单。
     */
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplyOrderItem.deleteMany({ where: { orderId: id } });
      await tx.supplyOrderItem.createMany({
        data: items.map((item) => ({ ...item, orderId: id })),
      });
      return tx.supplyOrder.update({
        where: { id },
        data: {
          ...this.contactPatch(body, '订货'),
          productAmount: round2(
            items.reduce((acc, item) => acc + item.amount, 0),
          ),
          ...(expectedDate ? { expectedDate } : {}),
          ...(body.remark === undefined ? {} : { remark: str(body.remark) }),
          ...(resubmit
            ? { status: 'SUBMITTED', revision: { increment: 1 } }
            : {}),
        },
      });
    });
    await this.writeLog(
      user,
      'ORDER',
      id,
      'RESUBMIT',
      `${row.orderNo} · 第 ${updated.revision} 版（${items.length} 条明细）`,
    );
    return { id, status: updated.status, revision: updated.revision };
  }
  /** 服务商或承办职员报价（缺货说明 + 承诺发货日期 + 其他费用 + 汇总）。 */
  async quoteOrder(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireBizActor(user, 'ORDER', id, '报价');
    if (!QUOTABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `当前状态（${SUPPLY_STATUS_LABELS[row.status] || row.status}）不可报价`,
      );
    }
    const existing = await this.prisma.supplyOrderItem.findMany({
      where: { orderId: id },
      orderBy: { id: 'asc' },
    });
    const providerContact = requireContact(
      readContact(body, 'provider_contact'),
      '报价',
    );
    const patches = asArray(body.items);
    const quoteNote = str(body.quote_note ?? body.quoteNote);
    const promisedShipDate = str(
      body.promised_ship_date ?? body.promisedShipDate,
    ).slice(0, 10);
    const fees = normalizeFees(body.other_fees ?? body.otherFees);
    /**
     * 逐行改价 → 明细金额重算 → 主表合计与状态，全部在同一条事务里：
     * 分开写会在中途失败时留下「部分明细已改价、主表合计仍是旧值」的报价单。
     */
    const { result, amounts } = await this.prisma.$transaction(async (tx) => {
      for (const patch of patches) {
        const itemId = num(patch.id, 0);
        const item = existing.find((entry) => entry.id === itemId);
        if (!item) continue;
        const stockState = str(
          patch.stock_state ?? patch.stockState,
          item.stockState,
        );
        if (!STOCK_STATES.includes(stockState)) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '缺货情况仅支持 SUFFICIENT（库存充足）/ PARTIAL（部分缺货）/ SHORTAGE（缺货）',
          );
        }
        await tx.supplyOrderItem.update({
          where: { id: itemId },
          data: {
            price: round2(num(patch.price, Number(item.price))),
            quantity: num(patch.quantity, Number(item.quantity)),
            stockState,
            shortageNote: str(patch.shortage_note ?? patch.shortageNote),
            restockCycle: str(patch.restock_cycle ?? patch.restockCycle),
          },
        });
      }
      const items = (
        await tx.supplyOrderItem.findMany({
          where: { orderId: id },
          orderBy: { id: 'asc' },
        })
      ).map((item) => ({
        id: item.id,
        price: Number(item.price),
        quantity: Number(item.quantity),
      }));
      const sums = await this.applyAmounts(tx, items, fees);
      const order = await tx.supplyOrder.update({
        where: { id },
        data: {
          status: 'QUOTED',
          quotedAt: new Date(),
          promisedShipDate,
          quoteNote,
          providerContactName: providerContact.name,
          providerContactPhone: providerContact.phone,
          otherFees: fees,
          feeAmount: sums.feeAmount,
          totalAmount: sums.totalAmount,
          productAmount: sums.productAmount,
        },
      });
      return { result: order, amounts: sums };
    });
    await this.writeLog(
      user,
      'ORDER',
      id,
      'QUOTE',
      `${row.orderNo} · 报价 ${amounts.totalAmount.toFixed(2)} 元（承诺发货 ${promisedShipDate || '—'}）`,
    );
    return {
      id,
      status: result.status,
      total_amount: amounts.totalAmount,
    };
  }
  async confirmOrder(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnOrder(user, id);
    if (!CONFIRMABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「已审核报价 · 待确认」状态可确认报价',
      );
    }
    const updated = await this.prisma.supplyOrder.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        confirmedAt: new Date(),
        confirmNote: str(note),
      },
    });
    await this.writeLog(
      user,
      'ORDER',
      id,
      'CONFIRM',
      `${row.orderNo} · 订单生效`,
    );
    return { id, status: updated.status };
  }
  /** 驳回：退回服务商二次修改报价。 */
  async returnOrder(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnOrder(user, id);
    if (!CONFIRMABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「已审核报价 · 待确认」状态可驳回',
      );
    }
    const updated = await this.prisma.supplyOrder.update({
      where: { id },
      data: {
        status: 'RETURNED',
        confirmNote: str(note),
        revision: { increment: 1 },
      },
    });
    await this.writeLog(
      user,
      'ORDER',
      id,
      'RETURN',
      `${row.orderNo} · 驳回原因：${str(note) || '—'}`,
    );
    return { id, status: updated.status };
  }
  /** 否决：订单终止流转，标记为已否决。 */
  async vetoOrder(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnOrder(user, id);
    if (row.status === 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '订单已生效，不可否决；如需终止请与服务商协商解约',
      );
    }
    if (['VETOED', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(ErrorCode.CONFLICT, '该订单已终止');
    }
    const updated = await this.prisma.supplyOrder.update({
      where: { id },
      data: {
        status: 'VETOED',
        confirmNote: str(note),
        confirmedAt: new Date(),
      },
    });
    await this.writeLog(
      user,
      'ORDER',
      id,
      'VETO',
      `${row.orderNo} · 否决原因：${str(note) || '—'}`,
    );
    return { id, status: updated.status };
  }
  async cancelOrder(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnOrder(user, id);
    if (row.status === 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '订单已生效，不可取消；请联系服务商处理',
      );
    }
    if (['VETOED', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(ErrorCode.CONFLICT, '该订单已终止');
    }
    const updated = await this.prisma.supplyOrder.update({
      where: { id },
      data: { status: 'CANCELLED', confirmNote: str(note) },
    });
    await this.writeLog(user, 'ORDER', id, 'CANCEL', row.orderNo);
    return { id, status: updated.status };
  }
  /** 服务商指派承办职员（报价与履约由该职员完成）。 */
  async assignOrder(user: CurrentUser, id: number, staffUserId: string) {
    const row = await this.requireOrder(id);
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    if (row.providerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该单据所属服务商账号可指派承办职员',
      );
    }
    const staff = str(staffUserId);
    if (staff) {
      const bind = await this.prisma.providerStaff.findUnique({
        where: {
          providerUserId_staffUserId: {
            providerUserId: row.providerUserId,
            staffUserId: staff,
          },
        },
      });
      if (!bind || bind.status !== 'ACTIVE') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '该职员未绑定本机构',
        );
      }
    }
    // 任务与单据同事务改承办人（决策 D3=A）：改派后原账号不可见、新账号可见。
    const staffUserIdValue = this.taskDispatch
      ? await this.taskDispatch.assignDocument({
          source: 'supply',
          sourceId: `so-${id}`,
          orgUserId: row.providerUserId,
          staffUserId: staff,
          actorId: user.userId,
          note: `${row.orderNo} · 指派承办职员`,
        })
      : (
          await this.prisma.supplyOrder.update({
            where: { id },
            data: { staffUserId: staff },
          })
        ).staffUserId;
    await this.writeLog(
      user,
      'ORDER',
      id,
      'ASSIGN',
      staff
        ? `${row.orderNo} · 指派承办职员 ${await this.staffName(staff)}`
        : `${row.orderNo} · 收回承办（由服务商账号办理）`,
    );
    return { id, staff_user_id: staffUserIdValue };
  }
  async removeOrder(user: CurrentUser, id: number) {
    const row = await this.requireOwnOrder(user, id);
    if (!['DRAFT', 'VETOED', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅草稿、已否决、已取消的订货单可删除；流转中的单据请先否决或取消',
      );
    }
    await this.prisma.supplyOrderItem.deleteMany({ where: { orderId: id } });
    await this.prisma.supplyOrder.delete({ where: { id } });
    await this.identity.audit(user.userId, 'SUPPLY_ORDER_DELETE', `#${id}`);
    return { id, deleted: true };
  }
  async orderLogs(user: CurrentUser, id: number) {
    await this.requireVisible(user, 'ORDER', id);
    return this.prisma.supplyOrderLog.findMany({
      where: { bizType: 'ORDER', bizId: id },
      orderBy: { id: 'asc' },
    });
  }
  /* -------------------------------------------------------------- 服务预约单 */
  async listBookings(user: CurrentUser, query: Record<string, string> = {}) {
    const where = await this.bizWhere(user, query);
    if (where === null) return [];
    const rows = await this.prisma.supplyBooking.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return this.decorateStaff(rows);
  }
  async createBooking(user: CurrentUser, body: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const ep = eps[0];
    const contact = requireContact(readContact(body, 'contact'), '预约');
    const serviceId = num(body.service_id ?? body.serviceId, 0);
    const service = await this.prisma.supplyService.findUnique({
      where: { id: serviceId },
    });
    if (!service || service.status !== 'ONLINE') {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '服务项目不存在或已下架',
      );
    }
    const station = await this.requireStationById(service.stationId);
    if (station.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该服务站已停用，无法预约',
      );
    }
    const contract = await this.contracts.activeContractBetween(
      ep.id,
      service.providerUserId,
      'SUPPLY_NETWORK',
    );
    if (!contract) {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_CONTRACT,
        '与该服务商尚无生效中的「供销服务」签约，请先在供销网络发起签约',
      );
    }
    const planDate = str(body.plan_date ?? body.planDate).slice(0, 10);
    const siteAddress = str(body.site_address ?? body.siteAddress);
    if (!planDate || !siteAddress) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '计划服务时间与作业地点必填',
      );
    }

    const draft = bool(body.draft);
    const row = await this.prisma.supplyBooking.create({
      data: {
        bookingNo: await allocateNo(this.prisma, 'YY'),
        enterpriseId: ep.id,
        enterpriseName: ep.name,
        createdBy: user.userId,
        providerUserId: service.providerUserId,
        staffUserId: await this.identity.assignedStaffFor(
          service.providerUserId,
          ep.id,
        ),
        stationId: station.id,
        stationName: station.name,
        contactName: contact.name,
        contactPhone: contact.phone,
        serviceId: service.id,
        serviceName: service.name,
        priceUnit: service.priceUnit,
        planDate,
        siteAddress,
        scale: str(body.scale),
        remark: str(body.remark),
        status: draft ? 'DRAFT' : 'SUBMITTED',
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      row.id,
      draft ? 'SAVE_DRAFT' : 'SUBMIT',
      `${row.bookingNo} · ${service.name}${draft ? '（草稿）' : ''}`,
    );
    await this.identity.audit(
      user.userId,
      draft ? 'SUPPLY_BOOKING_DRAFT' : 'SUPPLY_BOOKING_CREATE',
      `#${row.id} ${row.bookingNo}`,
    );
    if (!draft) await this.dispatchTask(this.bookingTask(row));
    return { id: row.id, booking_no: row.bookingNo, status: row.status };
  }
  async submitBooking(user: CurrentUser, id: number) {
    const row = await this.requireOwnBooking(user, id);
    if (row.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.CONFLICT, '仅草稿可提交');
    }
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: { status: 'SUBMITTED', revision: { increment: 1 } },
    });
    await this.writeLog(user, 'BOOKING', id, 'SUBMIT', row.bookingNo);
    await this.dispatchTask(this.bookingTask(updated));
    return { id, status: updated.status, revision: updated.revision };
  }
  async updateBooking(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireOwnBooking(user, id);
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '预约单已生效（或已终止），不可再修改',
      );
    }
    const planDate = str(body.plan_date ?? body.planDate).slice(0, 10);
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: {
        ...this.contactPatch(body, '预约'),
        ...(planDate ? { planDate } : {}),
        ...(body.site_address === undefined && body.siteAddress === undefined
          ? {}
          : { siteAddress: str(body.site_address ?? body.siteAddress) }),
        ...(body.scale === undefined ? {} : { scale: str(body.scale) }),
        ...(body.remark === undefined ? {} : { remark: str(body.remark) }),
        status: 'SUBMITTED',
        revision: { increment: 1 },
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'RESUBMIT',
      `${row.bookingNo} · 第 ${updated.revision} 版`,
    );
    return { id, status: updated.status, revision: updated.revision };
  }
  async quoteBooking(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireBizActor(user, 'BOOKING', id, '报价');
    if (!QUOTABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `当前状态（${SUPPLY_STATUS_LABELS[row.status] || row.status}）不可报价`,
      );
    }
    const fees = normalizeFees(body.other_fees ?? body.otherFees);
    const baseAmount = round2(num(body.base_amount ?? body.baseAmount));
    const providerContact = requireContact(
      readContact(body, 'provider_contact'),
      '报价',
    );
    const result = await this.prisma.supplyBooking.update({
      where: { id },
      data: {
        status: 'QUOTED',
        quotedAt: new Date(),
        baseAmount,
        providerContactName: providerContact.name,
        providerContactPhone: providerContact.phone,
        otherFees: fees,
        feeAmount: round2(fees.reduce((acc, item) => acc + item.amount, 0)),
        totalAmount: round2(
          baseAmount + fees.reduce((acc, item) => acc + item.amount, 0),
        ),
        quoteNote: str(body.quote_note ?? body.quoteNote),
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'QUOTE',
      `${row.bookingNo} · 报价 ${Number(result.totalAmount).toFixed(2)} 元`,
    );
    return {
      id,
      status: result.status,
      total_amount: Number(result.totalAmount),
    };
  }
  async confirmBooking(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnBooking(user, id);
    if (!CONFIRMABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「已审核报价 · 待确认」状态可确认报价',
      );
    }
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        confirmedAt: new Date(),
        confirmNote: str(note),
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'CONFIRM',
      `${row.bookingNo} · 服务订单生效`,
    );
    return { id, status: updated.status };
  }
  async returnBooking(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnBooking(user, id);
    if (!CONFIRMABLE_STATUSES.includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「已审核报价 · 待确认」状态可驳回',
      );
    }
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: {
        status: 'RETURNED',
        confirmNote: str(note),
        revision: { increment: 1 },
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'RETURN',
      `${row.bookingNo} · 驳回原因：${str(note) || '—'}`,
    );
    return { id, status: updated.status };
  }
  async vetoBooking(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnBooking(user, id);
    if (
      row.status === 'ACTIVE' ||
      ['VETOED', 'CANCELLED'].includes(row.status)
    ) {
      throw new BusinessException(ErrorCode.CONFLICT, '该预约单不可否决');
    }
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: {
        status: 'VETOED',
        confirmNote: str(note),
        confirmedAt: new Date(),
      },
    });
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'VETO',
      `${row.bookingNo} · 否决原因：${str(note) || '—'}`,
    );
    return { id, status: updated.status };
  }
  async cancelBooking(user: CurrentUser, id: number, note = '') {
    const row = await this.requireOwnBooking(user, id);
    if (
      row.status === 'ACTIVE' ||
      ['VETOED', 'CANCELLED'].includes(row.status)
    ) {
      throw new BusinessException(ErrorCode.CONFLICT, '该预约单不可取消');
    }
    const updated = await this.prisma.supplyBooking.update({
      where: { id },
      data: { status: 'CANCELLED', confirmNote: str(note) },
    });
    await this.writeLog(user, 'BOOKING', id, 'CANCEL', row.bookingNo);
    return { id, status: updated.status };
  }
  async assignBooking(user: CurrentUser, id: number, staffUserId: string) {
    const row = await this.requireBooking(id);
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    if (row.providerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该单据所属服务商账号可指派承办职员',
      );
    }
    const staff = str(staffUserId);
    if (staff) {
      const bind = await this.prisma.providerStaff.findUnique({
        where: {
          providerUserId_staffUserId: {
            providerUserId: row.providerUserId,
            staffUserId: staff,
          },
        },
      });
      if (!bind || bind.status !== 'ACTIVE') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '该职员未绑定本机构',
        );
      }
    }
    const staffUserIdValue = this.taskDispatch
      ? await this.taskDispatch.assignDocument({
          source: 'supply-booking',
          sourceId: `sb-${id}`,
          orgUserId: row.providerUserId,
          staffUserId: staff,
          actorId: user.userId,
          note: `${row.bookingNo} · 指派承办职员`,
        })
      : (
          await this.prisma.supplyBooking.update({
            where: { id },
            data: { staffUserId: staff },
          })
        ).staffUserId;
    await this.writeLog(
      user,
      'BOOKING',
      id,
      'ASSIGN',
      staff
        ? `${row.bookingNo} · 指派承办职员 ${await this.staffName(staff)}`
        : `${row.bookingNo} · 收回承办（由服务商账号办理）`,
    );
    return { id, staff_user_id: staffUserIdValue };
  }
  async removeBooking(user: CurrentUser, id: number) {
    const row = await this.requireOwnBooking(user, id);
    if (!['DRAFT', 'VETOED', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅草稿、已否决、已取消的预约单可删除',
      );
    }
    await this.prisma.supplyBooking.delete({ where: { id } });
    await this.identity.audit(user.userId, 'SUPPLY_BOOKING_DELETE', `#${id}`);
    return { id, deleted: true };
  }
  async bookingLogs(user: CurrentUser, id: number) {
    await this.requireVisible(user, 'BOOKING', id);
    return this.prisma.supplyOrderLog.findMany({
      where: { bizType: 'BOOKING', bizId: id },
      orderBy: { id: 'asc' },
    });
  }
  /* -------------------------------------------------------- 平台监管（管理员） */
  /** 单据总览：按服务商/服务站筛选全部订货单与预约单，并按站点统计。 */
  async adminOverview(user: CurrentUser, query: Record<string, string> = {}) {
    this.identity.requireAdmin(user);
    const providerUserId = str(query.provider);
    const stationId = num(query.stationId ?? query.station_id, 0);
    const status = str(query.status);
    const where = {
      ...(providerUserId ? { providerUserId } : {}),
      ...(stationId ? { stationId } : {}),
      ...(status ? { status } : {}),
    };
    const [orders, bookings, stations, products, services] = await Promise.all([
      query.summariesOnly === '1'
        ? Promise.resolve([])
        : this.prisma.supplyOrder.findMany({
            where,
            orderBy: { id: 'desc' },
            take: 200,
          }),
      query.summariesOnly === '1'
        ? Promise.resolve([])
        : this.prisma.supplyBooking.findMany({
            where,
            orderBy: { id: 'desc' },
            take: 200,
          }),
      this.prisma.supplyStation.findMany({
        where: providerUserId ? { providerUserId } : {},
        orderBy: { id: 'asc' },
      }),
      this.prisma.supplyProduct.count({
        where: providerUserId ? { providerUserId } : {},
      }),
      this.prisma.supplyService.count({
        where: providerUserId ? { providerUserId } : {},
      }),
    ]);
    // 站点/服务商两组分桶计数：原来每站 3 次、每服务商 4 次**串行** count
    // （10 站 + 5 服务商 ≈ 50 个 round-trip），改为 7 个 groupBy 并发一次取齐。
    // 口径与原来一致：分桶计数不受本页 orders/bookings 的 stationId/status 筛选影响。
    const stationIds = stations.map((station) => station.id);
    const providerIds = [
      ...new Set(stations.map((station) => station.providerUserId)),
    ];
    const countMap = <K extends string>(
      rows: Array<
        Record<K, number | string> & {
          _count: {
            _all: number;
          };
        }
      >,
      key: K,
    ) => {
      const map = new Map<number | string, number>();
      for (const row of rows) map.set(row[key], row._count._all);
      return (id: number | string) => map.get(id) ?? 0;
    };
    const [
      stationOrders,
      stationBookings,
      stationProducts,
      providerOrders,
      providerBookings,
      providerProducts,
      providerServices,
    ] = await Promise.all([
      this.prisma.supplyOrder.groupBy({
        by: ['stationId'],
        where: { stationId: { in: stationIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyBooking.groupBy({
        by: ['stationId'],
        where: { stationId: { in: stationIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyProductStation.groupBy({
        by: ['stationId'],
        where: { stationId: { in: stationIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyOrder.groupBy({
        by: ['providerUserId'],
        where: { providerUserId: { in: providerIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyBooking.groupBy({
        by: ['providerUserId'],
        where: { providerUserId: { in: providerIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyProduct.groupBy({
        by: ['providerUserId'],
        where: { providerUserId: { in: providerIds } },
        _count: { _all: true },
      }),
      this.prisma.supplyService.groupBy({
        by: ['providerUserId'],
        where: { providerUserId: { in: providerIds } },
        _count: { _all: true },
      }),
    ]);
    const stationOrderOf = countMap(stationOrders, 'stationId');
    const stationBookingOf = countMap(stationBookings, 'stationId');
    const stationProductOf = countMap(stationProducts, 'stationId');
    const providerOrderOf = countMap(providerOrders, 'providerUserId');
    const providerBookingOf = countMap(providerBookings, 'providerUserId');
    const providerProductOf = countMap(providerProducts, 'providerUserId');
    const providerServiceOf = countMap(providerServices, 'providerUserId');
    const stationStats = stations.map((station) => ({
      station_id: station.id,
      station_name: station.name,
      provider_user_id: station.providerUserId,
      region: station.region,
      status: station.status,
      order_count: stationOrderOf(station.id),
      booking_count: stationBookingOf(station.id),
      product_count: stationProductOf(station.id),
    }));
    const providerStats = providerIds.map((providerId) => ({
      provider_user_id: providerId,
      station_count: stations.filter(
        (station) => station.providerUserId === providerId,
      ).length,
      order_count: providerOrderOf(providerId),
      booking_count: providerBookingOf(providerId),
      product_count: providerProductOf(providerId),
      service_count: providerServiceOf(providerId),
    }));
    // 装饰与总数一起并发：原来四个 await 串成一条链
    const [decoratedOrders, decoratedBookings, orderTotal, bookingTotal] =
      await Promise.all([
        this.decorateOrders(orders, false),
        this.decorateStaff(bookings),
        this.prisma.supplyOrder.count({ where }),
        this.prisma.supplyBooking.count({ where }),
      ]);
    return {
      orders: decoratedOrders,
      bookings: decoratedBookings,
      station_stats: stationStats,
      provider_stats: providerStats,
      totals: {
        orders: orderTotal,
        bookings: bookingTotal,
        providers: providerIds.length,
        stations: stations.length,
        products,
        services,
      },
    };
  }
  /* ---------------------------------------------------------------- 内部工具 */
  /** 当前用户可见的服务商范围：本人（服务商）/被挂靠机构 + 已签约供销服务的机构。 */
  private async supplierScope(user: CurrentUser) {
    const ctx = await this.identity.providerContext(user.userId);
    const eps = await this.identity.myEnterprises(user.userId);
    const contracts = eps.length
      ? await this.prisma.contract.findMany({
          where: {
            enterpriseId: { in: eps.map((item) => item.id) },
            serviceType: 'SUPPLY_NETWORK',
            status: 'ACTIVE',
          },
          select: { providerUserId: true },
        })
      : [];
    return [
      ...new Set([
        ...ctx.providers,
        ...contracts.map((item) => item.providerUserId),
      ]),
    ];
  }
  /** 企业身份没有服务商视角（用于判断是否只应看到在售资源）。 */
  private async enterpriseOnly(user: CurrentUser) {
    const ctx = await this.identity.providerContext(user.userId);
    return !ctx.providers.length && !this.identity.isPlatformAdmin(user);
  }
  /** 资源类写操作：必须服务商账号本人（机构级动作，职员不代替）。 */
  private async requireProviderAccount(user: CurrentUser) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    return user.userId;
  }
  private async requireStation(user: CurrentUser, id: number) {
    const row = await this.requireStationById(id);
    if (
      row.providerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该服务站所属服务商可操作',
      );
    }
    return row;
  }
  private async requireStationById(id: number) {
    const row = await this.prisma.supplyStation.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '服务站不存在');
    }
    return row;
  }
  /** 商品/服务项目必须绑定本机构的服务站。 */
  private async requireOwnStation(providerUserId: string, stationId: number) {
    if (!stationId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择所属服务站（服务必须绑定站点）',
      );
    }
    const station = await this.requireStationById(stationId);
    if (station.providerUserId !== providerUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务站不属于本机构，请先在「服务站」中创建',
      );
    }
    return station;
  }
  private async normalizeStationIds(providerUserId: string, value: unknown) {
    const ids = (Array.isArray(value) ? value : [])
      .map((item) => num(item, 0))
      .filter(Boolean);
    const unique = [...new Set(ids)];
    for (const stationId of unique) {
      await this.requireOwnStation(providerUserId, stationId);
    }
    return unique;
  }
  private async requireProduct(user: CurrentUser, id: number) {
    const row = await this.prisma.supplyProduct.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品不存在');
    }
    if (
      row.providerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该商品所属服务商可操作',
      );
    }
    return row;
  }
  private async requireService(user: CurrentUser, id: number) {
    const row = await this.prisma.supplyService.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '服务项目不存在');
    }
    if (
      row.providerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该服务项目所属服务商可操作',
      );
    }
    return row;
  }
  private async requireSku(user: CurrentUser, skuId: number) {
    const sku = await this.prisma.supplySku.findUnique({
      where: { id: skuId },
    });
    if (!sku) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品规格不存在');
    }
    await this.requireProduct(user, sku.productId);
    return sku;
  }
  private async requireOrder(id: number) {
    const row = await this.prisma.supplyOrder.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '订货单不存在');
    }
    return row;
  }
  private async requireBooking(id: number) {
    const row = await this.prisma.supplyBooking.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '服务预约单不存在');
    }
    return row;
  }
  /** 企业侧动作：仅单据创建人（或本企业当事人）+ 管理员。 */
  private async requireOwnOrder(user: CurrentUser, id: number) {
    const row = await this.requireOrder(id);
    await this.requireBelongsToEnterprise(user, row);
    return row;
  }
  /** 改单可选带联系方式：带则联系人 + 电话一起填（与下单表单同口径）。 */
  private contactPatch(body: Record<string, unknown>, who: string) {
    const touched = [
      'contact_name',
      'contactName',
      'contact_phone',
      'contactPhone',
    ].some((key) => body[key] !== undefined);
    if (!touched) return {};
    const contact = requireContact(readContact(body, 'contact'), who);
    return { contactName: contact.name, contactPhone: contact.phone };
  }
  private async requireOwnBooking(user: CurrentUser, id: number) {
    const row = await this.requireBooking(id);
    await this.requireBelongsToEnterprise(user, row);
    return row;
  }
  private async requireBelongsToEnterprise(
    user: CurrentUser,
    row: {
      createdBy: string;
      enterpriseId: number;
    },
  ) {
    if (this.identity.isPlatformAdmin(user)) return;
    if (row.createdBy === user.userId) return;
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.some((item) => item.id === row.enterpriseId)) return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '仅本企业当事人可操作该单据',
    );
  }
  /** 服务商侧动作：服务商账号或**被该服务商指派承办的职员**本人。 */
  private async requireBizActor(
    user: CurrentUser,
    bizType: 'ORDER',
    id: number,
    action: string,
  ): Promise<SupplyOrder>;
  private async requireBizActor(
    user: CurrentUser,
    bizType: 'BOOKING',
    id: number,
    action: string,
  ): Promise<SupplyBooking>;
  private async requireBizActor(
    user: CurrentUser,
    bizType: 'ORDER' | 'BOOKING',
    id: number,
    action: string,
  ) {
    const row =
      bizType === 'ORDER'
        ? await this.requireOrder(id)
        : await this.requireBooking(id);
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        row.staffUserId
          ? `仅该单据的承办职员可${action}（服务商账号不代替承办人作业）`
          : `请服务商先在单据上「指派承办职员」，或由服务商账号本人${action}`,
      );
    }
    return row;
  }
  private async requireVisible(
    user: CurrentUser,
    bizType: 'ORDER' | 'BOOKING',
    id: number,
  ) {
    const row =
      bizType === 'ORDER'
        ? await this.requireOrder(id)
        : await this.requireBooking(id);
    if (this.identity.isPlatformAdmin(user)) return row;
    if (row.createdBy === user.userId) return row;
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.some((item) => item.id === row.enterpriseId)) return row;
    if (await this.identity.canWorkOn(user, row)) return row;
    throw new BusinessException(ErrorCode.FORBIDDEN, '无权查看该单据');
  }
  /** 单据可见范围：管理员全量、企业当事人本企业、服务商/职员按承办口径。 */
  private async bizWhere(user: CurrentUser, query: Record<string, string>) {
    const stationId = num(query.stationId ?? query.station_id, 0);
    const status = str(query.status);
    const extra: Record<string, unknown> = {
      ...(stationId ? { stationId } : {}),
      ...(status ? { status } : {}),
      ...(str(query.provider) ? { providerUserId: str(query.provider) } : {}),
    };
    if (this.identity.isPlatformAdmin(user)) return extra;
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    const base = {
      OR: [
        { createdBy: user.userId },
        { enterpriseId: { in: eps.map((item) => item.id) } },
        ...(identity === 'SERVICE_PROVIDER'
          ? [
              {
                providerUserId: user.userId,
                OR: [{ staffUserId: user.userId }, { staffUserId: '' }],
              },
            ]
          : []),
        ...(identity !== 'SERVICE_PROVIDER' && identity !== 'ENTERPRISE_USER'
          ? [{ staffUserId: user.userId }]
          : []),
      ],
    };
    if (!eps.length && identity === 'ENTERPRISE_USER') {
      return { ...extra, createdBy: user.userId };
    }
    return { ...extra, ...base };
  }
  /** 明细快照：下单/改单时锁定商品与规格名称、单位与基准价。 */
  private async buildItems(
    providerUserId: string,
    value: unknown,
    stationId: number,
  ) {
    const wanted: {
      productId: number;
      skuId: number;
      quantity: number;
    }[] = [];
    for (const row of asArray(value)) {
      const productId = num(row.product_id ?? row.productId, 0);
      const skuId = num(row.sku_id ?? row.skuId, 0);
      const quantity = num(row.quantity, 0);
      if (!productId || quantity <= 0) continue;
      wanted.push({ productId, skuId, quantity });
    }
    if (!wanted.length) return [];
    // 明细校验一次取齐商品 / 服务站挂靠 / 规格与规格数（原先每行 3~4 次查询）
    const productIds = [...new Set(wanted.map((item) => item.productId))];
    const skuIds = [
      ...new Set(wanted.map((item) => item.skuId).filter(Boolean)),
    ];
    const [products, links, skus, specCounts] = await Promise.all([
      this.prisma.supplyProduct.findMany({
        where: { id: { in: productIds } },
      }),
      this.prisma.supplyProductStation.findMany({
        where: { productId: { in: productIds }, stationId },
      }),
      this.prisma.supplySku.findMany({ where: { id: { in: skuIds } } }),
      this.prisma.supplySku.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds } },
        _count: { _all: true },
      }),
    ]);
    const productMap = new Map(products.map((item) => [item.id, item]));
    const linkMap = new Map(links.map((item) => [item.productId, item]));
    const skuMap = new Map(skus.map((item) => [item.id, item]));
    const specCountMap = new Map(
      specCounts.map((item) => [item.productId, item._count._all]),
    );
    const items: OrderItemInput[] = [];
    for (const { productId, skuId, quantity } of wanted) {
      const product = productMap.get(productId);
      if (!product || product.providerUserId !== providerUserId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '订货明细包含非本服务商的商品',
        );
      }
      if (product.status !== 'ONLINE') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `商品「${product.name}」已下架，无法下单`,
        );
      }
      const link = linkMap.get(productId);
      if (!link || link.status !== 'ONLINE') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `商品「${product.name}」在该服务站未上架`,
        );
      }
      const sku = skuId ? skuMap.get(skuId) : undefined;
      if (skuId && (!sku || sku.productId !== productId)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '商品规格不匹配');
      }
      // 商品价格按规格设定：必须选规格成交，未设规格价的商品不可下单
      if (!sku) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          specCountMap.get(productId)
            ? `商品「${product.name}」需按规格下单，请选择规格`
            : `商品「${product.name}」尚未设置规格价，暂不可下单`,
        );
      }
      const price = Number(sku.supplyPrice);
      items.push({
        productId,
        skuId: sku.id,
        productName: product.name,
        specName: sku.specName || '',
        unit: sku.unit || product.unit,
        price,
        quantity,
        amount: round2(price * quantity),
        stockState: 'SUFFICIENT',
      });
    }
    return items;
  }
  /**
   * 报价金额汇总：明细行 amount 逐行重算 + 商品 / 其他费用 / 合计三档。
   * 传入事务客户端时与主表更新同生共死（调用方负责把 productAmount 写回主表）。
   */
  private async applyAmounts(
    client: Prisma.TransactionClient,
    items: {
      id?: number;
      price: number;
      quantity: number;
    }[],
    fees: FeeEntry[],
  ) {
    const productAmount = round2(
      items.reduce((acc, item) => acc + item.price * item.quantity, 0),
    );
    for (const item of items) {
      if (!item.id) continue;
      await client.supplyOrderItem.update({
        where: { id: item.id },
        data: { amount: round2(item.price * item.quantity) },
      });
    }
    const feeAmount = round2(fees.reduce((acc, item) => acc + item.amount, 0));
    return {
      productAmount,
      feeAmount,
      totalAmount: round2(productAmount + feeAmount),
    };
  }
  /** 单据回传承办职员姓名：对方（企业/服务商）需要看到经手人是谁。 */
  private async decorateStaff<
    T extends {
      staffUserId: string;
    },
  >(rows: T[]) {
    const ids = [
      ...new Set(rows.map((item) => item.staffUserId).filter(Boolean)),
    ];
    const profiles = ids.length
      ? await this.prisma.staffProfile.findMany({
          where: { userId: { in: ids } },
        })
      : [];
    return rows.map((row) => ({
      ...row,
      staffName: row.staffUserId
        ? profiles.find((item) => item.userId === row.staffUserId)?.realName ||
          row.staffUserId
        : '',
    }));
  }
  private async decorateOrders<
    T extends {
      id: number;
      enterpriseId: number;
      providerUserId: string;
    },
  >(rows: T[], withItems = true) {
    const items = withItems
      ? await this.prisma.supplyOrderItem.findMany({
          where: {
            orderId: {
              in: rows.map((item) => item.id),
            },
          },
          orderBy: { id: 'asc' },
        })
      : [];
    const decorated = await this.decorateStaff(
      rows as (T & {
        staffUserId: string;
      })[],
    );
    const out = [];
    for (const row of decorated) {
      out.push({
        ...row,
        items: items.filter((item) => item.orderId === row.id),
      });
    }
    return out;
  }
  private async staffName(userId: string) {
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId },
    });
    return profile?.realName || userId;
  }
  private async writeLog(
    user: CurrentUser,
    bizType: 'ORDER' | 'BOOKING',
    bizId: number,
    action: string,
    detail: string,
  ) {
    const name = await this.staffName(user.userId);
    await this.prisma.supplyOrderLog.create({
      data: {
        bizType,
        bizId,
        action,
        operatorUserId: user.userId,
        operatorName: name,
        detail,
      },
    });
  }
  /**
   * AIworkin GEO 独立站同步状态：交易数据本地自持，营销展示页由 AIworkin 驱动。
   * 通道未启用时按 §7.8 本地留痕（SKIPPED），接通后由同步任务回填 listing_id。
   */
  private syncState() {
    if (!this.aiworkin.isEnabled()) {
      return {
        status: 'SKIPPED',
        note: 'AIworkin 通道未启用（AIWORKIN_ENABLED=false），独立站展示待接通后同步',
        tip: '已保存',
      };
    }
    return {
      status: 'PENDING',
      note: '',
      tip: '已保存，独立站展示页待同步 AIworkin',
    };
  }
}
