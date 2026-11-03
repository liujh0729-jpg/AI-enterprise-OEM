/**
 * 用户主体类型（用户身份下三分）：企业 / 个体工商户 / 个人。
 * 认证材料随主体类型改变；**个人主体整页可浏览，但「签约 / 申报 / 账套 / 发布需求」四类办理动作限企业与个体工商户**。
 */
export const SUBJECT_LABELS: Record<string, string> = {
  COMPANY: "企业",
  INDIVIDUAL: "个体工商户",
  PERSONAL: "个人",
};

export const SUBJECT_OPTIONS = [
  { value: "COMPANY", label: "企业" },
  { value: "INDIVIDUAL", label: "个体工商户" },
  { value: "PERSONAL", label: "个人" },
] as const;

export function subjectLabel(value: unknown): string {
  return SUBJECT_LABELS[String(value || "").toUpperCase()] || "企业";
}

/** 是否个人主体（财税 / 出海四类办理动作限企业与个体工商户）。 */
export function isPersonalSubject(value: unknown): boolean {
  return String(value || "").toUpperCase() === "PERSONAL";
}
