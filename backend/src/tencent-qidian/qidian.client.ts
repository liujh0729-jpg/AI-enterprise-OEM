import { createHmac } from 'node:crypto';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest, TransportError } from '../http/transport';

/**
 * 腾讯企点营销云 OpenAPI 客户端（统一网关）。
 *
 * 鉴权口径取自官方文档《通用参数说明》（tmc.qidian.qq.com doc 14613）：
 * 请求头 `corporationId` / `timestamp`（秒级，超 2 分钟失效）/ `sign` / `secretId`（可为空），
 * `sign = base64(HmacSHA256(corporationId + timestamp, secretKey))`，URL 必带 `bizId`（空间ID）。
 * SaaS 网关是 `https://tmc.qidian.qq.com/api/gateway/v1`，私有化环境＝客户域名 + 同一路径，
 * 所以基址存在凭据里由用户填，不写死。
 *
 * 响应统一是 `{ code, msg, data, requestId }`，`code === 0` 才算成功；
 * 上游原文只进日志，界面拿到的是中文（见 tp.service.ts 的 mapError）。
 */

const API_PATH = '/api/gateway/v1';
const DEFAULT_TIMEOUT_MS = 20000;
const RETRY_AFTER_MS = 600;
const logger = new Logger('TencentQidian');

export type QidianCreds = {
  gateway: string;
  corporationId: string;
  secretId: string;
  secretKey: string;
  bizId: string;
};

/** 企点网关 `/api/gateway/v1` 之后的上游路径；逐篇取自官方文档 OpenAPI 章节。 */
export const TP_PATHS = {
  // 客户数据平台 CDP
  cdpPropertyList: '/cdp-entity/user/property/list',
  cdpPropertyDetail: '/cdp-entity/user/property/queryDetail',
  cdpBehaviorTrace: '/cdp-entity/user/property/behaviorTrace',
  cdpUserTags: '/cdp-tag/tagDefine/getUserTagInfoSA',
  cdpCustomerCreate: '/cdp-entity/user/property/batchCreate',
  cdpCustomerUpdate: '/cdp-entity/user/property/batchEdit',
  cdpTagCreate: '/cdp-tag/tagDefine/external/create',
  cdpTagOperate: '/cdp-tag/tag/batch/operate',
  cdpCrowdList: '/cdp-crowd/list',
  cdpCrowdDetail: '/cdp-crowd/detail',
  cdpCrowdImport: '/cdp-crowd/import/v2',
  cdpCrowdExport: '/cdp-crowd/batchCrowd/export',
  taskRecord: '/data-suite-server/taskrecord/query/one',
  // 融合分析 FA（挂在同一网关）
  faPanels: '/apiserver/openapi/panels',
  faCards: '/apiserver/openapi/cards',
  faAnalysisQuery: '/apiserver/openapi/analysis/query',
  faAsyncResult: '/apiserver/openapi/analysis/card',
  // 企微互动 SCRM
  scrmCodeList: '/openapi/wm/web/activecode/getEmpActCodeList',
  scrmCodeCreate: '/openapi/wm/web/activecode/emp/createEmpActCode',
  scrmCodeUpdate: '/openapi/wm/web/activecode/emp/modifyEmpActCodeInfo',
  scrmCodeDelete: '/openapi/wm/web/activecode/batch-delete',
  scrmWelcome: '/openapi/wm/web/greeting/sendWelcomeMsg',
  scrmOrgList: '/api/dataauth/authserver/openapi/orgs/sync/retrieve/list',
  scrmMassList: '/wm-web/wm/web/task/mass/list',
  scrmMassStats: '/wm-web/wm/web/task/mass/stats',
  scrmMassExecution: '/wm-web/wm/web/task/mass/execution',
  scrmMassCreate: '/openapi/wm/web/masstask/customer/create',
  scrmMassUpdate: '/openapi/wm/web/masstask/customer/update',
  scrmMassStop: '/open/wm/web/masstask/stop',
  scrmMassRemind: '/open/wm/web/masstask/remind',
  scrmFollowupList: '/openapi/wm/web/task/followup/list',
  scrmFollowupCustomers: '/openapi/wm/web/task/followup/customers',
  scrmFollowupDone: '/openapi/wm/web/task/followup/done',
  // 会话分析 CA
  caMessageList: '/ca-web/message/list',
  caTagTaskList: '/ca-web/conversationTagTask/list',
  caTagTaskDetail: '/ca-web/conversationTagTask/detail',
  caResponseDuration: '/ca-lite/conversation/response-duration',
  // 会员忠诚度 LM
  lmProgramList: '/loyalty-member/loyalty/member/program/list',
  lmMemberList: '/loyalty-member/loyalty/member/list',
  lmMemberCreate: '/loyalty-member/loyalty/member/create',
  lmMemberUpdate: '/loyalty-member/loyalty/member/update',
  lmMemberActivate: '/loyalty-member/loyalty/member/activate',
  lmMemberInactivate: '/loyalty-member/loyalty/member/inactivate',
  lmPointRecord: '/loyalty-level/loyalty/point/record/list',
  lmPointGrant: '/loyalty-level/loyalty/point/grant',
  lmCouponList: '/loyalty-coupon/loyalty/benefits/template/list',
  lmCouponSend: '/loyalty-coupon/loyalty/benefits/send',
  // 营销自动化 MA
  maSmsChannels: '/ma-web/sms/channel/list',
  maEmailChannels: '/ma-web/email/channel/list',
  maEmailSenders: '/ma-web/email/address/list',
  maSmsTemplates: '/ma-web/sms/template/list',
  maEmailTemplates: '/ma-web/email/template/list',
  maSmsTemplateCreate: '/ma-web/sms/template/create',
  maEmailTemplateCreate: '/ma-web/email/template/create',
  maMassCreate: '/ma-web/task/mass/create',
  maLinkList: '/ma-web/linkMgt/list',
  maLinkCreate: '/ma-web/linkMgt/create',
  maLinkUpdate: '/ma-web/linkMgt/update',
  maLinkDelete: '/ma-web/linkMgt/delete',
  // 广告分析 RTA
  rtaCrowdImport: '/rta/crowd/open/import/v2',
  rtaCrowdList: '/rta/crowd/open/list',
} as const;

/** 连接测试用的只读探针：按产品挑一个不产生副作用的清单接口。 */
export const TP_PROBE_PATHS: Record<string, string> = {
  CDP: TP_PATHS.cdpPropertyList,
  SCRM: TP_PATHS.scrmCodeList,
  CA: TP_PATHS.caMessageList,
  LM: TP_PATHS.lmMemberList,
  MA: TP_PATHS.maSmsChannels,
  RTA: TP_PATHS.rtaCrowdList,
};

export class QidianError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId = '',
    readonly httpStatus = 0,
  ) {
    super(message);
  }
}

type RawResponse = Record<string, unknown>;

/** 企点里这些上游错误值得自动重试一次（与阿里云外呼同一口径）。 */
const RETRYABLE_CODES = [
  'InternalError',
  'ServiceUnavailable',
  'SystemError',
  'Throttling',
  'RequestTimeout',
];

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function qidianSign(
  corporationId: string,
  timestamp: number,
  secretKey: string,
): string {
  return createHmac('sha256', secretKey)
    .update(`${corporationId}${timestamp}`, 'utf8')
    .digest('base64');
}

function buildUrl(
  creds: QidianCreds,
  path: string,
  query: Record<string, unknown>,
): string {
  const base = `${(creds.gateway || '').replace(/\/+$/, '')}${API_PATH}${path}`;
  const params = new URLSearchParams();
  params.set('bizId', creds.bizId);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(
      key,
      typeof value === 'object' ? JSON.stringify(value) : text(value),
    );
  }
  return `${base}?${params.toString()}`;
}

export type QidianRows = {
  rows: Record<string, unknown>[];
  total: number;
  extra: Record<string, unknown>;
};

/**
 * 企点各产品的行结构不统一（list / records / rows / items / content），总数键名也不同；
 * 界面拿到的是同一形状，不写死上游字段名。
 */
export function pickRows(payload: RawResponse): QidianRows {
  const data = payload.data;
  const container = Array.isArray(data) ? null : record(data);
  const candidates: unknown[] = Array.isArray(data)
    ? [data]
    : [
        container?.list,
        container?.records,
        container?.rows,
        container?.items,
        container?.content,
        container?.data,
        payload.list,
        payload.records,
        payload.rows,
        payload.items,
      ];
  let rows: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const batch = list(candidate);
    if (batch.length) {
      rows = batch.map((item) => record(item));
      break;
    }
  }
  const total = num(
    container?.totalCount,
    num(
      container?.total,
      num(
        container?.totalNum,
        num(
          container?.totalSize,
          num(payload.totalCount, num(payload.total, rows.length)),
        ),
      ),
    ),
  );
  const extra: Record<string, unknown> = {
    code: str(payload.Code) || str(payload.code),
    requestId: str(payload.RequestId) || str(payload.requestId),
  };
  if (container) {
    for (const [key, value] of Object.entries(container)) {
      if (
        [
          'list',
          'records',
          'rows',
          'items',
          'content',
          'totalCount',
          'total',
          'totalNum',
          'totalSize',
        ].includes(key)
      ) {
        continue;
      }
      extra[key] = value;
    }
  }
  return { rows, total: total || rows.length, extra };
}

export class QidianClient {
  constructor(private readonly creds: QidianCreds) {}

  private assertCreds() {
    if (
      !this.creds.corporationId ||
      !this.creds.secretKey ||
      !this.creds.bizId
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置腾讯企点凭据（企业ID / secretKey / 空间ID），请先到「企点连接设置」填写',
      );
    }
    if (!/^https?:\/\//.test(this.creds.gateway || '')) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企点网关地址不完整，请到「企点连接设置」填写 https:// 开头的地址',
      );
    }
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    options: {
      query?: Record<string, unknown>;
      body?: unknown;
      retry?: boolean;
    } = {},
  ): Promise<RawResponse> {
    this.assertCreds();
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json;charset=UTF-8',
      corporationId: this.creds.corporationId,
      timestamp: String(timestamp),
      sign: qidianSign(
        this.creds.corporationId,
        timestamp,
        this.creds.secretKey,
      ),
    };
    if (this.creds.secretId) headers.secretId = this.creds.secretId;
    const url = buildUrl(this.creds, path, options.query || {});
    const body =
      method === 'POST' && options.body !== undefined
        ? typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
        : undefined;

    const attempt = async () => {
      const response = await httpRequest<RawResponse>(url, {
        method,
        headers,
        body,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        readAs: 'json',
        operation: `tencent-qidian:${path}`,
        concurrency: 4,
      });
      const payload = record(response.data);
      const rawCode = payload.code ?? payload.Code;
      const code = str(rawCode);
      const ok =
        response.ok &&
        (code === '' || code === '0' || code === 'OK' || code === 'Success');
      if (!ok) {
        throw new QidianError(
          code || `HTTP_${response.status}`,
          str(payload.msg) ||
            str(payload.Message) ||
            `企点返回 HTTP ${response.status}`,
          str(payload.requestId) || str(payload.RequestId),
          response.status,
        );
      }
      return payload;
    };

    try {
      return await attempt();
    } catch (error) {
      if (!options.retry) throw error;
      const retryable =
        error instanceof TransportError ||
        (error instanceof QidianError && RETRYABLE_CODES.includes(error.code));
      if (!retryable) throw error;
      logger.warn({
        path,
        kind: 'retry-once',
        code: (error as { code?: string }).code,
      });
      await sleep(RETRY_AFTER_MS);
      return attempt();
    }
  }

  async get(
    path: string,
    query: Record<string, unknown> = {},
  ): Promise<RawResponse> {
    return this.call('GET', path, { query, retry: true });
  }

  async post(
    path: string,
    body: unknown = {},
    query: Record<string, unknown> = {},
  ): Promise<RawResponse> {
    return this.call('POST', path, { body, query, retry: true });
  }

  /** 不做自动重试的写动作（花钱、真触达：重复提交比失败更糟）。 */
  async postOnce(path: string, body: unknown): Promise<RawResponse> {
    return this.call('POST', path, { body, retry: false });
  }

  async rows(
    method: 'GET' | 'POST',
    path: string,
    input: Record<string, unknown>,
  ): Promise<QidianRows> {
    const payload =
      method === 'GET'
        ? await this.get(path, input)
        : await this.post(path, input);
    return pickRows(payload);
  }

  async object(
    method: 'GET' | 'POST',
    path: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const payload =
      method === 'GET'
        ? await this.get(path, input)
        : await this.post(path, input);
    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return {
        ...record(data),
        requestId: str(payload.requestId) || str(payload.RequestId),
      };
    }
    return {
      data: data ?? null,
      requestId: str(payload.requestId) || str(payload.RequestId),
    };
  }

  /** 导入/导出类异步任务的状态查询（CDP 与 FA 共用同一个任务记录接口）。 */
  async taskRecord(taskId: string): Promise<Record<string, unknown>> {
    return this.object('POST', TP_PATHS.taskRecord, { taskId });
  }
}

/** 企点任务记录里表示「这一轮不用再查了」的状态；其余按仍在执行处理。 */
export const TASK_RECORD_DONE_WORDS = [
  'SUCCESS',
  'SUCCEEDED',
  'FINISHED',
  'COMPLETED',
  'DONE',
  'FAILED',
  'FAILURE',
  'ERROR',
  'CANCELLED',
];

export function isTaskRecordDone(record: Record<string, unknown>): boolean {
  const status = str(
    record.status ?? record.taskStatus ?? record.State ?? record.state,
  ).toUpperCase();
  return TASK_RECORD_DONE_WORDS.some((word) => status.includes(word));
}
