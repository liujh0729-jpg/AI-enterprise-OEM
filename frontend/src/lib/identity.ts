import { subjectLabel } from "./subject";

export const BUSINESS_IDENTITIES = [
  "ENTERPRISE_USER",
  "SERVICE_PROVIDER",
  "PROVIDER_STAFF",
] as const;

export const IDENTITY_LABELS: Record<string, string> = {
  ENTERPRISE_USER: "企业用户",
  SERVICE_PROVIDER: "服务商",
  PROVIDER_STAFF: "职员 / 代理人",
  PLATFORM_ADMIN: "平台管理员",
};

/** 顶栏、驾驶舱及身份资料页共用同一名称，个人主体不显示为企业用户。 */
export function identityLabel(identity?: string, subjectType?: unknown): string {
  if (identity === "ENTERPRISE_USER") {
    return `${subjectLabel(subjectType)}用户`;
  }
  return IDENTITY_LABELS[identity || ""] || "身份确认中";
}
