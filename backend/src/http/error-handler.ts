import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ErrorHandler } from 'hono';
import { z } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import type { ApiEnv } from './types';

/**
 * 契约层统一的校验失败响应：MCP 的 JSON-RPC 端点不经这套信封，
 * 但内部自执行器（agent app）要走，所以从 app.ts 里抽出来共用，避免两边各写一份。
 */
export function validationHook(
  result: { success: boolean },
  c: Context,
): Response | undefined {
  if (!result.success)
    return c.json(
      { code: 422, message: '请求参数格式不正确', data: null },
      422,
    );
  return undefined;
}

export const handleError: ErrorHandler<ApiEnv> = (error, c) => {
  if (error instanceof BusinessException)
    return new Response(
      JSON.stringify({
        code: error.errorCode.code,
        message: error.message,
        data: error.data,
      }),
      {
        status: error.errorCode.httpStatus,
        headers: { 'content-type': 'application/json' },
      },
    );
  if (error instanceof HTTPException && error.status < 500)
    return c.json(
      { code: error.status, message: '请求参数格式不正确', data: null },
      error.status,
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json(
      { code: 422, message: '请求参数格式不正确', data: null },
      422,
    );
  console.error(
    JSON.stringify({
      event: 'request_error',
      requestId: c.get('requestId'),
      type: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 4).join(' | '),
    }),
  );
  return c.json(
    { code: 500, message: '服务暂时不可用，请稍后重试', data: null },
    500,
  );
};
