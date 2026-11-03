import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import type { ContentModel } from '@enterprise/contracts';
import { classifyModel, shortUpstreamMessage } from './content-shared';

const MODELS_TIMEOUT_MS = 20000;

type ChatProtocol = 'openai' | 'anthropic';

/** Anthropic 只提供对话/视觉模型，清单里也没有 aipdd 元数据，按文本+视觉归类。 */
function anthropicModel(entry: Record<string, unknown>): ContentModel {
  return {
    id: readText(entry.id).trim(),
    kind: 'text',
    vision: true,
    endpoints: ['/messages'],
  };
}

export function protocolHeaders(
  apiKey: string,
  protocol: ChatProtocol,
): Record<string, string> {
  if (protocol === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * 渠道模型目录：拿渠道 BaseURL 去拉 `GET {base}/models`，按每条模型的 `aipdd` 元数据
 * 归一成槽位口径（kind / vision / 声明的端点）。
 * 上游有什么模型只有它自己知道 —— 这里不写死模型名，也不按名字判断「能不能调」。
 */
export class ContentModelCatalogService {
  async list(
    baseUrl: string,
    apiKey: string,
    protocol: ChatProtocol = 'openai',
  ) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道地址为空');
    }
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该渠道还没有保存 Key：请先填写并保存密钥',
      );
    }
    let response;
    try {
      response = await httpRequest<string>(`${base}/models`, {
        headers: protocolHeaders(apiKey, protocol),
        timeoutMs: MODELS_TIMEOUT_MS,
        readAs: 'text',
        operation: 'content:models',
      });
    } catch (error) {
      if (error instanceof TransportError && error.kind === 'timeout') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `拉取模型列表超时（${MODELS_TIMEOUT_MS} ms）`,
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '拉取模型列表失败：渠道地址不可达',
      );
    }
    if (!response.ok) {
      // 上游鉴权失败不能回 401，否则前端会把已登录用户踢出会话
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `拉取模型列表失败（${shortUpstreamMessage(response.status, response.data)}）`,
      );
    }
    let payload: { data?: unknown };
    try {
      payload = JSON.parse(response.data) as { data?: unknown };
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型列表不是合法 JSON（渠道地址可能填成了网页地址）',
      );
    }
    const raw = Array.isArray(payload.data) ? payload.data : [];
    const models: ContentModel[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const meta = (entry.aipdd || {}) as Record<string, unknown>;
      if (meta.available === false) continue;
      const model =
        protocol === 'anthropic' ? anthropicModel(entry) : classifyModel(entry);
      if (!model.id) continue;
      models.push(model);
    }
    if (!models.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该渠道没有返回任何可用模型',
      );
    }
    return { baseUrl: base, models };
  }
}
