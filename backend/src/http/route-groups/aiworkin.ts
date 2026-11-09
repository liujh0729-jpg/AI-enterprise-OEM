import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { upstreamToken } from '../../common/upstream-token';
import { errorResponse } from './common';

export function registerAiworkinRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  // Aiworkin_listApiKeys / Aiworkin_createApiKey 两个路由随「代平台申 Key」功能取消（设计 3.5）：
  // 本系统只保留本地 ek_ APIKey（Identity_createKey）与 AIPDD APIKey 绑定自助。
  {
    const endpoint = endpoints['Aiworkin_status'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_status',
        tags: ['Aiworkin'],
        request: {},
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
      (c) => {
        const result = services.controllers.aiworkinController.status();
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_categories'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_categories',
        tags: ['Aiworkin'],
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
      (c) => {
        const result = services.controllers.aiworkinController.categories(
          c.req.valid('query')['domain'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_myDemands'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_myDemands',
        tags: ['Aiworkin'],
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
        const result = await services.controllers.aiworkinController.myDemands(
          await upstreamToken(c),
          c.req.valid('query')['page'],
          c.req.valid('query')['pageSize'],
          c.req.valid('query')['direction'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_marketListings'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_marketListings',
        tags: ['Aiworkin'],
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
        const result =
          await services.controllers.aiworkinController.marketListings(
            await upstreamToken(c),
            c.req.valid('query')['page'],
            c.req.valid('query')['pageSize'],
            c.req.valid('query')['direction'],
            c.req.valid('query')['keyword'],
            c.req.valid('query')['category'],
            c.req.valid('query')['province'],
            c.req.valid('query')['city'],
            c.req.valid('query')['status'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_demandDetail'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_demandDetail',
        tags: ['Aiworkin'],
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
          await services.controllers.aiworkinController.demandDetail(
            await upstreamToken(c),
            c.req.valid('param')['listingId'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_publishDemand'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_publishDemand',
        tags: ['Aiworkin'],
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
        const result =
          await services.controllers.aiworkinController.publishDemand(
            await upstreamToken(c),
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_removeDemand'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_removeDemand',
        tags: ['Aiworkin'],
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
          await services.controllers.aiworkinController.removeDemand(
            await upstreamToken(c),
            c.req.valid('param')['listingId'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_demandConversations'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_demandConversations',
        tags: ['Aiworkin'],
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
          await services.controllers.aiworkinController.demandConversations(
            await upstreamToken(c),
            c.req.valid('param')['listingId'],
            c.req.valid('query')['page'],
            c.req.valid('query')['pageSize'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_conversations'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_conversations',
        tags: ['Aiworkin'],
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
        const result =
          await services.controllers.aiworkinController.conversations(
            await upstreamToken(c),
            c.req.valid('query')['page'],
            c.req.valid('query')['pageSize'],
            c.req.valid('query')['matchRunId'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_conversation'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_conversation',
        tags: ['Aiworkin'],
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
          await services.controllers.aiworkinController.conversation(
            await upstreamToken(c),
            c.req.valid('param')['conversationId'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_reply'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_reply',
        tags: ['Aiworkin'],
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
        const result = await services.controllers.aiworkinController.reply(
          await upstreamToken(c),
          c.req.valid('param')['conversationId'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_profile'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_profile',
        tags: ['Aiworkin'],
        request: {},
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
        const result = await services.controllers.aiworkinController.profile(
          await upstreamToken(c),
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Aiworkin_saveProfile'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Aiworkin_saveProfile',
        tags: ['Aiworkin'],
        request: {
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
          await services.controllers.aiworkinController.saveProfile(
            await upstreamToken(c),
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }
}
