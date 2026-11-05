import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';

/**
 * 跨境电商商品页优化（PDP）的知识层：
 * 把三个参考实现（1click-ecom-detailpage / ecom-details-image / MxPage）的共性规则
 * 压缩成「规划提示词 + 场景注册表 + 出图提示词合成 + 规划结果解析」四段纯函数。
 * 这里不碰数据库、不碰网络：模型调用一律由 EcomPdpService 走本系统模型网关。
 */

export type EcomBrief = {
  productName: string;
  category: string;
  market: string;
  platform: string;
  audience: string;
  price: string;
  sellingPoints: string;
  specs: string;
  evidence: string;
  promo: string;
  difference: string;
  language: string;
  styleName: string;
  colorPalette: string;
  compliance: boolean;
  heroCount: number;
  detailCount: number;
  referenceUrls: string[];
  /** 逐张内容说明：按「主图1：…／详情图1：…」逐行指定每张画面 */
  shotPlan: string;
};

export type EcomStyleLock = {
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

export type EcomReason = {
  need: string;
  feature: string;
  benefit: string;
  basis: string;
};

export type EcomPlan = {
  driver: string;
  driverReason: string;
  buyerReasons: EcomReason[];
  styleLock: EcomStyleLock;
  assumptions: string[];
  bannedClaims: string[];
};

export type EcomScene = {
  key: string;
  kind: 'hero' | 'detail';
  name: string;
  rule: string;
};

export type EcomPlannedAsset = {
  kind: 'hero' | 'detail';
  position: number;
  sceneKey: string;
  title: string;
  purpose: string;
  copy: string;
  size: string;
  prompt: string;
};

/** 主图场景：覆盖参考仓库 25 个模板里最常用的构图（其余模板按需归并到这些场景）。 */
export const HERO_SCENES: EcomScene[] = [
  {
    key: 'hero-white',
    kind: 'hero',
    name: '白底合规首图',
    rule: 'pure white seamless background (#FFFFFF), product fills about 85% of frame, centered, no text, no props, no border, soft even studio light, true-to-life color',
  },
  {
    key: 'hero-lifestyle',
    kind: 'hero',
    name: '生活方式场景',
    rule: 'real-life usage scene matching the target user, product in natural context, shallow depth of field, warm natural light',
  },
  {
    key: 'hero-flat-lay',
    kind: 'hero',
    name: '平铺摆拍',
    rule: 'top-down flat lay on a clean surface, product plus included accessories, generous spacing, soft shadow',
  },
  {
    key: 'hero-macro',
    kind: 'hero',
    name: '材质细节特写',
    rule: 'extreme close-up on material texture and craftsmanship, crisp micro detail, controlled specular highlight',
  },
  {
    key: 'hero-poster',
    kind: 'hero',
    name: '海报主视觉',
    rule: 'editorial poster composition, clean headline space at the top third, bold color block background',
  },
  {
    key: 'hero-social',
    kind: 'hero',
    name: '社媒方图',
    rule: 'social feed style, playful composition, bright colors, high contrast, one clear focal point',
  },
  {
    key: 'hero-ugc',
    kind: 'hero',
    name: '真实买家视角',
    rule: 'authentic UGC look, handheld phone photo feel, informal framing, natural imperfect light',
  },
  {
    key: 'hero-model',
    kind: 'hero',
    name: '模特展示',
    rule: 'model using or wearing the product, three-quarter body framing, product kept sharp, face not the focus',
  },
  {
    key: 'hero-before-after',
    kind: 'hero',
    name: '前后对比',
    rule: 'clean split-screen before and after, identical camera angle and lighting, honest difference only, no exaggerated result',
  },
  {
    key: 'hero-packaging',
    kind: 'hero',
    name: '包装开箱',
    rule: 'retail packaging beside the product, unboxing arrangement, premium paper texture, tidy negative space',
  },
  {
    key: 'hero-infographic',
    kind: 'hero',
    name: '卖点标注主图',
    rule: 'product hero shot with three or four clean callout lines pointing to labeled features, labels kept short',
  },
  {
    key: 'hero-creative',
    kind: 'hero',
    name: '创意概念',
    rule: 'conceptual visual hook built from the core buyer benefit, surreal but product-accurate, simple background',
  },
  {
    key: 'hero-size',
    kind: 'hero',
    name: '尺寸参照',
    rule: 'product beside a familiar object or dimension lines, clear scale reference, plain background',
  },
  {
    key: 'hero-multi',
    kind: 'hero',
    name: '套装组合',
    rule: 'full product family or bundle arranged as a group, balanced composition, consistent light',
  },
  {
    key: 'hero-exploded',
    kind: 'hero',
    name: '结构分解',
    rule: 'exploded view showing parts and assembly order, technical clarity, clean studio light',
  },
  {
    key: 'hero-multi-angle',
    kind: 'hero',
    name: '多角度网格',
    rule: 'three-view grid (front / side / top) of the same product, identical lighting and scale across panels',
  },
  {
    key: 'hero-editorial',
    kind: 'hero',
    name: '杂志大片',
    rule: 'magazine editorial spread, dramatic styling, refined set design, strong art direction',
  },
  {
    key: 'hero-seasonal',
    kind: 'hero',
    name: '季节主题',
    rule: 'seasonal props and palette, campaign mood, gift-giving context, uncluttered background',
  },
  {
    key: 'hero-luxury',
    kind: 'hero',
    name: '奢华氛围',
    rule: 'dark luxury atmosphere, marble or velvet surface, controlled specular highlights, deep shadows',
  },
  {
    key: 'hero-device',
    kind: 'hero',
    name: '设备场景',
    rule: 'product with laptop or phone mockup context, clean tech desk, cool neutral light',
  },
  {
    key: 'hero-sports',
    kind: 'hero',
    name: '运动场景',
    rule: 'dynamic sports action context, motion energy, durable material emphasis, outdoors light',
  },
];

/** 详情页场景：每张都必须是电商信息图（标题 + 证据 + 图标/表格/步骤），不允许纯氛围图。 */
export const DETAIL_SCENES: EcomScene[] = [
  {
    key: 'detail-claims',
    kind: 'detail',
    name: '核心卖点信息图',
    rule: 'hero product at top, three or four benefit blocks with icons and short labels, clear hierarchy',
  },
  {
    key: 'detail-feature-grid',
    kind: 'detail',
    name: '功能网格',
    rule: 'feature grid with callout lines pointing to product parts, one icon per feature',
  },
  {
    key: 'detail-how-it-works',
    kind: 'detail',
    name: '使用步骤',
    rule: 'three to five numbered steps with simple icons, left-to-right flow, no long paragraphs',
  },
  {
    key: 'detail-spec',
    kind: 'detail',
    name: '规格参数',
    rule: 'spec table with rows, units and a product line drawing, numbers only from the brief',
  },
  {
    key: 'detail-size',
    kind: 'detail',
    name: '尺寸指南',
    rule: 'dimension diagram with arrows and measurements, product silhouette to scale',
  },
  {
    key: 'detail-compare',
    kind: 'detail',
    name: '对比表',
    rule: 'comparison table of this product versus a generic typical option, check marks, no competitor brand names',
  },
  {
    key: 'detail-trust',
    kind: 'detail',
    name: '信任徽章',
    rule: 'trust badge row with guarantee icons and short proof lines, no invented certifications or review counts',
  },
  {
    key: 'detail-material',
    kind: 'detail',
    name: '材质成分',
    rule: 'material breakdown with a layered diagram, percentages only when provided in the brief',
  },
  {
    key: 'detail-care',
    kind: 'detail',
    name: '护理保养',
    rule: 'care instruction icons with a short do and do-not list, laundry or maintenance symbols',
  },
  {
    key: 'detail-faq',
    kind: 'detail',
    name: '常见问题',
    rule: 'FAQ blocks with a question and one-line answer, generous spacing, mobile readable',
  },
  {
    key: 'detail-warranty',
    kind: 'detail',
    name: '售后保障',
    rule: 'warranty and service timeline with simple icons, no invented time periods',
  },
  {
    key: 'detail-unboxing',
    kind: 'detail',
    name: '开箱清单',
    rule: 'what is in the box grid with item labels and counts, top-down layout',
  },
  {
    key: 'detail-story',
    kind: 'detail',
    name: '品牌故事',
    rule: 'brand story strip with a short timeline, restrained typography, no fabricated history',
  },
  {
    key: 'detail-scene',
    kind: 'detail',
    name: '场景带入',
    rule: 'lifestyle photo band with benefit captions underneath, one scenario per image',
  },
  {
    key: 'detail-chart',
    kind: 'detail',
    name: '数据图表',
    rule: 'simple bar or line chart built only from provided data, clear axis labels, no invented numbers',
  },
  {
    key: 'detail-aplus',
    kind: 'detail',
    name: 'A+ 模块',
    rule: 'stacked A+ content modules with a top banner, feature blocks and a closing trust row',
  },
];

export const ALL_SCENES: EcomScene[] = [...HERO_SCENES, ...DETAIL_SCENES];

const SCENE_MAP = new Map(ALL_SCENES.map((scene) => [scene.key, scene]));

const HERO_FALLBACK = [
  'hero-white',
  'hero-lifestyle',
  'hero-macro',
  'hero-infographic',
  'hero-packaging',
  'hero-multi-angle',
  'hero-model',
  'hero-size',
];

const DETAIL_FALLBACK = [
  'detail-claims',
  'detail-feature-grid',
  'detail-how-it-works',
  'detail-spec',
  'detail-trust',
  'detail-compare',
  'detail-care',
  'detail-unboxing',
  'detail-faq',
  'detail-warranty',
];

export function sceneOf(key: string, kind: 'hero' | 'detail'): EcomScene {
  const found = SCENE_MAP.get(key);
  if (found && found.kind === kind) return found;
  const fallback = kind === 'hero' ? HERO_FALLBACK : DETAIL_FALLBACK;
  return SCENE_MAP.get(fallback[0]) || ALL_SCENES[0];
}

function defaultSceneKey(kind: 'hero' | 'detail', index: number): string {
  const pool = kind === 'hero' ? HERO_FALLBACK : DETAIL_FALLBACK;
  return pool[index % pool.length];
}

/** 主图/详情页的默认尺寸：主图方图，详情页竖图（网关不支持时用户可在资产里改成 1024x1024）。 */
export function defaultSize(kind: 'hero' | 'detail'): string {
  return kind === 'hero' ? '1024x1024' : '1024x1536';
}

const SIZE_WHITELIST = new Set(['1024x1024', '1024x1536', '1536x1024']);

function normalizeSize(value: string, kind: 'hero' | 'detail'): string {
  return SIZE_WHITELIST.has(value) ? value : defaultSize(kind);
}

// ---------- 规划提示词 ----------

const SYSTEM_PROMPT = `你是跨境电商商品页（PDP / Listing）的转化设计总监与电商视觉提示词工程师。
你的任务：读取商品简报，先做转化诊断，再为「主图（hero）」和「详情页（detail）」逐张设计图面文案与出图提示词。
你只输出一个 JSON 对象，不要输出解释、Markdown 或代码围栏。

【一、事实边界】
1. 商品硬事实只能来自商品简报。价格、规格、认证、配件、售后、优惠没有写就不能出现在文案里。
2. 允许做品类常识层面的推断（例如保温杯常用于通勤），但必须在 assumptions 中逐条披露，并把对应 buyerReasons 的 basis 标为 inferred。
3. 严禁编造：认证（FDA / CE / UL 等）、检测数据、销量排名、医疗功效、绝对化用语（best / #1 / 100% / cure / guaranteed）、他人评价与品牌授权。
4. 即使 compliance 为 false，也不得伪造硬事实；compliance 为 true 时按最严口径执行，无法证实的效果一律写成使用体验而不是承诺。
5. 每个卖点必须落到买家收益（benefit），不能只描述参数或画面。

【二、转化驱动诊断（先选一个主驱动）】
visual：外观 / 材质 / 设计是首要购买理由；pain：解决明确痛点；emotion：身份 / 情绪 / 送礼；value：性价比 / 套装 / 耐用。
driverReason 用 1-2 句说明判断依据（引用简报里的具体事实）。

【三、Buyer Reason Card（3-6 条）】
每条 { need 买家场景里的具体需求, feature 对应产品特性, benefit 买家得到的结果, basis direct|inferred }。
文案优先级：benefit > feature > need。图片文案写买家收益，画面只负责证明。

【四、Campaign Style Lock（10 个字段，全部用英文填写，后续每张图共用）】
styleName / colorPalette / backgroundSystem / lighting / cameraLanguage / typography / layoutRules / propRules / productRendering / negativeRules。
硬规则：
- 颜色必须写 hex（主色 + 辅助色 + 背景色），不要只写颜色名。
- backgroundSystem 必须能支撑视觉节奏：浅底 / 深底 / 场景底三套轮换，相邻两张不得重复同一底色。
- typography 只写字体气质、字重层级与对齐方式，不要指定具体商用字体名。
- negativeRules 写本套图共同的否定项（变形、水印、乱码字母、虚假徽章、过度磨皮等）。

【五、主图规则】
1. 第 1 张优先 hero-white：平台合规首图，纯白背景 #FFFFFF、产品约占 85%、无文字 / 水印 / 边框 / 道具。
2. 其余主图至少覆盖 3 个不同角度，其中至少 1 张特写；全景图不超过 40%；不允许连续 3 张同角度。
3. 每张只突出一个购买理由；图面文案最多 2 行，每行不超过 6 个英文单词。
4. 存在产品参考图时，必须保持形状、颜色、logo、比例完全一致，不得改动产品结构。

【六、详情页规则】
1. 每张都必须是电商信息图：以 "E-commerce infographic" 开头，含清晰标题、要点 / 图标 / 标签 / 步骤 / 信任徽章，移动端可读。
2. 禁止把详情页写成纯氛围图或纯产品图。
3. 信息三层：标题（买家问题）→ 证据（参数 / 对比 / 步骤）→ 收尾（信任 / 行动）。
4. 相邻两张背景交替（浅 / 深 / 场景），保持视觉节奏；每张只讲一个主题。
5. 图面文案最多 5 条，每条不超过 12 个英文单词；数据可视化只能使用简报里的数字。

【七、出图提示词规则（每张 prompt 用英文写）】
1. 场景正文 120-220 词：画面主体、构图、镜头与景别、产品位置与占比、背景、光线、材质细节、留白区域、文字区位置（例如 "leave clean space for a headline at top-left"）。
2. 产品占比要数字化（例如 "product occupies 60% of frame"）；显式留白（主图至少 45%，白底首图除外；详情页文字区至少 35%）。
3. 文案与画面分离：图面文字只放在 copy 字段（每条一行），prompt 里写 "render the copy provided separately"，不要逐字复述长文案。
4. 不要堆砌 "4K, 8K, ultra realistic, masterpiece" 这类空泛词。
5. 每张 prompt 结尾附否定清单：no extra text, no gibberish letters, no watermark, no distorted product, no fake certification, no plastic skin, no cluttered layout。

【八、市场与语言】
- market / platform 决定合规与审美：Amazon 首图纯白；TikTok / 独立站可以用更生活化的场景；欧洲市场避免夸大功效。
- copy 使用简报 language 指定的语言；prompt 始终用英文。

【九、逐张内容说明（shotPlan，最高优先级）】
用户可能在简报里按「主图1：…／主图2：…／详情图1：…／详情图2：…」逐行指定每张画面（也接受分号分隔）。shotPlan 非空时必须执行：
1. 「主图N」对应 hero 数组中 position=N 的图，「详情图N」对应 detail 中 position=N 的图；数组顺序必须与编号完全一致，不得重排、合并、拆分或替换主题。
2. shotPlan 优先于场景自动分配与「第 1 张优先 hero-white」等默认规则；与平台强制首图规则冲突时服从 shotPlan，并在 assumptions 中提示风险。
3. 每张的 title 用中文概括该行说明；purpose 写这张承担的转化任务；copy 按说明生成（仍受事实边界与合规约束）；prompt 按说明写英文场景，sceneKey 选最贴近的场景，但画面内容以说明为准。
4. 说明中的数字、认证、功效若简报没有依据，不得写进 copy 或 prompt，按事实边界处理并写入 assumptions。
5. 条数与数量不一致：说明少于数量时，前 N 张按说明、其余按场景规则补齐；多于数量时只取前 N 条，多余内容写入 assumptions；hero/detail 数量仍以 heroCount/detailCount 为准，不得改动。
6. 说明未覆盖的图继续遵守角度、背景交替与留白规则，保持整套图的节奏。

【十、场景菜单（sceneKey 必须从下面选，且 hero 只能用 hero 前缀，detail 只能用 detail 前缀）】
`;

function menu(scenes: EcomScene[]): string {
  return scenes
    .map((scene) => `- ${scene.key} | ${scene.name} | ${scene.rule}`)
    .join('\n');
}

function briefBlock(brief: EcomBrief): string {
  const rows: string[] = [
    `productName: ${brief.productName}`,
    `category: ${brief.category || '（未提供，按商品名推断并写入 assumptions）'}`,
    `market: ${brief.market}`,
    `platform: ${brief.platform}`,
    `audience: ${brief.audience || '（未提供，按品类推断）'}`,
    `price: ${brief.price || '（未提供，图面不得出现价格）'}`,
    `sellingPoints: ${brief.sellingPoints || '（未提供，按品类常识推导并标注 inferred）'}`,
    `specs: ${brief.specs || '（未提供，图面不得出现具体参数）'}`,
    `evidence: ${brief.evidence || '（未提供，图面不得出现认证、检测与评价）'}`,
    `promo: ${brief.promo || '（未提供，图面不得出现优惠）'}`,
    `difference: ${brief.difference || '（未提供，不得点名或影射竞品）'}`,
    `language: ${brief.language}`,
    `compliance: ${brief.compliance ? 'strict' : 'normal'}`,
    `stylePreference: ${brief.styleName || '（未指定，由你决定）'} ${brief.colorPalette ? `/ ${brief.colorPalette}` : ''}`,
    `heroCount: ${brief.heroCount}`,
    `detailCount: ${brief.detailCount}`,
    `referenceImages: ${brief.referenceUrls.length} 张${brief.referenceUrls.length ? '（每张图都必须以参考图锁定产品身份）' : '（无参考图，用文字描述锁死产品外观）'}`,
    'shotPlan（逐张内容说明，非空时优先级最高）:',
    brief.shotPlan || '（未提供，按场景规则自动分配）',
  ];
  return rows.join('\n');
}

/** 规划提示词：一次调用产出诊断、风格锁、全部主图与详情页的文案和场景正文。 */
export function buildPlanPrompt(brief: EcomBrief): {
  system: string;
  user: string;
} {
  const system = [
    SYSTEM_PROMPT,
    '主图场景：',
    menu(HERO_SCENES),
    '',
    '详情页场景：',
    menu(DETAIL_SCENES),
    '',
    '【十一、输出 JSON（严格按此结构，不要多余字段）】',
    `{
  "driver": "visual|pain|emotion|value",
  "driverReason": "1-2 句判断依据",
  "buyerReasons": [{ "need": "", "feature": "", "benefit": "", "basis": "direct|inferred" }],
  "styleLock": {
    "styleName": "", "colorPalette": "#hex + #hex + #hex", "backgroundSystem": "",
    "lighting": "", "cameraLanguage": "", "typography": "", "layoutRules": "",
    "propRules": "", "productRendering": "", "negativeRules": ""
  },
  "assumptions": ["逐条列出所有推断与缺失信息"],
  "bannedClaims": ["本商品不得出现的表述"],
  "hero": [{ "position": 1, "sceneKey": "hero-white", "title": "", "purpose": "", "copy": "line1\\nline2", "size": "1024x1024", "prompt": "" }],
  "detail": [{ "position": 1, "sceneKey": "detail-claims", "title": "", "purpose": "", "copy": "", "size": "1024x1536", "prompt": "" }]
}
hero 必须恰好 ${brief.heroCount} 张，detail 必须恰好 ${brief.detailCount} 张，position 从 1 连续编号；数量为 0 时给空数组。
shotPlan 非空时，hero/detail 数组必须按「主图1..N、详情图1..N」的顺序输出，第 N 条对应 position=N。
title 与 purpose 用中文（给选图的人看），copy 用 ${brief.language}，prompt 用英文。`,
  ].join('\n');

  const user = [
    '【商品简报】',
    briefBlock(brief),
    '',
    '请先判断转化驱动，再给出风格锁，最后逐张设计。',
    brief.heroCount + brief.detailCount > 0
      ? `本次需要 ${brief.heroCount} 张主图、${brief.detailCount} 张详情页。`
      : '本次不生成图片，只输出诊断与风格锁。',
  ].join('\n');

  return { system, user };
}

// ---------- 出图提示词合成 ----------

/**
 * 每张图共用同一段 Style Lock 前缀，避免模型在不同图之间漂移；
 * 场景正文由模型给出（用户也可逐张改），文案、参考图与否定清单在这里统一拼装。
 */
export function composeImagePrompt(
  plan: EcomPlan,
  asset: EcomPlannedAsset,
  brief: EcomBrief,
): string {
  const style = plan.styleLock;
  const scene = sceneOf(asset.sceneKey, asset.kind);
  const parts: string[] = [
    `Campaign style lock: ${style.styleName}; palette ${style.colorPalette}; background system ${style.backgroundSystem}; lighting ${style.lighting}; camera language ${style.cameraLanguage}; typography ${style.typography}; layout ${style.layoutRules}; props ${style.propRules}; product rendering ${style.productRendering}.`,
    asset.prompt.trim() ||
      `Professional e-commerce ${asset.kind === 'hero' ? 'product photo' : 'infographic'} of ${brief.productName}. ${scene.rule}.`,
  ];
  if (asset.kind === 'detail') {
    parts.push(
      `E-commerce infographic layout for the ${brief.market} market on ${brief.platform}. Clear headline zone, icon-led evidence blocks, mobile-first hierarchy, generous spacing.`,
    );
  }
  const copyLines = asset.copy
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (copyLines.length) {
    parts.push(
      `Render the on-image copy provided separately, exactly these lines and no other words: ${copyLines
        .map((line) => `"${line}"`)
        .join(' / ')}.`,
    );
  } else {
    parts.push('No on-image text. Keep the layout purely visual.');
  }
  if (brief.referenceUrls.length) {
    parts.push(
      'Use the provided reference images only as product identity reference: keep the exact shape, color, logo, label and proportions. Do not copy the reference background.',
    );
  }
  parts.push(
    `Negative: ${style.negativeRules}; no extra text, no gibberish letters, no watermark, no distorted product, no fake certification, no plastic skin, no cluttered layout${
      plan.bannedClaims.length ? `; avoid: ${plan.bannedClaims.join('; ')}` : ''
    }.`,
  );
  return parts.join('\n\n');
}

// ---------- 规划结果解析 ----------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown, max: number): string {
  return text(value).trim().slice(0, max);
}

function asTextList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item, maxLength))
    .filter(Boolean)
    .slice(0, max);
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  const source = text(raw);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '规划模型没有返回 JSON，请重试或在「模型设置」里换一个更强的文本模型',
    );
  }
  try {
    return record(JSON.parse(source.slice(start, end + 1)) as unknown);
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '规划结果不是合法 JSON，请重试或在「模型设置」里换一个输出更稳定的文本模型',
    );
  }
}

function normalizeStyleLock(value: unknown, brief: EcomBrief): EcomStyleLock {
  const raw = record(value);
  return {
    styleName:
      asText(raw.styleName, 120) ||
      brief.styleName ||
      `${brief.category || 'Product'} clean studio`,
    colorPalette:
      asText(raw.colorPalette, 200) ||
      brief.colorPalette ||
      '#FFFFFF primary, #F2F2F2 secondary, #111111 text',
    backgroundSystem:
      asText(raw.backgroundSystem, 400) ||
      'alternate light (#FFFFFF), soft gradient (#F2F2F2) and scene background between images',
    lighting:
      asText(raw.lighting, 300) ||
      'soft diffused key light from top-left, gentle fill, controlled shadows',
    cameraLanguage:
      asText(raw.cameraLanguage, 300) ||
      '50mm product lens, eye-level hero angles, macro for texture',
    typography:
      asText(raw.typography, 300) ||
      'modern geometric sans-serif, bold headline, regular body, generous letter spacing',
    layoutRules:
      asText(raw.layoutRules, 400) ||
      'product as focal point, text blocks on one side, clear top-to-bottom hierarchy',
    propRules:
      asText(raw.propRules, 300) ||
      'minimal props tied to the use scenario, nothing that hides the product',
    productRendering:
      asText(raw.productRendering, 400) ||
      'true-to-life color, accurate material texture, sharp edges, no shape change',
    negativeRules:
      asText(raw.negativeRules, 400) ||
      'no extra text, no watermark, no distorted product, no fake badges, no plastic skin',
  };
}

function normalizeReasons(value: unknown): EcomReason[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => record(item))
    .map((item) => ({
      need: asText(item.need, 200),
      feature: asText(item.feature, 200),
      benefit: asText(item.benefit, 200),
      basis: asText(item.basis, 20) === 'inferred' ? 'inferred' : 'direct',
    }))
    .filter((item) => item.need || item.feature || item.benefit)
    .slice(0, 6);
}

function normalizeAssets(
  value: unknown,
  kind: 'hero' | 'detail',
  count: number,
): EcomPlannedAsset[] {
  // 模型可能乱序返回：先按 position 还原「主图N / 详情图N」的顺序，再按数量截断或补齐。
  const rows = (Array.isArray(value) ? value : [])
    .map((item, index) => ({ item: record(item), index }))
    .sort((left, right) => {
      const a = Number(left.item.position);
      const b = Number(right.item.position);
      const leftAt = Number.isFinite(a) && a > 0 ? a : Number.MAX_SAFE_INTEGER;
      const rightAt = Number.isFinite(b) && b > 0 ? b : Number.MAX_SAFE_INTEGER;
      return leftAt === rightAt ? left.index - right.index : leftAt - rightAt;
    });
  const result: EcomPlannedAsset[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = rows[index]?.item || {};
    const scene = sceneOf(
      asText(item.sceneKey, 64) || defaultSceneKey(kind, index),
      kind,
    );
    const copy = asText(item.copy, 4000);
    result.push({
      kind,
      position: index + 1,
      sceneKey: scene.key,
      title: asText(item.title, 120) || `${scene.name} ${index + 1}`,
      purpose: asText(item.purpose, 191) || scene.rule.slice(0, 180),
      copy,
      size: normalizeSize(asText(item.size, 16), kind),
      prompt: asText(item.prompt, 8000),
    });
  }
  return result;
}

/**
 * 把模型输出收敛成可入库的结构：字段缺失、数量不符、场景键越界都在这里兜住，
 * 保证界面拿到的计划永远可渲染、每张资产都有可生成的提示词。
 */
export function parsePlan(
  raw: unknown,
  brief: EcomBrief,
): { plan: EcomPlan; assets: EcomPlannedAsset[] } {
  const root = parseJsonObject(raw);
  const driver = asText(root.driver, 20);
  const plan: EcomPlan = {
    driver: ['visual', 'pain', 'emotion', 'value'].includes(driver)
      ? driver
      : 'visual',
    driverReason: asText(root.driverReason, 600) || '未提供诊断依据',
    buyerReasons: normalizeReasons(root.buyerReasons),
    styleLock: normalizeStyleLock(root.styleLock, brief),
    assumptions: asTextList(root.assumptions, 10, 300),
    bannedClaims: asTextList(root.bannedClaims, 12, 200),
  };
  if (brief.compliance && !plan.bannedClaims.length) {
    plan.bannedClaims = [
      '未提供证据的认证与检测结论',
      '绝对化排名与 100% 效果承诺',
      '医疗功效与治愈表述',
    ];
  }
  return { plan, assets: buildAssets(root, brief) };
}

/** 解析后按「主图 → 详情页」顺序生成待入库的资产清单。 */
function buildAssets(
  root: Record<string, unknown>,
  brief: EcomBrief,
): EcomPlannedAsset[] {
  // 兼容模型把两部分合成一个 assets 数组的情况：按 kind 分组后再规范化。
  const combined = Array.isArray(root.assets)
    ? root.assets.map((item) => record(item))
    : [];
  const heroRaw = Array.isArray(root.hero)
    ? root.hero
    : combined.filter((item) => asText(item.kind, 16) === 'hero');
  const detailRaw = Array.isArray(root.detail)
    ? root.detail
    : combined.filter((item) => asText(item.kind, 16) === 'detail');
  return [
    ...normalizeAssets(heroRaw, 'hero', brief.heroCount),
    ...normalizeAssets(detailRaw, 'detail', brief.detailCount),
  ];
}
