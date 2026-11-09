import { randomUUID } from 'node:crypto';
import {
  canonicalQuery,
  percentEncode,
  signRpcResource,
  timestamp,
} from '../common/aliyun-rpc';
import type { AliyunSuggestion } from '@enterprise/contracts';
import { httpRequest, TransportError } from '../http/transport';

/**
 * 阿里云内容安全（绿网）文本同步检测：`POST /green/text/scan`。
 * 文档：https://help.aliyun.com/zh/document_detail/70439.html
 *
 * 业务参数（tasks / scenes）放在 JSON body，公共参数放 query 并参与 RPC 签名；
 * 返回 results 里的 suggestion 是 pass / review / block，本系统按 block 与 review 都拒绝发布。
 */
const GREEN_VERSION = '2018-05-09';
const TEXT_SCAN_PATH = '/green/text/scan';
const IMAGE_SCAN_PATH = '/green/image/scan';
const VIDEO_ASYNC_PATH = '/green/video/asyncscan';
const VIDEO_RESULTS_PATH = '/green/video/results';
const MAX_TEXT = 10000;
/** 图/视频检测场景：色情、暴恐、广告、涉政（与文本 antispam 分开，媒体有独立场景集）。 */
const MEDIA_SCENES = ['porn', 'terrorism', 'ad', 'political_content'];

export type GreenScanInput = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  text: string;
};

/** 图/视频检测入参：只接受公网可访问 URL（本站 OSS 桶公开读），不做字节中转。 */
export type GreenMediaInput = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  url: string;
};

export type GreenScanResult = {
  suggestion: AliyunSuggestion;
  label: string;
  labels: string[];
  rate: number;
  requestId: string;
};

type GreenTaskResult = {
  label?: string;
  rate?: number;
  suggestion?: string;
  scene?: string;
};

type GreenTask = {
  code?: number;
  msg?: string;
  results?: GreenTaskResult[];
};

type GreenResponse = {
  code?: number;
  msg?: string;
  requestId?: string;
  data?: GreenTask[];
};

export class AliyunGreenError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AliyunGreenError';
  }
}

const normalizeSuggestion = (value: string | undefined): AliyunSuggestion => {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'block' || normalized === 'review'
    ? normalized
    : 'pass';
};

const rank: Record<AliyunSuggestion, number> = {
  pass: 0,
  review: 1,
  block: 2,
};

/** 签名后的完整请求 URL（公共参数 + Signature）。 */
export function signedTextScanUrl(input: {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
}): string {
  return signedGreenUrl({ ...input, path: TEXT_SCAN_PATH });
}

/** 通用绿网签名 URL：文本 / 图片 / 视频异步各接口共用同一套 RPC 签名。 */
export function signedGreenUrl(input: {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  path: string;
  extra?: Record<string, string>;
}): string {
  const params = {
    AccessKeyId: input.accessKeyId,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: timestamp(),
    Version: GREEN_VERSION,
    ...(input.extra || {}),
  };
  const signature = signRpcResource({
    params,
    accessKeySecret: input.accessKeySecret,
    resource: input.path,
  });
  return `https://green.${input.region}.aliyuncs.com${input.path}?${canonicalQuery(
    params,
  )}&Signature=${percentEncode(signature)}`;
}

/** 从阿里云返回体里归并出整体建议：block > review > pass。 */
export function verdictOf(
  response: GreenResponse,
): Omit<GreenScanResult, 'requestId'> {
  const results = (response.data || []).flatMap((task) => task.results || []);
  const scored = results.map((item) => ({
    suggestion: normalizeSuggestion(item.suggestion),
    label: String(item.label || '').trim(),
    rate: Number(item.rate) || 0,
  }));
  const worst = scored.reduce<AliyunSuggestion>(
    (acc, item) => (rank[item.suggestion] > rank[acc] ? item.suggestion : acc),
    'pass',
  );
  const hits = scored.filter(
    (item) => item.suggestion !== 'pass' && item.label,
  );
  return {
    suggestion: worst,
    label: hits[0]?.label || 'normal',
    labels: [...new Set(hits.map((item) => item.label))],
    rate: hits.reduce((max, item) => Math.max(max, item.rate), 0),
  };
}

export class AliyunGreenClient {
  async scan(input: GreenScanInput): Promise<GreenScanResult> {
    const text = String(input.text || '')
      .trim()
      .slice(0, MAX_TEXT);
    if (!text) {
      return {
        suggestion: 'pass',
        label: 'normal',
        labels: [],
        rate: 0,
        requestId: '',
      };
    }
    let response;
    try {
      response = await httpRequest<GreenResponse>(signedTextScanUrl(input), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scenes: ['antispam'],
          tasks: [{ dataId: randomUUID(), content: text }],
        }),
        timeoutMs: 6000,
        maxBytes: 1024 * 1024,
        operation: 'aliyun-green-text-scan',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new AliyunGreenError(
          0,
          error.kind === 'timeout'
            ? '阿里云内容安全请求超时'
            : '阿里云内容安全连接失败',
        );
      }
      throw error;
    }

    const body = response.data;
    const topCode = Number(body?.code ?? response.status);
    if (!response.ok || topCode !== 200) {
      throw new AliyunGreenError(
        topCode,
        String(body?.msg || `阿里云内容安全返回 HTTP ${response.status}`),
      );
    }
    const task = body?.data?.[0];
    const taskCode = Number(task?.code ?? 200);
    if (taskCode !== 200) {
      throw new AliyunGreenError(
        taskCode,
        String(task?.msg || '阿里云内容安全检测失败'),
      );
    }
    return {
      ...verdictOf(body || {}),
      requestId: String(body?.requestId || ''),
    };
  }

  /**
   * 图片同步检测：`POST /green/image/scan`，按公网 URL 拉取，不做字节中转。
   * 返回体与文本同构（data[].results[]），复用 verdictOf 归并。
   */
  async scanImage(input: GreenMediaInput): Promise<GreenScanResult> {
    const url = String(input.url || '').trim();
    if (!url)
      return {
        suggestion: 'pass',
        label: 'normal',
        labels: [],
        rate: 0,
        requestId: '',
      };
    const body = await this.postJson<GreenResponse>(
      signedGreenUrl({
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret,
        region: input.region,
        path: IMAGE_SCAN_PATH,
      }),
      {
        scenes: MEDIA_SCENES,
        tasks: [{ dataId: randomUUID(), imageURL: url }],
      },
      'aliyun-green-image-scan',
    );
    return {
      ...verdictOf(body || {}),
      requestId: String(body?.requestId || ''),
    };
  }

  /** 视频异步提交：`POST /green/video/asyncscan`，返回 taskId 供轮询取结论。 */
  async submitVideoScan(input: GreenMediaInput): Promise<string> {
    const url = String(input.url || '').trim();
    if (!url) return '';
    const body = await this.postJson<{
      code?: number;
      msg?: string;
      data?: { code?: number; taskId?: string; msg?: string }[];
    }>(
      signedGreenUrl({
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret,
        region: input.region,
        path: VIDEO_ASYNC_PATH,
      }),
      { scenes: MEDIA_SCENES, tasks: [{ dataId: randomUUID(), url }] },
      'aliyun-green-video-submit',
    );
    return String(body?.data?.[0]?.taskId || '').trim();
  }

  /** 视频结果轮询：`POST /green/video/results`，未出结果的 task 不返回 results。 */
  async videoScanResults(input: {
    accessKeyId: string;
    accessKeySecret: string;
    region: string;
    taskIds: string[];
  }): Promise<Record<string, Omit<GreenScanResult, 'requestId'>>> {
    const ids = input.taskIds.filter(Boolean);
    if (!ids.length) return {};
    const body = await this.postJson<{
      code?: number;
      msg?: string;
      data?: {
        code?: number;
        taskId?: string;
        results?: GreenTaskResult[];
        frames?: { results?: GreenTaskResult[] }[];
      }[];
    }>(
      signedGreenUrl({
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret,
        region: input.region,
        path: VIDEO_RESULTS_PATH,
        extra: { taskIds: JSON.stringify(ids) },
      }),
      { scenes: MEDIA_SCENES },
      'aliyun-green-video-results',
    );
    const out: Record<string, Omit<GreenScanResult, 'requestId'>> = {};
    for (const task of body?.data || []) {
      const taskId = String(task.taskId || '').trim();
      if (!taskId || (!task.results?.length && !task.frames?.length)) continue;
      const results = [
        ...(task.results || []),
        ...(task.frames || []).flatMap((frame) => frame.results || []),
      ];
      out[taskId] = verdictOf({ data: [{ results }] });
    }
    return out;
  }

  private async postJson<T>(
    url: string,
    payload: unknown,
    operation: string,
  ): Promise<T> {
    let response;
    try {
      response = await httpRequest<T>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
        maxBytes: 1024 * 1024,
        operation,
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new AliyunGreenError(
          0,
          error.kind === 'timeout'
            ? '阿里云内容安全请求超时'
            : '阿里云内容安全连接失败',
        );
      }
      throw error;
    }
    const body = response.data as { code?: number; msg?: string } | null;
    const topCode = Number(body?.code ?? response.status);
    if (!response.ok || topCode !== 200) {
      throw new AliyunGreenError(
        topCode,
        String(body?.msg || `阿里云内容安全返回 HTTP ${response.status}`),
      );
    }
    return response.data;
  }
}
