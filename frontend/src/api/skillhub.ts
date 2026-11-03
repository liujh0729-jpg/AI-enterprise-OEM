import { endpoints, z } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

export const skillHubApi = {
  list: endpoint(endpoints.SkillHub_list),
  detail: endpoint(endpoints.SkillHub_detail),
  install: endpoint(endpoints.SkillHub_install),
  pluginList: endpoint(endpoints.SkillHub_pluginList),
  pluginDetail: endpoint(endpoints.SkillHub_pluginDetail),
  pluginInstall: endpoint(endpoints.SkillHub_pluginInstall),
  download: async (slug: string) => {
    const result = await http(
      `/api/backend/enterprise/skillhub/skills/${encodeURIComponent(slug)}/download`,
      z.any(),
      { responseType: "blob", timeoutMs: 120000 },
    );
    return result.data as Blob;
  },
};