import { PrismaService } from '../src/prisma/prisma.service';
import { GeoSettingsService } from '../src/geo/geo-settings.service';
import { GeoCollectionService } from '../src/geo/geo-collection.service';
const database = new URL(process.env.DATABASE_URL || '');
if (
  database.hostname !== '127.0.0.1' ||
  !/^\/enterprise_migration_\d+_\d+$/.test(database.pathname) ||
  process.env.ISOLATED_TEST !== '1'
)
  throw new Error('负载 Worker 只允许自身隔离库');
process.env.SERVICE_ROLE = 'geo-worker';
const prisma = new PrismaService();
const collection = new GeoCollectionService(
  prisma,
  new GeoSettingsService(prisma),
);
// 测试入口只扩展采集窗口；执行、租约、模型协议和事务全部使用正式实现。
const internals = collection as unknown as {
  executeRun(id: number, window: { start: Date; end: Date }): Promise<void>;
};
let stopping = false;
async function run() {
  const runs = await prisma.geoCollectRun.findMany({
    where: { status: 'PENDING' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const loop = async (id: number) => {
    while (!stopping) {
      await internals.executeRun(id, {
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 600000),
      });
      const run = await prisma.geoCollectRun.findUniqueOrThrow({
        where: { id },
      });
      if (!['PENDING', 'RUNNING'].includes(run.status)) break;
    }
  };
  const tasks = Promise.all(runs.map((run) => loop(run.id)));
  const timer = setInterval(
    () => process.send?.({ type: 'status', ...collection.workerStatus }),
    100,
  );
  process.on('message', (message) => {
    if (message === 'stop') {
      stopping = true;
      void collection.stop(1000);
    }
  });
  try {
    await tasks;
  } finally {
    clearInterval(timer);
    await prisma.$disconnect();
    process.disconnect?.();
  }
}
void run().catch(() => {
  console.error('隔离负载 Worker 失败');
  process.exit(1);
});
