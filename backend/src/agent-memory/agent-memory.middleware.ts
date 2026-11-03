import type { MiddlewareHandler } from 'hono';
import { BusinessException } from '../common/business.exception';
import { bearerApiKey } from '../mcp/mcp-auth';
import type { AgentMemoryService } from './agent-memory.service';
import {
  lastPathParam,
  readOutcome,
  readTarget,
  resolveWriteIntent,
  sanitizeParams,
  truncate,
} from './agent-intent';
import type { ApiEnv } from '../http/types';

/** 响应信封是小对象；超过这个长度说明不是标准写响应，不去读它。 */
const MAX_ENVELOPE_BYTES = 64 * 1024;

type AgentChannel = 'web' | 'machine' | 'mcp' | 'scheduler';

function isMachineChannel(path: string, apiKeyHeader?: string) {
  return path.startsWith('/api/v1/') || Boolean(apiKeyHeader);
}

function canonical(c: { req: { path: string } }) {
  return c.req.path.replace(/^\/api\/backend(?=\/|$)/, '') || '/';
}

async function readEnvelope(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return undefined;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_ENVELOPE_BYTES) return undefined;
  return (await response
    .clone()
    .json()
    .catch(() => undefined)) as Record<string, unknown> | undefined;
}

/**
 * 意图中间件：挂在鉴权之后、业务路由之前，全站写请求只在这一处埋点。
 * 业务服务一律不调用它，也不各自写记忆——新增接口只要在契约里出现就自动进记忆。
 */
export function agentIntentMiddleware(
  memory: AgentMemoryService,
  options?: { channel?: AgentChannel },
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const path = canonical(c);
    const intent = user ? resolveWriteIntent(c.req.method, path) : undefined;
    if (!user || !intent) return next();

    const type = c.req.header('content-type') ?? '';
    const body = type.includes('application/json')
      ? await c.req.json<Record<string, unknown>>().catch(() => undefined)
      : undefined;
    const base = {
      userId: user.userId,
      domain: intent.domain,
      action: intent.operationId,
      method: c.req.method.toUpperCase(),
      path,
      targetType: intent.targetType,
      params: sanitizeParams(body),
      channel:
        options?.channel ??
        (isMachineChannel(
          path,
          c.req.header('x-api-key') ??
            bearerApiKey(c.req.header('authorization')),
        )
          ? ('machine' as const)
          : ('web' as const)),
    };

    try {
      await next();
    } catch (error) {
      const business = error instanceof BusinessException;
      const status = business ? error.errorCode.httpStatus : 500;
      await memory.record({
        ...base,
        targetId: lastPathParam(intent.pathParams),
        targetLabel: '',
        outcome: status === 403 ? 'blocked' : 'failed',
        errorCode: business ? String(error.errorCode.code) : String(status),
        errorMessage: business
          ? truncate(error.message, 500)
          : truncate(error instanceof Error ? error.name : 'unknown', 500),
      });
      throw error;
    }

    const envelope = await readEnvelope(c.res);
    const outcome = readOutcome(c.res.status, envelope);
    const target = readTarget(envelope?.data);
    await memory.record({
      ...base,
      targetId: target.id || lastPathParam(intent.pathParams),
      targetLabel: target.label,
      outcome: outcome.outcome,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    });
  };
}
