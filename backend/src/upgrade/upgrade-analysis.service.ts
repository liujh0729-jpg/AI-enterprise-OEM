import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import type { UpgradeAnalysis, UpgradeRisk } from '@enterprise/contracts';
import { upgradeAnalysisSchema } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { ContentModelSettingService } from '../content/model-setting.service';
import { protocolHeaders } from '../content/model-catalog.service';
import { httpRequest } from '../http/transport';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { installDir } from './upgrade.config';
import { jobView, packageView } from './upgrade.dto';
import { UpgradePackageService } from './upgrade-package.service';
import {
  currentCommit,
  currentVersion,
  compareVersions,
} from './upgrade-version';

const IGNORED = new Set([
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
const MAX_FILES = 30_000;

type Facts = {
  fromVersion: string;
  toVersion: string;
  fromCommit: string;
  sameVersion: boolean;
  changed: { added: string[]; removed: string[]; modified: string[] };
  modules: string[];
  migrations: { name: string; risk: UpgradeRisk; note: string }[];
  dependencies: { name: string; from: string; to: string; change: string }[];
  envChanges: { added: string[]; removed: string[]; changed: string[] };
  conflicts: string[];
  blockers: string[];
  warnings: string[];
  candidateFiles: number;
};

type Fingerprint = { size: number; hash: string };

function hashFile(file: string, size: number) {
  if (size > 256 * 1024) return '';
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

function walk(root: string, prefix = '', out = new Map<string, Fingerprint>()) {
  if (out.size > MAX_FILES) return out;
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, prefix), {
      withFileTypes: true,
      encoding: 'utf8',
    });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (IGNORED.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'logs' || entry.name === 'tmp') continue;
      walk(root, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(log|lock)$/i.test(entry.name) && entry.name !== 'pnpm-lock.yaml')
      continue;
    const full = join(root, rel);
    try {
      const size = statSync(full).size;
      out.set(rel, { size, hash: hashFile(full, size) });
    } catch {
      // 单个文件读不到不影响整体差异分析
    }
  }
  return out;
}

function moduleOf(path: string) {
  const parts = path.split('/');
  if (parts[0] === 'backend' && parts[1] === 'src' && parts[2]) {
    return `backend/${parts[2]}`;
  }
  if (parts[0] === 'frontend' && parts[1] === 'src' && parts[2]) {
    return `frontend/${parts[2]}`;
  }
  return parts[0] || path;
}

function migrationDirs(root: string) {
  const dir = resolve(root, 'backend/prisma/migrations');
  if (!existsSync(dir)) return [] as string[];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationRisk(
  root: string,
  name: string,
): { risk: UpgradeRisk; note: string } {
  const file = resolve(
    root,
    'backend/prisma/migrations',
    name,
    'migration.sql',
  );
  if (!existsSync(file)) return { risk: 'medium', note: '缺少 migration.sql' };
  const sql = readFileSync(file, 'utf8').slice(0, 8000);
  const destructive =
    /\b(DROP\s+(TABLE|COLUMN|DATABASE)|TRUNCATE|RENAME\s+COLUMN)\b/i.test(sql);
  const typeChange = /\bMODIFY\s+COLUMN\b/i.test(sql);
  if (destructive)
    return { risk: 'high', note: '包含删除类语句，升级前必须有数据库备份' };
  if (typeChange)
    return { risk: 'medium', note: '包含字段类型调整，注意数据兼容' };
  return { risk: 'low', note: '普通结构变更' };
}

function dependencyChanges(current: string, candidate: string) {
  const files = [
    'package.json',
    'backend/package.json',
    'frontend/package.json',
    'packages/contracts/package.json',
  ];
  const read = (root: string, file: string) => {
    try {
      const pkg = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {
      return {};
    }
  };
  const changes: Facts['dependencies'] = [];
  for (const file of files) {
    const before = read(current, file);
    const after = read(candidate, file);
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const name of names) {
      if (before[name] === after[name]) continue;
      changes.push({
        name,
        from: before[name] || '',
        to: after[name] || '',
        change: !before[name] ? '新增' : !after[name] ? '移除' : '版本调整',
      });
      if (changes.length >= 80) return changes;
    }
  }
  return changes;
}

function envKeys(file: string) {
  if (!existsSync(file)) return new Map<string, string>();
  const map = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function envChanges(current: string, candidate: string) {
  const files = [
    '.env.example',
    'backend/.env.example',
    'frontend/.env.example',
  ];
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const file of files) {
    const before = envKeys(resolve(current, file));
    const after = envKeys(resolve(candidate, file));
    for (const key of after.keys()) {
      if (!before.has(key)) added.push(key);
      else if (before.get(key) !== after.get(key)) changed.push(key);
    }
    for (const key of before.keys()) {
      if (!after.has(key)) removed.push(key);
    }
  }
  return {
    added: [...new Set(added)].slice(0, 100),
    removed: [...new Set(removed)].slice(0, 100),
    changed: [...new Set(changed)].slice(0, 100),
  };
}

function localChanges() {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd: installDir(),
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
}

/**
 * 升级分析：先采集确定性事实（文件、迁移、依赖、环境变量、本地改动），
 * 再交给平台管理员配置的文本模型生成建议；模型不可用时回退规则结论。
 */
export class UpgradeAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: UpgradePackageService,
    private readonly settings: ContentModelSettingService,
    private readonly identity: IdentityService,
  ) {}

  async createJob(user: CurrentUser, packageId: number) {
    const active = await this.prisma.platformUpgradeJob.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (active) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `已有${active.type === 'ANALYSIS' ? '分析' : '升级'}任务正在进行（#${active.id}），请等待完成`,
      );
    }
    const pkg = await this.packages.get(packageId);
    if (!pkg.extracted || !pkg.candidateDir) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '升级包尚未完成校验，请重新下载或上传',
      );
    }
    const job = await this.prisma.platformUpgradeJob.create({
      data: {
        type: 'ANALYSIS',
        status: 'RUNNING',
        packageId,
        fromVersion: currentVersion(),
        toVersion: pkg.version,
        progress: 5,
        operatorId: user.userId,
        startedAt: new Date(),
      },
    });
    await this.prisma.platformUpgradeStep.createMany({
      data: [
        {
          jobId: job.id,
          stepKey: 'collect',
          label: '采集代码差异',
          status: 'RUNNING',
          sortOrder: 1,
          startedAt: new Date(),
        },
        {
          jobId: job.id,
          stepKey: 'agent',
          label: '生成升级建议',
          status: 'PENDING',
          sortOrder: 2,
        },
        {
          jobId: job.id,
          stepKey: 'save',
          label: '保存分析结果',
          status: 'PENDING',
          sortOrder: 3,
        },
      ],
    });
    void this.run(job.id, user, pkg.candidateDir, pkg.version);
    return this.view(job.id);
  }

  async view(id: number) {
    const [job, steps] = await Promise.all([
      this.prisma.platformUpgradeJob.findUnique({ where: { id } }),
      this.prisma.platformUpgradeStep.findMany({
        where: { jobId: id },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    if (!job) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    return jobView(job, steps);
  }

  async latestForPackage(packageId: number) {
    const row = await this.prisma.platformUpgradeJob.findFirst({
      where: { type: 'ANALYSIS', packageId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.view(row.id);
  }

  private async run(
    jobId: number,
    user: CurrentUser,
    candidateDir: string,
    toVersion: string,
  ) {
    try {
      const facts = this.collectFacts(candidateDir, toVersion);
      await this.step(
        jobId,
        'collect',
        'SUCCESS',
        `变更 ${facts.changed.added.length + facts.changed.removed.length + facts.changed.modified.length} 个文件`,
      );
      await this.prisma.platformUpgradeJob.update({
        where: { id: jobId },
        data: { progress: 45, currentStep: 'agent' },
      });
      await this.step(jobId, 'agent', 'RUNNING', '');
      const advice = await this.advise(user, facts);
      await this.step(
        jobId,
        'agent',
        'SUCCESS',
        advice.source === 'agent' ? `模型：${advice.model}` : '规则分析',
      );
      await this.step(jobId, 'save', 'RUNNING', '');
      await this.prisma.platformUpgradeJob.update({
        where: { id: jobId },
        data: {
          status: 'SUCCESS',
          progress: 100,
          currentStep: 'save',
          adviceJson: JSON.stringify(advice),
          finishedAt: new Date(),
          error: '',
        },
      });
      await this.step(jobId, 'save', 'SUCCESS', '分析完成');
      await this.identity.audit(
        user.userId,
        '平台升级分析完成',
        `#${jobId} → ${toVersion}，风险 ${advice.risk}`,
      );
    } catch (error) {
      const message = String(
        error instanceof Error ? error.message : '分析失败',
      ).slice(0, 900);
      await this.prisma.platformUpgradeJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
      await this.step(jobId, 'agent', 'FAILED', message).catch(() => undefined);
    }
  }

  private async step(
    jobId: number,
    key: string,
    status: 'RUNNING' | 'SUCCESS' | 'FAILED',
    message: string,
  ) {
    await this.prisma.platformUpgradeStep.updateMany({
      where: { jobId, stepKey: key },
      data: {
        status,
        message: message.slice(0, 1000),
        ...(status === 'RUNNING'
          ? { startedAt: new Date() }
          : { finishedAt: new Date() }),
      },
    });
  }

  private collectFacts(candidateDir: string, toVersion: string): Facts {
    const current = installDir();
    const currentFiles = walk(current);
    const candidateFiles = walk(candidateDir);
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    for (const [file, info] of candidateFiles) {
      const before = currentFiles.get(file);
      if (!before) added.push(file);
      else if (
        before.size !== info.size ||
        (info.hash && before.hash !== info.hash)
      ) {
        modified.push(file);
      }
    }
    for (const file of currentFiles.keys()) {
      if (!candidateFiles.has(file)) removed.push(file);
    }
    const modules = [
      ...new Set([...added, ...removed, ...modified].map(moduleOf)),
    ].slice(0, 30);
    const currentMigrations = new Set(migrationDirs(current));
    const migrations = migrationDirs(candidateDir)
      .filter((name) => !currentMigrations.has(name))
      .map((name) => ({ name, ...migrationRisk(candidateDir, name) }));
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!toVersion || toVersion === 'unknown') {
      blockers.push('无法识别升级包版本号，请重新上传并填写版本号');
    } else if (compareVersions(toVersion, currentVersion()) <= 0) {
      blockers.push(`目标版本 ${toVersion} 不高于当前版本 ${currentVersion()}`);
    }
    const dirty = localChanges();
    const conflicts = dirty.filter(
      (file) => added.includes(file) || modified.includes(file),
    );
    if (conflicts.length) {
      warnings.push(`有 ${conflicts.length} 个本地改动文件会被升级包覆盖`);
    }
    const env = envChanges(current, candidateDir);
    if (env.added.length) {
      warnings.push(`新增 ${env.added.length} 个环境变量，升级后需人工补齐`);
    }
    const critical = migrations.filter((item) => item.risk === 'high');
    if (critical.length) {
      warnings.push(
        `${critical.length} 个迁移包含删除类语句，必须保留数据库备份`,
      );
    }
    return {
      fromVersion: currentVersion(),
      toVersion,
      fromCommit: currentCommit(),
      sameVersion: compareVersions(toVersion, currentVersion()) <= 0,
      changed: {
        added: added.slice(0, 1000),
        removed: removed.slice(0, 1000),
        modified: modified.slice(0, 1000),
      },
      modules,
      migrations,
      dependencies: dependencyChanges(current, candidateDir),
      envChanges: env,
      conflicts: conflicts.slice(0, 100),
      blockers,
      warnings,
      candidateFiles: candidateFiles.size,
    };
  }

  private async advise(
    user: CurrentUser,
    facts: Facts,
  ): Promise<UpgradeAnalysis> {
    const rules = this.rules(facts);
    try {
      const target = await this.settings.resolveTarget(user, 'text');
      const base = String(target.baseUrl || '').replace(/\/+$/, '');
      if (!base || !target.apiKey || !target.model) return rules;
      const anthropic = target.protocol === 'anthropic';
      const prompt = [
        '你是企业平台的升级分析 Agent。只能基于下面的事实给出升级建议，不要臆造事实。',
        '只输出一个 JSON 对象，字段：risk(low|medium|high|blocked)、summary、modules(string[])、migrations({name,risk,note}[])、dependencies({name,from,to,change}[])、envChanges({added,removed,changed})、conflicts(string[])、blockers(string[])、downtime、strategy(string[])、preChecks(string[])、postChecks(string[])、rollback(string[])、evidence({file,reason}[])、notice。',
        'risk=blocked 表示当前不能升级；migrations 必须使用事实里的迁移清单，不要新增。',
        `事实：${JSON.stringify(facts).slice(0, 14_000)}`,
      ].join('\n');
      const response = await httpRequest<string>(
        anthropic ? `${base}/messages` : `${base}/chat/completions`,
        {
          method: 'POST',
          headers: {
            ...protocolHeaders(target.apiKey, target.protocol),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            anthropic
              ? {
                  model: target.model,
                  max_tokens: 2400,
                  messages: [{ role: 'user', content: prompt }],
                }
              : {
                  model: target.model,
                  temperature: 0,
                  max_tokens: 2400,
                  messages: [
                    {
                      role: 'system',
                      content: '你是平台升级分析 Agent，只输出 JSON。',
                    },
                    { role: 'user', content: prompt },
                  ],
                },
          ),
          timeoutMs: 90_000,
          readAs: 'text',
          operation: 'upgrade:analysis',
        },
      );
      if (!response.ok)
        return {
          ...rules,
          notice: `模型调用失败（HTTP ${response.status}），已使用规则分析`,
        };
      const payload = JSON.parse(response.data) as Record<string, unknown>;
      let content = '';
      if (anthropic) {
        const blocks = Array.isArray(payload.content) ? payload.content : [];
        content = blocks
          .map((block) =>
            block &&
            typeof block === 'object' &&
            typeof (block as Record<string, unknown>).text === 'string'
              ? String((block as Record<string, unknown>).text)
              : '',
          )
          .join('');
      } else {
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const message = ((choices[0] || {}) as Record<string, unknown>)
          .message as Record<string, unknown> | undefined;
        content = typeof message?.content === 'string' ? message.content : '';
      }
      const parsed = parseAdvice(content);
      if (!parsed) {
        return {
          ...rules,
          notice: '模型输出不是有效的升级建议 JSON，已使用规则分析',
        };
      }
      return {
        ...parsed,
        source: 'agent',
        model: target.model,
        notice: parsed.notice || '',
      };
    } catch {
      return {
        ...rules,
        notice:
          '未找到可用的平台文本模型，已使用规则分析；可在「模型设置」配置平台管理员的文本渠道后重试',
      };
    }
  }

  private rules(facts: Facts): UpgradeAnalysis {
    const highMigrations = facts.migrations.filter(
      (item) => item.risk === 'high',
    );
    const risk: UpgradeRisk = facts.blockers.length
      ? 'blocked'
      : highMigrations.length || facts.warnings.length >= 3
        ? 'high'
        : facts.migrations.length || facts.dependencies.length
          ? 'medium'
          : 'low';
    const summary = facts.blockers.length
      ? `当前不建议直接升级：${facts.blockers[0]}`
      : `从 ${facts.fromVersion} 升级到 ${facts.toVersion}：变更 ${facts.changed.added.length + facts.changed.removed.length + facts.changed.modified.length} 个文件、${facts.migrations.length} 个数据库迁移、${facts.dependencies.length} 项依赖调整，风险等级 ${risk}。`;
    return {
      risk,
      summary,
      modules: facts.modules,
      migrations: facts.migrations,
      dependencies: facts.dependencies,
      envChanges: facts.envChanges,
      conflicts: facts.conflicts,
      blockers: facts.blockers,
      downtime: '预计 3–15 分钟（安装依赖、构建与迁移耗时取决于服务器性能）',
      strategy: [
        '先完成数据库与代码备份，再停止服务',
        '安装依赖并构建，构建成功后执行数据库迁移',
        '启动服务并通过健康检查确认版本与数据库可用',
      ],
      preChecks: [
        '确认磁盘剩余空间足够（升级包与备份至少需要 3 倍空间）',
        ...(facts.envChanges.added.length
          ? [`补齐新增环境变量：${facts.envChanges.added.join('、')}`]
          : []),
        ...(facts.conflicts.length
          ? ['确认本地改动是否需要保留，必要时先合并']
          : []),
      ],
      postChecks: [
        '访问 /health/ready 确认数据库就绪',
        '确认登录、模型设置与核心列表页可用',
      ],
      rollback: [
        '使用升级前数据库备份与代码备份执行「一键还原」',
        '若仅数据库异常，可先尝试「仅还原数据库」',
      ],
      evidence: facts.migrations.map((item) => ({
        file: `backend/prisma/migrations/${item.name}`,
        reason: item.note,
      })),
      source: 'rules',
      model: '',
      notice: '',
    };
  }
}

function parseAdvice(raw: string): UpgradeAnalysis | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = upgradeAnalysisSchema.safeParse(
      JSON.parse(text.slice(start, end + 1)),
    );
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      source: 'agent',
      model: '',
    };
  } catch {
    return null;
  }
}

export function analysisPackageView(row: Parameters<typeof packageView>[0]) {
  return packageView(row);
}
