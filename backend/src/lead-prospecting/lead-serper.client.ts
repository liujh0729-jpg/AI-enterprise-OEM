import { httpRequest, TransportError } from '../http/transport';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * Serper.dev Google 搜索客户端（潜客线索挖掘用）。
 *
 * 参考 `E:\wwwroot\bigdata\services\b2b_service.py` 的接口形态：
 * `POST https://google.serper.dev/search` + `X-API-KEY` 头，返回 `organic` 数组。
 * Enterprise 侧 Key 由用户自填（`lead_prospecting_settings.serper_key_cipher`），
 * 不做后台轮转（多 Key 轮转留给后续接入，见 [[project-aiworkin-ledger]]）。
 */
const SERPER_URL = 'https://google.serper.dev/search';
const SEARCH_TIMEOUT_MS = 30000;

/** 支持的国家码（与 bigdata 的 _COUNTRY_MAP 对齐，界面按下拉呈现） */
export const SUPPORTED_COUNTRIES = [
  { code: 'cn', label: '中国' },
  { code: 'us', label: '美国' },
  { code: 'uk', label: '英国' },
  { code: 'jp', label: '日本' },
  { code: 'kr', label: '韩国' },
  { code: 'de', label: '德国' },
  { code: 'fr', label: '法国' },
];

const COUNTRY_LANGUAGE: Record<string, string> = {
  cn: 'zh-cn',
  us: 'en',
  uk: 'en',
  jp: 'ja',
  kr: 'ko',
  de: 'de',
  fr: 'fr',
};

const COUNTRY_LOCATION: Record<string, string> = {
  cn: 'China',
  us: 'United States',
  uk: 'United Kingdom',
  jp: 'Japan',
  kr: 'Korea',
  de: 'Germany',
  fr: 'France',
};

export type SerperOrganicResult = {
  title: string;
  link: string;
  snippet: string;
  position?: number;
};

/** 单条搜索请求。key 由上层从密文里解出后传入；本模块不落日志、不回显。 */
export async function serperSearch(
  apiKey: string,
  query: string,
  country: string,
  num: number,
): Promise<SerperOrganicResult[]> {
  if (!apiKey) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请先在「Google 潜客」设置里填写 Serper API Key',
    );
  }
  const payload: Record<string, unknown> = {
    q: query,
    gl: country || 'cn',
    hl: COUNTRY_LANGUAGE[country] || 'zh-cn',
    num: Math.max(1, Math.min(num || 10, 100)),
  };
  const location = COUNTRY_LOCATION[country];
  if (location) payload.location = location;
  try {
    const response = await httpRequest<string>(SERPER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(payload),
      timeoutMs: SEARCH_TIMEOUT_MS,
      readAs: 'text',
      concurrency: 1,
      limiterKey: 'serper:default',
      operation: 'lead:serper-search',
    });
    const raw = response.data;
    if (!response.ok) {
      const detail = String(raw || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      // 上游鉴权/额度失败不能回 401：前端对 code 401 会把已登录用户踢出会话
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `Serper 返回 HTTP ${response.status}：${detail || '无返回内容'}`,
      );
    }
    let parsed: { organic?: unknown };
    try {
      parsed = JSON.parse(raw) as { organic?: unknown };
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Serper 返回的不是合法 JSON',
      );
    }
    const list = Array.isArray(parsed.organic) ? parsed.organic : [];
    return list
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          title: text(row?.title),
          link: text(row?.link),
          snippet: text(row?.snippet),
          position:
            row?.position === undefined ? undefined : Number(row.position),
        };
      })
      .filter((item) => item.link);
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (error instanceof TransportError && error.kind === 'timeout') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Serper 搜索超时（${SEARCH_TIMEOUT_MS} ms）`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `Serper 无法访问：${(error as Error)?.message || '网络异常'}`,
    );
  }
}
