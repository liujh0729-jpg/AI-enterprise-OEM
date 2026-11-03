import { BusinessException } from '../common/business.exception';
import { buildSignedBody } from '../common/aliyun-rpc';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest, TransportError } from '../http/transport';

/**
 * 阿里云邮件推送（Direct Mail 2015-11-23）RPC 客户端。
 *
 * 与智能外呼共用 `common/aliyun-rpc.ts` 的 HMAC-SHA1 签名器；差异只在
 * Host / Version / Action。每个登录账号用自己的 RAM 子账号 AK。
 *
 * 业务侧只走：QueryReceiverByParam / CreateReceiver / SaveReceiverDetail /
 * QueryMailAddressByParam。发送、模板、域名一律不进本系统。
 */

const API_VERSION = '2015-11-23';
const API_PATH = '/';
const DEFAULT_TIMEOUT_MS = 15000;
const logger = new Logger('AliyunDirectMail');

/**
 * 邮件推送按地域区分 Endpoint，必须与控制台区域一致。
 * 悉尼（ap-southeast-2）已关停，不再列入。
 */
export const DIRECTMAIL_REGIONS = [
  { code: 'cn-hangzhou', label: '华东 1（杭州）', host: 'dm.aliyuncs.com' },
  {
    code: 'ap-southeast-1',
    label: '新加坡',
    host: 'dm.ap-southeast-1.aliyuncs.com',
  },
  {
    code: 'us-east-1',
    label: '美国（弗吉尼亚）',
    host: 'dm.us-east-1.aliyuncs.com',
  },
  {
    code: 'eu-central-1',
    label: '德国（法兰克福）',
    host: 'dm.eu-central-1.aliyuncs.com',
  },
] as const;

/** 单个收件人列表最多 10000 个地址（账号级硬限）。 */
export const RECEIVER_CAPACITY = 10000;
/** SaveReceiverDetail 文档硬上限。 */
export const SAVE_BATCH_LIMIT = 500;

export type DirectMailCreds = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

export type DmReceiver = {
  receiverId: string;
  receiverName: string;
  receiverAlias: string;
  count: number;
  createTime: string;
};

export type DmSenderAddress = {
  accountName: string;
  mailAddressId: string;
  accountStatus: string;
  domainStatus: string;
  sendType: string;
  dailyCount: number;
  dailyReqCount: number;
  monthCount: number;
  monthReqCount: number;
  createTime: string;
};

export type DmSaveItem = {
  email: string;
  /** 模板变量；空对象表示只写邮箱。 */
  data: Record<string, string>;
};

export class DirectMailError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId = '',
  ) {
    super(message);
  }
}

type RawResponse = Record<string, unknown>;

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

export class DirectMailClient {
  constructor(private readonly creds: DirectMailCreds) {}

  private async call(
    action: string,
    params: Record<string, unknown> = {},
    options: { retry?: boolean } = {},
  ): Promise<RawResponse> {
    const { accessKeySecret, accessKeyId, region } = this.creds;
    if (!accessKeyId || !accessKeySecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置阿里云 AccessKey，请先到「邮件设置」填写',
      );
    }
    const endpoint = DIRECTMAIL_REGIONS.find((item) => item.code === region);
    if (!endpoint) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '不支持该邮件推送地域，请到「邮件设置」选择与控制台一致的区域',
      );
    }
    const body = buildSignedBody({
      action,
      version: API_VERSION,
      accessKeyId,
      accessKeySecret,
      params,
    });

    const attempt = async () => {
      const response = await httpRequest<RawResponse>(
        `https://${endpoint.host}${API_PATH}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          readAs: 'json',
          operation: `aliyun-directmail:${action}`,
          concurrency: 2,
        },
      );
      const payload = record(response.data);
      const code = str(payload.Code);
      const ok = payload.Success !== false && (!code || code === 'OK');
      if (!response.ok || !ok) {
        throw new DirectMailError(
          code || `HTTP_${response.status}`,
          str(payload.Message) || `阿里云返回 HTTP ${response.status}`,
          str(payload.RequestId),
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
        (error instanceof DirectMailError &&
          ['InternalError', 'ServiceUnavailable', 'Throttling'].includes(
            error.code,
          ));
      if (!retryable) throw error;
      logger.warn({
        action,
        kind: 'retry-once',
        code: (error as { code?: string }).code,
      });
      await sleep(400);
      return attempt();
    }
  }

  async listReceivers(keyWord = ''): Promise<DmReceiver[]> {
    const payload = await this.call(
      'QueryReceiverByParam',
      { PageSize: 50, ...(keyWord.trim() ? { KeyWord: keyWord.trim() } : {}) },
      { retry: true },
    );
    const container = record(payload.data);
    return list(container.receiver).map((raw) => {
      const item = record(raw);
      return {
        receiverId: str(item.ReceiverId),
        receiverName: str(item.ReceiversName),
        receiverAlias: str(item.ReceiversAlias),
        count: num(item.Count),
        createTime: str(item.CreateTime),
      } satisfies DmReceiver;
    });
  }

  async createReceiver(input: {
    name: string;
    alias: string;
    description?: string;
  }): Promise<{ receiverId: string }> {
    const payload = await this.call('CreateReceiver', {
      ReceiversName: input.name,
      ReceiversAlias: input.alias,
      ...(input.description ? { Desc: input.description } : {}),
    });
    const receiverId = str(payload.ReceiverId);
    if (!receiverId) {
      throw new DirectMailError(
        'MissingReceiverId',
        '阿里云未返回收件人列表 ID',
        str(payload.RequestId),
      );
    }
    return { receiverId };
  }

  async listSenderAddresses(): Promise<DmSenderAddress[]> {
    const payload = await this.call(
      'QueryMailAddressByParam',
      { PageNo: 1, PageSize: 50 },
      { retry: true },
    );
    const container = record(payload.data);
    return list(container.mailAddress).map((raw) => {
      const item = record(raw);
      return {
        accountName: str(item.AccountName),
        mailAddressId: str(item.MailAddressId),
        accountStatus: str(item.AccountStatus),
        domainStatus: str(item.DomainStatus),
        sendType: str(item.Sendtype),
        dailyCount: num(item.DailyCount),
        dailyReqCount: num(item.DailyReqCount),
        monthCount: num(item.MonthCount),
        monthReqCount: num(item.MonthReqCount),
        createTime: str(item.CreateTime),
      } satisfies DmSenderAddress;
    });
  }

  /** 单批 ≤500；重复邮箱只会计入错误数，不会重复写入，因此重试安全。 */
  async saveReceiverDetail(input: {
    receiverId: string;
    items: DmSaveItem[];
  }): Promise<{
    successCount: number;
    errorCount: number;
    failures: { email: string; message: string }[];
  }> {
    if (!input.items.length) {
      return { successCount: 0, errorCount: 0, failures: [] };
    }
    if (input.items.length > SAVE_BATCH_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单批最多写入 ${SAVE_BATCH_LIMIT} 个收件人，请分批提交`,
      );
    }
    const payload = await this.call(
      'SaveReceiverDetail',
      {
        ReceiverId: input.receiverId,
        CustomDetail: JSON.stringify(
          input.items.map((item) => ({
            Email: item.email,
            ...(Object.keys(item.data).length ? { CustomData: item.data } : {}),
          })),
        ),
      },
      { retry: true },
    );
    const failures = list(record(payload.Data).Detail).map((raw) => {
      const item = record(raw);
      return {
        email: str(item.Email),
        message: str(item.ErrMessage) || '阿里云未返回原因',
      };
    });
    return {
      successCount: num(payload.SuccessCount),
      errorCount: num(payload.ErrorCount),
      failures,
    };
  }
}
