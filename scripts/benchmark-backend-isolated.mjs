/** Production-build comparison. Creates/drops only its own localhost database; never reads .env. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'backend/package.json'));
const { sign } = require('jsonwebtoken');
assert(Number(process.versions.node.split('.')[0]) >= 24, '请使用 Node.js 24 或更新版本');
const quick = process.argv.includes('--quick');
const diagnostic = process.argv.includes('--memory-diagnostic');
const focused = process.argv.includes('--focused');
const guardCpu = !quick && !diagnostic;
const baseline = resolve(process.env.BENCHMARK_NEST_ROOT || '/Volumes/Projects/tmp/enterprise-nest-baseline-20261023/backend');
assert(existsSync(join(baseline, 'src/main.ts')), '缺少迁移前 Nest 源码快照');
assert(JSON.parse(readFileSync(join(baseline, 'package.json'))).dependencies['@nestjs/core'], '基线必须为 Nest 快照');
const runtime = mkdtempSync('/Volumes/Projects/tmp/enterprise-backend-benchmark-');
mkdirSync(join(runtime, 'harness'));
for (const file of ['benchmark-backend-isolated.mjs', 'benchmark-backend-observer.cjs']) cpSync(join(root, 'scripts', file), join(runtime, 'harness', file));
const observer = diagnostic ? join(runtime, 'gc-observer.cjs') : join(runtime, 'harness/benchmark-backend-observer.cjs');
if (diagnostic) writeFileSync(observer, `require(${JSON.stringify(join(runtime, 'harness/benchmark-backend-observer.cjs'))});\nprocess.on('message', message => { if (message === 'force-gc') global.gc(); });\n`);
const database = `enterprise_benchmark_${Date.now()}_${process.pid}_${randomBytes(4).toString('hex')}`;
const db = new URL(`postgresql://127.0.0.1:5432/${database}?schema=public&connection_limit=10&pool_timeout=10`);
db.username = os.userInfo().username;
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const jwtSecret = randomBytes(32).toString('hex');
const env = {
  ...baseEnv, TMPDIR: runtime, NODE_ENV: 'production', DATABASE_URL: db.toString(),
  JWT_SECRET: jwtSecret, JWT_ISSUER: 'aipdd-java-core', EXTERNAL_CRED_KEY: randomBytes(32).toString('hex'),
  HOST: '127.0.0.1', DB_POOL_SIZE: '10', AIWORKIN_ENABLED: 'false',
  GEO_AUTO_COLLECT_DISABLED: '1', DEV_AUTO_LOGIN: 'false', ISOLATED_BENCHMARK: '1',
};
let created = false;
let prisma;
let stopRequested = false;
const children = new Set();
const cleanup = { databaseDropped: false, apiProcessesStopped: false, mockStopped: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopRequested = true; });
function checkStop() { assert(!stopRequested, '压测已取消，正在清理隔离资源'); }
function externalBuildCpu() {
  const ignored = new Set([process.pid, ...[...children].map(handle => handle.child.pid)]);
  const output = spawnSync('ps', ['-Ao', 'pid=,pcpu=,comm='], { encoding: 'utf8' }).stdout || '';
  return output.split('\n').reduce((sum, line) => {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!match || ignored.has(Number(match[1])) || !/(?:^|\/)(?:node|java|tsc|rustc|clang)(?:\s|$)/.test(match[3])) return sum;
    return sum + Number(match[2]);
  }, 0);
}
async function quietBuildWindow() {
  if (!guardCpu) return;
  const started = performance.now();
  let quietSince = null;
  let announced = false;
  while (performance.now() - started < 180000) {
    checkStop();
    const cpu = externalBuildCpu();
    if (cpu <= 30) quietSince ??= performance.now();
    else {
      quietSince = null;
      if (!announced) { console.log('等待同机其他构建空闲（不停止其他任务）'); announced = true; }
    }
    if (quietSince !== null && performance.now() - quietSince >= 2000) return;
    await pause(500);
  }
  throw new Error('同机持续有其他构建负载，不能进行可信的空闲复核');
}
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: runtime, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${program} 执行失败：${((result.stdout || '') + (result.stderr || '')).replaceAll(db.toString(), '[isolated database]').slice(-5000)}`);
  return result.stdout;
}
const hash = content => createHash('sha256').update(content).digest('hex');
function hashTree(folder) {
  const entries = [];
  function walk(relative = '') {
    for (const name of readdirSync(join(folder, relative)).sort()) {
      const path = join(relative, name);
      if (statSync(join(folder, path)).isDirectory()) walk(path);
      else entries.push([path, hash(readFileSync(join(folder, path)))]);
    }
  }
  walk();
  return { sha256: hash(JSON.stringify(entries)), files: entries.length };
}
function isolatedClient(source, target) {
  cpSync(source, target, { recursive: true });
  // Prisma's generated client can load the schema's original .env even with an explicit URL.
  // Freeze a private client copy and remove only its environment-file discovery metadata.
  const index = join(target, 'index.js');
  const original = readFileSync(index, 'utf8');
  assert.match(original, /"relativeEnvPaths":\s*\{[^}]*\}/, '未找到 Prisma 环境文件元数据，拒绝继续');
  const sanitized = original.replace(/"relativeEnvPaths":\s*\{[^}]*\}/, '"relativeEnvPaths": { "rootEnvPath": null, "schemaEnvPath": null }');
  writeFileSync(index, sanitized);
}
function isolatedGenerated(source, target) {
  mkdirSync(join(target, 'generated'));
  isolatedClient(join(source, 'generated/prisma'), join(target, 'generated/prisma'));
}
function snapshot(name, source) {
  const target = join(runtime, name);
  mkdirSync(target);
  cpSync(join(source, 'src'), join(target, 'src'), { recursive: true });
  for (const file of ['tsconfig.json', 'tsconfig.build.json', 'package.json']) cpSync(join(source, file), join(target, file));
  symlinkSync(join(source, 'node_modules'), join(target, 'node_modules'));
  isolatedGenerated(source, target);
  mkdirSync(join(target, 'prisma'));
  // Only synthetic users are available to either snapshot; no local seed account data is copied.
  writeFileSync(join(target, 'prisma/seed-users.json'), '{}\n');
  command(process.execPath, [join(source, 'node_modules/typescript/bin/tsc'), '-p', join(target, 'tsconfig.build.json'), '--tsBuildInfoFile', join(target, 'build.tsbuildinfo')]);
  assert(existsSync(join(target, 'dist/main.js')));
  return { name, directory: target, source: hashTree(join(target, 'src')), build: hashTree(join(target, 'dist')), package: JSON.parse(readFileSync(join(target, 'package.json'))).dependencies };
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
let mockCalls = 0;
const mock = http.createServer((req, res) => {
  mockCalls++;
  req.resume();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 0, data: { id: 'isolated-owner', username: 'isolated-owner', displayName: 'Benchmark Owner', enabled: true } }));
});
const headers = { authorization: `Bearer ${sign({ userId: 'isolated-owner', username: 'isolated-owner', role: 'user', type: 'access' }, jwtSecret, { issuer: env.JWT_ISSUER, expiresIn: 7200 })}` };
async function request(port, path, agent, validate = false) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get({ hostname: '127.0.0.1', port, path, agent, headers: path.startsWith('/health') ? {} : headers }, res => {
      let bytes = 0;
      const chunks = validate ? [] : null;
      res.on('data', data => { bytes += data.length; chunks?.push(data); });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${path}`));
        try {
          const body = chunks ? JSON.parse(Buffer.concat(chunks)) : undefined;
          if (body) assert.equal(body.code, 0, '业务响应码必须为 0');
          resolve({ ms: performance.now() - started, bytes, body });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}
async function stop(handle) {
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.kill('SIGTERM');
    await Promise.race([once(handle.child, 'exit'), pause(1500)]);
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill('SIGKILL');
      await once(handle.child, 'exit');
    }
  }
  children.delete(handle);
}
let sequence = 0;
async function start(snapshot, label) {
  checkStop();
  const port = await freePort();
  const logPath = join(runtime, `${String(++sequence).padStart(2, '0')}-${snapshot.name}-${label}.log`);
  const fd = openSync(logPath, 'w', 0o600);
  const started = performance.now();
  const child = spawn(process.execPath, [...(diagnostic ? ['--expose-gc'] : []), '--require', observer, 'dist/main.js'], {
    cwd: snapshot.directory, env: { ...env, PORT: String(port) }, stdio: ['ignore', fd, fd, 'ipc'],
  });
  closeSync(fd);
  const handle = { child, port, samples: [], blockedNetwork: 0, snapshot: snapshot.name, logPath, started, exit: null };
  children.add(handle);
  child.on('message', message => {
    if (message.event === 'process-sample') handle.samples.push({ ...message, parentAt: performance.now() });
    if (message.event === 'blocked-network') handle.blockedNetwork++;
  });
  child.on('exit', (code, signal) => { handle.exit = { code, signal }; });
  child.on('error', error => { handle.error = error.message; });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    while (performance.now() - started < 20000) {
      checkStop();
      assert(!handle.exit && !handle.error, `${snapshot.name} 启动失败；详情见 ${logPath}`);
      try {
        const result = await request(port, '/health/ready', agent, true);
        if (result.body.data.status === 'ready' && result.body.data.checks.database === 'up') {
          handle.startupMs = performance.now() - started;
          return handle;
        }
      } catch { /* The port need not listen yet. */ }
      await pause(10);
    }
    throw new Error(`${snapshot.name} 数据库就绪检查超时`);
  } finally { agent.destroy(); }
}
function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}
const median = values => percentile(values, 0.5);
function memory(samples) {
  assert(samples.length, '没有采集到进程内存样本');
  const mib = value => value / 1024 / 1024;
  return {
    samples: samples.length,
    rssMedianMiB: median(samples.map(row => mib(row.memory.rss))),
    rssPeakMiB: Math.max(...samples.map(row => mib(row.memory.rss))),
    heapUsedMedianMiB: median(samples.map(row => mib(row.memory.heapUsed))),
    heapTotalMedianMiB: median(samples.map(row => mib(row.memory.heapTotal))),
    externalMedianMiB: median(samples.map(row => mib(row.memory.external))),
    lifetimeMaxRssMiB: Math.max(...samples.map(row => row.usage.maxRSS / 1024)),
  };
}
async function validate(handle, marketingOnly = false) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    if (marketingOnly) {
      const marketPath = handle.snapshot === 'nest' ? '/enterprise/marketing' : '/enterprise/marketing/page?page=1&pageSize=20';
      const marketing = await request(handle.port, marketPath, agent, true);
      const data = marketing.body.data;
      const rows = handle.snapshot === 'nest' ? 1000 : 20;
      assert.equal((Array.isArray(data) ? data : data.list).length, rows);
      return { marketingRows: rows, marketingBytes: marketing.bytes };
    }
    const me = (await request(handle.port, '/enterprise/me', agent, true)).body.data;
    assert(me, '身份查询必须返回真实数据');
    const contracts = (await request(handle.port, '/enterprise/contracts?page=1&pageSize=20', agent, true)).body.data;
    assert.equal((Array.isArray(contracts) ? contracts : contracts.list).length, 20, '两版签约列表必须返回相同 20 条业务记录');
    return { contractRows: 20, identity: { userId: me.userId ?? me.user?.id, roles: me.roles, currentIdentity: me.currentIdentity } };
  } finally { agent.destroy(); }
}
async function load(handle, paths, concurrency, durationMs, measured) {
  checkStop();
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency, maxFreeSockets: concurrency, scheduling: 'fifo' });
  const startTime = performance.now();
  const before = handle.samples.at(-1);
  const generatorBefore = process.cpuUsage();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const latencies = [];
  const errors = {};
  let bytes = 0;
  let requests = 0;
  const interference = [];
  const monitor = (guardCpu || diagnostic) && measured ? setInterval(() => interference.push(externalBuildCpu()), 500) : null;
  await Promise.all(Array.from({ length: concurrency }, (_, worker) => (async () => {
    let index = worker;
    while (performance.now() - startTime < durationMs && !stopRequested) {
      try {
        const result = await request(handle.port, paths[index++ % paths.length], agent);
        requests++;
        bytes += result.bytes;
        if (measured) latencies.push(result.ms);
      } catch (error) { errors[error.message] = (errors[error.message] || 0) + 1; }
    }
  })()));
  const ended = performance.now();
  if (monitor) clearInterval(monitor);
  const cpu = process.cpuUsage(generatorBefore);
  loop.disable();
  agent.destroy();
  handle.child.send('sample');
  await pause(120);
  const after = handle.samples.at(-1);
  const sampleSet = handle.samples.filter(row => row.parentAt >= startTime && row.parentAt <= ended);
  const elapsedMs = ended - startTime;
  assert(!handle.exit, '负载过程中 API 进程退出');
  assert.equal(handle.blockedNetwork, 0, '隔离网络拦截器发现出站访问');
  assert(before && after, '缺少 CPU 采样');
  return {
    concurrency, requests, errors, errorCount: Object.values(errors).reduce((a, b) => a + b, 0),
    durationMs: elapsedMs, successRps: requests / (elapsedMs / 1000), bytes,
    p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99),
    serverCpuPercentOfOneCore: ((after.usage.userCPUTime + after.usage.systemCPUTime) - (before.usage.userCPUTime + before.usage.systemCPUTime)) / (after.parentAt - before.parentAt) / 10,
    generatorCpuPercentOfOneCore: (cpu.user + cpu.system) / elapsedMs / 10,
    generatorEventLoopP99Ms: loop.percentile(99) / 1e6,
    memory: sampleSet.length ? memory(sampleSet) : null,
    hostLoadAverage: os.loadavg(),
    externalBuildCpuSamples: interference,
    externalBuildCpuMax: interference.length ? Math.max(...interference) : null,
  };
}
const report = {
  measuredAt: new Date().toISOString(), quick, diagnostic, focused, runtime,
  configuration: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 1024 ** 3, databaseHost: '127.0.0.1', databasePort: 5432, database, poolSize: 10, compiledProductionBuilds: true, startupPollMs: 10, startupRepetitions: diagnostic ? 0 : quick ? 2 : 10, rounds: diagnostic || quick ? 1 : 4, loadDurationMs: diagnostic ? 30000 : quick ? 1000 : 6000, sampleIntervalMs: 100, forcedGc: diagnostic ? 'only after load and 10 seconds idle, excluded from throughput' : false, isolatedPrismaEnvDiscovery: true, externalBuildCpuThreshold: guardCpu ? 30 : null, workerDisabledBoth: true, applicationOrder: 'AB/BA alternating across startup pairs and load rounds; only one API at a time; marketing always last' },
  fixtures: { enterpriseProfiles: 2, directoryUsers: 2, contractsVisible: 20, marketingTotal: 4000, marketingVisible: 1000 },
  builds: [], startup: [], idle: [], loads: [], rejectedLoads: [], validation: [], memoryRecovery: [], cleanup,
};
function save() { writeFileSync(join(runtime, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
try {
  console.log(`隔离压测目录：${runtime}`);
  if (process.env.BENCHMARK_REUSE_REPORT) {
    const previous = JSON.parse(readFileSync(process.env.BENCHMARK_REUSE_REPORT));
    assert(previous.completed && previous.cleanup.databaseDropped && previous.cleanup.apiProcessesStopped, '只能复用已完成并清理的压测构建');
    for (const build of previous.builds) {
      assert(build.directory.startsWith('/Volumes/Projects/tmp/enterprise-backend-benchmark-'));
      assert.equal(hashTree(join(build.directory, 'dist')).sha256, build.build.sha256, '冻结构建发生变化');
    }
    for (const build of previous.builds) {
      const target = join(runtime, build.name);
      mkdirSync(target);
      for (const folder of ['src', 'dist', 'prisma']) cpSync(join(build.directory, folder), join(target, folder), { recursive: true });
      cpSync(join(build.directory, 'package.json'), join(target, 'package.json'));
      symlinkSync(join(build.directory, 'node_modules'), join(target, 'node_modules'));
      isolatedGenerated(build.directory, target);
      report.builds.push({ ...build, directory: target });
    }
    report.reusedBuildsFrom = process.env.BENCHMARK_REUSE_REPORT;
    console.log('复用已完成压测的冻结构建');
  } else {
    console.log('冻结源码并编译两个版本（不修改正在运行的开发构建）');
    report.builds.push(snapshot('nest', baseline), snapshot('hono', join(root, 'backend')));
  }
  report.gitHead = command('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  report.postgresVersion = command('psql', ['-h', '127.0.0.1', '-U', os.userInfo().username, '-d', 'postgres', '-Atc', 'SHOW server_version']).trim();
  mkdirSync(join(runtime, 'schema'));
  cpSync(join(root, 'backend/prisma/schema.prisma'), join(runtime, 'schema/schema.prisma'));
  cpSync(join(root, 'backend/prisma/migrations'), join(runtime, 'schema/migrations'), { recursive: true });
  command('createdb', ['-h', '127.0.0.1', '-U', os.userInfo().username, database]);
  created = true;
  command(process.execPath, [join(root, 'backend/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(runtime, 'schema/schema.prisma')]);
  isolatedClient(join(root, 'backend/generated/prisma'), join(runtime, 'setup-client'));
  const { PrismaClient } = require(join(runtime, 'setup-client'));
  prisma = new PrismaClient({ datasources: { db: { url: db.toString() } } });
  await prisma.$connect();
  for (const [userId, displayName] of [['isolated-owner', 'Benchmark Owner'], ['isolated-provider', 'Benchmark Provider']]) {
    await prisma.userDirectory.create({ data: { userId, username: userId, displayName, email: '', avatarUrl: '', role: 'user', enabled: 1, syncedAt: new Date() } });
  }
  const enterprise = await prisma.enterpriseProfile.create({ data: { userId: 'isolated-owner', name: 'Benchmark Owner', uscc: 'benchmark-owner', status: 'APPROVED' } });
  const other = await prisma.enterpriseProfile.create({ data: { userId: 'isolated-other', name: 'Benchmark Other', uscc: 'benchmark-other', status: 'APPROVED' } });
  await prisma.identityPreference.create({ data: { userId: 'isolated-owner', currentIdentity: 'ENTERPRISE_USER' } });
  await prisma.contract.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ contractNo: `benchmark-${i}`, providerUserId: 'isolated-provider', enterpriseId: enterprise.id, serviceType: 'LOGISTICS', status: i % 2 ? 'ACTIVE' : 'PENDING' })) });
  for (let batch = 0; batch < 10; batch++) await prisma.marketingOrder.createMany({ data: Array.from({ length: 400 }, (_, i) => ({ orderNo: `benchmark-${batch}-${i}`, enterpriseId: i % 4 === 0 ? enterprise.id : other.id, createdBy: i % 4 === 0 ? 'isolated-owner' : 'isolated-other', title: `Benchmark ${batch}-${i}`, description: '隔离负载文本'.repeat(200) })) });
  await prisma.$executeRawUnsafe('ANALYZE');
  await prisma.$disconnect();
  prisma = null;
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  env.BENCHMARK_MOCK_PORT = String(mock.address().port);
  for (const key of ['JAVA_BASE_URL', 'AIWORKIN_BASE_URL', 'QIXIANGYUN_BASE_URL']) env[key] = `http://127.0.0.1:${mock.address().port}`;
  console.log('本机一次性数据库及合成数据已就绪；开始交替启动测试');
  for (let pair = 0; pair < report.configuration.startupRepetitions; pair++) {
    await quietBuildWindow();
    const ordered = pair % 2 ? [...report.builds].reverse() : report.builds;
    for (const build of ordered) {
      const handle = await start(build, `boot-${pair + 1}`);
      await pause(250);
      report.startup.push({ version: build.name, pair: pair + 1, startupMs: handle.startupMs, memoryAfterReady: memory(handle.samples.filter(row => row.parentAt >= handle.started + handle.startupMs)), blockedNetwork: handle.blockedNetwork });
      await stop(handle);
    }
    console.log(`启动对照 ${pair + 1}/${report.configuration.startupRepetitions} 完成`);
    save();
  }
  for (let round = 0; round < report.configuration.rounds; round++) {
    const ordered = round % 2 ? [...report.builds].reverse() : report.builds;
    for (const build of ordered) {
      await quietBuildWindow();
      const handle = await start(build, `load-${round + 1}`);
      report.validation.push({ version: build.name, round: round + 1, ...await validate(handle) });
      await load(handle, ['/enterprise/me', '/enterprise/contracts?page=1&pageSize=20'], 4, quick ? 500 : 2000, false);
      const idleStart = performance.now();
      await pause(quick ? 700 : 5000);
      report.idle.push({ version: build.name, round: round + 1, ...memory(handle.samples.filter(row => row.parentAt >= idleStart)) });
      const scenarios = diagnostic ? [
        { name: 'memory-business-before-health', paths: ['/enterprise/me', '/enterprise/contracts?page=1&pageSize=20'], concurrency: [64], equivalent: true, durationMs: 10000 },
        { name: 'memory-sustained-health', paths: ['/health'], concurrency: [64], equivalent: true },
      ] : focused ? [
        { name: 'health', paths: ['/health'], concurrency: [64], equivalent: true },
        { name: 'business-mixed', paths: ['/enterprise/me', '/enterprise/contracts?page=1&pageSize=20'], concurrency: [64], equivalent: true },
      ] : [
        { name: 'health', paths: ['/health'], concurrency: quick ? [16] : [1, 16, 64], equivalent: true },
        { name: 'business-mixed', paths: ['/enterprise/me', '/enterprise/contracts?page=1&pageSize=20'], concurrency: quick ? [16] : [1, 16, 64], equivalent: true },
        { name: 'marketing-migration', paths: [build.name === 'nest' ? '/enterprise/marketing' : '/enterprise/marketing/page?page=1&pageSize=20'], concurrency: [16], equivalent: false },
      ];
      // Alternate levels; keep unequal marketing payloads last so they cannot affect business memory.
      for (const scenario of scenarios) {
        if (scenario.name === 'marketing-migration') report.validation.push({ version: build.name, round: round + 1, ...await validate(handle, true) });
        const levels = round % 2 ? [...scenario.concurrency].reverse() : scenario.concurrency;
        for (const concurrency of levels) {
          let row;
          for (let attempt = 0; attempt < 4; attempt++) {
            await quietBuildWindow();
            await load(handle, scenario.paths, concurrency, quick ? 250 : 1000, false);
            row = { version: build.name, round: round + 1, scenario: scenario.name, paths: scenario.paths, equivalentResponseCardinality: scenario.equivalent, ...await load(handle, scenario.paths, concurrency, scenario.durationMs || report.configuration.loadDurationMs, true) };
            if (!guardCpu || row.externalBuildCpuMax === null || row.externalBuildCpuMax <= 30) break;
            report.rejectedLoads.push(row);
            console.log('本阶段出现其他构建负载，保留记录并等待重测');
            row = null;
            save();
          }
          assert(row, '连续出现其他构建负载，空闲复核未通过');
          report.loads.push(row);
          assert.equal(row.errorCount, 0, '压测请求发生错误，不能作为成功性能结果');
          console.log(`${build.name} 第 ${round + 1} 轮 ${scenario.name} C${concurrency}: ${row.successRps.toFixed(1)} req/s, P95 ${row.p95Ms.toFixed(2)} ms, RSS ${row.memory.rssMedianMiB.toFixed(1)} MiB`);
          save();
        }
      }
      if (diagnostic) {
        const idleStart = performance.now();
        await pause(10000);
        const recovery = { version: build.name, afterTenSecondsIdle: memory(handle.samples.filter(row => row.parentAt >= idleStart + 5000)) };
        for (let i = 0; i < 3; i++) { handle.child.send('force-gc'); await pause(500); }
        const gcStart = performance.now();
        await pause(2000);
        recovery.afterForcedGc = memory(handle.samples.filter(row => row.parentAt >= gcStart));
        report.memoryRecovery.push(recovery);
        console.log(`${build.name} 停载 RSS ${recovery.afterTenSecondsIdle.rssMedianMiB.toFixed(1)} MiB，GC 后 RSS ${recovery.afterForcedGc.rssMedianMiB.toFixed(1)} MiB / heap ${recovery.afterForcedGc.heapUsedMedianMiB.toFixed(1)} MiB`);
        save();
      }
      await stop(handle);
    }
  }
  assert.equal(mockCalls, 0, '本次口径不应调用任何上游，检查目录预热或业务分支');
  report.completed = true;
} catch (error) {
  report.completed = false;
  report.error = error.message.replaceAll(db.toString(), '[isolated database]');
  console.error(report.error);
  process.exitCode = 1;
} finally {
  for (const handle of children) await stop(handle);
  cleanup.apiProcessesStopped = children.size === 0;
  await prisma?.$disconnect();
  if (mock.listening) await new Promise(resolve => mock.close(resolve));
  cleanup.mockStopped = !mock.listening;
  if (created) {
    command('dropdb', ['-h', '127.0.0.1', '-U', os.userInfo().username, database]);
    cleanup.databaseDropped = command('psql', ['-h', '127.0.0.1', '-U', os.userInfo().username, '-d', 'postgres', '-Atc', `SELECT count(*) FROM pg_database WHERE datname = '${database}'`]).trim() === '0';
  }
  report.mockCalls = mockCalls;
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`测试${report.completed ? '完成' : '未完成'}；清理结果 ${JSON.stringify(cleanup)}；原始报告：${join(runtime, 'report.json')}`);
}
