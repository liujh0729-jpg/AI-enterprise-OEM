import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '../generated/prisma';

/**
 * 创意社区默认数据：把「官方热门模板」与「人工精选的核心节点工作流」幂等写进 community_workflows。
 *
 * 两条数据来源：
 *  1. `prisma/data/comfy-templates/`——由 `node scripts/import-comfy-templates.mjs` 离线生成
 *     （官方全是 UI 格式，导入期能转成 API 格式的才给「可直接运行」，转不动的保留浏览型）；
 *  2. 本文件里的 CURATED 表——只用 ComfyUI 核心节点手写固化，保证站内开箱就有真能跑的工作流。
 *
 * 幂等口径：一律按 `code` upsert；封面只在库里还没有封面时才上传 OSS（重复 seed 不重传、不产生重复行），
 * 计数列（runCount/likeCount/…）只在首次创建时置 0，重跑不抹掉真实热度。
 */

const DATA_DIR = join(__dirname, 'data', 'comfy-templates');

/** 官方条目都没有作者账号，推荐时不发奖：rewardedAt 直接置为当前时间占住幂等标记。 */
const OFFICIAL_REWARDED_AT = new Date('2020-01-01T00:00:00.000Z');

type ImportedMeta = {
  name: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  groupLabel: string;
  tags: string[];
  mediaType: string;
  format: string;
  slots: CommunitySeedSlot[];
  coverFile: string;
  coverUrl: string;
  comfyUrl: string;
  author: string;
  usage: number;
  sourceFile: string;
};

/** 与后端 CommunityRegistrySlot 同构（seed 里不引后端类型，避免 ts-node 串起整条依赖链）。 */
type CommunitySeedSlot = {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'int' | 'float' | 'enum' | 'seed' | 'image';
  nodeId: string;
  field: string;
  defaultValue: string | number | null;
  options: string[];
  min: number | null;
  max: number | null;
  required: boolean;
};

type SeedRow = {
  code: string;
  source: 'OFFICIAL';
  ownerUserId: string;
  ownerName: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  groupLabel: string;
  tags: string[];
  mediaType: string;
  format: 'api' | 'ui';
  workflowJson: Record<string, unknown>;
  slots: CommunitySeedSlot[];
  coverRef: string;
  comfyUrl: string;
  status: 'APPROVED' | 'RECOMMENDED';
};

/** 导入条目 + 反查回来的工作流正文。 */
type ImportedWorkflow = ImportedMeta & { graph: Record<string, unknown> };

function slot(
  nodeId: string,
  field: string,
  label: string,
  type: CommunitySeedSlot['type'],
  extra: Partial<CommunitySeedSlot> = {},
): CommunitySeedSlot {
  return {
    key: extra.key || field,
    label,
    type,
    nodeId,
    field,
    defaultValue: extra.defaultValue ?? null,
    options: extra.options || [],
    min: extra.min ?? null,
    max: extra.max ?? null,
    required: extra.required ?? false,
  };
}

const DEFAULT_NEGATIVE =
  'lowres, bad anatomy, bad hands, text, error, missing finger, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';

/** 标准文生图骨架：加载模型 → 双向提示词 → 空潜空间 → 采样 → VAE 解码 → 保存。 */
function txt2Graph(options: {
  ckpt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  batch?: number;
  lora?: string;
}) {
  const clipSource = options.lora ? ['9', 1] : ['1', 1];
  const modelSource = options.lora ? ['9', 0] : ['1', 0];
  const graph: Record<string, unknown> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: options.ckpt },
      _meta: { title: '加载模型' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: clipSource },
      _meta: { title: '正向提示词' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: DEFAULT_NEGATIVE, clip: clipSource },
      _meta: { title: '反向提示词' },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: options.width,
        height: options.height,
        batch_size: options.batch || 1,
      },
      _meta: { title: '画布尺寸' },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 156680208700385,
        steps: options.steps,
        cfg: options.cfg,
        sampler_name: options.sampler,
        scheduler: options.scheduler,
        denoise: 1,
        model: modelSource,
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
      _meta: { title: '采样' },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
      _meta: { title: '解码' },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'community/txt2img' },
      _meta: { title: '保存' },
    },
  };
  if (options.lora) {
    graph['9'] = {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['1', 1],
        lora_name: options.lora,
        strength_model: 0.8,
        strength_clip: 0.8,
      },
      _meta: { title: 'LoRA' },
    };
  }
  return graph;
}

function txt2Slots(options: {
  ckpt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  lora?: string;
}): CommunitySeedSlot[] {
  const slots = [
    slot('2', 'text', '正向提示词', 'longtext', {
      key: 'prompt',
      required: true,
    }),
    slot('3', 'text', '反向提示词', 'longtext', {
      key: 'negative_prompt',
      defaultValue: DEFAULT_NEGATIVE,
    }),
    slot('4', 'width', '宽度', 'int', {
      key: 'width',
      defaultValue: options.width,
      min: 64,
      max: 2048,
    }),
    slot('4', 'height', '高度', 'int', {
      key: 'height',
      defaultValue: options.height,
      min: 64,
      max: 2048,
    }),
    slot('5', 'seed', '随机种子', 'seed', {
      min: 0,
      max: 2 ** 31 - 1,
      defaultValue: 156680208700385,
    }),
    slot('5', 'steps', '采样步数', 'int', {
      min: 1,
      max: 150,
      defaultValue: options.steps,
    }),
    slot('5', 'cfg', '提示词引导系数', 'float', {
      min: 0,
      max: 30,
      defaultValue: options.cfg,
    }),
    slot('1', 'ckpt_name', '模型文件名（换成你账号里已有的）', 'text', {
      key: 'ckpt_name',
      defaultValue: options.ckpt,
      required: true,
    }),
  ];
  if (options.lora) {
    slots.push(
      slot('9', 'lora_name', 'LoRA 文件名', 'text', {
        key: 'lora_name',
        defaultValue: options.lora,
      }),
      slot('9', 'strength_model', 'LoRA 强度', 'float', {
        key: 'strength',
        min: 0,
        max: 2,
        defaultValue: 0.8,
      }),
    );
  }
  return slots;
}

/** 图生图骨架：读图 → VAE 编码 → 按 denoise 决定改动幅度。 */
function img2Graph(options: {
  ckpt: string;
  denoise: number;
  steps: number;
  cfg: number;
  scale?: number;
}) {
  const graph: Record<string, unknown> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: options.ckpt },
      _meta: { title: '加载模型' },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: 'example.png' },
      _meta: { title: '输入图片' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['1', 1] },
      _meta: { title: '正向提示词' },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: DEFAULT_NEGATIVE, clip: ['1', 1] },
      _meta: { title: '反向提示词' },
    },
    '6': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['2', 0], vae: ['1', 2] },
      _meta: { title: '图像编码' },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 82724890356423,
        steps: options.steps,
        cfg: options.cfg,
        sampler_name: 'euler_a',
        scheduler: 'karras',
        denoise: options.denoise,
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['6', 0],
      },
      _meta: { title: '采样' },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
      _meta: { title: '解码' },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'community/img2img' },
      _meta: { title: '保存' },
    },
  };
  if (options.scale) {
    // 先等比放大再编码：denoise 保持不变时，放大后的图细节更多
    graph['9'] = {
      class_type: 'ImageScale',
      inputs: {
        image: ['2', 0],
        upscale_method: 'lanczos',
        width: 1536,
        height: 1536,
        crop: 'center',
      },
      _meta: { title: '放大' },
    };
    (graph['6'] as { inputs: Record<string, unknown> }).inputs.pixels = [
      '9',
      0,
    ];
  }
  return graph;
}

function img2Slots(options: {
  ckpt: string;
  denoise: number;
  steps: number;
  cfg: number;
  scale?: number;
}): CommunitySeedSlot[] {
  const slots = [
    slot('2', 'image', '输入图片', 'image', {
      key: 'input_image',
      required: true,
    }),
    slot('3', 'text', '正向提示词', 'longtext', {
      key: 'prompt',
      required: true,
    }),
    slot('4', 'text', '反向提示词', 'longtext', {
      key: 'negative_prompt',
      defaultValue: DEFAULT_NEGATIVE,
    }),
    slot('5', 'denoise', '重绘幅度（越大改动越多）', 'float', {
      key: 'denoise',
      min: 0,
      max: 1,
      defaultValue: options.denoise,
    }),
    slot('5', 'seed', '随机种子', 'seed', {
      min: 0,
      max: 2 ** 31 - 1,
      defaultValue: 82724890356423,
    }),
    slot('5', 'steps', '采样步数', 'int', {
      min: 1,
      max: 150,
      defaultValue: options.steps,
    }),
    slot('5', 'cfg', '提示词引导系数', 'float', {
      min: 0,
      max: 30,
      defaultValue: options.cfg,
    }),
    slot('1', 'ckpt_name', '模型文件名（换成你账号里已有的）', 'text', {
      key: 'ckpt_name',
      defaultValue: options.ckpt,
      required: true,
    }),
  ];
  if (options.scale) {
    slots.push(
      slot('9', 'width', '放大后宽度', 'int', {
        key: 'scale_width',
        min: 64,
        max: 4096,
        defaultValue: 1536,
      }),
      slot('9', 'height', '放大后高度', 'int', {
        key: 'scale_height',
        min: 64,
        max: 4096,
        defaultValue: 1536,
      }),
    );
  }
  return slots;
}

/** 人工精选：只用核心节点，Comfy Cloud 账号里开箱就有这些类，因此可直接站内运行。 */
const CURATED: Array<
  Omit<SeedRow, 'source' | 'ownerUserId' | 'coverRef' | 'ownerName'>
> = [
  {
    code: 'official_txt2img_sdxl',
    title: '文生图 · SDXL 基础流程',
    summary:
      '官方核心节点的标准文生图：提示词、尺寸、种子、步数与 CFG 都可站内改。',
    description:
      'ComfyUI 自带节点组成的文生图骨架（加载模型 → 正/反向提示词 → 空潜空间 → KSampler → VAE 解码 → 保存）。' +
      '模型名默认 sd_xl_base_1.0.safetensors，如果你账号里的模型名不同，直接在「模型文件名」里换成你自己的。',
    category: 'image',
    groupLabel: '文生图',
    tags: ['文生图', 'SDXL', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: txt2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
    }),
    slots: txt2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'RECOMMENDED',
  },
  {
    code: 'official_txt2img_sd15',
    title: '文生图 · SD 1.5 快速出图',
    summary: '512×512 的 SD1.5 流程，出图快、显存友好，适合先试提示词。',
    description:
      '与 SDXL 版同一套官方核心节点，换成 v1-5-pruned-emaonly.safetensors 与 512 尺寸、lcm 风格采样组合，' +
      '用来快速验证提示词写法成本最低。',
    category: 'image',
    groupLabel: '文生图',
    tags: ['文生图', 'SD1.5', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: txt2Graph({
      ckpt: 'v1-5-pruned-emaonly.safetensors',
      width: 512,
      height: 512,
      steps: 22,
      cfg: 6.5,
      sampler: 'euler_a',
      scheduler: 'karras',
    }),
    slots: txt2Slots({
      ckpt: 'v1-5-pruned-emaonly.safetensors',
      width: 512,
      height: 512,
      steps: 22,
      cfg: 6.5,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'RECOMMENDED',
  },
  {
    code: 'official_txt2img_lora',
    title: '文生图 + LoRA 风格叠加',
    summary: '在 SDXL 链路上挂一个 LoRA，强度和文件名都开放成参数。',
    description:
      'CheckpointLoaderSimple 之后接 LoraLoader，提示词与条件走 LoRA 后的 CLIP。' +
      'LoRA 文件名默认 add_detail.safetensors，可按你账号里的实际文件替换。',
    category: 'image',
    groupLabel: '文生图',
    tags: ['文生图', 'LoRA', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: txt2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      lora: 'add_detail.safetensors',
    }),
    slots: txt2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 7,
      lora: 'add_detail.safetensors',
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
  {
    code: 'official_batch4_seeds',
    title: '一次出四张 · 种子对比',
    summary: 'batch_size=4 的文生图，同一提示词横向比种子。',
    description:
      '与 SDXL 文生图同构，只是空潜空间的 batch_size 固定为 4，四张图走同一个种子序列。',
    category: 'image',
    groupLabel: '文生图',
    tags: ['文生图', '批量', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: txt2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 832,
      height: 1216,
      steps: 26,
      cfg: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      batch: 4,
    }),
    slots: txt2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      width: 832,
      height: 1216,
      steps: 26,
      cfg: 7,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
  {
    code: 'official_img2img',
    title: '图生图 · 轻改造型',
    summary: '上传一张图，按 denoise 控制改动幅度（默认 0.55）。',
    description:
      'LoadImage → VAEEncode → KSampler 的标准图生图链路。输入图片走站内上传后转成 Comfy Cloud 资产引用，' +
      '不需要你自己往云端传文件。',
    category: 'image',
    groupLabel: '图生图',
    tags: ['图生图', 'img2img', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: img2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.55,
      steps: 28,
      cfg: 7,
    }),
    slots: img2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.55,
      steps: 28,
      cfg: 7,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'RECOMMENDED',
  },
  {
    code: 'official_img2img_restyle',
    title: '图生图 · 强风格迁移',
    summary: 'denoise 0.9 的大改动版本，只保留原图构图。',
    description:
      '与轻改造型同一张图，但 denoise 拉到 0.9、步数 35，实际效果接近按提示词重画，适合做风格迁移。',
    category: 'image',
    groupLabel: '图生图',
    tags: ['图生图', '风格迁移', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: img2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.9,
      steps: 35,
      cfg: 8,
    }),
    slots: img2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.9,
      steps: 35,
      cfg: 8,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
  {
    code: 'official_upscale_refine',
    title: '放大精修 · 先拉伸再重绘',
    summary: '图片放大到指定尺寸后用低 denoise 补细节，适合出成品图。',
    description:
      'LoadImage → ImageScale（lanczos）→ VAEEncode → KSampler（denoise 0.35）→ VAEDecode → SaveImage。' +
      '宽度高度都是参数，denoise 越小越贴近原图。',
    category: 'tools',
    groupLabel: '图片放大',
    tags: ['超分', '精修', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: img2Graph({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.35,
      steps: 20,
      cfg: 6,
      scale: 2,
    }),
    slots: img2Slots({
      ckpt: 'sd_xl_base_1.0.safetensors',
      denoise: 0.35,
      steps: 20,
      cfg: 6,
      scale: 2,
    }),
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
  {
    code: 'official_inpaint_mask',
    title: '局部重绘 · 蒙版改图',
    summary: '图片 + 蒙版两个输入，只重绘蒙住的范围。',
    description:
      'LoadImage 与 LoadImageMask 一起进 VAEEncodeForInpaint，grow_mask_by 控制蒙版外扩像素。' +
      '需要先在 ComfyUI 里准备一张黑白蒙版，白色区域即重绘区。',
    category: 'image',
    groupLabel: '局部重绘',
    tags: ['inpaint', '蒙版', '官方核心节点'],
    mediaType: 'image',
    format: 'api',
    workflowJson: {
      ...img2Graph({
        ckpt: 'sd_xl_base_1.0.safetensors',
        denoise: 0.75,
        steps: 28,
        cfg: 7,
      }),
      '6': {
        class_type: 'VAEEncodeForInpaint',
        inputs: {
          pixels: ['2', 0],
          mask: ['10', 0],
          vae: ['1', 2],
          grow_mask_by: 6,
        },
        _meta: { title: '蒙版编码' },
      },
      '10': {
        class_type: 'LoadImageMask',
        inputs: { image: 'mask.png', channel: 'red' },
        _meta: { title: '蒙版图片' },
      },
    },
    slots: [
      ...img2Slots({
        ckpt: 'sd_xl_base_1.0.safetensors',
        denoise: 0.75,
        steps: 28,
        cfg: 7,
      }),
      slot('10', 'image', '蒙版图片（白色为重绘区）', 'image', {
        key: 'mask_image',
        required: true,
      }),
      slot('6', 'grow_mask_by', '蒙版外扩像素', 'int', {
        key: 'grow_mask_by',
        min: 0,
        max: 128,
        defaultValue: 6,
      }),
    ],
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
  {
    code: 'official_canny2img',
    title: '线稿生图 · Canny + ControlNet',
    summary: '从输入图提取线稿，按提示词重画同一张构图。',
    description:
      'LoadImage → CannyEdgeDetection → ControlNetApplyAdvanced（正/反向提示词一起进 ControlNet）→ 标准采样链。' +
      '控制图默认 control_v11p_sd15_canny.safetensors，可按账号里的实际文件名替换。',
    category: 'image',
    groupLabel: '控制线稿',
    tags: ['ControlNet', 'Canny', '线稿生图'],
    mediaType: 'image',
    format: 'api',
    workflowJson: {
      ...txt2Graph({
        ckpt: 'v1-5-pruned-emaonly.safetensors',
        width: 768,
        height: 768,
        steps: 25,
        cfg: 7,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
      }),
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '', clip: ['1', 1] },
        _meta: { title: '正向提示词' },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: DEFAULT_NEGATIVE, clip: ['1', 1] },
        _meta: { title: '反向提示词' },
      },
      '11': {
        class_type: 'LoadImage',
        inputs: { image: 'reference.png' },
        _meta: { title: '参考图' },
      },
      '12': {
        class_type: 'CannyEdgeDetection',
        inputs: { image: ['11', 0], low_threshold: 0.4, high_threshold: 0.8 },
        _meta: { title: '提取线稿' },
      },
      '13': {
        class_type: 'ControlNetLoader',
        inputs: { control_net_name: 'control_v11p_sd15_canny.safetensors' },
        _meta: { title: 'ControlNet 模型' },
      },
      '14': {
        class_type: 'ControlNetApplyAdvanced',
        inputs: {
          positive: ['2', 0],
          negative: ['3', 0],
          control_net: ['13', 0],
          image: ['12', 0],
          strength: 1,
          start_percent: 0,
          end_percent: 0.8,
        },
        _meta: { title: '套用 ControlNet' },
      },
      // 采样吃的是加了 ControlNet 的条件（输出 0 正向 / 输出 1 反向），否则线稿控制不生效
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 156680208700385,
          steps: 25,
          cfg: 7,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 1,
          model: ['1', 0],
          positive: ['14', 0],
          negative: ['14', 1],
          latent_image: ['4', 0],
        },
        _meta: { title: '采样' },
      },
    },
    slots: [
      slot('11', 'image', '参考图（提取线稿）', 'image', {
        key: 'input_image',
        required: true,
      }),
      slot('2', 'text', '正向提示词', 'longtext', {
        key: 'prompt',
        required: true,
      }),
      slot('3', 'text', '反向提示词', 'longtext', {
        key: 'negative_prompt',
        defaultValue: DEFAULT_NEGATIVE,
      }),
      slot('12', 'low_threshold', '线稿弱阈值', 'float', {
        key: 'canny_low',
        min: 0,
        max: 1,
        defaultValue: 0.4,
      }),
      slot('12', 'high_threshold', '线稿强阈值', 'float', {
        key: 'canny_high',
        min: 0,
        max: 1,
        defaultValue: 0.8,
      }),
      slot('14', 'strength', 'ControlNet 强度', 'float', {
        key: 'strength',
        min: 0,
        max: 2,
        defaultValue: 1,
      }),
      slot('4', 'width', '宽度', 'int', {
        key: 'width',
        min: 64,
        max: 2048,
        defaultValue: 768,
      }),
      slot('4', 'height', '高度', 'int', {
        key: 'height',
        min: 64,
        max: 2048,
        defaultValue: 768,
      }),
      slot('5', 'seed', '随机种子', 'seed', {
        min: 0,
        max: 2 ** 31 - 1,
        defaultValue: 156680208700385,
      }),
      slot('5', 'steps', '采样步数', 'int', {
        min: 1,
        max: 150,
        defaultValue: 25,
      }),
      slot('1', 'ckpt_name', '模型文件名', 'text', {
        key: 'ckpt_name',
        required: true,
        defaultValue: 'v1-5-pruned-emaonly.safetensors',
      }),
      slot('13', 'control_net_name', 'ControlNet 文件名', 'text', {
        key: 'control_net_name',
        defaultValue: 'control_v11p_sd15_canny.safetensors',
      }),
    ],
    comfyUrl: 'https://cloud.comfy.org',
    status: 'APPROVED',
  },
];

const CATEGORIES = new Set(['image', 'video', 'audio', '3d', 'llm', 'tools']);

/** 读导入产物：目录不存在或没有 meta 文件时返回空数组（seed 仍可跑，只是没有官方条目）。 */
function readImported(): ImportedWorkflow[] {
  if (!existsSync(DATA_DIR)) return [];
  const out: ImportedWorkflow[] = [];
  for (const file of readdirSync(DATA_DIR)) {
    if (!file.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(
        readFileSync(join(DATA_DIR, file), 'utf8'),
      ) as ImportedMeta;
      const workflowPath = join(
        DATA_DIR,
        meta.sourceFile || `${meta.name}.json`,
      );
      if (!meta.name || !existsSync(workflowPath)) continue;
      const graph = JSON.parse(readFileSync(workflowPath, 'utf8')) as Record<
        string,
        unknown
      >;
      out.push({
        ...meta,
        category: CATEGORIES.has(meta.category) ? meta.category : 'image',
        mediaType: ['image', 'video', 'audio'].includes(meta.mediaType)
          ? meta.mediaType
          : 'file',
        format: meta.format === 'api' ? 'api' : 'ui',
        tags: Array.isArray(meta.tags)
          ? meta.tags.slice(0, 12).map(String)
          : [],
        slots: Array.isArray(meta.slots) ? meta.slots : [],
        title: String(meta.title || meta.name).slice(0, 200),
        summary: String(meta.summary || '').slice(0, 500),
        description: String(meta.description || '').slice(0, 8000),
        comfyUrl: String(meta.comfyUrl || ''),
        author: String(meta.author || 'ComfyUI').slice(0, 64),
        usage: Number(meta.usage || 0),
        // format=ui 的条目直接存原文（带 nodes/links）：卡片只供浏览与下载，站内不给运行按钮
        graph,
      });
    } catch (error) {
      console.warn(
        `[community-seed] 跳过读不了的导入文件 ${file}: ${(error as Error).message}`,
      );
    }
  }
  return out.sort((a, b) => b.usage - a.usage);
}

/** 汇总要写入的行：官方导入条目 + 人工精选条目，code 冲突时以精选为准（站内一定能跑）。 */
export function buildOfficialRows(): SeedRow[] {
  const imported = readImported().map((meta, index) => {
    const row: SeedRow = {
      code: meta.name.slice(0, 64),
      source: 'OFFICIAL',
      ownerUserId: '',
      ownerName: meta.author,
      title: meta.title,
      summary: meta.summary,
      description: meta.description,
      category: meta.category,
      groupLabel: meta.groupLabel || '',
      tags: meta.tags,
      mediaType: meta.mediaType,
      format: meta.format === 'api' ? 'api' : 'ui',
      workflowJson: meta.graph,
      // 导入的槽位候选必须补齐契约默认值，否则前端表单渲染不出控件
      slots: (meta.slots || []).slice(0, 40).map((item) => ({
        ...item,
        options: Array.isArray(item.options) ? item.options.map(String) : [],
        min: Number.isFinite(Number(item.min)) ? Number(item.min) : null,
        max: Number.isFinite(Number(item.max)) ? Number(item.max) : null,
        required: Boolean(item.required),
        defaultValue: item.defaultValue ?? null,
      })),
      coverRef: meta.coverFile || meta.coverUrl || '',
      comfyUrl: meta.comfyUrl,
      // 导入脚本已按 usage 降序排过：前 8 条给推荐位，其余通过审核即可见
      status: index < 8 ? 'RECOMMENDED' : 'APPROVED',
    };
    return row;
  });
  const curated = CURATED.map((item) => ({
    ...item,
    source: 'OFFICIAL' as const,
    ownerUserId: '',
    ownerName: 'ComfyUI',
    coverRef: '',
  }));
  const byCode = new Map<string, SeedRow>();
  for (const row of [...imported, ...curated]) byCode.set(row.code, row);
  return [...byCode.values()];
}

/** 封面落地：本地二进制在配了 OSS 时上传自有桶，否则直接引用官方地址（都不落库时返回空串）。 */
async function resolveCover(
  prisma: PrismaClient,
  row: SeedRow,
): Promise<string[]> {
  const existing = await prisma.communityWorkflow.findUnique({
    where: { code: row.code },
    select: { coverKeys: true },
  });
  const stored = Array.isArray(existing?.coverKeys)
    ? (existing.coverKeys as unknown[])
    : [];
  if (stored.length) return stored.map(String);
  if (!row.coverRef) return [];
  if (/^https?:/i.test(row.coverRef)) return [row.coverRef];
  // 本地文件：只有配了 OSS 凭据才传（新库初始化常常还没有对象存储，不能因此卡住 seed）
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
    return [];
  }
  try {
    const { OssService } = await import('../src/oss/oss.service');
    const oss = new OssService();
    const bytes = readFileSync(join(DATA_DIR, row.coverRef));
    const uploaded = await oss.upload(
      `enterprise/official/community-covers/${row.code}-${row.coverRef}`,
      bytes,
    );
    return [uploaded.key];
  } catch (error) {
    console.warn(
      `[community-seed] ${row.code} 封面上传失败：${(error as Error).message}`,
    );
    return [];
  }
}

export async function seedCreativeCommunity(prisma: PrismaClient) {
  const rows = buildOfficialRows();
  if (!rows.length) {
    console.log(
      '[community-seed] 没有官方模板数据，跳过（跑 node scripts/import-comfy-templates.mjs 生成）',
    );
    return { created: 0, updated: 0, total: 0 };
  }
  let created = 0;
  for (const row of rows) {
    const coverKeys = await resolveCover(prisma, row);
    const content = {
      source: row.source,
      ownerName: row.ownerName,
      title: row.title,
      summary: row.summary,
      description: row.description,
      category: row.category,
      groupLabel: row.groupLabel,
      mediaType: row.mediaType,
      format: row.format,
      comfyUrl: row.comfyUrl,
      status: row.status,
      // 官方条目没有作者账号，占住发奖幂等标记，免得管理员推荐时给空账号加分
      rewardedAt: OFFICIAL_REWARDED_AT,
      tags: row.tags as Prisma.InputJsonValue,
      workflowJson: row.workflowJson as Prisma.InputJsonValue,
      slots: row.slots as Prisma.InputJsonValue,
      // 封面只在库里还没有时才处理：重跑 seed 不重复上传，也不会把已有对象键抹掉
      ...(coverKeys.length
        ? { coverKeys: coverKeys as Prisma.InputJsonValue }
        : {}),
    };
    const existing = await prisma.communityWorkflow.findUnique({
      where: { code: row.code },
      select: { id: true },
    });
    if (existing) {
      await prisma.communityWorkflow.update({
        where: { id: existing.id },
        data: content,
      });
    } else {
      created += 1;
      await prisma.communityWorkflow.create({
        data: {
          ...content,
          code: row.code,
          ownerUserId: row.ownerUserId,
          auditNote: '官方模板导入',
          auditedAt: new Date(),
          runCount: 0,
          favoriteCount: 0,
          likeCount: 0,
          viewCount: 0,
        },
      });
    }
  }
  const runnable = rows.filter((row) => row.format === 'api').length;
  console.log(
    `[community-seed] 官方条目 ${rows.length} 个（可直接运行 ${runnable} 个，仅浏览 ${rows.length - runnable} 个），新建 ${created} 行，` +
      `其余为幂等更新`,
  );
  return { created, updated: rows.length - created, total: rows.length };
}
