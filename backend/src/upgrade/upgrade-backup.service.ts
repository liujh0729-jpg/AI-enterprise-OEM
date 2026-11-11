import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  archiveCommand,
  backupsDir,
  installDir,
  updateDir,
} from './upgrade.config';
import { currentVersion } from './upgrade-version';

export type DatabaseTarget = {
  dialect: 'mysql' | 'postgresql';
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  schema: string;
};

export type BackupManifest = {
  kind: 'DATABASE' | 'CODE';
  createdAt: string;
  version: string;
  dialect: string;
  target?: {
    host: string;
    port: string;
    database: string;
    schema: string;
  };
  archive: string;
  bytes: number;
  sha256: string;
};

export function databaseTarget(): DatabaseTarget {
  const raw = String(process.env.DATABASE_URL || '').trim();
  if (!raw) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '未配置 DATABASE_URL，无法备份数据库',
    );
  }
  try {
    const url = new URL(raw);
    const dialect =
      url.protocol === 'postgresql:' || url.protocol === 'postgres:'
        ? 'postgresql'
        : 'mysql';
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!database) throw new Error('missing database');
    return {
      dialect,
      host: url.hostname,
      port: url.port || (dialect === 'postgresql' ? '5432' : '3306'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      schema: url.searchParams.get('schema') || 'public',
    };
  } catch {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'DATABASE_URL 格式不正确，无法备份数据库',
    );
  }
}

function toolAvailable(command: string, args: string[]) {
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

export function upgradeTools() {
  let target: DatabaseTarget | null = null;
  try {
    target = databaseTarget();
  } catch {
    target = null;
  }
  const dialect = target?.dialect || 'mysql';
  const dump = dialect === 'postgresql' ? 'pg_dump' : 'mysqldump';
  const restore = dialect === 'postgresql' ? 'pg_restore' : 'mysql';
  const archive = archiveCommand();
  const dumpAvailable = toolAvailable(dump, ['--version']);
  const archiveAvailable = toolAvailable(archive, ['--version']);
  return {
    dump,
    restore,
    archive,
    available: Boolean(target) && dumpAvailable && archiveAvailable,
    dumpAvailable,
    archiveAvailable,
    dialect,
  };
}

export function diskFreeBytes() {
  try {
    // 首次进入时 update 目录可能还不存在，先建出来再取文件系统余量。
    mkdirSync(updateDir(), { recursive: true });
    const stats = statfsSync(updateDir());
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return 0;
  }
}

async function hashFile(file: string) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function writeManifest(manifest: BackupManifest) {
  const file = `${manifest.archive}.json`;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return file;
}

function pgEnv(target: DatabaseTarget) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGCONNECT_TIMEOUT: '10',
  };
  for (const key of [
    'PGHOSTADDR',
    'PGSERVICE',
    'PGSERVICEFILE',
    'PGPASSFILE',
  ]) {
    delete env[key];
  }
  return env;
}

function mysqlEnv(target: DatabaseTarget) {
  return { ...process.env, MYSQL_PWD: target.password };
}

type RunOptions = {
  env?: NodeJS.ProcessEnv;
  stdoutFile?: string;
  stdinFile?: string;
  timeoutMs?: number;
};

/** 子进程执行：dump 直接写文件、restore 直接读文件，不把大文件塞进内存。 */
async function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const out = options.stdoutFile
      ? createWriteStream(options.stdoutFile, { mode: 0o600 })
      : null;
    if (out) {
      child.stdout.pipe(out);
    } else {
      child.stdout.resume();
    }
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-20_000);
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
      options.timeoutMs ?? 30 * 60_000,
    );
    child.on('error', (error) => {
      clearTimeout(timer);
      out?.end();
      reject(
        new BusinessException(
          ErrorCode.BAD_REQUEST,
          `${command} 无法启动：${error.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const finish = () => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        reject(
          new BusinessException(
            ErrorCode.BAD_REQUEST,
            `${command} 执行失败${stderr ? `：${stderr.slice(-800)}` : `（退出码 ${code}）`}`,
          ),
        );
      };
      if (out) out.end(finish);
      else finish();
    });
  });
}

/** 数据库备份：MySQL 用 mysqldump，PostgreSQL 用 pg_dump custom；两者都生成 600 权限清单。 */
export async function backupDatabase(
  jobDir: string,
  log: (line: string) => void,
) {
  const target = databaseTarget();
  const tools = upgradeTools();
  if (!tools.dumpAvailable) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `缺少数据库备份工具 ${tools.dump}，请按「平台升级」页的安装指引安装后重启后端`,
    );
  }
  const dir = resolve(jobDir, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = target.dialect === 'postgresql' ? 'dump' : 'sql';
  const archive = resolve(dir, `db-${stamp}.${ext}`);
  log(
    `数据库备份开始：${target.dialect} ${target.host}:${target.port}/${target.database}`,
  );
  if (target.dialect === 'postgresql') {
    await runCommand(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--schema=${target.schema}`,
      ],
      { env: pgEnv(target), stdoutFile: archive },
    );
  } else {
    await runCommand(
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
      { env: mysqlEnv(target), stdoutFile: archive },
    );
  }
  const bytes = statSync(archive).size;
  if (!bytes) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '数据库备份文件为空');
  }
  const sha256 = await hashFile(archive);
  const manifest: BackupManifest = {
    kind: 'DATABASE',
    createdAt: new Date().toISOString(),
    version: currentVersion(),
    dialect: target.dialect,
    target: {
      host: target.host,
      port: target.port,
      database: target.database,
      schema: target.schema,
    },
    archive,
    bytes,
    sha256,
  };
  const manifestPath = writeManifest(manifest);
  log(`数据库备份完成：${basename(archive)}（${bytes} 字节）`);
  return { manifest, manifestPath };
}

const CODE_EXCLUDES = [
  'node_modules',
  '.git',
  'update',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  '.backup',
  '.tmp',
  '*.log',
];

/** 代码备份：归档当前安装目录（保留 .env 与本地改动），供一键还原使用。 */
export async function backupCode(jobDir: string, log: (line: string) => void) {
  const dir = resolve(jobDir, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = resolve(dir, `code-${stamp}.tar.gz`);
  log('代码备份开始');
  await runCommand(
    archiveCommand(),
    [
      '-czf',
      archive,
      ...CODE_EXCLUDES.map((item) => `--exclude=${item}`),
      '-C',
      installDir(),
      '.',
    ],
    { timeoutMs: 30 * 60_000 },
  );
  await runCommand(archiveCommand(), ['-tzf', archive], {
    timeoutMs: 10 * 60_000,
  });
  const bytes = statSync(archive).size;
  const sha256 = await hashFile(archive);
  const manifest: BackupManifest = {
    kind: 'CODE',
    createdAt: new Date().toISOString(),
    version: currentVersion(),
    dialect: 'files',
    archive,
    bytes,
    sha256,
  };
  const manifestPath = writeManifest(manifest);
  log(`代码备份完成：${basename(archive)}（${bytes} 字节）`);
  return { manifest, manifestPath };
}

export async function verifyBackup(manifestPath: string) {
  const file = resolve(manifestPath);
  if (!existsSync(file)) {
    throw new BusinessException(ErrorCode.NOT_FOUND, '备份清单不存在');
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest;
  } catch {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '备份清单格式损坏');
  }
  if (!existsSync(manifest.archive)) {
    throw new BusinessException(ErrorCode.NOT_FOUND, '备份文件不存在');
  }
  const bytes = statSync(manifest.archive).size;
  if (bytes !== manifest.bytes) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '备份文件大小校验失败');
  }
  const sha256 = await hashFile(manifest.archive);
  if (sha256 !== manifest.sha256) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '备份文件 SHA-256 校验失败',
    );
  }
  return manifest;
}

export async function restoreDatabase(
  manifestPath: string,
  log: (line: string) => void,
) {
  const manifest = await verifyBackup(manifestPath);
  if (manifest.kind !== 'DATABASE') {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '所选备份不是数据库备份',
    );
  }
  const target = databaseTarget();
  if (target.dialect !== manifest.dialect) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `备份方言（${manifest.dialect}）与当前数据库（${target.dialect}）不一致`,
    );
  }
  log('开始还原数据库');
  if (target.dialect === 'postgresql') {
    await runCommand(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        `--dbname=${target.database}`,
        manifest.archive,
      ],
      { env: pgEnv(target) },
    );
  } else {
    const database = target.database.replace(/`/g, '``');
    try {
      await runCommand(
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
      log(
        `清理旧库失败（继续按备份覆盖）：${error instanceof Error ? error.message : '未知原因'}`,
      );
    }
    await runCommand(
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
  log('数据库还原完成');
}

export async function restoreCode(
  manifestPath: string,
  log: (line: string) => void,
) {
  const manifest = await verifyBackup(manifestPath);
  if (manifest.kind !== 'CODE') {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '所选备份不是代码备份');
  }
  log('开始还原代码');
  await runCommand(
    archiveCommand(),
    ['-xzpf', manifest.archive, '-C', installDir()],
    { timeoutMs: 30 * 60_000 },
  );
  log('代码还原完成');
}

export function ensureBackupDir() {
  mkdirSync(backupsDir(), { recursive: true, mode: 0o700 });
}
