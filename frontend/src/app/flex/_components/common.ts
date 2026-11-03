import { fmtTime } from "@/lib/datetime";
import { money } from "@/lib/money";

/** 后端 /enterprise/flex/providers 行（Prisma FlexProvider 原样返回）。 */
export type FlexProvider = {
  id: number;
  recordType: string;
  /** COMPANY（机构）/ INDIVIDUAL（个人） */
  kind: string;
  name: string;
  organization: string;
  /** 历史自由文本地区（不再录入、不再筛选，仅保留原值） */
  region: string;
  /** 所在省、市（2026-09-25 起资源库登记必选、筛选只按省市） */
  province?: string;
  city?: string;
  intro: string;
  fields?: unknown;
  licenseNo?: string;
  agents?: unknown;
  cases?: unknown;
  status: string;
  providerUserId: string;
  auditNote: string;
  createdAt: string;
};

/** 后端 /enterprise/flex/onboardings 行（form 为企业风控表表单快照）。 */
export type OnboardingFile = {
  id?: string;
  name: string;
  size?: number;
  url: string;
  uploaded_at?: string;
};

export type FlexOnboarding = {
  id: number;
  onboardingNo?: string;
  contractId: number;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  agentName: string;
  form: Record<string, string>;
  attachments: {
    key?: string;
    name?: string;
    requirement?: string;
    ready?: boolean;
    /** 该项材料实际上传的文件（平台 OSS） */
    files?: OnboardingFile[];
  }[];
  status: string;
  /** 企业侧联系方式（系统按企业档案带出，临时换人可改） */
  contactName?: string;
  contactPhone?: string;
  /** 执行侧联系方式（承办服务商/职员） */
  providerContactName?: string;
  providerContactPhone?: string;
  rejectNote: string;
  createdAt: string;
  auditedAt?: string | null;
};

/** 发薪员工明细（后端 employees JSON 数组元素）。 */
export type FlexPayrollEmployee = {
  name?: string;
  id_no?: string;
  bank_name?: string;
  bank_account?: string;
  amount?: number | string;
};

/** 用工需求候选人（候选人推荐、面试/到岗安排）。 */
export type FlexCandidate = {
  name?: string;
  stage?: string;
  note?: string;
  time?: string;
};

/** 用工需求结算记录（用工结算、费用台账、发票与合规凭证）。 */
export type FlexSettlement = {
  period?: string;
  amount?: number | string;
  invoice?: string;
  note?: string;
  time?: string;
};

/** 需求消息通道消息（后端 FlexWorkOrder.messages JSON 数组元素）。 */
export type FlexMessage = {
  role?: "ENTERPRISE" | "PROVIDER" | "SYSTEM" | string;
  name?: string;
  time?: string;
  text?: string;
};

/** 后端 /enterprise/flex/work-orders 行（用工需求台账；需求字段口径同 AIworkin §7.3）。 */
export type FlexWorkOrder=import('@enterprise/contracts').FlexWorkOrder;

/** 用工形式（后端 WORK_TYPE_LABELS）。 */
export const WORK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "FULLTIME", label: "全职" },
  { value: "PARTTIME", label: "兼职" },
  { value: "TEMPORARY", label: "临时" },
];

/** 候选人阶段（后端 CANDIDATE_STAGES）。 */
export const CANDIDATE_STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "RECOMMENDED", label: "已推荐" },
  { value: "INTERVIEW", label: "面试中" },
  { value: "HIRED", label: "已到岗" },
  { value: "REJECTED", label: "未通过" },
];

export function workTypeLabel(value: unknown): string {
  return (
    WORK_TYPE_OPTIONS.find((item) => item.value === value)?.label ||
    String(value || "—")
  );
}

export function candidateStageLabel(value: unknown): string {
  return (
    CANDIDATE_STAGE_OPTIONS.find((item) => item.value === value)?.label ||
    String(value || "—")
  );
}

/** 后端 /enterprise/flex/payrolls 行。 */
export type FlexPayroll = {
  id: number;
  payrollNo: string;
  contractId: number;
  enterpriseId: number;
  providerUserId: string;
  agentName: string;
  period: string;
  employees: FlexPayrollEmployee[];
  totalAmount: string | number;
  note: string;
  status: string;
  /** 企业侧联系方式（系统按企业档案带出，临时换人可改） */
  contactName?: string;
  contactPhone?: string;
  /** 执行侧联系方式（承办代理人） */
  providerContactName?: string;
  providerContactPhone?: string;
  rejectNote: string;
  createdAt: string;
  auditedAt?: string | null;
};

/** 后端 /enterprise/contracts 行（用于企业名称 / 签约代理人回填）。 */
export type FlexContract = {
  id: number;
  contractNo: string;
  enterpriseId: number;
  enterpriseName: string;
  providerUserId: string;
  provider_name?: string;
  providerOrg?: string;
  serviceType: string;
  status: string;
  /** 承办代理人 = 资源库 AGENT 记录 id（签约时指派，可更换） */
  designatedAgentId?: number;
  designatedAgentName?: string;
};

/** 后端 /enterprise/staff/affiliations/mine 行（挂靠申请）。 */
export type AffiliationRow = {
  id: number;
  staffUserId: string;
  providerUserId: string;
  category: string;
  status: string;
  note: string;
};

/** 服务领域（登记表单可选项，2026-09-25 收敛为灵活用工板块的 6 类）。 */
export const PROVIDER_FIELDS: string[] = [
  "全职招聘",
  "兼职招聘",
  "临时用工",
  "劳务派遣",
  "岗位外包",
  "薪酬结算",
];

/** 进件附件清单（与 demo ONBOARDING_ATTACHMENTS 一致，8 项）。 */
export const ONBOARDING_ATTACHMENTS: {
  key: string;
  name: string;
  requirement: string;
}[] = [
  {
    key: "license",
    name: "营业执照照片",
    requirement: "营业执照照片清晰完整、在有效期内",
  },
  {
    key: "legal_id",
    name: "法人身份证照片",
    requirement: "法人身份证正反面照片",
  },
  {
    key: "bank_permit",
    name: "开户许可证",
    requirement: "开户许可证或银行开户证明材料",
  },
  {
    key: "office_photo",
    name: "门头照片+办公场景照片",
    requirement:
      "门头照需有公司 LOGO，如没有需法人手持营业执照在办公场景拍照片；办公场景照需要有人",
  },
  {
    key: "biz_scene",
    name: "业务场景照",
    requirement: "业务场景照需和业务描述相符",
  },
  {
    key: "main_contract",
    name: "主营业务协议+发票",
    requirement: "主营业务合同（收入合同）不过期，发票单张金额不能低于两万",
  },
  {
    key: "social_security",
    name: "社保缴纳记录（3 人以上）",
    requirement:
      "社保及纳税记录需提供半年以内、非本月的；成立 1 年以上三选一，成立六个月不满 1 年三选二",
  },
  {
    key: "tax_record",
    name: "企业纳税记录",
    requirement: "纳税记录需提供半年以内、非本月的",
  },
];

/** 取数回退 / 时间 / 金额：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime, money };

/** 服务案例文案（demo flex.js：title（result），多条以「；」连接）。 */
export function caseText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .filter((item) => item && String((item as { title?: string }).title || ""))
    .map((item) => {
      const row = item as { title?: string; result?: string };
      return `${row.title}（${row.result || ""}）`;
    })
    .join("；");
}

/** 身份证号脱敏：保留前 4 后 4（demo maskId）。 */
export function maskId(value: unknown): string {
  const v = String(value || "");
  return v.length >= 10 ? `${v.slice(0, 4)}＊＊＊＊${v.slice(-4)}` : v;
}

/** 银行卡号脱敏：仅留尾号 4 位（demo maskBank）。 */
export function maskBank(value: unknown): string {
  const v = String(value || "");
  return v.length >= 8 ? `**** ${v.slice(-4)}` : v;
}

/** 进件编号（JJ 前缀，后端 onboardingNo；历史数据缺失时按主键回显）。 */
export function onboardingNo(row: FlexOnboarding): string {
  return row.onboardingNo || `JJ${String(row.id).padStart(4, "0")}`;
}

/** 签约代理人下拉项文案（demo：机构（合同号）· 承办：代理人）。 */
export function contractLabel(contract: FlexContract): string {
  const org = contract.providerOrg || contract.provider_name || "—";
  const agent = contract.designatedAgentName
    ? ` · 承办：${contract.designatedAgentName}`
    : "";
  return `${org}（${contract.contractNo}）${agent}`;
}