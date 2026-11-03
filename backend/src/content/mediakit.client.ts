import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';

const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 10_000;
/** 生成式超分平均 RTF 15–20，1 分钟片要 15–20 分钟，给足 60 分钟。 */
const MAX_WAIT_MS = 60 * 60 * 1000;

const ENHANCE_PATH = '/tools/enhance-video-generative';
const ERASE_PATH = '/tools/erase-video-subtitle-pro';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrap(body: string, action: string) {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${action}失败：MediaKit 返回的不是合法 JSON`,
    );
  }
  if (payload.success === false) {
    const error = payload.error as Record<string, unknown> | undefined;
    const message =
      (error && typeof error.message === 'string' && error.message) ||
      readText(payload.message);
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${action}失败${message ? `：${message.slice(0, 120)}` : ''}`,
    );
  }
  const result = payload.result;
  return (result && typeof result === 'object' ? result : payload) as Record<
    string,
    unknown
  >;
}

/**
 * 火山 AI MediaKit：生成式视频超分与字幕/文字擦除。
 * 纯第三方 HTTP，只需配置 API Key（模型设置里的 MediaKit 渠道），不装任何本地组件。
 * 源视频用公网直链（本系统上传的素材/AIPDD 直链都可），不需要再走 MediaKit 上传口。
 */
export class MediaKitClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async submit(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ) {
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    let response;
    try {
      response = await httpRequest<string>(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        timeoutMs: SUBMIT_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:mediakitSubmit',
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `${action}失败：MediaKit 不可达或超时`,
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `${action}失败（HTTP ${response.status}）`,
      );
    }
    return unwrap(response.data, action);
  }

  private async poll(taskId: string, action: string) {
    const base = this.baseUrl.replace(/\/+$/, '');
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      let payload: Record<string, unknown>;
      try {
        const response = await httpRequest<string>(`${base}/tasks/${taskId}`, {
          headers: this.headers(),
          timeoutMs: 30_000,
          readAs: 'text',
          operation: 'content:mediakitPoll',
        });
        if (!response.ok) continue;
        payload = JSON.parse(response.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const result = (payload.result || {}) as Record<string, unknown>;
      const videoUrl = readText(result.video_url || result.url).trim();
      if (videoUrl) return videoUrl;
      const status = readText(payload.status).toLowerCase();
      if (status === 'failed' || status === 'error') {
        const error = (payload.error || {}) as Record<string, unknown>;
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `${action}失败${error.message ? `：${readText(error.message).slice(0, 120)}` : ''}`,
        );
      }
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${action}超时未完成（MediaKit 排队较久，可稍后重试）`,
    );
  }

  private async run(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ) {
    const result = await this.submit(path, body, action);
    const direct = readText(result.video_url || result.url).trim();
    if (direct) return direct;
    const taskId = readText(result.task_id || result.id).trim();
    if (!taskId) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `${action}失败：MediaKit 没有返回任务编号`,
      );
    }
    return this.poll(taskId, action);
  }

  enhance(input: { videoUrl: string; resolution: string }) {
    return this.run(
      ENHANCE_PATH,
      { video_url: input.videoUrl, resolution: input.resolution },
      '视频超分',
    );
  }

  erase(input: { videoUrl: string; mode: string; box?: string }) {
    const body: Record<string, unknown> = {
      video_url: input.videoUrl,
      mode: input.mode === 'Text' ? 'Text' : 'Subtitle',
    };
    if (input.box) {
      const parts = input.box
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((value) => Number.isFinite(value));
      if (parts.length === 4) body.erase_ratio_location = parts;
    }
    return this.run(ERASE_PATH, body, '视频擦除');
  }
}
