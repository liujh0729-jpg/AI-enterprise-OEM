import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";
import type { PersonBrief } from "./social";

/**
 * 招聘专区接口（商务人脉 → 招聘，/enterprise/social/hiring，移植 SNS 的 HiringPost）：
 * 开源版本地能力，未纳入统一 contracts 生成表，与社交板块同用底层 http() + 宽松信封校验。
 * 本地发布免 Key；同步上游（发布为 AIworkin 用工需求 / 刷新状态）需绑定 AIPDD APIKey，未绑定回 403。
 */
const BASE = "/api/backend/enterprise/social/hiring";

export interface HiringRow {
  id: number;
  author: PersonBrief;
  type: string;
  typeLabel: string;
  title: string;
  description: string;
  headCount: number;
  salaryMode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  tags: string[];
  province: string;
  city: string;
  contactNote: string;
  deadline: string;
  status: string;
  publishedUpstream: boolean;
  aiworkinListingNo: string;
  subcategoryId: string;
  category1: string;
  category2: string;
  createdAt: string;
  updatedAt: string;
}
export interface HiringTypeOption {
  value: string;
  label: string;
}
/** 上游归属类目（招聘固定发往平台「灵活用工」二级类目，只读展示）。 */
export interface HiringSyncCategory {
  subcategoryId: string;
  category1: string;
  category2: string;
}

const statusSchema = apiEnvelope(z.unknown());

async function call<T>(
  path: string,
  options: HttpOptions = {},
  extra?: HttpOptions,
): Promise<T> {
  const result = await http(path, statusSchema, { ...options, ...extra });
  return result.data.data as T;
}

const enc = "application/json";
const withBody = (method: string, body: unknown): HttpOptions => ({
  method,
  headers: { "content-type": enc },
  body,
});

export const hiringApi = {
  types: (o?: HttpOptions) => call<HiringTypeOption[]>(`${BASE}/types`, o),
  syncCategory: (o?: HttpOptions) =>
    call<HiringSyncCategory>(`${BASE}/sync-category`, o),
  create: (
    body: {
      type: string;
      title: string;
      description: string;
      headCount?: number;
      salaryMode?: string;
      salaryMin?: number;
      salaryMax?: number;
      tags?: string[];
      province?: string;
      city?: string;
      contactNote?: string;
      deadline?: string;
    },
    o?: HttpOptions,
  ) => call<HiringRow>(`${BASE}`, withBody("POST", body) as HttpOptions, o),
  list: (
    params?: { type?: string; keyword?: string; take?: number },
    o?: HttpOptions,
  ) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.keyword) q.set("keyword", params.keyword);
    if (params?.take) q.set("take", String(params.take));
    const s = q.toString();
    return call<HiringRow[]>(`${BASE}${s ? `?${s}` : ""}`, o);
  },
  mine: (o?: HttpOptions) => call<HiringRow[]>(`${BASE}/mine`, o),
  detail: (id: number, o?: HttpOptions) => call<HiringRow>(`${BASE}/${id}`, o),
  remove: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" } as HttpOptions, o),
  publishUpstream: (
    id: number,
    body: {
      deadline?: string;
      contactName?: string;
      contactPhone?: string;
      contactWechat?: string;
      contactEmail?: string;
    },
    o?: HttpOptions,
  ) =>
    call<HiringRow>(
      `${BASE}/${id}/publish-upstream`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  refreshStatus: (id: number, o?: HttpOptions) =>
    call<HiringRow>(`${BASE}/${id}/refresh-status`, withBody("POST", {}) as HttpOptions, o),
};
