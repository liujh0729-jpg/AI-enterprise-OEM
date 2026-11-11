import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 账号与登录（/enterprise/admin/account/settings）：
 * 注册方式、登录方式、SMTP、阿里云短信、微信扫码参数。
 * 开源版本地能力，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 * 敏感项（SMTP 密码、短信 Secret、微信 Secret）只回「是否已配置」，原文永不回显。
 */
const BASE = "/api/backend/enterprise/admin/account";

export type RegisterMode = "USERNAME" | "EMAIL" | "PHONE";
export type LoginMethod = "PASSWORD" | "EMAIL_CODE" | "SMS_CODE" | "WECHAT";

export interface AccountSettingsView {
  registerModes: RegisterMode[];
  loginMethods: LoginMethod[];
  availability: Record<RegisterMode, boolean>;
  loginAvailability: Record<LoginMethod, boolean>;
  passwordRecovery: {
    enabled: boolean;
    PASSWORD: boolean;
    EMAIL: boolean;
    SMS: boolean;
  };
  smtp: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    from?: string;
    configured: boolean;
  };
  sms: {
    accessKeyId?: string;
    signName?: string;
    templateCode?: string;
    dailyLimit?: number;
    configured: boolean;
  };
  wechat: {
    provider: string;
    appId: string;
    enabled: boolean;
    scopes: string;
    autoRegister: boolean;
    configured: boolean;
  };
  cooldownDays: number;
  resetLinkBase: string;
}

export interface AccountSettingsDraft {
  registerModes?: RegisterMode[];
  loginMethods?: LoginMethod[];
  smtp?: {
    host: string;
    port?: number;
    secure?: boolean;
    user: string;
    from: string;
    /** 留空＝保留原密码。 */
    password?: string;
  };
  sms?: {
    accessKeyId: string;
    /** 留空＝保留原 Secret。 */
    accessKeySecret?: string;
    signName: string;
    templateCode: string;
    dailyLimit?: number;
  };
  wechat?: {
    provider?: string;
    appId: string;
    /** 留空＝保留原 Secret。 */
    appSecret?: string;
    enabled?: boolean;
    scopes?: string;
    autoRegister?: boolean;
  };
  policy?: { cooldownDays?: number; resetLinkBase?: string };
}

const envelopeSchema = apiEnvelope(z.unknown());

async function call<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const result = await http(path, envelopeSchema, options);
  return result.data.data as T;
}

export const accountSettingsApi = {
  view: (options?: HttpOptions) =>
    call<AccountSettingsView>(`${BASE}/settings`, { ...options }),
  save: (body: AccountSettingsDraft, options?: HttpOptions) =>
    call<AccountSettingsView>(`${BASE}/settings`, {
      ...options,
      method: "PUT",
      body,
    }),
};
