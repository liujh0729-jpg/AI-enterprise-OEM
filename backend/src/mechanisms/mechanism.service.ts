import type { CurrentUser } from '../auth/current-user';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { MechanismListener, PageQuery, Row } from './mechanism.shared';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AccountCrypto } from '../account/account-crypto';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MechanismBase } from './mechanism.base';
import { MechanismEventService } from './mechanism-event.service';
import type {
  RuleTaskAssign,
  RuleWorkflowInvoke,
} from './mechanism-event.service';
import { MechanismExportService } from './mechanism-export.service';
import { MechanismImportService } from './mechanism-import.service';
import { MechanismOidcService } from './mechanism-oidc.service';
import { MechanismReportService } from './mechanism-report.service';
import { MechanismRuleService } from './mechanism-rule.service';
import { MechanismShareService } from './mechanism-share.service';
import { MechanismSyncService } from './mechanism-sync.service';
import { MechanismWebhookService } from './mechanism-webhook.service';

/**
 * §5.8 横切机制门面：对外保持单一入口，内部按 Webhook / 事件 / 导入导出 /
 * 报表 / 规则 / 分享 / OIDC / 渠道同步拆成独立服务。
 */
export class MechanismService extends MechanismBase {
  private readonly webhooks: MechanismWebhookService;
  private readonly events: MechanismEventService;
  private readonly imports: MechanismImportService;
  private readonly exports: MechanismExportService;
  private readonly reports: MechanismReportService;
  private readonly rules: MechanismRuleService;
  private readonly shares: MechanismShareService;
  private readonly oidc: MechanismOidcService;
  private readonly sync: MechanismSyncService;

  constructor(
    prisma: PrismaService,
    scope: HrmScopeService,
    crypto: AccountCrypto,
    storage: StorageService,
    notifications: NotificationService,
    requirePlatformAdmin: (user: CurrentUser) => void,
  ) {
    super(prisma, scope, crypto, storage, notifications, requirePlatformAdmin);
    this.webhooks = new MechanismWebhookService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.events = new MechanismEventService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
      this.webhooks,
    );
    this.imports = new MechanismImportService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.exports = new MechanismExportService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.reports = new MechanismReportService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.rules = new MechanismRuleService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.shares = new MechanismShareService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.oidc = new MechanismOidcService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
    this.sync = new MechanismSyncService(
      prisma,
      scope,
      crypto,
      storage,
      notifications,
      requirePlatformAdmin,
    );
  }

  async overview(user: CurrentUser) {
    const org = await this.org(user);
    const where = { orgType: org.orgType, orgUserId: org.orgUserId };
    const [
      webhooks,
      outboxPending,
      outboxFailed,
      importJobs,
      exportJobs,
      reports,
      rules,
      shares,
      oidcProviders,
    ] = await Promise.all([
      this.prisma.webhookSubscription.count({ where }),
      this.prisma.webhookOutbox.count({
        where: { ...where, status: 'PENDING' },
      }),
      this.prisma.webhookOutbox.count({
        where: { ...where, status: 'FAILED' },
      }),
      this.prisma.importJob.count({ where }),
      this.prisma.exportJob.count({ where }),
      this.prisma.biReportCatalog.count({ where: { enabled: true } }),
      this.prisma.ruleDefinition.count({ where }),
      this.prisma.publicShare.count({ where }),
      this.prisma.oidcProvider.count({ where: { enabled: true } }),
    ]);
    return {
      webhooks,
      outboxPending,
      outboxFailed,
      importJobs,
      exportJobs,
      reports,
      rules,
      shares,
      oidcProviders,
    };
  }

  async listWebhooks(user: CurrentUser) {
    return this.webhooks.listWebhooks(user);
  }

  async saveWebhook(user: CurrentUser, body: Row) {
    return this.webhooks.saveWebhook(user, body);
  }

  async removeWebhook(user: CurrentUser, body: Row) {
    return this.webhooks.removeWebhook(user, body);
  }

  async deliveries(
    user: CurrentUser,
    query: PageQuery & { subscriptionId?: number; status?: string },
  ) {
    return this.webhooks.deliveries(user, query);
  }

  async replay(user: CurrentUser, body: Row) {
    return this.webhooks.replay(user, body);
  }

  async testWebhook(user: CurrentUser, body: Row) {
    return this.webhooks.testWebhook(user, body);
  }

  on(event: string, handler: MechanismListener) {
    return this.events.on(event, handler);
  }

  async dispatch(org: HrmOrg, event: string, payload: Row) {
    return this.events.dispatch(org, event, payload);
  }

  /** 规则动作 run_workflow / assign_task 的进程内执行器（装配时回填）。 */
  useWorkflowInvoker(port: RuleWorkflowInvoke) {
    this.events.useWorkflowInvoker(port);
  }

  useTaskAssigner(port: RuleTaskAssign) {
    this.events.useTaskAssigner(port);
  }

  async listMaps(user: CurrentUser, query: { module?: string }) {
    return this.imports.listMaps(user, query);
  }

  async saveMap(user: CurrentUser, body: Row) {
    return this.imports.saveMap(user, body);
  }

  async removeMap(user: CurrentUser, body: Row) {
    return this.imports.removeMap(user, body);
  }

  async createJob(user: CurrentUser, body: Row) {
    return this.imports.createJob(user, body);
  }

  async jobs(user: CurrentUser, query: PageQuery & { module?: string }) {
    return this.imports.jobs(user, query);
  }

  async removeJob(user: CurrentUser, body: Row) {
    return this.imports.removeJob(user, body);
  }

  registerExportModule(
    definition: { module: string; label: string; columns: string[] },
    rows: (org: HrmOrg, filters: Row) => Promise<Row[]>,
  ) {
    return this.exports.registerExportModule(definition, rows);
  }

  modules() {
    return this.exports.modules();
  }

  async createExportJob(user: CurrentUser, body: Row) {
    return this.exports.createExportJob(user, body);
  }

  async exportJobs(user: CurrentUser, query: PageQuery) {
    return this.exports.exportJobs(user, query);
  }

  async removeExportJob(user: CurrentUser, body: Row) {
    return this.exports.removeExportJob(user, body);
  }

  async downloadExport(user: CurrentUser, id: string) {
    return this.exports.download(user, id);
  }

  async listCatalog(
    user: CurrentUser,
    query: { module?: string; menuOnly?: boolean },
  ) {
    return this.reports.listCatalog(user, query);
  }

  async saveCatalog(user: CurrentUser, body: Row) {
    return this.reports.saveCatalog(user, body);
  }

  async removeCatalog(user: CurrentUser, body: Row) {
    return this.reports.removeCatalog(user, body);
  }

  async listRules(user: CurrentUser, query: PageQuery & { event?: string }) {
    return this.rules.listRules(user, query);
  }

  async saveRule(user: CurrentUser, body: Row) {
    return this.rules.saveRule(user, body);
  }

  async removeRule(user: CurrentUser, body: Row) {
    return this.rules.removeRule(user, body);
  }

  async testRule(user: CurrentUser, body: Row) {
    return this.rules.testRule(user, body);
  }

  async listShares(user: CurrentUser, query: PageQuery & { kind?: string }) {
    return this.shares.listShares(user, query);
  }

  async createShare(user: CurrentUser, body: Row) {
    return this.shares.createShare(user, body);
  }

  async updateShare(user: CurrentUser, body: Row) {
    return this.shares.updateShare(user, body);
  }

  async removeShare(user: CurrentUser, body: Row) {
    return this.shares.removeShare(user, body);
  }

  async publicView(slugValue: string, password = '') {
    return this.shares.publicView(slugValue, password);
  }

  async getSharePolicy(user: CurrentUser) {
    return this.shares.getSharePolicy(user);
  }

  async saveSharePolicy(user: CurrentUser, body: Row) {
    return this.shares.saveSharePolicy(user, body);
  }

  async listProviders(user: CurrentUser) {
    return this.oidc.listProviders(user);
  }

  async saveProvider(user: CurrentUser, body: Row) {
    return this.oidc.saveProvider(user, body);
  }

  async removeProvider(user: CurrentUser, body: Row) {
    return this.oidc.removeProvider(user, body);
  }

  async testProvider(user: CurrentUser, body: Row) {
    return this.oidc.testProvider(user, body);
  }

  async oidcProviderByCode(code: string) {
    return this.oidc.oidcProviderByCode(code);
  }

  async oidcAuthorizeUrl(code: string, redirectUri: string, state: string) {
    return this.oidc.oidcAuthorizeUrl(code, redirectUri, state);
  }

  async oidcExchange(code: string, authCode: string, redirectUri: string) {
    return this.oidc.oidcExchange(code, authCode, redirectUri);
  }

  async listBindings(
    user: CurrentUser,
    query: { channel?: string; domain?: string },
  ) {
    return this.sync.listBindings(user, query);
  }

  async saveBinding(user: CurrentUser, body: Row) {
    return this.sync.saveBinding(user, body);
  }

  async removeBinding(user: CurrentUser, body: Row) {
    return this.sync.removeBinding(user, body);
  }

  async syncOverview(user: CurrentUser) {
    return this.sync.syncOverview(user);
  }

  async runContacts(user: CurrentUser, body: Row) {
    return this.sync.runContacts(user, body);
  }

  async runAttendance(user: CurrentUser, body: Row) {
    return this.sync.runAttendance(user, body);
  }

  async sendMessage(user: CurrentUser, body: Row) {
    return this.sync.sendMessage(user, body);
  }
}
