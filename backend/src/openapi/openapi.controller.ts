import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { ContractsService } from '../contracts/contracts.service';
import { FlexService } from '../flex/flex.service';
import { IdentityService } from '../identity/identity.service';
import { IpService } from '../ip/ip.service';
import { LegalService } from '../legal/legal.service';
import { LogisticsService } from '../logistics/logistics.service';
import { OverseasService } from '../overseas/overseas.service';
import { TaxService } from '../tax/tax.service';
import { ThinkTankService } from '../think-tank/think-tank.service';
export class OpenApiController {
  constructor(
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly logistics: LogisticsService,
    private readonly overseas: OverseasService,
    private readonly legal: LegalService,
    private readonly ip: IpService,
    private readonly flex: FlexService,
    private readonly tax: TaxService,
    private readonly thinkTank: ThinkTankService,
  ) {}
  async me(user: CurrentUser) {
    return ok(await this.identity.me(user));
  }
  async roles(user: CurrentUser) {
    const me = await this.identity.me(user);
    return ok({ roles: me.roles, currentIdentity: me.currentIdentity });
  }
  async switchRole(
    user: CurrentUser,
    body: {
      identity?: string;
      role?: string;
    },
  ) {
    return ok(
      await this.identity.switchIdentity(
        user,
        String(body.identity || body.role || ''),
      ),
    );
  }
  async contractsList(user: CurrentUser) {
    return ok(await this.contracts.list(user));
  }
  async createContract(user: CurrentUser, body: Record<string, unknown>) {
    return ok(
      await this.contracts.create(user, {
        providerUserId: text(body.providerUserId || body.provider_id),
        service_type: text(body.service_type),
        note: text(body.note),
        agent_id: Number(body.agent_id || 0),
      }),
    );
  }
  async confirm(user: CurrentUser, id: string) {
    return ok(await this.contracts.confirm(user, parseId(id)));
  }
  async terminate(user: CurrentUser, id: string) {
    return ok(await this.contracts.terminate(user, parseId(id)));
  }
  async taxList(user: CurrentUser) {
    return ok(await this.tax.listDeclarations(user));
  }
  async taxCreate(user: CurrentUser, body: Record<string, unknown>) {
    return ok(
      await this.tax.createDeclaration(user, {
        tax_type: text(body.tax_type),
        period: text(body.period),
        title: text(body.title),
        form_data: (body.form_data || {}) as Record<string, number>,
      }),
    );
  }
  async overseasList(user: CurrentUser) {
    return ok(await this.overseas.list(user));
  }
  async overseasCreate(
    user: CurrentUser,
    body: import('@enterprise/contracts').EndpointInput<'Overseas_create'>['body'],
  ) {
    return ok(await this.overseas.create(user, body));
  }
  async logisticsList(user: CurrentUser) {
    return ok(await this.logistics.list(user));
  }
  async logisticsCreate(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.logistics.create(user, body));
  }
  async logisticsMessages(user: CurrentUser, id: string) {
    return ok(await this.logistics.messages(user, parseId(id)));
  }
  async lawyers(
    kind?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(await this.legal.lawyers({ kind, province, city, keyword }));
  }
  async legalCreate(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.legal.createRequest(user, body));
  }
  async agencies(
    kind?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(await this.ip.agencies({ kind, province, city, keyword }));
  }
  async ipCreate(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.ip.create(user, 'BIZ', body));
  }
  async ipConsult(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.ip.create(user, 'CONSULT', body));
  }
  async flexProviders(
    recordType?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(
      await this.flex.providers({
        recordType,
        province,
        city,
        keyword,
      }),
    );
  }
  async flexOrder(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.flex.createWorkOrder(user, body));
  }
  async flexOrderGet(user: CurrentUser, id: string) {
    const list = await this.flex.listWorkOrders(user);
    const row = list.find((item) => item.id === parseId(id));
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '用工需求不存在');
    return ok(row);
  }
  async flexMatch(
    user: CurrentUser,
    body: {
      id?: number;
    },
  ) {
    return ok(await this.flex.match(user, parseId(body.id, '进件 ID')));
  }
  async flexOnboard(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.flex.createOnboarding(user, body));
  }
  async flexOnboardList(user: CurrentUser) {
    return ok(await this.flex.listOnboardings(user));
  }
  async thinkTankExperts(
    kind?: string,
    province?: string,
    city?: string,
    keyword?: string,
  ) {
    return ok(await this.thinkTank.experts({ kind, province, city, keyword }));
  }
  async thinkTankRequests(user: CurrentUser) {
    const page = await this.thinkTank.listPage(user, {});
    return ok(page.list);
  }
  async thinkTankCreate(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.thinkTank.create(user, body));
  }
  async keys(user: CurrentUser) {
    return ok(await this.identity.listApiKeys(user.userId));
  }
  async syncKey(user: CurrentUser) {
    return ok(await this.identity.createApiKey(user));
  }
  /** API Key 调用记录（调用日志与审计）：近 20 条 API 相关动作。 */
  async keyUsage(user: CurrentUser, keyId: string) {
    return ok(await this.identity.apiKeyUsage(user, parseId(keyId, 'Key ID')));
  }
}
