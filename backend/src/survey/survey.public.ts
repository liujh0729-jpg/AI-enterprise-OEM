import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { surveySubmitBodySchema } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

/** 进程内限流：公开入口按 IP 计数，读 120 次/分、写 20 次/分。 */
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

const submittedCookie = (c: Context<ApiEnv>, code: string) =>
  (c.req.header('cookie') || '')
    .split(';')
    .some((part) => part.trim().startsWith(`sv_${code}=`));

/**
 * 问卷公开通道（免登录）：
 * - GET  /api/public/survey/:code  填写页读取题目
 * - POST /api/public/survey/:code  提交答案，服务端校验后写进归属人的多维表格
 * 路径注册在根 app 上，和活码 / 客服通道一样不经过业务登录中间件。
 */
export function registerSurveyPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.get('/api/public/survey/:code', async (c) => {
    if (limited(`survey:get:${clientIp(c)}`, 120)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '访问太频繁，请稍后再试',
      );
    }
    const code = c.req.param('code');
    return c.json(ok(await services.survey.publicView(code)));
  });

  app.post('/api/public/survey/:code', async (c) => {
    if (limited(`survey:post:${clientIp(c)}`, 20)) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '提交太频繁，请稍后再试',
      );
    }
    const code = c.req.param('code');
    const body = surveySubmitBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '提交内容格式不正确');
    }
    const result = await services.survey.submit(code, body.data.answers, {
      seenBefore: submittedCookie(c, code),
    });
    c.header(
      'set-cookie',
      `sv_${code}=1; Path=/api/public/survey; Max-Age=31536000; SameSite=Lax; HttpOnly`,
    );
    return c.json(ok(result));
  });
}
