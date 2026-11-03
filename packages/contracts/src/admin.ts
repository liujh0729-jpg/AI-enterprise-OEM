import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";
import { providerApplicationSchema } from "./directory";
import { adminContractSchema, capabilityMatrixRowSchema } from "./views";

export const providerManagedSchema = z.object({
  userId: z.string(),
  nickname: z.string(),
  org: z.string(),
  services: z.array(
    z.object({
      type: z.string(),
      status: z.string(),
      auditedAt: z.string().nullable(),
      auditNote: z.string(),
    }),
  ),
});
export const capabilityRequestSchema = z.object({
  id: z.number(),
  enterpriseId: z.number(),
  enterpriseName: z.string(),
  code: z.string(),
  label: z.string(),
  status: z.string(),
  note: z.string(),
  requestedByName: z.string(),
  updatedAt: z.string(),
  /** 企业税号：平台在「财税管理」按此匹配企享云 API Key。 */
  taxNo: z.string().optional(),
  /** 已匹配的企享云账号名称（未匹配为空串）。 */
  qxyAccountName: z.string().optional(),
  /** 服务商提交审核时填写的开通时间（YYYY-MM-DD）。 */
  opensAt: z.string().optional(),
});
export const adminApplicationSchema = providerApplicationSchema.extend({
  owner_name: z.string(),
  username: z.string(),
  itemAudits: z
    .array(
      z.object({
        item: z.string().optional(),
        status: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
});
const pageEndpoint = <T extends z.ZodType>(path: string, schema: T) => ({
  method: "get" as const,
  path,
  params: z.object({}),
  query: pageQuerySchema,
  body: z.undefined(),
  response: z.object({
    code: z.number(),
    message: z.string(),
    data: pageSchema(schema).nullable(),
  }),
});
export const adminUserSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string(),
  role: z.string(),
  enabled: z.number(),
  syncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 自己的邀请码（存量未生成时为空串）。 */
  inviteCode: z.string().optional(),
  /** 邀请人用户名（非邀请注册为空串）。 */
  invitedByUsername: z.string().optional(),
});
export const adminPageEndpoints = {
  Admin_providerStats: {
    method: "get" as const,
    path: "/enterprise/admin/providers/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z.object({ serviceTotal: z.number() }).nullable(),
    }),
  },
  Admin_users: {
    method: "get" as const,
    path: "/enterprise/admin/users",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z.array(adminUserSchema).nullable(),
    }),
  },
  Admin_contractPage: {
    ...pageEndpoint("/enterprise/admin/contracts/page", adminContractSchema),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
  },
  Admin_appPage: pageEndpoint(
    "/enterprise/admin/provider-applications/page",
    adminApplicationSchema,
  ),
  Admin_providerPage: pageEndpoint(
    "/enterprise/admin/providers/page",
    providerManagedSchema,
  ),
  Admin_capabilityPage: pageEndpoint(
    "/enterprise/admin/enterprises/capabilities/page",
    capabilityMatrixRowSchema,
  ),
  Admin_requestPage: pageEndpoint(
    "/enterprise/admin/capability-requests/page",
    capabilityRequestSchema,
  ),
};
export type ProviderManagedRow = z.infer<typeof providerManagedSchema>;
export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;
