// 平台升级执行器：由 API 以 detached 进程启动，负责停服、备份、替换代码、构建、迁移、重启与健康检查。
// 不依赖 Prisma / 后端 dist：只读写 update/jobs/<id>/job.json、state.json、job.log，
// API 在服务恢复后读取 state.json 回写数据库。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const jobDir = process.argv[2];
if (!jobDir) {
  console.error('缺少任务目录参数');
  process.exit(2);
}
const jobFile = resolve(jobDir, 'job.json');
const stateFile = resolve(jobDir, 'state.json');
const logFile = resolve(jobDir, 'job.log');
const cancelFile = resolve(jobDir, 'cancel');
const job = JSON.parse(readFileSync(jobFile, 'utf8'));
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { steps: [] };
state.steps = Array.isArray(state.steps) ? state.steps : [];
state.backups = Array.isArray(state.backups) ? state.backups : [];
state.status = 'RUNNING';
state.startedAt = state.startedAt || new Date().toISOString();
state.progress = Math.max(Number(state.progress || 0), 1);

const isWindows = process.platform === 'win32';
// Windows PATH 里的 tar 多为 Git Bash 的 GNU tar，会把盘符路径当远端主机，必须用系统 bsdtar。
const TAR = isWindows
  ? resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';
const installDir = job.installDir;
const updateDir = job.updateDir;
const backupsDir = resolve(jobDir, 'backups');
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';

function now() {
  return new Date().toISOString();
}

function log(line) {
  const text = String(line ?? '');
  const stamped = `[${now()}] ${text}\n`;
  try {
    writeFileSync(logFile, stamped, { flag: 'a' });
  } catch {
    // 日志写不进去也不能中断执行
  }
  process.stdout.write(stamped);
}

function saveState() {
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function step(key) {
  return state.steps.find((item) => item.key === key);
}

function begin(key, message = '') {
  const item = step(key);
  if (!item) return;
  item.status = 'RUNNING';
  item.startedAt = now();
  item.message = message;
  state.currentStep = key;
  saveState();
}

function ok(key, message = '') {
  const item = step(key);
  if (!item) return;
  item.status = 'SUCCESS';
  item.finishedAt = now();
  item.message = String(message || '').slice(0, 1000);
  state.progress = Math.min(99, Math.max(state.progress, stepProgress(key)));
  saveState();
}

function failStep(key, message) {
  const item = step(key);
  if (!item) return;
  item.status = 'FAILED';
  item.finishedAt = now();
  item.message = String(message || '').slice(0, 1000);
  saveState();
}

function stepProgress(key) {
  const index = state.steps.findIndex((item) => item.key === key);
  if (index < 0) return state.progress;
  return Math.round(((index + 1) / state.steps.length) * 100);
}

function cancelled() {
  return existsSync(cancelFile);
}

function checkCancel() {
  if (!cancelled()) return;
  log('收到取消指令，停止执行');
  state.status = 'CANCELLED';
  state.error = '任务被管理员取消';
  state.finishedAt = now();
  saveState();
  process.exit(0);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || installDir,
      env: options.env || process.env,
      windowsHide: true,
      shell: Boolean(options.shell),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const out = options.stdoutFile
      ? createWriteStream(options.stdoutFile, { mode: 0o600 })
      : null;
    const mirror = (chunk) => {
      const text = chunk.toString('utf8');
      if (text.trim()) log(text.trimEnd());
    };
    if (out) child.stdout.pipe(out);
    else child.stdout.on('data', mirror);
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr = `${stderr}${text}`.slice(-20_000);
      if (text.trim()) log(text.trimEnd());
    });
    if (options.stdinFile) {
      const input = createReadStream(options.stdinFile);
      input.on('error', () => child.kill());
      input.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
    const timer = setTimeout(
      () => child.kill('SIGKILL'),
      options.timeoutMs || 30 * 60_000,
    );
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${command} 无法启动：${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const finish = () => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${command} 执行失败${stderr ? `：${stderr.slice(-800)}` : `（退出码 ${code}）`}`));
      };
      if (out) out.end(finish);
      else finish();
    });
  });
}

function output(command, args) {
  try {
    return spawnSync(command, args, {
      cwd: installDir,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    }).stdout?.trim() || '';
  } catch {
    return '';
  }
}

function available(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function databaseTarget() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  if (!raw) throw new Error('未配置 DATABASE_URL');
  const url = new URL(raw);
  const dialect = url.protocol.startsWith('postgres') ? 'postgresql' : 'mysql';
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!database) throw new Error('DATABASE_URL 缺少数据库名');
  return {
    dialect,
    host: url.hostname,
    port: url.port || (dialect === 'postgresql' ? '5432' : '3306'),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    schema: url.searchParams.get('schema') || 'public',
  };
}

function pgEnv(target) {
  const env = {
    ...process.env,
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGCONNECT_TIMEOUT: '10',
  };
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGPASSFILE']) delete env[key];
  return env;
}

function mysqlEnv(target) {
  return { ...process.env, MYSQL_PWD: target.password };
}

async function hashFile(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

async function backupDatabase(stepKey) {
  begin(stepKey, '导出数据库');
  const target = databaseTarget();
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const stamp = now().replace(/[:.]/g, '-');
  const ext = target.dialect === 'postgresql' ? 'dump' : 'sql';
  const archive = resolve(backupsDir, `db-${stamp}.${ext}`);
  if (target.dialect === 'postgresql') {
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--schema=${target.schema}`], {
      env: pgEnv(target),
      stdoutFile: archive,
      timeoutMs: 30 * 60_000,
    });
  } else {
    await run(
      'mysqldump',
      [
        `--host=${target.host}`,
        `--port=${target.port}`,
        `--user=${target.user}`,
        '--single-transaction',
        '--quick',
        '--routines',
        '--triggers',
        '--events',
        '--hex-blob',
        '--no-tablespaces',
        '--default-character-set=utf8mb4',
        '--databases',
        target.database,
      ],
      {
        env: mysqlEnv(target),
        stdoutFile: archive,
        timeoutMs: 30 * 60_000,
      },
    );
  }
  const bytes = statSync(archive).size;
  if (!bytes) throw new Error('数据库备份文件为空');
  const sha256 = await hashFile(archive);
  const manifest = {
    kind: 'DATABASE',
    createdAt: now(),
    version: job.fromVersion,
    dialect: target.dialect,
    target: { host: target.host, port: target.port, database: target.database, schema: target.schema },
    archive,
    bytes,
    sha256,
  };
  const manifestPath = `${archive}.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  state.backups.push({ ...manifest, manifestPath });
  saveState();
  ok(stepKey, `数据库备份 ${basename(archive)}（${bytes} 字节）`);
}

async function backupCode(stepKey) {
  begin(stepKey, '归档当前代码');
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const archive = resolve(backupsDir, `code-${now().replace(/[:.]/g, '-')}.tar.gz`);
  const excludes = ['node_modules', '.git', 'update', '.next', 'dist', 'coverage', '.turbo', '.backup', '.tmp', '*.log'];
  await run(TAR, ['-czf', archive, ...excludes.map((item) => `--exclude=${item}`), '-C', installDir, '.'], {
    timeoutMs: 30 * 60_000,
  });
  await run(TAR, ['-tzf', archive], { timeoutMs: 10 * 60_000 });
  const bytes = statSync(archive).size;
  const sha256 = await hashFile(archive);
  const manifest = {
    kind: 'CODE',
    createdAt: now(),
    version: job.fromVersion,
    dialect: 'files',
    archive,
    bytes,
    sha256,
  };
  const manifestPath = `${archive}.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  state.backups.push({ ...manifest, manifestPath });
  saveState();
  ok(stepKey, `代码备份 ${basename(archive)}（${bytes} 字节）`);
}

function verifyManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!existsSync(manifest.archive)) throw new Error(`备份文件不存在：${manifest.archive}`);
  if (statSync(manifest.archive).size !== manifest.bytes) throw new Error('备份大小校验失败');
  return manifest;
}

async function verifyManifestHash(manifestPath) {
  const manifest = verifyManifest(manifestPath);
  const sha256 = await hashFile(manifest.archive);
  if (sha256 !== manifest.sha256) throw new Error('备份 SHA-256 校验失败');
  return manifest;
}

async function restoreDatabase(manifestPath) {
  const manifest = await verifyManifestHash(manifestPath);
  if (manifest.kind !== 'DATABASE') throw new Error('所选备份不是数据库备份');
  const target = databaseTarget();
  if (target.dialect !== manifest.dialect) throw new Error('备份方言与当前数据库不一致');
  if (target.dialect === 'postgresql') {
    await run(
      'pg_restore',
      ['--clean', '--if-exists', '--no-owner', '--no-privileges', `--dbname=${target.database}`, manifest.archive],
      { env: pgEnv(target) },
    );
  } else {
    const database = target.database.replace(/`/g, '``');
    try {
      await run(
        'mysql',
        [
          `--host=${target.host}`,
          `--port=${target.port}`,
          `--user=${target.user}`,
          '--default-character-set=utf8mb4',
          '-e',
          `DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
        ],
        { env: mysqlEnv(target) },
      );
    } catch (error) {
      log(`清理旧库失败（继续覆盖）：${error.message}`);
    }
    await run(
      'mysql',
      [
        `--host=${target.host}`,
        `--port=${target.port}`,
        `--user=${target.user}`,
        '--default-character-set=utf8mb4',
      ],
      { env: mysqlEnv(target), stdinFile: manifest.archive },
    );
  }
}

async function restoreCode(manifestPath) {
  const manifest = await verifyManifestHash(manifestPath);
  if (manifest.kind !== 'CODE') throw new Error('所选备份不是代码备份');
  await run(TAR, ['-xzpf', manifest.archive, '-C', installDir], { timeoutMs: 30 * 60_000 });
}

const SKIP_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'update',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  '.backup',
  '.tmp',
  'generated',
]);

function applyCode(candidateDir, conflictStrategy) {
  const ignored = (src) => {
    const rel = relative(candidateDir, src).replace(/\\/g, '/');
    if (!rel) return true;
    const segments = rel.split('/');
    if (segments.some((segment) => SKIP_SEGMENTS.has(segment))) return false;
    const name = segments[segments.length - 1];
    if (name === '.env' || name.startsWith('.env.')) return false;
    if (/\.log$/i.test(name)) return false;
    return true;
  };
  if (conflictStrategy === 'abort') {
    const dirty = output('git', ['status', '--porcelain']);
    if (dirty) {
      throw new Error('存在本地未提交改动，且选择了「发现冲突就停止」。请先处理工作区改动再升级');
    }
  }
  // 只覆盖新版本存在的文件，不删除旧版本多出来的文件，避免误删运行期数据或本地配置。
  cpSync(candidateDir, installDir, {
    recursive: true,
    force: true,
    filter: ignored,
  });
}

async function installDependencies() {
  const args = ['install', '--frozen-lockfile'];
  await run(pnpm, args, { shell: true, timeoutMs: 30 * 60_000 });
}

async function buildProject() {
  await run(pnpm, ['--filter', '@enterprise/contracts', 'build'], { shell: true, timeoutMs: 20 * 60_000 });
  await run(pnpm, ['--filter', 'aiworkin-enterprise-api', 'build'], { shell: true, timeoutMs: 20 * 60_000 });
  await run(pnpm, ['--filter', 'aiworkin-enterprise-web', 'build'], { shell: true, timeoutMs: 40 * 60_000 });
}

async function migrateDatabase() {
  const target = databaseTarget();
  if (target.dialect === 'postgresql') {
    await run('node', ['scripts/gen-prisma-schema.mjs'], { timeoutMs: 5 * 60_000 });
    await run(pnpm, ['--filter', 'aiworkin-enterprise-api', 'exec', 'prisma', 'db', 'push', '--schema', 'prisma/schema.postgres.prisma', '--skip-generate'], {
      shell: true,
      timeoutMs: 20 * 60_000,
    });
  } else {
    await run(pnpm, ['--filter', 'aiworkin-enterprise-api', 'exec', 'prisma', 'migrate', 'deploy'], {
      shell: true,
      timeoutMs: 20 * 60_000,
    });
  }
}

function listenersOnPort(port) {
  const pids = new Set();
  if (isWindows) {
    const text = output('netstat', ['-ano', '-p', 'tcp']);
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes(`:${port} `) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  const ss = output('ss', ['-ltnp']);
  for (const line of ss.split(/\r?\n/)) {
    if (!line.includes(`:${port} `)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) pids.add(Number(match[1]));
  }
  if (pids.size) return [...pids];
  const lsof = output('lsof', ['-ti', `tcp:${port}`]);
  for (const line of lsof.split(/\r?\n/)) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

async function stopByPort(port) {
  for (const pid of listenersOnPort(port)) {
    if (pid === process.pid) continue;
    log(`停止端口 ${port} 上的进程 PID=${pid}`);
    if (isWindows) {
      spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // 进程可能已退出
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 忽略
      }
    }
  }
}

function shellRun(command) {
  if (!command) throw new Error('未配置重启命令');
  if (isWindows) return run('cmd.exe', ['/d', '/s', '/c', command], { shell: false, timeoutMs: 10 * 60_000 });
  return run('/bin/sh', ['-c', command], { timeoutMs: 10 * 60_000 });
}

async function stopServices() {
  const deploy = job.deployment || {};
  if (deploy.mode === 'docker') {
    throw new Error('Docker 部署不能在容器内重启，请在宿主机执行升级');
  }
  if (deploy.mode === 'pm2') {
    await run('pm2', ['stop', 'all'], { shell: true });
    return;
  }
  if (deploy.mode === 'systemd') {
    for (const unit of String(deploy.systemdUnits || '').split(/\s+/).filter(Boolean)) {
      await run('systemctl', ['stop', unit]);
    }
    return;
  }
  if (deploy.mode === 'command') {
    await shellRun(deploy.stopCommand);
    return;
  }
  await stopByPort(Number(deploy.apiPort || 1690));
  await stopByPort(Number(deploy.webPort || 15890));
}

async function startServices() {
  const deploy = job.deployment || {};
  if (deploy.mode === 'pm2') {
    await run('pm2', ['restart', 'all'], { shell: true });
    return;
  }
  if (deploy.mode === 'systemd') {
    for (const unit of String(deploy.systemdUnits || '').split(/\s+/).filter(Boolean)) {
      await run('systemctl', ['start', unit]);
    }
    return;
  }
  if (deploy.mode === 'command') {
    await shellRun(deploy.startCommand);
    return;
  }
  const child = spawn(process.execPath, [resolve(installDir, 'scripts/dev.mjs')], {
    cwd: installDir,
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  log(`已启动 scripts/dev.mjs（PID ${child.pid || 0}）`);
}

async function healthCheck() {
  const url = job.deployment?.healthUrl || `http://127.0.0.1:${job.deployment?.apiPort || 1690}/health/ready`;
  const attempts = 150;
  for (let index = 0; index < attempts; index += 1) {
    if (cancelled()) throw new Error('任务被取消');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const text = await response.text();
        if (text.includes('"ready"') || text.includes('"up"') || text.includes('"code":0')) {
          log(`健康检查通过（第 ${index + 1} 次）`);
          return;
        }
      }
    } catch {
      // 服务尚未就绪，继续重试
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`健康检查超时：${url} 连续 ${attempts} 次未就绪`);
}

function diskFree() {
  try {
    const stats = statfsSync(updateDir);
    return stats.bavail * stats.bsize;
  } catch {
    return 0;
  }
}

async function preflight() {
  begin('preflight', '检查执行环境');
  if (job.type === 'UPGRADE') {
    if (!job.candidateDir || !existsSync(job.candidateDir)) {
      throw new Error('升级包候选目录不存在，请重新下载或上传');
    }
    for (const required of [
      'package.json',
      'pnpm-workspace.yaml',
      'backend/package.json',
      'frontend/package.json',
      'packages/contracts/package.json',
      'backend/prisma/schema.prisma',
    ]) {
      if (!existsSync(resolve(job.candidateDir, required))) {
        throw new Error(`升级包缺少 ${required}`);
      }
    }
  }
  if (job.type === 'RESTORE') {
    const restore = job.restore || {};
    if (!restore.databaseManifest) throw new Error('缺少数据库备份清单');
    await verifyManifestHash(restore.databaseManifest);
    if (restore.mode === 'FULL') {
      if (!restore.codeManifest) throw new Error('完整还原缺少代码备份清单');
      await verifyManifestHash(restore.codeManifest);
    }
  }
  if (job.type === 'CODE_EDIT') {
    const manifestFile = resolve(resolve(jobDir, 'code-edit'), 'manifest.json');
    if (!existsSync(manifestFile)) {
      throw new Error('编辑集清单缺失，请回到 AI 编程页重新发起');
    }
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (!Array.isArray(manifest.files) || !manifest.files.length) {
      throw new Error('编辑集为空，没有可应用的变更');
    }
  }
  const target = databaseTarget();
  const clientTool =
    job.type === 'RESTORE'
      ? target.dialect === 'postgresql'
        ? 'pg_restore'
        : 'mysql'
      : target.dialect === 'postgresql'
        ? 'pg_dump'
        : 'mysqldump';
  if (!available(clientTool, ['--version'])) {
    const pkg =
      target.dialect === 'postgresql' ? 'postgresql-client' : 'mysql-client';
    throw new Error(
      `缺少数据库客户端工具 ${clientTool}，请安装 ${pkg} 后重试（安装方法见平台升级页）`,
    );
  }
  if (!available(TAR, ['--version'])) {
    throw new Error(`缺少归档工具 ${TAR}，请安装 tar 后重试（安装方法见平台升级页）`);
  }
  log(`部署模式：${job.deployment?.mode || 'dev'}，数据库方言：${target.dialect}`);
  log(`update 目录：${updateDir}（可用空间 ${diskFree()} 字节）`);
  ok('preflight', '预检通过');
}

async function runUpgrade() {
  await preflight();
  checkCancel();
  await backupDatabase('backup_db');
  checkCancel();
  if (job.options?.backupCode !== false) {
    await backupCode('backup_code');
    checkCancel();
  } else {
    ok('backup_code', '按配置跳过代码备份');
  }
  begin('maintenance', '维护模式已在任务创建时开启');
  ok('maintenance', '维护模式已开启');
  checkCancel();

  begin('stop', '停止服务');
  await stopServices();
  ok('stop', '服务已停止');

  begin('apply', '应用新代码');
  applyCode(job.candidateDir, job.options?.conflictStrategy || 'overwrite');
  ok('apply', `已应用 ${job.toVersion} 代码`);

  begin('install', '安装依赖');
  await installDependencies();
  ok('install', '依赖安装完成');

  begin('build', '构建');
  await buildProject();
  ok('build', '构建完成');

  begin('migrate', '数据库迁移');
  await migrateDatabase();
  ok('migrate', '数据库迁移完成');

  begin('start', '启动服务');
  await startServices();
  ok('start', '服务已启动');

  begin('health', '健康检查');
  await healthCheck();
  ok('health', '服务健康检查通过');

  begin('done', '升级完成');
  state.status = 'SUCCESS';
  state.progress = 100;
  state.newVersion = job.toVersion;
  state.finishedAt = now();
  ok('done', `${job.fromVersion} → ${job.toVersion}`);
  saveState();
  log('升级完成');
}

async function runRestore() {
  await preflight();
  checkCancel();
  begin('maintenance', '维护模式已在任务创建时开启');
  ok('maintenance', '维护模式已开启');

  begin('stop', '停止服务');
  await stopServices();
  ok('stop', '服务已停止');

  begin('restore_db', '还原数据库');
  await restoreDatabase(job.restore.databaseManifest);
  ok('restore_db', '数据库已还原');

  if (job.restore.mode === 'FULL') {
    begin('restore_code', '还原代码');
    await restoreCode(job.restore.codeManifest);
    ok('restore_code', '代码已还原');
  } else {
    ok('restore_code', '仅还原数据库，跳过代码');
  }

  begin('install', '安装依赖');
  await installDependencies();
  ok('install', '依赖安装完成');

  begin('build', '构建');
  await buildProject();
  ok('build', '构建完成');

  begin('start', '启动服务');
  await startServices();
  ok('start', '服务已启动');

  begin('health', '健康检查');
  await healthCheck();
  ok('health', '服务健康检查通过');

  begin('done', '还原完成');
  state.status = 'SUCCESS';
  state.progress = 100;
  state.newVersion = job.toVersion;
  state.finishedAt = now();
  ok('done', '备份已还原');
  saveState();
  log('还原完成');
}

/**
 * AI 编程改码：只覆盖被采纳的文件（增量），删除类变更按清单删除。
 * 文件内容由 API 在创建任务时快照进 jobDir/code-edit/files，执行期不再读暂存区。
 */
function applyCodeEdit() {
  const snapshotDir = resolve(jobDir, 'code-edit');
  const manifestFile = resolve(snapshotDir, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error('编辑集清单缺失，请重新发起改码');
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) throw new Error('编辑集为空，没有可应用的变更');
  const installRoot = resolve(installDir);
  let applied = 0;
  let deleted = 0;
  for (const file of files) {
    const rel = String(file.path || '').replace(/\\/g, '/');
    if (!rel || rel.startsWith('/') || rel.includes('..')) {
      throw new Error(`编辑集包含非法路径：${rel}`);
    }
    const target = resolve(installRoot, rel);
    if (target !== installRoot && !target.startsWith(installRoot + sep)) {
      throw new Error(`编辑集路径越界：${rel}`);
    }
    if (file.changeType === 'deleted') {
      rmSync(target, { force: true });
      deleted += 1;
      continue;
    }
    const source = resolve(snapshotDir, 'files', rel);
    if (!existsSync(source)) {
      throw new Error(`编辑集缺少文件内容：${rel}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    applied += 1;
  }
  log(`已应用编辑集：覆盖 ${applied} 个文件，删除 ${deleted} 个文件`);
  return { applied, deleted, files };
}

/** 是否需要装依赖：编辑集里出现 package.json / pnpm-lock.yaml 才装。 */
function codeEditNeedsInstall(files) {
  return files.some((file) => {
    const rel = String(file.path || '').replace(/\\/g, '/');
    return rel === 'package.json' || rel === 'pnpm-lock.yaml' || rel.endsWith('/package.json');
  });
}

/** 是否需要迁移：编辑集里出现 backend/prisma 下的文件才跑迁移 + 重新生成客户端。 */
function codeEditNeedsMigrate(files) {
  return files.some((file) =>
    String(file.path || '')
      .replace(/\\/g, '/')
      .startsWith('backend/prisma/'),
  );
}

async function runCodeEdit() {
  await preflight();
  checkCancel();
  await backupDatabase('backup_db');
  checkCancel();
  if (job.options?.backupCode !== false) {
    await backupCode('backup_code');
    checkCancel();
  } else {
    ok('backup_code', '按配置跳过代码备份');
  }
  begin('maintenance', '维护模式已在任务创建时开启');
  ok('maintenance', '维护模式已开启');
  checkCancel();

  begin('stop', '停止服务');
  await stopServices();
  ok('stop', '服务已停止');

  begin('apply', '应用编辑集');
  const result = applyCodeEdit();
  ok('apply', `覆盖 ${result.applied} 个文件，删除 ${result.deleted} 个文件`);

  begin('install', '安装依赖');
  if (codeEditNeedsInstall(result.files)) {
    await installDependencies();
    ok('install', '依赖安装完成');
  } else {
    ok('install', '本次未改动依赖，跳过安装');
  }

  begin('build', '构建');
  await buildProject();
  ok('build', '构建完成');

  begin('migrate', '数据库迁移');
  if (codeEditNeedsMigrate(result.files)) {
    await migrateDatabase();
    ok('migrate', '数据库迁移完成');
  } else {
    ok('migrate', '本次未改动数据模型，跳过迁移');
  }

  begin('start', '启动服务');
  await startServices();
  ok('start', '服务已启动');

  begin('health', '健康检查');
  await healthCheck();
  ok('health', '服务健康检查通过');

  begin('done', '改码完成');
  state.status = 'SUCCESS';
  state.progress = 100;
  state.newVersion = job.toVersion;
  state.finishedAt = now();
  ok('done', `已应用 ${result.applied + result.deleted} 个文件变更`);
  saveState();
  log('改码完成');
}

async function autoRollback(reason) {
  const databaseBackup = state.backups.find((item) => item.kind === 'DATABASE');
  const codeBackup = state.backups.find((item) => item.kind === 'CODE');
  if (!databaseBackup || !codeBackup) {
    log('自动回滚条件不满足：缺少数据库或代码备份');
    return false;
  }
  try {
    log(`升级失败，开始自动回滚：${reason}`);
    state.currentStep = 'rollback';
    saveState();
    try {
      await stopServices();
    } catch {
      // 服务可能已经停止
    }
    await restoreDatabase(databaseBackup.manifestPath);
    await restoreCode(codeBackup.manifestPath);
    await installDependencies();
    await buildProject();
    await startServices();
    await healthCheck();
    state.status = 'ROLLED_BACK';
    state.progress = 100;
    state.error = `升级失败，已自动回滚：${reason}`;
    state.finishedAt = now();
    saveState();
    log('自动回滚完成');
    return true;
  } catch (error) {
    log(`自动回滚失败：${error.message}`);
    return false;
  }
}

async function main() {
  saveState();
  log(`任务 #${job.jobId} 开始：${job.type} ${job.fromVersion || ''} → ${job.toVersion || ''}`);
  try {
    if (job.type === 'RESTORE') {
      await runRestore();
      return;
    }
    if (job.type === 'CODE_EDIT') {
      await runCodeEdit();
      return;
    }
    await runUpgrade();
  } catch (error) {
    const message = String(error?.message || error || '执行失败').slice(0, 900);
    log(`执行失败：${message}`);
    failStep(state.currentStep, message);
    const applied = ['apply', 'install', 'build', 'migrate', 'start', 'health'].includes(state.currentStep);
    const canRollback =
      (job.type === 'UPGRADE' || job.type === 'CODE_EDIT') &&
      job.options?.autoRollback !== false &&
      applied;
    const rolledBack = canRollback ? await autoRollback(message) : false;
    if (!rolledBack) {
      state.status = 'FAILED';
      state.error = message;
      state.finishedAt = now();
      state.progress = Math.max(state.progress, stepProgress(state.currentStep));
      saveState();
    }
  }
}

await main();
