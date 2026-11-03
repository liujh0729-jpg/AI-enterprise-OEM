import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 平台「财税管理 · 已开通」：按能力维度列出已开通（OPEN）的自动化能力
 * （/enterprise/admin/capability-opened）。
 * 开源版本地能力，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 */
const BASE = "/api/backend/enterprise/admin/capability-opened";

export interface OpenedCapability {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  /** 企业统一社会信用代码（税号）。 */
  taxNo: string;
  code: string;
  label: string;
  /** 当前匹配的企享云账号名称（未匹配为空串）。 */
  qxyAccountName: string;
  /** 服务商提交审核时填写的开通时间（YYYY-MM-DD）。 */
  opensAt: string;
  /** 审核开通人（平台管理员）。 */
  openedByName: string;
  /** 审核通过时间（ISO）。 */
  openedAt: string;
}

export interface OpenedCapabilityPage {
  list: OpenedCapability[];
  total: number;
  page: number;
  pageSize: number;
}

const schema = apiEnvelope(z.unknown());

export const capabilityAdminApi = {
  openedPage: async (
    query: { page: number; pageSize?: number },
    options?: HttpOptions,
  ) => {
    const result = await http(BASE, schema, { ...options, query });
    return result.data.data as OpenedCapabilityPage;
  },
};