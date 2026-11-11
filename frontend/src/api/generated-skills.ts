import { endpoints, z } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/** 模型服务 → API-MCP-Skill → Skill：平台管理员生成并入库的技能包。 */
export type GeneratedSkillSummary = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"GeneratedSkill_list">["data"]
>["rows"][number];

export const generatedSkillApi = {
  list: endpoint(endpoints.GeneratedSkill_list),
  download: async (id: number) => {
    const result = await http(
      `/api/backend/enterprise/generated-skills/${encodeURIComponent(String(id))}/download`,
      z.any(),
      { responseType: "blob", timeoutMs: 120_000 },
    );
    return result.data as Blob;
  },
};
