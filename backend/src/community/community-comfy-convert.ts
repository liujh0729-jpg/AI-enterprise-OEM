import {
  COMMUNITY_JSON_LIMIT,
  COMMUNITY_NODE_LIMIT,
  CREDENTIAL_KEY_PATTERN,
  type CommunityRegistrySlot,
} from './community-workflow-registry';

/**
 * Comfy Cloud 迁移期的离线转换与解析工具。
 *
 * 已保存的工作流（`/api/userdata?dir=workflows/`）是 ComfyUI 界面（save）格式，
 * 而上游 `POST /api/v2/jobs` 只收 API 格式，所以「站内能不能直接运行」必须在迁移时定下来：
 *  - 能机械转换的（核心节点 + widget 顺序在表内）转成 API 格式并固化入库；
 *  - 拿不准的一律不猜，保留原文存成 `format:'ui'` 浏览型卡片——猜错的图提交上去是 422，
 *    用户看到的是「这份工作流跑不起来」，比不给运行按钮更糟。
 *
 * 转换规则与 `scripts/comfy-ui-to-api.mjs` 同口径（后者是官方模板的导入期工具），
 * 改表或改判定时两处要一起改，否则同一份图会出现「导入能跑、迁移不能跑」的分叉。
 */

/** 危险节点名表（与 registry 同口径）：迁移期提前拒掉可执行/任意读写一类。 */
const DANGEROUS_NODE_NAMES = new Set([
  'SubprocessNode',
  'AnyCodeExecution',
  'PythonExecute',
  'PythonScript',
  'ExecuteString',
  'ExecutePython',
  'EvalExpression',
  'JupyterExecute',
  'ShellCommand',
  'RunCommand',
  'SystemRun',
  'ReadFile',
  'WriteFile',
  'LoadFileFromPath',
  'VHS_LoadVideoPath',
  'VHS_LoadAudioPath',
  'LoadImageFromDirectory',
  'bbicon_LoadImageWithPath',
  'HttpRequest',
  'HttpCall',
  'FetchUrl',
  'DownloadFile',
  'WebFetcherNode',
  'ApiRequestNode',
]);

/**
 * 核心节点的 widget 顺序表（与 scripts/comfy-ui-to-api.mjs 的 CORE_WIDGETS 一致）。
 * 迁移时拿不到 object_info 的 widget 定义，只认这张表里的节点；表外节点一律判失败。
 */
const CORE_WIDGETS: Record<string, string[]> = {
  CheckpointLoaderSimple: ['ckpt_name'],
  LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
  CLIPTextEncode: ['text'],
  CLIPSetLastLayer: ['stop_at_clip_layer'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  EmptySD3LatentImage: ['width', 'height', 'batch_size'],
  KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  KSamplerAdvanced: [
    'add_noise',
    'noise_seed',
    'steps',
    'cfg',
    'sampler_name',
    'scheduler',
    'start_at_step',
    'end_at_step',
    'return_with_leftover_noise',
  ],
  VAEDecode: [],
  VAEEncode: [],
  VAELatentUpScale: [],
  SaveImage: ['filename_prefix'],
  PreviewImage: [],
  LoadImage: ['image', 'upload'],
  LoadImageMask: ['image', 'channel'],
  ImageScale: ['upscale_method', 'width', 'height', 'crop'],
  ImageSave: ['filename_prefix', 'quality'],
  UpscaleModelLoader: ['model_name'],
  ImageUpscaleWithModel: [],
  ControlNetApply: ['strength'],
  ControlNetApplyAdvanced: ['strength', 'start_percent', 'end_percent'],
  CFGNorm: ['magnitude'],
  ModelSamplingDiscrete: ['schedule', 'snap'],
};

/** seed 类 widget 后面紧跟的前端专用值（randomize/fixed/…），不属于 API 输入，必须吃掉。 */
const CONTROL_VALUES = new Set([
  'randomize',
  'fixed',
  'increment',
  'decrement',
  'increment after sample',
  'decrement once',
  'enable',
  'disable',
]);

const SEED_FIELD = /(seed|noise_seed)$/i;

/** widgets_values 走对象形态时允许跟着出现的非输入键。 */
const IGNORED_WIDGET_KEYS = new Set(['control_after_generate']);

type UiNode = {
  id?: string | number;
  type?: string;
  mode?: number | string;
  title?: string;
  inputs?: Array<{ name?: string; link?: number | string | null }>;
  widgets_values?: unknown;
};

type UiWorkflow = {
  nodes: UiNode[];
  links?: unknown[];
  definitions?: { subgraphs?: unknown[] };
};

export type UiToApiResult =
  | {
      ok: true;
      graph: Record<string, Record<string, unknown>>;
      nodes: number;
    }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** UI/save 格式特征：顶层带 nodes 数组。 */
export function isUiFormat(workflow: unknown): workflow is UiWorkflow {
  return isPlainObject(workflow) && Array.isArray(workflow.nodes);
}

function assign(input: Record<string, unknown>, name: string, value: unknown) {
  // API 节点会用点号路径表达嵌套输入（例如 model.images.image_1）
  const parts = String(name).split('.');
  let cursor = input;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * UI 图 → API 图。
 * 与 scripts/comfy-ui-to-api.mjs 的 uiToApi 同口径（不含 object_info 的 widget 定义）。
 */
export function uiToApi(workflow: unknown): UiToApiResult {
  if (!isUiFormat(workflow)) {
    return { ok: false, reason: '不是 ComfyUI 界面格式的工作流' };
  }
  const subgraphs = workflow.definitions?.subgraphs;
  if (Array.isArray(subgraphs) && subgraphs.length) {
    return {
      ok: false,
      reason: `含 ${subgraphs.length} 个子图（subgraph），需要图内联`,
    };
  }
  if (!workflow.nodes.length) {
    return { ok: false, reason: '图里没有任何节点' };
  }
  if (workflow.nodes.length > COMMUNITY_NODE_LIMIT) {
    return {
      ok: false,
      reason: `节点数 ${workflow.nodes.length} 超过 ${COMMUNITY_NODE_LIMIT} 上限`,
    };
  }

  const links = new Map<string, unknown[]>();
  for (const link of workflow.links || []) {
    if (!Array.isArray(link) || link.length < 3) continue;
    const row = link as unknown[];
    links.set(String(row[0]), row);
  }
  const knownIds = new Set(workflow.nodes.map((node) => String(node.id)));
  // 被静音/旁路/永不执行的节点不提交；有连线指向它们则整图放弃（上游会 422 missing input）
  const skipped = new Set(
    workflow.nodes
      .filter((node) => ![0, 1, 3].includes(Number(node.mode ?? 0)))
      .map((node) => String(node.id)),
  );

  const graph: Record<string, Record<string, unknown>> = {};
  for (const node of workflow.nodes) {
    const nodeId = String(node.id);
    if (skipped.has(nodeId)) continue;
    const classType = String(node.type || '');
    if (!classType) return { ok: false, reason: `节点 ${nodeId} 缺少类型` };
    if (DANGEROUS_NODE_NAMES.has(classType)) {
      return { ok: false, reason: `节点「${classType}」属于禁止收录的一类` };
    }
    if (!(classType in CORE_WIDGETS)) {
      return {
        ok: false,
        reason: `节点「${classType}」的定义取不到（不在核心节点表内）`,
      };
    }

    const inputs: Record<string, unknown> = {};
    const connections: Array<[string, unknown[]]> = [];
    for (const slot of node.inputs || []) {
      if (slot?.link === null || slot?.link === undefined) continue;
      const link = links.get(String(slot.link));
      if (!link) {
        return {
          ok: false,
          reason: `节点 ${nodeId} 的输入「${slot.name || ''}」连线缺失`,
        };
      }
      const originId = String(link[1]);
      if (skipped.has(originId) || !knownIds.has(originId)) {
        return {
          ok: false,
          reason: `节点 ${nodeId} 依赖被静音的节点 ${originId}`,
        };
      }
      connections.push([String(slot.name || ''), [originId, link[2]]]);
    }

    const names = CORE_WIDGETS[classType];
    const linkedNames = new Set(connections.map(([name]) => name));
    const rawValues = node.widgets_values;
    if (isPlainObject(rawValues)) {
      // 对象形态：按输入名取；多出来的键说明没映射全，直接放弃
      const extra = Object.keys(rawValues).filter(
        (key) =>
          !names.includes(key) &&
          !IGNORED_WIDGET_KEYS.has(key) &&
          rawValues[key] !== null &&
          rawValues[key] !== undefined &&
          rawValues[key] !== '',
      );
      if (extra.length) {
        return {
          ok: false,
          reason: `节点 ${nodeId}（${classType}）有 ${extra.length} 个 widget 未能映射到输入名`,
        };
      }
      for (const name of names) {
        if (!(name in rawValues) || linkedNames.has(name)) continue;
        const value = rawValues[name];
        if (value === null || value === undefined || value === '') continue;
        if (Array.isArray(value) || typeof value === 'object') {
          return {
            ok: false,
            reason: `节点 ${nodeId} 的输入「${name}」是复杂控件，无法机械转换`,
          };
        }
        assign(inputs, name, value);
      }
    } else {
      const values: unknown[] = Array.isArray(rawValues)
        ? (rawValues as unknown[])
        : [];
      let cursor = 0;
      for (const name of names) {
        if (cursor >= values.length) break;
        const next = values[cursor + 1];
        if (
          SEED_FIELD.test(name) &&
          typeof next === 'string' &&
          CONTROL_VALUES.has(next)
        ) {
          if (!linkedNames.has(name)) assign(inputs, name, values[cursor]);
          cursor += 2; // 吃掉 control_after_generate
          continue;
        }
        const value = values[cursor];
        cursor += 1;
        if (value === null || value === undefined || value === '') continue;
        if (linkedNames.has(name)) continue;
        if (Array.isArray(value) || typeof value === 'object') {
          return {
            ok: false,
            reason: `节点 ${nodeId} 的输入「${name}」是复杂控件，无法机械转换`,
          };
        }
        assign(inputs, name, value);
      }
      // 剩下没用完的 widget＝该节点的输入名我们没拿全，转出的图必然缺字段，直接放弃
      if (cursor < values.length) {
        const left = values
          .slice(cursor)
          .filter((v) => v !== null && v !== undefined && v !== '');
        if (left.length) {
          return {
            ok: false,
            reason: `节点 ${nodeId}（${classType}）有 ${left.length} 个 widget 未能映射到输入名`,
          };
        }
      }
    }
    for (const [name, ref] of connections) assign(inputs, name, ref);

    graph[nodeId] = {
      inputs,
      class_type: classType,
      _meta: { title: String(node.title || classType).slice(0, 60) },
    };
  }

  if (!Object.keys(graph).length) {
    return { ok: false, reason: '图里没有可执行的节点' };
  }
  if (JSON.stringify(graph).length > COMMUNITY_JSON_LIMIT) {
    return { ok: false, reason: '转出的 API 图超过 2MB' };
  }
  return { ok: true, graph, nodes: Object.keys(graph).length };
}

/** 某个节点的某个输入是否指向指定节点（连线值是 ["节点 id", 槽位]）。 */
function refersTo(
  node: Record<string, unknown>,
  field: string,
  nodeId: string,
) {
  const inputs = isPlainObject(node.inputs) ? node.inputs : {};
  const ref = inputs[field];
  return Array.isArray(ref) && String(ref[0]) === nodeId;
}

const SLOT_RULES = [
  { field: 'steps', type: 'int' as const, label: '采样步数', min: 1, max: 150 },
  {
    field: 'cfg',
    type: 'float' as const,
    label: '提示词引导系数 CFG',
    min: 0,
    max: 30,
  },
  {
    field: 'denoise',
    type: 'float' as const,
    label: '重绘幅度 denoise',
    min: 0,
    max: 1,
  },
  { field: 'width', type: 'int' as const, label: '宽度', min: 64, max: 4096 },
  { field: 'height', type: 'int' as const, label: '高度', min: 64, max: 4096 },
  {
    field: 'strength',
    type: 'float' as const,
    label: '强度',
    min: 0,
    max: 2,
  },
];

/**
 * 由转换成功的 API 图生成「可开放参数」候选（上限 12 项，键与后端槽位一致）。
 * 只挑常见且改了不会炸的：提示词、种子、尺寸、步数、CFG、重绘幅度、输入图。
 */
export function suggestSlots(
  graph: Record<string, Record<string, unknown>>,
): CommunityRegistrySlot[] {
  const slots: CommunityRegistrySlot[] = [];
  const seen = new Set<string>();
  const push = (
    slot: Partial<CommunityRegistrySlot> & {
      key: string;
      nodeId: string;
      field: string;
    },
  ) => {
    if (slots.length >= 12) return;
    if (!slot.key || !slot.nodeId || !slot.field) return;
    const node = graph[slot.nodeId];
    const inputs = isPlainObject(node?.inputs) ? node.inputs : {};
    if (!node || !(slot.field in inputs)) return;
    if (seen.has(`${slot.nodeId}:${slot.field}`)) return;
    seen.add(`${slot.nodeId}:${slot.field}`);
    const fallback = inputs[slot.field];
    slots.push({
      key: slot.key,
      label: slot.label || slot.key,
      type: slot.type || 'text',
      nodeId: slot.nodeId,
      field: slot.field,
      defaultValue:
        typeof fallback === 'number' || typeof fallback === 'string'
          ? fallback
          : null,
      options: slot.options || [],
      min: slot.min ?? null,
      max: slot.max ?? null,
      required: Boolean(slot.required),
    });
  };

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = text(node.class_type);
    const inputs = isPlainObject(node.inputs) ? node.inputs : {};
    if (classType === 'CLIPTextEncode' && typeof inputs.text === 'string') {
      // 正向/反向靠上游归属判断，判不出来就用节点标题
      const sampler = Object.entries(graph).find(
        ([, item]) =>
          String(item.class_type).startsWith('KSampler') &&
          (refersTo(item, 'positive', nodeId) ||
            refersTo(item, 'negative', nodeId)),
      );
      let label = text((node._meta as { title?: unknown } | undefined)?.title);
      if (!label) label = '提示词';
      if (sampler) {
        label = refersTo(sampler[1], 'positive', nodeId)
          ? '正向提示词'
          : '反向提示词';
      }
      push({
        key: /负|negative|反/i.test(label) ? 'negative_prompt' : 'prompt',
        label,
        type: 'longtext',
        nodeId,
        field: 'text',
        required: true,
      });
      continue;
    }
    if (
      (classType === 'LoadImage' || classType === 'LoadImageMask') &&
      typeof inputs.image === 'string'
    ) {
      push({
        key: 'input_image',
        label: '输入图片',
        type: 'image',
        nodeId,
        field: 'image',
        required: true,
      });
      continue;
    }
    const seedKey = Object.keys(inputs).find((key) => SEED_FIELD.test(key));
    if (seedKey && typeof inputs[seedKey] === 'number') {
      push({
        key: 'seed',
        label: '随机种子',
        type: 'seed',
        nodeId,
        field: seedKey,
        min: 0,
        max: 2 ** 31 - 1,
      });
    }
    for (const rule of SLOT_RULES) {
      if (!(rule.field in inputs)) continue;
      if (typeof inputs[rule.field] !== 'number') continue;
      push({
        key: rule.field,
        label: rule.label,
        type: rule.type,
        nodeId,
        field: rule.field,
        min: rule.min,
        max: rule.max,
      });
    }
  }
  // 键去重（同图里多个 sampler 的 steps 已经带 nodeId，只有 prompt/seed 可能撞）
  const used = new Set<string>();
  return slots.map((slot) => {
    let key = slot.key;
    let index = 2;
    while (used.has(key)) key = `${slot.key}_${index++}`;
    used.add(key);
    return { ...slot, key };
  });
}

// ---------- 历史任务：产物解析与标题提取 ----------

export type ImportMediaItem = {
  kind: 'image' | 'video';
  filename: string;
  subfolder: string;
  type: string;
  /** 上游直接给的 URL（签名域）；为空时用 filename 走 `/api/view`。 */
  url: string;
};

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function nameFromUrl(raw: string): string {
  try {
    const path = new URL(raw).pathname;
    return decodeURIComponent(path.split('/').pop() || '');
  } catch {
    return '';
  }
}

/** 按扩展名与分组名判断媒体类型；文本输出（`text` 数组）一律不收。 */
function mediaKindOf(group: string, filename: string, url: string) {
  if (VIDEO_EXT.test(filename) || VIDEO_EXT.test(url)) return 'video' as const;
  if (IMAGE_EXT.test(filename) || IMAGE_EXT.test(url)) return 'image' as const;
  if (/video/i.test(group)) return 'video' as const;
  if (/image|gif/i.test(group)) return 'image' as const;
  return null;
}

function mediaItemOf(raw: unknown, group: string): ImportMediaItem | null {
  if (!isPlainObject(raw)) return null;
  const filename =
    text(raw.filename) || text(raw.name) || nameFromUrl(text(raw.url));
  const url = text(
    raw.url ?? raw.download_url ?? raw.signed_url ?? raw.content_url,
  );
  if (!filename && !url) return null;
  const kind = mediaKindOf(group, filename, url);
  if (!kind) return null;
  return {
    kind,
    filename: filename || 'output',
    subfolder: text(raw.subfolder),
    type: text(raw.type) || 'output',
    url,
  };
}

/**
 * 把 `GET /api/jobs/{id}` 的 outputs（ComfyUI 原生形态）与 preview_output 拉平成媒体清单：
 * `{ "<nodeId>": { images: [{filename, subfolder, type}], videos: [...] } }`。
 * 预览图排在最前——它就是封面。
 */
export function collectMedia(
  outputs: unknown,
  previewOutput: unknown,
): ImportMediaItem[] {
  const out: ImportMediaItem[] = [];
  const seen = new Set<string>();
  const push = (item: ImportMediaItem | null) => {
    if (!item) return;
    const key = `${item.subfolder}/${item.filename}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  if (isPlainObject(previewOutput)) {
    // 形态一：单项 {filename, subfolder, type}；形态二：{images: [...]}
    if (text(previewOutput.filename) || text(previewOutput.url)) {
      push(mediaItemOf(previewOutput, 'preview'));
    }
    for (const [group, value] of Object.entries(previewOutput)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) push(mediaItemOf(item, group));
    }
  }
  if (isPlainObject(outputs)) {
    for (const group of Object.values(outputs)) {
      if (!isPlainObject(group)) continue;
      for (const [groupName, value] of Object.entries(group)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) push(mediaItemOf(item, groupName));
      }
    }
  }
  return out.slice(0, 16);
}

/** 通用节点标题：不拿它们当工作流名（否则一屏全是「Save Image」）。 */
const GENERIC_TITLES = new Set([
  'save image',
  'preview image',
  'save',
  'vae decode',
  'ksampler',
  'clip text encode',
  'load checkpoint',
  'empty latent image',
]);

/** 任务标题：产物文件名 → 图中可读节点标题 → job id 前缀。 */
export function titleOfJob(detail: {
  id: string;
  outputs: Record<string, unknown> | null;
  previewOutput: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
}): string {
  const media = collectMedia(detail.outputs, detail.previewOutput);
  const filename = media[0]?.filename || '';
  const fromFile = filename.replace(/\.[^.]+$/, '').trim();
  if (fromFile) return fromFile.slice(0, 200);
  if (detail.workflow) {
    for (const node of Object.values(detail.workflow)) {
      if (!isPlainObject(node)) continue;
      const meta = node._meta;
      const title = isPlainObject(meta) ? text(meta.title).trim() : '';
      if (title && !GENERIC_TITLES.has(title.toLowerCase())) {
        return title.slice(0, 200);
      }
    }
  }
  return `Comfy Cloud 任务 ${detail.id.slice(0, 8)}`;
}

/** 已保存工作流的标题：文件名去 `.json`。 */
export function titleOfWorkflowFile(path: string): string {
  const base = String(path).split('/').pop() || String(path);
  const name = base.replace(/\.json$/i, '').trim();
  return name.slice(0, 200) || 'Comfy Cloud 工作流';
}

/** 图里是否存在视频合成类节点（决定卡片落在「视频」还是「图片」页签）。 */
export function looksLikeVideoWorkflow(
  graph: Record<string, unknown>,
): boolean {
  const hint =
    /(VideoCombine|SaveWEBM|SaveAnimatedWEBP|SaveVideo|CombineVideos|VHS_)/i;
  return Object.values(graph).some((node) => {
    if (!isPlainObject(node)) return false;
    return hint.test(text(node.class_type));
  });
}

/** 原始 JSON 里是否出现凭据键（UI 原文入库前的粗筛，宁严勿松）。 */
export function containsCredentialKey(value: unknown): boolean {
  const walk = (item: unknown, depth: number): boolean => {
    if (depth > 6) return false;
    if (Array.isArray(item))
      return item.some((child) => walk(child, depth + 1));
    if (!isPlainObject(item)) return false;
    for (const [key, child] of Object.entries(item)) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) return true;
      if (walk(child, depth + 1)) return true;
    }
    return false;
  };
  return walk(value, 0);
}

/** OSS 对象键里的文件名片段：保留中文与常见安全字符，其余压成下划线。 */
export function safeSegment(raw: string, fallback = 'file'): string {
  const cleaned = String(raw || '')
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}
