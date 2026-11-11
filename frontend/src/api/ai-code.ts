import {
  AI_CODE_CONFIRM_TEXT,
  apiEnvelope,
  endpoints,
  z,
  type AiCodeEdit,
  type AiCodeEditsResult,
  type AiCodeExportResult,
  type AiCodeMessage,
  type AiCodeModel,
  type AiCodeOverview,
  type AiCodeSession,
  type AiCodeSessionDetail,
  type AiCodeUnlockResult,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http, streamSse, type SseEvent } from "./http";

/**
 * AI 编程（平台后台自助改码）API：全部经契约端点，除 SSE 对话与附件上传、下载
 * （流式 / multipart / 二进制不适合 JSON 契约，留在传输层包装）。
 */

export type {
  AiCodeEdit,
  AiCodeEditsResult,
  AiCodeExportResult,
  AiCodeMessage,
  AiCodeModel,
  AiCodeOverview,
  AiCodeSession,
  AiCodeSessionDetail,
  AiCodeUnlockResult,
};

export { AI_CODE_CONFIRM_TEXT };

export const aiCodeApi = {
  overview: endpoint(endpoints.AdminAiCode_overview),
  unlock: endpoint(endpoints.AdminAiCode_unlock),
  models: endpoint(endpoints.AdminAiCode_models),
  sessions: endpoint(endpoints.AdminAiCode_sessions),
  createSession: endpoint(endpoints.AdminAiCode_createSession),
  session: endpoint(endpoints.AdminAiCode_session),
  edits: endpoint(endpoints.AdminAiCode_edits),
  approve: endpoint(endpoints.AdminAiCode_approve),
  revert: endpoint(endpoints.AdminAiCode_revert),
  export: endpoint(endpoints.AdminAiCode_export),
  apply: endpoint(endpoints.AdminAiCode_apply),
};

/** SSE 事件：模型增量输出、工具调用起止、提示、结束与错误。 */
export type AiCodeStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_progress"; name: string; text: string; waitedSeconds: number }
  | { type: "tool_end"; name: string; ok: boolean; text: string }
  | { type: "message"; id: number; role: string }
  | { type: "notice"; text: string }
  | { type: "done"; id: number; text: string }
  | { type: "error"; message: string };

/** 对话：POST 到 SSE 路由，逐条解析为业务事件。 */
export function streamChat(
  sessionId: number,
  body: { content: string; references: { name: string; url: string }[] },
  onEvent: (event: AiCodeStreamEvent) => void,
  signal?: AbortSignal,
) {
  return streamSse(
    `/api/backend/enterprise/admin/ai-code/sessions/${sessionId}/messages`,
    {
      body,
      signal,
      onEvent: (event: SseEvent) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        onEvent({ type: event.event, ...data } as AiCodeStreamEvent);
      },
    },
  );
}

/** 上传参考图 / 文件（multipart）：落会话附件目录，返回可引用的名称与地址。 */
export async function uploadAiCodeFile(sessionId: number, file: File) {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    `/api/backend/enterprise/admin/ai-code/sessions/${sessionId}/upload`,
    apiEnvelope(
      z.object({
        name: z.string(),
        storedName: z.string(),
        url: z.string(),
        mime: z.string(),
        bytes: z.number(),
      }),
    ),
    { method: "POST", body: form, timeoutMs: 120000 },
  );
  return result.data.data;
}

/** 下载导出的补丁包（tar.gz）：字节流不进 JSON 契约，读成 Blob 后触发下载。 */
export async function downloadAiCodePatch(url: string, fileName: string) {
  const result = await http(url, z.any(), {
    responseType: "blob",
    timeoutMs: 300_000,
  });
  const blob = result.data as Blob;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
