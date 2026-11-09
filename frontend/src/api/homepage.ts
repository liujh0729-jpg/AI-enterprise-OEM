import {
  apiEnvelope,
  homepageSettingsSchema,
  type HomepageSettings,
} from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

const envelope = apiEnvelope(homepageSettingsSchema);

async function unwrap(
  path: string,
  options: HttpOptions = {},
): Promise<HomepageSettings> {
  const result = await http(path, envelope, options);
  return result.data.data as HomepageSettings;
}

/** 官网首页配置：公开读取 + 平台管理员维护（系统设置 → 首页设置）。 */
export const homepageApi = {
  view: (options?: HttpOptions) => unwrap("/api/homepage", options),
  adminGet: (options?: HttpOptions) =>
    unwrap("/api/backend/enterprise/admin/homepage", options),
  adminSave: (body: HomepageSettings, options?: HttpOptions) =>
    unwrap("/api/backend/enterprise/admin/homepage", {
      ...options,
      method: "PUT",
      body,
    }),
};
