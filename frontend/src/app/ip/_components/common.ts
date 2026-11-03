import { fmtTime } from "@/lib/datetime";

/** 后端 /enterprise/ip/agencies 行（Prisma IpAgency 原样返回）。 */
export type IpAgency=import('@enterprise/contracts').IpAgency;

/** 后端 /enterprise/ip/requests 行（业务办理 BIZ / 咨询维权 CONSULT）。 */
export type IpRequestRow=import('@enterprise/contracts').IpRequestRow;

/** 后端 /enterprise/contracts 行（用于服务商/企业名称与签约状态回填）。 */
export type IpContract = {
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

/** 后端 /enterprise/contracts/candidates?serviceType=IP_SERVICE 行。 */
export type IpProviderCandidate = {
  providerUserId: string;
  org_name: string;
  display_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  intro: string;
};

/** 后端 /enterprise/staff/affiliations/mine 行。 */
export type IpAffiliation = {
  id: number;
  staffUserId: string;
  providerUserId: string;
  category: string;
  status: string;
  note: string;
};

/** 服务领域（登记表单可选项，2026-09-25 收敛为知识产权板块的六类）。 */
export const IP_FIELDS: string[] = [
  "商标注册",
  "商标异议",
  "发明专利申请",
  "实用新型专利",
  "著作权登记",
  "海外商标布局",
];

/** 取数回退 / 时间：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime };

/** 服务案例文案（demo 资源详情：title（result），多条以「；」连接）。 */
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