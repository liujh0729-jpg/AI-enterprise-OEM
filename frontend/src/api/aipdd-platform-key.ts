import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 平台级 AIPDD APIKey（/enterprise/admin/account/aipdd-platform-key）：
 * 管理员统一配置一次，供「基础数据」通道（省市字典、平台字典项）调用上游。
 * 开源版本地能力，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 */
const BASE = "/api/backend/enterprise/admin/account";

export interface AipddPlatformKeyStatus {
  configured: boolean;
  /** db＝后台已保存（库内密文）；env＝仅部署环境变量兜底；none＝未配置。 */
  source: "db" | "env" | "none";
  /** 脱敏串（sk-****abcd），接口永不回显原文。 */
  masked: string;
  updatedAt: string | null;
}

const statusSchema = apiEnvelope(z.unknown());

async function call<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const result = await http(path, statusSchema, options);
  return result.data.data as T;
}

export const aipddPlatformKeyApi = {
  view: (options?: HttpOptions) =>
    call<AipddPlatformKeyStatus>(`${BASE}/aipdd-platform-key`, { ...options }),
  save: (key: string, options?: HttpOptions) =>
    call<AipddPlatformKeyStatus>(`${BASE}/aipdd-platform-key`, {
      ...options,
      method: "PUT",
      body: { key },
    }),
  clear: (options?: HttpOptions) =>
    call<AipddPlatformKeyStatus>(`${BASE}/aipdd-platform-key`, {
      ...options,
      method: "DELETE",
    }),
};
