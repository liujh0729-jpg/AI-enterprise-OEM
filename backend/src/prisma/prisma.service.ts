import { Prisma, PrismaClient } from '../../generated/prisma';
import {
  clearRequestMemo,
  isIdentityWrite,
  currentRequest,
} from '../common/request-context';
export class PrismaService extends PrismaClient<
  Prisma.PrismaClientOptions,
  'query'
> {
  private queryCount = 0;
  private queryMs = 0;
  get databaseMetrics() {
    return { queryCount: this.queryCount, queryMs: this.queryMs };
  }
  constructor() {
    const configured = process.env.DATABASE_URL;
    let url = configured;
    if (configured) {
      const value = new URL(configured);
      value.searchParams.set(
        'connection_limit',
        process.env.DB_POOL_SIZE ||
          (process.env.SERVICE_ROLE === 'geo-worker' ? '4' : '10'),
      );
      value.searchParams.set('pool_timeout', '10');
      url = value.toString();
    }
    super({
      log: [{ emit: 'event', level: 'query' }],
      datasources: {
        db: { url },
      },
    });
    this.$on('query', (event) => {
      this.queryCount++;
      this.queryMs += event.duration;
    });
    // 身份表一写即作废本请求的身份缓存：刚备案/绑定完的判定不能读到旧值
    this.$use(async (params, next) => {
      if (isIdentityWrite(params.model, params.action)) {
        clearRequestMemo();
      }
      const started = performance.now();
      try {
        const result: unknown = await next(params);
        // 写入期间若有并行读取，可能重新填入旧快照；提交后再次作废。
        if (isIdentityWrite(params.model, params.action)) clearRequestMemo();
        return result;
      } finally {
        const elapsedMs = performance.now() - started;
        const request = currentRequest();
        if (request) {
          request.metrics.dbCallCount++;
          request.metrics.dbMs += elapsedMs;
        }
        if (elapsedMs > Number(process.env.SLOW_QUERY_MS || 500))
          console.warn(
            JSON.stringify({
              event: 'slow_query',
              requestId: request?.requestId,
              model: params.model,
              action: params.action,
              elapsedMs: Math.round(elapsedMs),
            }),
          );
      }
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
