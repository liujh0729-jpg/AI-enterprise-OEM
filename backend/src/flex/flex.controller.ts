import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { FlexService } from './flex.service';
export class FlexController {
  constructor(private readonly flex: FlexService) {}
  async payrollPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.flex.payrollPage(user, query));
  }
  async payrollStats(user: CurrentUser) {
    return ok(await this.flex.payrollStats(user));
  }
  async payrollDetail(user: CurrentUser, id: string) {
    return ok(await this.flex.payrollDetail(user, parseId(id)));
  }
  async onboardingPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.flex.onboardingPage(user, query));
  }
  async onboardingStats(user: CurrentUser) {
    return ok(await this.flex.onboardingStats(user));
  }
  async onboardingDetail(user: CurrentUser, id: string) {
    return ok(await this.flex.onboardingDetail(user, parseId(id)));
  }
  async listPage(
    user: CurrentUser,
    query: Parameters<FlexService['listPage']>[1],
  ) {
    return ok(await this.flex.listPage(user, query));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.flex.listStats(user));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.flex.detail(user, parseId(id)));
  }

  async providers(
    recordType?: string,
    recordTypeSnake?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(
      await this.flex.providers({
        recordType: recordType || recordTypeSnake,
        province,
        city,
        keyword,
      }),
    );
  }
  async createProvider(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.flex.createProvider(user, body));
  }
  async updateProvider(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.flex.updateProvider(user, parseId(id), body));
  }
  async removeProvider(user: CurrentUser, id: string) {
    return ok(await this.flex.removeProvider(user, parseId(id)));
  }
  async onboardings(user: CurrentUser) {
    return ok(await this.flex.listOnboardings(user));
  }
  async createOnboarding(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.flex.createOnboarding(user, body));
  }
  async uploadOnboardingAttachments(
    user: CurrentUser,
    body: {
      files?: {
        name?: string;
        size?: number;
        contentType?: string;
        contentBase64?: string;
      }[];
    },
  ) {
    return ok(await this.flex.uploadAttachments(user, body.files || []));
  }
  async auditOnboarding(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.flex.auditOnboarding(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'APPROVE',
        text(body.note || ''),
        body,
      ),
    );
  }
  async workOrders(user: CurrentUser, province?: string, city?: string) {
    return ok(await this.flex.listWorkOrders(user, { province, city }));
  }
  async createWorkOrder(
    user: CurrentUser,
    token: string,
    body: Record<string, string>,
  ) {
    return ok(await this.flex.createWorkOrder(user, body, token));
  }
  async match(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.flex.match(user, parseId(id), body));
  }
  async messages(user: CurrentUser, token: string, id: string) {
    return ok(await this.flex.messages(user, parseId(id), token));
  }
  async postMessage(
    user: CurrentUser,
    token: string,
    id: string,
    body: {
      text?: string;
      conversation_id?: string;
    },
  ) {
    return ok(
      await this.flex.postMessage(
        user,
        parseId(id),
        String(body.text || ''),
        token,
        String(body.conversation_id || ''),
      ),
    );
  }
  async candidates(
    user: CurrentUser,
    id: string,
    body: {
      candidates?: unknown[];
    },
  ) {
    return ok(
      await this.flex.addCandidates(user, parseId(id), body.candidates || []),
    );
  }
  async settlements(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.flex.addSettlement(user, parseId(id), body));
  }
  async publish(user: CurrentUser, token: string, id: string) {
    return ok(await this.flex.publish(user, parseId(id), token));
  }
  async updateWorkOrder(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.flex.updateWorkOrder(user, parseId(id), body));
  }
  async removeWorkOrder(user: CurrentUser, id: string) {
    return ok(await this.flex.removeWorkOrder(user, parseId(id)));
  }
  /** 改联系方式（临时换人）：企业当事人 / 承办人 / 平台管理员，不受状态限制。 */
  async updateWorkOrderContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.flex.updateContacts(user, parseId(id), body));
  }
  async updateOnboardingContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.flex.updateOnboardingContacts(user, parseId(id), body),
    );
  }
  async updatePayrollContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.flex.updatePayrollContacts(user, parseId(id), body));
  }
  async payrolls(user: CurrentUser) {
    return ok(await this.flex.listPayrolls(user));
  }
  async createPayroll(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.flex.createPayroll(user, body));
  }
  async auditPayroll(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.flex.auditPayroll(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'APPROVE',
        text(body.note || ''),
        body,
      ),
    );
  }
}
