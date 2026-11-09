import type { Context } from 'hono';
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { endpoints, z } from '@enterprise/contracts';
import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { serializeResponse } from '../http/response';
import type { CurrentUser } from '../auth/current-user';
import type { ApiEnv } from '../http/types';
import type { PublishReviewService } from './publish-review.service';

const errorResponse = {
  description: 'Request rejected',
  content: {
    'application/json': {
      schema: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown(),
      }),
    },
  },
};

/** 发布审核配置（平台管理员）：配置 / 测试 / 拦截台账，统一 requireAdmin 收口。 */
export function registerPublishReviewRoutes(
  app: OpenAPIHono<ApiEnv>,
  service: PublishReviewService,
  requireAdmin: (user: CurrentUser) => void,
) {
  const adminOf = (c: Context<ApiEnv>): CurrentUser => {
    const user = c.get('user');
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
    requireAdmin(user);
    return user;
  };
  const responses = (schema: z.ZodType) => ({
    200: {
      description: 'Success',
      content: { 'application/json': { schema } },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    413: errorResponse,
    422: errorResponse,
    500: errorResponse,
    503: errorResponse,
  });

  {
    const definition = endpoints.PublishReview_settings;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path,
        operationId: 'PublishReview_settings',
        tags: ['Moderation'],
        request: {},
        responses: responses(definition.response),
      }),
      async (c) => {
        adminOf(c);
        return c.json(
          serializeResponse(definition.response, ok(await service.view())),
          200,
        );
      },
    );
  }
  {
    const definition = endpoints.PublishReview_save;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path,
        operationId: 'PublishReview_save',
        tags: ['Moderation'],
        request: {
          body: {
            required: true,
            content: { 'application/json': { schema: definition.body } },
          },
        },
        responses: responses(definition.response),
      }),
      async (c) => {
        const admin = adminOf(c);
        const result = await service.save(c.req.valid('json'), admin.userId);
        return c.json(serializeResponse(definition.response, ok(result)), 200);
      },
    );
  }
  {
    const definition = endpoints.PublishReview_test;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path,
        operationId: 'PublishReview_test',
        tags: ['Moderation'],
        request: {
          body: {
            required: true,
            content: { 'application/json': { schema: definition.body } },
          },
        },
        responses: responses(definition.response),
      }),
      async (c) => {
        adminOf(c);
        const result = await service.test(c.req.valid('json').text);
        return c.json(serializeResponse(definition.response, ok(result)), 200);
      },
    );
  }
  {
    const definition = endpoints.PublishReview_logs;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path,
        operationId: 'PublishReview_logs',
        tags: ['Moderation'],
        request: { query: definition.query },
        responses: responses(definition.response),
      }),
      async (c) => {
        adminOf(c);
        const result = await service.logs(c.req.valid('query'));
        return c.json(serializeResponse(definition.response, ok(result)), 200);
      },
    );
  }
}
