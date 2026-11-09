import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { bookAppointmentBodySchema } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

/** 公开入口按 IP 限流：读 120 次/分、写 20 次/分。 */
const hits = new Map<string, { count: number; resetAt: number }>();
const limited = (key: string, max: number) => {
  const now = Date.now();
  const row = hits.get(key);
  if (hits.size > 5000) {
    for (const [item, value] of hits)
      if (value.resetAt < now) hits.delete(item);
  }
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  row.count += 1;
  return row.count > max;
};

const clientIp = (c: Context<ApiEnv>) =>
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
  c.req.header('x-real-ip') ||
  '0.0.0.0';

/**
 * 附录 B 公开通道（免登录）：
 * - GET  /api/public/appointments/:slug       预约活动 + 可选时间段
 * - POST /api/public/appointments/:slug/book  提交预约
 * - GET  /api/public/quotation/:token         报价单 PDF（计一次浏览）
 * - GET  /api/public/terms/:code              条款最新生效版本
 */
export function registerGapsPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.get('/api/public/appointments/:slug', async (c) => {
    if (limited(`apt:get:${clientIp(c)}`, 120)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    return c.json(
      ok(await services.gaps.appointments.publicEvent(c.req.param('slug'))),
    );
  });

  app.post('/api/public/appointments/:slug/book', async (c) => {
    if (limited(`apt:post:${clientIp(c)}`, 20)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '提交太频繁，请稍后再试',
      );
    }
    const body = bookAppointmentBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '预约信息格式不正确');
    }
    return c.json(
      ok(
        await services.gaps.appointments.publicBook(
          c.req.param('slug'),
          body.data,
        ),
      ),
    );
  });

  app.get('/api/public/quotation/:token', async (c) => {
    if (limited(`quote:get:${clientIp(c)}`, 120)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    const { buffer, fileName } = await services.gaps.quotationDoc.publicPdf(
      c.req.param('token'),
    );
    const filename = encodeURIComponent(fileName);
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"; filename*=UTF-8''${filename}`,
      },
    });
  });

  app.get('/api/public/terms/:code', async (c) => {
    if (limited(`terms:get:${clientIp(c)}`, 120)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    return c.json(
      ok(await services.gaps.terms.publicLatest(c.req.param('code'))),
    );
  });
}
