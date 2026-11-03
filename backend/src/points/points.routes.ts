import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import type { PointsSettingsService } from './points-settings.service';
import type { PointsService } from './points.service';
import type { PricingService } from './pricing.service';
import type { RechargeService } from './recharge.service';
import type { AwcoinClient } from './awcoin.client';

/** PointsModule 直接复用 services.ts 里已构造好的积分域实例（单一构造点）。 */
export class PointsModule {
  readonly settings: PointsSettingsService;
  readonly ledger: PointsService;
  readonly pricing: PricingService;
  readonly recharge: RechargeService;
  readonly awcoin: AwcoinClient;

  constructor(services: Services) {
    this.settings = services.points.settings;
    this.ledger = services.points.ledger;
    this.pricing = services.points.pricing;
    this.recharge = services.points.recharge;
    this.awcoin = services.points.awcoin;
  }
}

export function createPointsModule(services: Services): PointsModule {
  return new PointsModule(services);
}

function pageOf(c: Context<ApiEnv>, sizeDefault = 20) {
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query('size') || sizeDefault) || sizeDefault));
  return { page, size };
}

/**
 * 用户「积分中心」路由（挂 business，经统一鉴权；只需登录用户，不要求管理员）。
 * summary 同时返回本站积分余额与 AWcoin 双币（互不兑换，只读展示）。
 */
export function registerPointsRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: PointsModule,
  requireAdmin: (user: CurrentUser) => void,
) {
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  // ---------- 用户侧 ----------
  app.get('/enterprise/points/summary', async (c) => {
    const userId = userOf(c).userId;
    const [points, awcoin] = await Promise.all([
      module.ledger.summary(userId),
      module.awcoin.balance(userId),
    ]);
    return json(c, {
      points,
      awcoin: { value: awcoin.value, source: awcoin.source },
    });
  });
  app.get('/enterprise/points/transactions', async (c) => {
    const userId = userOf(c).userId;
    const { page, size } = pageOf(c);
    return json(
      c,
      await module.ledger.transactions(userId, {
        page,
        size,
        type: c.req.query('type') || undefined,
        scene: c.req.query('scene') || undefined,
      }),
    );
  });
  app.get('/enterprise/points/settings', async (c) => {
    // 用户可见的充值/赠送参数（不含敏感项）
    const cfg = await module.settings.view();
    return json(c, {
      rate: cfg.rate,
      rechargeMinCents: cfg.rechargeMinCents,
      rechargeTiers: cfg.rechargeTiers,
      wechatConfigured: cfg.wechatConfigured,
      transferEnabled: cfg.transferEnabled,
      transferMin: cfg.transferMin,
      transferFeePercent: cfg.transferFeePercent,
    });
  });
  app.post('/enterprise/points/transfer/preview', async (c) => {
    const body = z.object({ to: z.string().min(1).max(64) }).parse(await c.req.json());
    return json(c, await module.ledger.previewTransfer(body.to));
  });
  app.post('/enterprise/points/transfer', async (c) => {
    const userId = userOf(c).userId;
    const body = z
      .object({ to: z.string().min(1).max(64), amount: z.number().gt(0) })
      .parse(await c.req.json());
    return json(c, await module.ledger.transfer(userId, body.to, body.amount), '赠送成功');
  });

  // ---------- 充值下单与查询 ----------
  app.post('/enterprise/points/recharge/create', async (c) => {
    const userId = userOf(c).userId;
    const body = z
      .object({
        amountCents: z.number().int().positive().optional(),
        tierIndex: z.number().int().min(0).max(11).optional(),
        channel: z.enum(['NATIVE', 'H5']).default('NATIVE'),
      })
      .parse(await c.req.json());
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      c.req.header('x-real-ip') ||
      '127.0.0.1';
    return json(c, await module.recharge.createOrder(userId, { ...body, clientIp }), '下单成功');
  });
  app.get('/enterprise/points/recharge/query/:orderNo', async (c) => {
    const userId = userOf(c).userId;
    return json(c, await module.recharge.query(userId, c.req.param('orderNo')));
  });
  app.get('/enterprise/points/recharge/orders', async (c) => {
    const userId = userOf(c).userId;
    const { page, size } = pageOf(c, 10);
    return json(c, await module.recharge.listOrders(userId, page, size));
  });

  // ---------- 管理端「积分与充值」 ----------
  app.get('/enterprise/admin/points/settings', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.settings.view());
  });
  app.put('/enterprise/admin/points/settings', async (c) => {
    requireAdmin(userOf(c));
    const body = z.record(z.string(), z.unknown()).parse(await c.req.json());
    return json(c, await module.settings.save(body), '积分设置已保存');
  });
  app.put('/enterprise/admin/points/wechat', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({
        appId: z.string().max(64).optional(),
        mchId: z.string().max(64).optional(),
        apiv3Key: z.string().max(128).optional(),
        certSerial: z.string().max(128).optional(),
        privateKey: z.string().max(16384).optional(),
        notifyUrl: z.string().max(512).optional(),
      })
      .parse(await c.req.json());
    await module.settings.saveWechatConfig(body);
    return json(c, { wechatConfigured: (await module.settings.view()).wechatConfigured }, '微信支付配置已保存');
  });
  app.post('/enterprise/admin/points/wechat/test', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.recharge.testConnection(), '连接正常');
  });
  app.get('/enterprise/admin/points/pricing', async (c) => {
    requireAdmin(userOf(c));
    return json(c, await module.pricing.list());
  });
  app.put('/enterprise/admin/points/pricing/:code', async (c) => {
    requireAdmin(userOf(c));
    const body = z
      .object({
        mode: z.enum(['FREE', 'METERED']).optional(),
        unit: z.string().max(32).optional(),
        unitPriceAmount: z.number().min(0).optional(),
        freeQuotaAmount: z.number().min(0).optional(),
        minChargeAmount: z.number().min(0).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(await c.req.json());
    return json(c, await module.pricing.update(c.req.param('code'), body), '价目已更新');
  });
  app.get('/enterprise/admin/points/usage', async (c) => {
    requireAdmin(userOf(c));
    const { page, size } = pageOf(c, 50);
    return json(
      c,
      await module.pricing.usage({
        code: c.req.query('code') || undefined,
        userId: c.req.query('userId') || undefined,
        page,
        size,
      }),
    );
  });
  app.get('/enterprise/admin/points/accounts', async (c) => {
    requireAdmin(userOf(c));
    const { page, size } = pageOf(c);
    return json(
      c,
      await module.ledger.adminFindAccounts(c.req.query('keyword') || '', page, size),
    );
  });
  app.get('/enterprise/admin/points/transactions/:userId', async (c) => {
    requireAdmin(userOf(c));
    const { page, size } = pageOf(c);
    return json(
      c,
      await module.ledger.transactions(c.req.param('userId'), { page, size }),
    );
  });
  app.post('/enterprise/admin/points/adjust', async (c) => {
    const admin = userOf(c);
    requireAdmin(admin);
    const body = z
      .object({
        userId: z.string().min(1).max(64),
        delta: z.number(),
        remark: z.string().max(200).optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await module.ledger.adminAdjust(admin.userId, body.userId, body.delta, body.remark || ''),
      '已调整积分',
    );
  });
  app.get('/enterprise/admin/points/orders', async (c) => {
    requireAdmin(userOf(c));
    const { page, size } = pageOf(c, 20);
    return json(
      c,
      await module.recharge.adminListOrders({
        status: c.req.query('status') || undefined,
        keyword: c.req.query('keyword') || undefined,
        page,
        size,
      }),
    );
  });
}

/**
 * 微信支付回调（公开路由，挂根 app，不经业务鉴权与统一信封）：
 * 原样按微信规范应答——验签/结算成功回 200 {code:SUCCESS}，失败回 5xx 让微信重试。
 */
export function registerPointsPublicRoutes(app: OpenAPIHono<ApiEnv>, module: PointsModule) {
  // 充值页 SSR/首屏可见参数：只出不入，不含任何商户敏感项。
  app.get('/api/points-config', async (c) => {
    const cfg = await module.settings.view();
    return c.json(
      ok({
        rate: cfg.rate,
        rechargeMinCents: cfg.rechargeMinCents,
        rechargeTiers: cfg.rechargeTiers,
        wechatConfigured: cfg.wechatConfigured,
        transferEnabled: cfg.transferEnabled,
        transferMin: cfg.transferMin,
        // 邀请奖励规则（公开、可对外宣传）：/invite 页据此告诉用户邀请可得多少积分
        signupBonus: cfg.signupBonus,
        inviteRewardSignup: cfg.inviteRewardSignup,
        inviteRechargePercent: cfg.inviteRechargePercent,
        inviteRechargeCap: cfg.inviteRechargeCap,
        inviteDailyCount: cfg.inviteDailyCount,
      }),
    );
  });
  app.post('/api/pay/wechat/notify', async (c) => {
    const rawBody = await c.req.text();
    const headers: Record<string, string> = {
      'wechatpay-serial': c.req.header('wechatpay-serial') || '',
      'wechatpay-nonce-str': c.req.header('wechatpay-nonce-str') || '',
      'wechatpay-timestamp': c.req.header('wechatpay-timestamp') || '',
      'wechatpay-signature': c.req.header('wechatpay-signature') || '',
    };
    try {
      await module.recharge.handleNotify(rawBody, headers);
      return c.json({ code: 'SUCCESS', message: '成功' }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      return c.json({ code: 'FAIL', message }, 500);
    }
  });
}
