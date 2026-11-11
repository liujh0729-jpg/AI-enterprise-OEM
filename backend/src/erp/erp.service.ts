import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, ds, orgKey } from '../hrm/hrm.helpers';
import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import type { Prisma } from '../../generated/prisma';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };
const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round = (value: number, digits = 2): number => {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number): string => {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T00:00:00Z`)
    : new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};
const dayDiff = (from: string, to = today()): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  allowed.includes(String(value) as T) ? (String(value) as T) : fallback;

const MOVES = ['IN', 'OUT', 'TRANSFER', 'ADJUST'] as const;
const RECURRENCES = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

/**
 * 职能权限（设计方案 §四/§3.4）：ERP 管理操作按职能域分别授权，
 * 不与 HR 管理角色串用——HR 角色不自动获得采购/财务/库存管理权。
 */
type ErpFunction = 'PURCHASE' | 'INVENTORY' | 'FINANCE';

const ERP_FUNCTION_ROLES: Record<ErpFunction, readonly string[]> = {
  PURCHASE: ['PURCHASE', 'PURCHASING', 'BUYER', '采购'],
  INVENTORY: ['INVENTORY', 'STOCK', 'WAREHOUSE', '库存', '仓管'],
  FINANCE: ['FINANCE', 'ACCOUNTING', '财务'],
};

const ERP_FUNCTION_LABELS: Record<ErpFunction, string> = {
  PURCHASE: '采购',
  INVENTORY: '库存',
  FINANCE: '财务',
};

/** 组织管理员角色：不细分职能，可管理全部 ERP 职能域（组织主账号/管理员）。 */
const ERP_ADMIN_ROLES = ['ADMIN', 'OWNER', 'ERP', 'ERP_ADMIN'];

/**
 * 大额付款审批阈值（docs §5.3 采购闭环「付款审批」）：
 * 与 OA「付款申请」模板的大额二次确认同一口径（5 万元）；
 * 应付金额达到该值的应付单需财务审批通过后才可登记付款，低额直接付款。
 */
const PAYMENT_APPROVAL_THRESHOLD = 50000;

const PAYMENT_APPROVAL_LABELS: Record<string, string> = {
  NONE: '无需审批',
  PENDING: '待付款审批',
  APPROVED: '付款审批通过',
  REJECTED: '付款审批驳回',
};

/**
 * 岗位名称关键词（企业「职能管理」岗位目录为自由命名，如「采购主管」「仓库管理员」「会计」）：
 * 与角色码互为补充，任一命中即授予该职能域，避免只认角色码导致无从授权。
 */
const ERP_FUNCTION_POSITION_KEYWORDS: Record<ErpFunction, readonly string[]> = {
  PURCHASE: ['采购', '供应', 'buyer', 'purchas'],
  INVENTORY: [
    '库存',
    '仓储',
    '仓管',
    '仓库',
    '存货',
    'warehouse',
    'inventor',
    'stock',
  ],
  FINANCE: ['财务', '会计', '出纳', 'account', 'financ'],
};

/**
 * §5.4 ERP 进销存 + 应收应付：产品/变体/仓库/库存流水与领用、供应商/采购/入库、
 * 应收/应付/费用/税率/价格策略 + AI 经营评估（规则式兜底、LLM 可选）。
 * 组织键与 HRM 共用 (orgType, orgUserId)；关键动作发 `erp.*` 事件供 Webhook/规则消费。
 */
export class ErpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
    private readonly aiEval: AiEvalService,
  ) {}

  private async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private emit(org: HrmOrg, event: string, payload: Row) {
    void this.mechanisms.dispatch(org, event, payload).catch(() => undefined);
  }

  private async chainNo(
    org: HrmOrg,
    prefix: string,
    count: () => Promise<number>,
  ): Promise<string> {
    const stamp = today().replace(/-/g, '');
    return `${prefix}-${stamp}-${String((await count()) + 1).padStart(4, '0')}`;
  }

  /**
   * 更新分支的组织归属校验：管理员身份不能替代目标记录的组织校验（设计方案 §3.3），
   * 否则用别家组织的记录 id 也能覆盖本组织数据。查不到即按「不存在」拒绝。
   */
  private async requireOwnedRow(
    label: string,
    find: () => Promise<{ id: number } | null>,
  ): Promise<void> {
    if (!(await find()))
      throw new BusinessException(ErrorCode.NOT_FOUND, `${label}不存在`);
  }

  private async requireWarehouse(org: HrmOrg, id: number) {
    const row = await this.prisma.erpWarehouse.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '仓库不存在');
    return row;
  }

  private async requireVariant(org: HrmOrg, id: number) {
    const row = await this.prisma.erpVariant.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品规格不存在');
    return row;
  }

  private async taxRateOf(productId: number): Promise<number> {
    const product = await this.prisma.erpProduct.findUnique({
      where: { id: productId },
    });
    return num(product?.taxRate);
  }

  /**
   * 职能域鉴权：组织主账号与 ERP 管理员可管理全部职能；
   * 其余成员必须持有该职能域对应的角色码，或岗位名称命中该职能域关键词——
   * 避免「HR 角色顺带管理采购/财务」或只认角色码导致无从授权。
   */
  private requireErpRole(org: HrmOrg, fn: ErpFunction): void {
    if (org.isOwner) return;
    if (org.roles.some((role) => ERP_ADMIN_ROLES.includes(role))) return;
    if (org.roles.some((role) => ERP_FUNCTION_ROLES[fn].includes(role))) return;
    const keywords = ERP_FUNCTION_POSITION_KEYWORDS[fn];
    const byPosition = org.positions.some((position) => {
      const name = position.toLowerCase();
      return keywords.some((keyword) => name.includes(keyword));
    });
    if (byPosition) return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      `该操作需要${ERP_FUNCTION_LABELS[fn]}职能权限（组织主账号、ERP 管理员或对应岗位角色）`,
    );
  }

  // ------------------------------------------------------------------
  // 概览
  // ------------------------------------------------------------------

  async overview(user: CurrentUser) {
    const org = await this.org(user);
    const base = { orgType: org.orgType, orgUserId: org.orgUserId };
    const monthStart = `${today().slice(0, 7)}-01`;
    const [
      products,
      warehouses,
      stockRows,
      pendingPurchase,
      receivableRows,
      payableRows,
      monthPurchase,
      monthReceivable,
    ] = await Promise.all([
      this.prisma.erpProduct.count({ where: base }),
      this.prisma.erpWarehouse.count({ where: base }),
      this.prisma.erpStock.findMany({ where: base }),
      this.prisma.erpPurchaseOrder.count({
        where: { ...base, status: { in: ['PENDING', 'APPROVED'] } },
      }),
      this.prisma.erpReceivable.findMany({
        where: { ...base, status: { notIn: ['PAID', 'CANCELED'] } },
      }),
      this.prisma.erpPayable.findMany({
        where: { ...base, status: { notIn: ['PAID', 'CANCELED'] } },
      }),
      this.prisma.erpPurchaseOrder.aggregate({
        where: {
          ...base,
          createdAt: { gte: new Date(`${monthStart}T00:00:00Z`) },
          status: { not: 'CANCELED' },
        },
        _sum: { amount: true },
      }),
      this.prisma.erpReceivable.aggregate({
        where: {
          ...base,
          createdAt: { gte: new Date(`${monthStart}T00:00:00Z`) },
          status: { not: 'CANCELED' },
        },
        _sum: { amount: true },
      }),
    ]);
    const variantIds = [...new Set(stockRows.map((row) => row.variantId))];
    const variants = variantIds.length
      ? await this.prisma.erpVariant.findMany({
          where: { id: { in: variantIds } },
        })
      : [];
    const priceOf = new Map(
      variants.map((row) => [row.id, num(row.purchasePrice)]),
    );
    const stockValue = stockRows.reduce(
      (sum, row) => sum + num(row.onHand) * (priceOf.get(row.variantId) || 0),
      0,
    );
    const lowStock = stockRows.filter(
      (row) =>
        num(row.reorderPoint) > 0 && num(row.onHand) < num(row.reorderPoint),
    ).length;
    const receivableOpen = receivableRows.reduce(
      (sum, row) => sum + num(row.amount) - num(row.receivedAmount),
      0,
    );
    const payableOpen = payableRows.reduce(
      (sum, row) => sum + num(row.amount) - num(row.paidAmount),
      0,
    );
    const overdue = receivableRows
      .filter((row) => row.dueDate && row.dueDate < today())
      .reduce((sum, row) => sum + num(row.amount) - num(row.receivedAmount), 0);
    return {
      products,
      warehouses,
      stockValue: ds(stockValue),
      lowStock,
      pendingPurchase,
      receivableOpen: ds(receivableOpen),
      payableOpen: ds(payableOpen),
      overdueReceivable: ds(overdue),
      monthPurchase: ds(monthPurchase._sum.amount),
      monthSales: ds(monthReceivable._sum.amount),
    };
  }

  // ------------------------------------------------------------------
  // 分类 / 产品 / 变体
  // ------------------------------------------------------------------

  async listCategories(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.erpCategory.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveCategory(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const data = {
      code: clip(body.code, 32),
      name: clip(body.name, 80),
      parentId: Math.max(0, num(body.parentId)),
      sortOrder: Math.trunc(num(body.sortOrder)),
    };
    if (!data.code || !data.name)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写分类编码与名称',
      );
    if (data.parentId) {
      const parent = await this.prisma.erpCategory.findFirst({
        where: {
          id: data.parentId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      });
      if (!parent)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '上级分类不存在');
    }
    if (id)
      await this.requireOwnedRow('分类', () =>
        this.prisma.erpCategory.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpCategory.update({ where: { id }, data })
      : await this.prisma.erpCategory.create({
          data: { ...orgKey(org), ...data },
        });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async removeCategory(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const row = await this.prisma.erpCategory.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '分类不存在');
    const [children, products] = await Promise.all([
      this.prisma.erpCategory.count({ where: { parentId: id } }),
      this.prisma.erpProduct.count({
        where: {
          categoryId: id,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      }),
    ]);
    if (children || products) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '分类下还有子分类或商品，无法删除',
      );
    }
    await this.prisma.erpCategory.delete({ where: { id } });
    return { id };
  }

  private async productViews(
    rows: Array<{
      id: number;
      code: string;
      name: string;
      categoryId: number;
      unit: string;
      spec: string;
      barcode: string;
      purchasePrice: unknown;
      salePrice: unknown;
      taxRate: unknown;
      status: string;
      note: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
    org: HrmOrg,
  ) {
    const ids = rows.map((row) => row.id);
    if (!ids.length) return [];
    const [categories, variants] = await Promise.all([
      this.prisma.erpCategory.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.erpVariant.findMany({ where: { productId: { in: ids } } }),
    ]);
    const stocks = variants.length
      ? await this.prisma.erpStock.findMany({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            variantId: { in: variants.map((v) => v.id) },
          },
        })
      : [];
    const categoryName = new Map(categories.map((row) => [row.id, row.name]));
    const variantCount = new Map<number, number>();
    const variantProduct = new Map(
      variants.map((row) => [row.id, row.productId]),
    );
    const onHand = new Map<number, number>();
    for (const row of variants)
      variantCount.set(
        row.productId,
        (variantCount.get(row.productId) || 0) + 1,
      );
    for (const stock of stocks) {
      const productId = variantProduct.get(stock.variantId) || 0;
      onHand.set(productId, (onHand.get(productId) || 0) + num(stock.onHand));
    }
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: categoryName.get(row.categoryId) || '',
      unit: row.unit,
      spec: row.spec,
      barcode: row.barcode,
      purchasePrice: ds(row.purchasePrice),
      salePrice: ds(row.salePrice),
      taxRate: ds(row.taxRate),
      status: row.status as 'ACTIVE' | 'INACTIVE',
      note: row.note,
      variantCount: variantCount.get(row.id) || 0,
      onHand: ds(onHand.get(row.id) || 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async listProducts(
    user: CurrentUser,
    query: PageQuery & { q?: string; categoryId?: number; status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpProductWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { code: { contains: query.q } },
        { barcode: { contains: query.q } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.erpProduct.count({ where }),
      this.prisma.erpProduct.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.productViews(rows, org),
    };
  }

  async saveProduct(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const data = {
      code: clip(body.code, 32),
      name: clip(body.name, 120),
      categoryId: Math.max(0, num(body.categoryId)),
      unit: clip(body.unit, 16) || '件',
      spec: clip(body.spec, 120),
      barcode: clip(body.barcode, 64),
      purchasePrice: num(body.purchasePrice),
      salePrice: num(body.salePrice),
      taxRate: Math.min(100, Math.max(0, num(body.taxRate))),
      status: oneOf(body.status, ['ACTIVE', 'INACTIVE'] as const, 'ACTIVE'),
      note: clip(body.note, 500),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写商品名称');
    if (id)
      await this.requireOwnedRow('商品', () =>
        this.prisma.erpProduct.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpProduct.update({ where: { id }, data })
      : await this.prisma.erpProduct.create({
          data: { ...orgKey(org), ...data, createdBy: org.actorId },
        });
    const [view] = await this.productViews([row], org);
    return view;
  }

  async removeProduct(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const row = await this.prisma.erpProduct.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '商品不存在');
    const variants = await this.prisma.erpVariant.findMany({
      where: { productId: id },
    });
    const variantIds = variants.map((v) => v.id);
    await this.prisma.$transaction([
      this.prisma.erpStock.deleteMany({
        where: { variantId: { in: variantIds } },
      }),
      this.prisma.erpVariant.deleteMany({ where: { productId: id } }),
      this.prisma.erpProduct.delete({ where: { id } }),
    ]);
    return { id };
  }

  private async variantViews(
    rows: Array<{
      id: number;
      productId: number;
      sku: string;
      name: string;
      attributes: unknown;
      purchasePrice: unknown;
      salePrice: unknown;
      status: string;
      createdAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const productIds = [...new Set(rows.map((row) => row.productId))];
    const [products, stocks] = await Promise.all([
      this.prisma.erpProduct.findMany({ where: { id: { in: productIds } } }),
      this.prisma.erpStock.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          variantId: { in: rows.map((row) => row.id) },
        },
      }),
    ]);
    const productName = new Map(products.map((row) => [row.id, row.name]));
    const totals = new Map<
      number,
      { onHand: number; inTransit: number; locked: number }
    >();
    for (const stock of stocks) {
      const entry = totals.get(stock.variantId) || {
        onHand: 0,
        inTransit: 0,
        locked: 0,
      };
      entry.onHand += num(stock.onHand);
      entry.inTransit += num(stock.inTransit);
      entry.locked += num(stock.locked);
      totals.set(stock.variantId, entry);
    }
    return rows.map((row) => {
      const total = totals.get(row.id) || {
        onHand: 0,
        inTransit: 0,
        locked: 0,
      };
      const attributes =
        row.attributes &&
        typeof row.attributes === 'object' &&
        !Array.isArray(row.attributes)
          ? Object.fromEntries(
              Object.entries(row.attributes as Record<string, unknown>).map(
                ([k, v]) => [k, text(v)],
              ),
            )
          : {};
      return {
        id: row.id,
        productId: row.productId,
        productName: productName.get(row.productId) || '',
        sku: row.sku,
        name: row.name,
        attributes,
        purchasePrice: ds(row.purchasePrice),
        salePrice: ds(row.salePrice),
        status: row.status as 'ACTIVE' | 'INACTIVE',
        onHand: ds(total.onHand),
        inTransit: ds(total.inTransit),
        locked: ds(total.locked),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async listVariants(
    user: CurrentUser,
    query: { productId?: number; q?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpVariantWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.productId) where.productId = query.productId;
    if (query.q)
      where.OR = [
        { sku: { contains: query.q } },
        { name: { contains: query.q } },
      ];
    const rows = await this.prisma.erpVariant.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 500,
    });
    return this.variantViews(rows, org);
  }

  async saveVariant(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const productId = num(body.productId);
    const product = await this.prisma.erpProduct.findFirst({
      where: { id: productId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!product)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品不存在');
    const id = num(body.id);
    const data = {
      productId,
      sku: clip(body.sku, 64),
      name: clip(body.name, 120),
      attributes: json(body.attributes || {}),
      purchasePrice: num(body.purchasePrice),
      salePrice: num(body.salePrice),
      status: oneOf(body.status, ['ACTIVE', 'INACTIVE'] as const, 'ACTIVE'),
    };
    if (!data.sku)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写 SKU');
    if (id)
      await this.requireOwnedRow('商品规格', () =>
        this.prisma.erpVariant.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpVariant.update({ where: { id }, data })
      : await this.prisma.erpVariant.create({
          data: { ...orgKey(org), ...data },
        });
    const [view] = await this.variantViews([row], org);
    return view;
  }

  async removeVariant(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const row = await this.prisma.erpVariant.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品规格不存在');
    await this.prisma.$transaction([
      this.prisma.erpStock.deleteMany({ where: { variantId: id } }),
      this.prisma.erpVariant.delete({ where: { id } }),
    ]);
    return { id };
  }

  // ------------------------------------------------------------------
  // 仓库 / 库存
  // ------------------------------------------------------------------

  async listWarehouses(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.erpWarehouse.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: { id: 'asc' },
    });
    const stocks = await this.prisma.erpStock.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const kinds = new Map<number, Set<number>>();
    const totals = new Map<number, number>();
    for (const stock of stocks) {
      const set = kinds.get(stock.warehouseId) || new Set<number>();
      set.add(stock.variantId);
      kinds.set(stock.warehouseId, set);
      totals.set(
        stock.warehouseId,
        (totals.get(stock.warehouseId) || 0) + num(stock.onHand),
      );
    }
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      managerId: row.managerId,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      stockKinds: kinds.get(row.id)?.size || 0,
      totalQty: ds(totals.get(row.id) || 0),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveWarehouse(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const data = {
      code: clip(body.code, 32),
      name: clip(body.name, 80),
      address: clip(body.address, 200),
      managerId: clip(body.managerId, 64),
      status: oneOf(body.status, ['ACTIVE', 'INACTIVE'] as const, 'ACTIVE'),
    };
    if (!data.code || !data.name)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写仓库编码与名称',
      );
    if (data.managerId)
      await this.scope.requireStaff(org, data.managerId, false);
    if (id)
      await this.requireOwnedRow('仓库', () =>
        this.prisma.erpWarehouse.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpWarehouse.update({ where: { id }, data })
      : await this.prisma.erpWarehouse.create({
          data: { ...orgKey(org), ...data },
        });
    const all = await this.listWarehouses(user);
    return all.find((item) => item.id === row.id)!;
  }

  async removeWarehouse(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const row = await this.requireWarehouse(org, id);
    const stockCount = await this.prisma.erpStock.count({
      where: { warehouseId: id },
    });
    if (stockCount)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仓库下仍有库存，无法删除',
      );
    await this.prisma.erpWarehouse.delete({ where: { id } });
    return { id: row.id };
  }

  private async stockViews(
    rows: Array<{
      id: number;
      warehouseId: number;
      variantId: number;
      onHand: unknown;
      inTransit: unknown;
      locked: unknown;
      reorderPoint: unknown;
      updatedAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const [warehouses, variants] = await Promise.all([
      this.prisma.erpWarehouse.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.erpVariant.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          id: { in: rows.map((r) => r.variantId) },
        },
      }),
    ]);
    const products = variants.length
      ? await this.prisma.erpProduct.findMany({
          where: { id: { in: variants.map((v) => v.productId) } },
        })
      : [];
    const warehouseName = new Map(warehouses.map((row) => [row.id, row.name]));
    const variant = new Map(variants.map((row) => [row.id, row]));
    const productName = new Map(products.map((row) => [row.id, row.name]));
    return rows.map((row) => {
      const v = variant.get(row.variantId);
      return {
        id: row.id,
        warehouseId: row.warehouseId,
        warehouseName: warehouseName.get(row.warehouseId) || '',
        variantId: row.variantId,
        sku: v?.sku || '',
        productName: v ? productName.get(v.productId) || '' : '',
        onHand: ds(row.onHand),
        inTransit: ds(row.inTransit),
        locked: ds(row.locked),
        reorderPoint: ds(row.reorderPoint),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async listStock(
    user: CurrentUser,
    query: PageQuery & { warehouseId?: number; q?: string; lowOnly?: boolean },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpStockWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    let rows = await this.prisma.erpStock.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    if (query.q) {
      const variants = await this.prisma.erpVariant.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          OR: [{ sku: { contains: query.q } }, { name: { contains: query.q } }],
        },
        select: { id: true },
      });
      const ids = new Set(variants.map((v) => v.id));
      rows = rows.filter((row) => ids.has(row.variantId));
    }
    if (query.lowOnly)
      rows = rows.filter(
        (row) =>
          num(row.reorderPoint) > 0 && num(row.onHand) < num(row.reorderPoint),
      );
    const total = rows.length;
    const pageRows = rows.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    );
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.stockViews(pageRows, org),
    };
  }

  async stockAlerts(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.erpStock.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const low = rows.filter(
      (row) =>
        num(row.reorderPoint) > 0 && num(row.onHand) < num(row.reorderPoint),
    );
    const views = await this.stockViews(low, org);
    return views.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productName: row.productName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      onHand: row.onHand,
      reorderPoint: row.reorderPoint,
      gap: ds(num(row.reorderPoint) - num(row.onHand)),
    }));
  }

  private async moveViews(
    rows: Array<{
      id: number;
      moveNo: string;
      type: string;
      warehouseId: number;
      toWarehouseId: number;
      variantId: number;
      quantity: unknown;
      unitCost: unknown;
      sourceType: string;
      sourceId: number;
      note: string;
      createdBy: string;
      createdAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const [warehouses, variants] = await Promise.all([
      this.prisma.erpWarehouse.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.erpVariant.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          id: { in: rows.map((r) => r.variantId) },
        },
      }),
    ]);
    const products = variants.length
      ? await this.prisma.erpProduct.findMany({
          where: { id: { in: variants.map((v) => v.productId) } },
        })
      : [];
    const warehouseName = new Map(warehouses.map((row) => [row.id, row.name]));
    const variant = new Map(variants.map((row) => [row.id, row]));
    const productName = new Map(products.map((row) => [row.id, row.name]));
    return rows.map((row) => {
      const v = variant.get(row.variantId);
      return {
        id: row.id,
        moveNo: row.moveNo,
        type: row.type,
        warehouseId: row.warehouseId,
        warehouseName: warehouseName.get(row.warehouseId) || '',
        toWarehouseId: row.toWarehouseId,
        variantId: row.variantId,
        sku: v?.sku || '',
        productName: v ? productName.get(v.productId) || '' : '',
        quantity: ds(row.quantity),
        unitCost: ds(row.unitCost),
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        note: row.note,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async listMoves(
    user: CurrentUser,
    query: PageQuery & {
      warehouseId?: number;
      type?: string;
      variantId?: number;
    },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpStockMoveWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.type) where.type = query.type;
    if (query.variantId) where.variantId = query.variantId;
    const [total, rows] = await Promise.all([
      this.prisma.erpStockMove.count({ where }),
      this.prisma.erpStockMove.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.moveViews(rows, org),
    };
  }

  /** 库存应用：IN 增、OUT 减、TRANSFER 仓库间转移、ADJUST 以实存覆盖。 */
  private async applyMove(
    org: HrmOrg,
    tx: Prisma.TransactionClient,
    input: {
      type: string;
      warehouseId: number;
      toWarehouseId: number;
      variantId: number;
      quantity: number;
      unitCost: number;
      note: string;
      sourceType: string;
      sourceId: number;
      createdBy: string;
      moveNo: string;
    },
  ) {
    const upsertStock = async (
      warehouseId: number,
      delta: number,
      mode: 'add' | 'set',
    ) => {
      const existing = await tx.erpStock.findUnique({
        where: {
          warehouseId_variantId: { warehouseId, variantId: input.variantId },
        },
      });
      const current = num(existing?.onHand);
      const next = mode === 'set' ? delta : current + delta;
      if (next < 0) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '库存不足，无法出库',
        );
      }
      if (existing) {
        return tx.erpStock.update({
          where: { id: existing.id },
          data: { onHand: next, updatedAt: new Date() },
        });
      }
      return tx.erpStock.create({
        data: {
          ...orgKey(org),
          warehouseId,
          variantId: input.variantId,
          onHand: next,
        },
      });
    };
    if (input.type === 'IN')
      await upsertStock(input.warehouseId, input.quantity, 'add');
    else if (input.type === 'OUT')
      await upsertStock(input.warehouseId, -input.quantity, 'add');
    else if (input.type === 'TRANSFER') {
      if (!input.toWarehouseId || input.toWarehouseId === input.warehouseId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '调拨需要选择不同的目标仓库',
        );
      }
      await upsertStock(input.warehouseId, -input.quantity, 'add');
      await upsertStock(input.toWarehouseId, input.quantity, 'add');
    } else {
      await upsertStock(input.warehouseId, input.quantity, 'set');
    }
    return tx.erpStockMove.create({
      data: {
        ...orgKey(org),
        moveNo: input.moveNo,
        type: input.type,
        warehouseId: input.warehouseId,
        toWarehouseId: input.toWarehouseId,
        variantId: input.variantId,
        quantity: input.quantity,
        unitCost: input.unitCost,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        note: input.note,
        createdBy: input.createdBy,
      },
    });
  }

  async saveMove(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const type = oneOf(body.type, MOVES, 'IN');
    const warehouseId = num(body.warehouseId);
    await this.requireWarehouse(org, warehouseId);
    const toWarehouseId = num(body.toWarehouseId);
    if (toWarehouseId) await this.requireWarehouse(org, toWarehouseId);
    const variant = await this.requireVariant(org, num(body.variantId));
    const quantity = num(body.quantity);
    if (quantity <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '数量必须大于 0');
    const moveNo = await this.chainNo(org, 'KC', () =>
      this.prisma.erpStockMove.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
        },
      }),
    );
    const row = await this.prisma.$transaction((tx) =>
      this.applyMove(org, tx, {
        type,
        warehouseId,
        toWarehouseId,
        variantId: variant.id,
        quantity,
        unitCost: num(body.unitCost),
        note: clip(body.note, 500),
        sourceType: 'MANUAL',
        sourceId: 0,
        createdBy: org.actorId,
        moveNo,
      }),
    );
    this.emit(org, 'erp.stock.moved', {
      moveId: row.id,
      moveNo,
      type,
      variantId: row.variantId,
      quantity,
    });
    const [view] = await this.moveViews([row], org);
    const stock = await this.prisma.erpStock.findUnique({
      where: { warehouseId_variantId: { warehouseId, variantId: variant.id } },
    });
    if (
      stock &&
      num(stock.reorderPoint) > 0 &&
      num(stock.onHand) < num(stock.reorderPoint)
    ) {
      this.emit(org, 'erp.stock.low', {
        warehouseId,
        variantId: variant.id,
        onHand: ds(stock.onHand),
        reorderPoint: ds(stock.reorderPoint),
      });
    }
    return view;
  }

  // ------------------------------------------------------------------
  // 领用
  // ------------------------------------------------------------------

  private async stockRequestViews(
    rows: Array<{
      id: number;
      requestNo: string;
      requesterId: string;
      projectId: number;
      warehouseId: number;
      items: unknown;
      status: string;
      approverId: string;
      decidedAt: Date | null;
      note: string;
      createdAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const [warehouses, variants] = await Promise.all([
      this.prisma.erpWarehouse.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.erpVariant.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          id: {
            in: rows.flatMap((row) =>
              Array.isArray(row.items)
                ? (row.items as Row[])
                    .map((item) => num(item.variantId))
                    .filter(Boolean)
                : [],
            ),
          },
        },
      }),
    ]);
    const warehouseName = new Map(warehouses.map((row) => [row.id, row.name]));
    const sku = new Map(variants.map((row) => [row.id, row.sku]));
    return rows.map((row) => ({
      id: row.id,
      requestNo: row.requestNo,
      requesterId: row.requesterId,
      projectId: row.projectId,
      warehouseId: row.warehouseId,
      warehouseName: warehouseName.get(row.warehouseId) || '',
      items: Array.isArray(row.items)
        ? (row.items as Row[]).map((item) => ({
            variantId: num(item.variantId),
            sku: sku.get(num(item.variantId)) || clip(item.sku, 64),
            quantity: num(item.quantity),
          }))
        : [],
      status: row.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'ISSUED',
      approverId: row.approverId,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listStockRequests(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpStockRequestWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.erpStockRequest.count({ where }),
      this.prisma.erpStockRequest.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.stockRequestViews(rows, org),
    };
  }

  async saveStockRequest(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const warehouseId = num(body.warehouseId);
    await this.requireWarehouse(org, warehouseId);
    const rawItems = Array.isArray(body.items) ? (body.items as Row[]) : [];
    const items = [];
    for (const item of rawItems) {
      const variant = await this.requireVariant(org, num(item.variantId));
      const quantity = num(item.quantity);
      if (quantity <= 0)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '领用数量必须大于 0',
        );
      items.push({ variantId: variant.id, sku: variant.sku, quantity });
    }
    if (!items.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条领用明细',
      );
    const requestNo = await this.chainNo(org, 'LY', () =>
      this.prisma.erpStockRequest.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
        },
      }),
    );
    const row = await this.prisma.erpStockRequest.create({
      data: {
        ...orgKey(org),
        requestNo,
        requesterId: org.actorId,
        projectId: num(body.projectId),
        warehouseId,
        items: json(items),
        note: clip(body.note, 500),
      },
    });
    this.emit(org, 'erp.stock.requested', {
      requestId: row.id,
      requestNo,
      warehouseId,
    });
    const [view] = await this.stockRequestViews([row], org);
    return view;
  }

  async decideStockRequest(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'INVENTORY');
    const id = num(body.id);
    const row = await this.prisma.erpStockRequest.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '领用单不存在');
    if (row.status === 'ISSUED')
      throw new BusinessException(ErrorCode.BAD_REQUEST, '领用单已出库');
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision === 'reject') {
      const next = await this.prisma.erpStockRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approverId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      const [view] = await this.stockRequestViews([next], org);
      return view;
    }
    if (decision === 'approve') {
      const next = await this.prisma.erpStockRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approverId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      const [view] = await this.stockRequestViews([next], org);
      return view;
    }
    const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
    await this.prisma.$transaction(async (tx) => {
      let index = 0;
      for (const item of items) {
        index += 1;
        await this.applyMove(org, tx, {
          type: 'OUT',
          warehouseId: row.warehouseId,
          toWarehouseId: 0,
          variantId: num(item.variantId),
          quantity: num(item.quantity),
          unitCost: 0,
          note: `领用出库 ${row.requestNo}`,
          sourceType: 'STOCK_REQUEST',
          sourceId: row.id,
          createdBy: org.actorId,
          moveNo: `${row.requestNo}-${index}`,
        });
      }
      await tx.erpStockRequest.update({
        where: { id },
        data: {
          status: 'ISSUED',
          approverId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
    });
    const next = await this.prisma.erpStockRequest.findUnique({
      where: { id },
    });
    this.emit(org, 'erp.stock.issued', {
      requestId: id,
      requestNo: row.requestNo,
    });
    const [view] = await this.stockRequestViews([next!], org);
    return view;
  }

  // ------------------------------------------------------------------
  // 供应商 / 采购 / 入库
  // ------------------------------------------------------------------

  async listVendors(user: CurrentUser, query: PageQuery & { q?: string }) {
    const org = await this.org(user);
    const where: Prisma.ErpVendorWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.q)
      where.OR = [
        { name: { contains: query.q } },
        { code: { contains: query.q } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.erpVendor.count({ where }),
      this.prisma.erpVendor.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const partyIds = [
      ...new Set(rows.map((row) => row.partyId).filter((id) => id > 0)),
    ];
    const parties = partyIds.length
      ? await this.prisma.bizParty.findMany({
          where: { id: { in: partyIds } },
          select: { id: true, name: true },
        })
      : [];
    const partyNames = new Map(parties.map((party) => [party.id, party.name]));
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) => ({
        id: row.id,
        partyId: row.partyId,
        partyName: partyNames.get(row.partyId) || '',
        code: row.code,
        name: row.name,
        contactName: row.contactName,
        phone: row.phone,
        email: row.email,
        taxNo: row.taxNo,
        address: row.address,
        status: row.status as 'ACTIVE' | 'INACTIVE',
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** 供应商与统一主体双向绑定：已有 partyId 用指定主体，没有就按名称认领/建档。 */
  private async vendorPartyId(org: HrmOrg, body: Row, name: string) {
    const requested = num(body.partyId);
    if (requested > 0) {
      const party = await this.prisma.bizParty.findFirst({
        where: {
          id: requested,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
        select: { id: true },
      });
      if (!party)
        throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
      return requested;
    }
    const existing = await this.prisma.bizParty.findFirst({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.bizParty.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        kind: 'VENDOR',
        name,
        contactName: clip(body.contactName, 64),
        phone: clip(body.phone, 32),
        email: clip(body.email, 120),
        taxNo: clip(body.taxNo, 32),
        address: clip(body.address, 200),
        source: 'ERP',
        createdBy: org.actorId,
      },
      select: { id: true },
    });
    return created.id;
  }

  async saveVendor(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'PURCHASE');
    const id = num(body.id);
    const name = clip(body.name, 120);
    const data = {
      partyId: await this.vendorPartyId(org, body, name),
      code: clip(body.code, 32),
      name,
      contactName: clip(body.contactName, 64),
      phone: clip(body.phone, 32),
      email: clip(body.email, 120),
      taxNo: clip(body.taxNo, 32),
      address: clip(body.address, 200),
      status: oneOf(body.status, ['ACTIVE', 'INACTIVE'] as const, 'ACTIVE'),
      note: clip(body.note, 500),
    };
    if (!data.code || !data.name)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写供应商编码与名称',
      );
    if (id)
      await this.requireOwnedRow('供应商', () =>
        this.prisma.erpVendor.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpVendor.update({ where: { id }, data })
      : await this.prisma.erpVendor.create({
          data: { ...orgKey(org), ...data },
        });
    const party = await this.prisma.bizParty.findFirst({
      where: { id: row.partyId },
      select: { name: true },
    });
    return {
      id: row.id,
      partyId: row.partyId,
      partyName: party?.name || '',
      code: row.code,
      name: row.name,
      contactName: row.contactName,
      phone: row.phone,
      email: row.email,
      taxNo: row.taxNo,
      address: row.address,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async removeVendor(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'PURCHASE');
    const id = num(body.id);
    const row = await this.prisma.erpVendor.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '供应商不存在');
    const used = await this.prisma.erpPurchaseOrder.count({
      where: { vendorId: id, status: { not: 'CANCELED' } },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '供应商仍有未取消的采购单，无法删除',
      );
    await this.prisma.erpVendor.delete({ where: { id } });
    return { id };
  }

  private async purchaseViews(
    rows: Array<{
      id: number;
      orderNo: string;
      vendorId: number;
      projectId: number;
      sourceType: string;
      sourceNo: string;
      warehouseId: number;
      items: unknown;
      amount: unknown;
      taxAmount: unknown;
      status: string;
      expectedAt: string;
      createdBy: string;
      approverId: string;
      decidedAt: Date | null;
      note: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const vendors = await this.prisma.erpVendor.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
    const projectIds = [...new Set(rows.map((row) => row.projectId).filter((id) => id > 0))];
    const projects = projectIds.length
      ? await this.prisma.pjProject.findMany({
          where: {
            id: { in: projectIds },
            orgType: org.orgType,
            orgUserId: org.orgUserId,
          },
          select: { id: true, name: true },
        })
      : [];
    const projectName = new Map(projects.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      vendorId: row.vendorId,
      vendorName: vendorName.get(row.vendorId) || '',
      projectId: row.projectId,
      projectName: projectName.get(row.projectId) || '',
      sourceType: row.sourceType,
      sourceNo: row.sourceNo,
      warehouseId: row.warehouseId,
      items: Array.isArray(row.items)
        ? (row.items as Row[]).map((item) => ({
            variantId: num(item.variantId),
            sku: clip(item.sku, 64),
            quantity: num(item.quantity),
            price: num(item.price),
          }))
        : [],
      amount: ds(row.amount),
      taxAmount: ds(row.taxAmount),
      status: row.status,
      expectedAt: row.expectedAt,
      createdBy: row.createdBy,
      approverId: row.approverId,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async listPurchaseOrders(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpPurchaseOrderWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.erpPurchaseOrder.count({ where }),
      this.prisma.erpPurchaseOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.purchaseViews(rows, org),
    };
  }

  async savePurchaseOrder(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const vendorId = num(body.vendorId);
    const vendor = await this.prisma.erpVendor.findFirst({
      where: { id: vendorId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!vendor)
      throw new BusinessException(ErrorCode.NOT_FOUND, '供应商不存在');
    const warehouseId = num(body.warehouseId);
    await this.requireWarehouse(org, warehouseId);
    const rawItems = Array.isArray(body.items) ? (body.items as Row[]) : [];
    const items = [];
    let amount = 0;
    let taxAmount = 0;
    for (const item of rawItems) {
      const variant = await this.requireVariant(org, num(item.variantId));
      const quantity = num(item.quantity);
      const price = num(item.price);
      if (quantity <= 0)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '采购数量必须大于 0',
        );
      const line = quantity * price;
      amount += line;
      taxAmount += (line * (await this.taxRateOf(variant.productId))) / 100;
      items.push({ variantId: variant.id, sku: variant.sku, quantity, price });
    }
    if (!items.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条采购明细',
      );
    const id = num(body.id);
    const projectId = num(body.projectId);
    if (projectId) {
      const project = await this.prisma.pjProject.findFirst({
        where: { id: projectId, orgType: org.orgType, orgUserId: org.orgUserId },
        select: { id: true },
      });
      if (!project)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '归属项目不存在');
    }
    const data = {
      vendorId,
      projectId,
      sourceType: oneOf(
        body.sourceType,
        ['MANUAL', 'OA_PURCHASE', 'STOCK_LOW'] as const,
        'MANUAL',
      ),
      sourceNo: clip(body.sourceNo, 40),
      warehouseId,
      items: json(items),
      amount,
      taxAmount: Number(taxAmount.toFixed(2)),
      expectedAt: clip(body.expectedAt, 16),
      note: clip(body.note, 500),
    };
    let row;
    if (id) {
      const existing = await this.prisma.erpPurchaseOrder.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '采购单不存在');
      if (!['DRAFT', 'PENDING'].includes(existing.status)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '仅草稿/待审批的采购单可修改',
        );
      }
      row = await this.prisma.erpPurchaseOrder.update({ where: { id }, data });
    } else {
      const orderNo = await this.chainNo(org, 'CG', () =>
        this.prisma.erpPurchaseOrder.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      );
      row = await this.prisma.erpPurchaseOrder.create({
        data: {
          ...orgKey(org),
          ...data,
          orderNo,
          status: 'PENDING',
          createdBy: org.actorId,
        },
      });
      this.emit(org, 'erp.purchase.created', {
        orderId: row.id,
        orderNo,
        amount: ds(row.amount),
      });
    }
    const [view] = await this.purchaseViews([row], org);
    return view;
  }

  async decidePurchaseOrder(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'PURCHASE');
    const id = num(body.id);
    const row = await this.prisma.erpPurchaseOrder.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '采购单不存在');
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision === 'approve') {
      const next = await this.prisma.erpPurchaseOrder.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approverId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      this.emit(org, 'erp.purchase.approved', {
        orderId: id,
        orderNo: row.orderNo,
        amount: ds(row.amount),
      });
      const [view] = await this.purchaseViews([next], org);
      return view;
    }
    if (decision === 'reject' || decision === 'cancel') {
      const next = await this.prisma.erpPurchaseOrder.update({
        where: { id },
        data: {
          status: 'CANCELED',
          approverId: org.actorId,
          decidedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      const [view] = await this.purchaseViews([next], org);
      return view;
    }
    if (row.status !== 'APPROVED' && row.status !== 'RECEIVING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅已审批的采购单可收货',
      );
    }
    const pending = await this.prisma.erpReceipt.findFirst({
      where: { purchaseOrderId: id, status: 'PENDING' },
    });
    if (!pending) {
      const receiptNo = await this.chainNo(org, 'RK', () =>
        this.prisma.erpReceipt.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      );
      const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
      await this.prisma.erpReceipt.create({
        data: {
          ...orgKey(org),
          receiptNo,
          purchaseOrderId: id,
          warehouseId: row.warehouseId,
          items: json(
            items.map((item) => ({
              variantId: num(item.variantId),
              sku: clip(item.sku, 64),
              quantity: num(item.quantity),
            })),
          ),
          amount: row.amount,
          status: 'PENDING',
          note: clip(body.note, 500),
        },
      });
    }
    const next = await this.prisma.erpPurchaseOrder.update({
      where: { id },
      data: {
        status: 'RECEIVING',
        approverId: org.actorId,
        decidedAt: new Date(),
      },
    });
    const [view] = await this.purchaseViews([next], org);
    return view;
  }

  private async receiptViews(
    rows: Array<{
      id: number;
      receiptNo: string;
      purchaseOrderId: number;
      warehouseId: number;
      items: unknown;
      amount: unknown;
      status: string;
      receivedBy: string;
      receivedAt: Date | null;
      note: string;
      createdAt: Date;
    }>,
    org: HrmOrg,
  ) {
    if (!rows.length) return [];
    const [orders, warehouses] = await Promise.all([
      this.prisma.erpPurchaseOrder.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          id: { in: rows.map((r) => r.purchaseOrderId) },
        },
      }),
      this.prisma.erpWarehouse.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
    ]);
    const orderNo = new Map(orders.map((row) => [row.id, row.orderNo]));
    const warehouseName = new Map(warehouses.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      receiptNo: row.receiptNo,
      purchaseOrderId: row.purchaseOrderId,
      orderNo: orderNo.get(row.purchaseOrderId) || '',
      warehouseId: row.warehouseId,
      warehouseName: warehouseName.get(row.warehouseId) || '',
      items: Array.isArray(row.items)
        ? (row.items as Row[]).map((item) => ({
            variantId: num(item.variantId),
            sku: clip(item.sku, 64),
            quantity: num(item.quantity),
          }))
        : [],
      amount: ds(row.amount),
      status: row.status as 'PENDING' | 'RECEIVED' | 'REJECTED',
      receivedBy: row.receivedBy,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : '',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listReceipts(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpReceiptWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.erpReceipt.count({ where }),
      this.prisma.erpReceipt.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: await this.receiptViews(rows, org),
    };
  }

  async createReceipt(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const purchaseOrderId = num(body.purchaseOrderId);
    const order = await this.prisma.erpPurchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采购单不存在');
    if (!['APPROVED', 'RECEIVING'].includes(order.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅已审批的采购单可创建入库单',
      );
    }
    // 重复入库防护：同一采购单只允许一张待审/已入库的入库单，已驳回的可重新提交。
    const open = await this.prisma.erpReceipt.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        purchaseOrderId,
        status: { in: ['PENDING', 'RECEIVED'] },
      },
      select: { id: true, receiptNo: true, status: true },
    });
    if (open) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `该采购单已有入库单 ${open.receiptNo}（${open.status === 'PENDING' ? '待审核' : '已入库'}），请勿重复入库`,
      );
    }
    const rawItems = Array.isArray(body.items) ? (body.items as Row[]) : [];
    const items = [];
    let amount = 0;
    const orderItems = Array.isArray(order.items) ? (order.items as Row[]) : [];
    for (const item of rawItems) {
      const variantId = num(item.variantId);
      const quantity = num(item.quantity);
      if (quantity <= 0)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '入库数量必须大于 0',
        );
      const price = num(
        orderItems.find((row) => num(row.variantId) === variantId)?.price,
      );
      amount += quantity * price;
      const variant = await this.requireVariant(org, variantId);
      items.push({ variantId, sku: variant.sku, quantity });
    }
    if (!items.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条入库明细',
      );
    const receiptNo = await this.chainNo(org, 'RK', () =>
      this.prisma.erpReceipt.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
        },
      }),
    );
    const row = await this.prisma.erpReceipt.create({
      data: {
        ...orgKey(org),
        receiptNo,
        purchaseOrderId,
        warehouseId: order.warehouseId,
        items: json(items),
        amount,
        note: clip(body.note, 500),
      },
    });
    const [view] = await this.receiptViews([row], org);
    return view;
  }

  async decideReceipt(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'PURCHASE');
    const id = num(body.id);
    const row = await this.prisma.erpReceipt.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '入库单不存在');
    if (row.status !== 'PENDING')
      throw new BusinessException(ErrorCode.BAD_REQUEST, '入库单已处理');
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision === 'reject') {
      const next = await this.prisma.erpReceipt.update({
        where: { id },
        data: {
          status: 'REJECTED',
          receivedBy: org.actorId,
          receivedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      const [view] = await this.receiptViews([next], org);
      return view;
    }
    const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
    await this.prisma.$transaction(async (tx) => {
      let index = 0;
      for (const item of items) {
        index += 1;
        await this.applyMove(org, tx, {
          type: 'IN',
          warehouseId: row.warehouseId,
          toWarehouseId: 0,
          variantId: num(item.variantId),
          quantity: num(item.quantity),
          unitCost: 0,
          note: `采购入库 ${row.receiptNo}`,
          sourceType: 'RECEIPT',
          sourceId: row.id,
          createdBy: org.actorId,
          moveNo: `${row.receiptNo}-${index}`,
        });
      }
      await tx.erpReceipt.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          receivedBy: org.actorId,
          receivedAt: new Date(),
          note: clip(body.note, 500) || row.note,
        },
      });
      await tx.erpPurchaseOrder.update({
        where: { id: row.purchaseOrderId },
        data: { status: 'DONE' },
      });
      const order = await tx.erpPurchaseOrder.findUnique({
        where: { id: row.purchaseOrderId },
      });
      if (order) await this.syncPurchaseOrderCost(org, tx, order, row.amount);
    });
    const next = await this.prisma.erpReceipt.findUnique({ where: { id } });
    await this.syncPurchaseOrderPayable(org, row.purchaseOrderId);
    this.emit(org, 'erp.receipt.received', {
      receiptId: id,
      receiptNo: row.receiptNo,
      amount: ds(row.amount),
    });
    const [view] = await this.receiptViews([next!], org);
    return view;
  }

  /**
   * 采购入库 → 自动生成应付（同一采购单只挂一张，重复入库天然幂等）：
   * 金额按采购单含税额，供应商取采购单供应商；已有应付仅回写金额，不动付款进度。
   */
  private async syncPurchaseOrderPayable(org: HrmOrg, purchaseOrderId: number) {
    const order = await this.prisma.erpPurchaseOrder.findFirst({
      where: { id: purchaseOrderId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!order) return;
    const amount = num(order.amount) + num(order.taxAmount);
    const existing = await this.prisma.erpPayable.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        sourceType: 'PURCHASE_ORDER',
        sourceId: order.id,
      },
    });
    if (existing) {
      if (existing.status === 'CANCELED') return;
      await this.prisma.erpPayable.update({
        where: { id: existing.id },
        data: {
          amount,
          approvalStatus: this.nextApprovalStatus(
            amount,
            existing.approvalStatus,
            num(existing.amount),
          ),
        },
      });
      return;
    }
    const code = await this.chainNo(org, 'YF', () =>
      this.prisma.erpPayable.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
        },
      }),
    );
    await this.prisma.erpPayable.create({
      data: {
        ...orgKey(org),
        code,
        vendorId: order.vendorId,
        sourceType: 'PURCHASE_ORDER',
        sourceId: order.id,
        amount,
        dueDate: today(),
        approvalStatus: this.nextApprovalStatus(amount, 'NONE'),
        note: `采购入库：${order.orderNo}${order.sourceNo ? `（来源 ${order.sourceNo}）` : ''}`,
      },
    });
  }

  /**
   * 采购入库 → 按归属项目自动归集一条 ERP_PO 成本项（幂等：sourceId＝采购单 id）。
   * 未归属项目（projectId=0）不落账，避免把采购成本摊到无关项目；科目默认物料，
   * 金额取入库实际金额（= 入库数量 × 采购单价），使项目成本三口径的「已发生」可核对。
   */
  private async syncPurchaseOrderCost(
    org: HrmOrg,
    tx: Prisma.TransactionClient,
    order: { id: number; orderNo: string; projectId: number },
    receiptAmount: unknown,
  ) {
    if (order.projectId <= 0) return;
    const project = await tx.pjProject.findFirst({
      where: {
        id: order.projectId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
      select: { currency: true },
    });
    if (!project) return;
    const amount = round(num(receiptAmount));
    const data = {
      projectId: order.projectId,
      kind: 'MATERIAL',
      title: `采购入库 ${order.orderNo}`,
      qty: 1,
      unit: '批',
      unitCost: amount,
      amount,
      currency: project.currency,
      sourceType: 'ERP_PO',
      sourceId: String(order.id),
      occurredAt: today(),
      note: `采购单 ${order.orderNo} 入库自动归集`,
    };
    const existing = await tx.pjCostItem.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        sourceType: 'ERP_PO',
        sourceId: String(order.id),
      },
      select: { id: true },
    });
    if (existing) {
      await tx.pjCostItem.update({ where: { id: existing.id }, data });
      return;
    }
    await tx.pjCostItem.create({
      data: { ...orgKey(org), ...data, createdBy: org.actorId },
    });
  }

  // ------------------------------------------------------------------
  // 应收 / 应付
  // ------------------------------------------------------------------

  private receivableView(row: {
    id: number;
    code: string;
    customerName: string;
    customerId: number;
    contractId: number;
    sourceType: string;
    sourceId: number;
    amount: unknown;
    receivedAmount: unknown;
    dueDate: string;
    status: string;
    note: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      code: row.code,
      customerName: row.customerName,
      customerId: row.customerId,
      contractId: row.contractId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      amount: ds(row.amount),
      receivedAmount: ds(row.receivedAmount),
      outstanding: ds(num(row.amount) - num(row.receivedAmount)),
      dueDate: row.dueDate,
      status: row.status,
      agingDays: row.dueDate ? dayDiff(row.dueDate) : 0,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listReceivables(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpReceivableWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    if (query.q)
      where.OR = [
        { customerName: { contains: query.q } },
        { code: { contains: query.q } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.erpReceivable.count({ where }),
      this.prisma.erpReceivable.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) => this.receivableView(row)),
    };
  }

  async saveReceivable(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const amount = num(body.amount);
    if (amount <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '应收金额必须大于 0');
    const data = {
      code: clip(body.code, 32),
      customerName: clip(body.customerName, 120),
      customerId: num(body.customerId),
      contractId: num(body.contractId),
      sourceType: clip(body.sourceType, 32) || 'MANUAL',
      sourceId: num(body.sourceId),
      amount,
      dueDate: clip(body.dueDate, 16),
      note: clip(body.note, 500),
    };
    if (!data.customerName)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写客户名称');
    if (id) {
      await this.requireOwnedRow('应收单', () =>
        this.prisma.erpReceivable.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
      const row = await this.prisma.erpReceivable.update({
        where: { id },
        data,
      });
      return this.receivableView(row);
    }
    const code =
      data.code ||
      (await this.chainNo(org, 'YS', () =>
        this.prisma.erpReceivable.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      ));
    const row = await this.prisma.erpReceivable.create({
      data: { ...orgKey(org), ...data, code },
    });
    return this.receivableView(row);
  }

  async receivePayment(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpReceivable.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '应收单不存在');
    if (['PAID', 'CANCELED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该应收单已结清或已取消',
      );
    }
    const pay = num(body.amount);
    if (pay <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回款金额必须大于 0');
    const total = num(row.amount);
    const received = Math.min(total, num(row.receivedAmount) + pay);
    const status =
      received >= total ? 'PAID' : received > 0 ? 'PARTIAL' : row.status;
    const next = await this.prisma.erpReceivable.update({
      where: { id },
      data: {
        receivedAmount: received,
        status,
        note: clip(body.note, 500) || row.note,
      },
    });
    this.emit(org, 'erp.receivable.paid', {
      receivableId: id,
      code: row.code,
      amount: ds(pay),
      outstanding: ds(total - received),
    });
    return this.receivableView(next);
  }

  private payableView(
    row: {
      id: number;
      code: string;
      vendorId: number;
      sourceType: string;
      sourceId: number;
      amount: unknown;
      paidAmount: unknown;
      dueDate: string;
      recurrence: string;
      nextAt: string;
      status: string;
      approvalStatus: string;
      approverId: string;
      decidedAt: Date | null;
      approvalNote: string;
      note: string;
      createdAt: Date;
      updatedAt: Date;
    },
    vendorName = '',
  ) {
    return {
      id: row.id,
      code: row.code,
      vendorId: row.vendorId,
      vendorName,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      amount: ds(row.amount),
      paidAmount: ds(row.paidAmount),
      outstanding: ds(num(row.amount) - num(row.paidAmount)),
      dueDate: row.dueDate,
      recurrence: row.recurrence,
      nextAt: row.nextAt,
      status: row.status,
      approvalStatus: row.approvalStatus,
      approvalStatusLabel:
        PAYMENT_APPROVAL_LABELS[row.approvalStatus] || row.approvalStatus,
      approverId: row.approverId,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      approvalNote: row.approvalNote,
      agingDays: row.dueDate ? dayDiff(row.dueDate) : 0,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listPayables(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string; approvalStatus?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpPayableWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.q) where.code = { contains: query.q };
    const [total, rows, vendors] = await Promise.all([
      this.prisma.erpPayable.count({ where }),
      this.prisma.erpPayable.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.erpVendor.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
    ]);
    const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) =>
        this.payableView(row, vendorName.get(row.vendorId) || ''),
      ),
    };
  }

  async savePayable(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const amount = num(body.amount);
    if (amount <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '应付金额必须大于 0');
    const data = {
      code: clip(body.code, 32),
      vendorId: num(body.vendorId),
      sourceType: clip(body.sourceType, 32) || 'MANUAL',
      sourceId: num(body.sourceId),
      amount,
      dueDate: clip(body.dueDate, 16),
      recurrence: oneOf(body.recurrence, RECURRENCES, 'NONE'),
      nextAt: clip(body.nextAt, 16),
      note: clip(body.note, 500),
    };
    const vendors = await this.prisma.erpVendor.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
    if (id) {
      const existing = await this.prisma.erpPayable.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        select: { id: true, approvalStatus: true, amount: true },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '应付单不存在');
      const row = await this.prisma.erpPayable.update({
        where: { id },
        data: {
          ...data,
          approvalStatus: this.nextApprovalStatus(
            amount,
            existing.approvalStatus,
            num(existing.amount),
          ),
        },
      });
      return this.payableView(row, vendorName.get(row.vendorId) || '');
    }
    const code =
      data.code ||
      (await this.chainNo(org, 'YF', () =>
        this.prisma.erpPayable.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      ));
    const row = await this.prisma.erpPayable.create({
      data: {
        ...orgKey(org),
        ...data,
        code,
        approvalStatus: this.nextApprovalStatus(amount, 'NONE'),
      },
    });
    return this.payableView(row, vendorName.get(row.vendorId) || '');
  }

  async payPayable(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpPayable.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '应付单不存在');
    if (['PAID', 'CANCELED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该应付单已结清或已取消',
      );
    }
    const total = num(row.amount);
    if (total >= PAYMENT_APPROVAL_THRESHOLD && row.approvalStatus !== 'APPROVED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        row.approvalStatus === 'REJECTED'
          ? '该应付单付款审批已被驳回，调整金额后重新提交审批'
          : `应付金额已达 ${PAYMENT_APPROVAL_THRESHOLD} 元，需财务审批通过后才能付款`,
      );
    }
    const pay = num(body.amount);
    if (pay <= 0)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '付款金额必须大于 0');
    const paid = Math.min(total, num(row.paidAmount) + pay);
    const status = paid >= total ? 'PAID' : 'PARTIAL';
    const next = await this.prisma.erpPayable.update({
      where: { id },
      data: {
        paidAmount: paid,
        status,
        note: clip(body.note, 500) || row.note,
      },
    });
    if (status === 'PAID' && row.recurrence !== 'NONE') {
      const step =
        row.recurrence === 'MONTHLY'
          ? 30
          : row.recurrence === 'QUARTERLY'
            ? 90
            : 365;
      const nextAt = addDays(row.dueDate || today(), step);
      const code = await this.chainNo(org, 'YF', () =>
        this.prisma.erpPayable.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      );
      await this.prisma.erpPayable.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          code,
          vendorId: row.vendorId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          amount: total,
          dueDate: nextAt,
          recurrence: row.recurrence,
          nextAt: addDays(nextAt, step),
          approvalStatus: this.nextApprovalStatus(total, 'NONE'),
          note: `周期应付续期（${row.code}）`,
        },
      });
    }
    this.emit(org, 'erp.payable.paid', {
      payableId: id,
      code: row.code,
      amount: ds(pay),
      outstanding: ds(total - paid),
    });
    const vendors = await this.prisma.erpVendor.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    return this.payableView(
      next,
      vendors.find((v) => v.id === next.vendorId)?.name || '',
    );
  }

  /**
   * 付款审批（大额应付）：财务复核通过/驳回，通过后方可登记付款。
   * 与付款动作分权：审批只改审批结论，不直接产生付款流水。
   */
  async decidePayable(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpPayable.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '应付单不存在');
    if (row.approvalStatus !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        row.approvalStatus === 'NONE'
          ? '该应付单未达到付款审批阈值，无需审批'
          : '该应付单已完成付款审批',
      );
    }
    if (['PAID', 'CANCELED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该应付单已结清或已取消',
      );
    }
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approve' && decision !== 'reject') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '审批结论不正确');
    }
    const next = await this.prisma.erpPayable.update({
      where: { id },
      data: {
        approvalStatus: decision === 'approve' ? 'APPROVED' : 'REJECTED',
        approverId: org.actorId,
        decidedAt: new Date(),
        approvalNote: clip(body.note, 500) || row.approvalNote,
      },
    });
    this.emit(
      org,
      decision === 'approve' ? 'erp.payable.approved' : 'erp.payable.rejected',
      { payableId: id, code: row.code, amount: ds(row.amount) },
    );
    const vendors = await this.prisma.erpVendor.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    return this.payableView(
      next,
      vendors.find((v) => v.id === next.vendorId)?.name || '',
    );
  }

  /** 付款审批状态随金额与既有结论推进：低于阈值免审批；金额上调需重新审批。 */
  private nextApprovalStatus(
    amount: number,
    current: string,
    previousAmount?: number,
  ): string {
    if (amount < PAYMENT_APPROVAL_THRESHOLD) return 'NONE';
    if (
      current === 'APPROVED' &&
      previousAmount !== undefined &&
      amount <= previousAmount
    ) {
      return 'APPROVED';
    }
    return 'PENDING';
  }

  // ------------------------------------------------------------------
  // 费用报销
  // ------------------------------------------------------------------

  private expenseView(row: {
    id: number;
    reportNo: string;
    applicantId: string;
    projectId: number;
    department: string;
    items: unknown;
    amount: unknown;
    status: string;
    approverId: string;
    decidedAt: Date | null;
    note: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      reportNo: row.reportNo,
      applicantId: row.applicantId,
      projectId: row.projectId,
      department: row.department,
      items: Array.isArray(row.items)
        ? (row.items as Row[]).map((item) => ({
            name: clip(item.name, 120),
            amount: num(item.amount),
            note: clip(item.note, 200),
          }))
        : [],
      amount: ds(row.amount),
      status: row.status as
        'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID',
      approverId: row.approverId,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listExpenses(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.ErpExpenseReportWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.erpExpenseReport.count({ where }),
      this.prisma.erpExpenseReport.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) => this.expenseView(row)),
    };
  }

  async saveExpense(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const rawItems = Array.isArray(body.items) ? (body.items as Row[]) : [];
    const items = rawItems.map((item) => ({
      name: clip(item.name, 120),
      amount: num(item.amount),
      note: clip(item.note, 200),
    }));
    if (!items.length || items.some((item) => !item.name || item.amount < 0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写完整的费用明细',
      );
    }
    const amount = Number(
      items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    );
    const data = {
      projectId: num(body.projectId),
      department: clip(body.department, 64),
      items: json(items),
      amount,
      note: clip(body.note, 500),
      status: body.submit ? 'SUBMITTED' : 'DRAFT',
    };
    if (id) {
      const existing = await this.prisma.erpExpenseReport.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '报销单不存在');
      if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '仅草稿/已驳回的报销单可修改',
        );
      }
      if (existing.applicantId !== org.actorId && !org.isAdmin) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '只能修改本人的报销单',
        );
      }
      const row = await this.prisma.erpExpenseReport.update({
        where: { id },
        data,
      });
      return this.expenseView(row);
    }
    const reportNo = await this.chainNo(org, 'BX', () =>
      this.prisma.erpExpenseReport.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
        },
      }),
    );
    const row = await this.prisma.erpExpenseReport.create({
      data: { ...orgKey(org), ...data, reportNo, applicantId: org.actorId },
    });
    if (row.status === 'SUBMITTED')
      this.emit(org, 'erp.expense.submitted', {
        reportId: row.id,
        reportNo,
        amount: ds(amount),
      });
    return this.expenseView(row);
  }

  async decideExpense(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpExpenseReport.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '报销单不存在');
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision === 'approve' && row.status !== 'SUBMITTED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅已提交的报销单可审批',
      );
    }
    if (decision === 'pay' && row.status !== 'APPROVED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅已通过的报销单可付款',
      );
    }
    const status =
      decision === 'approve'
        ? 'APPROVED'
        : decision === 'pay'
          ? 'PAID'
          : 'REJECTED';
    const next = await this.prisma.erpExpenseReport.update({
      where: { id },
      data: {
        status,
        approverId: org.actorId,
        decidedAt: new Date(),
        note: clip(body.note, 500) || row.note,
      },
    });
    if (status === 'APPROVED') {
      const code = await this.chainNo(org, 'YF', () =>
        this.prisma.erpPayable.count({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
          },
        }),
      );
      await this.prisma.erpPayable.create({
        data: {
          ...orgKey(org),
          code,
          sourceType: 'EXPENSE',
          sourceId: id,
          amount: num(row.amount),
          dueDate: today(),
          approvalStatus: this.nextApprovalStatus(num(row.amount), 'NONE'),
          note: `报销付款 ${row.reportNo}`,
        },
      });
      this.emit(org, 'erp.expense.approved', {
        reportId: id,
        reportNo: row.reportNo,
        amount: ds(row.amount),
      });
    }
    return this.expenseView(next);
  }

  // ------------------------------------------------------------------
  // 税率 / 价格策略
  // ------------------------------------------------------------------

  async listTaxRates(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.erpTaxRate.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      rate: ds(row.rate),
      kind: row.kind as 'SALES' | 'PURCHASE' | 'BOTH',
      note: row.note,
    }));
  }

  async saveTaxRate(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const data = {
      name: clip(body.name, 32),
      rate: Math.min(100, Math.max(0, num(body.rate))),
      kind: oneOf(body.kind, ['SALES', 'PURCHASE', 'BOTH'] as const, 'BOTH'),
      note: clip(body.note, 200),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写税率名称');
    if (id)
      await this.requireOwnedRow('税率', () =>
        this.prisma.erpTaxRate.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpTaxRate.update({ where: { id }, data })
      : await this.prisma.erpTaxRate.create({
          data: { ...orgKey(org), ...data },
        });
    return {
      id: row.id,
      name: row.name,
      rate: ds(row.rate),
      kind: row.kind as 'SALES' | 'PURCHASE' | 'BOTH',
      note: row.note,
    };
  }

  async removeTaxRate(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpTaxRate.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '税率不存在');
    await this.prisma.erpTaxRate.delete({ where: { id } });
    return { id };
  }

  async listPricePolicies(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.erpPricePolicy.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope as 'ALL' | 'CATEGORY' | 'PRODUCT',
      scopeId: row.scopeId,
      discountPct: ds(row.discountPct),
      minQty: row.minQty,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async savePricePolicy(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const data = {
      name: clip(body.name, 80),
      scope: oneOf(body.scope, ['ALL', 'CATEGORY', 'PRODUCT'] as const, 'ALL'),
      scopeId: Math.max(0, num(body.scopeId)),
      discountPct: Math.min(100, Math.max(0, num(body.discountPct))),
      minQty: Math.max(0, Math.trunc(num(body.minQty))),
      status: oneOf(body.status, ['ACTIVE', 'INACTIVE'] as const, 'ACTIVE'),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写策略名称');
    if (id)
      await this.requireOwnedRow('价格策略', () =>
        this.prisma.erpPricePolicy.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          select: { id: true },
        }),
      );
    const row = id
      ? await this.prisma.erpPricePolicy.update({ where: { id }, data })
      : await this.prisma.erpPricePolicy.create({
          data: { ...orgKey(org), ...data },
        });
    return {
      id: row.id,
      name: row.name,
      scope: row.scope as 'ALL' | 'CATEGORY' | 'PRODUCT',
      scopeId: row.scopeId,
      discountPct: ds(row.discountPct),
      minQty: row.minQty,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async removePricePolicy(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.requireErpRole(org, 'FINANCE');
    const id = num(body.id);
    const row = await this.prisma.erpPricePolicy.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '价格策略不存在');
    await this.prisma.erpPricePolicy.delete({ where: { id } });
    return { id };
  }

  // ------------------------------------------------------------------
  // AI 经营评估（规则式基线 + LLM 可选）
  // ------------------------------------------------------------------

  private async ruleInsight(
    org: HrmOrg,
    kind: string,
    horizonDays: number,
  ): Promise<{
    summary: string;
    findings: {
      title: string;
      detail: string;
      level: 'INFO' | 'WARN' | 'HIGH';
    }[];
    suggestions: string[];
    metrics: Record<string, number>;
  }> {
    const base = { orgType: org.orgType, orgUserId: org.orgUserId };
    if (kind === 'inventory') {
      const [stocks, moves, variants] = await Promise.all([
        this.prisma.erpStock.findMany({ where: base }),
        this.prisma.erpStockMove.findMany({
          where: {
            ...base,
            type: 'OUT',
            createdAt: { gte: new Date(Date.now() - horizonDays * 86_400_000) },
          },
        }),
        this.prisma.erpVariant.findMany({ where: base }),
      ]);
      const variant = new Map(variants.map((row) => [row.id, row]));
      const outQty = new Map<number, number>();
      for (const move of moves)
        outQty.set(
          move.variantId,
          (outQty.get(move.variantId) || 0) + num(move.quantity),
        );
      const low = stocks.filter(
        (row) =>
          num(row.reorderPoint) > 0 && num(row.onHand) < num(row.reorderPoint),
      );
      const dead = stocks.filter(
        (row) => num(row.onHand) > 0 && !outQty.has(row.variantId),
      );
      const stockValue = stocks.reduce((sum, row) => {
        const v = variant.get(row.variantId);
        return sum + num(row.onHand) * num(v?.purchasePrice);
      }, 0);
      const findings: {
        title: string;
        detail: string;
        level: 'INFO' | 'WARN' | 'HIGH';
      }[] = [
        ...low.slice(0, 5).map((row) => ({
          title: `低于补货点：${variant.get(row.variantId)?.sku || row.variantId}`,
          detail: `现存 ${ds(row.onHand)}，补货点 ${ds(row.reorderPoint)}`,
          level: 'HIGH' as const,
        })),
        ...dead.slice(0, 5).map((row) => ({
          title: `呆滞库存：${variant.get(row.variantId)?.sku || row.variantId}`,
          detail: `现存 ${ds(row.onHand)}，近 ${horizonDays} 天无出库`,
          level: 'WARN' as const,
        })),
      ];
      if (!findings.length) {
        findings.push({
          title: '库存结构健康',
          detail: `近 ${horizonDays} 天没有缺货或呆滞记录`,
          level: 'INFO',
        });
      }
      return {
        summary: `库存总值约 ${ds(stockValue)}，${low.length} 个 SKU 低于补货点，${dead.length} 个 SKU 呆滞。`,
        findings,
        suggestions: [
          low.length ? '优先对低于补货点的 SKU 发起采购' : '保持当前补货节奏',
          dead.length
            ? '对呆滞库存做促销/调拨，或暂停补货'
            : '库存周转正常，无需额外动作',
        ],
        metrics: {
          stockValue: Number(ds(stockValue)),
          lowStock: low.length,
          deadStock: dead.length,
          outMoves: moves.length,
          horizonDays,
        },
      };
    }
    if (kind === 'purchase') {
      const [orders, vendors] = await Promise.all([
        this.prisma.erpPurchaseOrder.findMany({
          where: { ...base, status: { notIn: ['CANCELED', 'DONE'] } },
        }),
        this.prisma.erpVendor.findMany({ where: base }),
      ]);
      const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
      const overdue = orders.filter(
        (row) => row.expectedAt && row.expectedAt < today(),
      );
      const pendingAmount = orders.reduce(
        (sum, row) => sum + num(row.amount),
        0,
      );
      const findings: {
        title: string;
        detail: string;
        level: 'INFO' | 'WARN' | 'HIGH';
      }[] = [
        ...overdue.slice(0, 5).map((row) => ({
          title: `采购单逾期未到：${row.orderNo}`,
          detail: `${vendorName.get(row.vendorId) || '供应商'} 预计 ${row.expectedAt}，当前 ${row.status}`,
          level: 'HIGH' as const,
        })),
      ];
      if (!findings.length) {
        findings.push({
          title: '采购交付正常',
          detail: '没有逾期未完成的采购单',
          level: 'INFO',
        });
      }
      return {
        summary: `在途采购 ${orders.length} 单、金额 ${ds(pendingAmount)}，其中 ${overdue.length} 单已逾期。`,
        findings,
        suggestions: [
          overdue.length
            ? '跟催逾期采购单，必要时调整交期'
            : '按计划推进采购验收',
          orders.length > 10
            ? '合并小批量采购以降低运费与对账成本'
            : '采购节奏正常',
        ],
        metrics: {
          openOrders: orders.length,
          overdueOrders: overdue.length,
          pendingAmount: Number(ds(pendingAmount)),
          horizonDays,
        },
      };
    }
    if (kind === 'receivable') {
      const rows = await this.prisma.erpReceivable.findMany({
        where: { ...base, status: { notIn: ['PAID', 'CANCELED'] } },
      });
      const overdue = rows.filter(
        (row) => row.dueDate && row.dueDate < today(),
      );
      const outstanding = rows.reduce(
        (sum, row) => sum + num(row.amount) - num(row.receivedAmount),
        0,
      );
      const overdueAmount = overdue.reduce(
        (sum, row) => sum + num(row.amount) - num(row.receivedAmount),
        0,
      );
      const byCustomer = new Map<string, number>();
      for (const row of rows) {
        byCustomer.set(
          row.customerName,
          (byCustomer.get(row.customerName) || 0) +
            num(row.amount) -
            num(row.receivedAmount),
        );
      }
      const top = [...byCustomer.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      return {
        summary: `未结应收 ${rows.length} 笔、余额 ${ds(outstanding)}，逾期 ${overdue.length} 笔 ${ds(overdueAmount)}。`,
        findings: [
          ...overdue.slice(0, 5).map((row) => ({
            title: `应收逾期：${row.customerName}`,
            detail: `应收 ${ds(row.amount)}，已收 ${ds(row.receivedAmount)}，到期 ${row.dueDate}`,
            level: 'HIGH' as const,
          })),
          ...top.map(([name, amount]) => ({
            title: `应收集中：${name}`,
            detail: `未结余额 ${ds(amount)}`,
            level: 'WARN' as const,
          })),
        ],
        suggestions: [
          overdue.length
            ? '对逾期客户建立催收清单，按账龄分级跟进'
            : '当前无逾期，保持账期管理',
          top.length
            ? `关注头部客户回款节奏（${top.map(([name]) => name).join('、')}）`
            : '客户结构分散',
        ],
        metrics: {
          openReceivables: rows.length,
          overdueReceivables: overdue.length,
          outstanding: Number(ds(outstanding)),
          overdueAmount: Number(ds(overdueAmount)),
          horizonDays,
        },
      };
    }
    const [receivableRows, payableRows] = await Promise.all([
      this.prisma.erpReceivable.findMany({
        where: { ...base, status: { notIn: ['PAID', 'CANCELED'] } },
      }),
      this.prisma.erpPayable.findMany({
        where: { ...base, status: { notIn: ['PAID', 'CANCELED'] } },
      }),
    ]);
    const limit = addDays(today(), horizonDays);
    const inflow = receivableRows
      .filter((row) => !row.dueDate || row.dueDate <= limit)
      .reduce((sum, row) => sum + num(row.amount) - num(row.receivedAmount), 0);
    const outflow = payableRows
      .filter((row) => !row.dueDate || row.dueDate <= limit)
      .reduce((sum, row) => sum + num(row.amount) - num(row.paidAmount), 0);
    const net = inflow - outflow;
    return {
      summary: `${horizonDays} 天预计回款 ${ds(inflow)}、付款 ${ds(outflow)}，净现金流 ${ds(net)}。`,
      findings: [
        {
          title: net >= 0 ? '现金流为正' : '现金流缺口',
          detail: `预计净流入 ${ds(net)}`,
          level: net >= 0 ? 'INFO' : 'HIGH',
        },
        ...payableRows
          .filter((row) => row.dueDate && row.dueDate <= addDays(today(), 7))
          .slice(0, 5)
          .map((row) => ({
            title: `7 天内到期应付 ${row.code}`,
            detail: `余额 ${ds(num(row.amount) - num(row.paidAmount))}，到期 ${row.dueDate}`,
            level: 'WARN' as const,
          })),
      ],
      suggestions: [
        net >= 0
          ? '保持当前收款节奏，可将闲置资金安排短期理财'
          : '优先催收近期到期应收，或与供应商协商展期',
        outflow > 0 ? '按周滚动更新付款计划，避免集中到期' : '暂无近期付款压力',
      ],
      metrics: {
        inflow: Number(ds(inflow)),
        outflow: Number(ds(outflow)),
        net: Number(ds(net)),
        openReceivables: receivableRows.length,
        openPayables: payableRows.length,
        horizonDays,
      },
    };
  }

  async aiInsight(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const kind = oneOf(
      body.kind,
      ['inventory', 'purchase', 'receivable', 'cashflow'] as const,
      'inventory',
    );
    const horizonDays = Math.min(
      365,
      Math.max(7, Math.trunc(num(body.horizonDays, 90))),
    );
    const baseline = await this.ruleInsight(org, kind, horizonDays);
    let mode: 'llm' | 'rule' = 'rule';
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是企业经营分析顾问。根据指标与发现补充判断，只输出 JSON：{"summary":"","findings":[{"title":"","detail":"","level":"INFO|WARN|HIGH"}],"suggestions":[""]}。',
        },
        {
          role: 'user',
          content: JSON.stringify({ kind, horizonDays, baseline }),
        },
      ],
      user.userId,
      900,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      if (parsed) {
        mode = 'llm';
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          baseline.summary = clip(parsed.summary, 1000);
        }
        if (Array.isArray(parsed.findings)) {
          const rows = (parsed.findings as Row[])
            .map((item) => ({
              title: clip(item.title, 200),
              detail: clip(item.detail, 500),
              level: oneOf(
                item.level,
                ['INFO', 'WARN', 'HIGH'] as const,
                'INFO',
              ),
            }))
            .filter((item) => item.title)
            .slice(0, 10);
          if (rows.length) baseline.findings = rows;
        }
        const suggestions = strArr(parsed.suggestions)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        if (suggestions.length) baseline.suggestions = suggestions;
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'insight_report',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `erp-insight:${kind}`,
          )
          .catch(() => undefined);
      }
    }
    const generatedAt = new Date().toISOString();
    await this.prisma.aiInsightRecord.create({
      data: {
        ...orgKey(org),
        scope: 'erp',
        kind,
        mode,
        summary: clip(baseline.summary, 1000),
        findings: json(baseline.findings),
        suggestions: json(baseline.suggestions),
        metrics: json(baseline.metrics),
        createdBy: org.actorId,
      },
    });
    return {
      kind,
      mode,
      summary: baseline.summary,
      findings: baseline.findings,
      suggestions: baseline.suggestions,
      metrics: baseline.metrics,
      generatedAt,
    };
  }
}
