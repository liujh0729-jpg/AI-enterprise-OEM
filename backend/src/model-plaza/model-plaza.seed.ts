import type { PrismaService } from '../prisma/prisma.service';
import { toJsonInput, fromJson } from '../common/json-input';
import type {
  PlazaBillingUnit,
  PlazaComponent,
  PlazaTier,
} from './model-plaza.pricing';
import { categoryOf, type PlazaCategory } from './model-plaza.category';

/**
 * AIPDD 模型的静态初始清单。
 *
 * 计费规格完全取自上游 `GET /v1/models` 的 `aipdd.pricing`：
 * billing_unit 为 token / image / second / call；token 类价格是每百万 tokens，
 * 媒体类是每张 / 每秒 / 每次；tiers 是官方分档价，components 是附加组件
 * （如图像编辑的参考图超出量）。种子落库后即可上架售卖；
 * 管理员可在「平台管理后台 → 模型广场」调折扣或下架，后续再「从 baseURL 刷新」对齐上游。
 *
 * 只列本系统对外网关真正支持的端点；上游声明的 `/messages`、`/responses` 暂不开放。
 */
export type PlazaSeedModel = {
  modelKey: string;
  displayName: string;
  vendor: string;
  description: string;
  billingUnit: PlazaBillingUnit;
  /** 能力分类；缺省时按 endpoints 推断。 */
  category?: PlazaCategory;
  inputRmbPrice: number;
  outputRmbPrice: number;
  callRmbPrice: number;
  cacheReadRmbPrice?: number;
  cacheWriteRmbPrice?: number;
  minimumRmb?: number;
  tiers?: PlazaTier[];
  components?: PlazaComponent[];
  modalities: { input: string[]; output: string[] };
  endpoints: string[];
  tags: string[];
  sort: number;
};

const TEXT = { input: ['text'], output: ['text'] };

/** 图像分档：按 quality（1K/2K/4K/auto）与常见像素尺寸命中。 */
const IMAGE_TIERS = (
  auto: number,
  oneK: number,
  twoK: number,
  fourK: number,
): PlazaTier[] => [
  { match: { quality: '4K' }, unitRmb: fourK },
  { match: { quality: '2K' }, unitRmb: twoK },
  { match: { quality: '1K' }, unitRmb: oneK },
  { match: { quality: 'auto' }, unitRmb: auto },
  { match: { size: '4096x4096' }, unitRmb: fourK },
  { match: { size: '2048x2048' }, unitRmb: twoK },
  { match: { size: '1024x1024' }, unitRmb: oneK },
  { match: { size: '1024x1536' }, unitRmb: oneK },
  { match: { size: '1536x1024' }, unitRmb: oneK },
  { match: { size: 'auto' }, unitRmb: auto },
];

export const AIPDD_SEED_MODELS: PlazaSeedModel[] = [
  {
    modelKey: 'ap-deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    vendor: 'DeepSeek',
    description: '轻量高速对话模型，适合大批量文本处理与日常问答。',
    billingUnit: 'token',
    inputRmbPrice: 3,
    outputRmbPrice: 9,
    callRmbPrice: 0,
    cacheReadRmbPrice: 0.1,
    cacheWriteRmbPrice: 3,
    modalities: TEXT,
    endpoints: ['/chat/completions'],
    tags: ['对话', '高速'],
    sort: 100,
  },
  {
    modelKey: 'ap-deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    description: '深度推理与长文本理解，适合复杂任务与专业内容生成。',
    billingUnit: 'token',
    inputRmbPrice: 9,
    outputRmbPrice: 27,
    callRmbPrice: 0,
    cacheReadRmbPrice: 0.3,
    cacheWriteRmbPrice: 9,
    modalities: TEXT,
    endpoints: ['/chat/completions'],
    tags: ['对话', '推理'],
    sort: 95,
  },
  {
    modelKey: 'ap-glm-5.3',
    displayName: 'GLM 5.3',
    vendor: '智谱 AI',
    description: '通用大模型，中英文理解与指令遵循稳定。',
    billingUnit: 'token',
    inputRmbPrice: 8,
    outputRmbPrice: 28,
    callRmbPrice: 0,
    cacheReadRmbPrice: 2,
    cacheWriteRmbPrice: 8,
    modalities: TEXT,
    endpoints: ['/chat/completions'],
    tags: ['对话', '通用'],
    sort: 90,
  },
  {
    modelKey: 'ap-glm-5.3-flash',
    displayName: 'GLM 5.3 Flash',
    vendor: '智谱 AI',
    description: '支持图像输入的多模态轻量模型，性价比高。',
    billingUnit: 'token',
    inputRmbPrice: 0.4,
    outputRmbPrice: 1.4,
    callRmbPrice: 0,
    cacheReadRmbPrice: 0.115,
    cacheWriteRmbPrice: 0.4,
    modalities: { input: ['text', 'image'], output: ['text'] },
    endpoints: ['/chat/completions'],
    tags: ['对话', '视觉', '高速'],
    sort: 88,
  },
  {
    modelKey: 'ap-qwen3.8-max',
    displayName: 'Qwen3.8 Max',
    vendor: '阿里云通义',
    description: '旗舰多模态模型，支持文本、图像与视频输入。',
    billingUnit: 'token',
    inputRmbPrice: 12,
    outputRmbPrice: 36,
    callRmbPrice: 0,
    cacheReadRmbPrice: 12,
    cacheWriteRmbPrice: 15,
    modalities: { input: ['text', 'image', 'video'], output: ['text'] },
    endpoints: ['/chat/completions'],
    tags: ['对话', '推理', '视觉'],
    sort: 85,
  },
  {
    modelKey: 'ap-qwen-image-2.1',
    displayName: 'Qwen-Image 2.1',
    vendor: '阿里云通义',
    description: '文生图与图像编辑，按张计费；参考图超出部分单独计价。',
    billingUnit: 'image',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.1,
    tiers: [
      { match: { quality: '1K' }, unitRmb: 0.1 },
      { match: { quality: '2K' }, unitRmb: 0.36 },
    ],
    components: [
      {
        code: 'reference_image_excess',
        freeUnits: 0,
        unit: 'image',
        unitRmb: 0.05,
        tiers: [
          { match: { quality: '1K' }, unitRmb: 0.05 },
          { match: { quality: '2K' }, unitRmb: 0.1 },
        ],
      },
    ],
    modalities: { input: ['text', 'image'], output: ['image'] },
    endpoints: ['/images/generations', '/images/edits'],
    tags: ['图像', '文生图'],
    sort: 70,
  },
  {
    modelKey: 'ap-image-2.0',
    displayName: 'AIPDD Image 2.0',
    vendor: 'AIPDD',
    description: '通用文生图模型，支持 1K/2K/4K 档位。',
    billingUnit: 'image',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.2,
    tiers: IMAGE_TIERS(0.2, 0.3, 0.4, 0.6),
    modalities: { input: ['text'], output: ['image'] },
    endpoints: ['/images/generations', '/images/edits'],
    tags: ['图像', '文生图'],
    sort: 68,
  },
  {
    modelKey: 'ap-image-flare-2.5',
    displayName: 'AIPDD Image Flare 2.5',
    vendor: 'AIPDD',
    description: '偏写实与光影质感的图像模型。',
    billingUnit: 'image',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.2,
    tiers: IMAGE_TIERS(0.2, 0.3, 0.4, 0.6),
    modalities: { input: ['text'], output: ['image'] },
    endpoints: ['/images/generations', '/images/edits'],
    tags: ['图像', '文生图'],
    sort: 66,
  },
  {
    modelKey: 'ap-image-sunburst-2.5',
    displayName: 'AIPDD Image Sunburst 2.5',
    vendor: 'AIPDD',
    description: '偏插画与创意风格的图像模型。',
    billingUnit: 'image',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.3,
    tiers: IMAGE_TIERS(0.3, 0.4, 0.5, 0.7),
    modalities: { input: ['text'], output: ['image'] },
    endpoints: ['/images/generations', '/images/edits'],
    tags: ['图像', '插画'],
    sort: 64,
  },
  {
    modelKey: 'ap-nano-2.1',
    displayName: 'AIPDD Nano 2.1',
    vendor: 'AIPDD',
    description: '高精度图像模型，适合成品级出图。',
    billingUnit: 'image',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.5,
    tiers: [
      { match: { size: '1K' }, unitRmb: 0.4 },
      { match: { size: '2K' }, unitRmb: 0.5 },
      { match: { size: '4K' }, unitRmb: 0.6 },
      { match: { size: '1024x1024' }, unitRmb: 0.4 },
      { match: { size: '2048x2048' }, unitRmb: 0.5 },
      { match: { size: '4096x4096' }, unitRmb: 0.6 },
    ],
    modalities: { input: ['text'], output: ['image'] },
    endpoints: ['/images/generations', '/images/edits'],
    tags: ['图像', '高精度'],
    sort: 62,
  },
  {
    modelKey: 'ap-minimax-h3',
    displayName: 'MiniMax H3',
    vendor: 'MiniMax',
    description: '视频生成模型，按生成秒数计费，分辨率越高单价越高。',
    billingUnit: 'second',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.09,
    tiers: [
      { match: { video_resolution: '480p' }, unitRmb: 0.09 },
      { match: { video_resolution: '768p' }, unitRmb: 0.12 },
      { match: { video_resolution: '1080p' }, unitRmb: 0.15 },
      { match: { video_resolution: '2k' }, unitRmb: 0.24 },
      { match: { video_resolution: '4k' }, unitRmb: 0.3 },
    ],
    modalities: {
      input: ['text', 'image', 'video', 'audio'],
      output: ['video'],
    },
    endpoints: ['/videos'],
    tags: ['视频', '生成'],
    sort: 50,
  },
  {
    modelKey: 'ap-indextts-2',
    displayName: 'IndexTTS 2',
    vendor: 'AIPDD',
    description: '语音合成模型，支持音色克隆，按次计费。',
    billingUnit: 'call',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.1,
    modalities: { input: ['text', 'audio'], output: ['audio'] },
    endpoints: ['/audio/speech'],
    tags: ['语音', '合成'],
    sort: 40,
  },
  {
    modelKey: 'ap-funasr',
    displayName: 'FunASR 语音识别',
    vendor: 'AIPDD',
    description: '语音转写模型，按音频秒数计费，单次最低 0.01 元。',
    billingUnit: 'second',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0.01,
    minimumRmb: 0.01,
    modalities: { input: ['audio'], output: ['text'] },
    endpoints: ['/audio/transcriptions'],
    tags: ['语音', '识别'],
    sort: 38,
  },
  {
    modelKey: 'ap-qwen3-embedding:0.6b',
    displayName: 'Qwen3 Embedding 0.6B',
    vendor: '阿里云通义',
    description: '文本向量模型，1024 维，用于检索与聚类。',
    billingUnit: 'token',
    inputRmbPrice: 0.03,
    outputRmbPrice: 0,
    callRmbPrice: 0,
    modalities: { input: ['text'], output: ['embedding'] },
    endpoints: ['/embeddings'],
    tags: ['向量', '检索'],
    sort: 20,
  },
];

/**
 * 幂等播种：只补缺失的 `provider=AIPDD` 目录行，不覆盖管理员改过的价格与上下架状态。
 * 与 BillingRuleService.ensureSeed 同口径（首次读取时懒播种，不走 prisma db seed）。
 */
export async function ensurePlazaSeed(prisma: PrismaService): Promise<{
  created: number;
  skipped: number;
}> {
  const existing = await prisma.modelCatalog.findMany({
    where: { provider: 'AIPDD' },
    select: { id: true, modelKey: true, tiers: true },
  });
  const known = new Set(existing.map((row) => row.modelKey));
  const missing = AIPDD_SEED_MODELS.filter((row) => !known.has(row.modelKey));

  // 内置图像模型早期只落了清晰度档位，缺像素尺寸档位；补上缺失的像素规格（不覆盖已有档位）。
  const byKey = new Map(existing.map((row) => [row.modelKey, row]));
  const isPixel = (tier: PlazaTier) =>
    typeof tier.match?.size === 'string' && /\d+x\d+/i.test(tier.match.size);
  const upgrades: { id: number; tiers: PlazaTier[] }[] = [];
  for (const seed of AIPDD_SEED_MODELS) {
    const row = byKey.get(seed.modelKey);
    if (!row || !seed.tiers?.length) continue;
    const stored = Array.isArray(row.tiers)
      ? fromJson<PlazaTier[]>(row.tiers)
      : [];
    if (stored.some(isPixel)) continue;
    const added = seed.tiers
      .filter(isPixel)
      .filter(
        (tier) => !stored.some((item) => item.match?.size === tier.match.size),
      );
    if (added.length)
      upgrades.push({ id: row.id, tiers: [...stored, ...added] });
  }
  for (const upgrade of upgrades) {
    await prisma.modelCatalog.update({
      where: { id: upgrade.id },
      data: { tiers: toJsonInput(upgrade.tiers) },
    });
  }

  if (!missing.length) {
    return { created: 0, skipped: existing.length };
  }
  await prisma.modelCatalog.createMany({
    data: missing.map((row) => ({
      upstreamId: 0,
      provider: 'AIPDD',
      modelKey: row.modelKey,
      upstreamModelKey: row.modelKey,
      displayName: row.displayName,
      vendor: row.vendor,
      description: row.description,
      quotaType: row.billingUnit === 'token' ? 'TOKEN' : 'CALL',
      billingUnit: row.billingUnit,
      category: categoryOf(row.endpoints, row.category),
      inputRmbPrice: row.inputRmbPrice,
      outputRmbPrice: row.outputRmbPrice,
      callRmbPrice: row.callRmbPrice,
      cacheReadRmbPrice: row.cacheReadRmbPrice ?? 0,
      cacheWriteRmbPrice: row.cacheWriteRmbPrice ?? 0,
      minimumRmb: row.minimumRmb ?? 0,
      tiers: toJsonInput(row.tiers ?? []),
      components: toJsonInput(row.components ?? []),
      discountRate: 1,
      contextWindow: 0,
      maxOutputTokens: 0,
      modalities: row.modalities,
      endpoints: row.endpoints,
      tags: row.tags,
      enabled: true,
      sort: row.sort,
      remark: 'AIPDD 初始清单',
      createdBy: 'system',
    })),
  });
  return { created: missing.length, skipped: existing.length };
}
