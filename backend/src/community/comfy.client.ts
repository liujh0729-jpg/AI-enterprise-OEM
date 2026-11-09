import { randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest, TransportError } from '../http/transport';
import {
  assertOutboundUrl,
  assertOutboundUrlSync,
} from '../http/outbound-guard';
import { OSS_HOST } from '../oss/oss.config';

const logger = new Logger('ComfyClient');

/**
 * Comfy Cloud 上游唯一出口（创意社区）。
 *
 * 事实来源（docs.comfy.org / openapi-v2）：
 *  - Base URL `https://cloud.comfy.org`；v2 用 `Authorization: Bearer <key>`，
 *    v1（`/api/object_info` 这类还没有 v2 对应的接口）用 `X-API-Key`，两把是同一把 Key。
 *  - `POST /api/v2/jobs` 只接受 API 格式工作流；带 nodes/links 的 UI/save 格式直接 422 `workflow_format_ui`。
 *  - 产物与资产的内容端点是短命签名 URL（约 6 小时）且需要鉴权，浏览器直挂必 401，
 *    所以下载一律走这里、由调度器转存进本站 OSS。
 *
 * 安全边界：出站主机白名单（cloud.comfy.org + 官方签名域 + 本站 OSS 桶域）、
 * 禁 follow 重定向（跳转逐跳自己校验）、所有响应限字节、Key 永不进日志与错误文案。
 */

const COMFY_HOST = 'cloud.comfy.org';
const COMFY_ORIGIN = 'https://cloud.comfy.org';

/** 上游允许跳到的下载主机：官方 CDN（GCS）、S3、以及本站公开读桶。 */
const DOWNLOAD_HOST_SUFFIXES = [
  '.storage.googleapis.com',
  '.amazonaws.com',
  '.googleusercontent.com',
];

/** 转存上限：图 50MB（也是上游图片输入上限）、视频 500MB、音频 50MB。 */
export const MAX_DOWNLOAD_BYTES = {
  image: 50 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  file: 50 * 1024 * 1024,
} as const;
/** object_info 很大（全量节点定义），只扫顶层键、不做 JSON.parse，超限即失败。 */
const MAX_OBJECT_INFO_BYTES = 96 * 1024 * 1024;
const OBJECT_INFO_TTL_MS = 30 * 60 * 1000;

export type ComfyJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type ComfyOutput = {
  kind: 'image' | 'video' | 'audio' | 'file';
  name: string;
  url: string;
  assetId: string;
};

export type ComfyJob = {
  id: string;
  status: ComfyJobStatus;
  queuePosition: number;
  progressCurrent: number;
  progressTotal: number;
  outputs: ComfyOutput[];
  errorText: string;
};

/** v1 任务列表的状态口径（与 v2 同义，保留上游原词便于对账）。 */
export type ComfyCloudJobStatus =
  'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/** `GET /api/userdata` 的文件项。 */
export type ComfyCloudFile = {
  path: string;
  size: number;
  modified: number;
};

/** `GET /api/jobs` 的列表项（不含 outputs，详情要再查）。 */
export type ComfyCloudJob = {
  id: string;
  status: ComfyCloudJobStatus;
  workflowId: string;
  outputsCount: number;
  previewOutput: Record<string, unknown> | null;
};

/** `GET /api/jobs/{id}` 的详情：workflow 是提交时的 API 格式执行图。 */
export type ComfyCloudJobDetail = {
  id: string;
  status: ComfyCloudJobStatus;
  workflow: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  previewOutput: Record<string, unknown> | null;
  workflowId: string;
};

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function statusOf(value: unknown): ComfyJobStatus {
  const raw = text(value).toLowerCase();
  if (raw === 'success' || raw === 'completed' || raw === 'done') {
    return 'succeeded';
  }
  if (raw === 'cancel' || raw === 'cancelled' || raw === 'canceled') {
    return 'canceled';
  }
  if (raw === 'error') return 'failed';
  if (
    raw === 'queued' ||
    raw === 'running' ||
    raw === 'succeeded' ||
    raw === 'failed' ||
    raw === 'canceled'
  ) {
    return raw;
  }
  return 'queued';
}

function kindOf(type: string, name: string, url: string): ComfyOutput['kind'] {
  const hint = `${type} ${name} ${url}`.toLowerCase();
  if (/mp4|webm|mov|\bvideo\b/.test(hint)) return 'video';
  if (/mp3|wav|ogg|\baudio\b|speech/.test(hint)) return 'audio';
  if (/png|jpe?g|webp|gif|\bimage\b|thumb/.test(hint)) return 'image';
  return 'file';
}

/** v1 列表/详情状态 → 统一的五态；不认识的状态一律当 pending（不当作已完成）。 */
function cloudJobStatus(value: unknown): ComfyCloudJobStatus {
  const raw = text(value).toLowerCase();
  if (raw === 'completed' || raw === 'success' || raw === 'succeeded') {
    return 'completed';
  }
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'cancelled' || raw === 'canceled' || raw === 'cancel') {
    return 'cancelled';
  }
  if (raw === 'in_progress' || raw === 'running') return 'in_progress';
  return 'pending';
}

/** 上游可能给 `{current,total}`、`{value,total}`，也可能给 0~1 或 0~100 的小数。 */
function progressPair(raw: unknown): { current: number; total: number } {
  const record = (raw || {}) as Record<string, unknown>;
  const current = Number(record.current ?? record.value ?? record.step ?? 0);
  const total = Number(record.total ?? record.max ?? record.steps ?? 0);
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return { current: Math.max(0, current), total: Math.max(0, total) };
  }
  const ratio = Number(record.percent ?? (typeof raw === 'number' ? raw : NaN));
  if (Number.isFinite(ratio)) {
    const scaled = ratio > 1 ? ratio / 100 : ratio;
    return { current: Math.round(scaled * 100), total: 100 };
  }
  return { current: 0, total: 0 };
}

function outputsOf(raw: unknown): ComfyOutput[] {
  // 上游形态见过两种：`outputs: [...]` 与 `outputs: { images: [...], videos: [...] }`
  const candidates: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw)) {
    for (const item of raw as unknown[]) {
      if (item && typeof item === 'object') {
        candidates.push(item as Record<string, unknown>);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            candidates.push({
              group: key,
              ...(item as Record<string, unknown>),
            });
          }
        }
      } else if (value && typeof value === 'object') {
        candidates.push({ group: key, ...(value as Record<string, unknown>) });
      }
    }
  }
  const out: ComfyOutput[] = [];
  for (const item of candidates) {
    const url = text(
      item.url ?? item.download_url ?? item.signed_url ?? item.content_url,
    );
    const assetId = text(item.asset_id ?? item.id ?? item.assetId);
    if (!url && !assetId) continue;
    const name = text(
      item.filename ?? item.name ?? item.title,
      url
        ? decodeURIComponent(url.split('/').pop() || '').split('?')[0]
        : assetId,
    );
    const kind = kindOf(
      text(item.type ?? item.group ?? item.media_type),
      name,
      url,
    );
    out.push({ kind, name: name.slice(0, 200), url, assetId });
  }
  return out.slice(0, 50);
}

function errorTextOf(record: Record<string, unknown>): string {
  const direct = text(record.error ?? record.message ?? record.detail);
  if (direct) return direct.slice(0, 500);
  const history = record.node_errors ?? record.errors;
  if (Array.isArray(history) && history.length) {
    return JSON.stringify(history[0]).slice(0, 500);
  }
  if (history && typeof history === 'object') {
    const first = Object.values(history as Record<string, unknown>)[0];
    if (first) return JSON.stringify(first).slice(0, 500);
  }
  return '';
}

/**
 * 上游错误 → 中文可执行提示。
 * 注意：绝不把上游 401 原样透出来——前端见到 401 会把已登录用户踢出会话，
 * 这里的 401/403 一律翻译成业务错误（Key 的问题，不是本站登录态的问题）。
 */
function upstreamFailure(status: number, body: unknown, retryAfter: string) {
  const record = (body || {}) as Record<string, unknown>;
  const code = text(record.code ?? record.error ?? record.type);
  // 上游把详情放在 `error` 时可能是对象（`{code, message}`），得先探类型再取 message
  const nested =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : null;
  const detail = text(
    record.message ?? record.detail ?? nested?.message ?? nested?.msg,
  );
  const hint = (text: string) =>
    new BusinessException(
      status === 429
        ? ErrorCode.RATE_LIMITED
        : status === 422 || status === 400
          ? ErrorCode.VALIDATION_ERROR
          : ErrorCode.BAD_REQUEST,
      text,
    );
  switch (status) {
    case 400:
      return hint(
        `Comfy Cloud 不接受这次请求：${detail || code || '参数有误'}`,
      );
    case 401:
      return hint(
        'Comfy Cloud 拒绝了这个 API Key。请到 platform.comfy.org → API Keys 重新生成一把并粘贴保存（Key 只显示一次，丢失只能重建）。',
      );
    case 402:
      return hint(
        '你的 Comfy Cloud 账号积分不足。运行用的是你自己 Comfy Cloud 订阅的积分，请先到 platform.comfy.org 充值或改用更小的工作流。',
      );
    case 403:
      return hint(
        '这个 API Key 没有调用 Comfy Cloud API 的权限：Comfy 的 API 访问需要付费订阅（免费套餐不含），请确认订阅处于激活状态。',
      );
    case 404:
      return hint(
        'Comfy Cloud 找不到这次任务或这个资产，可能已被上游清理，请重新运行。',
      );
    case 422:
      if (code === 'workflow_format_ui') {
        return hint(
          '这份工作流是 ComfyUI 界面（save）格式，Comfy Cloud 只接受 API 格式。请在 ComfyUI 里用「Workflow → Export (API)」导出后再发布。',
        );
      }
      if (code === 'missing_asset') {
        return hint('工作流引用的输入素材不存在，请重新上传图片后重试。');
      }
      if (code === 'idempotency_key_reuse') {
        return hint('这次提交与刚刚那次重复，请稍等片刻再看运行列表。');
      }
      return hint(
        `Comfy Cloud 拒绝了这份工作流：${detail || code || '格式不合规'}`,
      );
    case 429: {
      const wait = Math.max(1, Math.round(Number(retryAfter) || 30));
      return new BusinessException(
        ErrorCode.RATE_LIMITED,
        code === 'queue_full'
          ? `Comfy Cloud 队列已满，约 ${wait} 秒后自动重试即可（跑的是你自己的订阅额度，不会扣本站积分）。`
          : `Comfy Cloud 触发了限流，请约 ${wait} 秒后再试；若持续出现，请确认订阅档位仍然有效。`,
      );
    }
    case 503:
      return new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Comfy Cloud 暂时不可用，请稍后重试。',
      );
    default:
      return new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Comfy Cloud 返回 HTTP ${status}，请稍后重试。`,
      );
  }
}

/**
 * 还原 JSON 字符串里的转义（顶层键＝class_type，必须与工作流 JSON.parse 出来的值逐字相等）：
 * 不做这步会把 `"a\"b"` 这类键读成带反斜杠的字面量、并把 `\uXXXX` 原样留着，导致合法节点被误判成未知节点。
 */
function decodeJsonString(raw: string): string {
  if (!raw.includes('\\')) return raw;
  const simple: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  };
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[index + 1];
    if (next === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        index += 5;
        continue;
      }
      out += ch;
      continue;
    }
    if (next !== undefined && simple[next] !== undefined) {
      out += simple[next];
      index += 1;
      continue;
    }
    // 非法转义：保留反斜杠原样，交给上游去对账，不静默吞字符
    out += ch;
  }
  return out;
}

/** 顶层键扫描：object_info 是 `{“节点名”: {...}}` 的平铺表，只要键名，不整包 parse。 */
export function scanTopLevelKeys(bytes: Uint8Array): Set<string> {
  const keys = new Set<string>();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let keyOpen = false;
  let buffer: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        if (keyOpen) buffer.push(byte);
        continue;
      }
      if (byte === 0x5c) {
        escaped = true;
        if (keyOpen) buffer.push(byte);
        continue;
      }
      if (byte === 0x22) {
        if (keyOpen) {
          keys.add(decodeJsonString(Buffer.from(buffer).toString('utf8')));
          keyOpen = false;
          buffer = [];
        }
        inString = false;
        continue;
      }
      if (keyOpen) buffer.push(byte);
      continue;
    }
    if (byte === 0x7b || byte === 0x5b) depth += 1;
    else if (byte === 0x7d || byte === 0x5d) depth -= 1;
    else if (byte === 0x22 && depth === 1) {
      // 深度 1 处遇到的引号即顶层键（object_info 的顶层值全是对象，不会是字符串）
      keyOpen = true;
      buffer = [];
      inString = true;
    }
  }
  return keys;
}

function downloadHostAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === COMFY_HOST || host === OSS_HOST) return true;
  if (host === 'comfy.org' || host.endsWith('.comfy.org')) return true;
  return DOWNLOAD_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export class ComfyClient {
  /** object_info 缓存：按 Key 指纹分桶（不放 Key 原文当键），30 分钟。 */
  private readonly objectInfoCache = new Map<
    string,
    { at: number; names: Set<string> }
  >();

  private origin(): string {
    const configured = String(process.env.COMFY_CLOUD_BASE_URL || '').trim();
    if (!configured) return COMFY_ORIGIN;
    // 覆盖值也必须在同一安全口径内：生产只允许 comfy.org 官方域，开发环境放开回环以便 mock 上游。
    const url = assertOutboundUrlSync(configured, 'Comfy Cloud 地址');
    const host = url.hostname.toLowerCase();
    if (
      host === COMFY_HOST ||
      host === 'comfy.org' ||
      host.endsWith('.comfy.org')
    ) {
      return url.origin;
    }
    if (process.env.NODE_ENV !== 'production') return url.origin;
    throw new BusinessException(
      ErrorCode.INTERNAL_ERROR,
      'Comfy Cloud 地址只能是 cloud.comfy.org',
    );
  }

  private v2Headers(apiKey: string): Record<string, string> {
    return {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
      'user-agent': 'AIworkin-Enterprise',
    };
  }

  private v1Headers(apiKey: string): Record<string, string> {
    return {
      'x-api-key': apiKey,
      accept: 'application/json',
      'user-agent': 'AIworkin-Enterprise',
    };
  }

  /** 统一出站点：判状态码、把上游错误翻成中文、绝不记录 Key。 */
  private async call<T>(
    apiKey: string,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      version?: 'v1' | 'v2';
      readAs?: 'json' | 'text' | 'bytes' | 'empty';
      maxBytes?: number;
      timeoutMs?: number;
      headers?: Record<string, string>;
      /** 允许 404 当成功返回（Key 探测用），其余非 2xx 一律抛业务错误 */
      allowStatus?: number[];
    } = {},
  ): Promise<T> {
    const version = init.version || 'v2';
    const url = `${this.origin()}${path}`;
    // 每次出站都做 DNS 级守卫：官方域不会指向内网，但这道锁不能因为「是自家上游」就省掉。
    await assertOutboundUrl(url, 'Comfy Cloud 地址');
    let response;
    try {
      response = await httpRequest<T>(url, {
        method: init.method || 'GET',
        headers: {
          ...(version === 'v1'
            ? this.v1Headers(apiKey)
            : this.v2Headers(apiKey)),
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        timeoutMs: init.timeoutMs ?? 20000,
        readAs: init.readAs ?? 'json',
        maxBytes: init.maxBytes,
        // 上游 3xx 不自动跟：跳哪儿由我们自己逐跳校验
        redirect: 'manual',
        operation: `comfy:${version}${path.split('/').slice(-2).join('/')}`,
        concurrency: 4,
        limiterKey: `comfy:${new URL(url).origin}`,
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      const kind = error instanceof TransportError ? error.kind : 'network';
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        kind === 'timeout'
          ? 'Comfy Cloud 响应超时，请稍后重试'
          : '无法连接 Comfy Cloud，请检查网络后重试',
      );
    }
    const allowed = init.allowStatus || [];
    if (!response.ok && !allowed.includes(response.status)) {
      logger.warn({
        path,
        status: response.status,
        // 只留错误摘要，不打印请求头（里面有 Key）
        body: JSON.stringify(response.data ?? '').slice(0, 300),
      });
      throw upstreamFailure(
        response.status,
        response.data,
        response.headers.get('retry-after') || '',
      );
    }
    return response.data;
  }

  /**
   * 校验 Key 是否可用：拿一个不存在的 job 去探。
   * 上游对无效 Key 回 401、订阅未激活回 429/403，而 Key 有效时会走到「找不到任务」的 404——
   * 这是目前唯一不需要排队、也不需要花钱的鉴权探针。
   */
  async verifyKey(apiKey: string): Promise<void> {
    await this.call(
      apiKey,
      '/api/v2/jobs/00000000-0000-0000-0000-000000000000',
      {
        allowStatus: [404],
        timeoutMs: 15000,
      },
    );
  }

  /** 提交作业：只发 API 格式图；extra_data 由后端注入，发布者塞不进任何凭据字段。 */
  async submitJob(
    apiKey: string,
    workflow: Record<string, unknown>,
  ): Promise<{ id: string; status: ComfyJobStatus }> {
    const record = await this.call<Record<string, unknown>>(
      apiKey,
      '/api/v2/jobs',
      {
        method: 'POST',
        timeoutMs: 30000,
        // 单次性幂等键：每次点「运行」都是新的一次提交，不做跨点击去重（24h 内撞键上游直接 422）
        headers: { 'idempotency-key': randomUUID() },
        body: {
          workflow,
          extra_data: {
            api_key_comfy_org: apiKey,
            source: 'aiworkin-enterprise',
          },
        },
      },
    );
    return {
      id: text(record.id ?? record.job_id ?? record.jobId),
      status: statusOf(record.status),
    };
  }

  async getJob(apiKey: string, jobId: string): Promise<ComfyJob> {
    const record = await this.call<Record<string, unknown>>(
      apiKey,
      `/api/v2/jobs/${encodeURIComponent(jobId)}`,
      { timeoutMs: 20000 },
    );
    const progress = progressPair(record.progress);
    return {
      id: text(record.id ?? record.job_id, jobId),
      status: statusOf(record.status),
      queuePosition:
        Number(record.queue_position ?? record.queuePosition ?? 0) || 0,
      progressCurrent: progress.current,
      progressTotal: progress.total,
      outputs: outputsOf(record.outputs ?? record.artifacts),
      errorText: errorTextOf(record),
    };
  }

  async cancelJob(apiKey: string, jobId: string): Promise<void> {
    await this.call(
      apiKey,
      `/api/v2/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
        timeoutMs: 15000,
        readAs: 'empty',
      },
    );
  }

  /** 实际执行图（含上游补全的默认值），供「查看这份工作流到底怎么跑」与审核复核。 */
  async getJobWorkflow(
    apiKey: string,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    const record = await this.call<Record<string, unknown>>(
      apiKey,
      `/api/v2/jobs/${encodeURIComponent(jobId)}/workflow`,
      { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 },
    );
    return record && typeof record === 'object' ? record : {};
  }

  /**
   * 上传输入素材：multipart，`file` 必须是最后一个 part（上游硬要求）。
   * 返回的 asset id 用于替换工作流里的 `{"__type":"core/ASSET"}`。
   */
  async uploadAsset(
    apiKey: string,
    bytes: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> {
    const form = new FormData();
    form.set('type', 'IMAGE');
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], {
        type: contentType || 'application/octet-stream',
      }),
      filename.replace(/[^\w.-]/g, '_').slice(0, 120) || 'input',
    );
    const url = `${this.origin()}/api/v2/assets`;
    await assertOutboundUrl(url, 'Comfy Cloud 地址');
    let response;
    try {
      response = await httpRequest<Record<string, unknown>>(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': 'AIworkin-Enterprise',
        },
        body: form,
        timeoutMs: 60000,
        maxBytes: 8 * 1024 * 1024,
        redirect: 'manual',
        operation: 'comfy:v2assets',
        concurrency: 4,
        limiterKey: `comfy:${new URL(url).origin}`,
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '上传素材到 Comfy Cloud 失败，请稍后重试',
      );
    }
    if (!response.ok) {
      throw upstreamFailure(
        response.status,
        response.data,
        response.headers.get('retry-after') || '',
      );
    }
    const id = text(
      (response.data || {}).id ??
        (response.data || {}).asset_id ??
        ((response.data || {}).asset as Record<string, unknown> | undefined)
          ?.id,
    );
    if (!id) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Comfy Cloud 没有返回素材 id，请稍后重试',
      );
    }
    return id;
  }

  /**
   * 下载上游字节（产物 / 资产内容 / v1 视图端点）：签名 URL 短命，必须逐跳校验主机白名单，
   * 读完即交给 OSS，不落临时文件。
   *
   * `version` 决定打 cloud.comfy.org 时带哪种鉴权头：v2 走 Bearer，v1（`/api/view` 这类）走 X-API-Key。
   * 签名域（GCS/S3）不带任何鉴权头。
   */
  async downloadBytes(
    apiKey: string,
    rawUrl: string,
    maxBytes: number,
    version: 'v1' | 'v2' = 'v2',
  ): Promise<{ bytes: Buffer; contentType: string }> {
    let target = rawUrl;
    for (let hop = 0; hop < 4; hop += 1) {
      if (!downloadHostAllowed(target)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'Comfy Cloud 给出的下载地址不在允许的主机白名单内，已拒绝转存',
        );
      }
      await assertOutboundUrl(target, 'Comfy Cloud 下载地址');
      const privateAsset =
        new URL(target).hostname.toLowerCase() === COMFY_HOST;
      let response;
      try {
        response = await httpRequest<Uint8Array>(target, {
          method: 'GET',
          headers: privateAsset
            ? version === 'v1'
              ? { ...this.v1Headers(apiKey), accept: '*/*' }
              : { authorization: `Bearer ${apiKey}`, accept: '*/*' }
            : { accept: '*/*' },
          timeoutMs: 120000,
          readAs: 'bytes',
          maxBytes,
          redirect: 'manual',
          operation: 'comfy:download',
          concurrency: 2,
          limiterKey: `comfy:${new URL(target).origin}`,
        });
      } catch (error) {
        const kind = error instanceof TransportError ? error.kind : 'network';
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          kind === 'protocol'
            ? 'Comfy Cloud 的产物超过大小上限，已放弃转存'
            : kind === 'timeout'
              ? '从 Comfy Cloud 取回产物超时，请稍后重试'
              : '从 Comfy Cloud 取回产物失败，请稍后重试',
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location') || '';
        if (!location) {
          throw new BusinessException(
            ErrorCode.SERVICE_UNAVAILABLE,
            'Comfy Cloud 下载地址跳转异常',
          );
        }
        target = new URL(location, target).toString();
        continue;
      }
      if (!response.ok) {
        throw upstreamFailure(response.status, null, '');
      }
      return {
        bytes: Buffer.from(response.data || new Uint8Array()),
        contentType: response.headers.get('content-type') || '',
      };
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Comfy Cloud 下载地址重定向次数过多',
    );
  }

  /** 取产物：给 URL 就直接下，只给 asset id 则走资产内容端点（302 到签名域）。 */
  async fetchOutputBytes(
    apiKey: string,
    output: ComfyOutput,
    maxBytes: number,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const url =
      output.url ||
      `${this.origin()}/api/v2/assets/${encodeURIComponent(output.assetId)}/content`;
    return this.downloadBytes(apiKey, url, maxBytes);
  }

  /**
   * 节点清单（v1 `GET /api/object_info`）：发布校验的唯一依据——
   * 不在清单里的 class_type 一律当未知节点拒掉。按 Key 指纹缓存 30 分钟。
   */
  async nodeNames(apiKey: string): Promise<Set<string>> {
    const cacheKey = Buffer.from(
      // 指纹只为分桶，不落原文
      apiKey.slice(-6) + String(apiKey.length),
    ).toString('base64');
    const cached = this.objectInfoCache.get(cacheKey);
    if (cached && Date.now() - cached.at < OBJECT_INFO_TTL_MS)
      return cached.names;
    const record = await this.call<Uint8Array>(apiKey, '/api/object_info', {
      version: 'v1',
      readAs: 'bytes',
      maxBytes: MAX_OBJECT_INFO_BYTES,
      timeoutMs: 90000,
    });
    const names = scanTopLevelKeys(
      record instanceof Uint8Array ? record : new Uint8Array(),
    );
    if (!names.size) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '没有取到 Comfy Cloud 的节点清单，稍后重试',
      );
    }
    if (this.objectInfoCache.size > 64) this.objectInfoCache.clear();
    this.objectInfoCache.set(cacheKey, { at: Date.now(), names });
    return names;
  }

  // ---------- 迁移用 v1 接口（v2 在 Comfy Cloud 上不提供历史列表） ----------

  /**
   * 已保存工作流清单：`GET /api/userdata?dir=workflows/&recurse=true`。
   * `dir` 必须带尾斜杠，否则上游 400；`recurse` 为 true 才能列到子目录。
   */
  async listWorkflowFiles(
    apiKey: string,
    dir = 'workflows/',
  ): Promise<ComfyCloudFile[]> {
    const query = new URLSearchParams({ dir, recurse: 'true' });
    const record = await this.call<unknown>(
      apiKey,
      `/api/userdata?${query.toString()}`,
      { version: 'v1', timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 },
    );
    if (!Array.isArray(record)) return [];
    const files: ComfyCloudFile[] = [];
    for (const item of record) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const path = text(row.path);
      if (!path) continue;
      files.push({
        path,
        size: Number(row.size) || 0,
        modified: Number(row.modified) || 0,
      });
    }
    return files.slice(0, 500);
  }

  /** 读取单个用户数据文件（工作流 JSON）：`GET /api/userdata/{file}`，正文是 octet-stream。 */
  async getUserDataFile(apiKey: string, path: string): Promise<Buffer> {
    // 逐段编码：子目录的 `/` 要保留，其余特殊字符一律转义
    const safe = String(path)
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const bytes = await this.call<Uint8Array>(apiKey, `/api/userdata/${safe}`, {
      version: 'v1',
      readAs: 'bytes',
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 30000,
    });
    return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array());
  }

  /**
   * 历史任务列表：`GET /api/jobs`。
   * v2 的 `GET /api/v2/jobs` 在 Comfy Cloud 上直接 501（只有 serverless 平台能列），
   * 所以「迁移历史任务」只能走 v1；列表项不含 outputs，详情要再调 `getJobDetail`。
   */
  async listJobs(
    apiKey: string,
    options: { limit?: number; status?: string } = {},
  ): Promise<ComfyCloudJob[]> {
    const query = new URLSearchParams({
      limit: String(Math.min(1000, Math.max(1, options.limit ?? 100))),
      sort_by: 'create_time',
      sort_order: 'desc',
    });
    if (options.status) query.set('status', options.status);
    const record = await this.call<Record<string, unknown>>(
      apiKey,
      `/api/jobs?${query.toString()}`,
      { version: 'v1', timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 },
    );
    const rows = Array.isArray(record?.jobs) ? record.jobs : [];
    const jobs: ComfyCloudJob[] = [];
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = text(row.id);
      if (!id) continue;
      jobs.push({
        id,
        status: cloudJobStatus(row.status),
        workflowId: text(row.workflow_id),
        outputsCount: Number(row.outputs_count) || 0,
        previewOutput:
          row.preview_output && typeof row.preview_output === 'object'
            ? (row.preview_output as Record<string, unknown>)
            : null,
      });
    }
    return jobs;
  }

  /** 任务详情：`GET /api/jobs/{job_id}`，含完整执行图（API 格式）与 outputs。 */
  async getJobDetail(
    apiKey: string,
    jobId: string,
  ): Promise<ComfyCloudJobDetail> {
    const record = await this.call<Record<string, unknown>>(
      apiKey,
      `/api/jobs/${encodeURIComponent(jobId)}`,
      { version: 'v1', timeoutMs: 40000, maxBytes: 24 * 1024 * 1024 },
    );
    return {
      id: text(record?.id, jobId),
      status: cloudJobStatus(record?.status),
      workflow:
        record?.workflow && typeof record.workflow === 'object'
          ? (record.workflow as Record<string, unknown>)
          : null,
      outputs:
        record?.outputs && typeof record.outputs === 'object'
          ? (record.outputs as Record<string, unknown>)
          : null,
      previewOutput:
        record?.preview_output && typeof record.preview_output === 'object'
          ? (record.preview_output as Record<string, unknown>)
          : null,
      workflowId: text(record?.workflow_id),
    };
  }

  /**
   * ComfyUI outputs 里的 `{filename, subfolder, type}` 走 `GET /api/view`（302 到 GCS 签名域）。
   * 它是 v1 接口，鉴权头用 X-API-Key。
   */
  async viewFile(
    apiKey: string,
    item: { filename: string; subfolder?: string; type?: string },
    maxBytes: number,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const query = new URLSearchParams({ filename: item.filename });
    if (item.subfolder) query.set('subfolder', item.subfolder);
    query.set('type', item.type || 'output');
    return this.downloadBytes(
      apiKey,
      `${this.origin()}/api/view?${query.toString()}`,
      maxBytes,
      'v1',
    );
  }
}
