import { z } from "zod";
import {
  contentAgentPluginSchema,
  contentAgentSkillSchema,
} from "./content";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** SkillHub（api.skillhub.cn）公开技能目录：只读搜索、详情与安装。 */
export const skillHubSkillSchema = z.object({
  slug: z.string(),
  name: z.string(),
  summary: z.string().default(""),
  category: z.string().default(""),
  categoryLabel: z.string().default(""),
  downloads: z.number().default(0),
  stars: z.number().default(0),
  version: z.string().default(""),
  iconUrl: z.string().default(""),
  publisherName: z.string().default(""),
  publisherVerified: z.boolean().default(false),
  namespaceHandle: z.string().default(""),
  updatedAt: z.string().default(""),
});
export type SkillHubSkill = z.infer<typeof skillHubSkillSchema>;

export const skillHubSecuritySchema = z.object({
  name: z.string(),
  status: z.string().default(""),
  statusText: z.string().default(""),
});
export const skillHubVersionSchema = z.object({
  version: z.string().default(""),
  changelog: z.string().default(""),
  createdAt: z.string().default(""),
});
export const skillHubDetailSchema = skillHubSkillSchema.extend({
  summaryZh: z.string().default(""),
  overview: z.string().default(""),
  homepage: z.string().default(""),
  installs: z.number().default(0),
  security: z.array(skillHubSecuritySchema).default([]),
  versions: z.array(skillHubVersionSchema).default([]),
});
export type SkillHubDetail = z.infer<typeof skillHubDetailSchema>;

/** SkillHub 插件目录（api.skillhub.cn/api/v1/plugins）：上游是 GitHub 上的 DSH 插件仓库。 */
export const skillHubPluginSchema = z.object({
  /** owner/name，同时也是仓库全名 */
  slug: z.string(),
  name: z.string(),
  summary: z.string().default(""),
  category: z.string().default(""),
  categoryLabel: z.string().default(""),
  stars: z.number().default(0),
  forks: z.number().default(0),
  license: z.string().default(""),
  iconUrl: z.string().default(""),
  owner: z.string().default(""),
  homepage: z.string().default(""),
  repositoryUrl: z.string().default(""),
  version: z.string().default(""),
  updatedAt: z.string().default(""),
});
export type SkillHubPlugin = z.infer<typeof skillHubPluginSchema>;

export const skillHubPluginDetailSchema = skillHubPluginSchema.extend({
  /** owner/name */
  fullName: z.string().default(""),
  topics: z.array(z.string()).default([]),
  /** 仓库 README 原文（已限长）；详情页预览、安装后存成插件正文 */
  readme: z.string().default(""),
});
export type SkillHubPluginDetail = z.infer<
  typeof skillHubPluginDetailSchema
>;

export const skillHubEndpoints = {
  SkillHub_list: {
    method: "get" as const,
    path: "/enterprise/skillhub/skills",
    params: z.object({}),
    query: z.object({
      keyword: z.string().max(120).default(""),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(16),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        list: z.array(skillHubSkillSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
      }),
    ),
  },
  SkillHub_detail: {
    method: "get" as const,
    path: "/enterprise/skillhub/skills/:slug",
    params: z.object({ slug: z.string().min(1).max(120) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(skillHubDetailSchema),
  },
  SkillHub_install: {
    method: "post" as const,
    path: "/enterprise/skillhub/skills/:slug/install",
    params: z.object({ slug: z.string().min(1).max(120) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentAgentSkillSchema),
  },
  SkillHub_pluginList: {
    method: "get" as const,
    path: "/enterprise/skillhub/plugins",
    params: z.object({}),
    query: z.object({
      /** 不传＝按 Star 降序的热门榜；传了＝按关键词搜索（上游参数名是 q）。 */
      keyword: z.string().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(16),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        list: z.array(skillHubPluginSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
      }),
    ),
  },
  SkillHub_pluginDetail: {
    method: "get" as const,
    path: "/enterprise/skillhub/plugins/:owner/:name",
    params: z.object({
      owner: z.string().min(1).max(64),
      name: z.string().min(1).max(100),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(skillHubPluginDetailSchema),
  },
  SkillHub_pluginInstall: {
    method: "post" as const,
    path: "/enterprise/skillhub/plugins/:owner/:name/install",
    params: z.object({
      owner: z.string().min(1).max(64),
      name: z.string().min(1).max(100),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(contentAgentPluginSchema),
  },
};
