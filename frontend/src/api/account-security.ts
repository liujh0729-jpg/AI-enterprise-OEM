import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/** 账号安全（/enterprise/account/*）：改密与验证码设密，策略与后台登录方式同源。 */
const BASE = "/api/backend/enterprise/account";
const envelope = apiEnvelope(z.unknown());

export interface AccountSecurityView {
  username: string;
  hasPassword: boolean;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  passwordLoginEnabled: boolean;
  codeChannels: { EMAIL: boolean; SMS: boolean };
}

async function call<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const result = await http(path, envelope, options);
  return result.data.data as T;
}

export const accountSecurityApi = {
  view: (options?: HttpOptions) =>
    call<AccountSecurityView>(`${BASE}/security`, { ...options }),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<{ changed: boolean }>(`${BASE}/password`, {
      method: "POST",
      body: { oldPassword, newPassword },
    }),
  sendCode: (channel: "EMAIL" | "SMS") =>
    call<{ sent: boolean; target: string }>(`${BASE}/password/code`, {
      method: "POST",
      body: { channel },
    }),
  setByCode: (channel: "EMAIL" | "SMS", code: string, newPassword: string) =>
    call<{ changed: boolean }>(`${BASE}/password/set-by-code`, {
      method: "POST",
      body: { channel, code, newPassword },
    }),
};
