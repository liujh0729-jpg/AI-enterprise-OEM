/**
 * ComfyUI 界面（save）格式 → Comfy Cloud API 格式的离线转换器（只在开发期导入脚本里用）。
 *
 * 为什么要在导入期转：上游 `POST /api/v2/jobs` 只收 API 格式，UI 格式（带 nodes/links）
 * 直接 422 `workflow_format_ui`。所以「站内能不能直接运行」必须在导数据时定下来并固化入库，
 * 运行期不再做任何格式转换——运行期只做「已声明槽位」的封闭覆盖。
 *
 * 转换拿不准的一律判失败（保留为浏览型卡片），绝不猜着转：
 * 猜错的图提交上去是 422/400，用户看到的是「这份工作流跑不起来」，比不给运行按钮更糟。
 */

/** 与后端 community-workflow-registry.ts 的 COMMUNITY_NODE_LIMIT / COMMUNITY_JSON_LIMIT 同口径。 */
export const NODE_LIMIT = 120;
export const JSON_LIMIT = 2 * 1024 * 1024;

/**
 * 危险节点名表：镜像后端 DANGEROUS_NODE_NAMES（后端是权威，导入期只是提前过滤，
 * 避免把明显不该站内运行的图标成「可直接运行」）。改表以后端为准。
 */
export const DANGEROUS_NODE_NAMES = new Set([
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
 * 核心节点的 widget 顺序表（ComfyUI 自带节点，顺序多年未变）。
 * 用途：没有 object_info（它需要用户自己的 Cloud Key 才能取）时，只认这张表里的节点，
 * 表外的节点一律判失败——宁缺毋滥。
 */
export const CORE_WIDGETS = {
  CheckpointLoaderSimple: ['ckpt_name'],
  LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
  CLIPTextEncode: ['text'],
  CLIPSetLastLayer: ['stop_at_clip_layer'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  EmptySD3LatentImage: ['width', 'height', 'batch_size'],
  KSampler: [
    'seed',
    'steps',
    'cfg',
    'sampler_name',
    'scheduler',
    'denoise',
  ],
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

/**
 * seed 类 widget 后面会紧跟一个前端专用的 control_after_generate 值（randomize/fixed/…），
 * 它不属于 API 格式的输入，必须吃掉，否则后面全部错位。
 */
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
/** object_info 里算「widget」的原始类型（其余是连线的槽位类型，如 MODEL/LATENT）。 */
const WIDGET_TYPES = new Set([
  'INT',
  'FLOAT',
  'STRING',
  'BOOLEAN',
  'COMBO',
  'CUSTOM',
  'SECRET',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** UI/save 格式特征：顶层带 nodes/links。 */
export function isUiFormat(workflow) {
  return isPlainObject(workflow) && Array.isArray(workflow.nodes);
}

/** API 格式特征：顶层每个值都是带 class_type 的节点。 */
export function isApiFormat(workflow) {
  if (!isPlainObject(workflow) || Array.isArray(workflow.nodes)) return false;
  const entries = Object.entries(workflow);
  return (
    entries.length > 0 &&
    entries.every(
      ([, node]) => isPlainObject(node) && typeof node.class_type === 'string',
    )
  );
}

/** object_info 的一项里属于 widget 的输入名（按 required → optional 原序）。 */
function widgetNamesFromObjectInfo(spec) {
  const input = isPlainObject(spec?.input) ? spec.input : {};
  const names = [];
  for (const group of ['required', 'optional']) {
    for (const [name, def] of Object.entries(input[group] || {})) {
      const type = Array.isArray(def) ? def[0] : def;
      if (Array.isArray(type)) {
        names.push(name); // 候选值数组＝下拉
        continue;
      }
      if (
        typeof type === 'string' &&
        WIDGET_TYPES.has(type.toUpperCase().replace(/^\[\[?/, ''))
      ) {
        names.push(name);
      }
    }
  }
  return names;
}

/** 该 class_type 在 object_info 里是否存在（没有 object_info 时退回核心表）。 */
function knownClass(classType, objectInfo) {
  if (objectInfo) return isPlainObject(objectInfo[classType]);
  return classType in CORE_WIDGETS;
}

function assign(input, name, value) {
  // API 节点会用点号路径表达嵌套输入（例如 model.images.image_1）
  const parts = String(name).split('.');
  let cursor = input;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * UI 图 → API 图。
 * @returns {{ok: true, graph: object, nodes: number} | {ok: false, reason: string}}
 */
export function uiToApi(workflow, objectInfo = null) {
  if (!isUiFormat(workflow)) return { ok: false, reason: '不是 ComfyUI 界面格式的工作流' };
  if (workflow.definitions?.subgraphs?.length) {
    return { ok: false, reason: `含 ${workflow.definitions.subgraphs.length} 个子图（subgraph），需要图内联` };
  }
  if (!workflow.nodes.length) return { ok: false, reason: '图里没有任何节点' };
  if (workflow.nodes.length > NODE_LIMIT) {
    return { ok: false, reason: `节点数 ${workflow.nodes.length} 超过 ${NODE_LIMIT} 上限` };
  }

  const links = new Map((workflow.links || []).map((link) => [link[0], link]));
  // 被静音/旁路/永不执行的节点不提交；有连线指向它们则整图放弃（上游会 422 missing input）
  const skipped = new Set(
    workflow.nodes
      .filter((node) => ![0, 1, 3].includes(Number(node.mode ?? 0)))
      .map((node) => node.id),
  );
  const graph = {};
  for (const node of workflow.nodes) {
    if (skipped.has(node.id)) continue;
    const classType = String(node.type || '');
    if (!classType) return { ok: false, reason: `节点 ${node.id} 缺少类型` };
    if (DANGEROUS_NODE_NAMES.has(classType)) {
      return { ok: false, reason: `节点「${classType}」属于禁止收录的一类` };
    }
    if (!knownClass(classType, objectInfo)) {
      return { ok: false, reason: `节点「${classType}」的定义取不到（无 object_info 且不在核心节点表内）` };
    }

    const inputs = {};
    const connections = [];
    for (const slot of node.inputs || []) {
      if (slot?.link == null) continue;
      const link = links.get(slot.link);
      if (!link) return { ok: false, reason: `节点 ${node.id} 的输入「${slot.name}」连线缺失` };
      if (skipped.has(link[1]) || !workflow.nodes.some((n) => n.id === link[1])) {
        return { ok: false, reason: `节点 ${node.id} 依赖被静音的节点 ${link[1]}` };
      }
      connections.push([slot.name, [String(link[1]), link[2]]]);
    }

    const spec = objectInfo ? objectInfo[classType] : null;
    const names = spec
      ? widgetNamesFromObjectInfo(spec)
      : CORE_WIDGETS[classType] || [];
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    // 连线已经占掉的输入名不再从 widget 里取（例如 LoadImage 的 image 有时同时出现在两处）
    const linkedNames = new Set(connections.map(([name]) => name));
    let cursor = 0;
    for (const name of names) {
      if (cursor >= values.length) break;
      if (SEED_FIELD.test(name) && CONTROL_VALUES.has(String(values[cursor + 1] ?? ''))) {
        if (!linkedNames.has(name)) assign(inputs, name, values[cursor]);
        cursor += 2; // 吃掉 control_after_generate
        continue;
      }
      const value = values[cursor];
      cursor += 1;
      if (value === null || value === undefined || value === '') continue;
      if (linkedNames.has(name)) continue;
      if (Array.isArray(value) || typeof value === 'object') {
        return { ok: false, reason: `节点 ${node.id} 的输入「${name}」是复杂控件，无法机械转换` };
      }
      assign(inputs, name, value);
    }
    // 剩下没用完的 widget＝该节点的输入名我们没拿全，转出的图必然缺字段，直接放弃
    if (cursor < values.length) {
      const left = values.slice(cursor).filter((v) => v !== null && v !== undefined && v !== '');
      if (left.length) {
        return { ok: false, reason: `节点 ${node.id}（${classType}）有 ${left.length} 个 widget 未能映射到输入名` };
      }
    }
    for (const [name, ref] of connections) assign(inputs, name, ref);

    graph[String(node.id)] = {
      inputs,
      class_type: classType,
      _meta: { title: String(node.title || classType).slice(0, 60) },
    };
  }

  if (JSON.stringify(graph).length > JSON_LIMIT) {
    return { ok: false, reason: '转出的 API 图超过 2MB' };
  }
  return { ok: true, graph, nodes: Object.keys(graph).length };
}

/** 某个节点的某个输入是否指向指定节点（连线值是 ["节点 id", 槽位]）。 */
function refersTo(node, field, nodeId) {
  const ref = node?.inputs?.[field];
  return Array.isArray(ref) && String(ref[0]) === nodeId;
}

const SLOT_RULES = [
  { field: 'steps', type: 'int', label: '采样步数', min: 1, max: 150 },
  { field: 'cfg', type: 'float', label: '提示词引导系数 CFG', min: 0, max: 30 },
  { field: 'denoise', type: 'float', label: '重绘幅度 denoise', min: 0, max: 1 },
  { field: 'width', type: 'int', label: '宽度', min: 64, max: 4096 },
  { field: 'height', type: 'int', label: '高度', min: 64, max: 4096 },
  { field: 'strength', type: 'float', label: '强度', min: 0, max: 2 },
];

/**
 * 由转换成功的 API 图生成「可开放参数」候选（上限 12 项，键与后端槽位一致）。
 * 只挑常见且改了不会炸的：提示词、种子、尺寸、步数、CFG、重绘幅度、输入图。
 */
export function suggestSlots(graph, options = {}) {
  const slots = [];
  const seen = new Set();
  const push = (slot) => {
    if (slots.length >= 12) return;
    if (!slot.key || !slot.nodeId || !slot.field) return;
    const node = graph[slot.nodeId];
    if (!node || !(slot.field in (node.inputs || {}))) return;
    if (seen.has(`${slot.nodeId}:${slot.field}`)) return;
    seen.add(`${slot.nodeId}:${slot.field}`);
    slots.push({
      key: slot.key,
      label: slot.label,
      type: slot.type,
      nodeId: slot.nodeId,
      field: slot.field,
      defaultValue: node.inputs[slot.field],
      options: slot.options || [],
      min: slot.min ?? null,
      max: slot.max ?? null,
      required: Boolean(slot.required),
    });
  };

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node.class_type;
    const inputs = node.inputs || {};
    if (classType === 'CLIPTextEncode' && typeof inputs.text === 'string') {
      // 正向/反向靠上游归属判断，判不出来就用节点标题
      const sampler = Object.entries(graph).find(
        ([, item]) =>
          String(item.class_type).startsWith('KSampler') &&
          (refersTo(item, 'positive', nodeId) || refersTo(item, 'negative', nodeId)),
      );
      let label = String(node._meta?.title || '提示词');
      if (sampler) {
        label = refersTo(sampler[1], 'positive', nodeId) ? '正向提示词' : '反向提示词';
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
    if ((classType === 'LoadImage' || classType === 'LoadImageMask') && typeof inputs.image === 'string') {
      push({ key: 'input_image', label: '输入图片', type: 'image', nodeId, field: 'image', required: true });
      continue;
    }
    if (Object.keys(inputs).some((k) => SEED_FIELD.test(k))) {
      const field = Object.keys(inputs).find((k) => SEED_FIELD.test(k));
      if (typeof inputs[field] === 'number') {
        push({
          key: options.seedKey || 'seed',
          label: '随机种子',
          type: 'seed',
          nodeId,
          field,
          min: 0,
          max: 2 ** 31 - 1,
        });
      }
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
    // 下拉：object_info 给了候选值时开放成 enum（改坏枚举值会让上游 422，所以必须带候选值）
    for (const [field, spec] of Object.entries(options.combos?.[`${nodeId}`] || {})) {
      if (!Array.isArray(spec) || !spec.length) continue;
      if (!(field in inputs)) continue;
      push({
        key: field,
        label: field,
        type: 'enum',
        nodeId,
        field,
        options: spec.map(String),
      });
    }
  }
  // 键去重（同图里多个 sampler 的 steps 之类已经带 nodeId，只有 prompt/seed/input_image 可能撞）
  const used = new Set();
  return slots.map((slot) => {
    let key = slot.key;
    let index = 2;
    while (used.has(key)) key = `${slot.key}_${index++}`;
    used.add(key);
    return { ...slot, key, defaultValue: slot.defaultValue ?? null };
  });
}

/** object_info（`GET /api/object_info`）里抽 combo 候选值，供槽位 enum 使用。 */
export function combosFromClass(spec) {
  const out = {};
  for (const group of ['required', 'optional']) {
    for (const [name, def] of Object.entries(spec?.input?.[group] || {})) {
      const type = Array.isArray(def) ? def[0] : def;
      if (Array.isArray(type)) out[name] = type.map(String);
    }
  }
  return out;
}
