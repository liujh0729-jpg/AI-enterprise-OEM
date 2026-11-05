import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';

/**
 * 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音商城、1688）的知识层：
 * 基于参考仓库 ecom-details-image 的场景模板体系与中文出图经验，压缩成
 * 「规划提示词 + 场景注册表 + 出图提示词合成 + 规划结果解析」四段纯函数。
 *
 * 与跨境版的差异：
 * 1) 文案固定为中文，用「」包裹提升模型渲染准确率；复杂笔画字要求换简单同义字。
 * 2) 白底首图按国内平台规范预留价格叠加区（顶部中央 200×100）与 logo 区（左上 200×100），
 *    产品占比 70-80%，且图面不渲染价格（价格由平台价格区展示）。
 * 3) 合规按《广告法》最严口径：绝对化用语、无依据功效、虚构销量/评价/优惠一律禁用。
 * 4) 详情页按移动端 750px 宽设计，标题 6-12 字、标签 2-6 字、每屏文字 ≤50 字。
 *
 * 这里不碰数据库、不碰网络：模型调用一律由 DomesticPdpService 走本系统模型网关。
 */

export type CnBrief = {
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

export type CnStyleLock = {
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

export type CnReason = {
  need: string;
  feature: string;
  benefit: string;
  basis: string;
};

export type CnPlan = {
  driver: string;
  driverReason: string;
  buyerReasons: CnReason[];
  styleLock: CnStyleLock;
  assumptions: string[];
  bannedClaims: string[];
};

export type CnScene = {
  key: string;
  kind: 'hero' | 'detail';
  name: string;
  rule: string;
};

export type CnPlannedAsset = {
  kind: 'hero' | 'detail';
  position: number;
  sceneKey: string;
  title: string;
  purpose: string;
  copy: string;
  size: string;
  prompt: string;
};

/** 主图场景：覆盖国内平台最常用的 19 种构图，白底首图固定排第一。 */
export const HERO_SCENES: CnScene[] = [
  {
    key: 'cn-hero-white',
    kind: 'hero',
    name: '白底合规首图',
    rule: 'pure white seamless background (#FFFFFF), product occupies 70-80% of frame, centered with equal margins, absolutely no text / logo / border / props, soft even studio light, true-to-life color; keep the top-center 200x100 px area completely empty for the platform price overlay and the top-left 200x100 px area empty for the platform logo',
  },
  {
    key: 'cn-hero-selling',
    kind: 'hero',
    name: '核心卖点图',
    rule: 'clean selling-point layout, product 25-30% on the right side, three short benefit labels stacked on the left with thin-line icons, whitespace at least 45%, light neutral background',
  },
  {
    key: 'cn-hero-scene',
    kind: 'hero',
    name: '生活场景图',
    rule: 'authentic Chinese home / office / outdoor usage scene, product 20-25%, natural window light, lived-in but tidy props, shallow depth of field',
  },
  {
    key: 'cn-hero-macro',
    kind: 'hero',
    name: '材质工艺特写',
    rule: 'extreme close-up macro on material texture and craftsmanship, detail fills 55-60% of frame, shallow depth of field, controlled specular highlight',
  },
  {
    key: 'cn-hero-size',
    kind: 'hero',
    name: '尺寸规格图',
    rule: 'dimension diagram, product silhouette with clear measurement arrows and short labels, plain light background, product 40-50%',
  },
  {
    key: 'cn-hero-compare',
    kind: 'hero',
    name: '对比图',
    rule: 'side-by-side comparison, generic ordinary option on the left vs this product on the right, identical camera angle and lighting, honest observable differences, no competitor brand names',
  },
  {
    key: 'cn-hero-spec-grid',
    kind: 'hero',
    name: '多规格全家福',
    rule: 'full SKU family or color variants arranged in a balanced grid, consistent scale and light, product family occupies 60-70% in total',
  },
  {
    key: 'cn-hero-model',
    kind: 'hero',
    name: '模特上身图',
    rule: 'Chinese model wearing or using the product, three-quarter body framing, product kept sharp and unobstructed, face not the focus',
  },
  {
    key: 'cn-hero-flat',
    kind: 'hero',
    name: '平铺摆拍',
    rule: 'top-down flat lay with the product and included accessories on a clean surface, generous spacing, soft shadow',
  },
  {
    key: 'cn-hero-gift',
    kind: 'hero',
    name: '礼盒包装图',
    rule: 'retail gift box beside the product, premium paper texture, minimal ribbon-free styling, tidy negative space',
  },
  {
    key: 'cn-hero-poster',
    kind: 'hero',
    name: '促销海报',
    rule: 'promotional poster composition, bold headline zone at the top third, product 35-40%, price area left completely empty, clean color blocks, no fake discount badges',
  },
  {
    key: 'cn-hero-ugc',
    kind: 'hero',
    name: '买家秀风格',
    rule: 'authentic buyer-show photo style, handheld phone look, casual framing on a real desk or table, imperfect natural light, slightly visible everyday clutter, NOT professional photography, NOT AI-looking',
  },
  {
    key: 'cn-hero-live',
    kind: 'hero',
    name: '直播氛围图',
    rule: 'livestream desk setup with ring light, product hero on a clean table, host hands only or no person, vibrant but not cluttered',
  },
  {
    key: 'cn-hero-exploded',
    kind: 'hero',
    name: '结构拆解图',
    rule: 'exploded view of the product with numbered callouts for each part, technical clarity, clean studio light',
  },
  {
    key: 'cn-hero-angle',
    kind: 'hero',
    name: '多角度网格',
    rule: 'three-view grid (front / side / top) of the same product, identical lighting and scale across panels',
  },
  {
    key: 'cn-hero-beforeafter',
    kind: 'hero',
    name: '使用前后对比',
    rule: 'honest split-screen before and after using the product, identical camera angle and lighting, only observable differences, no exaggerated results',
  },
  {
    key: 'cn-hero-craft',
    kind: 'hero',
    name: '工艺细节标注',
    rule: 'close-up craft detail with three callout circles and short labels for material and workmanship, product detail 50-60%',
  },
  {
    key: 'cn-hero-cert',
    kind: 'hero',
    name: '资质信任图',
    rule: 'trust and qualification screen, icon-led badge row for certifications and inspection, render only the certificates provided in the brief, otherwise empty outlined placeholders, no invented logos',
  },
  {
    key: 'cn-hero-season',
    kind: 'hero',
    name: '季节主题图',
    rule: 'seasonal campaign mood (618 / Double 11 / Chinese New Year) with restrained festival props, product 30-35%, warm palette, no fake discount badges',
  },
];

/** 详情页场景：每张都必须是电商信息图（标题 + 证据 + 图标/表格/步骤），不允许纯氛围图。 */
export const DETAIL_SCENES: CnScene[] = [
  {
    key: 'cn-detail-opening',
    kind: 'detail',
    name: '首屏承接',
    rule: 'opening screen: headline at top, product hero in the middle with four feature icons and short labels around it, subheadline at the bottom',
  },
  {
    key: 'cn-detail-pain',
    kind: 'detail',
    name: '痛点放大',
    rule: 'pain-point comparison: three pain-point icons with short labels on top, three solution rows below, product shown at a side profile, clear top-to-bottom flow',
  },
  {
    key: 'cn-detail-benefits',
    kind: 'detail',
    name: '核心利益',
    rule: 'two-column layout, product on the left shown from an elevated overhead angle, four benefit rows on the right with thin-line icons and short labels',
  },
  {
    key: 'cn-detail-mechanism',
    kind: 'detail',
    name: '机制解释',
    rule: 'mechanism diagram: simple cutaway or flow arrows explaining how the product works, numbered steps, numbers only from the brief',
  },
  {
    key: 'cn-detail-steps',
    kind: 'detail',
    name: '使用步骤',
    rule: 'three to four numbered steps with simple icons, left-to-right or top-to-bottom timeline, final result shown at the end',
  },
  {
    key: 'cn-detail-scene',
    kind: 'detail',
    name: '场景覆盖',
    rule: 'three lifestyle scene cards stacked vertically with short captions, one scenario per card',
  },
  {
    key: 'cn-detail-compare',
    kind: 'detail',
    name: '对比表',
    rule: 'comparison table: this product versus a generic ordinary option, check and cross marks, no competitor brand names',
  },
  {
    key: 'cn-detail-spec',
    kind: 'detail',
    name: '参数规格',
    rule: 'specification table with rows, units and a product line drawing, numbers only from the brief',
  },
  {
    key: 'cn-detail-size',
    kind: 'detail',
    name: '尺寸指南',
    rule: 'dimension guide with arrows and measurements, product silhouette to scale, clear labels',
  },
  {
    key: 'cn-detail-material',
    kind: 'detail',
    name: '材质成分',
    rule: 'material breakdown with a layered diagram, percentages only when provided in the brief',
  },
  {
    key: 'cn-detail-craft',
    kind: 'detail',
    name: '工艺细节',
    rule: 'macro craft detail with callout circles and short labels for seams, texture and finish',
  },
  {
    key: 'cn-detail-trust',
    kind: 'detail',
    name: '信任背书',
    rule: 'trust badge row for certifications, inspection and after-sales service, render only provided proof, otherwise outlined placeholder badges, no invented review counts',
  },
  {
    key: 'cn-detail-faq',
    kind: 'detail',
    name: '常见问题',
    rule: 'FAQ blocks: question headline with a one-line answer, three to four rows, generous spacing, mobile readable',
  },
  {
    key: 'cn-detail-promo',
    kind: 'detail',
    name: '权益保障',
    rule: 'service rights screen: icons and short labels for shipping insurance, seven-day return and authentic guarantee, only render rights provided in the brief, no price digits',
  },
  {
    key: 'cn-detail-crowd',
    kind: 'detail',
    name: '适用人群',
    rule: 'who it suits: three audience cards with simple illustrations and short labels, plus one small note for who it does not suit',
  },
  {
    key: 'cn-detail-brand',
    kind: 'detail',
    name: '品牌故事',
    rule: 'brand story strip with a short timeline and restrained typography, no fabricated history or awards',
  },
];

export const ALL_SCENES: CnScene[] = [...HERO_SCENES, ...DETAIL_SCENES];

const SCENE_MAP = new Map(ALL_SCENES.map((scene) => [scene.key, scene]));

const HERO_FALLBACK = [
  'cn-hero-white',
  'cn-hero-selling',
  'cn-hero-scene',
  'cn-hero-macro',
  'cn-hero-size',
  'cn-hero-compare',
  'cn-hero-gift',
  'cn-hero-angle',
];

const DETAIL_FALLBACK = [
  'cn-detail-opening',
  'cn-detail-pain',
  'cn-detail-benefits',
  'cn-detail-steps',
  'cn-detail-scene',
  'cn-detail-spec',
  'cn-detail-trust',
  'cn-detail-compare',
  'cn-detail-faq',
  'cn-detail-promo',
];

export function sceneOf(key: string, kind: 'hero' | 'detail'): CnScene {
  const found = SCENE_MAP.get(key);
  if (found && found.kind === kind) return found;
  const fallback = kind === 'hero' ? HERO_FALLBACK : DETAIL_FALLBACK;
  return SCENE_MAP.get(fallback[0]) || ALL_SCENES[0];
}

function defaultSceneKey(kind: 'hero' | 'detail', index: number): string {
  const pool = kind === 'hero' ? HERO_FALLBACK : DETAIL_FALLBACK;
  return pool[index % pool.length];
}

/** 主图方图（淘宝/京东主图 1:1），详情页竖图（移动端 750px 宽的分屏长图）。 */
export function defaultSize(kind: 'hero' | 'detail'): string {
  return kind === 'hero' ? '1024x1024' : '1024x1536';
}

const SIZE_WHITELIST = new Set(['1024x1024', '1024x1536', '1536x1024']);

function normalizeSize(value: string, kind: 'hero' | 'detail'): string {
  return SIZE_WHITELIST.has(value) ? value : defaultSize(kind);
}

// ---------- 规划提示词 ----------

const SYSTEM_PROMPT = `你是国内电商（淘宝/天猫、京东、拼多多、抖音商城、1688）商品页的转化设计总监与电商视觉提示词工程师。
你的任务：读取商品简报，先做转化诊断，再为「主图（hero）」和「详情页（detail）」逐张设计中文图面文案与出图提示词。
你只输出一个 JSON 对象，不要输出解释、Markdown 或代码围栏。

【一、事实边界】
1. 商品硬事实只能来自商品简报。价格、规格、认证、配件、售后、优惠没有写就不能出现在文案里。
2. 允许做品类常识层面的推断（例如保温杯常用于通勤），但必须在 assumptions 中逐条披露，并把对应 buyerReasons 的 basis 标为 inferred。
3. 严禁编造：认证（3C / ISO / 检测报告等）、检测数据、销量排名、好评数、医疗功效、绝对化用语、他人评价与品牌授权。
4. 即使 compliance 为 false，也不得伪造硬事实；compliance 为 true 时按最严口径执行，无法证实的效果一律写成使用体验而不是承诺。
5. 每个卖点必须落到买家收益（benefit），不能只描述参数或画面。

【二、广告法与平台合规红线（国内版强制）】
1. 禁用绝对化用语：最、第一、顶级、极致、唯一、首个、国家级、世界级、100%、永久、万能、全网最低、销量冠军等，也不要用谐音变体规避。
2. 禁用无依据的功效：治疗、消炎、杀菌、降血压、减肥、丰胸、生发等医疗或保健宣称；化妆品不得承诺美白祛斑等特证功效，除非简报明确提供了对应资质。
3. 不得虚构原价、折扣、赠品、限量与倒计时；促销文案只能使用简报 promo 里的内容。
4. 不得出现「好评如潮」「万人回购」「销量第一」等无依据的社会证明；评价与销量没有提供就不写。
5. 认证、检测、奖项、品牌授权只有简报 evidence 提供时才可渲染，否则用空白的资质占位框，不得画假徽章。
6. 价格不进入图面：平台会在价格区展示价格，图内出现价格容易与实际不一致；每个 prompt 必须写明 "no price digits, leave the price area empty"。

【三、转化驱动诊断（先选一个主驱动）】
visual：外观 / 材质 / 设计是首要购买理由；pain：解决明确痛点；emotion：身份 / 情绪 / 送礼 / 悦己；value：性价比 / 套装 / 耐用。
driverReason 用 1-2 句说明判断依据（引用简报里的具体事实）。

【四、购买理由卡（3-6 条）】
每条 { need 买家场景里的具体需求, feature 对应产品特性, benefit 买家得到的结果, basis direct|inferred }。
文案优先级：benefit > feature > need。图片文案写买家收益，画面只负责证明。

【五、Campaign Style Lock（10 个字段，全部用英文填写，后续每张图共用）】
styleName / colorPalette / backgroundSystem / lighting / cameraLanguage / typography / layoutRules / propRules / productRendering / negativeRules。
硬规则：
- 颜色必须写 hex（主色 + 辅助色 + 背景色），不要只写颜色名。
- backgroundSystem 必须能支撑视觉节奏：浅底 / 米色底 / 品牌深底三套轮换，相邻两张不得重复同一底色。
- typography 只写字体气质、字重层级与对齐方式（例如 modern geometric sans-serif, bold headline），不指定具体商用字体名；中文标题要有足够字重与字距。
- negativeRules 写本套图共同的否定项（变形、水印、乱码、错别字、虚假徽章、过度磨皮等）。

【六、主图规则（国内平台）】
1. 第 1 张优先 cn-hero-white：平台合规白底首图，纯白 #FFFFFF、产品约占 70-80%、无文字 / 水印 / 边框 / 道具。
2. 白底首图必须预留平台叠加区：顶部中央 200×100 像素留空（价格区）、左上 200×100 像素留空（平台 logo 区）。
3. 其余主图至少覆盖 3 个不同角度，其中至少 1 张特写/微距；全景图不超过 40%；不允许连续 3 张同角度。
4. 每张只突出一个购买理由；图面文案最多 2 行，每行不超过 10 个中文字。
5. 存在产品参考图时，必须保持形状、颜色、logo、比例完全一致，不得改动产品结构。
6. 主图推荐节奏：白底首图 → 核心卖点 → 场景 → 细节/材质 → 尺寸或对比。

【七、详情页规则（移动端 750px 宽）】
1. 每张都必须是电商信息图：以 "E-commerce infographic" 开头，含清晰标题、要点 / 图标 / 标签 / 步骤 / 信任徽章，适配手机竖屏浏览。
2. 禁止把详情页写成纯氛围图或纯产品图。
3. 信息三层：标题（买家问题）→ 证据（参数 / 对比 / 步骤）→ 收尾（信任 / 行动）。
4. 相邻两张背景交替（浅 / 米 / 深），保持视觉节奏；每张只讲一个主题。
5. 中文文案：主标题 6-12 字，标签 2-6 字，每屏文字总量不超过 50 字；标题字号 28-48pt、副标题 16-20pt、标注 10-14pt（按 750px 宽折算）。
6. 数据可视化只能使用简报里的数字；没有数字就不画图表。

【八、出图提示词规则（每张 prompt 用英文写）】
1. 场景正文 120-220 词：画面主体、构图、镜头与景别、产品位置与占比、背景、光线、材质细节、留白区域、文字区位置（例如 "leave clean space for a headline at top-left"）。
2. 产品占比要数字化（例如 "product occupies 60% of frame"）；显式留白（卖点图至少 45%，场景图至少 50%，详情页文字区至少 35%）。
3. 中文文案逐条放在 copy 字段（每条一行）；prompt 里写 "render the Chinese copy provided separately, exactly these lines"，不要逐字复述长文案。
4. 不用 "4K, 8K, ultra realistic, masterpiece" 这类空泛词，不堆砌关键词。
5. 每张 prompt 结尾附否定清单：no extra text, no gibberish characters, no wrong Chinese strokes, no watermark, no distorted product, no fake certification, no plastic skin, no cluttered layout, no price digits。
6. 中文渲染：文案尽量用简短常用字，复杂笔画字换同义简单字（如「赢」换「胜」、「鬱」换「郁」），避免生僻字与多音字。

【九、中文文案规范】
- tone 决定语气：brand 品牌质感（克制、少促销词）；pro 专业参数（讲清规格与依据）；grass 种草分享（第一人称体验、口语化）；promo 促销冲量（突出权益与紧迫感，但不得虚构优惠）。
- 优先四字词与短句，可用对仗结构（如「12 小时保温 · 一早到晚热乎」），不要长段小字。
- 不使用低俗、擦边、夸大或带歧视性的表达；不碰政治、宗教与地域刻板印象。
- 图面文字越少越准：能用 1 行说清就不写 2 行。

【十、逐张内容说明（shotPlan，最高优先级）】
用户可能按「主图1：…／主图2：…／详情图1：…／详情图2：…」逐行指定每张画面（也接受分号分隔）。shotPlan 非空时必须执行：
1. 「主图N」对应 hero 中 position=N 的图，「详情图N」对应 detail 中 position=N 的图；数组顺序与编号完全一致，不得重排、合并、拆分或替换主题。
2. shotPlan 优先于场景自动分配与「第 1 张优先 cn-hero-white」等默认规则；若与白底首图 / 平台叠加区规则冲突，服从 shotPlan 并在 assumptions 披露风险。
3. 每张 title 用中文概括该行说明；purpose 写该张承担的转化任务；copy 按说明写中文图面文案，仍须遵守广告法（绝对化用语、无依据功效、虚构销量评价优惠一律不得出现）；prompt 写英文场景，sceneKey 选最贴近的场景，画面内容以说明为准。
4. 说明中的价格、数字、认证、功效若简报没有依据，不得写进 copy 或 prompt；价格一律不出现在图面。
5. 条数不一致：少于数量时前 N 张按说明、其余按场景补齐；多于数量时只取前 N 条并把多余内容写入 assumptions；数量仍以 heroCount/detailCount 为准。
6. 说明未覆盖的图继续遵守角度、背景交替、750px 与留白规则。

【十一、场景菜单（sceneKey 必须从下面选，且 hero 只能用 hero 前缀，detail 只能用 detail 前缀）】
`;

function menu(scenes: CnScene[]): string {
  return scenes
    .map((scene) => `- ${scene.key} | ${scene.name} | ${scene.rule}`)
    .join('\n');
}

const TONE_LABEL: Record<string, string> = {
  brand: '品牌质感（克制、少促销词）',
  pro: '专业参数（讲清规格与依据）',
  grass: '种草分享（第一人称体验、口语化）',
  promo: '促销冲量（突出权益与紧迫感，但不得虚构优惠）',
};

function briefBlock(brief: CnBrief): string {
  const rows: string[] = [
    `productName: ${brief.productName}`,
    `category: ${brief.category || '（未提供，按商品名推断并写入 assumptions）'}`,
    `platform: ${brief.platform}`,
    `tone: ${brief.tone}（${TONE_LABEL[brief.tone] || brief.tone}）`,
    `audience: ${brief.audience || '（未提供，按品类推断）'}`,
    `price: ${brief.price || '（未提供，图面不得出现价格）'}`,
    `sellingPoints: ${brief.sellingPoints || '（未提供，按品类常识推导并标注 inferred）'}`,
    `specs: ${brief.specs || '（未提供，图面不得出现具体参数）'}`,
    `evidence: ${brief.evidence || '（未提供，图面不得出现认证、检测与评价）'}`,
    `promo: ${brief.promo || '（未提供，图面不得出现优惠）'}`,
    `difference: ${brief.difference || '（未提供，不得点名或影射竞品）'}`,
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

/** 规划提示词：一次调用产出诊断、风格锁、全部主图与详情页的中文文案和场景正文。 */
export function buildPlanPrompt(brief: CnBrief): {
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
    '【十二、输出 JSON（严格按此结构，不要多余字段）】',
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
  "hero": [{ "position": 1, "sceneKey": "cn-hero-white", "title": "", "purpose": "", "copy": "第一行\\n第二行", "size": "1024x1024", "prompt": "" }],
  "detail": [{ "position": 1, "sceneKey": "cn-detail-opening", "title": "", "purpose": "", "copy": "", "size": "1024x1536", "prompt": "" }]
}
hero 必须恰好 ${brief.heroCount} 张，detail 必须恰好 ${brief.detailCount} 张，position 从 1 连续编号；数量为 0 时给空数组。
shotPlan 非空时，hero/detail 数组必须按「主图1..N、详情图1..N」的顺序输出，第 N 条对应 position=N。
title 与 purpose 用中文（给选图的人看），copy 用中文（每条一行，图面直接渲染），prompt 用英文。`,
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
 * 场景正文由模型给出（用户也可逐张改），中文文案、参考图与否定清单在这里统一拼装。
 */
export function composeImagePrompt(
  plan: CnPlan,
  asset: CnPlannedAsset,
  brief: CnBrief,
): string {
  const style = plan.styleLock;
  const scene = sceneOf(asset.sceneKey, asset.kind);
  const parts: string[] = [
    `Campaign style lock: ${style.styleName}; palette ${style.colorPalette}; background system ${style.backgroundSystem}; lighting ${style.lighting}; camera language ${style.cameraLanguage}; typography ${style.typography}; layout ${style.layoutRules}; props ${style.propRules}; product rendering ${style.productRendering}.`,
    asset.prompt.trim() ||
      `Professional Chinese e-commerce ${asset.kind === 'hero' ? 'product photo' : 'infographic'} of ${brief.productName}. ${scene.rule}.`,
  ];
  if (asset.kind === 'detail') {
    parts.push(
      `E-commerce infographic layout for the ${brief.platform} platform, designed for a mobile 750px-wide detail page. Clear headline zone, icon-led evidence blocks, mobile-first hierarchy, generous spacing.`,
    );
  }
  const copyLines = asset.copy
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (copyLines.length) {
    parts.push(
      `Render the Chinese copy provided separately in corner brackets 「」, exactly these lines and no other words: ${copyLines
        .map((line) => `「${line}」`)
        .join(
          ' / ',
        )}. Keep every Chinese character correctly stroked; avoid rare complex characters.`,
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
    `Negative: ${style.negativeRules}; no extra text, no gibberish characters, no wrong Chinese strokes, no watermark, no distorted product, no fake certification, no plastic skin, no cluttered layout, no price digits, leave the platform price area empty${
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

function normalizeStyleLock(value: unknown, brief: CnBrief): CnStyleLock {
  const raw = record(value);
  return {
    styleName:
      asText(raw.styleName, 120) ||
      brief.styleName ||
      `${brief.category || 'Product'} clean studio`,
    colorPalette:
      asText(raw.colorPalette, 200) ||
      brief.colorPalette ||
      '#FFFFFF primary, #F5F1E8 secondary, #2D2D2D text',
    backgroundSystem:
      asText(raw.backgroundSystem, 400) ||
      'alternate #FFFFFF, #F5F1E8 and a deep brand color between images',
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

function normalizeReasons(value: unknown): CnReason[] {
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
): CnPlannedAsset[] {
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
  const result: CnPlannedAsset[] = [];
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
  brief: CnBrief,
): { plan: CnPlan; assets: CnPlannedAsset[] } {
  const root = parseJsonObject(raw);
  const driver = asText(root.driver, 20);
  const plan: CnPlan = {
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
      '绝对化用语（最 / 第一 / 100% 等）',
      '未提供证据的认证、检测与奖项',
      '医疗功效与保健宣称',
      '虚构销量、评价与优惠',
    ];
  }
  return { plan, assets: buildAssets(root, brief) };
}

/** 解析后按「主图 → 详情页」顺序生成待入库的资产清单。 */
function buildAssets(
  root: Record<string, unknown>,
  brief: CnBrief,
): CnPlannedAsset[] {
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
