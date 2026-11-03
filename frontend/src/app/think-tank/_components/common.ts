import { fmtTime } from "@/lib/datetime";

/** 后端 /enterprise/think-tank/experts 行（Prisma ThinkTankExpert 原样返回）。 */
export type ThinkTankExpert=import('@enterprise/contracts').ThinkTankExpert;

/** 后端 /enterprise/think-tank/organizations 行。 */
export type ThinkTankOrganization=import('@enterprise/contracts').ThinkTankOrganization;

/** 后端 /enterprise/think-tank/requests 行（消息与 14 项结构化字段存在 Json 列）。 */
export type ThinkTankRequestRow=import('@enterprise/contracts').ThinkTankRequestRow;

/** 后端 /enterprise/contracts 行（用于服务商/企业名称与签约状态回填）。 */
export type ThinkTankContract = {
  id: number;
  contractNo: string;
  enterpriseId: number;
  enterpriseName: string;
  providerUserId: string;
  provider_name?: string;
  providerOrg?: string;
  serviceType: string;
  status: string;
  designatedAgentId: number;
  designatedAgentName: string;
  designatedAgentOrg: string;
};

/** 后端 /enterprise/contracts/candidates?serviceType=THINK_TANK_SERVICE 行。 */
export type ThinkTankProviderCandidate = {
  providerUserId: string;
  org_name: string;
  display_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  intro: string;
};

/** 后端 /enterprise/staff/affiliations/mine 行。 */
export type ThinkTankAffiliation = {
  id: number;
  staffUserId: string;
  providerUserId: string;
  category: string;
  status: string;
  note: string;
};

/** 擅长领域（登记表单可选项）。 */
export const THINK_TANK_AREAS: string[] = [
  "战略咨询",
  "管理咨询",
  "技术咨询",
  "财务咨询",
  "人力资源",
  "市场营销",
];

/** 取数回退 / 时间：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime };

export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** 资源行 fields Json 读取（后端把发起表单整体存入 Json 列）。 */
export function fieldOf(row: { fields?: unknown }, key: string): string {
  const record =
    row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
      ? (row.fields as Record<string, unknown>)
      : {};
  const value = record[key];
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

/** 服务案例文案（demo：标题（结果），分号分隔）。 */
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
