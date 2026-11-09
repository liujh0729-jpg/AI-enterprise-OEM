import { endpoints } from "@enterprise/contracts";
import type { HttpOptions } from "./http";
import { endpoint } from "./endpoint";

/** 平台管理员「生成 Skill」：目录随 MCP 动作自动增长，生成按业务域逐个调用。 */
export type SkillGeneratorCatalog = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Admin_skillGeneratorCatalog">["data"]
>;
export type SkillGeneratorDomain = SkillGeneratorCatalog["domains"][number];
export type SkillGeneratorOperation = SkillGeneratorDomain["operations"][number];
export type GeneratedSkill = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Admin_generateSkill">["data"]
>;

const generate = endpoint(endpoints.Admin_generateSkill);

export const skillGeneratorApi = {
  catalog: endpoint(endpoints.Admin_skillGeneratorCatalog),
  /** 模型生成是长任务（后端超时 120 秒），前端单独放宽到 180 秒。 */
  generate: (
    body: import("@enterprise/contracts").GenerateSkillBody,
    options: HttpOptions = {},
  ) => generate({ body }, { timeoutMs: 180_000, ...options }),
};
