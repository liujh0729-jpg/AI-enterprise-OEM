import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { upstreamToken } from '../common/upstream-token';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { ListingService } from './listing.service';

export class ListingModule {
  readonly listing: ListingService;
  constructor(services: Services) {
    this.listing = new ListingService(services.prisma, services.demandService);
  }
}
export function createListingModule(services: Services): ListingModule {
  return new ListingModule(services);
}

const intParam = (raw: string | undefined, name: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${name}非法`);
  return value;
};

/**
 * 供求广场路由（设计 §4.2 / M6）：挂在 business（统一鉴权 + 平台封禁即时拦截）。
 * - 本地发布 / 浏览 / 删除：免 APIKey，任何注册用户可用；
 * - 同步发布到 AIworkin / 刷新上游状态：经 upstreamToken 门控，未绑定 Key 直接 403。
 */
export function registerListingRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: ListingModule,
) {
  const service = module.listing;
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  // ---------- 类目字典（供求发布选择器） ----------
  app.get('/enterprise/social/listings/categories', (c) =>
    json(c, service.categories()),
  );

  // ---------- 本地发布（免 Key） ----------
  app.post('/enterprise/social/listings', async (c) => {
    const body = z
      .object({
        type: z.enum(['DEMAND', 'SERVICE']),
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(20000),
        tags: z.array(z.string().max(30)).max(10).optional(),
        moneyMode: z
          .enum(['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'])
          .optional(),
        amountMin: z.number().int().optional(),
        amountMax: z.number().int().optional(),
        province: z.string().max(50).optional(),
        city: z.string().max(50).optional(),
        contactNote: z.string().max(500).optional(),
        subcategoryId: z.string().max(64).optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.create(userOf(c).userId, body),
      '已发布到供求广场',
    );
  });
  app.get('/enterprise/social/listings', async (c) =>
    json(
      c,
      await service.feed({
        type: c.req.query('type'),
        keyword: c.req.query('keyword'),
        take: Number(c.req.query('take') || 50),
      }),
    ),
  );
  app.get('/enterprise/social/listings/mine', async (c) =>
    json(c, await service.mine(userOf(c).userId)),
  );
  app.get('/enterprise/social/listings/:id', async (c) =>
    json(c, await service.detail(intParam(c.req.param('id'), '供求帖'))),
  );
  app.delete('/enterprise/social/listings/:id', async (c) =>
    json(
      c,
      await service.remove(
        userOf(c).userId,
        intParam(c.req.param('id'), '供求帖'),
      ),
      '已删除',
    ),
  );

  // ---------- 同步发布到 AIworkin（需绑定 Key） ----------
  app.post('/enterprise/social/listings/:id/publish-upstream', async (c) => {
    const body = z
      .object({
        deadline: z.string().max(64).optional(),
        contactName: z.string().max(64).optional(),
        contactPhone: z.string().max(32).optional(),
        contactWechat: z.string().max(64).optional(),
        contactEmail: z.string().max(160).optional(),
        priceDescription: z.string().max(2000).optional(),
        serviceAreaMode: z.enum(['NATIONWIDE', 'REGION', 'RADIUS']).optional(),
      })
      .parse(await c.req.json());
    // 未绑定 AIPDD Key → upstreamToken 抛 403「请先绑定」，本地帖仍保持已发布态。
    const token = await upstreamToken(c);
    return json(
      c,
      await service.publishUpstream(
        userOf(c).userId,
        token,
        intParam(c.req.param('id'), '供求帖'),
        body,
      ),
      '已同步发布到 AIworkin',
    );
  });
  app.post('/enterprise/social/listings/:id/refresh-status', async (c) => {
    const token = await upstreamToken(c);
    return json(
      c,
      await service.refreshStatus(
        userOf(c).userId,
        intParam(c.req.param('id'), '供求帖'),
        token,
      ),
      '状态已刷新',
    );
  });
}
