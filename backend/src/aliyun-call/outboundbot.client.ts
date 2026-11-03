import { BusinessException } from '../common/business.exception';
import { buildSignedBody } from '../common/aliyun-rpc';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest, TransportError } from '../http/transport';

export { canonicalQuery, percentEncode, signRpc } from '../common/aliyun-rpc';

/**
 * 阿里云智能外呼（OutboundBot 2019-12-26）RPC 客户端。
 *
 * 后端没有引入阿里云 SDK，这里按官方 RPC 签名（HMAC-SHA1）自实现：
 * 参数按 key 字典序 → RFC3986 编码 → `POST&%2F&<query>` → HMAC-SHA1 → Base64。
 * 签名器与邮件推送共用 `common/aliyun-rpc.ts`；每个登录账号用自己的 RAM 子账号 AK。
 *
 * 业务侧只走：ListInstances / QueryScriptsByStatus / ListOutboundCallNumbers /
 * ListJobGroups / DescribeJobGroup / CreateJobGroup / AssignJobs。
 */

const API_VERSION = '2019-12-26';
const API_HOST = (region: string) => `outboundbot.${region}.aliyuncs.com`;
const API_PATH = '/';
const DEFAULT_TIMEOUT_MS = 15000;
const logger = new Logger('AliyunOutboundBot');

/** 阿里云智能外呼只在上海（cn-shanghai）开放，其他地域的域名不存在。 */
export const OUTBOUNDBOT_REGIONS = [
  { code: 'cn-shanghai', label: '华东 2（上海）' },
] as const;

export type OutboundBotCreds = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

export type ObInstance = { instanceId: string; name: string };
export type ObScript = { scriptId: string; name: string; status: string };
export type ObNumber = { number: string; bound: boolean };
export type ObJobGroup = {
  jobGroupId: string;
  jobGroupName: string;
  jobGroupStatus: string;
  scriptId: string;
  scriptName: string;
  totalJobs: number;
  completedJobs: number;
  creationTime: number;
  appendable: boolean;
};
export type ObJobGroupStatus = {
  jobGroupId: string;
  jobGroupStatus: string;
  totalJobs: number;
  completedJobs: number;
  executing: number;
  scheduling: number;
  failed: number;
  paused: number;
  cancelled: number;
};
export type ObAssignJob = {
  referenceId: string;
  phoneNumber: string;
  name?: string;
  role?: string;
  honorific?: string;
  extras: { key: string; value: string }[];
};

/** 已完成/失败/取消的任务组不再接受追加（阿里云未承诺可用）。 */
export const APPENDABLE_STATUSES = [
  'Draft',
  'Initializing',
  'Scheduling',
  'Executing',
  'Paused',
] as const;

export class OutboundBotError extends Error {
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

export class OutboundBotClient {
  constructor(private readonly creds: OutboundBotCreds) {}

  private async call(
    action: string,
    params: Record<string, unknown> = {},
    options: { retry?: boolean } = {},
  ): Promise<RawResponse> {
    const { accessKeySecret, accessKeyId, region } = this.creds;
    if (!accessKeyId || !accessKeySecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置阿里云 AccessKey，请先到「外呼设置」填写',
      );
    }
    if (!OUTBOUNDBOT_REGIONS.some((item) => item.code === region)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '阿里云智能外呼仅支持华东 2（上海），请到「外呼设置」重新保存',
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
        `https://${API_HOST(region)}${API_PATH}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          readAs: 'json',
          operation: `aliyun-outboundbot:${action}`,
          concurrency: 4,
        },
      );
      const payload = record(response.data);
      const code = str(payload.Code);
      const ok = payload.Success !== false && (!code || code === 'OK');
      if (!response.ok || !ok) {
        throw new OutboundBotError(
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
        (error instanceof OutboundBotError &&
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

  async listInstances(): Promise<ObInstance[]> {
    const items: ObInstance[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const payload = await this.call(
        'ListInstances',
        { PageNumber: page, PageSize: 50 },
        { retry: true },
      );
      const batch = list(payload.Instances);
      for (const raw of batch) {
        const item = record(raw);
        const instanceId = str(item.InstanceId);
        if (!instanceId) continue;
        items.push({
          instanceId,
          name: str(item.InstanceName) || instanceId,
        });
      }
      const total = num(payload.TotalCount, items.length);
      if (!batch.length || items.length >= total) break;
    }
    return items;
  }

  async listPublishedScripts(instanceId: string): Promise<ObScript[]> {
    if (!instanceId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    const items: ObScript[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const payload = await this.call(
        'QueryScriptsByStatus',
        {
          InstanceId: instanceId,
          PageNumber: page,
          PageSize: 50,
          StatusList: ['PUBLISHED'],
        },
        { retry: true },
      );
      const scripts = record(payload.Scripts);
      const batch = list(scripts.List);
      for (const raw of batch) {
        const item = record(raw);
        const scriptId = str(item.ScriptId);
        if (!scriptId) continue;
        items.push({
          scriptId,
          name: str(item.ScriptName) || scriptId,
          status: str(item.Status) || 'PUBLISHED',
        });
      }
      const total = num(scripts.TotalCount, items.length);
      if (!batch.length || items.length >= total) break;
    }
    return items;
  }

  async listCallingNumbers(instanceId: string): Promise<ObNumber[]> {
    if (!instanceId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    const items: ObNumber[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const payload = await this.call(
        'ListOutboundCallNumbers',
        { InstanceId: instanceId, PageNumber: page, PageSize: 50 },
        { retry: true },
      );
      const container = record(payload.OutboundCallNumbers);
      const batch = list(container.List);
      for (const raw of batch) {
        const number = str(record(raw).Number);
        if (!number) continue;
        items.push({ number, bound: true });
      }
      const total = num(container.TotalCount, items.length);
      if (!batch.length || items.length >= total) break;
    }
    return items;
  }

  async listJobGroups(input: {
    instanceId: string;
    search: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: ObJobGroup[]; total: number }> {
    if (!input.instanceId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择阿里云业务实例',
      );
    }
    const payload = await this.call(
      'ListJobGroups',
      {
        InstanceId: input.instanceId,
        PageNumber: input.page,
        PageSize: input.pageSize,
        ...(input.search ? { SearchText: input.search } : {}),
      },
      { retry: true },
    );
    const container = record(payload.JobGroups);
    const items = list(container.List).map((raw) => {
      const item = record(raw);
      const progress = record(item.Progress);
      const status = str(item.Status);
      return {
        jobGroupId: str(item.JobGroupId),
        jobGroupName: str(item.JobGroupName) || str(item.JobGroupId),
        jobGroupStatus: status,
        scriptId: str(item.ScriptId),
        scriptName: str(item.ScriptName),
        totalJobs: num(progress.TotalJobs, num(item.TotalCallNum)),
        completedJobs: num(progress.TotalCompleted),
        creationTime: num(item.CreationTime),
        appendable: APPENDABLE_STATUSES.includes(
          status as (typeof APPENDABLE_STATUSES)[number],
        ),
      } satisfies ObJobGroup;
    });
    return { list: items, total: num(container.TotalCount, items.length) };
  }

  async describeJobGroup(
    instanceId: string,
    jobGroupId: string,
  ): Promise<ObJobGroupStatus> {
    const payload = await this.call(
      'DescribeJobGroup',
      { InstanceId: instanceId, JobGroupId: jobGroupId },
      { retry: true },
    );
    const group = record(payload.JobGroup);
    const progress = record(group.Progress);
    return {
      jobGroupId: str(group.JobGroupId) || jobGroupId,
      jobGroupStatus: str(group.Status),
      totalJobs: num(progress.TotalJobs),
      completedJobs: num(progress.TotalCompleted),
      executing: num(progress.Executing, num(progress.ExecutingNum)),
      scheduling: num(progress.Scheduling),
      failed: num(progress.Failed, num(progress.FailedNum)),
      paused: num(progress.Paused, num(progress.PausedNum)),
      cancelled: num(progress.Cancelled, num(progress.CancelledNum)),
    };
  }

  async createJobGroup(input: {
    instanceId: string;
    name: string;
    description?: string;
    scriptId: string;
    /** 已序列化的 StrategyJson；不传＝立即开始、全时段。 */
    strategyJson?: string;
    callingNumbers: string[];
  }): Promise<{ jobGroupId: string; status: string }> {
    if (!input.instanceId || !input.scriptId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '创建任务组需要业务实例和已发布话术',
      );
    }
    if (!input.name.trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务组名称');
    }
    const payload = await this.call('CreateJobGroup', {
      InstanceId: input.instanceId,
      JobGroupName: input.name.trim(),
      ...(input.description ? { JobGroupDescription: input.description } : {}),
      ScriptId: input.scriptId,
      ...(input.strategyJson ? { StrategyJson: input.strategyJson } : {}),
      ...(input.callingNumbers.length
        ? { CallingNumber: input.callingNumbers }
        : {}),
    });
    const group = record(payload.JobGroup);
    const jobGroupId = str(payload.JobGroupId) || str(group.JobGroupId);
    if (!jobGroupId) {
      throw new OutboundBotError(
        'MissingJobGroupId',
        '阿里云未返回任务组 ID',
        str(payload.RequestId),
      );
    }
    return {
      jobGroupId,
      status: str(payload.Status) || str(group.Status),
    };
  }

  /** 单批最多 99 条（文档硬上限），业务层按 25 条切分。 */
  async assignJobs(input: {
    instanceId: string;
    jobGroupId: string;
    jobs: ObAssignJob[];
    callingNumbers?: string[];
    strategyJson?: string;
  }): Promise<{ jobsId: string[] }> {
    if (!input.jobs.length) return { jobsId: [] };
    if (input.jobs.length > 99) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单批最多提交 99 条号码，请分批提交',
      );
    }
    const payload = await this.call('AssignJobs', {
      InstanceId: input.instanceId,
      JobGroupId: input.jobGroupId,
      RosterType: 'json',
      JobsJson: JSON.stringify(
        input.jobs.map((job) => ({
          ...(job.extras.length ? { extras: job.extras } : {}),
          contacts: [
            {
              phoneNumber: job.phoneNumber,
              referenceId: job.referenceId,
              ...(job.name ? { name: job.name } : {}),
              ...(job.role ? { role: job.role } : {}),
              ...(job.honorific ? { honorific: job.honorific } : {}),
            },
          ],
        })),
      ),
      ...(input.callingNumbers?.length
        ? { CallingNumber: input.callingNumbers }
        : {}),
      ...(input.strategyJson ? { StrategyJson: input.strategyJson } : {}),
    });
    return { jobsId: list(payload.JobsId).map((item) => str(item)) };
  }
}
