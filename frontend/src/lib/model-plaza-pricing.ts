import type { MpBillingUnit, MpModel } from "@enterprise/contracts";

/** 模型广场的计价文案：官方原价 / 折后价 / 积分价统一在这里格式化，页面与调用说明共用。 */

export function money(value: number, digits = 4) {
  return `¥${Number(value || 0).toFixed(digits)}`;
}

/** 卡片价格：至少 2 位、最多 4 位小数，`¥3.00` / `¥0.09` / `¥0.0014`。 */
export function cardMoney(value: number) {
  const text = Number(value || 0)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const [whole, decimal = ""] = text.split(".");
  return `¥${whole}.${decimal.padEnd(2, "0")}`;
}

export function points(value: number, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

export const UNIT_LABEL: Record<MpBillingUnit, string> = {
  token: "按 Token",
  image: "按张",
  second: "按秒",
  call: "按次",
};

export const UNIT_SUFFIX: Record<MpBillingUnit, string> = {
  token: "每百万 tokens",
  image: "/张",
  second: "/秒",
  call: "/次",
};

export const UNIT_TAG_COLOR: Record<MpBillingUnit, string> = {
  token: "blue",
  image: "green",
  second: "orange",
  call: "purple",
};

export const UNIT_SHORT: Record<MpBillingUnit, string> = {
  token: "tokens",
  image: "张",
  second: "秒",
  call: "次",
};

/** 0.8 → 8 折，0.85 → 8.5 折；整数不带小数尾巴。 */
export function discountLabel(rate: number) {
  const zhe = Number((rate * 10).toFixed(2));
  return `${Number.isInteger(zhe) ? zhe : zhe.toFixed(1)} 折`;
}

export function hasDiscount(model: MpModel) {
  return model.price.discountRate < 0.9999;
}

/** 官方原价（人民币）：token 看输入/输出，媒体类看每张/每秒/每次单价。 */
export function officialText(model: MpModel) {
  const price = model.price.official;
  if (model.billingUnit === "token")
    return `${money(price.inputRmb)} / ${money(price.outputRmb)} 元 · 每百万 tokens（入/出）`;
  return `${money(price.unitRmb)} 元${UNIT_SUFFIX[model.billingUnit]}`;
}

/** 折后实际收费（人民币）。 */
export function effectiveText(model: MpModel) {
  const price = model.price.effective;
  if (model.billingUnit === "token")
    return `${money(price.inputRmb)} / ${money(price.outputRmb)} 元 · 每百万 tokens（入/出）`;
  return `${money(price.unitRmb)} 元${UNIT_SUFFIX[model.billingUnit]}`;
}

/** 卡片价格块：token 拆输入/输出，媒体类给单价；折后价与官方原价成对返回。 */
export interface PriceCell {
  label?: string;
  now: string;
  was?: string;
}

export function priceCells(model: MpModel): { cells: PriceCell[]; suffix: string } {
  const { official, effective } = model.price;
  const discounted = hasDiscount(model);
  if (model.billingUnit === "token") {
    return {
      suffix: "元 / 百万 tokens",
      cells: [
        {
          label: "输入",
          now: cardMoney(effective.inputRmb),
          was: discounted ? cardMoney(official.inputRmb) : undefined,
        },
        {
          label: "输出",
          now: cardMoney(effective.outputRmb),
          was: discounted ? cardMoney(official.outputRmb) : undefined,
        },
      ],
    };
  }
  return {
    suffix: `元${UNIT_SUFFIX[model.billingUnit]}`,
    cells: [
      {
        now: cardMoney(effective.unitRmb),
        was: discounted ? cardMoney(official.unitRmb) : undefined,
      },
    ],
  };
}

/** 卡片里的积分实付文案（系统汇率换算）。 */
export function pointsText(model: MpModel) {
  const price = model.price.points;
  if (model.billingUnit === "token")
    return `${points(price.inputPoints)} / ${points(price.outputPoints)} 积分`;
  const minimum =
    price.minimumPoints > 0 ? `（最低 ${points(price.minimumPoints)} 积分）` : "";
  return `${points(price.unitPoints)} 积分${UNIT_SUFFIX[model.billingUnit]}${minimum}`;
}

/** 卡片缓存价（紧凑版）：`缓存 读 ¥0.10 / 写 ¥3.00`。 */
export function cacheShort(model: MpModel) {
  if (model.billingUnit !== "token") return "";
  const price = model.price.official;
  if (!price.cacheReadRmb && !price.cacheWriteRmb) return "";
  return `缓存 读 ${cardMoney(price.cacheReadRmb)} / 写 ${cardMoney(price.cacheWriteRmb)}`;
}

/** 规格分档 chips：`{ label: "1024×1024", price: "¥0.30" }`，用于卡片上的分档价。 */
export function tierChips(model: MpModel) {
  return tierSpecs(model, true).flatMap((item) =>
    item.labels.map((label) => ({ label, price: cardMoney(item.price) })),
  );
}

/** 用户实付积分：一律由系统汇率换算，不读目录里的积分覆写值。 */
export function priceText(model: MpModel) {
  const price = model.price.points;
  if (model.billingUnit === "token")
    return `${points(price.inputPoints)} / ${points(price.outputPoints)} 积分 · 每百万 tokens（入/出）`;
  const minimum =
    price.minimumPoints > 0 ? `（最低 ${points(price.minimumPoints)} 积分）` : "";
  return `${points(price.unitPoints)} 积分${UNIT_SUFFIX[model.billingUnit]}${minimum}`;
}

export function cacheText(model: MpModel) {
  if (model.billingUnit !== "token") return "";
  const price = model.price.official;
  if (!price.cacheReadRmb && !price.cacheWriteRmb) return "";
  return `缓存读 ${money(price.cacheReadRmb)} / 写 ${money(price.cacheWriteRmb)} 元 · 每百万 tokens`;
}

/**
 * 卡片与台账用的紧凑分档摘要：按像素 / 分辨率 / 清晰度列出折后单价，例如
 * `1024×1024 ¥0.3 · 2048×2048 ¥0.4`（图像）、`480P ¥0.09 · 1080P ¥0.15`（视频）。
 * 优先展示像素尺寸，其次分辨率，最后才是 quality 别名，避免同一价格的重复项刷屏。
 */
export function tierSummary(model: MpModel, effective = true) {
  const specs = tierSpecs(model, effective);
  if (!specs.length) return "";
  return specs.map((item) => `${item.labels.join("/")} ${compactMoney(item.price)}`).join(" · ");
}

/** 像素 / 分辨率规格清单（不含价格），例如 `1024×1024、2048×2048、4096×4096`。 */
export function specList(model: MpModel): string {
  const specs = tierSpecs(model, true);
  const labels: string[] = [];
  for (const item of specs) {
    for (const label of item.labels) if (!labels.includes(label)) labels.push(label);
  }
  return labels.join("、");
}

type SpecKind = "pixel" | "resolution" | "quality" | "other";
interface SpecLabel {
  kind: SpecKind;
  text: string;
}

const PIXEL_RE = /^(\d+)\s*[x×*]\s*(\d+)$/i;

/** `1024x1024`→`1024×1024`、`480p`→`480P`、`2k`→`2K`；auto 原样保留。 */
function formatSpecValue(key: string, value: string): string {
  const raw = value.trim();
  if (raw.toLowerCase() === "auto") return "auto";
  if (key === "size") {
    const matched = PIXEL_RE.exec(raw);
    if (matched) return `${matched[1]}×${matched[2]}`;
  }
  if (key === "video_resolution" || key === "resolution") {
    const matched = /^(\d+)\s*([pk])$/i.exec(raw);
    if (matched) return `${matched[1]}${matched[2].toUpperCase()}`;
  }
  return raw;
}

/** 从一档 match 里取「规格」文案与类型，优先级：像素尺寸 > 分辨率 > 清晰度。 */
function specOf(match: Record<string, string>): SpecLabel | null {
  const entries = Object.entries(match);
  const pixel = entries.find(([key, value]) => key === "size" && PIXEL_RE.test(value.trim()));
  if (pixel) return { kind: "pixel", text: formatSpecValue(pixel[0], pixel[1]) };
  const resolution = entries.find(
    ([key]) => key === "video_resolution" || key === "resolution",
  );
  if (resolution) return { kind: "resolution", text: formatSpecValue(resolution[0], resolution[1]) };
  const quality = entries.find(([key]) => key === "quality");
  if (quality) return { kind: "quality", text: formatSpecValue(quality[0], quality[1]) };
  const first = entries[0];
  return first ? { kind: "other", text: formatSpecValue(first[0], first[1]) } : null;
}

function compactMoney(value: number) {
  const fixed = Number(value || 0)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `¥${fixed || "0"}`;
}

/** 把分档按「规格 + 折后单价」归并，同一价格的多条别名合并到一行。 */
function tierSpecs(model: MpModel, effective: boolean) {
  const ratio = effective ? model.price.discountRate : 1;
  const groups = new Map<string, SpecLabel[]>();
  for (const tier of model.price.tiers) {
    const spec = specOf(tier.match);
    if (!spec?.text) continue;
    const price = (tier.unitRmb * ratio).toFixed(6);
    const bucket = groups.get(price) ?? [];
    if (!bucket.some((item) => item.text === spec.text)) bucket.push(spec);
    groups.set(price, bucket);
  }
  return Array.from(groups, ([price, bucket]) => {
    const preferred = bucket.some((item) => item.kind === "pixel")
      ? bucket.filter((item) => item.kind === "pixel")
      : bucket.some((item) => item.kind === "resolution")
        ? bucket.filter((item) => item.kind === "resolution")
        : bucket;
    const labels: string[] = [];
    for (const item of preferred) if (!labels.includes(item.text)) labels.push(item.text);
    return { price: Number(price), labels };
  });
}

/** 上游分档说明，例如「1024×1024 → ¥0.3；2048×2048 → ¥0.4」。 */
export function tierText(model: MpModel) {
  return model.price.tiers
    .map((tier) => {
      const spec = specOf(tier.match);
      return `${spec?.text || "默认"} → ${compactMoney(tier.unitRmb)}`;
    })
    .join("；");
}

/** 附加计费组件说明（参考图超出量等）。 */
export function componentText(model: MpModel) {
  return model.price.components
    .map((item) => {
      const tiers = item.tiers.length
        ? `（${item.tiers
            .map((tier) =>
              Object.values(tier.match).join("/") + ` ${money(tier.unitRmb)}`,
            )
            .join("、")}）`
        : "";
      const free = item.freeUnits > 0 ? `，前 ${item.freeUnits} 张免费` : "";
      return `${item.code}：超出后 ${money(item.unitRmb)}/${UNIT_SHORT[item.unit]}${tiers}${free}`;
    })
    .join("；");
}
