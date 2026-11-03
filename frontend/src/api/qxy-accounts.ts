import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 平台「财税管理」：企享云报税 API Key 账号池与税号匹配
 * （/enterprise/admin/qxy-accounts）。
 * 开源版本地能力，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 */
const BASE = "/api/backend/enterprise/admin/qxy-accounts";

export interface QxyAccountView {
  id: string;
  label: string;
  /** 只回掩码（如 abcd****wxyz），永不回显 AppKey / Secret 原文。 */
  appkeyMasked: string;
  taxNos: string[];
  expiresAt: string;
  /** 距到期的剩余天数；未填到期时间时为 null。 */
  daysLeft: number | null;
  /** 到期前 10 天（含已过期）为 true：仅前端标红提醒，不拦截调用。 */
  expiring: boolean;
  updatedAt: string;
}

export interface QxyAccountsPayload {
  accounts: QxyAccountView[];
  /** 每个账号最多可绑定的税号数（当前为 5）。 */
  maxTaxNos: number;
  /** 提前多少天标红（当前为 10）。 */
  expiringDays: number;
  /** 历史单凭据（qxy_credentials）是否仍可用作未匹配税号的兜底。 */
  legacyConfigured: boolean;
  legacySource: "db" | "env" | "none";
}

export interface QxyAccountDraft {
  id?: string;
  label: string;
  /** 编辑时留空沿用原 AppKey（不回显）。 */
  appkey?: string;
  secret?: string;
  expiresAt?: string;
  taxNos?: string[];
}

const schema = apiEnvelope(z.unknown());

async function call<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const result = await http(path, schema, options);
  return result.data.data as T;
}

export const qxyAccountsApi = {
  list: (options?: HttpOptions) =>
    call<QxyAccountsPayload>(BASE, { ...options }),
  save: (body: QxyAccountDraft, options?: HttpOptions) =>
    call<QxyAccountsPayload>(BASE, { ...options, method: "PUT", body }),
  remove: (id: string, options?: HttpOptions) =>
    call<QxyAccountsPayload>(`${BASE}/${encodeURIComponent(id)}`, {
      ...options,
      method: "DELETE",
    }),
  bind: (id: string, taxNo: string, options?: HttpOptions) =>
    call<QxyAccountsPayload>(
      `${BASE}/${encodeURIComponent(id)}/tax-nos`,
      { ...options, method: "POST", body: { taxNo } },
    ),
  unbind: (id: string, taxNo: string, options?: HttpOptions) =>
    call<QxyAccountsPayload>(
      `${BASE}/${encodeURIComponent(id)}/tax-nos/${encodeURIComponent(taxNo)}`,
      { ...options, method: "DELETE" },
    ),
};