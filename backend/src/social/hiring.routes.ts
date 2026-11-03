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
import { HiringService } from './hiring.service';

export class HiringModule {
  readonly hiring: HiringService;
  constructor(services: Services) {
    this.hiring = new HiringService(services.prisma, services.demandService);
  }
}
export function createHiringModule(services: Services): HiringModule {
  return new HiringModule(services);
}

const intParam = (raw: string | undefined, name: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${name}非法`);
  return value;
};

/**
 * 招聘专区路由（商务人脉 → 招聘）：挂在 business（统一鉴权 + 平台封禁即时拦截）。
 * - 本地发布 / 浏览 / 删除：免 APIKey，任何注册用户可用，沟通走站内私信；
 * - 同步发布到 AIworkin / 刷新上游状态：经 upstreamToken 门控，未绑定 Key 直接 403。
 */
export function registerHiringRoutes(
  app: OpenAPIHono<ApiEnv>,
  module: HiringModule,
) {
  const service = module.hiring;
  const userOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    return user;
  };
  const json = (c: Context<ApiEnv>, data: unknown, message = 'ok') =>
    c.json(ok(data, message));

  // ---------- 字典 ----------
  app.get('/enterprise/social/hiring/types', (c) => json(c, service.types()));
  app.get('/enterprise/social/hiring/sync-category', (c) =>
    json(c, service.syncCategory()),
  );

  // ---------- 本地发布（免 Key） ----------
  app.post('/enterprise/social/hiring', async (c) => {
    const body = z
      .object({
        type: z.enum([
          'FULL_TIME',
          'PART_TIME',
          'INTERNSHIP',
          'TEMPORARY',
          'DISPATCH',
        ]),
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(20000),
        headCount: z.number().int().min(1).max(9999).optional(),
        salaryMode: z
          .enum(['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'])
          .optional(),
        salaryMin: z.number().int().optional(),
        salaryMax: z.number().int().optional(),
        tags: z.array(z.string().max(30)).max(10).optional(),
        province: z.string().max(50).optional(),
        city: z.string().max(50).optional(),
        contactNote: z.string().max(500).optional(),
        deadline: z.string().max(64).optional(),
      })
      .parse(await c.req.json());
    return json(
      c,
      await service.create(userOf(c).userId, body),
      '已发布到招聘广场',
    );
  });
  app.get('/enterprise/social/hiring', async (c) =>
    json(
      c,
      await service.feed({
        type: c.req.query('type'),
        keyword: c.req.query('keyword'),
        take: Number(c.req.query('take') || 50),
      }),
    ),
  );
  app.get('/enterprise/social/hiring/mine', async (c) =>
    json(c, await service.mine(userOf(c).userId)),
  );
  app.get('/enterprise/social/hiring/:id', async (c) =>
    json(c, await service.detail(intParam(c.req.param('id'), '招聘帖'))),
  );
  app.delete('/enterprise/social/hiring/:id', async (c) =>
    json(
      c,
      await service.remove(
        userOf(c).userId,
        intParam(c.req.param('id'), '招聘帖'),
      ),
      '已删除',
    ),
  );

  // ---------- 同步发布到 AIworkin（需绑定 Key） ----------
  app.post('/enterprise/social/hiring/:id/publish-upstream', async (c) => {
    const body = z
      .object({
        deadline: z.string().max(64).optional(),
        contactName: z.string().max(64).optional(),
        contactPhone: z.string().max(32).optional(),
        contactWechat: z.string().max(64).optional(),
        contactEmail: z.string().max(160).optional(),
      })
      .parse(await c.req.json());
    // 未绑定 AIPDD Key → upstreamToken 抛 403「请先绑定」，本地帖仍保持已发布态。
    const token = await upstreamToken(c);
    return json(
      c,
      await service.publishUpstream(
        userOf(c).userId,
        token,
        intParam(c.req.param('id'), '招聘帖'),
        body,
      ),
      '已同步发布到 AIworkin',
    );
  });
  app.post('/enterprise/social/hiring/:id/refresh-status', async (c) => {
    const token = await upstreamToken(c);
    return json(
      c,
      await service.refreshStatus(
        userOf(c).userId,
        intParam(c.req.param('id'), '招聘帖'),
        token,
      ),
      '状态已刷新',
    );
  });
}
