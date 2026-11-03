import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 目标设备：pc＝比特浏览器窗口，android＝安卓云手机，iphone＝iPhone 云手机。 */
export const DEVICE_TYPES = ['pc', 'android', 'iphone'] as const;

export const DEVICE_LABELS: Record<string, string> = {
  pc: 'PC（比特浏览器）',
  android: '安卓云手机',
  iphone: 'iPhone 云手机',
};

/** 设备叫法归一：界面、机器通道与 MCP 都可能传中文或扩展名式写法。 */
const DEVICE_ALIASES: Record<string, string> = {
  pc: 'pc',
  desktop: 'pc',
  windows: 'pc',
  win: 'pc',
  browser: 'pc',
  浏览器: 'pc',
  电脑: 'pc',
  pc端: 'pc',
  android: 'android',
  安卓: 'android',
  安卓手机: 'android',
  云手机: 'android',
  cloudphone: 'android',
  bitphone: 'android',
  phone: 'android',
  iphone: 'iphone',
  苹果: 'iphone',
  ios: 'iphone',
  apple: 'iphone',
  cloudiphone: 'iphone',
};

/**
 * 云手机计费方式（对齐比特浏览器 envType）：0＝套餐计费，1＝按时计费。
 * 同一任务绑定的云手机账号必须统一计费方式。
 */
export const ENV_TYPES = [0, 1] as const;

export const ENV_TYPE_LABELS: Record<number, string> = {
  0: '套餐计费',
  1: '按时计费',
};

/** 比特云手机可用地域（对齐比特浏览器 API /phone/region/list）。 */
export const BITPHONE_REGIONS = [
  'cn-east',
  'cn-south',
  'cn-north',
  'cn-southwest',
  'ap-southeast',
] as const;

export const BITPHONE_REGION_LABELS: Record<string, string> = {
  'cn-east': '华东',
  'cn-south': '华南',
  'cn-north': '华北',
  'cn-southwest': '西南',
  'ap-southeast': '东南亚',
};

/** 比特云手机算力规格（对齐比特浏览器 API /phone/compute/type/list）。 */
export const BITPHONE_COMPUTE_TYPES = ['standard', 'high', 'ultra'] as const;

export const BITPHONE_COMPUTE_TYPE_LABELS: Record<string, string> = {
  standard: '标准型',
  high: '高性能型',
  ultra: '旗舰型',
};

const ENV_TYPE_ALIASES: Record<string, number> = {
  '0': 0,
  package: 0,
  套餐: 0,
  包月: 0,
  '1': 1,
  temp: 1,
  temporary: 1,
  按时: 1,
  临时: 1,
};

/** 代理方式（对齐比特浏览器 proxyMethod）：2＝自定义代理，3＝提取 IP。 */
export const PROXY_METHODS = [2, 3] as const;

export const PROXY_METHOD_LABELS: Record<number, string> = {
  2: '自定义代理',
  3: '提取 IP',
};

/** 代理类型（对齐比特浏览器 proxyType）。 */
export const PROXY_TYPES = [
  'noproxy',
  'http',
  'https',
  'socks5',
  'ssh',
] as const;

export const PROXY_TYPE_LABELS: Record<string, string> = {
  noproxy: '直连',
  http: 'HTTP',
  https: 'HTTPS',
  socks5: 'SOCKS5',
  ssh: 'SSH',
};

/** 手机任务跑完后的收尾动作；pc 没有「关机云手机」这一说，一律 keep。 */
export const PHONE_FINISH_ACTIONS = ['keep', 'shutdown', 'suspend'] as const;

export const PHONE_FINISH_ACTION_LABELS: Record<string, string> = {
  keep: '保持开机',
  shutdown: '关机',
  suspend: '挂起',
};

const PHONE_FINISH_ACTION_ALIASES: Record<string, string> = {
  keep: 'keep',
  保持开机: 'keep',
  保持: 'keep',
  shutdown: 'shutdown',
  关机: 'shutdown',
  suspend: 'suspend',
  挂起: 'suspend',
};

/** 脚本类型（界面与本地执行器看到的同一个字段；取值按设备收窄）。 */
export const SCRIPT_FILE_TYPES = [
  'automa_json',
  'bitbrowser_rpa',
  'bitphone_json',
  'javascript',
  'python',
] as const;

export const SCRIPT_FILE_TYPE_LABELS: Record<string, string> = {
  automa_json: 'JSON（Automa 脚本）',
  bitbrowser_rpa: '比特浏览器 RPA 流程',
  bitphone_json: '比特云手机 RPA 流程（JSON）',
  javascript: 'JS 脚本',
  python: 'Python 脚本',
};

/**
 * 每种设备能吃的脚本类型，顺序即界面默认值。
 * pc 的比特浏览器 RPA 流程要靠客户端里的任务 ID 触发（POST /rpa/run）；
 * 云手机 RPA 只认客户端「RPA 自动化-云手机环境」导出的 .json 流程文件，且只有安卓有；
 * iPhone 云手机在接口文档里既没有可用接口也没有 RPA，只能自带 JS / Python 脚本交给执行端自己的工具链。
 */
export const SCRIPT_FILE_TYPES_BY_DEVICE: Record<string, readonly string[]> = {
  pc: ['automa_json', 'bitbrowser_rpa', 'javascript', 'python'],
  android: ['bitphone_json', 'javascript', 'python'],
  iphone: ['javascript', 'python'],
};

/** 扩展名 / 别名叫法 → 规范类型，界面与本地执行器都可能传 `json` / `js` / `py`。 */
const FILE_TYPE_ALIASES: Record<string, string> = {
  json: 'automa_json',
  automa: 'automa_json',
  automa_json: 'automa_json',
  bitbrowser: 'bitbrowser_rpa',
  bitbrowser_rpa: 'bitbrowser_rpa',
  bitrpa: 'bitbrowser_rpa',
  bitphone: 'bitphone_json',
  bitphone_json: 'bitphone_json',
  cloudphone_json: 'bitphone_json',
  js: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
};

export const SCRIPT_STATUSES = [
  'draft',
  'testing',
  'published',
  'archived',
] as const;

export const ACCOUNT_STATUSES = [
  'active',
  'disabled',
  'banned',
  'pending',
] as const;

export const TASK_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

/** 执行端回传的终态；running 由认领动作产生，timeout 由平台超时判定产生。 */
export const REPORT_STATUSES = ['success', 'failed', 'cancelled'] as const;

export const MAX_SCRIPT_CONTENT = 200_000;

export type ParamSpec = {
  label: string;
  required: boolean;
  default: unknown;
};

export function normalizeDeviceType(raw: unknown, fallback = 'pc') {
  const value = text(raw).trim().toLowerCase();
  if (!value) return fallback;
  const mapped = DEVICE_ALIASES[value];
  if (mapped) return mapped;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '设备类型只能是 PC / 安卓手机 / iPhone 手机',
  );
}

export function deviceLabel(raw: unknown) {
  return DEVICE_LABELS[normalizeDeviceType(raw)] || text(raw);
}

/** 手机设备（安卓 / iPhone）：只有它们才谈云手机环境 ID、计费方式与收尾动作。 */
export function isPhoneDevice(raw: unknown) {
  const device = normalizeDeviceType(raw);
  return device === 'android' || device === 'iphone';
}

export function normalizeEnvType(raw: unknown, fallback = 1): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = text(raw).trim().toLowerCase();
  if (!value) return fallback;
  const mapped = ENV_TYPE_ALIASES[value];
  if (mapped !== undefined) return mapped;
  const num = Number(value);
  if (ENV_TYPES.includes(num as 0 | 1)) return num;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '云手机计费方式只能是套餐计费（0）/ 按时计费（1）',
  );
}

export function normalizeProxyMethod(raw: unknown, fallback = 2): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(text(raw).trim());
  if (PROXY_METHODS.includes(num as 2 | 3)) return num;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '代理方式只能是 2（自定义代理）/ 3（提取 IP）',
  );
}

export function normalizeProxyType(raw: unknown, fallback = 'noproxy'): string {
  const value = text(raw).trim().toLowerCase();
  if (!value) return fallback;
  if ((PROXY_TYPES as readonly string[]).includes(value)) return value;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '代理类型只能是 noproxy / http / https / socks5 / ssh',
  );
}

export function normalizePhoneFinishAction(raw: unknown, fallback = 'keep') {
  const value = text(raw).trim().toLowerCase();
  if (!value) return fallback;
  const mapped = PHONE_FINISH_ACTION_ALIASES[value];
  if (mapped) return mapped;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '任务结束动作只能是保持开机 / 关机 / 挂起',
  );
}

/** 某设备下允许脚选的脚本类型列表（界面下拉与 AI 写脚本都读它，保证口径一致）。 */
export function scriptFileTypesForDevice(deviceType: unknown) {
  const device = normalizeDeviceType(deviceType);
  return SCRIPT_FILE_TYPES_BY_DEVICE[device].map((type) => ({
    fileType: type,
    label: SCRIPT_FILE_TYPE_LABELS[type],
  }));
}

/**
 * 脚本类型归一：先认别名，再按设备白名单收窄。
 * 不传设备时只做别名归一（列表筛选里单独按脚本类型筛仍然可用）。
 */
export function normalizeFileType(raw: unknown, deviceType?: unknown): string {
  const value = text(raw).trim().toLowerCase();
  const mapped = FILE_TYPE_ALIASES[value];
  if (!mapped) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '脚本类型只能是 JSON（Automa 脚本）/ 比特浏览器 RPA 流程 / 比特云手机 RPA 流程 / Python 脚本 / JS 脚本',
    );
  }
  if (deviceType === undefined) return mapped;
  const device = normalizeDeviceType(deviceType);
  if (!SCRIPT_FILE_TYPES_BY_DEVICE[device].includes(mapped)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${DEVICE_LABELS[device]}不支持「${SCRIPT_FILE_TYPE_LABELS[mapped]}」，可选：${[...SCRIPT_FILE_TYPES_BY_DEVICE[device]].map((type) => SCRIPT_FILE_TYPE_LABELS[type]).join(' / ')}`,
    );
  }
  return mapped;
}

export function normalizeChoice(
  raw: unknown,
  choices: readonly string[],
  label: string,
  fallback: string,
) {
  const value = text(raw).trim().toLowerCase();
  if (!value) return fallback;
  if (!choices.includes(value)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}只能是：${choices.join(' / ')}`,
    );
  }
  return value;
}

/** 正整数 ID 数组：接受 `[1,2]`、`["1","2"]`、`"1,2"` 三种叫法。 */
export function parseIdList(raw: unknown, label: string): number[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，、;；\s]+/)
      : [];
  const ids: number[] = [];
  for (const item of items) {
    const value = Number(text(item).trim());
    if (!Number.isInteger(value) || value <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${label}里含非法 ID：${text(item)}`,
      );
    }
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

/**
 * 运行参数定义：`{ 参数键: { label, required, default } }`，也接受 `{ 参数键: "中文标签" }` 简写。
 * 它是任务表单的输入源头——脚本没声明参数时任务就只带空 params，不额外造字段。
 */
export function normalizeParamsSchema(raw: unknown): Record<string, ParamSpec> {
  if (raw === undefined || raw === null || raw === '') return {};
  let source: unknown = raw;
  if (typeof source === 'string') {
    try {
      const parsed: unknown = JSON.parse(source);
      source = parsed;
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '运行参数定义不是合法 JSON',
      );
    }
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '运行参数定义要写成 { 参数键: { label, required, default } }',
    );
  }
  const schema: Record<string, ParamSpec> = {};
  for (const [rawKey, value] of Object.entries(
    source as Record<string, unknown>,
  )) {
    const key = rawKey.trim();
    if (!key) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '参数键不能为空');
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const spec = value as Record<string, unknown>;
      schema[key] = {
        label: text(spec.label, key).trim() || key,
        required: Boolean(spec.required),
        default: spec.default ?? null,
      };
    } else {
      schema[key] = {
        label: text(value).trim() || key,
        required: false,
        default: null,
      };
    }
  }
  return schema;
}

/** 按脚本声明校验并补齐任务参数：缺必填即 400，未提供的可选参数按默认值带上。 */
export function resolveParams(
  rawSchema: unknown,
  raw: unknown,
): Record<string, unknown> {
  const schema = normalizeParamsSchema(rawSchema);
  let input: Record<string, unknown> = {};
  if (raw !== undefined && raw !== null && raw !== '') {
    if (typeof raw === 'string') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '运行参数不是合法 JSON',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '运行参数要写成 { 参数键: 值 }',
        );
      }
      input = parsed as Record<string, unknown>;
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      input = raw as Record<string, unknown>;
    } else {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '运行参数要写成 { 参数键: 值 }',
      );
    }
  }
  const params: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const value = input[key];
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (spec.required) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `运行参数「${spec.label}」必填`,
        );
      }
      if (spec.default !== null && spec.default !== undefined) {
        params[key] = spec.default;
      }
      continue;
    }
    params[key] = value;
  }
  // 脚本没声明参数时不拦自由参数：本地执行器与 MCP 都可能直接传业务字段
  if (!Object.keys(schema).length) {
    Object.assign(params, input);
  }
  return params;
}

/** 画布 / 客户端导出的流程正文：必须是对象，形状错了浏览器扩展或云手机客户端会直接导入失败。 */
function assertJsonObject(content: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}正文不是合法 JSON`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}正文要是一个 JSON 对象（客户端导出的流程文件）`,
    );
  }
}

/** Automa 画布导出的 JSON。 */
export function assertAutomaJson(content: string) {
  assertJsonObject(content, 'Automa 脚本');
}

/** 比特云手机 RPA 导出的流程文件：文档明确「仅支持 .json，且只支持比特云手机 RPA 导出的流程文件」。 */
export function assertBitphoneJson(content: string) {
  assertJsonObject(content, '比特云手机 RPA 流程');
}

/** 比特浏览器（PC）RPA 流程正文：客户端里画好、用任务 ID 触发，云端只存档。 */
export function assertBitbrowserFlowJson(content: string) {
  assertJsonObject(content, '比特浏览器 RPA 流程');
}
