import {
  HRM_APP_STATUSES,
  HRM_EMPLOYMENT_TYPES,
  HRM_INTERVIEW_DIMENSIONS,
  HRM_JOB_STATUSES,
  HRM_PROFILE_STATUSES,
  HRM_TIMEOFF_STATUSES,
  HRM_TIMEOFF_TYPES,
  HRM_TIERS,
} from "@enterprise/contracts";

/** HRM 界面中文口径（§5.1）：枚举值只用于提交，界面不出现裸枚举。 */

export const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "全职",
  LABOR: "劳务",
  AGENT: "代理人",
};

export const PROFILE_STATUS_LABELS: Record<string, string> = {
  PROBATION: "试用期",
  ACTIVE: "在职",
  LEFT: "已离职",
};

export const TIMEOFF_TYPE_LABELS: Record<string, string> = {
  ANNUAL: "年假",
  SICK: "病假",
  PERSONAL: "事假",
  MARRY: "婚假",
  BEREAVEMENT: "丧假",
  UNPAID: "无薪假",
};

export const TIMEOFF_STATUS_LABELS: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
  CANCELLED: "已撤销",
  REVOKED: "已收回",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  OPEN: "招聘中",
  CLOSED: "已关闭",
  FILLED: "已招满",
  CANCELED: "已取消",
};

export const APP_STATUS_LABELS: Record<string, string> = {
  NEW: "新投递",
  SCREENING: "筛选中",
  INTERVIEWING: "面试中",
  OFFER: "已发 Offer",
  REJECTED: "已淘汰",
  WITHDRAWN: "已撤回",
};

export const INTERVIEW_DIMENSION_LABELS: Record<string, string> = {
  HARD_SKILL: "专业能力",
  SOFT: "通用素质",
  EXPERIENCE: "经验匹配",
  STABILITY: "稳定性",
  CULTURE: "文化契合",
  WILL: "意愿动机",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  PENDING: "待确认",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  EXPIRED: "已过期",
};

export const REVIEW_KIND_LABELS: Record<string, string> = {
  PROBATION: "转正",
  YEAR: "年度",
  QUARTER: "季度",
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "default",
  REVOKED: "volcano",
  ACTIVE: "green",
  PROBATION: "blue",
  LEFT: "default",
  OPEN: "green",
  CLOSED: "default",
  FILLED: "blue",
  CANCELED: "default",
  NEW: "blue",
  SCREENING: "gold",
  INTERVIEWING: "geekblue",
  OFFER: "purple",
  WITHDRAWN: "default",
  ACCEPTED: "green",
  DECLINED: "red",
  EXPIRED: "default",
  DONE: "green",
  SCHEDULED: "blue",
};

export const optionsOf = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const EMPLOYMENT_OPTIONS = HRM_EMPLOYMENT_TYPES.map((value) => ({
  value,
  label: EMPLOYMENT_LABELS[value],
}));
export const PROFILE_STATUS_OPTIONS = HRM_PROFILE_STATUSES.map((value) => ({
  value,
  label: PROFILE_STATUS_LABELS[value],
}));
export const TIMEOFF_TYPE_OPTIONS = HRM_TIMEOFF_TYPES.map((value) => ({
  value,
  label: TIMEOFF_TYPE_LABELS[value],
}));
export const TIMEOFF_STATUS_OPTIONS = HRM_TIMEOFF_STATUSES.map((value) => ({
  value,
  label: TIMEOFF_STATUS_LABELS[value],
}));
export const JOB_STATUS_OPTIONS = HRM_JOB_STATUSES.map((value) => ({
  value,
  label: JOB_STATUS_LABELS[value],
}));
export const APP_STATUS_OPTIONS = HRM_APP_STATUSES.map((value) => ({
  value,
  label: APP_STATUS_LABELS[value],
}));
export const INTERVIEW_DIMENSION_OPTIONS = HRM_INTERVIEW_DIMENSIONS.map(
  (value) => ({ value, label: INTERVIEW_DIMENSION_LABELS[value] }),
);
export const TIER_OPTIONS = HRM_TIERS.map((value) => ({ value, label: value }));

export function hrmError(err: unknown): string {
  return (err as Error)?.message || "操作失败，请稍后重试";
}

export function formatMoney(value: string | number | undefined): string {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : "—";
}

export function shortDate(value: string | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}
