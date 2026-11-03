import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.number(),
    message: z.string(),
    data: data.nullable(),
  });

const emptyQuery = z.object({});
const passthroughBody = z.object({}).passthrough();

/** 模型槽位口径：与上游 /v1/models 的 aipdd.kind 对齐，enhance 是火山 MediaKit 的增强档位。 */
export const CONTENT_MEDIA_TYPES = [
  "text",
  "vision",
  "image",
  "video",
  "audio",
  "asr",
  "music",
  "embedding",
] as const;
export type ContentMediaType = (typeof CONTENT_MEDIA_TYPES)[number];

export const CONTENT_MEDIA_TYPE_LABELS: Record<ContentMediaType, string> = {
  text: "文本",
  vision: "视觉理解",
  image: "图像",
  video: "视频",
  audio: "语音合成",
  asr: "语音识别",
  music: "音乐",
  embedding: "向量嵌入",
};

/** 渠道类型：aipdd 内置（Key 取「API Key 管理」），custom 通用 OpenAI 兼容，mediakit 火山增强。 */
export const CONTENT_CHANNEL_PROVIDERS = [
  "aipdd",
  "custom",
  "volcengine",
  "mediakit",
] as const;
export type ContentChannelProvider = (typeof CONTENT_CHANNEL_PROVIDERS)[number];

/**
 * 渠道预设：填好地址与协议。只有 OpenAI 兼容（/v1/chat/completions 等）与 Anthropic 原生
 * 两类协议能直接接；其余厂商一律取它官方提供的 OpenAI 兼容端点（Gemini 的 /v1beta/openai、
 * 千帆 /v2、讯飞 /v1、Cohere /compatibility/v1），MiniMax 海外站与国内站 Key 不通用，拆两条。
 */
export const CONTENT_CHANNEL_PRESETS = [
  "openai",
  "anthropic",
  "deepseek",
  "qwen",
  "moonshot",
  "zhipu",
  "minimax",
  "minimax_cn",
  "hunyuan",
  "qianfan",
  "spark",
  "siliconflow",
  "openrouter",
  "gemini",
  "xai",
  "mistral",
  "perplexity",
  "cohere",
  "custom",
] as const;
export type ContentChannelPreset = (typeof CONTENT_CHANNEL_PRESETS)[number];

export const CONTENT_CHANNEL_PRESET_LABELS: Record<
  ContentChannelPreset,
  string
> = {
  openai: "OpenAI",
  anthropic: "Claude（Anthropic）",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  moonshot: "Moonshot Kimi",
  zhipu: "智谱 GLM",
  minimax: "MiniMax（海外）",
  minimax_cn: "MiniMax（国内）",
  hunyuan: "腾讯混元",
  qianfan: "百度千帆",
  spark: "讯飞星火",
  siliconflow: "硅基流动 SiliconFlow",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  xai: "xAI Grok",
  mistral: "Mistral",
  perplexity: "Perplexity",
  cohere: "Cohere",
  custom: "自定义",
};

export const CONTENT_CHANNEL_PRESET_BASE_URLS: Record<
  ContentChannelPreset,
  string
> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  minimax: "https://api.minimax.io/v1",
  minimax_cn: "https://api.minimax.cn/v1",
  hunyuan: "https://api.hunyuan.cloud.tencent.com/v1",
  qianfan: "https://qianfan.baidubce.com/v2",
  spark: "https://spark-api-open.xf-yun.com/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  perplexity: "https://api.perplexity.ai",
  cohere: "https://api.cohere.ai/compatibility/v1",
  custom: "",
};

export const CONTENT_CHANNEL_PROVIDER_LABELS: Record<
  ContentChannelProvider,
  string
> = {
  aipdd: "AIPDD（内置）",
  custom: "自定义 OpenAI 兼容（支持 NewAPI）",
  volcengine: "火山引擎（豆包 / 方舟）",
  mediakit: "火山 AI MediaKit",
};

export const contentModelChannelSchema = z.object({
  id: z.number(),
  provider: z.enum(CONTENT_CHANNEL_PROVIDERS),
  name: z.string(),
  baseUrl: z.string(),
  /** 只回掩码；明文只进不出 */
  keyMasked: z.string(),
  /** 火山引擎渠道的豆包语音识别 Key（与方舟 Key 不通用），只回掩码 */
  asrKeyMasked: z.string(),
  /** 渠道预设（openai/anthropic/.../custom）；空串＝老数据，按 OpenAI 兼容处理 */
  preset: z.string(),
  enabled: z.boolean(),
});

export const contentModelSlotSchema = z.object({
  mediaType: z.enum(CONTENT_MEDIA_TYPES),
  channelId: z.number(),
  model: z.string(),
});

export const contentSettingsSchema = z.object({
  channels: z.array(contentModelChannelSchema),
  slots: z.array(contentModelSlotSchema),
  /** AIPDD 内置渠道的 Key 状态（来自「API Key 管理」，本系统不落库） */
  aipdd: z.object({
    baseUrl: z.string(),
    configured: z.boolean(),
    keyMasked: z.string(),
    /** 账号在本系统单独保存 AIPDD Key 时的渠道行 id（0＝只用「API Key 管理」里的 Key） */
    localChannelId: z.number(),
  }),
});

/** 上游模型目录里的一条：kind 已归一成槽位口径，vision 标记来自 modalities 或名字兜底。 */
export const contentModelCapabilitiesSchema = z.object({
  /** 上游允许的尺寸档位（像素如 1024x1024，或档位如 1K/2K/4K） */
  sizes: z.array(z.string()),
  /** 上游允许的分辨率/画质档位 */
  qualities: z.array(z.string()),
  aspectRatios: z.array(z.string()),
  /** 视频模型声明的像素规格（如 480p/768p/1080p/2k/4k） */
  resolutions: z.array(z.string()),
  minDurationSeconds: z.number().optional(),
  maxDurationSeconds: z.number().optional(),
});

export const contentModelSchema = z.object({
  id: z.string(),
  kind: z.string(),
  vision: z.boolean(),
  /** 上游是否声明了端点（images/generations、videos 等），界面只用于提示能力，不做裁决 */
  endpoints: z.array(z.string()),
  /** 模型声明的可调参数档位；没有元数据的渠道不带这一项 */
  capabilities: contentModelCapabilitiesSchema.optional(),
});

export const contentModelsSchema = z.object({
  channelId: z.number(),
  baseUrl: z.string(),
  models: z.array(contentModelSchema),
});

export const contentChannelTestSchema = z.object({
  ok: z.boolean(),
  baseUrl: z.string(),
  modelCount: z.number(),
  message: z.string(),
});

export const contentAssetSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  kind: z.string(),
  url: z.string(),
  aipddAssetId: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const pageQuery = (defaultSize: number) =>
  z
    .object({
      page: z.coerce.number().int().positive().max(100_000).default(1),
      pageSize: z.coerce
        .number()
        .int()
        .positive()
        .max(200)
        .default(defaultSize),
    })
    .passthrough();

export const contentAssetsSchema = z.object({
  list: z.array(contentAssetSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

/** AIPDD 数字资产：完全读平台，本地不落表。type 由平台给（image/video/audio/file/其它）。 */
export const contentDigitalAssetSchema = z.object({
  id: z.number(),
  type: z.string(),
  name: z.string(),
  url: z.string(),
  /** 平台生成的缩略/预览直链；没有就是空串 */
  previewUrl: z.string(),
  /** MB */
  fileSize: z.number(),
  labels: z.array(z.string()),
  isOpen: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const contentDigitalAssetPageSchema = z.object({
  list: z.array(contentDigitalAssetSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

/** 共享资料：一条数字资产共享给一个企业内账号（多选时一个目标一行）。 */
export const contentSharedAssetSchema = z.object({
  id: z.number(),
  direction: z.enum(["SENT", "RECEIVED"]),
  ownerUserId: z.string(),
  ownerName: z.string().default(""),
  targetUserId: z.string(),
  targetName: z.string().default(""),
  assetId: z.string(),
  assetName: z.string().default(""),
  assetType: z.string().default("file"),
  assetSize: z.number().default(0),
  assetUrl: z.string().default(""),
  createdAt: z.string(),
});
export type ContentSharedAsset = z.infer<typeof contentSharedAssetSchema>;

export const contentShareTargetSchema = z.object({
  userId: z.string(),
  name: z.string(),
  phone: z.string().default(""),
  department: z.string().default(""),
});
export type ContentShareTarget = z.infer<typeof contentShareTargetSchema>;

export const contentConversationSchema = z.object({
  id: z.number(),
  title: z.string(),
  model: z.string(),
  /** 绑定的公共专家（0＝无）；expertName 是冗余名字，专家被删也保留 */
  expertId: z.number(),
  expertName: z.string(),
  /** 本会话的数字分身（0＝自动：每轮按语义自选）；personaName 同样是冗余快照 */
  personaId: z.number(),
  personaName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Agent 一轮对话的参考素材：label 是给模型看的名字（图片1 / 视频1 / 音频1），@ 也用它。 */
export const contentAgentReferenceSchema = z.object({
  label: z.string(),
  fileName: z.string(),
  url: z.string(),
  media: z.enum(["image", "video", "audio"]),
});
export type ContentAgentReference = z.infer<typeof contentAgentReferenceSchema>;

/** Agent 本轮要做的事：聊天 / 出图 / 出视频。 */
export const CONTENT_AGENT_MODES = ["text", "image", "video"] as const;
export type ContentAgentMode = (typeof CONTENT_AGENT_MODES)[number];
export const CONTENT_AGENT_MODE_LABELS: Record<ContentAgentMode, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
};

/**
 * Agent 回复风格：七种预设。prompt 原样注入系统提示；空串＝不额外限定。
 * 风格只调整语气与表达方式，不改变事实、工具用法与安全边界。
 */
export const CONTENT_AGENT_STYLES = [
  {
    key: "professional",
    label: "专业严谨",
    prompt:
      "用专业、严谨的口吻作答：术语准确，判断有依据，先给结论再讲理由；不确定的地方直说，不用夸张、情绪化的表达。",
  },
  {
    key: "friendly",
    label: "亲和友善",
    prompt:
      "用亲切、友善的口吻作答：像熟悉的朋友一样交流，多共情、多鼓励，少用生硬的公文腔；信息仍然要准确完整。",
  },
  {
    key: "direct",
    label: "直言不讳",
    prompt:
      "用直来直去的口吻作答：先给结论，有问题就直接指出，不绕弯子、不客套；批评只对事不对人。",
  },
  {
    key: "imaginative",
    label: "天马行空",
    prompt:
      "用发散、有想象力的方式作答：多给新颖的比喻、场景和可能性，敢于跳出常规；涉及事实、数据和结论时必须准确。",
  },
  {
    key: "sarcastic",
    label: "毒舌吐槽",
    prompt:
      "用带点毒舌吐槽的口吻作答：可以犀利调侃、点到为止地挖苦，但保持善意与有用，绝不人身攻击、歧视或侮辱用户。",
  },
  {
    key: "efficient",
    label: "高效务实",
    prompt:
      "用最短的篇幅给最有用的信息：结论先行、要点分条、能省的字就省，不铺垫、不重复，给出可执行的下一步。",
  },
  {
    key: "socratic",
    label: "启发引导",
    prompt:
      "用启发式的方式作答：先提关键问题、引导用户自己思考，再逐步给出提示和参考，不把答案一次性倒完。",
  },
] as const;
export type ContentAgentStyleKey = (typeof CONTENT_AGENT_STYLES)[number]["key"];

/** 人设设定最多 500 字（前后端同一上限）。 */
export const CONTENT_AGENT_PERSONA_MAX = 500;

/** 数字分身：名称 + 七种风格之一 + 人设。同一账号可建多个，长期记忆仍共用一套。 */
export const contentAgentPersonaSchema = z.object({
  id: z.number(),
  /** 名称：对话区与专题大厅里选择分身时显示，同账号内唯一 */
  name: z.string(),
  /** CONTENT_AGENT_STYLES 里的 key；空串＝不额外限定 */
  style: z.string(),
  /** 用户自己写的人设；空串＝不设置 */
  persona: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentAgentPersona = z.infer<typeof contentAgentPersonaSchema>;

/** 每账号最多 20 个分身；名称与上下限前后端同一份。 */
export const CONTENT_AGENT_PERSONA_MAX_COUNT = 20;
export const CONTENT_AGENT_PERSONA_NAME_MAX = 30;

export const contentAgentMessageSchema = z.object({
  id: z.number(),
  conversationId: z.number(),
  role: z.string(),
  content: z.string(),
  toolCalls: z.unknown(),
  media: z.unknown(),
  references: z.unknown(),
  status: z.string(),
  createdAt: z.string(),
});

export const contentMemoriesSchema = z.object({
  /** 长期记忆全文（注入提示词的那份），逐行一条，前端直接编辑这段文本 */
  block: z.string(),
  entries: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      content: z.string(),
      source: z.string(),
      createdAt: z.string(),
    }),
  ),
});

/**
 * 资料库条目：从「数字资产」里选中的文件，或 Agent 产出后回流（report）。
 * 只按登录账号归属；删掉条目后它就不再参与检索。
 */
export const contentLibraryItemSchema = z.object({
  id: z.number(),
  /** 来源数字资产 id；纯本地回流（平台不可用）时为 0 */
  aipddAssetId: z.number(),
  source: z.enum(["asset", "report"]),
  name: z.string(),
  /** md | txt | csv | json | html | docx | pptx | xlsx | pdf */
  type: z.string(),
  url: z.string(),
  fileSize: z.number(),
  charCount: z.number(),
  nodeCount: z.number(),
  /** ready | empty | failed | missing */
  status: z.string(),
  /** 失败/失效原因；正常时为空串 */
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentLibraryItem = z.infer<typeof contentLibraryItemSchema>;

/** 检索命中的片段：只给片段与出处，不带整库。 */
export const contentLibraryHitSchema = z.object({
  nodeId: z.number(),
  itemId: z.number(),
  itemName: z.string(),
  kind: z.string(),
  path: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type ContentLibraryHit = z.infer<typeof contentLibraryHitSchema>;

export const contentLibrarySearchSchema = z.object({
  question: z.string(),
  /** 语义重排是否跑通；false＝按词面相关度退回（note 里会说明） */
  semantic: z.boolean(),
  /** 本次检索覆盖的资料名 */
  scope: z.array(z.string()),
  hits: z.array(contentLibraryHitSchema),
  note: z.string(),
});
export type ContentLibrarySearch = z.infer<typeof contentLibrarySearchSchema>;

/** 节点全文（精读用）：按节点类型给出完整内容。 */
export const contentLibraryNodeSchema = z.object({
  id: z.number(),
  itemId: z.number(),
  itemName: z.string(),
  kind: z.string(),
  path: z.string(),
  ordinal: z.number(),
  chars: z.number(),
  content: z.string(),
});
export type ContentLibraryNode = z.infer<typeof contentLibraryNodeSchema>;

/** AI 对 Markdown 的改写草稿：用户接受后才写回正文。 */
export const contentLibraryDraftSchema = z.object({
  id: z.number(),
  itemId: z.number(),
  itemName: z.string(),
  /** 0＝整篇 */
  nodeId: z.number(),
  nodePath: z.string(),
  reason: z.string(),
  before: z.string(),
  after: z.string(),
  /** pending | accepted | rejected */
  status: z.string(),
  createdAt: z.string(),
});
export type ContentLibraryDraft = z.infer<typeof contentLibraryDraftSchema>;

/** 卡片字段：一个清单一个维度，界面按 type 渲染控件，后端按 required 校验。 */
export type ContentFieldType =
  "text" | "textarea" | "select" | "number" | "media";
export type ContentField = {
  key: string;
  label: string;
  type: ContentFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  mediaKind?: "image" | "video" | "audio";
  multiple?: boolean;
  min?: number;
  max?: number;
  defaultValue?: string | number;
};

export type ContentProduces = "image" | "video" | "audio" | "text";
export type ContentTool = {
  key: string;
  label: string;
  description: string;
  produces: ContentProduces;
  /** 需要哪些模型槽位（缺任一项就提示去模型设置） */
  slots: ContentMediaType[];
  /** 走火山 MediaKit（无该渠道时不渲染卡片） */
  mediaKit?: boolean;
  /** 提交后是长任务（前端轮询任务） */
  async?: boolean;
  fields: ContentField[];
};

const RATIO_OPTIONS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "adaptive",
].map((value) => ({
  value,
  label: value === "adaptive" ? "自适应" : value,
}));

/**
 * 内容创作的工具注册表：卡片、表单、后端校验与执行器共用这一份。
 * 只登记「不暂缓」的能力；需要服务器本地算力的工具不进这张表。
 */
export const CONTENT_TOOLS: Record<string, ContentTool> = {
  image: {
    key: "image",
    label: "文生图",
    description: "写一段画面描述，生成一张图。走「图像」默认模型。",
    produces: "image",
    slots: ["image"],
    fields: [
      {
        key: "prompt",
        label: "提示词",
        type: "textarea",
        required: true,
        placeholder: "主体、风格、构图、光影",
      },
      {
        key: "size",
        label: "尺寸",
        type: "select",
        defaultValue: "1024x1024",
        options: ["auto", "1024x1024", "1024x1536", "1536x1024"].map(
          (value) => ({
            value,
            label: value,
          }),
        ),
      },
    ],
  },
  video: {
    key: "video",
    label: "文生 / 图生视频",
    description:
      "写动作与镜头生成视频；可传首帧或首尾帧做图生视频。走「视频」默认模型。",
    produces: "video",
    slots: ["video"],
    async: true,
    fields: [
      {
        key: "prompt",
        label: "提示词",
        type: "textarea",
        required: true,
        placeholder: "主体、动作、镜头运动、风格",
      },
      {
        key: "firstFrame",
        label: "首帧（可选）",
        type: "media",
        mediaKind: "image",
      },
      {
        key: "lastFrame",
        label: "尾帧（可选）",
        type: "media",
        mediaKind: "image",
      },
      {
        key: "duration",
        label: "时长（秒）",
        type: "number",
        min: 1,
        max: 30,
        defaultValue: 5,
      },
      {
        key: "resolution",
        label: "像素规格（分辨率）",
        type: "select",
        defaultValue: "720p",
        options: ["480p", "720p", "1080p"].map((value) => ({
          value,
          label: value,
        })),
      },
      {
        key: "ratio",
        label: "尺寸（画面比例）",
        type: "select",
        defaultValue: "16:9",
        options: RATIO_OPTIONS,
      },
    ],
  },
  "video-clone": {
    key: "video-clone",
    label: "视频复刻",
    description: "按一条源视频重做一遍，可传不超过 4 张参考图约束画面。",
    produces: "video",
    slots: ["video"],
    async: true,
    fields: [
      {
        key: "video",
        label: "源视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      {
        key: "prompt",
        label: "复刻要求",
        type: "textarea",
        required: true,
        placeholder: "要保留什么、要改什么",
      },
      {
        key: "references",
        label: "参考图（最多 4 张）",
        type: "media",
        mediaKind: "image",
        multiple: true,
      },
    ],
  },
  "lip-sync": {
    key: "lip-sync",
    label: "数字人视频",
    description: "用一段音频驱动底板人物说话，产出带声音的视频。",
    produces: "video",
    slots: ["video"],
    async: true,
    fields: [
      {
        key: "base",
        label: "底板（视频或图）",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      {
        key: "audio",
        label: "音频",
        type: "media",
        mediaKind: "audio",
        required: true,
      },
      {
        key: "prompt",
        label: "补充说明",
        type: "text",
        placeholder: "可选：表情、镜头要求",
      },
    ],
  },
  replace: {
    key: "replace",
    label: "视频换人换产品",
    description: "把源视频里的人或产品换成你给的那张图。",
    produces: "video",
    slots: ["video"],
    async: true,
    fields: [
      {
        key: "video",
        label: "源视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      {
        key: "subject",
        label: "替换的人物/产品图",
        type: "media",
        mediaKind: "image",
        required: true,
      },
      {
        key: "mode",
        label: "替换对象",
        type: "select",
        defaultValue: "人物",
        options: [
          { value: "人物", label: "人物" },
          { value: "产品", label: "产品" },
        ],
      },
    ],
  },
  "video-erase": {
    key: "video-erase",
    label: "视频去水印",
    description:
      "用火山 AI MediaKit 擦除字幕、水印或任意位置的文字，只保留画面。",
    produces: "video",
    slots: [],
    mediaKit: true,
    async: true,
    fields: [
      {
        key: "video",
        label: "视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      {
        key: "mode",
        label: "擦除方式",
        type: "select",
        defaultValue: "Subtitle",
        options: [
          { value: "Subtitle", label: "Subtitle（智能检测字幕）" },
          { value: "Text", label: "Text（框选擦除）" },
        ],
      },
      {
        key: "box",
        label: "框选范围",
        type: "text",
        placeholder: "Text 模式可选：x,y,宽,高（0~1 比例）",
      },
    ],
  },
  "video-upscale": {
    key: "video-upscale",
    label: "视频超分",
    description:
      "用火山 AI MediaKit 生成式增强把视频升到更高分辨率（耗时约为片长的 15–20 倍）。",
    produces: "video",
    slots: [],
    mediaKit: true,
    async: true,
    fields: [
      {
        key: "video",
        label: "视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      {
        key: "resolution",
        label: "目标分辨率",
        type: "select",
        defaultValue: "1080p",
        options: ["720p", "1080p", "2k", "4k"].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
  },
  "image-edit": {
    key: "image-edit",
    label: "图片修图 / 去水印",
    description: "按一句话修改或擦除图片里的内容。走「图像」默认模型。",
    produces: "image",
    slots: ["image"],
    fields: [
      {
        key: "image",
        label: "原图",
        type: "media",
        mediaKind: "image",
        required: true,
      },
      {
        key: "prompt",
        label: "修改要求",
        type: "textarea",
        required: true,
        placeholder: "例如：去掉右下角的水印，保留人物",
      },
    ],
  },
  asr: {
    key: "asr",
    label: "音视频提取文案",
    description: "把视频或音频里的说话内容转成文字。走「语音识别」默认模型。",
    produces: "text",
    slots: ["asr"],
    async: true,
    fields: [
      {
        key: "media",
        label: "音视频文件",
        type: "media",
        mediaKind: "audio",
        required: true,
      },
      {
        key: "language",
        label: "语言",
        type: "select",
        defaultValue: "zh",
        options: [
          { value: "zh", label: "中文" },
          { value: "en", label: "英文" },
          { value: "auto", label: "自动" },
        ],
      },
    ],
  },
  tts: {
    key: "tts",
    label: "语音合成",
    description: "把文字读成音频。走「语音合成」默认模型。",
    produces: "audio",
    slots: ["audio"],
    async: true,
    fields: [
      { key: "text", label: "要读的文字", type: "textarea", required: true },
      {
        key: "voice",
        label: "声线（可选）",
        type: "text",
        placeholder: "模型支持的声线名，留空用默认",
      },
      {
        key: "format",
        label: "格式",
        type: "select",
        defaultValue: "mp3",
        options: [
          { value: "mp3", label: "mp3" },
          { value: "wav", label: "wav" },
        ],
      },
    ],
  },
  music: {
    key: "music",
    label: "音乐创作",
    description: "用一段描述（可带歌词）生成音乐。走「音乐」默认模型。",
    produces: "audio",
    slots: ["music"],
    async: true,
    fields: [
      {
        key: "prompt",
        label: "风格描述",
        type: "textarea",
        required: true,
        placeholder: "风格、情绪、乐器、速度",
      },
      { key: "lyrics", label: "歌词（可选）", type: "textarea" },
      {
        key: "duration",
        label: "时长（秒，可选）",
        type: "number",
        min: 10,
        max: 300,
      },
    ],
  },
  dubbing: {
    key: "dubbing",
    label: "视频配音",
    description:
      "先生成配音，再让对口型模型把声音和画面合到一起，产出带新音轨的视频。",
    produces: "video",
    slots: ["audio", "video"],
    async: true,
    fields: [
      {
        key: "video",
        label: "源视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
      { key: "text", label: "台词", type: "textarea", required: true },
      { key: "voice", label: "声线（可选）", type: "text" },
    ],
  },
  "video-mix": {
    key: "video-mix",
    label: "混剪短视频",
    description:
      "给多段素材和一段文案，让视频模型按文案一次成片（不是逐段剪辑时间线）。",
    produces: "video",
    slots: ["video"],
    async: true,
    fields: [
      {
        key: "materials",
        label: "素材（图 / 视频，可多选）",
        type: "media",
        mediaKind: "image",
        multiple: true,
        required: true,
      },
      {
        key: "prompt",
        label: "文案 / 剪辑要求",
        type: "textarea",
        required: true,
      },
      {
        key: "duration",
        label: "时长（秒）",
        type: "number",
        min: 2,
        max: 30,
        defaultValue: 15,
      },
    ],
  },
  script: {
    key: "script",
    label: "视频反推剧本",
    description: "给一条视频，让「视觉理解」模型读画面写成可拍的分镜脚本。",
    produces: "text",
    slots: ["vision"],
    async: true,
    fields: [
      {
        key: "video",
        label: "视频",
        type: "media",
        mediaKind: "video",
        required: true,
      },
    ],
  },
  copywriting: {
    key: "copywriting",
    label: "口播稿 / 公众号文章",
    description: "按主题写口播稿或公众号文章。走「文本」默认模型。",
    produces: "text",
    slots: ["text"],
    fields: [
      { key: "topic", label: "主题 / 素材", type: "textarea", required: true },
      {
        key: "kind",
        label: "文体",
        type: "select",
        defaultValue: "口播稿",
        options: [
          { value: "口播稿", label: "口播稿" },
          { value: "公众号文章", label: "公众号文章" },
        ],
      },
      {
        key: "tone",
        label: "语气（可选）",
        type: "text",
        placeholder: "例如：专业、轻松、有感染力",
      },
    ],
  },
};

export const contentJobSchema = z.object({
  id: z.number(),
  tool: z.string(),
  status: z.string(),
  input: z.record(z.string(), z.unknown()),
  /** 本轮用户选的模型：{ mediaType: { channelId, model } } */
  models: z.unknown(),
  output: z.record(z.string(), z.unknown()),
  assetUrl: z.string(),
  aipddAssetId: z.string(),
  error: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const contentJobPageSchema = z.object({
  list: z.array(contentJobSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const contentAgentSkillSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  /** 技能包内的附加文本文件数（zip 上传才有） */
  fileCount: z.number(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  enabled: z.boolean(),
  updatedAt: z.string(),
});

/**
 * Agent 插件：插件包（zip）或 SkillHub 插件目录安装，说明进系统提示，模型用 load_plugin 取全文。
 * commands＝包内 commands/*.md 展开出的插件命令：模型用 run_plugin_command 拿到正文后照它跑业务。
 */
export const contentAgentPluginSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  /** 插件包内的附加文本文件数（zip 上传才有） */
  fileCount: z.number(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  /** 插件命令清单（来自包内 commands/*.md；目录安装的插件为空数组） */
  commands: z.array(
    z.object({ name: z.string(), description: z.string(), path: z.string() }),
  ),
  /** upload＝上传插件包；skillhub＝从插件的 SkillHub 目录安装 */
  source: z.string(),
  /** 插件目录来源 owner/name；上传包为空串 */
  sourceSlug: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string(),
});

/** MCP 连接器接入方式：http＝Streamable HTTP，sse＝旧版 HTTP+SSE。 */
export const CONTENT_CONNECTOR_TRANSPORTS = ["http", "sse"] as const;
export type ContentConnectorTransport =
  (typeof CONTENT_CONNECTOR_TRANSPORTS)[number];

export const CONTENT_CONNECTOR_TRANSPORT_LABELS: Record<
  ContentConnectorTransport,
  string
> = {
  http: "Streamable HTTP",
  sse: "SSE（旧版）",
};

/**
 * Agent 的 MCP 连接器：`id=0` 是内置的本站 MCP Server（只读，不可删），
 * 其余是当前账号自己添加的外部 MCP Server。额外请求头只回名字，值只进不出。
 */
export const contentAgentConnectorSchema = z.object({
  id: z.number(),
  name: z.string(),
  transport: z.enum(["builtin", "http", "sse"]),
  url: z.string(),
  /** 额外请求头的名字（值已加密落库，不回显） */
  headerNames: z.array(z.string()),
  enabled: z.boolean(),
  toolCount: z.number(),
  /** 工具名清单（内置固定六项；外部连接器取最近一次探测结果） */
  tools: z.array(z.string()),
  /** 最近一次探测/调用的中文错误；空串＝正常 */
  lastError: z.string(),
  lastCheckedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ContentAgentConnector = z.infer<typeof contentAgentConnectorSchema>;

/** 「测试连接」的结果：不落库也能测未保存的表单值。 */
export const contentConnectorTestSchema = z.object({
  ok: z.boolean(),
  toolCount: z.number(),
  tools: z.array(z.string()),
  message: z.string(),
});
export type ContentConnectorTest = z.infer<typeof contentConnectorTestSchema>;

export const contentAgentExpertSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  /** 创建时用户填写的指令原文 */
  instruction: z.string(),
  /** 生成好的角色提示（注入 Agent 系统提示） */
  prompt: z.string(),
  creatorId: z.string(),
  creatorName: z.string(),
  /** 被启用过的会话数（热度排序） */
  useCount: z.number(),
  /** 当前登录账号是否是创建人（决定删除入口） */
  mine: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Agent 定时任务：到点把 instruction 作为一轮对话交给 Agent 跑。
 * 排期字段与 RPA 任务、Workbuddy 计划同一套口径（scheduled 定时一次 / recurring 周期重复）。
 */
export const contentAgentScheduleSchema = z.object({
  id: z.number(),
  /** 预设模板 id；空串＝自定义任务 */
  preset: z.string(),
  title: z.string(),
  instruction: z.string(),
  /** 结果落到哪个会话；0＝首次执行时新建 */
  conversationId: z.number(),
  expertId: z.number(),
  expertName: z.string(),
  /** 本任务的数字分身（0＝自动） */
  personaId: z.number(),
  personaName: z.string(),
  /** 随任务固定引用的技能 id；空数组＝全部启用中的技能 */
  skillIds: z.array(z.number()),
  /** 随任务固定引用的插件 id；空数组＝全部启用中的插件 */
  pluginIds: z.array(z.number()),
  /** 随任务固定引用的资料库条目 id；空数组＝整库检索 */
  libraryIds: z.array(z.number()),
  /** 随任务固定引用的 MCP 连接器 id；空数组＝全部启用中的连接器（0＝本站 MCP Server） */
  connectorIds: z.array(z.number()),
  /** 本任务只处理哪些邮箱账号 id；空数组＝不限定 */
  mailboxIds: z.array(z.number()),
  /** 任务固定的参考文件（图片 / 视频 / 音频） */
  references: z.array(contentAgentReferenceSchema),
  /** 文本模型渠道；0＝「模型设置」的文本槽位 */
  channelId: z.number(),
  model: z.string(),
  scheduleType: z.enum(["scheduled", "recurring"]),
  scheduleConfig: z.record(z.string(), z.unknown()),
  scheduledAt: z.string().nullable(),
  status: z.enum(["enabled", "paused"]),
  lastRunAt: z.string().nullable(),
  /** 最近一次执行结果：succeeded | failed；空串＝还没跑过 */
  lastStatus: z.string(),
  lastError: z.string(),
  runCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentAgentSchedule = z.infer<typeof contentAgentScheduleSchema>;

/** 一次执行记录：成功后可用 conversationId 直接打开那轮对话 */
export const contentAgentScheduleRunSchema = z.object({
  id: z.number(),
  scheduleId: z.number(),
  trigger: z.enum(["scheduled", "manual"]),
  status: z.enum(["running", "succeeded", "failed"]),
  conversationId: z.number(),
  messageId: z.number(),
  summary: z.string(),
  error: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ContentAgentScheduleRun = z.infer<
  typeof contentAgentScheduleRunSchema
>;

/** 常用任务模板：界面卡片与首屏，点开只做预填，落库仍是普通定时任务。 */
export type ContentAgentSchedulePreset = {
  id: string;
  title: string;
  description: string;
  /** 依赖的外部能力（界面上直接告诉用户要先接什么） */
  requires: string;
  scheduleType: "scheduled" | "recurring";
  scheduleConfig: {
    freq?: "minutes" | "hourly" | "daily" | "weekly" | "monthly";
    /** freq=minutes 时的间隔分钟数 */
    interval?: 10 | 30;
    time?: string;
    weekdays?: number[];
    day?: number;
    minute?: number;
  };
  /** 模板预填要引用的 MCP 连接器；0＝本站 MCP Server */
  connectorIds?: number[];
  instruction: string;
};

export const CONTENT_AGENT_SCHEDULE_PRESETS: ContentAgentSchedulePreset[] = [
  {
    id: "daily_news",
    title: "每日新闻推送",
    description: "每天定时整理当日要闻，产出一份可直接转发的简报。",
    requires: "资讯类 MCP 连接器（搜索/抓取）",
    scheduleType: "recurring",
    scheduleConfig: { freq: "daily", time: "08:00" },
    instruction: `请给我今天的行业要闻简报。
步骤：
1. 先检查是否已启用可用的资讯来源（「MCP 连接器」里的搜索/抓取工具，或技能里指定的信息源）。
2. 有来源时：检索当天与本企业业务相关的要闻，按「政策法规 / 行业动态 / 竞争对手 / 风险提示」四类整理，每条给 1-2 句摘要并标注来源与日期，最后用一句话给出今天值得关注的重点。
3. 没有可用来源时：直接说明「当前没有接入可用的资讯来源，无法获取今日新闻」，并提示在「MCP 连接器」里添加搜索类工具；不要编造新闻、日期或链接。
输出用 Markdown，控制在 800 字以内。`,
  },
  {
    id: "weekly_report",
    title: "每周工作周报",
    description: "每周五下班前汇总本周完成、在办与下周计划。",
    requires: "无需额外配置（依据长期记忆与本系统操作记录）",
    scheduleType: "recurring",
    scheduleConfig: { freq: "weekly", time: "17:30", weekdays: [5] },
    instruction: `请生成本周工作周报。
步骤：
1. 从长期记忆和「最近在这个系统里的操作」里提取本周与工作相关的记录（任务、需求、单据、客户跟进）。
2. 按「本周完成 / 进行中 / 遇到的问题 / 下周计划」四段整理，每条一句话；能落到具体对象（客户、单据号、需求名）就写具体。
3. 资料库里有相关文档时，用 search_library 检索后补充关键数据并标注出处。
4. 没有可依据的记录时，如实说明素材不足，并列出需要我补充的信息，不要虚构进度或数字。
输出 Markdown，可直接粘贴到周报系统。`,
  },
  {
    id: "daily_report",
    title: "每天工作日报",
    description: "每天下班前生成当日工作日报，300 字以内。",
    requires: "无需额外配置（依据长期记忆与本系统操作记录）",
    scheduleType: "recurring",
    scheduleConfig: { freq: "daily", time: "18:00" },
    instruction: `请生成今天的工作日报。
步骤：
1. 从长期记忆与「最近在这个系统里的操作」里提取今天的记录（做过的任务、处理的需求/单据、沟通过的客户）。
2. 按「今日完成 / 进行中 / 明日计划 / 需要协助」四段整理，每条一句话，带具体对象。
3. 缺少记录时如实说明，不要编造工作量。
输出 Markdown，300 字以内。`,
  },
  {
    id: "mail_triage",
    title: "邮件定时处理",
    description:
      "每 30 分钟读取邮箱的未读邮件，按场景话术起草回复；要处理哪些邮箱写在指令里，不写＝全部已启用邮箱。",
    requires:
      "「AI邮箱服务」里已启用的邮箱 + 本站 MCP Server 连接器（mail_* 工具）",
    scheduleType: "recurring",
    scheduleConfig: { freq: "minutes", interval: 30 },
    connectorIds: [0],
    instruction: `请处理邮箱里需要回复的邮件。
步骤：
1. 调用 mail_list_mailboxes，确认本次要处理的邮箱、回复方式与单轮上限；按指令里写明的邮箱处理，指令没有写明时处理全部已启用邮箱。
2. 调用 mail_list_messages，读取这些邮箱最近 24 小时的未读邮件，每轮最多处理 10 封。
3. 逐封用 mail_read_message 读正文，按「需要我回复 / 需要转交他人 / 仅需知会 / 可归档」分类，并结合「AI邮箱服务 → 知识与话术」里的场景话术起草回复；没有命中话术时按邮件内容写一封简洁、礼貌的中文回复。
4. 需要回复的邮件调用 mail_create_draft 存成草稿；只有该邮箱回复方式为「写草稿并自动回复」时才可以调用 mail_send_reply 直接发出，其余情况一律只留草稿。
5. 跳过自动提交邮件、退信通知、邮件列表/群发邮件和自己发给自己的邮件；同一发件人今天已经自动回复过的不再重复回复。
6. 结束后输出 Markdown 清单：邮箱、发件人、主题、处理结果（已发送/已生成草稿/已跳过）与一句话说明；本轮没有需要回复的邮件时直接说明「本轮没有需要回复的未读邮件」，不要编造邮件内容。`,
  },
];

/** Agent 助理可接入的第三方消息通道。 */
export const CONTENT_AGENT_ASSISTANT_KINDS = [
  "wecom_app",
  "wecom_bot",
  "wecom_kf",
  "dingtalk_robot",
  "dingtalk_webhook",
  "feishu_app",
  "qq_onebot",
  "wechat_mp",
] as const;
export type ContentAgentAssistantKind =
  (typeof CONTENT_AGENT_ASSISTANT_KINDS)[number];

/** 一条助理通道：凭据整体加密落库，界面上敏感项只回「是否已填」。 */
export const contentAgentAssistantChannelSchema = z.object({
  id: z.number(),
  kind: z.enum(CONTENT_AGENT_ASSISTANT_KINDS),
  kindLabel: z.string(),
  name: z.string(),
  /** 公开回调路径里的随机串 */
  webhookToken: z.string(),
  /** 拼接好的回调路径（前端补上站点域名） */
  webhookPath: z.string(),
  /** 非敏感配置项的值（敏感项一律不回显） */
  config: z.record(z.string(), z.string()),
  /** 已保存值的敏感配置项 key */
  secretKeys: z.array(z.string()),
  /** 执行用文本模型；channelId=0 表示取「模型设置」文本槽位（无人值守会失败） */
  channelId: z.number(),
  model: z.string(),
  /** 允许的发送者 ID，逗号分隔；空串＝不限制 */
  allowedUsers: z.string(),
  enabled: z.boolean(),
  lastEventAt: z.string().nullable(),
  lastError: z.string(),
  eventCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentAgentAssistantChannel = z.infer<
  typeof contentAgentAssistantChannelSchema
>;

/** 「测试连接」结果：出站型渠道真发一条测试消息，双向型只校验凭据。 */
export const contentAgentAssistantTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ContentAgentAssistantTest = z.infer<
  typeof contentAgentAssistantTestSchema
>;

/** 助理消息日志：in＝来自第三方，out＝Agent 回出去。 */
export const contentAgentAssistantMessageSchema = z.object({
  id: z.number(),
  channelId: z.number(),
  externalChatId: z.string(),
  externalMsgId: z.string().nullable(),
  direction: z.enum(["in", "out"]),
  content: z.string(),
  /** received | running | succeeded | failed | ignored */
  status: z.string(),
  error: z.string(),
  conversationId: z.number(),
  createdAt: z.string(),
});
export type ContentAgentAssistantMessage = z.infer<
  typeof contentAgentAssistantMessageSchema
>;

export type ContentAgentAssistantField = {
  key: string;
  label: string;
  /** 值加密落库、界面只显示「已填写」 */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
};

/** 渠道种类描述：前端卡片与动态表单共用，后端校验也引用同一份 key。 */
export type ContentAgentAssistantKindSpec = {
  kind: ContentAgentAssistantKind;
  label: string;
  /** twoWay＝可收可回（能远程指挥）；pushOnly＝只出不进（推送结果） */
  direction: "twoWay" | "pushOnly";
  description: string;
  /** 去哪拿凭据、要开哪些权限 */
  setup: string;
  /** 回调地址要填到平台的哪个位置（pushOnly 无） */
  callbackHint?: string;
  fields: ContentAgentAssistantField[];
};

export const CONTENT_AGENT_ASSISTANT_KIND_SPECS: ContentAgentAssistantKindSpec[] =
  [
    {
      kind: "wecom_app",
      label: "企业微信应用",
      direction: "twoWay",
      description: "自建应用收发消息，可在企业微信里直接给 Agent 发指令。",
      setup:
        "企业微信管理后台 → 应用管理 → 自建应用 → 接收消息 → 设置 API 接收；记录 CorpID、AgentId、应用 Secret、Token、EncodingAESKey，并开通「消息推送」权限。",
      callbackHint:
        "把回调地址填到该应用「接收消息」的 URL，Token/EncodingAESKey 与这里填的一致。",
      fields: [
        {
          key: "corpId",
          label: "企业 CorpID",
          required: true,
          placeholder: "ww...",
        },
        {
          key: "agentId",
          label: "应用 AgentId",
          required: true,
          placeholder: "1000002",
        },
        { key: "secret", label: "应用 Secret", secret: true, required: true },
        { key: "token", label: "接收消息 Token", secret: true, required: true },
        {
          key: "encodingAesKey",
          label: "EncodingAESKey",
          secret: true,
          required: true,
          placeholder: "43 位",
        },
      ],
    },
    {
      kind: "wecom_kf",
      label: "微信客服",
      direction: "twoWay",
      description:
        "企业微信「微信客服」账号，微信用户加客服后可直接对话；受平台 48 小时会话窗口限制（用户最后一次发言后 48 小时内可回复）。",
      setup:
        "企业微信管理后台 → 应用管理 → 微信客服 → 开发配置 → 接收消息（Token / EncodingAESKey），并记录客服账号 ID（open_kfid）。",
      callbackHint: "把回调地址填到「微信客服 → 开发配置 → 接收消息」的 URL。",
      fields: [
        {
          key: "corpId",
          label: "企业 CorpID",
          required: true,
          placeholder: "ww...",
        },
        {
          key: "secret",
          label: "微信客服 Secret",
          secret: true,
          required: true,
        },
        {
          key: "openKfId",
          label: "客服账号 open_kfid",
          required: true,
          placeholder: "wk...",
        },
        { key: "token", label: "接收消息 Token", secret: true, required: true },
        {
          key: "encodingAesKey",
          label: "EncodingAESKey",
          secret: true,
          required: true,
          placeholder: "43 位",
        },
      ],
    },
    {
      kind: "wecom_bot",
      label: "企业微信群机器人",
      direction: "pushOnly",
      description: "只能往群里推送消息，收不到群里的指令。",
      setup:
        "群聊 → 右上角 → 群机器人 → 添加机器人 → 复制 Webhook 地址（或只复制 key= 后面的部分）。",
      fields: [
        {
          key: "webhookKey",
          label: "Webhook Key",
          secret: true,
          required: true,
          hint: "整条 Webhook 地址或 key 后面的串都可以",
        },
      ],
    },
    {
      kind: "dingtalk_robot",
      label: "钉钉机器人",
      direction: "twoWay",
      description: "企业内部机器人，在钉钉单聊或群里 @ 机器人即可指挥 Agent。",
      setup:
        "钉钉开发者后台 → 应用 → 机器人 → 消息接收模式选「HTTP 推送」，填回调地址；记录 AppKey、AppSecret、RobotCode。",
      callbackHint: "把回调地址填到机器人「消息接收地址」。",
      fields: [
        {
          key: "appKey",
          label: "AppKey",
          required: true,
          placeholder: "ding...",
        },
        { key: "appSecret", label: "AppSecret", secret: true, required: true },
        {
          key: "robotCode",
          label: "RobotCode",
          required: true,
          placeholder: "ding...",
        },
      ],
    },
    {
      kind: "dingtalk_webhook",
      label: "钉钉自定义群机器人",
      direction: "pushOnly",
      description: "只能往群里推送消息，收不到群里的指令。",
      setup:
        "群设置 → 机器人 → 添加机器人 → 自定义 → 复制 Webhook 地址；安全设置选「加签」时把密钥一并填进来。",
      fields: [
        {
          key: "webhookUrl",
          label: "Webhook 地址",
          secret: true,
          required: true,
          placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
        },
        {
          key: "signSecret",
          label: "加签密钥",
          secret: true,
          hint: "安全设置选了「加签」才需要填",
        },
      ],
    },
    {
      kind: "feishu_app",
      label: "飞书自建应用",
      direction: "twoWay",
      description: "在飞书里给机器人发消息，Agent 处理完直接回复到同一会话。",
      setup:
        "飞书开放平台 → 自建应用 → 事件订阅（请求地址填回调地址，订阅 im.message.receive_v1），开通 im:message:send_as_bot 权限并发布版本。",
      callbackHint:
        "把回调地址填到「事件订阅 → 请求地址」，Encrypt Key 与 Verification Token 按同一页填写。",
      fields: [
        {
          key: "appId",
          label: "App ID",
          required: true,
          placeholder: "cli_...",
        },
        { key: "appSecret", label: "App Secret", secret: true, required: true },
        {
          key: "verificationToken",
          label: "Verification Token",
          secret: true,
          required: true,
        },
        {
          key: "encryptKey",
          label: "Encrypt Key",
          secret: true,
          hint: "未开启加密可留空",
        },
      ],
    },
    {
      kind: "qq_onebot",
      label: "QQ 机器人（OneBot）",
      direction: "twoWay",
      description:
        "通过 NapCat / LLOneBot 等 OneBot v11 实现接入，单聊或群 @ 都能指挥 Agent。",
      setup:
        "在 QQ 机器人框架里开启 HTTP 上报（上报地址填回调地址）与 HTTP API，记下 API 地址和 Access Token。",
      callbackHint: "把回调地址填到 OneBot 的 HTTP 上报地址（POST）。",
      fields: [
        {
          key: "apiBase",
          label: "HTTP API 地址",
          required: true,
          placeholder: "http://127.0.0.1:3000",
        },
        {
          key: "accessToken",
          label: "Access Token",
          secret: true,
          hint: "框架里配置了才需要填",
        },
      ],
    },
    {
      kind: "wechat_mp",
      label: "微信公众号服务号",
      direction: "twoWay",
      description:
        "关注者给服务号发消息即可指挥 Agent；客服消息同样受平台 48 小时会话窗口限制（用户最后一次发言后 48 小时内可回复）。",
      setup:
        "公众号后台 → 设置与开发 → 基本配置 → 服务器配置（URL 填回调地址，填 Token / EncodingAESKey），并开启客服消息接口权限。",
      callbackHint:
        "把回调地址填到「服务器配置」的 URL，Token / EncodingAESKey 与这里填的一致。",
      fields: [
        { key: "appId", label: "AppID", required: true, placeholder: "wx..." },
        { key: "appSecret", label: "AppSecret", secret: true, required: true },
        {
          key: "token",
          label: "服务器配置 Token",
          secret: true,
          required: true,
        },
        {
          key: "encodingAesKey",
          label: "EncodingAESKey",
          secret: true,
          required: true,
        },
      ],
    },
  ];

export const ContentEndpoints = {
  Content_settings: {
    method: "get" as const,
    path: "/enterprise/content/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentSettingsSchema),
  },
  Content_saveSettings: {
    method: "put" as const,
    path: "/enterprise/content/settings",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentSettingsSchema),
  },
  Content_saveChannel: {
    method: "post" as const,
    path: "/enterprise/content/channels",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentModelChannelSchema),
  },
  Content_removeChannel: {
    method: "delete" as const,
    path: "/enterprise/content/channels/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_testChannel: {
    method: "post" as const,
    path: "/enterprise/content/channels/test",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentChannelTestSchema),
  },
  Content_models: {
    method: "get" as const,
    path: "/enterprise/content/models",
    params: z.object({}),
    query: z
      .object({ channelId: z.coerce.number().int().nonnegative().default(0) })
      .passthrough(),
    body: z.undefined(),
    response: envelope(contentModelsSchema),
  },
  Content_assets: {
    method: "get" as const,
    path: "/enterprise/content/assets",
    params: z.object({}),
    query: pageQuery(20),
    body: z.undefined(),
    response: envelope(contentAssetsSchema),
  },
  Content_digitalAssets: {
    method: "get" as const,
    path: "/enterprise/content/digital-assets",
    params: z.object({}),
    query: z
      .object({
        page: z.coerce.number().int().positive().max(100_000).default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(24),
        /** image / video / audio / file；空＝全部 */
        type: z.string().optional(),
        keyword: z.string().optional(),
        label: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: envelope(contentDigitalAssetPageSchema),
  },
  Content_digitalAssetLabels: {
    method: "get" as const,
    path: "/enterprise/content/digital-assets/labels",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.string())),
  },
  Content_tagDigitalAsset: {
    method: "put" as const,
    path: "/enterprise/content/digital-assets/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentDigitalAssetSchema),
  },
  Content_jobs: {
    method: "get" as const,
    path: "/enterprise/content/jobs",
    params: z.object({}),
    query: z
      .object({
        page: z.coerce.number().int().positive().max(100_000).default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(20),
        tool: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: envelope(contentJobPageSchema),
  },
  Content_createJob: {
    method: "post" as const,
    path: "/enterprise/content/jobs",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentJobSchema),
  },
  Content_job: {
    method: "get" as const,
    path: "/enterprise/content/jobs/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentJobSchema),
  },
  Content_cancelJob: {
    method: "post" as const,
    path: "/enterprise/content/jobs/:id/cancel",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentJobSchema),
  },
  Content_skills: {
    method: "get" as const,
    path: "/enterprise/content/agent/skills",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentSkillSchema)),
  },
  Content_toggleSkill: {
    method: "put" as const,
    path: "/enterprise/content/agent/skills/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentSkillSchema),
  },
  Content_removeSkill: {
    method: "delete" as const,
    path: "/enterprise/content/agent/skills/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_plugins: {
    method: "get" as const,
    path: "/enterprise/content/agent/plugins",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentPluginSchema)),
  },
  Content_togglePlugin: {
    method: "put" as const,
    path: "/enterprise/content/agent/plugins/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentPluginSchema),
  },
  Content_removePlugin: {
    method: "delete" as const,
    path: "/enterprise/content/agent/plugins/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_experts: {
    method: "get" as const,
    path: "/enterprise/content/agent/experts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentExpertSchema)),
  },
  Content_createExpert: {
    method: "post" as const,
    path: "/enterprise/content/agent/experts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentExpertSchema),
  },
  Content_removeExpert: {
    method: "delete" as const,
    path: "/enterprise/content/agent/experts/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_connectors: {
    method: "get" as const,
    path: "/enterprise/content/agent/connectors",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentConnectorSchema)),
  },
  Content_createConnector: {
    method: "post" as const,
    path: "/enterprise/content/agent/connectors",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentConnectorSchema),
  },
  Content_updateConnector: {
    method: "put" as const,
    path: "/enterprise/content/agent/connectors/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentConnectorSchema),
  },
  Content_removeConnector: {
    method: "delete" as const,
    path: "/enterprise/content/agent/connectors/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_testConnector: {
    method: "post" as const,
    path: "/enterprise/content/agent/connectors/test",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentConnectorTestSchema),
  },
  Content_conversations: {
    method: "get" as const,
    path: "/enterprise/content/agent/conversations",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentConversationSchema)),
  },
  Content_createConversation: {
    method: "post" as const,
    path: "/enterprise/content/agent/conversations",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentConversationSchema),
  },
  Content_updateConversation: {
    method: "put" as const,
    path: "/enterprise/content/agent/conversations/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentConversationSchema),
  },
  Content_removeConversation: {
    method: "delete" as const,
    path: "/enterprise/content/agent/conversations/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_messages: {
    method: "get" as const,
    path: "/enterprise/content/agent/conversations/:id/messages",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentMessageSchema)),
  },
  Content_memories: {
    method: "get" as const,
    path: "/enterprise/content/agent/memories",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentMemoriesSchema),
  },
  Content_saveMemories: {
    method: "put" as const,
    path: "/enterprise/content/agent/memories",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentMemoriesSchema),
  },
  Content_personas: {
    method: "get" as const,
    path: "/enterprise/content/agent/personas",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentPersonaSchema)),
  },
  Content_createPersona: {
    method: "post" as const,
    path: "/enterprise/content/agent/personas",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(CONTENT_AGENT_PERSONA_NAME_MAX),
      style: z.string().max(32).default(""),
      /** 上限由服务端校验并给中文提示（超过 500 字） */
      persona: z.string().default(""),
    }),
    response: envelope(contentAgentPersonaSchema),
  },
  Content_updatePersona: {
    method: "put" as const,
    path: "/enterprise/content/agent/personas/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(CONTENT_AGENT_PERSONA_NAME_MAX),
      style: z.string().max(32).default(""),
      /** 上限由服务端校验并给中文提示（超过 500 字） */
      persona: z.string().default(""),
    }),
    response: envelope(contentAgentPersonaSchema),
  },
  Content_deletePersona: {
    method: "delete" as const,
    path: "/enterprise/content/agent/personas/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_library: {
    method: "get" as const,
    path: "/enterprise/content/agent/library",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentLibraryItemSchema)),
  },
  Content_libraryAdd: {
    method: "post" as const,
    path: "/enterprise/content/agent/library",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(
      z.object({
        items: z.array(contentLibraryItemSchema),
        /** 收录失败的原因（类型不支持 / 体积超限 / 原件读不到），逐条给用户看。 */
        skipped: z.array(z.string()),
      }),
    ),
  },
  Content_libraryRemove: {
    method: "delete" as const,
    path: "/enterprise/content/agent/library/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_libraryNodes: {
    method: "get" as const,
    path: "/enterprise/content/agent/library/:id/nodes",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentLibraryNodeSchema)),
  },
  Content_librarySearch: {
    method: "post" as const,
    path: "/enterprise/content/agent/library/search",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentLibrarySearchSchema),
  },
  Content_libraryPublish: {
    method: "post" as const,
    path: "/enterprise/content/agent/library/publish",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentLibraryItemSchema),
  },
  Content_libraryDrafts: {
    method: "get" as const,
    path: "/enterprise/content/agent/library/drafts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentLibraryDraftSchema)),
  },
  Content_libraryDraftDecide: {
    method: "post" as const,
    path: "/enterprise/content/agent/library/drafts/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentLibraryDraftSchema),
  },
  Content_schedules: {
    method: "get" as const,
    path: "/enterprise/content/agent/schedules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentScheduleSchema)),
  },
  Content_saveSchedule: {
    method: "post" as const,
    path: "/enterprise/content/agent/schedules",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentScheduleSchema),
  },
  Content_updateSchedule: {
    method: "put" as const,
    path: "/enterprise/content/agent/schedules/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentScheduleSchema),
  },
  Content_removeSchedule: {
    method: "delete" as const,
    path: "/enterprise/content/agent/schedules/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_scheduleRuns: {
    method: "get" as const,
    path: "/enterprise/content/agent/schedules/:id/runs",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentScheduleRunSchema)),
  },
  Content_runScheduleNow: {
    method: "post" as const,
    path: "/enterprise/content/agent/schedules/:id/run",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentAgentScheduleRunSchema),
  },
  Content_assistantChannels: {
    method: "get" as const,
    path: "/enterprise/content/agent/assistant/channels",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentAssistantChannelSchema)),
  },
  Content_saveAssistantChannel: {
    method: "post" as const,
    path: "/enterprise/content/agent/assistant/channels",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentAssistantChannelSchema),
  },
  Content_updateAssistantChannel: {
    method: "put" as const,
    path: "/enterprise/content/agent/assistant/channels/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(contentAgentAssistantChannelSchema),
  },
  Content_removeAssistantChannel: {
    method: "delete" as const,
    path: "/enterprise/content/agent/assistant/channels/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Content_testAssistantChannel: {
    method: "post" as const,
    path: "/enterprise/content/agent/assistant/channels/:id/test",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentAgentAssistantTestSchema),
  },
  Content_assistantMessages: {
    method: "get" as const,
    path: "/enterprise/content/agent/assistant/channels/:id/messages",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(contentAgentAssistantMessageSchema)),
  },
  Content_registerAsset: {
    method: "post" as const,
    path: "/enterprise/content/assets/:id/register",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentAssetSchema),
  },
  // ---------- 共享资料（数字资产按账号共享给企业内用户） ----------
  Content_sharedAssets: {
    method: "get" as const,
    path: "/enterprise/content/shared-assets",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        sent: z.array(contentSharedAssetSchema),
        received: z.array(contentSharedAssetSchema),
      }),
    ),
  },
  Content_shareTargets: {
    method: "get" as const,
    path: "/enterprise/content/shared-assets/targets",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        orgName: z.string(),
        users: z.array(contentShareTargetSchema),
      }),
    ),
  },
  Content_shareAsset: {
    method: "post" as const,
    path: "/enterprise/content/shared-assets",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      asset: z.object({
        id: z.string().min(1),
        name: z.string().max(200).default(""),
        type: z.string().max(16).default("file"),
        size: z.number().default(0),
        url: z.string().max(2000).default(""),
      }),
      targetUserIds: z.array(z.string().min(1)).min(1).max(200),
    }),
    response: envelope(z.object({ shared: z.number() })),
  },
  Content_unshareAsset: {
    method: "delete" as const,
    path: "/enterprise/content/shared-assets/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
};

export type ContentModelChannel = z.infer<typeof contentModelChannelSchema>;
export type ContentModelSlot = z.infer<typeof contentModelSlotSchema>;
export type ContentSettings = z.infer<typeof contentSettingsSchema>;
export type ContentModel = z.infer<typeof contentModelSchema>;
export type ContentAsset = z.infer<typeof contentAssetSchema>;
export type ContentConversation = z.infer<typeof contentConversationSchema>;
export type ContentDigitalAsset = z.infer<typeof contentDigitalAssetSchema>;
export type ContentDigitalAssetPage = z.infer<
  typeof contentDigitalAssetPageSchema
>;
export type ContentAgentMessage = z.infer<typeof contentAgentMessageSchema>;
export type ContentMemories = z.infer<typeof contentMemoriesSchema>;
export type ContentJob = z.infer<typeof contentJobSchema>;
export type ContentAgentSkill = z.infer<typeof contentAgentSkillSchema>;
export type ContentAgentPlugin = z.infer<typeof contentAgentPluginSchema>;
export type ContentAgentExpert = z.infer<typeof contentAgentExpertSchema>;
