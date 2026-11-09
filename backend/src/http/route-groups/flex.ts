import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { endpoints } from '@enterprise/contracts';
import type { Services } from '../services';
import type { ApiEnv } from '../types';
import { serializeResponse } from '../response';
import { upstreamToken } from '../../common/upstream-token';
import { errorResponse } from './common';

export function registerFlexRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  {
    const definition = endpoints.Flex_onboardingPage;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_onboardingPage',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Page',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.onboardingPage(
              c.get('user')!,
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_onboardingStats;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_onboardingStats',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Stats',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.onboardingStats(
              c.get('user')!,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_payrollPage;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_payrollPage',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Page',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.payrollPage(
              c.get('user')!,
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_payrollStats;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_payrollStats',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Stats',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.payrollStats(
              c.get('user')!,
            ),
          ),
          200,
        ),
    );
  }

  {
    const endpoint = endpoints['Flex_providers'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_providers',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.providers(
          c.req.valid('query')['recordType'],
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
    const endpoint = endpoints['Flex_createProvider'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_createProvider',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.createProvider(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_updateProvider'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_updateProvider',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.updateProvider(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_removeProvider'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_removeProvider',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.removeProvider(
          c.get('user')!,
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_onboardings'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_onboardings',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.onboardings(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_createOnboarding'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_createOnboarding',
        tags: ['Flex'],
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
          await services.controllers.flexController.createOnboarding(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_uploadOnboardingAttachments'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_uploadOnboardingAttachments',
        tags: ['Flex'],
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
          await services.controllers.flexController.uploadOnboardingAttachments(
            c.get('user')!,
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_auditOnboarding'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_auditOnboarding',
        tags: ['Flex'],
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
          await services.controllers.flexController.auditOnboarding(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_workOrders'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_workOrders',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.workOrders(
          c.get('user')!,
          c.req.valid('query')['province'],
          c.req.valid('query')['city'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_createWorkOrder'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_createWorkOrder',
        tags: ['Flex'],
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
          await services.controllers.flexController.createWorkOrder(
            c.get('user')!,
            await upstreamToken(c),
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_match'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_match',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.match(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_messages'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_messages',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.messages(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_postMessage'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_postMessage',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.postMessage(
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
    const endpoint = endpoints['Flex_candidates'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_candidates',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.candidates(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_settlements'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_settlements',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.settlements(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_publish'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_publish',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.publish(
          c.get('user')!,
          await upstreamToken(c),
          c.req.valid('param')['id'],
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_updateWorkOrder'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_updateWorkOrder',
        tags: ['Flex'],
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
          await services.controllers.flexController.updateWorkOrder(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_removeWorkOrder'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_removeWorkOrder',
        tags: ['Flex'],
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
          await services.controllers.flexController.removeWorkOrder(
            c.get('user')!,
            c.req.valid('param')['id'],
          );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_updateWorkOrderContacts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_updateWorkOrderContacts',
        tags: ['Flex'],
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
          await services.controllers.flexController.updateWorkOrderContacts(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_updateOnboardingContacts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_updateOnboardingContacts',
        tags: ['Flex'],
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
          await services.controllers.flexController.updateOnboardingContacts(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_updatePayrollContacts'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_updatePayrollContacts',
        tags: ['Flex'],
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
          await services.controllers.flexController.updatePayrollContacts(
            c.get('user')!,
            c.req.valid('param')['id'],
            c.req.valid('json'),
          );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_payrolls'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_payrolls',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.payrolls(
          c.get('user')!,
        );
        return c.json(serializeResponse(endpoint.response, result), 200);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_createPayroll'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_createPayroll',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.createPayroll(
          c.get('user')!,
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const endpoint = endpoints['Flex_auditPayroll'];
    app.openapi(
      createRoute({
        method: endpoint.method,
        path: endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_auditPayroll',
        tags: ['Flex'],
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
        const result = await services.controllers.flexController.auditPayroll(
          c.get('user')!,
          c.req.valid('param')['id'],
          c.req.valid('json'),
        );
        return c.json(serializeResponse(endpoint.response, result), 201);
      },
    );
  }

  {
    const definition = endpoints.Flex_page;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_page',
        tags: ['Flex'],
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
            await services.controllers.flexController.listPage(
              c.get('user')!,
              c.req.valid('query'),
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_stats;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_stats',
        tags: ['Flex'],
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
            await services.controllers.flexController.listStats(c.get('user')!),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_detail;
    app.openapi(
      createRoute({
        method: 'get',
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_detail',
        tags: ['Flex'],
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
            await services.controllers.flexController.detail(
              c.get('user')!,
              c.req.valid('param').id,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_onboardingDetail;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_onboardingDetail',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Detail',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.onboardingDetail(
              c.get('user')!,
              c.req.valid('param').id,
            ),
          ),
          200,
        ),
    );
  }

  {
    const definition = endpoints.Flex_payrollDetail;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId: 'Flex_payrollDetail',
        tags: ['Flex'],
        request: { params: definition.params, query: definition.query },
        responses: {
          200: {
            description: 'Detail',
            content: { 'application/json': { schema: definition.response } },
          },
        },
      }),
      async (c) =>
        c.json(
          serializeResponse(
            definition.response,
            await services.controllers.flexController.payrollDetail(
              c.get('user')!,
              c.req.valid('param').id,
            ),
          ),
          200,
        ),
    );
  }
}
