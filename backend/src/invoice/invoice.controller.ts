import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { InvoiceService, type InvoiceRequestInput } from './invoice.service';
/**
 * 开发票申请（需求 6.4）：企业申请 → 财税承办人审核 → 企享云自动开票。
 * 企业已开好的发票统一查询在 `/enterprise/qxy/enterprises/:id/invoices`。
 */
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}
  /** 企业发起开票申请。 */
  async create(user: CurrentUser, body: InvoiceRequestInput) {
    return ok(await this.invoices.create(user, body));
  }
  /** 申请列表（按身份给范围：企业看本企业、承办人看承办的、管理员全量）。 */
  async page(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      status?: string;
      enterpriseId?: number;
    },
  ) {
    return ok(await this.invoices.page(user, query));
  }
  async stats(user: CurrentUser, query: { enterpriseId?: number }) {
    return ok(await this.invoices.stats(user, query));
  }
  async list(user: CurrentUser, status?: string) {
    return ok(await this.invoices.list(user, text(status)));
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.invoices.detail(user, parseId(id)));
  }
  /** 审核通过 → 立即发起企享云自动开票。 */
  async approve(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.invoices.approve(user, parseId(id), text(body?.note), body),
    );
  }
  /** 驳回（须附原因）。 */
  async reject(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(
      await this.invoices.reject(user, parseId(id), text(body?.reason), body),
    );
  }
  /** 改联系方式（临时换人）：申请人 / 财税承办人 / 平台管理员。 */
  async updateContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.invoices.updateContacts(user, parseId(id), body));
  }
  /** 企业撤回自己尚未审核的申请。 */
  async cancel(user: CurrentUser, id: string) {
    return ok(await this.invoices.cancel(user, parseId(id)));
  }
}
