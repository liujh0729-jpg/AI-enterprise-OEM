import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { upstreamToken } from '../../common/upstream-token';
import { errorResponse } from './common';

export function registerSmartServiceRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const endpoint = endpoints['SmartService_list'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_list',
        tags: ['SmartService'],
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
        const result = await services.controllers.smartServiceController.list(
          c.get('user')!,
          c.req.valid('query')['as'],
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_create'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_create',
        tags: ['SmartService'],
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
        const result = await services.controllers.smartServiceController.create(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_accept'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_accept',
        tags: ['SmartService'],
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
        const result = await services.controllers.smartServiceController.accept(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_update'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_update',
        tags: ['SmartService'],
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
        const result = await services.controllers.smartServiceController.update(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_remove'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_remove',
        tags: ['SmartService'],
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
        const result = await services.controllers.smartServiceController.remove(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_messages'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_messages',
        tags: ['SmartService'],
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
        const result =
          await services.controllers.smartServiceController.messages(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_postMessage'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_postMessage',
        tags: ['SmartService'],
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
          await services.controllers.smartServiceController.postMessage(
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
    const endpoint = endpoints['SmartService_updateContacts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_updateContacts',
        tags: ['SmartService'],
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
          await services.controllers.smartServiceController.updateContacts(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['SmartService_advance'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_advance',
        tags: ['SmartService'],
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
          await services.controllers.smartServiceController.advance(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const definition = endpoints.SmartService_page;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_page',
        tags: ['SmartService'],
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
            await services.controllers.smartServiceController.listPage(
              c.get('user')!,
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.SmartService_stats;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_stats',
        tags: ['SmartService'],
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
            await services.controllers.smartServiceController.listStats(
              c.get('user')!,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.SmartService_detail;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'SmartService_detail',
        tags: ['SmartService'],
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
            await services.controllers.smartServiceController.detail(
              c.get('user')!,
              c.req.valid('param').id,
            ),
          ),
          200,
        ),
    );
  }
}
