import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { errorResponse } from './common';

export function registerAppsRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const definition = endpoints.Apps_list;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path,
        operationId: 'Apps_list',
        tags: ['Apps'],
        request: { query: definition.query },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: definition.response } },
          },
          400: errorResponse,
          401: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.appDirectoryController.list(
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Apps_detail;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Apps_detail',
        tags: ['Apps'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: definition.response } },
          },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.appDirectoryController.detail(
              c.req.valid('param').clientId,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Apps_reviews;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Apps_reviews',
        tags: ['Apps'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: definition.response } },
          },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.appDirectoryController.reviews(
              c.req.valid('param').clientId,
              c.req.valid('query').page,
              c.req.valid('query').pageSize,
            ),
          ),
          200,
        ),
    );
  }
}
