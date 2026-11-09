import type { CurrentUser } from '../auth/current-user';
import type { MechanismService } from './mechanism.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

/**
 * §5.8 横切机制控制器。
 *
 * 一个类里放多组端点，按契约前缀拆成子对象交给 moduleHandlers：
 * `Webhook_*` → `controller.webhook`、`Rule_*` → `controller.rule` 等。
 * 各组都有 `list/save/remove` 这类同名方法，只有按前缀隔离才不会互相覆盖。
 */
export class MechanismController {
  constructor(private readonly service: MechanismService) {}

  readonly webhook = {
    list: (user: CurrentUser) => this.service.listWebhooks(user),
    save: (user: CurrentUser, body: Row) =>
      this.service.saveWebhook(user, body),
    remove: (user: CurrentUser, body: Row) =>
      this.service.removeWebhook(user, body),
    deliveries: (
      user: CurrentUser,
      query: PageQuery & { subscriptionId?: number; status?: string },
    ) => this.service.deliveries(user, query),
    replay: (user: CurrentUser, body: Row) => this.service.replay(user, body),
    test: (user: CurrentUser, body: Row) =>
      this.service.testWebhook(user, body),
  };

  readonly importer = {
    listMaps: (user: CurrentUser, query: { module?: string }) =>
      this.service.listMaps(user, query),
    saveMap: (user: CurrentUser, body: Row) => this.service.saveMap(user, body),
    removeMap: (user: CurrentUser, body: Row) =>
      this.service.removeMap(user, body),
    createJob: (user: CurrentUser, body: Row) =>
      this.service.createJob(user, body),
    jobs: (user: CurrentUser, query: PageQuery & { module?: string }) =>
      this.service.jobs(user, query),
    removeJob: (user: CurrentUser, body: Row) =>
      this.service.removeJob(user, body),
  };

  readonly exporter = {
    modules: () => this.service.modules(),
    createJob: (user: CurrentUser, body: Row) =>
      this.service.createExportJob(user, body),
    jobs: (user: CurrentUser, query: PageQuery) =>
      this.service.exportJobs(user, query),
    removeJob: (user: CurrentUser, body: Row) =>
      this.service.removeExportJob(user, body),
  };

  readonly report = {
    listCatalog: (
      user: CurrentUser,
      query: { module?: string; menuOnly?: boolean },
    ) => this.service.listCatalog(user, query),
    saveCatalog: (user: CurrentUser, body: Row) =>
      this.service.saveCatalog(user, body),
    removeCatalog: (user: CurrentUser, body: Row) =>
      this.service.removeCatalog(user, body),
  };

  readonly rule = {
    list: (user: CurrentUser, query: PageQuery & { event?: string }) =>
      this.service.listRules(user, query),
    save: (user: CurrentUser, body: Row) => this.service.saveRule(user, body),
    remove: (user: CurrentUser, body: Row) =>
      this.service.removeRule(user, body),
    test: (user: CurrentUser, body: Row) => this.service.testRule(user, body),
  };

  readonly share = {
    list: (user: CurrentUser, query: PageQuery & { kind?: string }) =>
      this.service.listShares(user, query),
    create: (user: CurrentUser, body: Row) =>
      this.service.createShare(user, body),
    update: (user: CurrentUser, body: Row) =>
      this.service.updateShare(user, body),
    remove: (user: CurrentUser, body: Row) =>
      this.service.removeShare(user, body),
  };

  readonly oidc = {
    listProviders: (user: CurrentUser) => this.service.listProviders(user),
    saveProvider: (user: CurrentUser, body: Row) =>
      this.service.saveProvider(user, body),
    removeProvider: (user: CurrentUser, body: Row) =>
      this.service.removeProvider(user, body),
    testProvider: (user: CurrentUser, body: Row) =>
      this.service.testProvider(user, body),
  };

  readonly assetPolicy = {
    getSharePolicy: (user: CurrentUser) => this.service.getSharePolicy(user),
    saveSharePolicy: (user: CurrentUser, body: Row) =>
      this.service.saveSharePolicy(user, body),
  };

  readonly sync = {
    listBindings: (
      user: CurrentUser,
      query: { channel?: string; domain?: string },
    ) => this.service.listBindings(user, query),
    saveBinding: (user: CurrentUser, body: Row) =>
      this.service.saveBinding(user, body),
    removeBinding: (user: CurrentUser, body: Row) =>
      this.service.removeBinding(user, body),
    overview: (user: CurrentUser) => this.service.syncOverview(user),
    runContacts: (user: CurrentUser, body: Row) =>
      this.service.runContacts(user, body),
    runAttendance: (user: CurrentUser, body: Row) =>
      this.service.runAttendance(user, body),
    sendMessage: (user: CurrentUser, body: Row) =>
      this.service.sendMessage(user, body),
  };

  readonly mechanism = {
    overview: (user: CurrentUser) => this.service.overview(user),
  };
}
