import type { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { allocateNo } from '../common/document-number';
import {
  CATEGORY_LABELS,
  CONTRACT_CATEGORIES,
  SERVICE_TYPES,
  isOverseasType,
} from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import {
  IdentityService,
  asArray,
  isPersonalSubject,
} from '../identity/identity.service';
import { PointsService } from '../points/points.service';
import { PointsSettingsService } from '../points/points-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServicePackageFulfillmentService } from './service-package-fulfillment.service';

/** 交付项：code 为可签约类目/细项；可选预绑优质服务商（autoInitiate 时必填）。 */
interface DeliveryItem {
  code: string;
  label: string;
  providerUserId: string;
  providerOrg: string;
}

/** 分 → 元 → 积分：与充值同源公式，保留 4 位（购买所见即所扣）。 */
function centsToPoints(cents: number, rate: number) {
  return Number(((cents / 100) * rate).toFixed(4));
}

function parseDeliveryItems(value: Prisma.JsonValue): DeliveryItem[] {
  return asArray<Record<string, unknown>>(value).map((row) => ({
    code: text(row.code).trim(),
    label: text(row.label).trim(),
    providerUserId: text(row.providerUserId).trim(),
    providerOrg: text(row.providerOrg).trim(),
  }));
}

/**
 * 官方服务套餐目录与积分直购。套餐＝平台整合优质服务商的一揽子交付，
 * 积分价按官方汇率实时换算、购买时快照；购买后由交付服务主持企业与多家服务商签约兑现。
 */
export class ServicePackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
    private readonly users: UserLookupService,
    private readonly fulfillment: ServicePackageFulfillmentService,
  ) {}

  /** 列表/详情装饰：人民币价（元）+ 当前汇率积分价 + 交付项预览。 */
  private decorate(
    row: {
      id: number;
      serviceType: string;
      name: string;
      description: string;
      priceCents: number;
      unit: string;
      features: Prisma.JsonValue;
      deliveryItems: Prisma.JsonValue;
      deliveryDesc: string;
      autoInitiate: boolean;
      taxpayerType: string | null;
      perEnterpriseLimit: number;
      status: string;
      sortOrder: number;
    },
    rate: number,
  ) {
    const items = parseDeliveryItems(row.deliveryItems);
    return {
      id: row.id,
      serviceType: row.serviceType,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      price: row.priceCents / 100,
      pointsPrice: centsToPoints(row.priceCents, rate),
      unit: row.unit,
      features: asArray(row.features).map((f) => String(f)),
      // 交付项预览：只出类目名与预绑服务商名，不外泄服务商账号 id。
      deliveryItems: items.map((i) => ({
        code: i.code,
        label: i.label || CATEGORY_LABELS[i.code] || i.code,
        providerOrg: i.providerOrg,
      })),
      deliveryDesc: row.deliveryDesc,
      autoInitiate: row.autoInitiate,
      taxpayerType: row.taxpayerType,
      perEnterpriseLimit: row.perEnterpriseLimit,
      status: row.status,
      sortOrder: row.sortOrder,
    };
  }

  // ---------- 管理端：套餐目录 CRUD ----------
  async adminList(serviceType?: string) {
    const rate = (await this.settings.view()).rate;
    const rows = await this.prisma.servicePackage.findMany({
      where: serviceType ? { serviceType } : {},
      orderBy: [{ serviceType: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    // 管理端额外带出交付项预绑服务商 id（供表单回填）。
    return {
      rate,
      list: rows.map((row) => ({
        ...this.decorate(row, rate),
        deliveryConfig: parseDeliveryItems(row.deliveryItems),
      })),
    };
  }

  async adminSave(
    operator: CurrentUser,
    body: {
      id?: number;
      serviceType: string;
      name: string;
      description?: string;
      priceCents: number;
      unit?: string;
      features?: string[];
      deliveryItems?: Array<{
        code: string;
        label?: string;
        providerUserId?: string;
        providerOrg?: string;
      }>;
      deliveryDesc?: string;
      autoInitiate?: boolean;
      taxpayerType?: string | null;
      perEnterpriseLimit?: number;
      status?: string;
      sortOrder?: number;
    },
  ) {
    this.identity.requireAdmin(operator);
    if (!(SERVICE_TYPES as readonly string[]).includes(body.serviceType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '板块码不合法');
    }
    const name = text(body.name).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写套餐名');
    if (!Number.isInteger(body.priceCents) || body.priceCents < 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '人民币价不合法');
    }
    const items: DeliveryItem[] = (body.deliveryItems || []).map((row) => ({
      code: text(row.code).trim(),
      label: text(row.label).trim(),
      providerUserId: text(row.providerUserId).trim(),
      providerOrg: text(row.providerOrg).trim(),
    }));
    for (const item of items) {
      if (!CONTRACT_CATEGORIES.includes(item.code)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `交付项「${item.code || '空'}」不是可签约类目/细项`,
        );
      }
    }
    // 分配方式二选一：预设服务商（每项都选）或人工分配（全部留空，订单产生后再匹配）。
    const presetCount = items.filter((i) => i.providerUserId).length;
    if (presetCount > 0 && presetCount !== items.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '交付项服务商需全部预设或全部留空（人工分配）',
      );
    }
    const autoInitiate = Boolean(body.autoInitiate);
    if (autoInitiate) {
      if (!items.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '开启自动发起需先配置交付项',
        );
      }
      if (items.some((i) => !i.providerUserId)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '开启自动发起需为每个交付项预绑优质服务商',
        );
      }
    }
    // 预绑服务商名快照（表单只传 id 时补全 org，便于卡片展示）。
    for (const item of items) {
      if (item.providerUserId && !item.providerOrg) {
        item.providerOrg = await this.users.displayName(item.providerUserId);
      }
    }
    const taxpayerType =
      body.serviceType === 'TAX_FINANCE'
        ? text(body.taxpayerType).trim().toUpperCase() || null
        : null;
    if (taxpayerType && !['SMALL', 'GENERAL'].includes(taxpayerType)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '纳税人档仅支持 SMALL/GENERAL',
      );
    }
    const status = body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
    const data = {
      serviceType: body.serviceType,
      name: name.slice(0, 120),
      description: text(body.description).slice(0, 500),
      priceCents: body.priceCents,
      unit: text(body.unit || '年').slice(0, 16) || '年',
      features: (body.features || []).map((f) =>
        String(f),
      ) as Prisma.InputJsonValue,
      deliveryItems: items.map((item): Prisma.InputJsonObject => ({
        code: item.code,
        label: item.label,
        providerUserId: item.providerUserId,
        providerOrg: item.providerOrg,
      })),
      deliveryDesc: text(body.deliveryDesc).slice(0, 500),
      autoInitiate,
      taxpayerType,
      perEnterpriseLimit: Math.max(
        0,
        Math.floor(Number(body.perEnterpriseLimit) || 0),
      ),
      status,
      sortOrder: Math.floor(Number(body.sortOrder) || 0),
    };
    const row = body.id
      ? await this.prisma.servicePackage.update({
          where: { id: body.id },
          data,
        })
      : await this.prisma.servicePackage.create({ data });
    await this.identity.audit(
      operator.userId,
      body.id ? '修改服务套餐' : '新增服务套餐',
      `${row.name}（${CATEGORY_LABELS[row.serviceType] || row.serviceType}）`,
    );
    return { id: row.id };
  }

  async adminRemove(operator: CurrentUser, id: number) {
    this.identity.requireAdmin(operator);
    const row = await this.prisma.servicePackage.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '套餐不存在');
    // 订单已快照套餐名/价，删除目录不影响历史订单与交付。
    await this.prisma.servicePackage.delete({ where: { id } });
    await this.identity.audit(operator.userId, '删除服务套餐', row.name);
    return { id, removed: true };
  }

  async adminToggle(operator: CurrentUser, id: number, status: string) {
    this.identity.requireAdmin(operator);
    const next = status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
    const row = await this.prisma.servicePackage.update({
      where: { id },
      data: { status: next },
    });
    return { id: row.id, status: row.status };
  }

  // ---------- 用户端：展示 / 报价 / 购买 / 我的套餐 ----------
  /** 板块公开套餐（仅 ACTIVE）：带当前汇率积分价；登录用户带「已购买」标记。 */
  async publicList(serviceType: string, userId?: string) {
    const rate = (await this.settings.view()).rate;
    const rows = await this.prisma.servicePackage.findMany({
      where: { serviceType, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const purchased = new Set<number>();
    if (userId && rows.length) {
      // 已购标记按采购企业口径：限购按企业，跨账号同企业也应看到已购买。
      const enterpriseId = (await this.identity.myEnterprises(userId))[0]?.id;
      if (enterpriseId) {
        const orders = await this.prisma.servicePackageOrder.findMany({
          where: {
            enterpriseId,
            packageId: { in: rows.map((r) => r.id) },
            fulfillmentStatus: { not: 'CLOSED' },
          },
          select: { packageId: true },
        });
        for (const o of orders) purchased.add(o.packageId);
      }
    }
    return {
      rate,
      list: rows.map((row) => ({
        ...this.decorate(row, rate),
        purchased: purchased.has(row.id),
      })),
    };
  }

  /** 购买确认弹窗实时报价：当前汇率算积分价 + 余额 + 限购判定（只读不落库）。 */
  async quote(packageId: number, userId: string) {
    const row = await this.prisma.servicePackage.findUnique({
      where: { id: packageId },
    });
    if (!row || row.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '套餐不存在或已下架');
    }
    const rate = (await this.settings.view()).rate;
    const pointsPrice = centsToPoints(row.priceCents, rate);
    const [summary, enterprises] = await Promise.all([
      this.points.summary(userId),
      this.identity.myEnterprises(userId),
    ]);
    // 与 purchase 同口径：以采购所用企业档案计数（跨账号共享限购额度）。
    const enterpriseId = enterprises[0]?.id;
    const bought = enterpriseId
      ? await this.prisma.servicePackageOrder.count({
          where: {
            enterpriseId,
            packageId,
            fulfillmentStatus: { not: 'CLOSED' },
          },
        })
      : 0;
    const limitReached =
      row.perEnterpriseLimit > 0 && bought >= row.perEnterpriseLimit;
    return {
      packageId: row.id,
      name: row.name,
      priceCents: row.priceCents,
      price: row.priceCents / 100,
      pointsPrice,
      rate,
      balance: summary.balance,
      sufficient: summary.balance >= pointsPrice,
      // 购买需以已认证企业主体签约；提前告诉页面，便于直接给出「身份与资质」入口。
      hasEnterprise: enterprises.length > 0,
      enterpriseId: enterpriseId || 0,
      bought,
      perEnterpriseLimit: row.perEnterpriseLimit,
      limitReached,
      deliveryDesc: row.deliveryDesc,
    };
  }

  /**
   * 积分直购：校验 ACTIVE + 限购 + 企业档案（个人主体拦财税/出海交付项）→ 原子扣分 →
   * 落订单 PAID + 交付明细（带预绑服务商）→ autoInitiate best-effort 自动发起（失败转人工）。
   */
  async purchase(user: CurrentUser, packageId: number) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '请先在「身份与资质」（/identity?identity=ENTERPRISE_USER）提交企业信息并完成认证后再采购套餐',
      );
    }
    const ep = eps[0];
    const row = await this.prisma.servicePackage.findUnique({
      where: { id: packageId },
    });
    if (!row || row.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '套餐不存在或已下架');
    }
    if (row.perEnterpriseLimit > 0) {
      const bought = await this.prisma.servicePackageOrder.count({
        where: {
          enterpriseId: ep.id,
          packageId,
          fulfillmentStatus: { not: 'CLOSED' },
        },
      });
      if (bought >= row.perEnterpriseLimit) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `该套餐每个企业限购 ${row.perEnterpriseLimit} 份，当前企业已达上限`,
        );
      }
    }
    const items = parseDeliveryItems(row.deliveryItems);
    // 个人主体门控与签约同口径：财税/出海交付项不面向个人，扣分前先拦。
    if (
      isPersonalSubject(ep.subjectType) &&
      items.some((i) => i.code === 'TAX_FINANCE' || isOverseasType(i.code))
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该套餐含财税/出海交付项，不面向「个人」主体：请先在「身份与资质」（/identity?identity=ENTERPRISE_USER）变更为企业或个体工商户',
      );
    }
    const rate = (await this.settings.view()).rate;
    const pointsPrice = centsToPoints(row.priceCents, rate);
    const orderNo = await allocateNo(this.prisma, 'SP');
    // 先原子扣分（余额不足直接抛错，不建单）；建单失败则补偿退回。
    const debit =
      pointsPrice > 0
        ? await this.points.debit(user.userId, 'SPEND', pointsPrice, {
            scene: 'service_package',
            refType: 'service_package',
            refId: orderNo,
            remark: `购买套餐 ${row.name}`,
          })
        : {
            txId: 0,
            balance: (await this.points.summary(user.userId)).balance,
          };
    let orderId: number;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        // 锁套餐目录行，串行化同一套餐的下单计数：同企业多账号并发购买也不会穿透限购。
        if (row.perEnterpriseLimit > 0) {
          await tx.$queryRaw`SELECT id FROM service_packages WHERE id = ${row.id} FOR UPDATE`;
          const bought = await tx.servicePackageOrder.count({
            where: {
              enterpriseId: ep.id,
              packageId,
              fulfillmentStatus: { not: 'CLOSED' },
            },
          });
          if (bought >= row.perEnterpriseLimit) {
            throw new BusinessException(
              ErrorCode.FORBIDDEN,
              `该套餐每个企业限购 ${row.perEnterpriseLimit} 份，当前企业已达上限`,
            );
          }
        }
        const order = await tx.servicePackageOrder.create({
          data: {
            orderNo,
            userId: user.userId,
            enterpriseId: ep.id,
            packageId: row.id,
            packageName: row.name,
            serviceType: row.serviceType,
            priceCents: row.priceCents,
            rateAmount: rate,
            pointsAmount: pointsPrice,
            txId: debit.txId,
            status: 'PAID',
            fulfillmentStatus: 'PENDING_MATCH',
          },
        });
        if (items.length) {
          await tx.servicePackageOrderItem.createMany({
            data: items.map((i, index) => ({
              orderId: order.id,
              code: i.code,
              label: (i.label || CATEGORY_LABELS[i.code] || i.code).slice(
                0,
                120,
              ),
              providerUserId: i.providerUserId,
              providerOrg: i.providerOrg,
              sortOrder: index,
            })),
          });
        }
        return order.id;
      });
    } catch (error) {
      if (pointsPrice > 0) {
        await this.points
          .credit(user.userId, 'ADMIN_ADJUST', pointsPrice, {
            scene: 'service_package_rollback',
            refType: 'service_package',
            refId: orderNo,
            remark: '套餐建单失败回滚',
          })
          .catch(() => undefined);
      }
      throw error;
    }
    // 自动发起 best-effort：失败明细回落待匹配进交付队列，不阻断购买。
    if (row.autoInitiate) {
      await this.fulfillment.autoInitiate(orderId).catch(() => undefined);
    }
    const fulfillmentStatus = await this.fulfillment.syncFulfillment(orderId);
    return {
      orderId,
      orderNo,
      pointsAmount: pointsPrice,
      balance: debit.balance,
      fulfillmentStatus,
    };
  }

  /** 我的套餐（独立菜单）：本人采购订单 + 每项交付进度。 */
  async myOrders(userId: string) {
    return this.fulfillment.myOrders(userId);
  }
}
