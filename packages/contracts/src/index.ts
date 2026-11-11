import { z } from "zod";
export { z };
export * from "./endpoints";
export * from "./errors";
export * from "./governance";
export * from "./kb";
export * from "./hrm";
export * from "./skill-generator";
export * from "./homepage";
export * from "./directory";
export * from "./skillhub";
export * from "./storage";
export * from "./mechanisms";
export * from "./project";
export * from "./growth";
export * from "./erp";
export * from "./party";
export * from "./mkt";
export * from "./recruit";
export * from "./seo";
export * from "./acquisition";
export * from "./collab";
export * from "./wecom-scrm";
export * from "./enterprise-gaps";
export * from "./extension";
export * from "./browser-task";
export * from "./chrome-rpa";
export * from "./ai";

export const apiEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.number(),
    message: z.string(),
    data: data.nullable(),
  });
export { pageQuerySchema, pageSchema, cursorPageSchema } from "./pagination";
import { pageQuerySchema } from "./pagination";
export type ApiResponse<T> = { code: number; message: string; data: T | null };
export type PageQuery = z.infer<typeof pageQuerySchema>;
export type PageResponse<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type CursorPage<T> = {
  list: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ApiErrorKind =
  "network" | "timeout" | "cancelled" | "http" | "business" | "protocol";
export class ApiError extends Error {
  readonly name = "ApiError";
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly code?: number,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  /** 勾选「30 天内自动登录」：会话令牌延长为 30 天，免重复输入。 */
  remember: z.boolean().optional(),
});
export const registerSchema = loginSchema.extend({
  nickname: z.string().trim().min(1),
  email: z.string().trim().email(),
  emailCode: z.string().trim().min(1),
  inviteCode: z.string().optional(),
  /** 勾选认可的协议（编码 + 版本），缺项/版本过期后端拒绝注册。 */
  terms: z
    .array(z.object({ code: z.string().min(1), version: z.string().min(1) }))
    .optional(),
});
export const tokenSchema = z.object({
  token: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
});
export type AuthTokens = z.infer<typeof tokenSchema>;

export function safeNextPath(raw?: string | null, fallback = "/") {
  return !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
    ? fallback
    : raw;
}

export function requestPath(path: string, query?: Record<string, unknown>) {
  const url = new URL(path, "http://request.invalid");
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.delete(key);
    for (const item of Array.isArray(value) ? value : [value])
      url.searchParams.append(key, String(item));
  }
  return `${url.pathname}${url.search}`;
}

export * from "./views";
export * from "./admin";
export * from "./automation";
export * from "./agent";
export * from "./mcp";
export * from "./content";
export * from "./mail";
export * from "./notifications";
export * from "./org-staff";
export * from "./service-desk";
export * from "./livecode";
export * from "./crm";
export * from "./bi";
export * from "./lowcode";
export * from "./okr";
export * from "./oa";
export * from "./question-hall";
export * from "./distribution";
export * from "./rich-text";
export * from "./help";
export * from "./model-plaza";
export * from "./im";
export * from "./community";
export * from "./video-templates";
export * from "./survey";
export * from "./hardware";
export * from "./moderation";
export * from "./task-center";
export * from "./task-assignment";
export * from "./ui-preferences";
export * from "./workflow";
export * from "./upgrade";
export * from "./ai-code";
export * from "./wechat-mp";
export { ContentEndpoints as contentEndpoints } from "./content";
