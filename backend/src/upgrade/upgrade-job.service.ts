import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { PlatformUpgradeJob } from '../../generated/prisma';
import type { UpgradeJob } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  deployment,
  installDir,
  jobsDir,
  runnerDeploymentConfig,
  runnerScript,
  updateDir,
} from './upgrade.config';
import { backupView, jobView } from './upgrade.dto';
import { UpgradePackageService } from './upgrade-package.service';
import {
  diskFreeBytes,
  upgradeTools,
  verifyBackup,
} from './upgrade-backup.service';
import { currentVersion, normalizeVersion } from './upgrade-version';

export const MAINTENANCE_KEY = 'platform_maintenance';

export type RunnerState = {
  jobId: number;
  status:
    'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'ROLLED_BACK';
  progress: number;
  currentStep: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  newVersion?: string;
  steps: {
    key: string;
    label: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
    message?: string;
    startedAt?: string;
    finishedAt?: string;
  }[];
  backups?: {
    kind: 'DATABASE' | 'CODE';
    version: string;
    dialect: string;
    archive: string;
    manifestPath: string;
    bytes: number;
    sha256: string;
  }[];
};

const UPGRADE_STEPS = [
  ['preflight', '升级预检'],
  ['backup_db', '备份数据库'],
  ['backup_code', '备份代码'],
  ['maintenance', '开启维护模式'],
  ['stop', '停止服务'],
  ['apply', '应用新代码'],
  ['install', '安装依赖'],
  ['build', '构建'],
  ['migrate', '数据库迁移'],
  ['start', '启动服务'],
  ['health', '健康检查'],
  ['done', '升级完成'],
] as const;

const RESTORE_STEPS = [
  ['preflight', '还原预检'],
  ['maintenance', '开启维护模式'],
  ['stop', '停止服务'],
  ['restore_db', '还原数据库'],
  ['restore_code', '还原代码'],
  ['install', '安装依赖'],
  ['build', '构建'],
  ['start', '启动服务'],
  ['health', '健康检查'],
  ['done', '还原完成'],
] as const;

/** AI 编程改码：与应用升级同一条链，只是「应用新代码」换成「应用编辑集」。 */
const CODE_EDIT_STEPS = [
  ['preflight', '改码预检'],
  ['backup_db', '备份数据库'],
  ['backup_code', '备份代码'],
  ['maintenance', '开启维护模式'],
  ['stop', '停止服务'],
  ['apply', '应用编辑集'],
  ['install', '安装依赖'],
  ['build', '构建'],
  ['migrate', '数据库迁移'],
  ['start', '启动服务'],
  ['health', '健康检查'],
  ['done', '改码完成'],
] as const;

type MaintenanceState = {
  on: boolean;
  reason: string;
  jobId: number;
  startedAt: string;
};

const STALE_MS = 30 * 60_000;

function timestamp() {
  return new Date().toISOString();
}

function atomicWrite(file: string, content: string) {
  // 状态文件很小，直接覆盖；runner 读取时容忍解析失败并在下一轮重试。
  writeFileSync(file, content, { mode: 0o600 });
}

/**
 * 升级任务：API 只负责创建任务、写 runner 配置并同步状态；
 * 真正的停服、备份、替换、构建、迁移、重启由独立 runner 执行，避免 API 重启后任务丢失。
 */
export class UpgradeJobService {
  private maintenanceCache: { at: number; value: MaintenanceState } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: UpgradePackageService,
    private readonly identity: IdentityService,
  ) {}

  async createUpgrade(
    user: CurrentUser,
    body: {
      packageId: number;
      backupDatabase: boolean;
      backupCode: boolean;
      autoRollback: boolean;
      conflictStrategy: 'overwrite' | 'abort';
      confirmation: string;
    },
  ) {
    await this.assertIdle();
    if (!body.backupDatabase) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '升级前必须备份数据库，这是一项强制安全步骤',
      );
    }
    const pkg = await this.packages.get(body.packageId);
    if (!pkg.extracted || !pkg.candidateDir) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '升级包尚未完成校验，请先重新下载或上传',
      );
    }
    const version = normalizeVersion(pkg.version);
    if (!version || version === 'unknown') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '无法识别升级包版本号，请重新上传并填写版本号后再执行',
      );
    }
    if (normalizeVersion(body.confirmation) !== version) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `重复确认未通过：请输入目标版本号 ${version}`,
      );
    }
    const deploy = deployment();
    if (deploy.hostUpgradeRequired) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前是 Docker 部署，容器内不能替换自身镜像。请在宿主机执行：${deploy.hostCommand}`,
      );
    }
    const tools = upgradeTools();
    if (!tools.available) {
      const missing = [
        !tools.dumpAvailable ? tools.dump : '',
        !tools.archiveAvailable ? tools.archive : '',
      ]
        .filter(Boolean)
        .join('、');
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `升级预检未通过：服务器缺少 ${missing || tools.dump}。请按「平台升级」页的安装指引处理后重启后端`,
      );
    }
    if (diskFreeBytes() > 0 && diskFreeBytes() < 512 * 1024 * 1024) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '升级预检未通过：update 目录所在磁盘剩余空间不足 512MB，请先清理空间',
      );
    }

    const fromVersion = currentVersion();
    const job = await this.prisma.platformUpgradeJob.create({
      data: {
        type: 'UPGRADE',
        status: 'PENDING',
        packageId: pkg.id,
        fromVersion,
        toVersion: version,
        progress: 0,
        operatorId: user.userId,
        optionsJson: JSON.stringify({
          backupDatabase: true,
          backupCode: body.backupCode,
          autoRollback: body.autoRollback,
          conflictStrategy: body.conflictStrategy,
        }),
      },
    });
    await this.ensureSteps(job.id, UPGRADE_STEPS);
    await this.launch(job, {
      type: 'UPGRADE',
      candidateDir: pkg.candidateDir,
      options: {
        backupDatabase: true,
        backupCode: body.backupCode,
        autoRollback: body.autoRollback,
        conflictStrategy: body.conflictStrategy,
      },
    });
    await this.audit(
      user,
      '发起平台升级',
      `#${job.id} ${fromVersion} → ${version}，强制备份数据库${body.backupCode ? '与代码' : ''}`,
    );
    return this.get(job.id);
  }

  async createRestore(
    user: CurrentUser,
    body: {
      backupId: number;
      mode: 'FULL' | 'DATABASE';
      confirmation: string;
    },
  ) {
    await this.assertIdle();
    const selected = await this.prisma.platformBackup.findUnique({
      where: { id: body.backupId },
    });
    if (!selected) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '备份不存在，请刷新备份列表',
      );
    }
    const expected = body.mode === 'FULL' ? 'RESTORE' : 'RESTORE-DB';
    if (
      String(body.confirmation || '')
        .trim()
        .toUpperCase() !== expected
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `重复确认未通过：请输入 ${expected}`,
      );
    }
    const jobId = selected.jobId;
    const rows = await this.prisma.platformBackup.findMany({
      where: { jobId },
    });
    const databaseRow =
      selected.kind === 'DATABASE'
        ? selected
        : rows.find((row) => row.kind === 'DATABASE');
    const codeRow =
      selected.kind === 'CODE'
        ? selected
        : rows.find((row) => row.kind === 'CODE');
    if (!databaseRow) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该备份组缺少数据库备份，无法还原。请改选包含数据库备份的记录',
      );
    }
    if (body.mode === 'FULL' && !codeRow) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该备份组缺少代码备份，无法完整还原。可改为「仅还原数据库」，或选择其他备份',
      );
    }
    for (const row of [databaseRow, codeRow].filter(Boolean)) {
      await verifyBackup(row!.manifestPath);
    }
    const deploy = deployment();
    if (deploy.hostUpgradeRequired) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前是 Docker 部署，容器内不能替换自身镜像。请在宿主机执行：${deploy.hostCommand}`,
      );
    }
    const job = await this.prisma.platformUpgradeJob.create({
      data: {
        type: 'RESTORE',
        status: 'PENDING',
        backupId: selected.id,
        fromVersion: currentVersion(),
        toVersion: databaseRow.version,
        progress: 0,
        operatorId: user.userId,
        optionsJson: JSON.stringify({ mode: body.mode }),
      },
    });
    await this.ensureSteps(job.id, RESTORE_STEPS);
    await this.launch(job, {
      type: 'RESTORE',
      restore: {
        mode: body.mode,
        databaseManifest: databaseRow.manifestPath,
        codeManifest: body.mode === 'FULL' ? codeRow!.manifestPath : '',
      },
    });
    await this.audit(
      user,
      '发起平台还原',
      `#${job.id} 备份 #${selected.id}，${body.mode === 'FULL' ? '代码+数据库' : '仅数据库'}`,
    );
    return this.get(job.id);
  }

  /**
   * AI 编程改码：编辑集来自暂存区（已采纳文件），这里把它们快照进任务目录后交给 runner。
   * 备份、维护模式、构建、迁移、重启、回滚全部与平台升级共用同一套步骤实现。
   */
  async createCodeEdit(
    user: CurrentUser,
    input: {
      sessionId: number;
      title: string;
      fromVersion: string;
      stagingDir: string;
      files: { path: string; changeType: 'added' | 'modified' | 'deleted' }[];
      options: {
        backupDatabase: boolean;
        backupCode: boolean;
        autoRollback: boolean;
        conflictStrategy: 'overwrite' | 'abort';
      };
    },
  ) {
    await this.assertIdle();
    if (!input.files.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有已采纳的变更，无法执行改码',
      );
    }
    if (!input.options.backupDatabase) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '执行前必须备份数据库，这是一项强制安全步骤',
      );
    }
    const deploy = deployment();
    if (deploy.hostUpgradeRequired) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前是 Docker 部署，容器内不能替换自身。请在宿主机执行：${deploy.hostCommand}`,
      );
    }
    const tools = upgradeTools();
    if (!tools.available) {
      const missing = [
        !tools.dumpAvailable ? tools.dump : '',
        !tools.archiveAvailable ? tools.archive : '',
      ]
        .filter(Boolean)
        .join('、');
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `改码预检未通过：服务器缺少 ${missing || tools.dump}。请按「平台升级」页的安装指引处理后重启后端`,
      );
    }
    if (diskFreeBytes() > 0 && diskFreeBytes() < 512 * 1024 * 1024) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '改码预检未通过：update 目录所在磁盘剩余空间不足 512MB，请先清理空间',
      );
    }
    const job = await this.prisma.platformUpgradeJob.create({
      data: {
        type: 'CODE_EDIT',
        status: 'PENDING',
        sourceKind: 'CODE_EDIT',
        sourceRefId: input.sessionId,
        fromVersion: input.fromVersion,
        toVersion: input.fromVersion,
        progress: 0,
        operatorId: user.userId,
        optionsJson: JSON.stringify(input.options),
      },
    });
    await this.ensureSteps(job.id, CODE_EDIT_STEPS);
    const dir = resolve(jobsDir(), String(job.id));
    const snapshotDir = resolve(dir, 'code-edit');
    let copied = 0;
    try {
      mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
      for (const file of input.files) {
        if (file.changeType === 'deleted') continue;
        const source = resolve(input.stagingDir, 'files', file.path);
        if (!existsSync(source)) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `暂存区缺少文件内容：${file.path}，请重新审阅变更`,
          );
        }
        const dest = resolve(snapshotDir, 'files', file.path);
        mkdirSync(resolve(dest, '..'), { recursive: true, mode: 0o700 });
        cpSync(source, dest);
        copied += 1;
      }
      writeFileSync(
        resolve(snapshotDir, 'manifest.json'),
        JSON.stringify({ files: input.files }, null, 2),
        { mode: 0o600 },
      );
    } catch (error) {
      // 快照失败要立刻收掉任务，否则 PENDING 会一直占住「同一时间只允许一个任务」。
      await this.prisma.platformUpgradeJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: (error instanceof Error
            ? error.message
            : '编辑集快照失败'
          ).slice(0, 1000),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
    await this.launch(job, {
      type: 'CODE_EDIT',
      codeEdit: { manifest: resolve(snapshotDir, 'manifest.json') },
      options: input.options,
    });
    await this.audit(
      user,
      '发起 AI 编程改码',
      `#${job.id} 会话 #${input.sessionId}：${input.files.length} 个文件（含内容 ${copied}）`,
    );
    return this.get(job.id);
  }

  private async assertIdle() {
    const active = await this.prisma.platformUpgradeJob.findFirst({
      where: {
        type: { in: ['ANALYSIS', 'UPGRADE', 'RESTORE', 'CODE_EDIT'] },
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { id: 'desc' },
    });
    if (active) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `已有任务正在进行（#${active.id} ${active.type}），请等待完成后再操作`,
      );
    }
  }

  async activeJob() {
    const row = await this.prisma.platformUpgradeJob.findFirst({
      where: {
        type: { in: ['UPGRADE', 'RESTORE', 'CODE_EDIT'] },
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { id: 'desc' },
    });
    if (!row) return null;
    return this.get(row.id);
  }

  /** AI 编程页只看改码任务；空表示当前没有在执行。 */
  async codeEditActiveJob() {
    const row = await this.prisma.platformUpgradeJob.findFirst({
      where: {
        type: 'CODE_EDIT',
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { id: 'desc' },
    });
    if (!row) return null;
    return this.get(row.id);
  }

  async get(id: number): Promise<UpgradeJob> {
    const job = await this.prisma.platformUpgradeJob.findUnique({
      where: { id },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    if (job.status === 'RUNNING' || job.status === 'PENDING') {
      await this.sync(job);
    }
    const [fresh, steps] = await Promise.all([
      this.prisma.platformUpgradeJob.findUnique({ where: { id } }),
      this.prisma.platformUpgradeStep.findMany({
        where: { jobId: id },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return jobView(fresh || job, steps);
  }

  async cancel(user: CurrentUser, id: number) {
    const job = await this.prisma.platformUpgradeJob.findUnique({
      where: { id },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    if (!['PENDING', 'RUNNING'].includes(job.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已结束，无需取消',
      );
    }
    const dir = job.jobDir || resolve(jobsDir(), String(id));
    if (existsSync(dir)) {
      writeFileSync(resolve(dir, 'cancel'), timestamp(), { mode: 0o600 });
    }
    await this.audit(user, '取消平台升级任务', `#${id}`);
    return this.get(id);
  }

  async logs(id: number) {
    const job = await this.prisma.platformUpgradeJob.findUnique({
      where: { id },
    });
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    const file = resolve(
      job.jobDir || resolve(jobsDir(), String(id)),
      'job.log',
    );
    if (!existsSync(file)) return { text: '', updatedAt: '' };
    const size = statSync(file).size;
    const start = Math.max(0, size - 200_000);
    const content = readFileSync(file);
    return {
      text: content.subarray(start).toString('utf8'),
      updatedAt: new Date(statSync(file).mtimeMs).toISOString(),
    };
  }

  async backups() {
    const rows = await this.prisma.platformBackup.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      list: rows.map(backupView),
      totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    };
  }

  async removeBackup(user: CurrentUser, id: number) {
    const row = await this.prisma.platformBackup.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '备份不存在');
    const active = await this.prisma.platformUpgradeJob.findFirst({
      where: { id: row.jobId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (active) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该备份正在被任务使用，暂不能删除',
      );
    }
    const { rmSync } = await import('node:fs');
    rmSync(row.filePath, { force: true });
    rmSync(row.manifestPath, { force: true });
    await this.prisma.platformBackup.delete({ where: { id } });
    await this.audit(user, '删除平台备份', `#${id} ${row.kind} ${row.version}`);
    return { id };
  }

  async maintenance(): Promise<MaintenanceState> {
    if (this.maintenanceCache && Date.now() - this.maintenanceCache.at < 3000) {
      return this.maintenanceCache.value;
    }
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: MAINTENANCE_KEY },
    });
    let value: MaintenanceState = {
      on: false,
      reason: '',
      jobId: 0,
      startedAt: '',
    };
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as Partial<MaintenanceState>;
        value = {
          on: Boolean(parsed.on),
          reason: String(parsed.reason || ''),
          jobId: Number(parsed.jobId || 0),
          startedAt: String(parsed.startedAt || ''),
        };
      } catch {
        value = { on: false, reason: '', jobId: 0, startedAt: '' };
      }
    }
    this.maintenanceCache = { at: Date.now(), value };
    return value;
  }

  private async setMaintenance(value: MaintenanceState) {
    this.maintenanceCache = { at: Date.now(), value };
    await this.prisma.systemSetting.upsert({
      where: { key: MAINTENANCE_KEY },
      create: { key: MAINTENANCE_KEY, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }

  private async ensureSteps(
    jobId: number,
    steps: readonly (readonly [string, string])[],
  ) {
    await this.prisma.platformUpgradeStep.createMany({
      data: steps.map(([key, label], index) => ({
        jobId,
        stepKey: key,
        label,
        status: 'PENDING',
        sortOrder: index + 1,
      })),
    });
  }

  private async launch(
    job: PlatformUpgradeJob,
    payload: Record<string, unknown>,
  ) {
    const dir = resolve(jobsDir(), String(job.id));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    await this.prisma.platformUpgradeJob.update({
      where: { id: job.id },
      data: { jobDir: dir, status: 'PENDING', progress: 0 },
    });
    const steps =
      payload.type === 'RESTORE'
        ? RESTORE_STEPS
        : payload.type === 'CODE_EDIT'
          ? CODE_EDIT_STEPS
          : UPGRADE_STEPS;
    const config = {
      jobId: job.id,
      type: payload.type,
      installDir: installDir(),
      updateDir: updateDir(),
      jobDir: dir,
      fromVersion: job.fromVersion,
      toVersion: job.toVersion,
      candidateDir: payload.candidateDir || '',
      codeEdit: payload.codeEdit || null,
      options: payload.options || {},
      restore: payload.restore || null,
      deployment: runnerDeploymentConfig(),
      steps: steps.map(([key, label]) => ({ key, label })),
    };
    writeFileSync(resolve(dir, 'job.json'), JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    writeFileSync(resolve(dir, 'job.log'), '', { mode: 0o600 });
    atomicWrite(
      resolve(dir, 'state.json'),
      JSON.stringify({
        jobId: job.id,
        status: 'PENDING',
        progress: 0,
        currentStep: '',
        steps: config.steps.map((step) => ({ ...step, status: 'PENDING' })),
      }),
    );
    await this.setMaintenance({
      on: true,
      reason:
        payload.type === 'RESTORE'
          ? '平台正在还原备份，服务即将短暂停止'
          : payload.type === 'CODE_EDIT'
            ? '平台正在应用 AI 编程改动，服务即将短暂停止'
            : '平台正在升级，服务即将短暂停止',
      jobId: job.id,
      startedAt: timestamp(),
    });
    const runner = runnerScript();
    if (!existsSync(runner)) {
      await this.failLaunch(
        job.id,
        `升级执行器缺失：${runner}。请确认发布包包含 scripts/upgrade-runner.mjs`,
      );
      return;
    }
    try {
      const child = spawn(process.execPath, [runner, dir], {
        cwd: installDir(),
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      await this.audit(
        { userId: job.operatorId } as CurrentUser,
        '启动平台升级执行器',
        `#${job.id} pid=${child.pid || 0}`,
      );
    } catch (error) {
      await this.failLaunch(
        job.id,
        `升级执行器启动失败：${error instanceof Error ? error.message : '未知原因'}`,
      );
    }
  }

  private async failLaunch(jobId: number, message: string) {
    await this.prisma.platformUpgradeJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    });
    await this.setMaintenance({
      on: false,
      reason: '',
      jobId: 0,
      startedAt: '',
    });
    throw new BusinessException(ErrorCode.BAD_REQUEST, message);
  }

  private async sync(job: PlatformUpgradeJob) {
    const dir = job.jobDir || resolve(jobsDir(), String(job.id));
    const file = resolve(dir, 'state.json');
    if (!existsSync(file)) {
      if (Date.now() - job.updatedAt.getTime() > STALE_MS) {
        await this.finish(
          job,
          'INTERRUPTED',
          '执行器长时间没有回写状态，任务可能已中断',
        );
      }
      return;
    }
    let state: RunnerState;
    try {
      state = JSON.parse(readFileSync(file, 'utf8')) as RunnerState;
    } catch {
      return;
    }
    const terminal = ['SUCCESS', 'FAILED', 'CANCELLED', 'ROLLED_BACK'].includes(
      state.status,
    );
    await this.prisma.platformUpgradeJob.update({
      where: { id: job.id },
      data: {
        status: state.status === 'PENDING' ? job.status : state.status,
        progress: Number(state.progress || 0),
        currentStep: String(state.currentStep || ''),
        error: String(state.error || '').slice(0, 1000),
        ...(state.startedAt && !job.startedAt
          ? { startedAt: new Date(state.startedAt) }
          : {}),
        ...(terminal
          ? {
              finishedAt: state.finishedAt
                ? new Date(state.finishedAt)
                : new Date(),
            }
          : {}),
      },
    });
    for (const step of state.steps || []) {
      await this.prisma.platformUpgradeStep.updateMany({
        where: { jobId: job.id, stepKey: step.key },
        data: {
          status: step.status,
          message: String(step.message || '').slice(0, 1000),
          ...(step.startedAt ? { startedAt: new Date(step.startedAt) } : {}),
          ...(step.finishedAt ? { finishedAt: new Date(step.finishedAt) } : {}),
        },
      });
    }
    if (state.backups?.length) {
      for (const backup of state.backups) {
        const existing = await this.prisma.platformBackup.findFirst({
          where: { jobId: job.id, manifestPath: backup.manifestPath },
        });
        if (existing) continue;
        await this.prisma.platformBackup.create({
          data: {
            jobId: job.id,
            kind: backup.kind,
            version: backup.version || job.toVersion,
            dialect: backup.dialect || '',
            fileName: backup.archive.split(/[\\/]/).pop() || '',
            filePath: backup.archive,
            manifestPath: backup.manifestPath,
            bytes: backup.bytes,
            sha256: backup.sha256,
            verified: true,
            locked: true,
          },
        });
      }
    }
    if (
      terminal &&
      ![
        'SUCCESS',
        'FAILED',
        'CANCELLED',
        'ROLLED_BACK',
        'INTERRUPTED',
      ].includes(job.status)
    ) {
      await this.finish(
        { ...job, status: state.status },
        state.status,
        state.error || '',
      );
    }
  }

  private async finish(job: PlatformUpgradeJob, status: string, error: string) {
    await this.prisma.platformUpgradeJob.update({
      where: { id: job.id },
      data: {
        status,
        error: String(error || '').slice(0, 1000),
        finishedAt: new Date(),
        ...(status === 'SUCCESS' ? { progress: 100 } : {}),
      },
    });
    // 改码失败（含回滚）时把「已落地」的变更退回待审阅，管理员可以修完再来一次
    if (
      job.type === 'CODE_EDIT' &&
      ['FAILED', 'ROLLED_BACK', 'CANCELLED', 'INTERRUPTED'].includes(status)
    ) {
      await this.prisma.aiCodeEdit.updateMany({
        where: { appliedJobId: job.id, status: 'applied' },
        data: { status: 'approved', appliedJobId: null },
      });
    }
    await this.setMaintenance({
      on: false,
      reason: '',
      jobId: 0,
      startedAt: '',
    });
    await this.audit(
      { userId: job.operatorId } as CurrentUser,
      '平台升级任务结束',
      `#${job.id} ${status}${error ? `：${error}` : ''}`,
    );
  }

  private async audit(user: CurrentUser, action: string, detail: string) {
    try {
      await this.identity.audit(user.userId, action, detail);
    } catch {
      // 审计失败不影响升级执行
    }
  }
}
