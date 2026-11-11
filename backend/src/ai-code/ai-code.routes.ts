import type { Context } from 'hono';
import { readFileSync } from 'node:fs';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { withoutRequestAbort } from '../common/request-context';
import { upstreamTokenOrNull } from '../common/upstream-token';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

/** SSE 保活：必须小于反向代理空闲超时（Next dev 30 秒 / Nginx 60 秒）。 */
const SSE_HEARTBEAT_MS = 10_000;

/**
 * AI 编程的非契约路由：SSE 对话流、附件上传、附件 / 补丁包下载。
 * 这三个都不适合用 JSON 契约描述（流式 / multipart / 二进制），单独登记在同一分组内。
 */
export function registerAiCodeRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const controller = services.controllers.aiCodeController;

  app.post(
    '/enterprise/admin/ai-code/sessions/:id/messages',
    async (context: Context<ApiEnv>) => {
      const user = context.get('user')!;
      const token = await upstreamTokenOrNull(context);
      const id = context.req.param('id')!;
      const body = await context.req
        .json<Record<string, unknown>>()
        .catch(() => ({}));
      return streamSSE(context, async (stream) => {
        const emit = async (event: string, data: Record<string, unknown>) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        };
        const heartbeat = setInterval(() => {
          void stream.write(': ping\n\n').catch(() => undefined);
        }, SSE_HEARTBEAT_MS);
        try {
          await withoutRequestAbort(() =>
            controller.chat(user, token ?? undefined, id, body, emit),
          );
        } catch (error) {
          const message =
            error instanceof BusinessException
              ? error.message
              : '对话失败，请稍后重试';
          await emit('error', { message });
        } finally {
          clearInterval(heartbeat);
        }
      });
    },
  );

  app.post(
    '/enterprise/admin/ai-code/sessions/:id/upload',
    async (context: Context<ApiEnv>) => {
      const user = context.get('user')!;
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要上传的文件',
        );
      }
      const result = await controller.upload(
        user,
        context.req.param('id')!,
        file,
      );
      return context.json({ code: 0, message: 'ok', data: result });
    },
  );

  app.get(
    '/enterprise/admin/ai-code/sessions/:id/uploads/:name',
    (context: Context<ApiEnv>) => {
      const target = controller.readUpload(
        context.get('user')!,
        context.req.param('id')!,
        context.req.param('name')!,
      );
      const bytes = readFileSync(target);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    },
  );

  app.get(
    '/enterprise/admin/ai-code/exports/:name',
    (context: Context<ApiEnv>) => {
      const name = context.req.param('name')!;
      const target = controller.readExport(context.get('user')!, name);
      const bytes = readFileSync(target);
      const filename = encodeURIComponent(name);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        },
      });
    },
  );
}
