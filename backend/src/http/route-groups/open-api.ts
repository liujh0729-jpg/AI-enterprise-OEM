import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { errorResponse } from './common';

export function registerOpenApiRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const endpoint = endpoints['OpenApi_me'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_me',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.me(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_roles'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_roles',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.roles(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_switchRole'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_switchRole',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.switchRole(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_contractsList'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_contractsList',
        tags: ['OpenApi'],
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
        const result =
          await services.controllers.openApiController.contractsList(
            c.get('user')!,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_createContract'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_createContract',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.createContract(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_confirm'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_confirm',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.confirm(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_terminate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_terminate',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.terminate(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_taxList'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_taxList',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.taxList(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_taxCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_taxCreate',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.taxCreate(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_overseasList'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_overseasList',
        tags: ['OpenApi'],
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
        const result =
          await services.controllers.openApiController.overseasList(
            c.get('user')!,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_overseasCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_overseasCreate',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.overseasCreate(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_logisticsList'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_logisticsList',
        tags: ['OpenApi'],
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
        const result =
          await services.controllers.openApiController.logisticsList(
            c.get('user')!,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_logisticsCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_logisticsCreate',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.logisticsCreate(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_logisticsMessages'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_logisticsMessages',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.logisticsMessages(
            c.get('user')!,
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_lawyers'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_lawyers',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.lawyers(
          c.req.valid('query')['kind'],
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
          c.req.valid('query')['keyword'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_legalCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_legalCreate',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.legalCreate(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_agencies'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_agencies',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.agencies(
          c.req.valid('query')['kind'],
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
          c.req.valid('query')['keyword'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_ipCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_ipCreate',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.ipCreate(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_ipConsult'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_ipConsult',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.ipConsult(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexProviders'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexProviders',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.flexProviders(
            c.req.valid('query')['record_type'],
            c.req.valid('query')['province'],
            c.req.valid('query')['city'],
            c.req.valid('query')['keyword'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexOrder'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexOrder',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.flexOrder(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexOrderGet'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexOrderGet',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.flexOrderGet(
            c.get('user')!,
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexMatch'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexMatch',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.flexMatch(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexOnboard'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexOnboard',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.flexOnboard(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_flexOnboardList'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_flexOnboardList',
        tags: ['OpenApi'],
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
        const result =
          await services.controllers.openApiController.flexOnboardList(
            c.get('user')!,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_thinkTankExperts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_thinkTankExperts',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.thinkTankExperts(
            c.req.valid('query')['kind'],
            c.req.valid('query')['province'],
            c.req.valid('query')['city'],
            c.req.valid('query')['keyword'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_thinkTankRequests'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_thinkTankRequests',
        tags: ['OpenApi'],
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
        const result =
          await services.controllers.openApiController.thinkTankRequests(
            c.get('user')!,
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_thinkTankCreate'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_thinkTankCreate',
        tags: ['OpenApi'],
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
          await services.controllers.openApiController.thinkTankCreate(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_keys'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_keys',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.keys(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_syncKey'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_syncKey',
        tags: ['OpenApi'],
        request: {},
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
        const result = await services.controllers.openApiController.syncKey(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['OpenApi_keyUsage'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'OpenApi_keyUsage',
        tags: ['OpenApi'],
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
        const result = await services.controllers.openApiController.keyUsage(
          c.get('user')!,
          c.req.valid('param')['keyId'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }
}
