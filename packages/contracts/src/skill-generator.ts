import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });

/**
 * 平台管理员「生成 Skill」契约：
 * 目录直接从本系统 MCP 动作清单派生（随接口增加自动增长），
 * 生成按业务域逐个调用模型，产出根目录带 SKILL.md 的 zip 技能包。
 */

export const skillGeneratorOperationSchema = z
  .object({
    operationId: z.string(),
    label: z.string(),
    method: z.enum(["get", "post", "put", "patch", "delete"]),
    path: z.string(),
    write: z.boolean(),
  })
  .passthrough();
export type SkillGeneratorOperation = z.infer<
  typeof skillGeneratorOperationSchema
>;

export const skillGeneratorDomainSchema = z
  .object({
    domain: z.string(),
    label: z.string(),
    read: z.number(),
    write: z.number(),
    total: z.number(),
    operations: z.array(skillGeneratorOperationSchema),
  })
  .passthrough();
export type SkillGeneratorDomain = z.infer<typeof skillGeneratorDomainSchema>;

export const skillGeneratorCatalogSchema = z
  .object({
    /** 站点设置里的对外域名；未配置时为空，前端按当前访问域名兜底 */
    baseUrl: z.string(),
    siteConfigured: z.boolean(),
    endpointPath: z.string(),
    category: z.string(),
    /** SkillHub 发布入口（仅作为操作指引，不代表站内可代发布） */
    skillHubUrl: z.string(),
    domains: z.array(skillGeneratorDomainSchema),
  })
  .passthrough();
export type SkillGeneratorCatalog = z.infer<
  typeof skillGeneratorCatalogSchema
>;

export const generateSkillBodySchema = z.object({
  /** SkillHub 唯一标识（小写 slug）；多业务域批量生成时前端会追加业务域后缀 */
  name: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(60),
  /** 留空由模型正文首段生成 */
  description: z.string().trim().max(200).default(""),
  domain: z.string().trim().min(1).max(64),
  operationIds: z.array(z.string().trim().min(1)).min(1).max(200),
  /** 站点域名未配置时由前端传当前访问 origin 兜底 */
  baseUrl: z.string().trim().max(512).default(""),
});
export type GenerateSkillBody = z.infer<typeof generateSkillBodySchema>;

export const generatedSkillSchema = z
  .object({
    name: z.string(),
    displayName: z.string(),
    slug: z.string(),
    domain: z.string(),
    domainLabel: z.string(),
    category: z.string(),
    description: z.string(),
    operationCount: z.number(),
    model: z.string(),
    skillMarkdown: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    /** 标准 zip 的 base64；前端转 Blob 直接下载 */
    zipBase64: z.string(),
    filename: z.string(),
  })
  .passthrough();
export type GeneratedSkill = z.infer<typeof generatedSkillSchema>;

/** 开放集成 → Skill 页签：平台管理员生成并已入库的技能包摘要（不含 zip 字节）。 */
export const generatedSkillSummarySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    domain: z.string(),
    domainLabel: z.string(),
    category: z.string(),
    operationCount: z.number(),
    model: z.string(),
    filename: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export type GeneratedSkillSummary = z.infer<typeof generatedSkillSummarySchema>;

export const generatedSkillListSchema = z
  .object({
    rows: z.array(generatedSkillSummarySchema),
    total: z.number(),
  })
  .passthrough();
export type GeneratedSkillList = z.infer<typeof generatedSkillListSchema>;

export const skillGeneratorEndpoints = {
  /** 平台管理员：MCP 业务域与动作清单（生成器左右两栏的数据源）。 */
  Admin_skillGeneratorCatalog: {
    method: "get",
    path: "/enterprise/admin/skill-generator/catalog",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: envelope(skillGeneratorCatalogSchema),
  },
  /** 平台管理员：按一个业务域生成一个技能包（多域由前端逐个调用）。 */
  Admin_generateSkill: {
    method: "post",
    path: "/enterprise/admin/skill-generator/generate",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: generateSkillBodySchema,
    response: envelope(generatedSkillSchema),
  },
  /** 任意登录账号：平台管理员已生成的技能包清单（Skill 页签）。 */
  GeneratedSkill_list: {
    method: "get",
    path: "/enterprise/generated-skills",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: envelope(generatedSkillListSchema),
  },
} as const;
