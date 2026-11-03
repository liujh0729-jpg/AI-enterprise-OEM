import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { currentPeriods } from '../tax/tax-forms';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityService } from '../capability/capability.service';
import { QxyClient } from './qxy.client';
import { QxySettingsService } from './qxy-settings.service';
/**
 * 企享云 MCP 业务封装（需求 6.4 开发票 / 6.5 报税与开票走 MCP / 6.6 自动申报·自动开票）。
 * 前置：① 平台已为企业开通对应能力（E_TAX_FILING / E_INVOICING）；
 *      ② 企业已绑定企享云企业 ID（aggOrgId）。
 * 多数工具是异步任务：这里发起任务并把 taskId 落库，再按需查询结果。
 */
export class QxyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly capability: CapabilityService,
    private readonly client: QxyClient,
    private readonly accounts: QxySettingsService,
  ) {}
  async status() {
    return {
      configured: await this.client.configured(),
      base: String(process.env.QXY_MCP_BASE || 'https://mcp.qixiangyun.com'),
      reportMount: '/mcp/tax_init_calculation',
      invoiceMount: '/mcp/blue_invoice',
    };
  }
  /** 自检：列出报税与开票的工具名（联调用）。 */
  async probe() {
    const [tax, invoice] = await Promise.all([
      this.client.tools('/mcp/tax_init_calculation'),
      this.client.tools('/mcp/blue_invoice'),
    ]);
    return {
      tax: tax.map((item) => item.name),
      invoice: invoice.map((item) => item.name),
    };
  }
  /** 解析企业的企享云企业 ID（未绑定则提示绑定）。 */
  private async requireOrg(enterpriseId: number) {
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: enterpriseId },
    });
    if (!enterprise) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '企业不存在');
    }
    if (!enterprise.qxyOrgId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该企业尚未绑定企享云企业 ID（aggOrgId）：请先在「身份与资质 · 企业信息」或平台后台补充后再自动申报/开票',
      );
    }
    return enterprise;
  }
  /**
   * 通道作业权限（需求 6.4）：自动申报/自动开票属作业类动作，仅企业当事人**之外**的承办人可发起；
   * 查询类（filing-result / invoices）企业当事人可见自己的数据。
   */
  private async requireServe(
    user: CurrentUser,
    enterpriseId: number,
    work: boolean,
  ) {
    const allowed = await this.identity.canServeEnterprise(user, enterpriseId, {
      enterpriseParty: !work,
    });
    if (!allowed) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        work
          ? '自动申报/自动开票由承办财税服务的服务商或承办职员操作，企业侧只读'
          : '数据仅对承办人与企业当事人可见',
      );
    }
  }
  /** 校验：平台已为企业开通指定能力（服务商在「自动化能力」配置 → 平台审核通过）。 */
  private async requireCapability(enterpriseId: number, code: string) {
    const list = await this.capability.ofEnterprise(enterpriseId);
    const hit = list.find((item) => item.code === code);
    if (hit?.status !== 'OPEN') {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `${hit?.label || code}未开通：请先在「自动化能力」按服务企业配置，并经平台管理员审核通过`,
      );
    }
  }
  /** 按企业税号取报税 API Key（平台在「财税管理」匹配的账号）；未匹配时给出修复指引。 */
  private async credentialsOf(enterprise: { name: string; uscc: string }) {
    const credentials = await this.accounts.credentialsForTaxNo(
      enterprise.uscc,
    );
    if (!credentials)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${enterprise.name}」的税号未匹配企享云报税 API Key：请平台管理员在「财税管理」匹配账号后重试`,
      );
    return credentials;
  }
  /** 开票申请抢占前完成可预见的本地校验。 */
  async assertAutoInvoiceReady(user: CurrentUser, enterpriseId: number) {
    await this.requireServe(user, enterpriseId, true);
    await this.requireCapability(enterpriseId, 'E_INVOICING');
    const enterprise = await this.requireOrg(enterpriseId);
    await this.credentialsOf(enterprise);
  }
  /**
   * 自动申报（财务人员触发）：发起算税申报任务。
   * 走企税申报服务 `run_tax_calculation_and_filing`（异步）。
   * 必填：aggOrgId、yzpzzlDm（应征凭证种类代码，见企享云附录）、ssqQ/ssqZ（所属期起止）。
   * 增值税类申报（BDA0610606 / BDA0610611）另有企享云强校验：必须传未开票收入 wkpxse。
   */
  async autoFileTax(
    user: CurrentUser,
    enterpriseId: number,
    period?: string,
    yzpzzlDm?: string,
    wkpxse?: string,
  ) {
    await this.requireServe(user, enterpriseId, true);
    await this.requireCapability(enterpriseId, 'E_TAX_FILING');
    const enterprise = await this.requireOrg(enterpriseId);
    const credentials = await this.credentialsOf(enterprise);
    const code = String(yzpzzlDm || '').trim();
    const allowed = YZPZZL_DM.find((item) => item.code === code);
    if (!allowed) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请选择应征凭证种类代码（yzpzzlDm）：仅支持 ${YZPZZL_DM.map((item) => `${item.code}（${item.label}）`).join('、')}`,
      );
    }
    const args: Record<string, unknown> = {
      aggOrgId: enterprise.qxyOrgId,
      yzpzzlDm: code,
    };
    const range = periodRange(period);
    args.ssqQ = range.start;
    args.ssqZ = range.end;
    if (allowed.vat) {
      const value = String(wkpxse ?? '').trim();
      if (!value) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `${allowed.label}必须填写未开票收入（wkpxse），企享云算税需据此合并销售额`,
        );
      }
      args.wkpxse = value;
    } else if (String(wkpxse ?? '').trim()) {
      args.wkpxse = String(wkpxse).trim();
    }
    const result = await this.client.call(
      '/mcp/tax_init_calculation',
      'run_tax_calculation_and_filing',
      args,
      credentials,
    );
    await this.identity.audit(
      user.userId,
      '自动申报',
      `${enterprise.name}${period ? ` · ${period}` : ''} · ${allowed.label} → ${result.code}`,
    );
    if (!result.ok) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `自动申报失败：${result.message || result.code}`,
      );
    }
    return {
      enterpriseId,
      state: 'SUBMITTED',
      yzpzzlDm: code,
      yzpzzlLabel: allowed.label,
      wkpxse: args.wkpxse ?? null,
      period: range,
      code: result.code,
      message: result.message || '已发起自动申报任务',
      task: result.data,
    };
  }
  /** 查询自动申报任务结果（异步任务回查）。 */
  async queryFiling(user: CurrentUser, enterpriseId: number, taskId: string) {
    await this.requireServe(user, enterpriseId, false);
    await this.requireCapability(enterpriseId, 'E_TAX_FILING');
    const enterprise = await this.requireOrg(enterpriseId);
    const credentials = await this.credentialsOf(enterprise);
    const result = await this.client.call(
      '/mcp/tax_init_calculation',
      'query_tax_calculation_result',
      { aggOrgId: enterprise.qxyOrgId, taskId },
      credentials,
    );
    void user;
    return { code: result.code, message: result.message, task: result.data };
  }
  /**
   * 自动开票（数电蓝票）：按订单信息发起开票任务。
   * 走数电开票服务 `issue_blue_invoice_auto`（异步）。
   * 企享云要求 data 至少含：fplxdm、gmf_lx、gmf_nsrmc、xsf_nsrsbh、ly_ddbh、xmmx。
   */
  async autoIssueInvoice(
    user: CurrentUser,
    enterpriseId: number,
    input: {
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
    await this.requireServe(user, enterpriseId, true);
    await this.requireCapability(enterpriseId, 'E_INVOICING');
    const enterprise = await this.requireOrg(enterpriseId);
    const credentials = await this.credentialsOf(enterprise);
    const buyerName = String(input.buyerName || '').trim();
    if (!buyerName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写购方名称');
    }
    const items = (input.items || []).filter((item) =>
      String(item.goodsName || '').trim(),
    );
    if (!items.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少填写一条项目明细（货物或服务名称）',
      );
    }
    const data = {
      fplxdm: String(input.invoiceType || '04'),
      gmf_lx: String(input.buyerType || '1'),
      gmf_nsrmc: buyerName,
      gmf_nsrsbh: String(input.buyerTaxNo || ''),
      xsf_nsrsbh: enterprise.uscc,
      ly_ddbh:
        String(input.orderNo || '').trim() || invoiceOrderNo(enterpriseId),
      bz: String(input.remark || ''),
      xmmx: items.map((item, index) => {
        const quantity = Number(item.quantity ?? 1);
        const price = Number(item.price ?? item.amount ?? 0);
        const amount = Number(item.amount ?? quantity * price);
        const rate = String(item.taxRate || '6%').replace('%', '');
        const tax = Number(
          item.tax ??
            (Number.isFinite(amount) ? (amount * Number(rate)) / 100 : 0),
        );
        return {
          hh: index + 1,
          spbm: String(item.goodsCode || ''),
          hwmc: String(item.goodsName || ''),
          ggxh: String(item.spec || ''),
          sl: quantity,
          dj: price,
          je: Number(amount.toFixed(2)),
          slv: rate,
          se: Number(tax.toFixed(2)),
        };
      }),
    };
    const result = await this.client.call(
      '/mcp/blue_invoice',
      'issue_blue_invoice_auto',
      {
        aggOrgId: enterprise.qxyOrgId,
        nsrsbh: enterprise.uscc,
        data,
      },
      credentials,
    );
    await this.identity.audit(
      user.userId,
      '自动开票',
      `${enterprise.name} → ${buyerName} · ${data.fplxdm} → ${result.code}`,
    );
    if (!result.ok) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `自动开票失败：${result.message || result.code}`,
      );
    }
    return {
      enterpriseId,
      state: 'SUBMITTED',
      orderNo: data.ly_ddbh,
      code: result.code,
      message: result.message || '已发起开票任务',
      task: result.data,
    };
  }
  /** 已开发票查询（企业开好的发票统一查询与管理）。 */
  async invoices(
    user: CurrentUser,
    enterpriseId: number,
    query: {
      startDate?: string;
      endDate?: string;
      pageIndex?: number;
      pageSize?: number;
    } = {},
  ) {
    await this.requireServe(user, enterpriseId, false);
    const enterprise = await this.requireOrg(enterpriseId);
    const credentials = await this.credentialsOf(enterprise);
    // 已开发票查询：必填 aggOrgId、nsrsbh、kprqq/kprqz（开票日期起止）
    const range = periodRange(undefined, query.startDate, query.endDate);
    const result = await this.client.call(
      '/mcp/invoice_inquiry',
      'query_invoice_list_auto',
      {
        aggOrgId: enterprise.qxyOrgId,
        nsrsbh: enterprise.uscc,
        kprqq: range.start,
        kprqz: range.end,
        page_index: Number(query.pageIndex || 0),
        page_size: Number(query.pageSize || 10),
      },
      credentials,
    );
    return {
      code: result.code,
      message: result.message,
      list: result.data,
      period: currentPeriods(),
    };
  }
}
/** 应征凭证种类代码（企享云附录：https://opendoc.qixiangyun.com/sb/enum/sb_enum.html）。 */
export const YZPZZL_DM = [
  { code: 'BDA0610611', label: '增值税及附加税（小规模纳税人）', vat: true },
  { code: 'BDA0610606', label: '增值税及附加税（一般纳税人）', vat: true },
  { code: 'BDA0610100', label: '通用申报表（工会经费等）', vat: false },
  { code: 'BDA0611054', label: '非税收入通用申报表（垃圾处理费）', vat: false },
  {
    code: 'BDA0611159',
    label: '企业所得税A类（2021年版·查账征收）',
    vat: false,
  },
] as const;
/** 发票类型代码（企享云附录：https://opendoc.qixiangyun.com/fp/fp_fl.html）。 */
export const INVOICE_TYPES = [
  { code: '04', label: '增值税普通发票' },
  { code: '01', label: '增值税专用发票' },
  { code: '03', label: '机动车销售统一发票' },
] as const;
/** 购买方类型（数电开票口径）。 */
export const BUYER_TYPES = [
  { code: '1', label: '企业' },
  { code: '2', label: '个人' },
] as const;
/** 来源订单编号：企享云必填，按企业 + 时间生成业务可读单号。 */
function invoiceOrderNo(enterpriseId: number) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `AIPDD${enterpriseId}${stamp}`;
}
/**
 * 属期 → 所属期起止（yyyy-MM-dd）：
 * `YYYY-MM` 月报、`YYYY-Qn` 季报、`YYYY` 年报；缺省取当月；可显式指定起止。
 */
export function periodRange(
  period?: string,
  startDate?: string,
  endDate?: string,
) {
  if (startDate && endDate) return { start: startDate, end: endDate };
  const now = new Date();
  const value = String(period || '').trim();
  const year = Number(value.slice(0, 4)) || now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
  const quarter = /^\d{4}-Q([1-4])$/.exec(value);
  if (quarter) {
    const q = Number(quarter[1]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: `${year}-${pad(startMonth)}-01`,
      end: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`,
    };
  }
  const month = /^\d{4}-(\d{2})$/.exec(value);
  if (month) {
    const m = Number(month[1]);
    return {
      start: `${year}-${pad(m)}-01`,
      end: `${year}-${pad(m)}-${pad(lastDay(year, m))}`,
    };
  }
  if (/^\d{4}$/.test(value)) {
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  const m = now.getMonth() + 1;
  return {
    start: `${year}-${pad(m)}-01`,
    end: `${year}-${pad(m)}-${pad(lastDay(year, m))}`,
  };
}
