import { apiEnvelope, endpoints, z } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/**
 * 创意社区（Comfy Cloud 工作流市场）。
 *
 * 运行永远发生在上游 Comfy Cloud，用的是本账号自己绑定的 API Key 与自己的 Comfy 积分：
 * `run` 里可能夹着「取输入图 → 上传成 Comfy 资产 → 提交作业」多次外呼，因此超时给得比默认宽；
 * 作业进度由站内调度器落库，前端只读 `runStatus`，不直接碰上游（上游签名 URL 短命且需要鉴权）。
 */
export const communityApi = {
  categories: endpoint(endpoints.Community_categories),
  list: endpoint(endpoints.Community_list),
  detail: endpoint(endpoints.Community_detail),
  favorite: endpoint(endpoints.Community_favorite),
  unfavorite: endpoint(endpoints.Community_unfavorite),
  like: endpoint(endpoints.Community_like),
  connectStatus: endpoint(endpoints.Community_connectStatus),
  saveCredential: endpoint(
    endpoints.Community_saveCredential,
    { timeoutMs: 60000 },
  ),
  testCredential: endpoint(
    endpoints.Community_testCredential,
    { timeoutMs: 60000 },
  ),
  clearCredential: endpoint(endpoints.Community_clearCredential),
  run: endpoint(endpoints.Community_run, { timeoutMs: 180000 }),
  runStatus: endpoint(endpoints.Community_runStatus),
  cancelRun: endpoint(endpoints.Community_cancelRun),
  myRuns: endpoint(endpoints.Community_myRuns),
  myDrafts: endpoint(endpoints.Community_myDrafts),
  publish: endpoint(endpoints.Community_publish, { timeoutMs: 90000 }),
  updateWorkflow: endpoint(endpoints.Community_updateWorkflow, {
    timeoutMs: 90000,
  }),
  unpublish: endpoint(endpoints.Community_unpublish),
};

/** 平台后台「创意社区」：待审队列、审核决定、统计、积分规则与 Comfy Cloud 迁移。 */
export const communityAdminApi = {
  pending: endpoint(endpoints.CommunityAdmin_pending),
  decide: endpoint(endpoints.CommunityAdmin_decide),
  stats: endpoint(endpoints.CommunityAdmin_stats),
  settings: endpoint(endpoints.CommunityAdmin_settings),
  saveSettings: endpoint(endpoints.CommunityAdmin_saveSettings),
  // 预览要真打上游列表，迁移还要读工作流文件，两个都给足超时（真正下载在后台任务里）
  importPreview: endpoint(endpoints.CommunityAdmin_importPreview, {
    timeoutMs: 120000,
  }),
  importStart: endpoint(endpoints.CommunityAdmin_importStart, {
    timeoutMs: 180000,
  }),
  importStatus: endpoint(endpoints.CommunityAdmin_importStatus),
};

const inputUploadSchema = apiEnvelope(
  z.object({ key: z.string(), url: z.string(), size: z.number() }),
);

/**
 * 运行参数里的输入图上传（multipart）：落本站对象存储，回一个本站直链。
 * 后端只认本站桶域名（拿运行入口当任意外链代理是明确禁止的），
 * 所以这里不能改用「素材上传」那条走 AIPDD 数字资产云的通道。
 */
export async function uploadCommunityInput(file: File) {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    "/api/backend/enterprise/community/uploads",
    inputUploadSchema,
    { method: "POST", body: form, timeoutMs: 120000 },
  );
  if (!result.data.data) throw new Error("图片上传没有返回结果");
  return result.data.data;
}
