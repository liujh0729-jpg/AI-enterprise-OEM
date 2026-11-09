import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { upstreamToken, baseDataToken } from '../../common/upstream-token';
import { errorResponse } from './common';

export function registerMarketBoardRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const endpoint = endpoints['MarketBoard_demands'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_demands',
        tags: ['MarketBoard'],
        request: { params: endpoint.params, query: endpoint.query },
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
        const result = await services.controllers.marketBoardController.demands(
          c.get('user')!,
          // 列表读取一律走基础数据通道（平台 Key，未配置回落本人）：含「我发布的」（按挂单号读回平台）。
          await baseDataToken(c),
          c.req.valid('param')['domain'],
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
          c.req.valid('query').cursor,
          c.req.valid('query').pageSize,
          c.req.valid('query')['subCategoryId'],
          c.req.valid('query')['scope'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_createDemand'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_createDemand',
        tags: ['MarketBoard'],
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
          await services.controllers.marketBoardController.createDemand(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_demandMessages'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_demandMessages',
        tags: ['MarketBoard'],
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
          await services.controllers.marketBoardController.demandMessages(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_updateDemand'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_updateDemand',
        tags: ['MarketBoard'],
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
        const result =
          await services.controllers.marketBoardController.updateDemand(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_removeDemand'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_removeDemand',
        tags: ['MarketBoard'],
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
          await services.controllers.marketBoardController.removeDemand(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_services'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_services',
        tags: ['MarketBoard'],
        request: { params: endpoint.params, query: endpoint.query },
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
          await services.controllers.marketBoardController.services(
            c.get('user')!,
            await baseDataToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('query')['province'],
            c.req.valid('query')['city'],
            c.req.valid('query').cursor,
            c.req.valid('query').pageSize,
            c.req.valid('query')['subCategoryId'],
            c.req.valid('query')['scope'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_marketplace'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_marketplace',
        tags: ['MarketBoard'],
        request: { params: endpoint.params, query: endpoint.query },
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
          await services.controllers.marketBoardController.marketplace(
            c.get('user')!,
            // 服务市集＝公开池（服务商列表数据），固定走平台 Key。
            await baseDataToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('query')['province'],
            c.req.valid('query')['city'],
            c.req.valid('query').cursor,
            c.req.valid('query').pageSize,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_createService'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_createService',
        tags: ['MarketBoard'],
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
          await services.controllers.marketBoardController.createService(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_updateService'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_updateService',
        tags: ['MarketBoard'],
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
        const result =
          await services.controllers.marketBoardController.updateService(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['MarketBoard_removeService'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_removeService',
        tags: ['MarketBoard'],
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
          await services.controllers.marketBoardController.removeService(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('param')['domain'],
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints.MarketBoard_demandDetail;
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_demandDetail',
        tags: ['MarketBoard'],
        request: { params: endpoint.params },
        responses: {
          200: {
            description: 'Listing details',
            content: { 'application/json': { schema: endpoint.response } },
          },
        },
      }),
      async (c) => {
        const params = c.req.valid('param');
        const result =
          await services.controllers.marketBoardController.demandDetail(
            c.get('user')!,
            await baseDataToken(c),
            params.domain,
            params.id,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints.MarketBoard_serviceDetail;
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_serviceDetail',
        tags: ['MarketBoard'],
        request: { params: endpoint.params },
        responses: {
          200: {
            description: 'Listing details',
            content: { 'application/json': { schema: endpoint.response } },
          },
        },
      }),
      async (c) => {
        const params = c.req.valid('param');
        const result =
          await services.controllers.marketBoardController.serviceDetail(
            c.get('user')!,
            await baseDataToken(c),
            params.domain,
            params.id,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints.MarketBoard_marketplaceDetail;
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'MarketBoard_marketplaceDetail',
        tags: ['MarketBoard'],
        request: { params: endpoint.params },
        responses: {
          200: {
            description: 'Listing details',
            content: { 'application/json': { schema: endpoint.response } },
          },
        },
      }),
      async (c) => {
        const params = c.req.valid('param');
        const result =
          await services.controllers.marketBoardController.marketplaceDetail(
            c.get('user')!,
            // 市集明细同为公开池数据，走平台 Key。
            await baseDataToken(c),
            params.domain,
            params.id,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }
}
