import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import {
  BUYER_TYPES,
  INVOICE_TYPES,
  QxyService,
  YZPZZL_DM,
} from './qxy.service';
/**
 * 企享云 MCP（报税 / 开票）：自动申报、自动开票、已开发票查询。
 * 前置：平台已开通对应企业能力，且企业已绑定企享云企业 ID。
 */
export class QxyController {
  constructor(private readonly qxy: QxyService) {}
  /** 通道状态（凭据是否已配置）。 */
  async status() {
    return ok(await this.qxy.status());
  }
  /** 自检：列出报税/开票子服务的工具名。 */
  async probe() {
    return ok(await this.qxy.probe());
  }
  /** 开票/申报用的枚举选项（应征凭证种类代码、发票类型、购买方类型）。 */
  options() {
    return ok({
      taxTypes: YZPZZL_DM,
      invoiceTypes: INVOICE_TYPES,
      buyerTypes: BUYER_TYPES,
    });
  }
  async autoFile(
    user: CurrentUser,
    id: string,
    body: {
      period?: string;
      yzpzzlDm?: string;
      wkpxse?: string;
    },
  ) {
    return ok(
      await this.qxy.autoFileTax(
        user,
        parseId(id),
        text(body.period),
        text(body.yzpzzlDm),
        text(body.wkpxse),
      ),
    );
  }
  async filingResult(user: CurrentUser, id: string, taskId?: string) {
    return ok(
      await this.qxy.queryFiling(user, parseId(id), String(taskId || '')),
    );
  }
  async autoInvoice(
    user: CurrentUser,
    id: string,
    body: {
      invoiceType?: string;
      buyerType?: string;
      buyerName?: string;
      buyerTaxNo?: string;
      orderNo?: string;
      remark?: string;
      items?: {
        goodsCode?: string;
        goodsName?: string;
        spec?: string;
        quantity?: number;
        price?: number;
        amount?: number;
        taxRate?: string;
        tax?: number;
      }[];
    },
  ) {
    return ok(await this.qxy.autoIssueInvoice(user, parseId(id), body));
  }
  /** 已开发票查询（企业开好的发票统一查询与管理）。 */
  async invoices(
    user: CurrentUser,
    id: string,
    startDate?: string,
    endDate?: string,
    pageIndex?: string,
    pageSize?: string,
  ) {
    return ok(
      await this.qxy.invoices(user, parseId(id), {
        startDate,
        endDate,
        pageIndex: Number(pageIndex || 0),
        pageSize: Number(pageSize || 10),
      }),
    );
  }
}
