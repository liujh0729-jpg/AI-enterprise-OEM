import { endpoints, z } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";
import {
  isTrustedExtensionMessage,
  pingExtension,
  sendBrowserTask,
  type BrowserTaskAck,
  type ExtensionPing,
} from "@/lib/extension-bridge";

export { isTrustedExtensionMessage, pingExtension };
export type { ExtensionPing };

/**
 * 多平台内容分发的界面层：台账 CRUD / 分发标记 / 结果回写都走 /enterprise/distribution/*（登录态）。
 * 与 AIPDD Enterprise 浏览器插件的通信统一走「能力 + 动作 + 参数」通道（§10.7）：
 *   页面 → 插件：window.postMessage({ source: 'aipdd-page', type: 'task', jobId, task: { capability, action, payload } })
 *   插件 → 页面：window.postMessage({ source: 'aipdd-extension', type: 'receipt', receipt: { ... } })
 * 效果回读仍走 metrics 通道（只回数据、不终结任务），旧消息名的回执继续兼容识别，避免台账双份/漏记。
 */

export const distributionApi = {
  meta: endpoint(endpoints.Distribution_meta),
  page: endpoint(endpoints.Distribution_page),
  create: endpoint(endpoints.Distribution_create),
  update: endpoint(endpoints.Distribution_update),
  remove: endpoint(endpoints.Distribution_remove),
  detail: endpoint(endpoints.Distribution_detail),
  mark: endpoint(endpoints.Distribution_mark),
  reportLogs: endpoint(endpoints.Distribution_reportLogs),
  reportMetrics: endpoint(endpoints.Distribution_reportMetrics),
};

/** 一次分发任务的载荷：与插件 background 的 AIPDD_DISTRIBUTE payload 同构。 */
export type DistributePayload = {
  /** 台账内容 ID：插件把结果连同它一起回传/入本地队列，页面据此把回执落回对应内容。 */
  contentId: number;
  title: string;
  content: string;
  images: { name: string; url: string }[];
  platformCodes: string[];
  autoPublish: boolean;
};

/**
 * 一条分发效果（D8）：插件发布完成后从平台创作中心读到的阅读/点赞/评论。
 * publishedItemId 是平台侧作品标识，服务端按「内容+平台」定位行覆盖写，重复上报天然幂等。
 */
export type MetricEntry = {
  platformCode: string;
  publishedItemId: string;
  views: number;
  likes: number;
  comments: number;
  capturedAt: string;
};

/** 插件本地队列里的一条待补回执：内容 ID + jobId + 逐平台结果，落库成功后按 jobId 清队。 */
export type PendingReceipt = {
  jobId: string;
  contentId: number;
  logs: {
    platformCode: string;
    status: string;
    publishedUrl: string;
    errorMsg: string;
  }[];
};

function randomJobId(capability = "distribution") {
  return `${capability}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 插件逐平台结果（两种通道同构）：页面按「内容 + 平台」幂等落库。 */
export type ExtensionLog = PendingReceipt["logs"][number];

/** 回执逐条结果 → 台账日志：平台、状态、链接、错误原因。 */
function logsOfResults(results: Record<string, unknown>[]): ExtensionLog[] {
  return results
    .map((item) => ({
      platformCode: String(item?.platformCode ?? item?.platform ?? ""),
      status: String(item?.status ?? ""),
      publishedUrl: String(item?.publishedUrl ?? item?.url ?? ""),
      errorMsg: String(item?.errorMsg ?? ""),
    }))
    .filter((item) => item.platformCode !== "");
}

/**
 * 把任务推给插件：走统一「能力 + 动作 + 参数」通道（动作：自动发布=publish，只填不发布=fill）。
 * 接单应答同步返回；逐平台结果由 onExtensionResult 异步送达（统一回执优先，旧消息名兼容）。
 */
export async function distributeViaExtension(
  payload: DistributePayload,
  timeoutMs = 10000,
): Promise<BrowserTaskAck> {
  return sendBrowserTask(
    {
      capability: "distribution",
      action: payload.autoPublish ? "publish" : "fill",
      platforms: payload.platformCodes,
      source: `distribution:#${payload.contentId}`,
      payload: {
        contentId: payload.contentId,
        title: payload.title,
        content: payload.content,
        images: payload.images,
        platformCodes: payload.platformCodes,
        autoPublish: payload.autoPublish,
      },
    },
    { timeoutMs, jobId: randomJobId() },
  );
}

/** 插件回执里的逐平台结果：入站 postMessage 不可信，按协议校验后再交给调用方。 */
const extensionResultSchema = z.object({
  type: z.literal("result"),
  jobId: z.string().default(""),
  // 页面关过再开时 pendingMapRef 已清空，靠插件回传的 contentId 仍能把结果落回台账。
  contentId: z.number().default(0),
  logs: z
    .array(
      z.object({
        platformCode: z.string(),
        status: z.string(),
        publishedUrl: z.string().default(""),
        errorMsg: z.string().default(""),
      }),
    )
    .default([]),
});

/** 监听插件回送的分发结果：统一回执（task/receipt）优先，旧消息名（result）继续兼容识别。 */
export function onExtensionResult(
  handler: (
    logs: ExtensionLog[],
    jobId: string,
    contentId: number,
  ) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isTrustedExtensionMessage(event)) return;
    const data = event.data as Record<string, unknown>;
    // 旧消息名：插件旧版本或补传路径仍按 result 回送。
    if (data?.type === "result") {
      const legacy = extensionResultSchema.safeParse(data);
      if (legacy.success) handler(legacy.data.logs, legacy.data.jobId, legacy.data.contentId);
      return;
    }
    if (data?.type !== "receipt") return;
    const receipt = data.receipt as Record<string, unknown> | undefined;
    if (!receipt || receipt.capability !== "distribution") return;
    const payload = (receipt.data ?? {}) as Record<string, unknown>;
    handler(
      logsOfResults(Array.isArray(receipt.results) ? (receipt.results as Record<string, unknown>[]) : []),
      String(receipt.jobId || ""),
      Number(payload.contentId) || 0,
    );
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** 插件本地队列里待补传的回执：落库后要按 jobId 回执清队，入站同样按协议校验。 */
const pendingReceiptsSchema = z.object({
  type: z.literal("receipts"),
  ok: z.boolean().default(false),
  items: z
    .array(
      z.object({
        jobId: z.string().default(""),
        contentId: z.number().default(0),
        logs: z
          .array(
            z.object({
              platformCode: z.string(),
              status: z.string(),
              publishedUrl: z.string().default(""),
              errorMsg: z.string().default(""),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/**
 * 拉取插件本地队列里「页面关着时没落库」的回执（页面连上/重新打开时调用）。
 * 收不到插件应答（未安装/超时）时返回空数组，调用方静默跳过即可。
 */
export function requestPendingReceipts(timeoutMs = 1500): Promise<PendingReceipt[]> {
  const jobId = randomJobId();
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedExtensionMessage(event)) return;
      const parsed = pendingReceiptsSchema.safeParse(event.data);
      if (!parsed.success) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(parsed.data.items);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve([]);
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "aipdd-page", type: "receipts", jobId }, window.location.origin);
  });
}

/** 补齐成功落库后按 jobId 通知插件清队（清队失败无副作用，服务端幂等，下次连上仍会补传）。 */
export function ackExtensionReceipts(jobIds: string[]): void {
  if (!jobIds.length) return;
  window.postMessage(
    { source: "aipdd-page", type: "receipts-ack", payload: { jobIds } },
    window.location.origin,
  );
}

/** 请求插件刷新分发效果时，交给插件的目标：内容 ID + 逐平台已发布作品信息。 */
export type CollectMetricsPayload = {
  contentId: number;
  items: { platformCode: string; publishedUrl: string; publishedItemId: string }[];
};

/** 插件回送的创作中心效果：入站同样按协议校验，逐平台覆盖写。 */
const metricEntrySchema = z.object({
  platformCode: z.string(),
  publishedItemId: z.string().default(""),
  views: z.number().int().min(0).default(0),
  likes: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  capturedAt: z.string().default(""),
});

const metricsResultSchema = z.object({
  type: z.literal("metrics"),
  jobId: z.string().default(""),
  ok: z.boolean().default(false),
  metrics: z.array(metricEntrySchema).default([]),
});

/**
 * 让插件回到各平台创作中心读取阅读/点赞/评论（D8）：插件按 jobId 关联，读到后经
 * `metrics` 通道回送；收不到插件应答（未装/超时）返回空数组，调用方静默跳过。
 */
export function requestMetrics(
  payload: CollectMetricsPayload,
  timeoutMs = 20000,
): Promise<MetricEntry[]> {
  const jobId = randomJobId();
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedExtensionMessage(event)) return;
      const parsed = metricsResultSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.jobId !== jobId) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(parsed.data.metrics);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve([]);
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aipdd-page", type: "collect-metrics", jobId, payload },
      window.location.origin,
    );
  });
}
