import {
  apiEnvelope,
  contentAgentPluginSchema,
  contentAgentSkillSchema,
  contentDigitalAssetSchema,
  endpoints,
  z,
} from "@enterprise/contracts";
import type {
  ContentAgentMode,
  ContentAgentReference,
  ContentDigitalAsset,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http, streamSse, uploadFormTo } from "./http";

export const contentApi = {  settings: endpoint(endpoints.Content_settings),
  saveSettings: endpoint(endpoints.Content_saveSettings),
  saveChannel: endpoint(endpoints.Content_saveChannel),
  removeChannel: endpoint(endpoints.Content_removeChannel),
  testChannel: endpoint(endpoints.Content_testChannel),
  models: endpoint(endpoints.Content_models),
  assets: endpoint(endpoints.Content_assets),
  registerAsset: endpoint(endpoints.Content_registerAsset),
  jobs: endpoint(endpoints.Content_jobs),
  createJob: endpoint(endpoints.Content_createJob),
  job: endpoint(endpoints.Content_job),
  cancelJob: endpoint(endpoints.Content_cancelJob),
  retryJob: endpoint(endpoints.Content_retryJob),
  canvases: endpoint(endpoints.Content_canvases),
  createCanvas: endpoint(endpoints.Content_createCanvas),
  canvas: endpoint(endpoints.Content_canvas),
  saveCanvas: endpoint(endpoints.Content_saveCanvas),
  renameCanvas: endpoint(endpoints.Content_renameCanvas),
  deleteCanvas: endpoint(endpoints.Content_deleteCanvas),
  runCanvasNode: endpoint(endpoints.Content_runCanvasNode),
  copyCanvasNode: endpoint(endpoints.Content_copyCanvasNode),
  conversations: endpoint(endpoints.Content_conversations),
  createConversation: endpoint(endpoints.Content_createConversation),
  updateConversation: endpoint(endpoints.Content_updateConversation),
  removeConversation: endpoint(endpoints.Content_removeConversation),
  messages: endpoint(endpoints.Content_messages),
  skills: endpoint(endpoints.Content_skills),
  toggleSkill: endpoint(endpoints.Content_toggleSkill),
  removeSkill: endpoint(endpoints.Content_removeSkill),
  skillRevisions: endpoint(endpoints.Content_skillRevisions),
  restoreSkill: endpoint(endpoints.Content_restoreSkill),
  plugins: endpoint(endpoints.Content_plugins),
  togglePlugin: endpoint(endpoints.Content_togglePlugin),
  removePlugin: endpoint(endpoints.Content_removePlugin),
  pluginRevisions: endpoint(endpoints.Content_pluginRevisions),
  restorePlugin: endpoint(endpoints.Content_restorePlugin),
  experts: endpoint(endpoints.Content_experts),
  createExpert: endpoint(endpoints.Content_createExpert),
  removeExpert: endpoint(endpoints.Content_removeExpert),
  connectors: endpoint(endpoints.Content_connectors),
  createConnector: endpoint(endpoints.Content_createConnector),
  updateConnector: endpoint(endpoints.Content_updateConnector),
  removeConnector: endpoint(endpoints.Content_removeConnector),
  testConnector: endpoint(endpoints.Content_testConnector),
  memories: endpoint(endpoints.Content_memories),
  saveMemories: endpoint(endpoints.Content_saveMemories),
  personas: endpoint(endpoints.Content_personas),
  createPersona: endpoint(endpoints.Content_createPersona),
  updatePersona: endpoint(endpoints.Content_updatePersona),
  deletePersona: endpoint(endpoints.Content_deletePersona),
  library: endpoint(endpoints.Content_library),
  libraryAdd: endpoint(endpoints.Content_libraryAdd),
  libraryRemove: endpoint(endpoints.Content_libraryRemove),
  libraryNodes: endpoint(endpoints.Content_libraryNodes),
  librarySearch: endpoint(endpoints.Content_librarySearch),
  libraryPublish: endpoint(endpoints.Content_libraryPublish),
  libraryDrafts: endpoint(endpoints.Content_libraryDrafts),
  libraryDraftDecide: endpoint(endpoints.Content_libraryDraftDecide),
  schedules: endpoint(endpoints.Content_schedules),
  saveSchedule: endpoint(endpoints.Content_saveSchedule),
  updateSchedule: endpoint(endpoints.Content_updateSchedule),
  removeSchedule: endpoint(endpoints.Content_removeSchedule),
  scheduleRuns: endpoint(endpoints.Content_scheduleRuns),
  runScheduleNow: endpoint(endpoints.Content_runScheduleNow),
  assistantChannels: endpoint(endpoints.Content_assistantChannels),
  saveAssistantChannel: endpoint(endpoints.Content_saveAssistantChannel),
  updateAssistantChannel: endpoint(endpoints.Content_updateAssistantChannel),
  removeAssistantChannel: endpoint(endpoints.Content_removeAssistantChannel),
  testAssistantChannel: endpoint(endpoints.Content_testAssistantChannel),
  assistantMessages: endpoint(endpoints.Content_assistantMessages),
  digitalAssets: endpoint(endpoints.Content_digitalAssets),
  digitalAssetLabels: endpoint(endpoints.Content_digitalAssetLabels),
  tagDigitalAsset: endpoint(endpoints.Content_tagDigitalAsset),
  deleteDigitalAsset: endpoint(endpoints.Content_deleteDigitalAsset),
  extractDigitalAsset: endpoint(endpoints.Content_extractDigitalAsset),
  autoTagDigitalAsset: endpoint(endpoints.Content_autoTagDigitalAsset),
  similarDigitalAssets: endpoint(endpoints.Content_similarDigitalAssets),
  moderateDigitalAsset: endpoint(endpoints.Content_moderateDigitalAsset),
  presignDigitalAsset: endpoint(endpoints.Content_presignDigitalAsset),
  registerDigitalAsset: endpoint(endpoints.Content_registerDigitalAsset),
  sharedAssets: endpoint(endpoints.Content_sharedAssets),
  shareTargets: endpoint(endpoints.Content_shareTargets),
  shareAsset: endpoint(endpoints.Content_shareAsset),
  unshareAsset: endpoint(endpoints.Content_unshareAsset),
  // 视频模版社区
  videoTemplates: endpoint(endpoints.VideoTemplate_list),
  videoTemplate: endpoint(endpoints.VideoTemplate_detail),
  viewVideoTemplate: endpoint(endpoints.VideoTemplate_view),
  publishVideoTemplate: endpoint(endpoints.VideoTemplate_publish),
  removeVideoTemplate: endpoint(endpoints.VideoTemplate_remove),
  favoriteVideoTemplate: endpoint(endpoints.VideoTemplate_favorite),
  unfavoriteVideoTemplate: endpoint(endpoints.VideoTemplate_unfavorite),
  rateVideoTemplate: endpoint(endpoints.VideoTemplate_rate),
  generateVideoTemplate: endpoint(endpoints.VideoTemplate_generate),
  videoTemplateAdminSettings: endpoint(endpoints.VideoTemplateAdmin_settings),
  saveVideoTemplateAdminSettings: endpoint(endpoints.VideoTemplateAdmin_saveSettings),
  syncVideoTemplateAdmin: endpoint(endpoints.VideoTemplateAdmin_sync),
};

/** 提交生成（画布节点 / 三个工作台共用）：走 /jobs，统一按数组返回，单条调用取第一条。 */
export async function createContentJobs(body: Record<string, unknown>) {
  const result = await contentApi.createJob({ body });
  return Array.isArray(result) ? result : result ? [result] : [];
}

/** 画布节点跑一次生成：服务端按连线翻译成工具与参数，返回本次 runId 与任务。 */
export async function runCanvasNode(
  canvasId: number,
  nodeId: string,
  body: Record<string, unknown> = {},
) {
  return contentApi.runCanvasNode({
    params: { id: String(canvasId), nodeId },
    body,
  });
}

/** 撞到 200 节点上限时的过渡能力：把节点复制到另一张自己的画布。 */
export async function copyCanvasNode(
  canvasId: number,
  nodeId: string,
  targetCanvasId: number,
) {
  return contentApi.copyCanvasNode({
    params: { id: String(canvasId), nodeId },
    body: { targetCanvasId },
  });
}


const uploadResultSchema = z.object({
  url: z.string(),
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
  kind: z.string(),
});
const uploadResponseSchema = apiEnvelope(uploadResultSchema);

export type ContentUploadResult = z.infer<typeof uploadResultSchema>;

/** zip 技能包上传：包内需有 SKILL.md，其余文本文件一并存进技能。 */
export async function importSkillPackage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    "/api/backend/enterprise/content/agent/skills/import",
    apiEnvelope(contentAgentSkillSchema),
    { method: "POST", body: form, timeoutMs: 120000 },
  );
  return result.data.data;
}

/** zip 插件包上传：包内需有 plugin.json 或 PLUGIN.md，其余文本文件一并存进插件。 */
export async function importPluginPackage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    "/api/backend/enterprise/content/agent/plugins/import",
    apiEnvelope(contentAgentPluginSchema),
    { method: "POST", body: form, timeoutMs: 120000 },
  );
  return result.data.data;
}

/**
 * 素材上传（multipart）：后端转存 AIPDD 数字资产云后回公网直链。
 * 走统一传输层（FormData 由 http() 原样发送），失败按业务码给出中文原因。
 */
export async function uploadContentMedia(
  file: File,
): Promise<ContentUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    "/api/backend/enterprise/content/uploads",
    uploadResponseSchema,
    { method: "POST", body: form, timeoutMs: 180000 },
  );
  if (!result.data.data) throw new Error("素材上传没有返回结果");
  return result.data.data;
}
/** Agent 对话流：SSE 事件由调用方按 event 名处理（delta/tool_start/tool_end/notice/done/error）。 */
export function streamAgentMessage(
  conversationId: number,
  content: string,
  options: {
    signal?: AbortSignal;
    references?: ContentAgentReference[];
    /** 本轮选的渠道（模型设置里的 channelId；0＝AIPDD）；不传＝沿用文本槽位 */
    channelId?: number;
    /** 本轮选的模型；不传且渠道与文本槽位一致时用槽位默认模型 */
    model?: string;
    mode?: ContentAgentMode;
    /** 图片模式本轮选的图片模型（先选渠道再选模型） */
    imageChannelId?: number;
    imageModel?: string;
    /** 视频模式本轮选的视频模型 */
    videoChannelId?: number;
    videoModel?: string;
    /** 视频模式勾了「超清」时的目标分辨率（1080p / 2k / 4k） */
    videoUpscaleResolution?: string;
    imageSize?: string;
    videoResolution?: string;
    videoDuration?: number;
    /** 输入区 + 浮层里勾选的技能（只对这一轮生效；不传＝全部启用中的技能） */
    skillIds?: number[];
    /** 输入区 + 浮层里勾选的插件（只对这一轮生效；不传＝全部启用中的插件） */
    pluginIds?: number[];
    /** 输入区 + 浮层里勾选的资料（只对这一轮生效：检索与精读只在这几篇里） */
    libraryIds?: number[];
    /** 输入区 + 浮层里勾选的 MCP 连接器（只对这一轮生效；不传＝全部启用中的） */
    connectorIds?: number[];
    /** 本轮用的数字分身（0＝自动；不传＝沿用会话上记住的那个） */
    personaId?: number;
    /** 多分身协作：传 2–3 个分身 id，先各自起草再互相评审，最后由第一位汇总 */
    personaIds?: number[];
    /** 嵌入式副驾：当前模块 / 记录 / 页面摘要；allowWrite=false 时业务写工具会被拒绝 */
    copilot?: {
      module: string;
      moduleLabel?: string;
      recordId?: string;
      recordLabel?: string;
      context?: string;
      allowWrite?: boolean;
    };
    /** 本轮标识：同一会话可以并发多轮，停止按这个键只停对应那一轮 */
    runId?: string;
    onEvent: (event: { event: string; data: string }) => void;
  },
) {
  return streamSse(
    `/api/backend/enterprise/content/agent/conversations/${conversationId}/messages`,
    {
      body: {
        content,
        channelId: options.channelId,
        model: options.model || "",
        mode: options.mode || "text",
        references: options.references || [],
        imageChannelId: options.imageChannelId ?? -1,
        imageModel: options.imageModel || "",
        videoChannelId: options.videoChannelId ?? -1,
        videoModel: options.videoModel || "",
        videoUpscaleResolution: options.videoUpscaleResolution || "",
        imageSize: options.imageSize || "",
        videoResolution: options.videoResolution || "",
        videoDuration: options.videoDuration || 0,
        skillIds: options.skillIds || [],
        pluginIds: options.pluginIds || [],
        libraryIds: options.libraryIds || [],
        connectorIds: options.connectorIds || [],
        personaId: options.personaId ?? -1,
        personaIds: options.personaIds || [],
        copilot: options.copilot
          ? { ...options.copilot, allowWrite: options.copilot.allowWrite === true }
          : undefined,
        runId: options.runId || "",
      },
      signal: options.signal,
      onEvent: options.onEvent,
    },
  );
}

/** 停止某一轮生成（服务端按 runId 找 AbortController）+ 本地断流。 */
export async function cancelAgentMessage(conversationId: number, runId?: string) {
  await http(
    `/api/backend/enterprise/content/agent/conversations/${conversationId}/cancel`,
    apiEnvelope(z.object({ canceled: z.boolean() })),
    { method: "POST", body: { runId: runId || "" } },
  );
}

/** 数字资产上传：后端转存平台并立即登记，返回平台上的资产条目。 */
export async function uploadDigitalAsset(
  file: File,
  meta: { type: string; name?: string; labels?: string[] },
): Promise<ContentDigitalAsset> {
  const form = new FormData();
  form.append("file", file);
  form.append("type", meta.type);
  if (meta.name) form.append("name", meta.name);
  if (meta.labels?.length) form.append("labels", JSON.stringify(meta.labels));
  const result = await http(
    "/api/backend/enterprise/content/digital-assets/upload",
    apiEnvelope(contentDigitalAssetSchema),
    { method: "POST", body: form, timeoutMs: 300000 },
  );
  if (!result.data.data) throw new Error("资产上传没有返回结果");
  return result.data.data;
}

/**
 * 浏览器直传：先取 OSS 表单签名，把字节直接传进桶，再登记台账（服务端会 stat 核对）。
 * 桶没配 CORS / 未启用 OSS 时抛错，由调用方回落服务器中转上传。
 */
export async function uploadDigitalAssetDirect(
  file: File,
  meta: { type: string; name?: string; labels?: string[] },
): Promise<ContentDigitalAsset> {
  const presign = await contentApi.presignDigitalAsset({
    body: {
      filename: file.name,
      type: meta.type,
      size: file.size,
    },
  });
  if (!presign) throw new Error("直传签名没有返回结果，已改用服务器上传");
  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    form.append(key, value);
  }
  form.append("file", file);
  const response = await uploadFormTo(presign.url, form);
  if (!response.ok) {
    throw new Error(`直传失败（HTTP ${response.status}），已改用服务器上传`);
  }
  const asset = await contentApi.registerDigitalAsset({
    body: {
      key: presign.key,
      filename: file.name,
      name: meta.name,
      type: meta.type,
      labels: meta.labels,
    },
  });
  if (!asset) throw new Error("直传登记没有返回结果");
  return asset;
}
