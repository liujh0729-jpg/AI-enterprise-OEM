import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * RPA 三块内容的界面层：脚本 / 账号 / 任务，外加「AI 写脚本」用的模型配置。
 * 后端：/enterprise/rpa/*（登录态）与 /api/v1/rpa/*（API Key 机器通道，本地比特浏览器执行端用）。
 * 归属＝账号：任何账号切企业 / 服务商 / 职员身份，看到的都是同一批 RPA 内容。
 */

/**
 * 比特浏览器预设平台（对齐 /browser/add 的 platform 下拉）：
 * value 是平台首页 URL，label 是中文显示名。用户只能从列表选，不手输。
 */
export const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: "https://www.facebook.com", label: "Facebook" },
  { value: "https://www.instagram.com", label: "Instagram" },
  { value: "https://www.twitter.com", label: "Twitter / X" },
  { value: "https://www.youtube.com", label: "YouTube" },
  { value: "https://www.tiktok.com", label: "TikTok" },
  { value: "https://www.linkedin.com", label: "LinkedIn" },
  { value: "https://www.reddit.com", label: "Reddit" },
  { value: "https://www.pinterest.com", label: "Pinterest" },
  { value: "https://www.amazon.com", label: "Amazon" },
  { value: "https://www.ebay.com", label: "eBay" },
  { value: "https://www.aliexpress.com", label: "AliExpress 速卖通" },
  { value: "https://www.shopee.com", label: "Shopee" },
  { value: "https://www.lazada.com", label: "Lazada" },
  { value: "https://www.taobao.com", label: "淘宝" },
  { value: "https://www.jd.com", label: "京东" },
  { value: "https://www.pinduoduo.com", label: "拼多多" },
  { value: "https://www.1688.com", label: "1688" },
  { value: "https://www.xiaohongshu.com", label: "小红书" },
  { value: "https://www.douyin.com", label: "抖音" },
  { value: "https://www.kuaishou.com", label: "快手" },
  { value: "https://www.weibo.com", label: "微博" },
  { value: "https://www.bilibili.com", label: "哔哩哔哩" },
  { value: "https://www.zhihu.com", label: "知乎" },
  { value: "https://www.google.com", label: "Google" },
  { value: "https://www.bing.com", label: "Bing" },
  { value: "https://www.whatsapp.com", label: "WhatsApp" },
  { value: "https://www.telegram.org", label: "Telegram" },
  { value: "https://www.gmail.com", label: "Gmail" },
  { value: "https://www.outlook.com", label: "Outlook" },
];

/** 平台 URL → 中文显示名（列表 / 详情复用）。 */
export function platformLabel(url: string) {
  const hit = PLATFORM_OPTIONS.find((item) => item.value === url);
  if (hit) return hit.label;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "—";
  }
}

/** 目标设备：与后端 rpa-shared.DEVICE_TYPES / DEVICE_LABELS 一一对应。 */
export const DEVICE_LABEL: Record<string, string> = {
  pc: "PC（比特浏览器）",
  android: "安卓云手机",
  iphone: "iPhone 云手机",
  chrome: "本地 Chrome（插件）",
};

export const DEVICE_OPTIONS = Object.entries(DEVICE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

export function deviceLabel(value: string) {
  return DEVICE_LABEL[value] || value || "—";
}

/** 只有云手机设备才谈环境 ID、计费方式与跑完后的收尾动作。 */
export function isPhoneDevice(value: string) {
  return value === "android" || value === "iphone";
}

/** 本地 Chrome 插件任务：绑设备 clientId、不需要 RPA 账号（用本机已登录的浏览器）。 */
export function isChromeDevice(value: string) {
  return value === "chrome";
}

/** 云手机计费方式（对齐比特浏览器 envType）：0＝套餐计费，1＝按时计费。 */
export const ENV_TYPE_LABEL: Record<number, string> = {
  0: "套餐计费",
  1: "按时计费",
};

export const ENV_TYPE_OPTIONS = Object.entries(ENV_TYPE_LABEL).map(
  ([value, label]) => ({ value: Number(value), label }),
);

/** 比特云手机可用地域（对齐比特浏览器 API /phone/region/list）。 */
export const BITPHONE_REGION_LABEL: Record<string, string> = {
  "cn-east": "华东",
  "cn-south": "华南",
  "cn-north": "华北",
  "cn-southwest": "西南",
  "ap-southeast": "东南亚",
};

export const BITPHONE_REGION_OPTIONS = Object.entries(BITPHONE_REGION_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** 比特云手机算力规格（对齐比特浏览器 API /phone/compute/type/list）。 */
export const BITPHONE_COMPUTE_TYPE_LABEL: Record<string, string> = {
  standard: "标准型",
  high: "高性能型",
  ultra: "旗舰型",
};

export const BITPHONE_COMPUTE_TYPE_OPTIONS = Object.entries(
  BITPHONE_COMPUTE_TYPE_LABEL,
).map(([value, label]) => ({ value, label }));

/** 代理方式（对齐比特浏览器 proxyMethod）：2＝自定义代理，3＝提取 IP。 */
export const PROXY_METHOD_LABEL: Record<number, string> = {
  2: "自定义代理",
  3: "提取 IP",
};

export const PROXY_METHOD_OPTIONS = Object.entries(PROXY_METHOD_LABEL).map(
  ([value, label]) => ({ value: Number(value), label }),
);

/** 代理类型（对齐比特浏览器 proxyType）。 */
export const PROXY_TYPE_LABEL: Record<string, string> = {
  noproxy: "直连",
  http: "HTTP",
  https: "HTTPS",
  socks5: "SOCKS5",
  ssh: "SSH",
};

export const PROXY_TYPE_OPTIONS = Object.entries(PROXY_TYPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** 手机任务跑完后的动作：保持开机 / 关机 / 挂起（省算力按挂起或关机计费）。 */
export const PHONE_FINISH_LABEL: Record<string, string> = {
  keep: "保持开机",
  shutdown: "关机",
  suspend: "挂起",
};

export const PHONE_FINISH_OPTIONS = Object.entries(PHONE_FINISH_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** 脚本类型：与后端 rpa-shared.SCRIPT_FILE_TYPE_LABELS 一一对应，界面只显中文标签。 */
export const FILE_TYPE_LABEL: Record<string, string> = {
  automa_json: "JSON（Automa 脚本）",
  bitbrowser_rpa: "比特浏览器 RPA 流程",
  bitphone_json: "比特云手机 RPA 流程",
  chrome_actions: "本地 Chrome 动作序列（JSON）",
  javascript: "JS 脚本",
  python: "Python 脚本",
};

/**
 * 每种设备能吃的脚本类型，顺序与默认值都由后端 rpa-shared.SCRIPT_FILE_TYPES_BY_DEVICE 定：
 * 比特浏览器 / 云手机的 RPA 流程只能在客户端里画好再登记，iPhone 云手机只有 JS / Python；
 * 本地 Chrome 插件只回放闭集动作序列（契约 RC_ACTIONS），不接受任意脚本。
 */
export const FILE_TYPES_BY_DEVICE: Record<string, string[]> = {
  pc: ["automa_json", "bitbrowser_rpa", "javascript", "python"],
  android: ["bitphone_json", "javascript", "python"],
  iphone: ["javascript", "python"],
  chrome: ["chrome_actions"],
};

/** AI 能写出来的类型：客户端导出的流程文件模型造不出合法正文，不给选。 */
export const AI_WRITABLE_FILE_TYPES = ["automa_json", "javascript", "python"];

export function fileTypesForDevice(device: string) {
  return (FILE_TYPES_BY_DEVICE[device] || FILE_TYPES_BY_DEVICE.pc).map(
    (value) => ({ value, label: FILE_TYPE_LABEL[value] || value }),
  );
}

export function aiFileTypesForDevice(device: string) {
  return fileTypesForDevice(device).filter((item) =>
    AI_WRITABLE_FILE_TYPES.includes(item.value),
  );
}

export function defaultFileTypeForDevice(device: string) {
  return (FILE_TYPES_BY_DEVICE[device] || FILE_TYPES_BY_DEVICE.pc)[0];
}

export function fileTypeLabel(value: string) {
  return FILE_TYPE_LABEL[value] || value;
}

/** 脚本状态：草稿可改，发布后仍可改（业务状态不决定改删，只看身份）。 */
export const SCRIPT_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  testing: "测试中",
  published: "已发布",
  archived: "已归档",
};

export const SCRIPT_STATUS_OPTIONS = Object.entries(SCRIPT_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** RPA 账号状态（沿用参考实现 rpa_accounts.status 四种取值）。 */
export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: "正常",
  disabled: "停用",
  banned: "已封禁",
  pending: "待验证",
};

export const ACCOUNT_STATUS_OPTIONS = Object.entries(ACCOUNT_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** 任务状态：pending 才可被本地执行端认领；timeout 由平台超时判定产生。 */
export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timeout: "超时",
};

export const TASK_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  ...Object.entries(TASK_STATUS_LABEL).map(([value, label]) => ({
    value,
    label,
  })),
];

/** 脚本声明的运行参数：任务表单按它渲染输入框，也是「参数必须有输入源头」的出处。 */
export type ParamSpec = {
  label: string;
  required: boolean;
  default: unknown;
};

export type RpaScript = {
  id: number;
  createdBy: string;
  owner: boolean;
  name: string;
  description: string;
  category: string;
  deviceType: string;
  fileType: string;
  /** 比特浏览器 RPA 流程在客户端里的任务 ID，执行端拿它调 POST /rpa/run。 */
  vendorFlowId: string;
  status: string;
  paramsSchema: Record<string, ParamSpec>;
  taskCount: number;
  /** 列表不带正文（正文可达上百 KB），查看与编辑时按 id 单取。 */
  content?: string;
  tags?: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type RpaAccount = {
  id: number;
  createdBy: string;
  platform: string;
  groupId: string;
  nickname: string;
  username: string;
  loginUrl: string;
  envType: number;
  status: string;
  proxyMethod: number;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUserName: string;
  notes: string;
  lastLoginAt: string | null;
  /** 口令（登录 / 代理）只回「存过没有」：后端密文落库，只有任务派发链路会把明文回传给本地执行端。 */
  hasPassword: boolean;
  hasProxyPassword: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RpaTask = {
  id: number;
  createdBy: string;
  name: string;
  scriptId: number;
  deviceType: string;
  deviceLabel: string;
  /** 本地 Chrome 任务绑定的设备 clientId；其余设备类型为空串。 */
  chromeClientId: string;
  accountIds: number[];
  params: Record<string, unknown>;
  status: string;
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
  /** 云手机任务跑完后的动作；PC 任务恒为 keep。 */
  phoneFinishAction: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastRunAt: string | null;
  lastError: string;
  maxRetries: number;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
  script: {
    id: number;
    name: string;
    deviceType: string;
    fileType: string;
    vendorFlowId?: string;
    status: string;
  } | null;
  accounts: {
    id: number;
    platform: string;
    username: string;
    envType?: number;
  }[];
};

/** 执行记录状态：success / failed / cancelled 由执行端回传，running 由认领产生，timeout 由平台判定。 */
export const EXECUTION_STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  timeout: "超时",
};

export type RpaExecution = {
  id: number;
  taskId: number;
  createdBy: string;
  deviceType: string;
  deviceLabel: string;
  status: string;
  statusLabel: string;
  attempt: number;
  executor: string;
  output: Record<string, unknown>;
  errorMessage: string;
  logText: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

export type ChatMsg = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ParamsChatResult = {
  reply: string;
  params: Record<string, string>;
  done: boolean;
  elapsedMs: number;
};

export type LlmSetting = {
  configured: boolean;
  keyMasked: string;
  model: string;
  baseUrl: string;
};

export type RpaSetting = {
  id: number;
  createdBy: string;
  bitbrowserApiEndpoint: string;
  bitbrowserGroupId: string;
  bitphoneRegionId: string;
  bitphoneComputeType: string;
  hasBitbrowserApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerateResult = {
  deviceType: string;
  fileType: string;
  model: string;
  content: string;
  paramsSchema: Record<string, unknown>;
  suggestedName: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
};

const api = {
  scripts: endpoint(endpoints.Rpa_scripts),
  script: endpoint(endpoints.Rpa_script),
  createScript: endpoint(endpoints.Rpa_createScript),
  updateScript: endpoint(endpoints.Rpa_updateScript),
  deleteScript: endpoint(endpoints.Rpa_removeScript),
  generate: endpoint(endpoints.Rpa_generateScript),
  accounts: endpoint(endpoints.Rpa_accounts),
  createAccount: endpoint(endpoints.Rpa_createAccount),
  updateAccount: endpoint(endpoints.Rpa_updateAccount),
  deleteAccount: endpoint(endpoints.Rpa_removeAccount),
  tasks: endpoint(endpoints.Rpa_tasks),
  createTask: endpoint(endpoints.Rpa_createTask),
  createBatch: endpoint(endpoints.Rpa_createTasks),
  updateTask: endpoint(endpoints.Rpa_updateTask),
  deleteTask: endpoint(endpoints.Rpa_removeTask),
  cancelTask: endpoint(endpoints.Rpa_cancelTask),
  requeueTask: endpoint(endpoints.Rpa_requeueTask),
  executions: endpoint(endpoints.Rpa_executions),
  llmSetting: endpoint(endpoints.Rpa_llm),
  saveLlm: endpoint(endpoints.Rpa_saveLlm),
  llmModels: endpoint(endpoints.Rpa_llmModels),
  deleteLlm: endpoint(endpoints.Rpa_removeLlm),
  paramsChat: endpoint(endpoints.Rpa_paramsChat),
  settings: endpoint(endpoints.Rpa_settings),
  saveSettings: endpoint(endpoints.Rpa_saveSettings),
};

/** 取数：失败不抛错，交页面提示（与 data-table/_components/common.ts 同口径）。 */
async function load<T>(work: Promise<unknown>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: (await work) as T, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

/** 写操作：失败抛出后端文案，由调用方 message.error。 */
async function mutate<T>(work: Promise<unknown>): Promise<T> {
  return (await work) as T;
}

/** 一次取满：RPA 内容按账号归属，量级是「自己登记的脚本与账号」，不需要翻页。 */
const ALL = { page: 1, pageSize: 200 };

export const rpaApi = {
  scripts: () =>
    load<{ list: RpaScript[]; total: number }>(api.scripts({ query: ALL })),
  script: (id: number) => load<RpaScript>(api.script({ params: { id: String(id) } })),
  createScript: (body: Record<string, unknown>) =>
    mutate<RpaScript>(api.createScript({ body })),
  updateScript: (id: number, body: Record<string, unknown>) =>
    mutate<RpaScript>(api.updateScript({ params: { id: String(id) }, body })),
  deleteScript: (id: number) =>
    mutate<{ id: number }>(api.deleteScript({ params: { id: String(id) } })),
  generate: (body: {
    requirement: string;
    deviceType: string;
    fileType: string;
    model?: string;
  }) => mutate<GenerateResult>(api.generate({ body })),

  accounts: () => load<RpaAccount[]>(api.accounts({})),
  createAccount: (body: Record<string, unknown>) =>
    mutate<RpaAccount>(api.createAccount({ body })),
  updateAccount: (id: number, body: Record<string, unknown>) =>
    mutate<RpaAccount>(api.updateAccount({ params: { id: String(id) }, body })),
  deleteAccount: (id: number) =>
    mutate<{ id: number }>(api.deleteAccount({ params: { id: String(id) } })),

  tasks: () =>
    load<{ list: RpaTask[]; total: number }>(api.tasks({ query: ALL })),
  createTask: (body: Record<string, unknown>) =>
    mutate<RpaTask>(api.createTask({ body })),
  createBatch: (body: Record<string, unknown>) =>
    mutate<RpaTask[]>(api.createBatch({ body })),
  updateTask: (id: number, body: Record<string, unknown>) =>
    mutate<RpaTask>(api.updateTask({ params: { id: String(id) }, body })),
  deleteTask: (id: number) =>
    mutate<{ id: number }>(api.deleteTask({ params: { id: String(id) } })),
  cancelTask: (id: number) =>
    mutate<RpaTask>(api.cancelTask({ params: { id: String(id) } })),
  requeueTask: (id: number) =>
    mutate<RpaTask>(api.requeueTask({ params: { id: String(id) } })),
  executions: (taskId: number) =>
    load<RpaExecution[]>(api.executions({ query: { taskId, limit: 50 } })),

  llmSetting: () => load<LlmSetting>(api.llmSetting({})),
  saveLlm: (body: { model?: string }) =>
    mutate<LlmSetting>(api.saveLlm({ body })),
  llmModels: () =>
    load<{ baseUrl: string; models: string[] }>(api.llmModels({})),
  deleteLlm: () => mutate<{ removed: boolean }>(api.deleteLlm({})),
  paramsChat: (body: {
    scriptId: number;
    messages: ChatMsg[];
    currentParams: Record<string, unknown>;
    model?: string;
  }) => mutate<ParamsChatResult>(api.paramsChat({ body })),

  settings: () => load<RpaSetting>(api.settings({})),
  saveSettings: (body: Record<string, unknown>) =>
    mutate<RpaSetting>(api.saveSettings({ body })),
};

/** 运行参数定义输入：`keyword: 关键词` 每行一条，提交成后端认识的 JSON 对象。 */
export function parseParamLines(raw: string): Record<string, { label: string }> {
  const schema: Record<string, { label: string }> = {};
  raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.search(/[:：]/);
      const key = (index < 0 ? line : line.slice(0, index)).trim();
      if (!key) return;
      const label = index < 0 ? key : line.slice(index + 1).trim() || key;
      schema[key] = { label };
    });
  return schema;
}

/** 已存参数定义 → 输入框文本（一行一条 `键: 标签`）。 */
export function paramLines(schema: Record<string, ParamSpec>): string {
  return Object.entries(schema || {})
    .map(([key, spec]) => `${key}: ${spec?.label || key}`)
    .join("\n");
}

/** 任务参数输入 → 提交值：空串不落库，其余原样带上（后端按脚本声明补默认值与必填校验）。 */
export function buildParams(
  schema: Record<string, ParamSpec>,
  values: Record<string, string>,
  freeJson: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  Object.keys(schema || {}).forEach((key) => {
    const value = (values[key] || "").trim();
    if (value !== "") params[key] = value;
  });
  const json = freeJson.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(params, parsed as Record<string, unknown>);
      }
    } catch {
      // 自由参数写错不拦：脚本声明的参数照常提交，执行端按声明取值
    }
  }
  return params;
}

/** 时长显示：毫秒换成「x 分 y 秒」，没跑完显「—」。 */
export function durationText(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} 秒`;
  return `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
}

/** 已存参数定义 → 任务表单要渲染的输入项（按声明顺序）。 */
export function paramEntries(script: RpaScript | null): [string, ParamSpec][] {
  if (!script) return [];
  return Object.entries(script.paramsSchema || {});
}
