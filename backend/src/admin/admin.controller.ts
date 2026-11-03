import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { AdminService } from './admin.service';
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  async contractPage(
    user: CurrentUser,
    query: { page: number; pageSize: number; status?: string },
  ) {
    return ok(
      await this.admin.contractPage(
        user,
        query.page,
        query.pageSize,
        query.status,
      ),
    );
  }
  async appPage(user: CurrentUser, query: { page: number; pageSize: number }) {
    return ok(
      await this.admin.applicationPage(user, query.page, query.pageSize),
    );
  }
  async providerPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    return ok(await this.admin.providerPage(user, query.page, query.pageSize));
  }
  async capabilityPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    return ok(
      await this.admin.capabilityPage(user, query.page, query.pageSize),
    );
  }
  async requestPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    return ok(await this.admin.requestPage(user, query.page, query.pageSize));
  }
  async providerStats(user: CurrentUser) {
    return ok(await this.admin.providerStats(user));
  }
  async stats(user: CurrentUser) {
    return ok(await this.admin.stats(user));
  }
  async enterprises(user: CurrentUser, status?: string) {
    return ok(await this.admin.enterprises(user, status));
  }
  async users(user: CurrentUser) {
    return ok(await this.admin.listUsers(user));
  }
  async apps(user: CurrentUser, status?: string) {
    return ok(await this.admin.providerApplications(user, status));
  }
  async auditApp(
    user: CurrentUser,
    id: string,
    body: {
      action?: 'APPROVE' | 'REJECT';
      note?: string;
      items?: {
        item?: string;
        status?: string;
        note?: string;
      }[];
    },
  ) {
    return ok(
      await this.admin.auditProvider(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'APPROVE',
        body.note,
        body.items || [],
      ),
    );
  }
  async providers(user: CurrentUser) {
    return ok(await this.admin.providers(user));
  }
  async revoke(user: CurrentUser, userId: string, type: string) {
    return ok(await this.admin.toggleService(user, userId, type, 'revoke'));
  }
  async restore(user: CurrentUser, userId: string, type: string) {
    return ok(await this.admin.toggleService(user, userId, type, 'restore'));
  }
  /** 企业能力（电子报税 / 电子开票）：平台开通后企业才有对应功能。 */
  async capabilityRequests(user: CurrentUser) {
    return ok(await this.admin.capabilityRequests(user));
  }
  async capabilityMatrix(user: CurrentUser) {
    return ok(await this.admin.capabilityMatrix(user));
  }
  async capabilities(user: CurrentUser, id: string) {
    return ok(await this.admin.capabilities(user, parseId(id)));
  }
  async setCapability(
    user: CurrentUser,
    id: string,
    code: string,
    body: {
      action?: string;
      note?: string;
      qxyAccountId?: string;
    },
  ) {
    return ok(
      await this.admin.setCapability(
        user,
        parseId(id),
        code,
        String(body.action || 'open'),
        String(body.note || ''),
        String(body.qxyAccountId || ''),
      ),
    );
  }
  async settings(user: CurrentUser) {
    return ok(await this.admin.settings(user));
  }
  async saveSettings(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.admin.saveSettings(user, body));
  }
  /** GEO 每周采集任务量：本周计划 / 实际完成（未跑完顺延次日）。 */
  async geoCollectionStats(user: CurrentUser) {
    return ok(await this.admin.geoCollectionStats(user));
  }
  async flexPayroll(user: CurrentUser) {
    return ok(await this.admin.flexPayrollSwitch(user));
  }
  async saveFlexPayroll(
    user: CurrentUser,
    body: {
      enabled?: boolean;
    },
  ) {
    return ok(
      await this.admin.saveFlexPayrollSwitch(user, Boolean(body.enabled)),
    );
  }
  async contracts(user: CurrentUser) {
    return ok(await this.admin.contracts(user));
  }
}
