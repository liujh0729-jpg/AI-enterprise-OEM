import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import {
  wbCreateAgent,
  wbCreateAgentVersion,
  wbDeleteAgent,
  wbDescribeAgent,
  wbDescribeAgentList,
  wbDescribeAgentVersionList,
  wbDescribeBuiltinModelList,
  wbDescribeConnectorList,
  wbDescribeExpertList,
  wbDescribeSkillList,
  wbModifyAgent,
} from './workbuddy-client';
import { WorkbuddyAccountService } from './workbuddy-account.service';
import { MAX_MANIFEST_BYTES } from './workbuddy-shared';

/**
 * Agent 与版本全部放在腾讯云侧：用用户自己的 SecretId/SecretKey 签名，
 * 拿到的就是那个企业的 Agent 集合，本系统只做参数校验与审计，不复制一份到本地库。
 */
export class WorkbuddyAgentService {
  constructor(
    private readonly accounts: WorkbuddyAccountService,
    private readonly identity: IdentityService,
  ) {}

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const accountId = requireId(query.accountId, '请先选择 Workbuddy 凭据');
    const { creds } = await this.accounts.credsOf(user, accountId);
    const offset = pageNumber(query.offset, 0);
    const limit = pageNumber(query.limit, 20);
    const result = await wbDescribeAgentList(creds, {
      offset,
      limit,
      keyword: text(query.keyword).trim(),
    });
    return {
      total: Number(result.TotalCount || 0),
      items: Array.isArray(result.AgentSet) ? result.AgentSet : [],
      offset,
      limit,
    };
  }

  async detail(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const agentId = requireText(query.agentId, '请先选择 Agent');
    return wbDescribeAgent(creds, agentId);
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const accountId = requireId(body.accountId, '请先选择 Workbuddy 凭据');
    const { creds } = await this.accounts.credsOf(user, accountId);
    const agentName = text(body.agentName).trim().slice(0, 128);
    if (!agentName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写 Agent 名称');
    }
    const manifest = optionalManifest(body.manifest);
    const connectorIds = idStrings(body.connectorIds);
    if (connectorIds.length && !manifest) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '勾选了连接器就必须同时提供 Manifest（腾讯云要求连接器物化进 manifest）',
      );
    }
    const created = await wbCreateAgent(creds, {
      agentName,
      description: text(body.description).trim().slice(0, 1000),
      avatarUrl: text(body.avatarUrl).trim().slice(0, 500),
      model: text(body.model).trim().slice(0, 100),
      manifest,
      connectorIds,
      accountId: text(body.oneIdAccount).trim().slice(0, 64),
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy创建Agent',
      `${agentName}（${created.AgentId || '无回传 ID'}）`,
    );
    return created;
  }

  async update(user: CurrentUser, body: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(body.accountId, '请先选择 Workbuddy 凭据'),
    );
    const agentId = requireText(body.agentId, '请先选择 Agent');
    const patch: {
      agentName?: string;
      description?: string;
      avatarUrl?: string;
    } = {};
    if (body.agentName !== undefined) {
      const agentName = text(body.agentName).trim().slice(0, 128);
      if (!agentName) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'Agent 名称不能为空',
        );
      }
      patch.agentName = agentName;
    }
    if (body.description !== undefined) {
      patch.description = text(body.description).trim().slice(0, 1000);
    }
    if (body.avatarUrl !== undefined) {
      patch.avatarUrl = text(body.avatarUrl).trim().slice(0, 500);
    }
    if (!Object.keys(patch).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await wbModifyAgent(creds, agentId, patch);
    await this.identity.audit(
      user.userId,
      'Workbuddy修改Agent',
      `${agentId} ${saved.AgentName || ''}`,
    );
    return saved;
  }

  async remove(user: CurrentUser, body: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(body.accountId, '请先选择 Workbuddy 凭据'),
    );
    const agentId = requireText(body.agentId, '请先选择 Agent');
    await wbDeleteAgent(creds, agentId);
    await this.identity.audit(user.userId, 'Workbuddy删除Agent', agentId);
    return { agentId };
  }

  async versions(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const agentId = requireText(query.agentId, '请先选择 Agent');
    const offset = pageNumber(query.offset, 0);
    const limit = pageNumber(query.limit, 20);
    const result = await wbDescribeAgentVersionList(creds, {
      agentId,
      offset,
      limit,
    });
    return {
      total: Number(result.TotalCount || 0),
      items: Array.isArray(result.AgentVersionSet)
        ? result.AgentVersionSet
        : [],
      offset,
      limit,
    };
  }

  async createVersion(user: CurrentUser, body: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(body.accountId, '请先选择 Workbuddy 凭据'),
    );
    const agentId = requireText(body.agentId, '请先选择 Agent');
    const manifest = requireManifest(body.manifest);
    const version = await wbCreateAgentVersion(creds, {
      agentId,
      manifest,
      model: text(body.model).trim().slice(0, 100),
      description: text(body.description).trim().slice(0, 500),
      sandboxTemplateId: text(body.sandboxTemplateId).trim().slice(0, 64),
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy新建Agent版本',
      `${agentId} ${version.VersionName || version.VersionId || ''}`,
    );
    return version;
  }

  async models(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const result = await wbDescribeBuiltinModelList(creds);
    return Array.isArray(result.BuiltinModelSet) ? result.BuiltinModelSet : [];
  }

  /** 技能 / 专家：Source 是数据通路判别，必须显式给 BUILTIN / CUSTOM / AUTHORIZED。 */
  async skills(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const result = await wbDescribeSkillList(creds, {
      source: catalogSource(query.source),
    });
    return {
      total: Number(result.TotalCount || 0),
      items: Array.isArray(result.SkillSet) ? result.SkillSet : [],
      counts: result.Counts || null,
    };
  }

  async experts(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const result = await wbDescribeExpertList(creds, {
      source: catalogSource(query.source),
    });
    return {
      total: Number(result.TotalCount || 0),
      items: Array.isArray(result.ExpertSet) ? result.ExpertSet : [],
      counts: result.Counts || null,
    };
  }

  async connectors(user: CurrentUser, query: Record<string, unknown>) {
    const { creds } = await this.accounts.credsOf(
      user,
      requireId(query.accountId, '请先选择 Workbuddy 凭据'),
    );
    const result = await wbDescribeConnectorList(creds, {
      keyword: text(query.keyword).trim(),
    });
    return Array.isArray(result.ConnectorSet) ? result.ConnectorSet : [];
  }
}

export function requireId(value: unknown, message: string) {
  const id = Number(text(value).trim());
  if (!Number.isInteger(id) || id <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, message);
  }
  return id;
}

function requireText(value: unknown, message: string) {
  const result = text(value).trim();
  if (!result) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, message);
  }
  return result;
}

function pageNumber(value: unknown, fallback: number) {
  const parsed = Number(text(value).trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function idStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item).trim())
    .filter(Boolean)
    .slice(0, 100);
}

function catalogSource(value: unknown) {
  const source = text(value).trim().toUpperCase();
  if (!source) return 'BUILTIN';
  if (!['BUILTIN', 'CUSTOM', 'AUTHORIZED'].includes(source)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '技能/专家来源只能是：BUILTIN / CUSTOM / AUTHORIZED',
    );
  }
  return source;
}

/** Manifest 必须是可解析的 JSON 且不超过单版本 256 KiB（腾讯云硬限制）。 */
function requireManifest(value: unknown) {
  const manifest = text(value).trim();
  if (!manifest) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写 Manifest');
  }
  assertManifest(manifest);
  return manifest;
}

function optionalManifest(value: unknown) {
  const manifest = text(value).trim();
  if (!manifest) return undefined;
  assertManifest(manifest);
  return manifest;
}

function assertManifest(manifest: string) {
  if (Buffer.byteLength(manifest, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'Manifest 超过 256 KiB，腾讯云不接受，请精简后重试',
    );
  }
  try {
    JSON.parse(manifest);
  } catch {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'Manifest 必须是合法的 JSON 文本（Manifest v2.0）',
    );
  }
}
