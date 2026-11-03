import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 账户自助接口（开源版新增的本地接口）：目前只用于语言偏好同步——
 * 界面语言切换后把语言码写回账号（users.lang），作为跨设备的偏好记录。
 */
const profileSchema = apiEnvelope(
  z
    .object({
      id: z.string(),
      username: z.string(),
      lang: z.string().optional(),
    })
    .passthrough(),
);

export const accountApi = {
  /** 保存当前账号的界面语言码（fire-and-forget 场景失败不打扰用户）。 */
  saveLang: (lang: string, options?: HttpOptions) =>
    http(
      "/api/backend/enterprise/account/profile",
      profileSchema,
      { ...options, method: "PUT", body: { lang } },
    ),
};
