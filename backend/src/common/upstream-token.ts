import type { Context } from 'hono';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
import { requestMemo } from './request-context';

/**
 * 上游凭证解析器（设计文档 3.3：全系统唯一入口）。
 * 业务代码不再直接把「本系统会话令牌」当上游凭证，而是经这里换成用户绑定的
 * AIPDD APIKey（解密后即用即弃）；未绑定用户触发上游动作时给出引导性 403。
 * 解析结果按请求缓存（requestMemo），同一请求多次消费只查一次库。
 */
type Resolver = (userId: string) => Promise<string>;
let resolver: Resolver | null = null;
let baseResolver: Resolver | null = null;

/** 应用装配时注册（app.ts：接 AipddKeyService.resolveToken）。 */
export function registerUpstreamTokenResolver(fn: Resolver) {
  resolver = fn;
}

/**
 * 基础数据凭证解析器（app.ts：接 AipddKeyService.baseDataToken）。
 * 省市字典、平台字典项这类「参照数据」与用户身份无关，平台 Key 优先，
 * 未配置平台 Key 时才回落本人绑定的 Key，避免未绑 Key 的用户被 403 拦住填不了表单。
 */
export function registerBaseDataTokenResolver(fn: Resolver) {
  baseResolver = fn;
}

/** 取当前登录用户 id；未登录 → 401。 */
function currentUserId(c: Context): string {
  const user = c.get('user') as { userId?: string } | undefined;
  if (!user?.userId)
    throw new BusinessException(ErrorCode.UNAUTHORIZED, '请先登录');
  return user.userId;
}

/** 取当前登录用户绑定的上游 Bearer 令牌；未绑定 → 403「请先绑定」。 */
export async function upstreamToken(c: Context): Promise<string> {
  const userId = currentUserId(c);
  if (!resolver)
    throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, '凭证解析器未初始化');
  return requestMemo(`upstream-token:${userId}`, () => resolver!(userId));
}

/** 有会话且已绑定才返回令牌；未绑定返回空串（供「可选同步」场景，如供求广场本地发布）。 */
export async function upstreamTokenOrNull(c: Context): Promise<string> {
  try {
    return await upstreamToken(c);
  } catch (error) {
    if (error instanceof BusinessException && error.errorCode === ErrorCode.FORBIDDEN)
      return '';
    throw error;
  }
}

/** 基础数据令牌：平台 Key 优先，未配置时回落用户 Key；两者都没有 → 403 引导绑定。 */
export async function baseDataToken(c: Context): Promise<string> {
  const userId = currentUserId(c);
  if (!baseResolver)
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '凭证解析器未初始化',
    );
  return requestMemo(`base-data-token:${userId}`, () => baseResolver!(userId));
}

/**
 * 基础数据「可选令牌」：既无平台 Key 也未绑定用户 Key 时返回空串，
 * 由调用方回落本地内置字典（参照数据不该阻塞省市/字典下拉）。
 */
export async function baseDataTokenOrNull(c: Context): Promise<string> {
  try {
    return await baseDataToken(c);
  } catch (error) {
    if (
      error instanceof BusinessException &&
      error.errorCode === ErrorCode.FORBIDDEN
    )
      return '';
    throw error;
  }
}
