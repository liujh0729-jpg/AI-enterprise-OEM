import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { ContractsService } from './contracts.service';
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}
  async list(user: CurrentUser) {
    return ok(await this.contracts.list(user));
  }
  async listPage(user: CurrentUser, page: number, pageSize: number) {
    return ok(await this.contracts.listPage(user, page, pageSize));
  }
  async listStats(user: CurrentUser) {
    return ok(await this.contracts.listStats(user));
  }
  async candidates(user: CurrentUser, serviceType?: string) {
    return ok(await this.contracts.candidates(user, serviceType));
  }
  /** 服务商资源库（营销/物流/资产等服务商页签共用）：已通过备案审核的服务商，可按省、市筛选。 */
  async providers(serviceType?: string, province?: string, city?: string) {
    return ok(
      await this.contracts.providerDirectory(serviceType, {
        province: province?.trim() || undefined,
        city: city?.trim() || undefined,
      }),
    );
  }
  async enterprises(user: CurrentUser) {
    return ok(await this.contracts.myEnterprises(user));
  }
  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(
      await this.contracts.create(user, {
        ...body,
        providerUserId: text(body.providerUserId || body.provider_id),
        service_type: text(body.service_type),
        note: text(body.note),
        agent_id: Number(body.agent_id || 0),
      }),
    );
  }
  async updateTerms(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.contracts.updateTerms(user, parseId(id), {
        ...body,
        start_date:
          body.start_date === undefined ? undefined : text(body.start_date),
        end_date: body.end_date === undefined ? undefined : text(body.end_date),
        note: body.note === undefined ? undefined : text(body.note),
      }),
    );
  }
  async remove(user: CurrentUser, id: string) {
    return ok(await this.contracts.remove(user, parseId(id)));
  }
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.contracts.updateContacts(user, parseId(id), body));
  }
  async confirm(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.contracts.confirm(user, parseId(id), body));
  }
  async terminate(user: CurrentUser, id: string) {
    return ok(await this.contracts.terminate(user, parseId(id)));
  }
  async staff(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.contracts.designateStaff(
        user,
        parseId(id),
        text(body.staff_name || ''),
        body,
      ),
    );
  }
  async agent(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.contracts.designateAgent(
        user,
        parseId(id),
        Number(body.agent_id || 0),
      ),
    );
  }
}
