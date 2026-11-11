import type { CurrentUser } from '../auth/current-user';
import { ContentModelSettingService } from '../content/model-setting.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { deployment, updateDir } from './upgrade.config';
import { diskFreeBytes, upgradeTools } from './upgrade-backup.service';
import { packageView } from './upgrade.dto';
import { UpgradeAnalysisService } from './upgrade-analysis.service';
import { UpgradeJobService } from './upgrade-job.service';
import { UpgradePackageService } from './upgrade-package.service';
import { currentCommit, currentVersion } from './upgrade-version';

type UploadFile = {
  name: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
};

/** 平台升级控制器：AdminUpgrade_* 由 moduleHandlers 自动映射；上传走单独 multipart 路由。 */
export class UpgradeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packageService: UpgradePackageService,
    private readonly analysis: UpgradeAnalysisService,
    private readonly jobs: UpgradeJobService,
    private readonly settings: ContentModelSettingService,
    private readonly identity: IdentityService,
    private readonly requireAdmin: (user: CurrentUser) => void,
  ) {}

  private admin(user: CurrentUser) {
    this.requireAdmin(user);
    return user;
  }

  async overview(user: CurrentUser) {
    this.admin(user);
    const [latest, activeJob, maintenance, backupCount, slot] =
      await Promise.all([
        this.prisma.platformUpgradePackage.findFirst({
          orderBy: { createdAt: 'desc' },
        }),
        this.jobs.activeJob(),
        this.jobs.maintenance(),
        this.prisma.platformBackup.count(),
        this.settings.slotOf(user, 'text').catch(() => null),
      ]);
    return {
      currentVersion: currentVersion(),
      currentCommit: currentCommit(),
      deployment: { ...deployment(), updateDir: updateDir() },
      latestPackage: latest ? packageView(latest) : null,
      activeJob,
      maintenance: maintenance.on,
      backupCount,
      diskFreeBytes: diskFreeBytes(),
      tools: upgradeTools(),
      analysisModel: slot?.model || '',
    };
  }

  async packages(user: CurrentUser) {
    this.admin(user);
    return { list: await this.packageService.list() };
  }

  async check(user: CurrentUser) {
    this.admin(user);
    return this.packageService.check();
  }

  async download(
    user: CurrentUser,
    body: { mode: 'release' | 'source'; tag: string },
  ) {
    this.admin(user);
    const result = await this.packageService.download(
      body.mode,
      body.tag || '',
    );
    await this.identity.audit(
      user.userId,
      '下载平台升级包',
      `${result.source} ${result.version} ${result.fileName}`,
    );
    return result;
  }

  async removePackage(user: CurrentUser, id: string) {
    this.admin(user);
    const result = await this.packageService.remove(Number(id));
    await this.identity.audit(user.userId, '删除平台升级包', `#${id}`);
    return result;
  }

  async analyze(user: CurrentUser, body: { packageId: number }) {
    this.admin(user);
    const job = await this.analysis.createJob(user, Number(body.packageId));
    await this.identity.audit(
      user.userId,
      '发起平台升级分析',
      `#${job.id} 包 #${body.packageId}`,
    );
    return job;
  }

  async job(user: CurrentUser, id: string) {
    this.admin(user);
    return this.jobs.get(Number(id));
  }

  async logs(user: CurrentUser, id: string) {
    this.admin(user);
    return this.jobs.logs(Number(id));
  }

  async execute(
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
    this.admin(user);
    return this.jobs.createUpgrade(user, body);
  }

  async cancel(user: CurrentUser, id: string) {
    this.admin(user);
    return this.jobs.cancel(user, Number(id));
  }

  async backups(user: CurrentUser) {
    this.admin(user);
    return this.jobs.backups();
  }

  async restore(
    user: CurrentUser,
    body: {
      backupId: number;
      mode: 'FULL' | 'DATABASE';
      confirmation: string;
    },
  ) {
    this.admin(user);
    return this.jobs.createRestore(user, body);
  }

  async removeBackup(user: CurrentUser, id: string) {
    this.admin(user);
    return this.jobs.removeBackup(user, Number(id));
  }

  async upload(user: CurrentUser, file: UploadFile, versionHint: string) {
    this.admin(user);
    const result = await this.packageService.upload(file, versionHint);
    await this.identity.audit(
      user.userId,
      '上传平台升级包',
      `${result.version} ${result.fileName}`,
    );
    return result;
  }
}
