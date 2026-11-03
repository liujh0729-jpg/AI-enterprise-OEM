import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * 请求级记忆：一次请求内重复的身份判定只查一轮库。
 *
 * 关键约束：**只在单个请求内存活，绝不跨请求 TTL**——备案/绑定刚改完就要立刻生效，
 * 因此任何写入身份表的操作都会由 Prisma 中间件调用 `clearRequestMemo()` 作废缓存
 * （见 `PrismaService` 的 `$use`）。不在请求上下文内（定时任务、脚本）时完全不缓存。
 */
interface RequestStore {
  memo: Map<string, Promise<unknown>>;
  requestId?: string;
  signal?: AbortSignal;
  metrics: {
    dbCallCount: number;
    dbMs: number;
    upstreamCount: number;
    upstreamMs: number;
    sessionRefreshMs?: number;
  };
}
const storage = new AsyncLocalStorage<RequestStore>();
/** 包裹一次请求（`main.ts` 的最外层中间件调用）。 */
export function runInRequestContext<T>(
  fn: () => T,
  context: { requestId?: string; signal?: AbortSignal } = {},
): T {
  return storage.run(
    {
      memo: new Map(),
      metrics: { dbCallCount: 0, dbMs: 0, upstreamCount: 0, upstreamMs: 0 },
      ...context,
    },
    fn,
  );
}
/**
 * 测量开关：`REQUEST_MEMO=off` 时请求内记忆全部旁路（只用于对照每请求的数据库往返次数，
 * 见 scripts/tmp 的用法与 `docs/stack.md`）。默认不开。
 */
function memoDisabled() {
  return process.env.REQUEST_MEMO === 'off';
}
/**
 * 请求内记忆一次取数：同 key 的并发/串行调用共用同一个 Promise。
 * 失败时逐出，避免把同一次故障固化到本请求剩余流程。
 */
export function requestMemo<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const memo = memoDisabled() ? undefined : storage.getStore()?.memo;
  if (!memo) return loader();
  const cached = memo.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const pending = loader().catch((error) => {
    memo.delete(key);
    throw error;
  });
  memo.set(key, pending);
  return pending;
}
/** 身份相关写入后作废本请求缓存：后续判定重新查库。 */
export function clearRequestMemo() {
  storage.getStore()?.memo.clear();
}
/** 身份判定及完整身份快照的依据表：写入后须重新读取。 */
const IDENTITY_MODELS = new Set([
  'EnterpriseProfile',
  'ProviderApplication',
  'StaffProfile',
  'ProviderStaff',
  'IdentityPreference',
  'UserDirectory',
  'SystemSetting',
]);
const WRITE_ACTION_PREFIX = /^(create|update|upsert|delete|write)/;
/** 按前缀判定写操作：不依赖 Prisma 内部 action 的精确拼写（update / updateOne / updateMany…）。 */
export function isIdentityWrite(model: unknown, action: unknown) {
  return (
    typeof model === 'string' &&
    IDENTITY_MODELS.has(model) &&
    typeof action === 'string' &&
    WRITE_ACTION_PREFIX.test(action)
  );
}

export const currentRequest = () => storage.getStore();

/**
 * 长任务脱钩：暂时抹掉当前请求上的连接信号。
 * SSE 对话动辄几分钟，浏览器断线或前端空闲兜底不该把跑到一半的生成作废——
 * 单轮对话的生命周期只由「停止」按钮（cancel 端点）决定，结果照常落库。
 * 其余上下文（requestId / 记忆 / 计数）原样沿用。
 */
export function withoutRequestAbort<T>(fn: () => T): T {
  const store = storage.getStore();
  if (!store) return fn();
  return storage.run({ ...store, signal: undefined }, fn);
}
