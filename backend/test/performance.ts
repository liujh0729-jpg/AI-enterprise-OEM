import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sign } from 'jsonwebtoken';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeoSettingsService } from '../src/geo/geo-settings.service';
import { CurrentUser } from '../src/auth/current-user';
import { weekStartOf } from '../src/geo/geo-collection.service';

const database = new URL(process.env.DATABASE_URL || '');
assert.equal(database.hostname, '127.0.0.1');
assert.match(database.pathname, /^\/enterprise_migration_\d+_\d+$/);
assert.equal(process.env.ISOLATED_TEST, '1');
const runtime = resolve(
  process.env.ENTERPRISE_TEMP_DIR || '/Volumes/Projects/tmp',
  'enterprise-hono-migration/performance',
);
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const prisma = new PrismaService();
const children: ChildProcess[] = [];
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const port = Number(process.env.PERFORMANCE_API_PORT || 1696);
const base = `http://127.0.0.1:${port}`;
const headers = {
  authorization: `Bearer ${sign({ userId: 'isolated-owner', username: 'isolated-owner', type: 'access' }, process.env.JWT_SECRET!, { issuer: 'aipdd-java-core', expiresIn: 3600 })}`,
};
let modelCalls = 0,
  activeProjects = 0;
const model = createServer((req, res) => {
  void (async () => {
    for await (const chunk of req) void chunk;
    modelCalls++;
    await pause(100);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                brand_mentioned: 1,
                rank_position: 1,
                sentiment: '正面',
                citation_genre: '官网',
                excerpt: '隔离负载回答',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
  })().catch(() => {
    res.statusCode = 500;
    res.end();
  });
});
function child(file: string, name: string, ipc = false) {
  const fd = openSync(resolve(runtime, `${name}.log`), 'w', 0o600);
  const processHandle = spawn(
    process.execPath,
    file.endsWith('.ts') ? ['--import', 'tsx', file] : [file],
    {
      cwd: resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(name === 'baseline' ? port + 1 : port),
        DB_POOL_SIZE: name === 'worker' ? '4' : '10',
      },
      stdio: ipc ? ['ignore', fd, fd, 'ipc'] : ['ignore', fd, fd],
    },
  );
  children.push(processHandle);
  return processHandle;
}
async function request(path: string, origin = base) {
  const started = performance.now();
  const response = await fetch(origin + path, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, path);
  return {
    elapsedMs: performance.now() - started,
    bytes: Buffer.byteLength(text),
  };
}
const paths = [
  '/enterprise/me',
  '/enterprise/contracts?page=1&pageSize=20',
  '/enterprise/marketing/page?page=1&pageSize=20',
];
async function measure(rounds: number, origin = base, measuredPaths = paths) {
  const samples: Record<string, number[]> = Object.fromEntries(
    measuredPaths.map((path) => [path, []]),
  );
  for (let round = 0; round < rounds; round++) {
    for (const path of measuredPaths)
      samples[path].push((await request(path, origin)).elapsedMs);
    await pause(10);
  }
  return Object.fromEntries(
    measuredPaths.map((path) => {
      const values = samples[path].sort((a, b) => a - b);
      return [
        path,
        {
          samples: values.length,
          p50Ms: values[Math.ceil(values.length * 0.5) - 1],
          p95Ms: values[Math.ceil(values.length * 0.95) - 1],
        },
      ];
    }),
  );
}
function sqlCount(name = 'api') {
  let total = 0;
  for (const line of readFileSync(
    resolve(runtime, `${name}.log`),
    'utf8',
  ).split('\n')) {
    try {
      const entry: unknown = JSON.parse(line);
      if (
        entry &&
        typeof entry === 'object' &&
        'sqlQueriesTotal' in entry &&
        typeof entry.sqlQueriesTotal === 'number'
      )
        total = entry.sqlQueriesTotal;
    } catch {
      /* Startup messages are not metrics. */
    }
  }
  return total;
}
async function run() {
  await new Promise<void>((resolve, reject) => {
    const probe = createPortProbe();
    probe.once('error', () => reject(new Error('隔离压测端口已占用')));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
  await prisma.$connect();
  const enterprise = await prisma.enterpriseProfile.findFirstOrThrow({
    where: { userId: 'isolated-owner' },
  });
  for (let batch = 0; batch < 10; batch++)
    await prisma.marketingOrder.createMany({
      data: Array.from({ length: 400 }, (_, index) => ({
        orderNo: `perf-${batch}-${index}`,
        enterpriseId: index % 4 === 0 ? enterprise.id : 1000 + index,
        createdBy: index % 4 === 0 ? 'isolated-owner' : `tenant-${index}`,
        title: `Performance ${batch}-${index}`,
        description: '隔离负载文本'.repeat(200),
      })),
    });
  await prisma.$executeRawUnsafe('ANALYZE marketing_orders');
  const beforePlan =
    await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM marketing_orders WHERE enterprise_id = ${enterprise.id} ORDER BY id DESC LIMIT 20`;
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const address = model.address();
  assert(address && typeof address === 'object');
  const settings = new GeoSettingsService(prisma);
  for (const code of ['doubao', 'kimi'])
    await settings.save(
      new CurrentUser('isolated-admin', 'isolated-admin', 'admin'),
      code,
      {
        apiKey: 'isolated-model-key',
        model: 'isolated-model',
        baseUrl: `http://127.0.0.1:${address.port}`,
      },
    );
  for (const platform of ['豆包', 'Kimi']) {
    const project = await prisma.geoProject.create({
      data: {
        ownerUserId: 'isolated-owner',
        brand: '隔离负载品牌',
        note: 'isolated',
        industry: 'test',
        autoCollect: 1,
        platforms: [platform],
      },
    });
    const questions = await Promise.all(
      Array.from({ length: 120 }, (_, index) =>
        prisma.geoQuestion.create({
          data: { projectId: project.id, text: `隔离问题${index}` },
        }),
      ),
    );
    const run = await prisma.geoCollectRun.create({
      data: {
        projectId: project.id,
        weekStart: weekStartOf(new Date()),
        periodLabel: 'isolated-performance',
        planned: questions.length,
        status: 'PENDING',
      },
    });
    await prisma.geoCollectItem.createMany({
      data: questions.map((question) => ({
        runId: run.id,
        projectId: project.id,
        questionId: question.id,
        platform,
      })),
    });
  }
  const api = child('dist/main.js', 'api');
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      await request('/health/ready');
      ready = true;
      break;
    } catch {
      await pause(100);
    }
  }
  assert(ready && api.exitCode === null, '隔离 API 启动失败或端口被占用');
  await measure(50);
  const beforeIdleSql = sqlCount();
  const idle = await measure(250);
  await pause(20);
  const idleSqlQueries = sqlCount() - beforeIdleSql;
  const worker = child('test/performance-worker.ts', 'worker', true);
  worker.on('message', (message) => {
    if (
      message &&
      typeof message === 'object' &&
      'active' in message &&
      typeof message.active === 'number'
    )
      activeProjects = message.active;
  });
  for (let n = 0; n < 100 && activeProjects < 2; n++) await pause(100);
  assert.equal(activeProjects, 2, '负载 Worker 未同时执行两个项目');
  const startCalls = modelCalls;
  const beforeLoadedSql = sqlCount();
  const loaded = await measure(250);
  await pause(20);
  const loadedSqlQueries = sqlCount() - beforeLoadedSql;
  assert(modelCalls > startCalls, '采样期间没有模型调用');
  assert.equal(activeProjects, 2, '采样期间没有维持两个执行项目');
  worker.send('stop');
  await new Promise<void>((resolve) => {
    if (worker.exitCode !== null) {
      resolve();
      return;
    }
    worker.once('exit', () => resolve());
  });
  const legacy = [],
    paged = [];
  for (let index = 0; index < 20; index++) {
    legacy.push(await request('/enterprise/marketing'));
    paged.push(await request(paths[2]));
  }
  let baseline: {
    latency: Awaited<ReturnType<typeof measure>>;
    sqlQueries: number;
    comparison: Array<{
      path: string;
      baselinePath: string;
      p95Change: number;
    }>;
  } | null = null;
  if (process.env.PERFORMANCE_BASELINE_MAIN) {
    const legacyPaths = [paths[0], paths[1], '/enterprise/marketing'];
    const legacyBase = `http://127.0.0.1:${port + 1}`;
    await new Promise<void>((resolve, reject) => {
      const probe = createPortProbe();
      probe.once('error', () => reject(new Error('迁移前基线端口已占用')));
      probe.listen(port + 1, '127.0.0.1', () => probe.close(() => resolve()));
    });
    const baselineProcess = child(
      process.env.PERFORMANCE_BASELINE_MAIN,
      'baseline',
    );
    let legacyReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await request('/health/ready', legacyBase);
        legacyReady = true;
        break;
      } catch {
        await pause(100);
      }
    }
    assert(
      legacyReady && baselineProcess.exitCode === null,
      '迁移前基线未就绪',
    );
    await measure(50, legacyBase, legacyPaths);
    const beforeSql = sqlCount('baseline');
    const latency = await measure(250, legacyBase, legacyPaths);
    await pause(20);
    baseline = {
      latency,
      sqlQueries: sqlCount('baseline') - beforeSql,
      comparison: paths.map((path, index) => ({
        path,
        baselinePath: legacyPaths[index],
        p95Change: idle[path].p95Ms / latency[legacyPaths[index]].p95Ms - 1,
      })),
    };
    baselineProcess.kill('SIGTERM');
  }
  const requestMetrics: Record<
    string,
    { requests: number; dbCalls: number; upstreamCalls: number }
  > = {};
  for (const line of readFileSync(resolve(runtime, 'api.log'), 'utf8').split(
    '\n',
  )) {
    try {
      const entry: unknown = JSON.parse(line);
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('event' in entry) ||
        entry.event !== 'http' ||
        !('route' in entry) ||
        typeof entry.route !== 'string'
      )
        continue;
      const row = requestMetrics[entry.route] ?? {
        requests: 0,
        dbCalls: 0,
        upstreamCalls: 0,
      };
      row.requests++;
      if ('dbCallCount' in entry && typeof entry.dbCallCount === 'number')
        row.dbCalls += entry.dbCallCount;
      if ('upstreamCount' in entry && typeof entry.upstreamCount === 'number')
        row.upstreamCalls += entry.upstreamCount;
      requestMetrics[entry.route] = row;
    } catch {
      /* Ignore startup messages. */
    }
  }
  const report = {
    requestMetrics,
    sqlQueries: {
      idle: idleSqlQueries,
      loaded: loadedSqlQueries,
      note: 'Prisma 查询引擎事件计数；API 进程单独统计，不含 GEO Worker 的 SQL。每个采样阶段 750 次串行 API 请求。',
    },
    measuredAt: new Date().toISOString(),
    node: process.version,
    description:
      '隔离 PostgreSQL，4000 条需求，Hono API 与 GEO 独立进程，两个项目、真实事务、100 ms 模拟模型。' +
      (baseline
        ? '旧 Nest 快照复用相同数据库与模拟上游，查询事件仅添加计数观测；旧版本在新版本之后测量，存在顺序和预热偏差。'
        : '未传入旧 Nest 快照，全量查询对照仅比较当前 Hono 下的新旧查询路径。'),
    modelCalls: modelCalls - startCalls,
    baseline,
    idle,
    loaded,
    comparison: paths.map((path) => ({
      path,
      p95Increase: loaded[path].p95Ms / idle[path].p95Ms - 1,
      within20Percent: loaded[path].p95Ms <= idle[path].p95Ms * 1.2,
    })),
    listComparison: {
      legacy: {
        bytes: legacy[0].bytes,
        averageMs:
          legacy.reduce((sum, row) => sum + row.elapsedMs, 0) / legacy.length,
      },
      paged: {
        bytes: paged[0].bytes,
        averageMs:
          paged.reduce((sum, row) => sum + row.elapsedMs, 0) / paged.length,
      },
    },
    queryPlan: beforePlan,
  };
  writeFileSync(
    resolve(runtime, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ...report, queryPlan: undefined }, null, 2));
  console.log(`性能证据已保存：${resolve(runtime, 'report.json')}`);
  assert(
    report.comparison.every((row) => row.within20Percent),
    'GEO 负载下的 P95 增幅超过 20%，本轮性能验收未通过',
  );
}
void run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : '隔离压测失败');
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const processHandle of children)
      if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
    await Promise.all(
      children.map(
        (processHandle) =>
          new Promise<void>((resolve) => {
            if (processHandle.exitCode !== null) {
              resolve();
              return;
            }
            processHandle.once('exit', () => resolve());
            setTimeout(() => {
              processHandle.kill('SIGKILL');
              resolve();
            }, 3000).unref();
          }),
      ),
    );
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await prisma.$disconnect();
  });
