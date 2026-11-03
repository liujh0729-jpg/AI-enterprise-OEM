import { ok } from './common/api';
import { PrismaService } from './prisma/prisma.service';
import { aiworkinEnabled } from './aiworkin/aiworkin.config';
const HEALTH_CHECK_TIMEOUT_MS = 2000;
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  health() {
    return ok({ status: 'up', service: 'aiworkin-enterprise' });
  }
  version() {
    return ok({
      service: 'aiworkin-enterprise',
      commit: process.env.ENTERPRISE_RELEASE_COMMIT || 'unknown',
      aiworkin_enabled: aiworkinEnabled(),
    });
  }
  async ready() {
    const database = await dependencyStatus(() =>
      this.prisma.$queryRawUnsafe('SELECT 1'),
    );
    const ready = database === 'up';
    return ok({
      status: ready ? 'ready' : 'not_ready',
      checks: { database },
    });
  }
}
async function dependencyStatus(action: () => Promise<unknown>) {
  try {
    await withTimeout(action(), HEALTH_CHECK_TIMEOUT_MS);
    return 'up' as const;
  } catch {
    return 'down' as const;
  }
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('health check timed out')),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
