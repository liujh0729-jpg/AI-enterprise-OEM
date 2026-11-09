import { aiworkinApi } from '@/api/aiworkin';

/** AIworkin 二级类目（平台 market_category level=2）。 */
export type CategoryOption = {
  id: string;
  key: string;
  label: string;
  /** 平台要求先核验资质才能参与匹配的资质类型（服务发布场景提示用） */
  credentialTypes: string[];
  /** 平台限制只能人工沟通 */
  manualOnly: boolean;
};

export type ModuleCategory = {
  domain: string;
  label: string;
  /** 一级类目（平台父类目名，只读展示） */
  category1: string;
  category1Id: string;
  options: CategoryOption[];
};

export const CATEGORY_DOMAINS = [
  { domain: "LOGISTICS", label: "物流服务" },
  { domain: "SMART", label: "IT服务" },
  { domain: "IP", label: "知识产权服务" },
  { domain: "LEGAL", label: "法律服务" },
  { domain: "FLEX", label: "灵活用工服务" },
  { domain: "MARKETING", label: "营销服务" },
  { domain: "ASSET", label: "资产交易" },
] as const;

type CategoryPayload = NonNullable<Awaited<ReturnType<typeof aiworkinApi.categories>>>;

function normalize(domain: string, payload: CategoryPayload) {
  const hit = (payload.modules || []).find((item) => item.domain === domain);
  if (!hit) throw new Error(`未取到「${domain}」的平台类目`);
  return {
    domain: hit.domain,
    label: hit.label,
    category1: hit.category1,
    category1Id: hit.category1Id,
    options: (hit.category2Options || []).map((item) => ({
      id: item.id,
      key: item.key,
      label: item.label,
      credentialTypes: item.credentialTypes || [],
      manualOnly: Boolean(item.manualOnly),
    })),
  } satisfies ModuleCategory;
}

/** 取业务域的平台类目树（同一域内复用缓存，多页面共用同一份）。 */
export async function fetchModuleCategory(domain: string, signal: AbortSignal) {
  const key = domain.toUpperCase();
  const payload = await aiworkinApi.categories({query:{domain:key}}, {signal});
  if (!payload) throw new Error('平台类目响应为空');
  return normalize(key, payload);
}

/** 供需市场（跨板块）：取全部业务板块的类目树，发布时不按单一板块收窄。 */
export async function fetchAllModuleCategories(signal: AbortSignal) {
  const payload = await aiworkinApi.categories({ query: {} }, { signal });
  if (!payload) throw new Error('平台类目响应为空');
  return (payload.modules || []).map((item) => normalize(item.domain, payload));
}
