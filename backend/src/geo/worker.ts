import '../config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { validateConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { GeoSettingsService } from './geo-settings.service';
import { GeoCollectionService } from './geo-collection.service';
import { GeoCollectionScheduler } from './geo-collection.scheduler';
import { modelMetrics } from './metrics';

async function start() {
  process.env.SERVICE_ROLE = 'geo-worker';
  validateConfig();
  const prisma = new PrismaService();
  await prisma.$connect();
  const collection = new GeoCollectionService(
    prisma,
    new GeoSettingsService(prisma),
  );
  const scheduler = new GeoCollectionScheduler(collection);
  scheduler.onModuleInit();
  const app = new Hono();
  let stopping = false;
  app.get('/health', (c) =>
    c.json(
      {
        status: stopping ? 'stopping' : 'alive',
        ...collection.workerStatus,
        memoryRss: process.memoryUsage().rss,
        models: modelMetrics(),
        database: prisma.databaseMetrics,
      },
      stopping ? 503 : 200,
    ),
  );
  app.get('/health/ready', async (c) => {
    const backlog = await prisma.geoCollectItem.count({
      where: { status: 'PENDING' },
    });
    return c.json(
      {
        status: stopping ? 'stopping' : 'alive',
        ...collection.workerStatus,
        backlog,
      },
      stopping ? 503 : 200,
    );
  });
  const server = serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: Number(process.env.GEO_WORKER_PORT || 1695),
  });
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const forced = setTimeout(() => process.exit(1), 65000);
    forced.unref();
    scheduler.onModuleDestroy();
    try {
      await collection.stop(60000);
    } catch {
      process.exitCode = 1;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
      clearTimeout(forced);
    }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
void start().catch(() => {
  console.error('GEO Worker 启动失败，请检查配置和数据库连接');
  process.exitCode = 1;
});
