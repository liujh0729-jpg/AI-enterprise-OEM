import { fmtTime } from "@/lib/datetime";
import { money } from "@/lib/money";

/** 后端 /enterprise/tax/meta 返回：申报表模板与财务专员核对清单。 */
export type TaxFormMeta = { type: string; label: string };
export type TaxMeta = { forms: TaxFormMeta[]; advisor_checks: string[] };

/** 后端 /enterprise/tax/declarations 行（Prisma 原样返回）。 */
export type TaxDeclaration = {
  id: number;
  declNo: string;
  contractId: number;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  taxType: string;
  period: string;
  title: string;
  /** 申报表数据：数值字段 + basic（纳税人名称/识别号/所属期） */
  formData: Record<string, unknown>;
  taxAmount: string | number;
  status: string;
  aiSteps: {
    step?: number;
    text?: string;
    status?: string;
    note?: string;
    at?: string;
  }[];
  advisorConfirms: string[];
  qcStatus: string;
  qcNote: string;
  receiptNo: string;
  /** 环节联系方式（系统按承办人/企业档案自动带出，临时换人可改） */
  contactName?: string | null;
  contactPhone?: string | null;
  providerContactName?: string | null;
  providerContactPhone?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 后端 /enterprise/tax/account-sets 行（含申报计划统计与申报单汇总）。 */
export type AccountSetRow = {
  id: number;
  name: string;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  status: string;
  createdAt: string;
  plan_stats?: { done?: number; in_progress?: number; due?: number };
  decl_summary?: { count?: number };
};

/** 后端 /enterprise/tax/plans 行（申报计划，含账套与关联申报单回填字段）。 */
export type TaxPlanRow = {
  id: number;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  accountSetId: number | null;
  taxType: string;
  period: string;
  status: string;
  declarationId: number | null;
  enterprise_name: string;
  staff_name: string;
  account_set_name: string;
  decl_no: string;
  decl_status: string;
  tax_type_name: string;
  freq: string;
  template: string;
  declaration_tax_amount: string | number;
};

/** 账套申报进度：按该账套名下申报计划的状态统计（申报完成回写账套进度）。 */
export function planStatsOf(plans: TaxPlanRow[], accountSetId: number) {
  const rows = plans.filter(
    (item) => Number(item.accountSetId) === accountSetId,
  );
  return {
    total: rows.length,
    due: rows.filter((item) => item.status === "DUE").length,
    in_progress: rows.filter((item) => item.status === "IN_PROGRESS").length,
    done: rows.filter((item) => item.status === "DONE").length,
  };
}

/** 后端 /enterprise/tax/consultations 行。 */
export type ConsultationRow = {
  id: number;
  contractId: number;
  enterpriseId: number;
  providerUserId: string;
  staffUserId?: string;
  question: string;
  answer: string;
  status: string;
  createdAt: string;
};

/** 后端 /enterprise/contracts 行（用于企业/服务商名称回填）。 */
export type ContractRow = {
  id: number;
  contractNo: string;
  enterpriseId: number;
  enterpriseName: string;
  providerUserId: string;
  provider_name?: string;
  providerOrg?: string;
  serviceType: string;
  status: string;
  /** 承办人：财税为服务商指定的「财务专员」（未指派时为 null） */
  designatedStaff?: {
    name?: string;
    phone?: string;
    title?: string;
    email?: string;
  } | null;
  /** 签约联系方式：企业侧 / 执行侧（后端 ContactResolver 自动带出） */
  contactName?: string;
  contactPhone?: string;
  providerContactName?: string;
  providerContactPhone?: string;
};

/** 财税服务包参考价格（按纳税人类型）。 */
export const TAX_PLANS = [
  { type: "SMALL", name: "小规模纳税人", price: 360 },
  { type: "GENERAL", name: "一般纳税人", price: 990 },
];

/** 财税服务包含的 13 项服务内容。 */
export const TAX_SERVICES = [
  "增值税及附加税",
  "企业所得税",
  "印花税",
  "财务报表",
  "个人所得税",
  "残保金申报",
  "税务年度汇算清缴",
  "工商年检",
  "电子凭证及财务报表的下载",
  "旧账导入",
  "账套管理（记账）",
  "代扣代缴税款",
  "财务老师线上咨询",
];

/** 后端 /enterprise/tax/providers 行（已备案财税服务商）。 */
export type TaxProviderApp = {
  id: number;
  userId: string;
  orgName: string;
  uscc: string;
  qualification: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  intro: string;
  status: string;
  business_staff?: { name?: string; title?: string; phone?: string; email?: string }[];
};

/** 取数回退 / 时间 / 金额：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime, money };

export function taxTypeLabel(meta: TaxMeta, taxType: string): string {
  return meta.forms.find((item) => item.type === taxType)?.label || taxType || "—";
}

/** 申报单状态 → 步骤条当前步（对齐 demo：REJECTED 回到草稿步）。 */
export const DECL_STEP_INDEX: Record<string, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  CHECKING: 2,
  FILED: 3,
  PAID: 4,
  REJECTED: 0,
};

/** 申报表关键字段（与后端 tax-forms.ts 的 calcTaxAmount 入参一一对应）。 */
export const DECL_FORM_FIELDS: Record<
  string,
  { name: string; label: string }[]
> = {
  vat_general: [
    { name: "output_tax", label: "销项税额（元）" },
    { name: "input_tax", label: "进项税额（元）" },
  ],
  vat_small: [{ name: "taxable_sales", label: "应税销售额（元）" }],
  cit_quarter: [{ name: "profit", label: "利润总额（元）" }],
  cit_annual: [{ name: "taxable_income", label: "应纳税所得额（元）" }],
  stamp_duty: [{ name: "taxable_amount", label: "计税金额（元）" }],
  surtax: [{ name: "vat_payable", label: "增值税应纳税额（元）" }],
  iit_withholding: [
    { name: "income", label: "收入额（元）" },
    { name: "deduction", label: "减除费用（元）" },
  ],
  iit_operating_a: [{ name: "operating_income", label: "经营收入（元）" }],
  iit_operating_b: [{ name: "annual_income", label: "年度收入（元）" }],
  iit_operating_c: [{ name: "summary_income", label: "多处汇总收入（元）" }],
  ibp: [{ name: "payroll", label: "工资总额（元）" }],
};

export function declFormFields(taxType: string) {
  return DECL_FORM_FIELDS[taxType] || [{ name: "tax_amount", label: "应纳税额（元）" }];
}