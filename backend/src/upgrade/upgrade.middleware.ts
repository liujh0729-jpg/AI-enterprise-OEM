import type { MiddlewareHandler } from 'hono';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import type { UpgradeJobService } from './upgrade-job.service';

/** 维护期间仍可用的路径：升级后台自身、AI 编程后台、会话/账户自助、健康检查。 */
const ALLOW_PREFIXES = [
  '/enterprise/admin/upgrade',
  '/enterprise/admin/ai-code',
  '/enterprise/session',
  '/enterprise/identity',
  '/enterprise/account',
  '/health',
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 升级维护闸：升级/还原任务创建时置位，runner 结束后由任务同步清除。
 * 维护期间读请求照常（旧进程仍在跑），写请求一律 503，避免迁移/还原过程中写入脏数据。
 */
export function maintenanceMiddleware(
  jobs: UpgradeJobService,
): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const state = await jobs.maintenance();
    if (!state.on) return next();
    if (SAFE_METHODS.has(context.req.method)) return next();
    if (ALLOW_PREFIXES.some((prefix) => context.req.path.startsWith(prefix))) {
      return next();
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      state.reason || '平台正在升级维护，请稍后重试',
    );
  };
}
