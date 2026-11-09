import {
  apiEnvelope,
  endpoints,
  scrmSidebarSchema,
  scrmSopTaskSchema,
  z,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/** 客户 360 等业务页只需按 CRM 客户反查企微联系人，避免引入整块 SCRM 界面模块。 */
export const scrmContactApi = {
  contacts: endpoint(endpoints.Scrm_contacts),
};

/**
 * 企微员工侧边栏（公开通道）：凭 URL 里的 2 小时票据访问，不走登录态，
 * 因此单独放在业务 API 层，页面不直接碰 HTTP 客户端。
 */

export type WecomScrmSidebar = z.infer<typeof scrmSidebarSchema>;
export type WecomScrmSidebarField = WecomScrmSidebar["fields"][number];
export type WecomScrmSidebarTask = WecomScrmSidebar["tasks"][number];
export type WecomScrmSidebarMaterial = WecomScrmSidebar["materials"][number];
export type WecomScrmSidebarContact = NonNullable<WecomScrmSidebar["contact"]>;

export async function fetchWecomScrmSidebar(ticket: string, contactId: number) {
  const query = contactId ? `?contactId=${contactId}` : "";
  const result = await http(
    `/api/public/wecom-scrm/sidebar/${encodeURIComponent(ticket)}${query}`,
    apiEnvelope(scrmSidebarSchema),
  );
  if (!result.data.data) throw new Error("侧边栏没有返回数据");
  return result.data.data;
}

export async function completeWecomScrmSidebarTask(
  ticket: string,
  body: { id: number; status: "DONE" | "SKIPPED"; result: string },
) {
  const result = await http(
    `/api/public/wecom-scrm/sidebar/${encodeURIComponent(ticket)}/tasks/complete`,
    apiEnvelope(scrmSopTaskSchema),
    { method: "POST", body },
  );
  if (!result.data.data) throw new Error("待办处理没有返回结果");
  return result.data.data;
}
