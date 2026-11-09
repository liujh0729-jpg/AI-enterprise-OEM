import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { upstreamToken } from '../../common/upstream-token';
import { errorResponse } from './common';

export function registerAssetRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const endpoint = endpoints['Asset_list'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_list',
        tags: ['Asset'],
        request: { query: endpoint.query },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.list(
          c.get('user')!,
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_create'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_create',
        tags: ['Asset'],
        request: {
          body: {
            required: true,
            content: { 'application/json': { schema: endpoint.body } },
          },
        },
        responses: {
          201: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.create(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_accept'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_accept',
        tags: ['Asset'],
        request: { params: endpoint.params },
        responses: {
          201: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.accept(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_update'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_update',
        tags: ['Asset'],
        request: {
          params: endpoint.params,
          body: {
            required: true,
            content: { 'application/json': { schema: endpoint.body } },
          },
        },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.update(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_remove'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_remove',
        tags: ['Asset'],
        request: { params: endpoint.params },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.remove(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_messages'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_messages',
        tags: ['Asset'],
        request: { params: endpoint.params },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.messages(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_postMessage'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_postMessage',
        tags: ['Asset'],
        request: {
          params: endpoint.params,
          body: {
            required: true,
            content: { 'application/json': { schema: endpoint.body } },
          },
        },
        responses: {
          201: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result = await services.controllers.assetController.postMessage(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Asset_updateContacts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_updateContacts',
        tags: ['Asset'],
        request: {
          params: endpoint.params,
          body: {
            required: true,
            content: { 'application/json': { schema: endpoint.body } },
          },
        },
        responses: {
          201: {
            description: 'Success',
            content: { 'application/json': { schema: endpoint.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (c) => {
        const result =
          await services.controllers.assetController.updateContacts(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const definition = endpoints.Asset_page;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_page',
        tags: ['Asset'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'page',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.assetController.listPage(
              c.get('user')!,
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Asset_stats;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_stats',
        tags: ['Asset'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'stats',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.assetController.listStats(
              c.get('user')!,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Asset_detail;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Asset_detail',
        tags: ['Asset'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'detail',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.assetController.detail(
              c.get('user')!,
              c.req.valid('param').id,
            ),
          ),
          200,
        ),
    );
  }
}
