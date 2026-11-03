import { randomUUID } from 'node:crypto';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';

const UPLOAD_PATH = '/oss/upload';
const ASSET_PATH = '/digital_asset';
const UPLOAD_TIMEOUT_MS = 300_000;
const REGISTER_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
/** 单件媒体上限：与上传口一致，避免把超大文件整段读进内存。 */
export const AIPDD_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

export function mimeOf(name: string) {
  const ext = name.toLowerCase().split('.').pop() || '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

type Envelope = { code?: unknown; message?: unknown; data?: unknown };

/** AIPDD 信封的成功码是 0（部分历史接口回 200），两种都收；其余一律按失败处理。 */
function unwrap(body: string, action: string) {
  let payload: Envelope;
  try {
    payload = JSON.parse(body) as Envelope;
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${action}失败：平台返回的不是 JSON（渠道地址可能无法直连）`,
    );
  }
  const code = Number(payload.code);
  if (code !== 0 && code !== 200) {
    const message = readText(payload.message).slice(0, 200);
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${action}失败（code=${String(payload.code)}）${message ? `：${message}` : ''}`,
    );
  }
  return (payload.data || {}) as Record<string, unknown>;
}

/**
 * AIPDD 数字资产云：上传口与资产登记口都挂在**站点根**（`/v1` 前缀会 404），
 * 鉴权头是 `X-API-Key`，凭据就是本账号「API Key 管理」里的 sk- Key。
 * 成功回 `{ code: 0, data: { url } }`；上传后的直链无签名、长期可读。
 */
export class AipddAssetClient {
  /** `https://api.aipdd.work/v1` → `https://api.aipdd.work` */
  static origin(baseUrl: string) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${parsed.protocol}//${parsed.host}`;
  }

  async upload(input: {
    baseUrl: string;
    apiKey: string;
    bytes: Uint8Array;
    filename: string;
    prefix: string;
  }) {
    const origin = AipddAssetClient.origin(input.baseUrl);
    if (!origin) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'AIPDD 地址为空');
    }
    if (!input.apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有平台 API Key：请先在「API Key 管理」生成一把 sk- Key',
      );
    }
    if (!input.bytes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (input.bytes.length > AIPDD_MEDIA_MAX_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    const ext = input.filename.toLowerCase().split('.').pop() || 'bin';
    const filename = `${randomUUID()}.${ext}`;
    const form = new FormData();
    form.append('bucket_name', 'aipdd');
    form.append('prefix', input.prefix);
    const buffer = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(buffer).set(input.bytes);
    form.append(
      'file',
      new Blob([buffer], { type: mimeOf(filename) }),
      filename,
    );
    let response;
    try {
      response = await httpRequest<string>(`${origin}${UPLOAD_PATH}`, {
        method: 'POST',
        headers: { 'X-API-Key': input.apiKey },
        body: form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:ossUpload',
      });
    } catch (error) {
      if (error instanceof TransportError && error.kind === 'timeout') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '上传到数字资产云超时，请稍后重试',
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '上传到数字资产云失败：平台不可达',
      );
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `上传到数字资产云失败（HTTP ${response.status}）`,
      );
    }
    const data = unwrap(response.data, '上传到数字资产云');
    const url = readText(data.url).trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '上传到数字资产云失败：平台没有返回可访问的直链',
      );
    }
    return { url, filename: readText(data.filename) || filename };
  }

  /** 把已有直链登记成平台数字资产；默认不公开（isOpen:false）。 */
  async register(input: {
    baseUrl: string;
    apiKey: string;
    url: string;
    name: string;
    kind: string;
    labels?: string[];
    isOpen?: boolean;
  }) {
    const origin = AipddAssetClient.origin(input.baseUrl);
    if (!origin || !input.apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '数字资产登记需要平台 API Key，请先在「API Key 管理」生成',
      );
    }
    let response;
    try {
      response = await httpRequest<string>(`${origin}${ASSET_PATH}`, {
        method: 'POST',
        headers: {
          'X-API-Key': input.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: input.kind || 'image',
          url: input.url,
          name: input.name || '',
          labels: input.labels ?? ['aiworkin-enterprise'],
          isOpen: input.isOpen ?? false,
        }),
        timeoutMs: REGISTER_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:registerAsset',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '数字资产登记失败：平台不可达或超时',
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `数字资产登记失败（HTTP ${response.status}）`,
      );
    }
    const data = unwrap(response.data, '数字资产登记');
    return readText(data.id);
  }

  /** 资产管理的统一调用：列表 / 详情 / 标签 / 更新都走同一套信封与错误口径。 */
  private async call(input: {
    baseUrl: string;
    apiKey: string;
    method: 'GET' | 'PUT' | 'POST';
    path: string;
    action: string;
    body?: Record<string, unknown>;
  }) {
    const origin = AipddAssetClient.origin(input.baseUrl);
    if (!origin) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'AIPDD 地址为空');
    }
    if (!input.apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有平台 API Key：请先在「API Key 管理」生成一把 sk- Key',
      );
    }
    let response;
    try {
      response = await httpRequest<string>(`${origin}${input.path}`, {
        method: input.method,
        headers: {
          'X-API-Key': input.apiKey,
          ...(input.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        timeoutMs: REGISTER_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:assetCenter',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `${input.action}失败：平台不可达或超时`,
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `${input.action}失败（HTTP ${response.status}）`,
      );
    }
    return unwrap(response.data, input.action);
  }

  /** 数字资产列表：平台 `/digital_asset/list`，支持类型 / 关键词 / 标签。 */
  async list(input: {
    baseUrl: string;
    apiKey: string;
    page: number;
    pageSize: number;
    type?: string;
    keyword?: string;
    label?: string;
  }) {
    const query = new URLSearchParams({
      page: String(input.page),
      pageSize: String(input.pageSize),
    });
    if (input.type) query.set('type', input.type);
    if (input.keyword) query.set('keyword', input.keyword);
    if (input.label) query.set('label', input.label);
    return this.call({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      method: 'GET',
      path: `${ASSET_PATH}/list?${query.toString()}`,
      action: '读取数字资产',
    });
  }

  async detail(input: { baseUrl: string; apiKey: string; id: number }) {
    return this.call({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      method: 'GET',
      path: `${ASSET_PATH}/${input.id}`,
      action: '读取数字资产详情',
    });
  }

  /** 平台已有的标签全集（打标时的候选）。 */
  async labelOptions(input: { baseUrl: string; apiKey: string }) {
    const data = await this.call({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      method: 'GET',
      path: `${ASSET_PATH}/labels`,
      action: '读取资产标签',
    });
    return Array.isArray(data)
      ? data.map((item) => readText(item)).filter(Boolean)
      : [];
  }

  /** 更新资产（目前只用于改标签；平台 PUT 是局部更新）。 */
  async update(input: {
    baseUrl: string;
    apiKey: string;
    id: number;
    patch: Record<string, unknown>;
  }) {
    return this.call({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      method: 'PUT',
      path: `${ASSET_PATH}/${input.id}`,
      action: '更新数字资产',
      body: input.patch,
    });
  }

  /** 下载外链媒体（第三方渠道产物需要先转存到 AIPDD 才能登记）。 */
  async download(url: string) {
    let response;
    try {
      response = await httpRequest<Uint8Array>(url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        readAs: 'bytes',
        operation: 'content:downloadMedia',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '下载生成结果失败：链接不可访问或超时',
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `下载生成结果失败（HTTP ${response.status}）`,
      );
    }
    const bytes = response.data;
    if (!bytes.length) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '下载生成结果失败：内容为空',
      );
    }
    return bytes;
  }
}
