import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * AIPDD APIKey 绑定接口（/enterprise/account/aipdd-key，N:1）：
 * 开源版本地能力，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 */
const BASE = "/api/backend/enterprise/account";

export interface AipddKeyStatus {
  bound: boolean;
  /** 已绑定时的脱敏串（sk-****abcd），永不回显原文。 */
  masked?: string;
  aipddUserId?: string;
  profile?: { username?: string; nickName?: string; avatar?: string } | null;
  boundAt?: string;
  lastVerifiedAt?: string | null;
  /** 同一把上游 Key 被多少个本地用户绑定。 */
  sharedWith?: number;
  /** 上游官网地址（引导注册用）。 */
  registerUrl: string;
  /** 管理员在站点设置配置的 AIPDD 推荐码；空串＝未配置，不展示引导。 */
  referralCode: string;
}

const statusSchema = apiEnvelope(z.unknown());

async function call<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const result = await http(path, statusSchema, options);
  return result.data.data as T;
}

export const aipddKeyApi = {
  status: (options?: HttpOptions) =>
    call<AipddKeyStatus>(`${BASE}/aipdd-key`, { ...options }),
  bind: (key: string, options?: HttpOptions) =>
    call<AipddKeyStatus>(`${BASE}/aipdd-key`, {
      ...options,
      method: "PUT",
      body: { key },
    }),
  unbind: (options?: HttpOptions) =>
    call<{ unbound: boolean }>(`${BASE}/aipdd-key`, {
      ...options,
      method: "DELETE",
    }),
};
