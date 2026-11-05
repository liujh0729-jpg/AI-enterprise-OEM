import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音商城、1688）的界面层：
 * 商品简报 → 生成规划（转化诊断 / 购买理由卡 / 风格锁 / 中文文案）→
 * 逐张确认/修改提示词 → 走本系统模型网关出图。
 * 后端：/enterprise/domestic-pdp/*（登录态）；文本与图片都经「内容创作 → 模型设置」的槽位。
 */

export type DomesticPdpMeta = {
  textReady: boolean;
  imageReady: boolean;
  textLabel: string;
  imageLabel: string;
  hint: string;
};

export type DomesticPdpAsset = {
  id: number;
  kind: string;
  position: number;
  title: string;
  purpose: string;
  sceneKey: string;
  copy: string;
  prompt: string;
  size: string;
  status: string;
  url: string;
  assetId: string;
  error: string;
};

export type DomesticPdpReason = {
  need: string;
  feature: string;
  benefit: string;
  basis: string;
};

export type DomesticPdpStyleLock = {
  styleName: string;
  colorPalette: string;
  backgroundSystem: string;
  lighting: string;
  cameraLanguage: string;
  typography: string;
  layoutRules: string;
  propRules: string;
  productRendering: string;
  negativeRules: string;
};

export type DomesticPdpPlan = {
  driver: string;
  driverReason: string;
  buyerReasons: DomesticPdpReason[];
  styleLock: DomesticPdpStyleLock;
  assumptions: string[];
  bannedClaims: string[];
};

export type DomesticPdpPack = {
  id: number;
  productName: string;
  category: string;
  platform: string;
  tone: string;
  status: string;
  heroCount: number;
  detailCount: number;
  doneCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DomesticPdpPackDetail = DomesticPdpPack & {
  input: Record<string, unknown>;
  plan: DomesticPdpPlan | null;
  assets: DomesticPdpAsset[];
};

export type DomesticPdpBrief = {
  productName: string;
  category: string;
  platform: string;
  tone: string;
  audience: string;
  price: string;
  sellingPoints: string;
  specs: string;
  evidence: string;
  promo: string;
  difference: string;
  styleName: string;
  colorPalette: string;
  compliance: boolean;
  heroCount: number;
  detailCount: number;
  referenceUrls: string[];
  /** 逐张内容说明：按「主图1：…／详情图1：…」逐行指定每张画面 */
  shotPlan: string;
};

export const PACK_STATUS_LABEL: Record<string, string> = {
  draft: "待规划",
  planning: "规划中",
  planned: "已规划",
  generating: "出图中",
  partial: "部分完成",
  completed: "已完成",
  failed: "失败",
};

export const PACK_STATUS_COLOR: Record<string, string> = {
  draft: "default",
  planning: "processing",
  planned: "blue",
  generating: "processing",
  partial: "warning",
  completed: "success",
  failed: "error",
};

export const ASSET_STATUS_LABEL: Record<string, string> = {
  pending: "待生成",
  generating: "生成中",
  done: "已生成",
  failed: "失败",
};

export const ASSET_STATUS_COLOR: Record<string, string> = {
  pending: "default",
  generating: "processing",
  done: "success",
  failed: "error",
};

export const DRIVER_LABEL: Record<string, string> = {
  visual: "视觉驱动",
  pain: "痛点驱动",
  emotion: "情绪驱动",
  value: "价值驱动",
};

export const TONE_OPTIONS = [
  { value: "brand", label: "品牌质感" },
  { value: "pro", label: "专业参数" },
  { value: "grass", label: "种草分享" },
  { value: "promo", label: "促销冲量" },
];

export const TONE_LABEL: Record<string, string> = Object.fromEntries(
  TONE_OPTIONS.map((item) => [item.value, item.label]),
);

export const SIZE_OPTIONS = [
  { value: "1024x1024", label: "1:1 主图方图" },
  { value: "1024x1536", label: "2:3 详情竖图" },
  { value: "1536x1024", label: "3:2 横图" },
];

export const PLATFORM_OPTIONS = [
  "淘宝/天猫",
  "京东",
  "拼多多",
  "抖音商城",
  "1688",
  "小红书",
];

const api = {
  meta: endpoint(endpoints.DomesticPdp_meta),
  packs: endpoint(endpoints.DomesticPdp_page),
  detail: endpoint(endpoints.DomesticPdp_detail),
  create: endpoint(endpoints.DomesticPdp_create),
  // 规划是一次文本模型调用，慢渠道可能跑几分钟；默认 30s 不够。
  plan: endpoint(endpoints.DomesticPdp_plan, { timeoutMs: 300000 }),
  updateAsset: endpoint(endpoints.DomesticPdp_updateAsset),
  // 出图同样可能排队与轮询，超时盖过网关的 3s × 100 次轮询。
  generate: endpoint(endpoints.DomesticPdp_generate, { timeoutMs: 300000 }),
  remove: endpoint(endpoints.DomesticPdp_remove),
};

/** 取数：失败不抛错，交页面提示（与 lead-common 同口径）。 */
async function load<T>(work: Promise<unknown>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: (await work) as T, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

/** 写操作：失败抛出后端文案，由调用方 message.error。 */
async function mutate<T>(work: Promise<unknown>): Promise<T> {
  return (await work) as T;
}

export const domesticPdpApi = {
  meta: () => load<DomesticPdpMeta>(api.meta({})),
  packs: (page = 1, pageSize = 30) =>
    load<{
      list: DomesticPdpPack[];
      total: number;
      page: number;
      pageSize: number;
    }>(api.packs({ query: { page, pageSize } })),
  detail: (id: number) =>
    load<DomesticPdpPackDetail>(api.detail({ params: { id: String(id) } })),
  create: (body: DomesticPdpBrief) =>
    mutate<DomesticPdpPackDetail>(api.create({ body })),
  plan: (id: number) =>
    mutate<DomesticPdpPackDetail>(api.plan({ params: { id: String(id) } })),
  updateAsset: (
    id: number,
    assetId: number,
    body: { title?: string; purpose?: string; copy?: string; prompt?: string; size?: string },
  ) =>
    mutate<DomesticPdpPackDetail>(
      api.updateAsset({
        params: { id: String(id), assetId: String(assetId) },
        body,
      }),
    ),
  generate: (id: number, assetId: number, body: { prompt?: string; size?: string }) =>
    mutate<DomesticPdpPackDetail>(
      api.generate({
        params: { id: String(id), assetId: String(assetId) },
        // 契约里 default("") 使输出类型必填，这里显式补空串。
        body: { prompt: body.prompt || "", size: body.size || "" },
      }),
    ),
  remove: (id: number) =>
    mutate<{ id: number; deleted: boolean }>(
      api.remove({ params: { id: String(id) } }),
    ),
};

/** 简报表单 → 建库入参：空字符串保留（后端按“未提供”披露为假设）。 */
export function briefOf(input: Record<string, unknown>): DomesticPdpBrief {
  const pick = (key: string) => String(input[key] ?? "");
  const refs = Array.isArray(input.referenceUrls) ? input.referenceUrls : [];
  return {
    productName: pick("productName"),
    category: pick("category"),
    platform: pick("platform") || "淘宝/天猫",
    tone: pick("tone") || "brand",
    audience: pick("audience"),
    price: pick("price"),
    sellingPoints: pick("sellingPoints"),
    specs: pick("specs"),
    evidence: pick("evidence"),
    promo: pick("promo"),
    difference: pick("difference"),
    styleName: pick("styleName"),
    colorPalette: pick("colorPalette"),
    compliance: input.compliance !== false,
    heroCount: Number(input.heroCount) || 0,
    detailCount: Number(input.detailCount) || 0,
    referenceUrls: refs.map((item) => String(item)).filter(Boolean),
    shotPlan: pick("shotPlan"),
  };
}