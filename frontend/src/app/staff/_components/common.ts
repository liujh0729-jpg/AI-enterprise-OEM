import { fmtDate, fmtTime } from "@/lib/datetime";
import { SUBITEM_LABELS } from "@/lib/provider-categories";

/** 后端 /enterprise/staff 行（ProviderStaff + staff_name + profile）。 */
export type ProviderStaffRow = {
  id: number;
  providerUserId: string;
  staffUserId: string;
  roles?: string[];
  status: string;
  createdAt: string;
  staff_name?: string;
  /** 后端缺口：AIworkin 账号名（后端仅返回 staffUserId）。 */
  username?: string;
  profile?: {
    realName?: string;
    phone?: string;
    email?: string;
    region?: string;
    categories?: string[];
    qualification?: string;
    intro?: string;
  } | null;
};

/**
 * 后端 /enterprise/staff/affiliations 行（StaffApplication 原样返回）。
 * applicant_name / applicant_phone / position / category_label / profile / audit_note
 * 为 demo 字段，NestJS 后端当前未返回（见页面说明），故均为可选。
 */
export type StaffApplicationRow = {
  id: number;
  staffUserId: string;
  providerUserId: string;
  category: string;
  status: string;
  note: string;
  createdAt: string;
  auditedAt?: string | null;
  /** STAFF_APPLY＝职员发起挂靠；PROVIDER_INVITE＝服务商发起添加申请（双向确认）。 */
  direction?: string;
  /** 待确认的添加申请：发起时勾选的类目编码（逗号分隔）。 */
  roles?: string | null;
  /** 后端 myInvitations/myAffiliations 附加：机构展示名 + 类目/角色中文。 */
  provider_name?: string;
  category_label?: string;
  role_labels?: string[];
  applicant_name?: string;
  applicant_username?: string;
  applicant_phone?: string;
  applicant_email?: string;
  position?: string;
  audit_note?: string;
  profile?: {
    real_name?: string;
    phone?: string;
    qualification?: string;
    intro?: string;
    categories?: string[];
  } | null;
};

/** 后端 /enterprise/staff/search 行（仅返回已提交个人资料的账号）。 */
export type StaffSearchRow = {
  userId: string;
  real_name: string;
  phone: string;
  categories: string[];
  /** 后端缺口：昵称 / 账号名 / 是否已绑定（demo 字段，后端未返回）。 */
  nickname?: string;
  username?: string;
  bound?: boolean;
  has_profile?: boolean;
};

/** 后端 /enterprise/staff/roles 行（角色与服务类目一致，可多选）。 */
export type StaffRoleOption = { role: string; category: string; code: string };

/** 后端 /enterprise/contracts/my-enterprises 行（用于企业分配统计）。 */
export type ProviderEnterpriseRow = {
  id: number;
  name: string;
  uscc?: string;
  taxpayerType?: string;
  industry?: string;
  staffUserId?: string;
  staffName?: string;
};

export type { ProviderStaffOption } from "@/app/contracts/_components/contract-dialogs";

/**
 * 服务类目文案（对齐 demo STAFF_CAT_LABEL）。
 * 出海 / 营销职员按**细项**挂靠（`StaffApplication.category` ＝ 细项 code），
 * 故细项 code 也要有中文，不能显示裸枚举。
 */
export const STAFF_CATEGORY_LABEL: Record<string, string> = {
  TAX_FINANCE: "企业财税",
  LOGISTICS: "物流服务",
  SMART_SERVICE: "IT服务",
  LEGAL_SERVICE: "法律服务",
  IP_SERVICE: "知识产权",
  FLEX_WORK: "灵活用工",
  SUPPLY_NETWORK: "供销服务",
  MARKETING: "营销服务",
  ...SUBITEM_LABELS,
};

export function categoryLabel(category: string) {
  return STAFF_CATEGORY_LABEL[category] || category || "—";
}

export { fmtTime, fmtDate };

/** 职员展示名（个人资料真实姓名优先）。 */
export function staffDisplayName(row: ProviderStaffRow) {
  return row.profile?.realName || row.staff_name || row.staffUserId;
}

/** 挂靠申请展示名（后端未返回申请人姓名时回退 AIworkin 账号）。 */
export function applicantDisplay(row: StaffApplicationRow) {
  return (
    row.applicant_name ||
    row.profile?.real_name ||
    row.staffUserId ||
    "—"
  );
}