import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import type { ServicePackageService } from './service-package.service';
import type { ServicePackageFulfillmentService } from './service-package-fulfillment.service';

/** 复用 services.ts 已构造的套餐目录与交付实例（单一构造点），仅负责路由组装。 */
export class ServicePackageModule {
  readonly catalog: ServicePackageService;
  readonly fulfillment: ServicePackageFulfillmentService;
  constructor(services: Services) {
    this.catalog = services.servicePackages.catalog;
    this.fulfillment = services.servicePackages.fulfillment;
  }
}

export function createServicePackageModule(
  services: Services,
): ServicePackageModule {
  return new ServicePackageModule(services);
}

function pageOf(c: Context<ApiEnv>, sizeDefault = 20) {
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const size = Math.min(
    100,
    Math.max(1, Number(c.req.query('size') || sizeDefault) || sizeDefault),
  );
  return { page, size };
}

/**
 * 官方服务套餐路由（挂 business，经统一鉴权）：用户侧展示/报价/积分直购/我的套餐，
 * 管理端目录 CRUD + 交付管理（匹配/主持发起/更换主体/退款）。requireAdmin 统一注入。
 */
export function registerServicePackageRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: ServicePackageModule,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));
  const idOf = (c: Context<ApiEnv>, name = 'id'): number => {
    const value = Number(c.req.param(name));
    if (!Number.isInteger(value) || value <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '无效的 id');
    }
    return value;
  };

  // ---------- 用户侧 ----------
  app.get('/enterprise/service-packages', async (c) => {
    const serviceType = c.req.query('serviceType') || '';
    if (!serviceType) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少板块码');
    }
    const userId = c.get('user')?.userId;
    return json(c, await module.catalog.publicList(serviceType, userId));
  });
  app.get('/enterprise/service-packages/mine', async (c) => {
    return json(c, await module.catalog.myOrders(userOf(c).userId));
  });
  app.get('/enterprise/service-packages/quote/:id', async (c) => {
    return json(c, await module.catalog.quote(idOf(c), userOf(c).userId));
  });
  app.post('/enterprise/service-packages/:id/purchase', async (c) => {
    return json(
      c,
      await module.catalog.purchase(userOf(c), idOf(c)),
      '采购成功，平台将主持服务商签约（服务商确认后生效）',
    );
  });

  // ---------- 管理端：套餐目录 ----------
  app.get('/enterprise/admin/service-packages', async (c) => {
    requireAdmin(userOf(c));
    return json(
      c,
      await module.catalog.adminList(c.req.query('serviceType') || undefined),
    );
  });
  app.post('/enterprise/admin/service-packages', async (c) => {
    const admin = userOf(c);
    requireAdmin(admin);
    const body = z
      .object({
        id: z.number().int().positive().optional(),
        serviceType: z.string().min(1).max(32),
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        priceCents: z.number().int().min(0),
        unit: z.string().max(16).optional(),
        features: z.array(z.string()).optional(),
        deliveryItems: z
          .array(
            z.object({
              code: z.string().min(1).max(32),
              label: z.string().max(120).optional(),
              providerUserId: z.string().max(64).optional(),
              providerOrg: z.string().max(200).optional(),
            }),
          )
          .optional(),
        deliveryDesc: z.string().max(500).optional(),
        autoInitiate: z.boolean().optional(),
        taxpayerType: z.string().max(16).nullable().optional(),
        perEnterpriseLimit: z.number().int().min(0).optional(),
        status: z.enum(['ACTIVE', 'DISABLED']).optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.catalog.adminSave(admin, body), '套餐已保存');
  });
  app.delete('/enterprise/admin/service-packages/:id', async (c) => {
    const admin = userOf(c);
    requireAdmin(admin);
    return json(
      c,
      await module.catalog.adminRemove(admin, idOf(c)),
      '套餐已删除',
    );
  });
  app.put('/enterprise/admin/service-packages/:id/status', async (c) => {
    const admin = userOf(c);
    requireAdmin(admin);
    const body = z
      .object({ status: z.enum(['ACTIVE', 'DISABLED']) })
      .parse(await c.req.json());
    return json(
      c,
      await module.catalog.adminToggle(admin, idOf(c), body.status),
      '上下架已更新',
    );
  });

  // ---------- 管理端：交付管理 ----------
  app.get('/enterprise/admin/service-packages/orders', async (c) => {
    requireAdmin(userOf(c));
    const { page, size } = pageOf(c, 20);
    return json(
      c,
      await module.fulfillment.adminOrders({
        serviceType: c.req.query('serviceType') || undefined,
        fulfillmentStatus: c.req.query('fulfillmentStatus') || undefined,
        keyword: c.req.query('keyword') || undefined,
        page,
        size,
      }),
    );
  });
  app.get('/enterprise/admin/service-packages/orders/:id', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.fulfillment.orderDetail(idOf(c)));
  });
  app.get('/enterprise/admin/service-packages/candidates', async (c) => {
    requireAdmin(userOf(c));
    const serviceType = c.req.query('serviceType') || '';
    if (!serviceType) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少交付项类目码');
    }
    return json(c, await module.fulfillment.candidates(serviceType));
  });
  app.post('/enterprise/admin/service-packages/items/:id/assign', async (c) => {
    const admin = userOf(c);
    requireAdmin(admin);
    const body = z
      .object({ providerUserId: z.string().min(1).max(64) })
      .parse(await c.req.json());
    return json(
      c,
      await module.fulfillment.assignProvider(
        admin,
        idOf(c),
        body.providerUserId,
      ),
      '已匹配服务商',
    );
  });
  app.post(
    '/enterprise/admin/service-packages/orders/:id/initiate',
    async (c) => {
      const admin = userOf(c);
      requireAdmin(admin);
      return json(
        c,
        await module.fulfillment.initiateSigning(admin, idOf(c)),
        '已主持发起签约',
      );
    },
  );
  app.post(
    '/enterprise/admin/service-packages/items/:id/replace',
    async (c) => {
      const admin = userOf(c);
      requireAdmin(admin);
      const body = z
        .object({ providerUserId: z.string().min(1).max(64) })
        .parse(await c.req.json());
      return json(
        c,
        await module.fulfillment.replaceProvider(
          admin,
          idOf(c),
          body.providerUserId,
        ),
        '已更换服务商并重新发起',
      );
    },
  );
  app.post(
    '/enterprise/admin/service-packages/orders/:id/refund',
    async (c) => {
      const admin = userOf(c);
      requireAdmin(admin);
      const body = z
        .object({
          // 不传金额＝退回剩余全部（整单退）；小于剩余＝部分退，订单保持开放。
          amount: z.number().positive().optional(),
          remark: z.string().max(200).optional(),
        })
        .parse(await c.req.json().catch(() => ({})));
      return json(
        c,
        await module.fulfillment.refund(admin, idOf(c), body),
        '退款已处理',
      );
    },
  );
}
