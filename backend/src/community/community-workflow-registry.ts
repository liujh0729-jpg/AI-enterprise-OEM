import { randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * 社区工作流登记表：发布即校验，运行期只做「已声明槽位」的封闭覆盖。
 *
 * 社区里的 JSON 一律按不可信输入处理——它会以用户自己的 Key 提交到 Comfy Cloud 执行，
 * 而 Comfy 的节点里存在能读文件、跑命令、发任意 HTTP 的一类，因此：
 *  1. 只接受 API 格式（UI/save 格式上游本来就 422，早拒早干净）；
 *  2. class_type 必须能在用户账号的 object_info 里命中（未知节点＝自定义包，直接拒）；
 *  3. 命中不了但属于运营显式放开的 partner 前缀才放行（默认空表）；
 *  4. 危险节点名表（执行代码 / 读写任意文件 / 任意网络请求一类）无条件拒；
 *  5. 节点数与序列化体积封顶，凭据字段不许塞进 JSON（extra_data 由后端注入）。
 */

export const COMMUNITY_NODE_LIMIT = 120;
export const COMMUNITY_JSON_LIMIT = 2 * 1024 * 1024;
export const COMMUNITY_SLOT_LIMIT = 40;

/** Comfy Cloud 拒收的 UI/save 格式特征键。 */
const UI_FORMAT_KEYS = ['nodes', 'links', 'last_node_id', 'last_link_id'];

/**
 * 明确禁用的节点名（含常见自定义包里的「任意执行」类）。
 * 注意：`LoadImage` 不在表内——它是官方标准的图片输入节点，Cloud 上靠 ASSET 引用喂图，
 * 拦掉会把绝大多数 img2img 工作流一起误杀；被拦的是「按任意本地路径读取」的那批。
 */
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

/** 名字表覆盖不到的按语义片段拦（按 `_` 切词后整词匹配，避免 `Checkpoint` 里含 `path` 这类误判）。 */
const DANGEROUS_WORD_SEGMENTS = new Set([
  'exec',
  'execute',
  'shell',
  'subprocess',
  'bash',
  'eval',
  'filesystem',
  'readfile',
  'writefile',
  'httprequest',
  'fetchurl',
  'downloadurl',
  'arbitrarypath',
]);

/** JSON 里出现这些键＝发布者在往工作流里塞凭据，直接拒。 */
export const CREDENTIAL_KEY_PATTERN =
  /(api[_-]?key|apikey|authorization|bearer|token|secret|password|credential|access[_-]?key)/i;

/** partner 前缀：默认空，运营通过环境变量显式放开（逗号分隔），不做默认放行。 */
function partnerPrefixes(): string[] {
  return String(process.env.COMMUNITY_NODE_PREFIX_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dangerous(classType: string): boolean {
  if (DANGEROUS_NODE_NAMES.has(classType)) return true;
  const segments = classType
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // 逐词匹配 + 去下划线整体匹配，两种写法都拦（`Load_File` 与 `LoadFile`）
  const flat = classType.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...DANGEROUS_WORD_SEGMENTS].some(
    (word) => segments.includes(word) || flat.includes(word),
  );
}

export type CommunityRegistrySlot = {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'int' | 'float' | 'enum' | 'seed' | 'image';
  nodeId: string;
  field: string;
  defaultValue?: string | number | null;
  options?: string[];
  min?: number | null;
  max?: number | null;
  required?: boolean;
};

export type CommunityWorkflowGraph = Record<string, Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * unknown → 文本：只认字符串与有限数，其余（对象/数组/布尔）一律当空串。
 * 直接用 String() 会把对象变成 `[object Object]`：既能骗过 enum 比对的日志，也会泄进用户可见文案。
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** 判定 UI/save 格式：出现 nodes/links 这类顶层结构键，或节点体没有 class_type。 */
export function detectFormat(graph: unknown): 'api' | 'ui' | 'invalid' {
  if (!isPlainObject(graph)) return 'invalid';
  if (UI_FORMAT_KEYS.some((key) => key in graph)) return 'ui';
  const entries = Object.entries(graph);
  if (!entries.length) return 'invalid';
  // API 格式：每个顶层值都是 `{inputs, class_type}` 的节点定义
  const shaped = entries.every(([, value]) => {
    if (!isPlainObject(value)) return false;
    const hasMeta = typeof value.class_type === 'string';
    return hasMeta ? true : !('nodes' in value) && !('links' in value);
  });
  return shaped ? 'api' : 'ui';
}

/** 发布校验：只放 API 格式、节点数与体积封顶、危险节点与凭据字段拒收、class_type 必须在册。 */
export function validatePublishedGraph(
  graph: unknown,
  nodeNames: Set<string>,
): { format: 'api'; nodes: number } {
  const format = detectFormat(graph);
  if (format === 'invalid') {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      '工作流 JSON 不是合法的 Comfy API 格式对象',
    );
  }
  if (format === 'ui') {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      '这份工作流是 ComfyUI 界面（save）格式，Comfy Cloud 只接受 API 格式。请在 ComfyUI 里用「Workflow → Export (API)」导出后再发布。',
    );
  }
  const record = graph as CommunityWorkflowGraph;
  const serialized = JSON.stringify(record);
  if (serialized.length > COMMUNITY_JSON_LIMIT) {
    throw new BusinessException(
      ErrorCode.PAYLOAD_TOO_LARGE,
      '工作流超过 2MB，请精简节点与内联数据后再发布',
    );
  }
  const entries = Object.entries(record);
  if (entries.length > COMMUNITY_NODE_LIMIT) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `工作流节点数 ${entries.length} 超过 ${COMMUNITY_NODE_LIMIT} 个的社区上限`,
    );
  }
  const prefixes = partnerPrefixes();
  const unknown: string[] = [];
  for (const [nodeId, node] of entries) {
    if (!/^\d+$/.test(nodeId)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `节点 id「${nodeId.slice(0, 32)}」不合法：API 格式的节点键必须是数字`,
      );
    }
    if (!isPlainObject(node) || typeof node.class_type !== 'string') {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `节点 ${nodeId} 缺少 class_type，不是可执行的工作流节点`,
      );
    }
    const classType = node.class_type;
    if (dangerous(classType)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `节点「${classType}」属于可执行命令或任意读写的一类，社区不允许收录`,
      );
    }
    if (!nodeNames.has(classType)) {
      if (!prefixes.some((prefix) => classType.startsWith(prefix))) {
        unknown.push(classType);
        continue;
      }
    }
    // extra_data / 凭据字段：发布者不该往节点里塞任何鉴权信息（运行期由后端注入）
    for (const key of Object.keys(node)) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          `节点 ${nodeId} 里出现了疑似凭据字段「${key.slice(0, 32)}」，社区不接受`,
        );
      }
    }
  }
  if (unknown.length) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `这些节点在你的 Comfy Cloud 账号里不存在：${unknown.slice(0, 5).join('、')}${unknown.length > 5 ? ` 等 ${unknown.length} 个` : ''}。请先在 Comfy Cloud 安装对应自定义节点包，或改用官方节点重建工作流。`,
    );
  }
  // 图体里的字符串值也扫一遍凭据键（有些包把 Key 放在 inputs 里）
  if (CREDENTIAL_KEY_PATTERN.test(serialized.replace(/\\\\/g, ''))) {
    // 只有当它出现在「键」位置才算塞凭据；先粗筛，再用精确键名遍历复核
    const offenders = collectCredentialKeys(record);
    if (offenders.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `工作流里带有疑似凭据字段：${offenders.slice(0, 3).join('、')}。运行用的 Key 由站内注入，发布者不得内嵌任何凭据。`,
      );
    }
  }
  return { format: 'api', nodes: entries.length };
}

function collectCredentialKeys(record: CommunityWorkflowGraph): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || out.length > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) out.push(key);
      else walk(child, depth + 1);
    }
  };
  walk(record, 0);
  return [...new Set(out)];
}

/** 槽位声明校验：节点必须存在、字段必须是该节点已有的输入，且不许指向危险节点。 */
export function validateSlots(
  graph: CommunityWorkflowGraph,
  slots: CommunityRegistrySlot[],
  nodeNames: Set<string>,
): void {
  if (!Array.isArray(slots)) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      '参数表单格式不正确',
    );
  }
  if (slots.length > COMMUNITY_SLOT_LIMIT) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `参数表单最多 ${COMMUNITY_SLOT_LIMIT} 项`,
    );
  }
  const seen = new Set<string>();
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '参数表单项不合法',
      );
    }
    const key = String(slot.key || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项标识「${key.slice(0, 40)}」不合法（只允许字母数字与 _ . -）`,
      );
    }
    if (seen.has(key)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项标识「${key}」重复`,
      );
    }
    seen.add(key);
    const node = graph[String(slot.nodeId)];
    if (!isPlainObject(node)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项「${slot.label || key}」指向的节点 ${slot.nodeId} 不存在`,
      );
    }
    const classType = asText(node.class_type);
    if (nodeNames.size && !nodeNames.has(classType)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项「${slot.label || key}」所在的节点「${classType}」不在册`,
      );
    }
    if (dangerous(classType)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项「${slot.label || key}」指向了危险节点，已拒绝`,
      );
    }
    const inputs = node.inputs;
    if (!isPlainObject(inputs) || !(slot.field in inputs)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项「${slot.label || key}」要改的输入「${slot.field}」在节点 ${slot.nodeId} 上不存在`,
      );
    }
    if (
      !['text', 'longtext', 'int', 'float', 'enum', 'seed', 'image'].includes(
        slot.type,
      )
    ) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数项「${slot.label || key}」的类型不支持`,
      );
    }
    if (slot.type === 'enum' && !(slot.options || []).length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `下拉参数「${slot.label || key}」没有候选值`,
      );
    }
  }
}

function coerce(slot: CommunityRegistrySlot, raw: unknown): unknown {
  const label = slot.label || slot.key;
  if (slot.type === 'int' || slot.type === 'seed') {
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」需要填整数`,
      );
    }
    if (slot.type === 'seed' && value < 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」种子不能是负数`,
      );
    }
    if (Number.isFinite(slot.min) && value < Number(slot.min)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」不能小于 ${slot.min}`,
      );
    }
    if (Number.isFinite(slot.max) && value > Number(slot.max)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」不能大于 ${slot.max}`,
      );
    }
    return value;
  }
  if (slot.type === 'float') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」需要填数字`,
      );
    }
    if (Number.isFinite(slot.min) && value < Number(slot.min)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」不能小于 ${slot.min}`,
      );
    }
    if (Number.isFinite(slot.max) && value > Number(slot.max)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」不能大于 ${slot.max}`,
      );
    }
    return value;
  }
  if (slot.type === 'enum') {
    const value = asText(raw);
    if (!(slot.options || []).includes(value)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `「${label}」只能从给定选项里选`,
      );
    }
    return value;
  }
  if (slot.type === 'image') {
    // 运行期传进来的是本站数字资产 id 或已上传素材的 URL；提交前由服务层换成 asset id
    const value = asText(raw);
    if (!value) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `请先上传「${label}」`,
      );
    }
    return value;
  }
  const value = asText(raw);
  const limit = slot.type === 'longtext' ? 20000 : 4000;
  if (value.length > limit) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `「${label}」最多 ${limit} 个字符`,
    );
  }
  if (slot.required && !value.trim()) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `「${label}」不能为空`,
    );
  }
  return value;
}

/** Comfy 工作流里引用输入素材的写法。 */
export function assetReference(assetId: string) {
  return { __type: 'core/ASSET', info: { id: assetId } };
}

/**
 * 生成实际提交图：只覆盖已声明的槽位，未声明的输入一律用工作流原值。
 * 越界键（不在 slots 里）直接拒——否则任何人传个 `{ "3": {"class_type": "Shell"} }` 就能改写整张图。
 */
export async function buildRunGraph(
  graph: CommunityWorkflowGraph,
  slots: CommunityRegistrySlot[],
  inputs: Record<string, unknown>,
  resolveImage: (value: string) => Promise<string>,
): Promise<CommunityWorkflowGraph> {
  const declared = new Map(slots.map((slot) => [slot.key, slot]));
  for (const key of Object.keys(inputs || {})) {
    if (!declared.has(key)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `参数「${key.slice(0, 40)}」不在这份工作流允许修改的范围内`,
      );
    }
  }
  const clone = JSON.parse(JSON.stringify(graph)) as CommunityWorkflowGraph;
  for (const slot of slots) {
    const raw = inputs?.[slot.key];
    if (raw === undefined || raw === null || raw === '') {
      if (slot.required) {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          `请填写「${slot.label || slot.key}」`,
        );
      }
      continue;
    }
    const value = coerce(slot, raw);
    const node = clone[String(slot.nodeId)];
    const inputsOf = node.inputs as Record<string, unknown>;
    inputsOf[slot.field] =
      slot.type === 'image'
        ? assetReference(await resolveImage(String(value)))
        : value;
  }
  return clone;
}

/** 用户发布的 code：`wf_<uuid8>`，与官方模板名（纯 slug）天然不撞。 */
export function newUserWorkflowCode(): string {
  return `wf_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
