import { httpRequest } from '../http/transport';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  BIGDATA_DATASETS,
  type BigdataDatasetKey,
} from '@enterprise/contracts';

/**
 * AIPDD 企业大数据平台（`E:\wwwroot\bigdata`）的查询客户端。
 *
 * 契约（实测于 https://bigdata.aiworkin.com）：`POST /api/<dataset>/query`，
 * 请求体是该数据集的筛选字段 + `page` / `limit`（`limit` 覆盖 `page_size`，硬上限 2000），
 * 返回统一信封 `{ status, data, total, error_message, total_capped }`。
 * 平台侧鉴权按 `api_token` 配置，线上当前为空＝开放通道，Enterprise 侧不带任何凭据。
 */

const BIGDATA_BASE_URL = 'https://bigdata.aiworkin.com';
/** 单次查询超时：大表 LIKE 扫描最慢的一次实测在秒级，给到 60s 富余。 */
const QUERY_TIMEOUT_MS = 60000;
/** 上游 `limit` 的硬上限（超过会被请求模型拒成 422）。 */
export const BIGDATA_MAX_LIMIT = 2000;

export type BigdataQueryResult = {
  rows: Record<string, unknown>[];
  /** 命中总行数；`totalCapped` 为真时只表示「至少这么多」（上游对无筛选大表截到 100 万）。 */
  total: number;
  totalCapped: boolean;
};

/** 测试专用：套件里指向本地桩，真实部署不会设置这个变量。 */
export function bigdataBaseUrl() {
  return String(process.env.BIGDATA_BASE_URL || '').trim() || BIGDATA_BASE_URL;
}

export async function queryBigdata(
  dataset: BigdataDatasetKey,
  filters: Record<string, unknown>,
  limit: number,
): Promise<BigdataQueryResult> {
  const definition = BIGDATA_DATASETS[dataset];
  const body: Record<string, unknown> = {
    ...filters,
    page: 1,
    limit: Math.min(Math.max(1, Math.floor(limit)), BIGDATA_MAX_LIMIT),
  };
  const response = await httpRequest<Record<string, unknown>>(
    `${bigdataBaseUrl()}${definition.upstreamPath}`,
    {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: QUERY_TIMEOUT_MS,
      concurrency: 2,
      limiterKey: 'bigdata:query',
      operation: `bigdata:${dataset}`,
    },
  );
  const payload = response.data || {};
  if (!response.ok || text(payload.status) !== 'ok') {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      `${definition.label}查询失败：${text(payload.error_message) || `大数据平台返回 ${response.status}`}`,
    );
  }
  const rows = Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>[])
    : [];
  return {
    rows,
    total: Number(payload.total) || 0,
    totalCapped: Boolean(payload.total_capped),
  };
}
