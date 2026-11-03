import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * AI 调用账号界面层：给 AI 自动化任务准备第三方平台凭据，并按 Workbuddy
 * Enterprise 账号授权可用范围。界面是 Workbuddy 企业云页内的页签，绑定下拉直接
 * 用页面已加载的 Workbuddy 账号，不再单独发一次请求。
 * 后端：/enterprise/ai-call/*（登录态）与 /api/v1/ai-call/*（API Key 机器通道）。
 */

export type AiCallBinding = {
  workbuddyAccountId: number;
  name: string;
  status: string;
};

export type AiCallAccount = {
  id: number;
  createdBy: string;
  name: string;
  platform: string;
  loginUrl: string;
  username: string;
  extra: Record<string, unknown>;
  status: string;
  notes: string;
  hasPassword: boolean;
  hasApiKey: boolean;
  hasCookie: boolean;
  bindings: AiCallBinding[];
  createdAt: string;
  updatedAt: string;
};

export type WorkbuddyAccountOption = {
  id: number;
  name: string;
  status: string;
  region?: string;
};

const accountsApi = endpoint(endpoints.AiCall_accounts);
const createAccountApi = endpoint(endpoints.AiCall_createAccount);
const updateAccountApi = endpoint(endpoints.AiCall_updateAccount);
const deleteAccountApi = endpoint(endpoints.AiCall_removeAccount);

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

async function mutate<T>(work: Promise<unknown>): Promise<T> {
  return (await work) as T;
}

export const aiCallApi = {
  accounts: () => load<AiCallAccount[]>(accountsApi({})),
  createAccount: (body: Record<string, unknown>) =>
    mutate<AiCallAccount>(createAccountApi({ body })),
  updateAccount: (id: number, body: Record<string, unknown>) =>
    mutate<AiCallAccount>(updateAccountApi({ params: { id: String(id) }, body })),
  deleteAccount: (id: number) =>
    mutate<{ id: number }>(deleteAccountApi({ params: { id: String(id) } })),
};

export const AI_CALL_STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
};

export const AI_CALL_STATUS_OPTIONS = Object.entries(
  AI_CALL_STATUS_LABEL,
).map(([value, label]) => ({ value, label }));

/** 其他字段：一行一条 `键: 值`，存成后端 extra 的键值对。 */
export function extraLines(extra: Record<string, unknown> | undefined) {
  return Object.entries(extra || {})
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .join("\n");
}

export function parseExtraLines(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.search(/[:：]/);
      if (index < 0) return;
      const key = line.slice(0, index).trim();
      if (key) result[key] = line.slice(index + 1).trim();
    });
  return result;
}
