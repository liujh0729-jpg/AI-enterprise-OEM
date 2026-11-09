import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  assertOutboundUrl,
  assertOutboundUrlSync,
} from '../http/outbound-guard';
import { httpRequest } from '../http/transport';
import { GapCrypto } from './gaps.crypto';
import type { GapScopeService } from './gaps.scope';
import {
  asBool,
  asInt,
  asText,
  clip,
  isoOr,
  pageParams,
  type Row,
} from './gaps.helpers';

const PROVIDERS = ['JIRA', 'TEAMBITION', 'TAPD'] as const;
type Provider = (typeof PROVIDERS)[number];
const PROVIDER_LABELS: Record<Provider, string> = {
  JIRA: 'Jira',
  TEAMBITION: 'Teambition',
  TAPD: 'TAPD',
};
const DIRECTIONS = ['PUSH', 'PULL', 'BOTH'] as const;
type Direction = (typeof DIRECTIONS)[number];

type RemoteTask = {
  remoteId: string;
  remoteKey: string;
  title: string;
  description: string;
  status: string;
  updatedAt: string;
};

const pickProvider = (value: unknown): Provider => {
  const text = asText(value).toUpperCase() as Provider;
  if (!PROVIDERS.includes(text)) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持的任务平台');
  }
  return text;
};

/** 远端状态 → 本地 PjTask 状态；认不出的保持原值（调用方按需跳过）。 */
export const mapRemoteStatus = (_provider: Provider, raw: unknown): string => {
  const text = asText(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (!text) return '';
  if (['done', 'closed', 'completed', 'resolved', 'finished'].includes(text))
    return 'DONE';
  if (['inreview', 'review', 'reviewing', 'verify', 'testing'].includes(text))
    return 'REVIEW';
  if (
    [
      'inprogress',
      'progressing',
      'doing',
      'started',
      'active',
      'processing',
    ].includes(text)
  ) {
    return 'DOING';
  }
  if (['todo', 'open', 'new', 'pending', 'backlog', 'created'].includes(text))
    return 'TODO';
  if (['canceled', 'cancelled', 'rejected', 'declined'].includes(text))
    return 'CANCELED';
  return '';
};

/** 本地状态 → 远端状态名（推送时使用）。 */
const localToRemote = (provider: Provider, status: string): string => {
  if (provider === 'JIRA') {
    return status === 'DONE'
      ? 'Done'
      : status === 'REVIEW'
        ? 'In Review'
        : status === 'DOING'
          ? 'In Progress'
          : 'To Do';
  }
  if (provider === 'TAPD') {
    return status === 'DONE'
      ? 'done'
      : status === 'DOING'
        ? 'progressing'
        : 'open';
  }
  return status === 'DONE' ? 'done' : status === 'DOING' ? 'doing' : 'todo';
};

export class TaskSyncService {
  private readonly crypto = new GapCrypto();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private async bindingRow(user: CurrentUser, id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同步绑定 ID 非法');
    }
    const org = await this.scope.resolve(user);
    this.scope.requireAdminFor(org);
    const row = await this.prisma.taskSyncBinding.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步绑定不存在');
    return { org, row };
  }

  private view(
    row: {
      id: number;
      projectId: number;
      provider: string;
      baseUrl: string;
      projectKey: string;
      username: string;
      tokenEnc: string;
      enabled: boolean;
      lastRunAt: Date | null;
      lastResult: string;
      updatedAt: Date;
    },
    projectName: string,
    links: number,
  ) {
    const provider = (
      PROVIDERS.includes(row.provider as Provider) ? row.provider : 'JIRA'
    ) as Provider;
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      baseUrl: row.baseUrl,
      projectKey: row.projectKey,
      username: row.username,
      hasToken: !!row.tokenEnc,
      enabled: row.enabled,
      lastRunAt: isoOr(row.lastRunAt),
      lastResult: row.lastResult,
      links,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async bindings(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const projectId = asInt(query.projectId, 0);
    const rows = await this.prisma.taskSyncBinding.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(projectId > 0 ? { projectId } : {}),
      },
      orderBy: { id: 'desc' },
    });
    const [projects, counts] = await Promise.all([
      this.prisma.pjProject.findMany({
        where: { id: { in: rows.map((r) => r.projectId) } },
        select: { id: true, name: true },
      }),
      this.prisma.taskSyncLink.groupBy({
        by: ['bindingId'],
        where: { bindingId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      }),
    ]);
    const nameMap = new Map(projects.map((p) => [p.id, p.name]));
    const countMap = new Map(counts.map((c) => [c.bindingId, c._count._all]));
    return rows.map((row) =>
      this.view(
        row,
        nameMap.get(row.projectId) || '',
        countMap.get(row.id) || 0,
      ),
    );
  }

  async saveBinding(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const projectId = asInt(body.projectId, 0);
    const project = await this.prisma.pjProject.findFirst({
      where: { id: projectId, orgType: org.orgType, orgUserId: org.orgUserId },
      select: { id: true, name: true },
    });
    if (!project)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '项目不存在或不属于当前主体',
      );
    const provider = pickProvider(body.provider);
    const baseUrl = asText(body.baseUrl).trim().replace(/\/+$/, '');
    if (!baseUrl)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写平台地址');
    assertOutboundUrlSync(baseUrl, '任务平台地址');
    const id = asInt(body.id, 0);
    const token = asText(body.token).trim();
    const projectKey = clip(asText(body.projectKey), 80);
    const username = clip(asText(body.username), 120);
    const enabled = asBool(body.enabled, true);

    if (provider === 'JIRA' && !username) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Jira 需要填写账号邮箱（用于 Basic 认证）',
      );
    }
    if (provider === 'TAPD' && !username) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'TAPD 需要填写 API 账号',
      );
    }
    if (!projectKey) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写远端项目标识');
    }

    const existing = id
      ? await this.prisma.taskSyncBinding.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : await this.prisma.taskSyncBinding.findFirst({
          where: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            projectId,
            provider,
          },
        });
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步绑定不存在');

    const tokenEnc = token
      ? this.crypto.encrypt(token)
      : existing?.tokenEnc || '';
    if (!tokenEnc) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '首次保存绑定必须填写访问令牌',
      );
    }

    const saved = existing
      ? await this.prisma.taskSyncBinding.update({
          where: { id: existing.id },
          data: {
            provider,
            baseUrl,
            projectKey,
            username,
            tokenEnc,
            enabled,
            projectId,
          },
        })
      : await this.prisma.taskSyncBinding.create({
          data: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            projectId,
            provider,
            baseUrl,
            projectKey,
            username,
            tokenEnc,
            enabled,
            createdBy: user.userId,
          },
        });
    const links = await this.prisma.taskSyncLink.count({
      where: { bindingId: saved.id },
    });
    return this.view(saved, project.name, links);
  }

  async removeBinding(user: CurrentUser, body: Row) {
    const { row } = await this.bindingRow(user, asInt(body.id, 0));
    await this.prisma.$transaction([
      this.prisma.taskSyncLink.deleteMany({ where: { bindingId: row.id } }),
      this.prisma.taskSyncRun.deleteMany({ where: { bindingId: row.id } }),
      this.prisma.taskSyncBinding.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  async runs(user: CurrentUser, id: number, query: Row) {
    const { row } = await this.bindingRow(user, id);
    const { page, pageSize, offset } = pageParams(query, 20);
    const [total, rows] = await Promise.all([
      this.prisma.taskSyncRun.count({ where: { bindingId: row.id } }),
      this.prisma.taskSyncRun.findMany({
        where: { bindingId: row.id },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map((run) => ({
        id: run.id,
        direction: run.direction,
        pushed: run.pushed,
        pulled: run.pulled,
        failed: run.failed,
        message: run.message,
        createdAt: run.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async links(user: CurrentUser, id: number, query: Row) {
    const { row } = await this.bindingRow(user, id);
    const { page, pageSize, offset } = pageParams(query, 20);
    const [total, rows] = await Promise.all([
      this.prisma.taskSyncLink.count({ where: { bindingId: row.id } }),
      this.prisma.taskSyncLink.findMany({
        where: { bindingId: row.id },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const tasks = await this.prisma.pjTask.findMany({
      where: { id: { in: rows.map((r) => r.taskId) } },
      select: { id: true, title: true },
    });
    const titleMap = new Map(tasks.map((t) => [t.id, t.title]));
    return {
      list: rows.map((link) => ({
        id: link.id,
        taskId: link.taskId,
        taskTitle: titleMap.get(link.taskId) || '',
        remoteId: link.remoteId,
        remoteKey: link.remoteKey,
        remoteStatus: link.remoteStatus,
        lastSyncedAt: isoOr(link.lastSyncedAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async run(user: CurrentUser, id: number, body: Row) {
    const { org, row } = await this.bindingRow(user, id);
    if (!row.enabled) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该绑定已停用，请先启用再同步',
      );
    }
    const direction = asText(body.direction).toUpperCase() as Direction;
    if (!DIRECTIONS.includes(direction)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同步方向非法');
    }
    await assertOutboundUrl(row.baseUrl, '任务平台地址');
    const token = this.crypto.decrypt(row.tokenEnc);
    const provider = pickProvider(row.provider);
    const client = new RemoteClient(
      provider,
      row.baseUrl,
      row.username,
      token,
      row.projectKey,
    );

    let pushed = 0;
    let pulled = 0;
    let failed = 0;
    const notes: string[] = [];
    try {
      if (direction === 'PUSH' || direction === 'BOTH') {
        const result = await this.push(org, row, provider, client);
        pushed = result.pushed;
        failed += result.failed;
      }
      if (direction === 'PULL' || direction === 'BOTH') {
        const result = await this.pull(org, row, provider, client);
        pulled = result.pulled;
        failed += result.failed;
      }
    } catch (error) {
      failed += 1;
      notes.push(error instanceof Error ? error.message : String(error));
    }

    const message = [
      `推送 ${pushed} 条`,
      `拉取 ${pulled} 条`,
      failed ? `失败 ${failed} 条` : '',
      ...notes,
    ]
      .filter(Boolean)
      .join('；')
      .slice(0, 1000);
    const saved = await this.prisma.$transaction(async (tx) => {
      const run = await tx.taskSyncRun.create({
        data: { bindingId: row.id, direction, pushed, pulled, failed, message },
      });
      await tx.taskSyncBinding.update({
        where: { id: row.id },
        data: { lastRunAt: new Date(), lastResult: message.slice(0, 500) },
      });
      return run;
    });
    return {
      id: saved.id,
      direction,
      pushed,
      pulled,
      failed,
      message,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  private async push(
    org: HrmOrg,
    binding: { id: number; projectId: number },
    provider: Provider,
    client: RemoteClient,
  ) {
    const links = await this.prisma.taskSyncLink.findMany({
      where: { bindingId: binding.id },
      select: { taskId: true, remoteId: true },
    });
    const linked = new Set(links.map((l) => l.taskId));
    const tasks = await this.prisma.pjTask.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        projectId: binding.projectId,
        status: { not: 'CANCELED' },
      },
      orderBy: { id: 'asc' },
      take: 200,
    });
    let pushed = 0;
    let failed = 0;
    for (const task of tasks) {
      if (linked.has(task.id)) continue;
      try {
        const remote = await client.createTask({
          title: task.title,
          description: task.description,
          status: localToRemote(provider, task.status),
        });
        await this.prisma.taskSyncLink.upsert({
          where: {
            bindingId_taskId: { bindingId: binding.id, taskId: task.id },
          },
          create: {
            bindingId: binding.id,
            taskId: task.id,
            remoteId: remote.remoteId,
            remoteKey: remote.remoteKey,
            remoteStatus: remote.status,
            lastSyncedAt: new Date(),
          },
          update: {
            remoteId: remote.remoteId,
            remoteKey: remote.remoteKey,
            remoteStatus: remote.status,
            lastSyncedAt: new Date(),
          },
        });
        pushed += 1;
      } catch {
        failed += 1;
      }
      if (pushed >= 100) break;
    }
    return { pushed, failed };
  }

  private async pull(
    org: HrmOrg,
    binding: { id: number; projectId: number },
    provider: Provider,
    client: RemoteClient,
  ) {
    const remoteTasks = await client.listTasks();
    const existing = await this.prisma.taskSyncLink.findMany({
      where: { bindingId: binding.id },
    });
    const byRemote = new Map(existing.map((link) => [link.remoteId, link]));
    let pulled = 0;
    let failed = 0;
    for (const remote of remoteTasks) {
      const link = byRemote.get(remote.remoteId);
      const status = mapRemoteStatus(provider, remote.status);
      try {
        if (link) {
          const task = await this.prisma.pjTask.findFirst({
            where: {
              id: link.taskId,
              orgType: org.orgType,
              orgUserId: org.orgUserId,
            },
            select: { id: true, status: true, title: true },
          });
          if (!task) continue;
          const updates: {
            status?: string;
            completedAt?: Date | null;
            title?: string;
          } = {};
          if (status && status !== task.status) {
            updates.status = status;
            updates.completedAt = status === 'DONE' ? new Date() : null;
          }
          if (remote.title && remote.title !== task.title)
            updates.title = clip(remote.title, 200);
          if (Object.keys(updates).length) {
            await this.prisma.pjTask.update({
              where: { id: task.id },
              data: updates,
            });
          }
          await this.prisma.taskSyncLink.update({
            where: { id: link.id },
            data: {
              remoteKey: remote.remoteKey || link.remoteKey,
              remoteStatus: clip(remote.status, 32),
              lastSyncedAt: new Date(),
            },
          });
          pulled += 1;
          continue;
        }
        if (!remote.title) continue;
        const created = await this.prisma.pjTask.create({
          data: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            projectId: binding.projectId,
            title: clip(remote.title, 200),
            description: clip(remote.description, 8000),
            status: status || 'TODO',
            createdBy: 'task-sync',
          },
        });
        await this.prisma.taskSyncLink.create({
          data: {
            bindingId: binding.id,
            taskId: created.id,
            remoteId: remote.remoteId,
            remoteKey: remote.remoteKey,
            remoteStatus: clip(remote.status, 32),
            lastSyncedAt: new Date(),
          },
        });
        pulled += 1;
      } catch {
        failed += 1;
      }
      if (pulled >= 100) break;
    }
    return { pulled, failed };
  }
}

/** 三个平台的 REST 适配；只依赖 fetch，不引入 SDK。 */
class RemoteClient {
  constructor(
    private readonly provider: Provider,
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly token: string,
    private readonly projectKey: string,
  ) {}

  private headers(): Record<string, string> {
    if (this.provider === 'JIRA') {
      const basic = Buffer.from(
        `${this.username}:${this.token}`,
        'utf8',
      ).toString('base64');
      return { authorization: `Basic ${basic}`, accept: 'application/json' };
    }
    if (this.provider === 'TAPD') {
      return { accept: 'application/json' };
    }
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  private tapdAuth(): string {
    return `api_user=${encodeURIComponent(this.username)}&api_password=${encodeURIComponent(this.token)}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Row> {
    const result = await httpRequest<string>(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: init.signal ?? undefined,
      timeoutMs: 20_000,
      readAs: 'text',
      maxBytes: 2_000_000,
      operation: 'gaps.task-sync',
    });
    const text = result.data;
    if (!result.ok) {
      throw new Error(
        `${this.provider} 接口返回 ${result.status}：${text.slice(0, 200)}`,
      );
    }
    if (!text) return {};
    try {
      return JSON.parse(text) as Row;
    } catch {
      throw new Error(`${this.provider} 返回内容不是 JSON`);
    }
  }

  async createTask(input: {
    title: string;
    description: string;
    status: string;
  }) {
    if (this.provider === 'JIRA') {
      const data = await this.request(`${this.baseUrl}/rest/api/2/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: this.projectKey },
            summary: clip(input.title, 240),
            description: input.description,
            issuetype: { name: 'Task' },
          },
        }),
      });
      const id = asText(data.id);
      const key = asText(data.key);
      return { remoteId: id || key, remoteKey: key, status: input.status };
    }
    if (this.provider === 'TEAMBITION') {
      const data = await this.request(`${this.baseUrl}/v3/task`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: this.projectKey,
          content: clip(input.title, 240),
          note: input.description,
        }),
      });
      const id = asText(data._id) || asText(data.id);
      return { remoteId: id, remoteKey: id, status: input.status };
    }
    const body = new URLSearchParams({
      workspace_id: this.projectKey,
      name: clip(input.title, 240),
      description: input.description,
      status: input.status,
    });
    const data = await this.request(
      `${this.baseUrl}/api/tapd_public/v1/tasks?${this.tapdAuth()}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    const task = (data.Task || data.task || {}) as Row;
    const id = asText(task.id);
    return { remoteId: id, remoteKey: id, status: input.status };
  }

  async listTasks(): Promise<RemoteTask[]> {
    if (this.provider === 'JIRA') {
      const jql = encodeURIComponent(
        `project = "${this.projectKey}" ORDER BY updated DESC`,
      );
      const data = await this.request(
        `${this.baseUrl}/rest/api/2/search?jql=${jql}&maxResults=100&fields=summary,description,status,updated`,
      );
      const issues = Array.isArray(data.issues) ? (data.issues as Row[]) : [];
      return issues.map((issue) => {
        const fields = (issue.fields || {}) as Row;
        const status = (fields.status || {}) as Row;
        return {
          remoteId: asText(issue.id) || asText(issue.key),
          remoteKey: asText(issue.key),
          title: asText(fields.summary),
          description: asText(fields.description),
          status: asText(status.name),
          updatedAt: asText(fields.updated),
        };
      });
    }
    if (this.provider === 'TEAMBITION') {
      const data = await this.request(
        `${this.baseUrl}/v3/task/query?projectId=${encodeURIComponent(this.projectKey)}&limit=100`,
      );
      const tasks = Array.isArray(data)
        ? (data as Row[])
        : Array.isArray(data.result)
          ? (data.result as Row[])
          : [];
      return tasks.map((task) => ({
        remoteId: asText(task._id) || asText(task.id),
        remoteKey: asText(task.uniqueId) || asText(task._id) || asText(task.id),
        title: asText(task.content) || asText(task.title),
        description: asText(task.note),
        status:
          task.isDone === true || task.done === true
            ? 'done'
            : asText(task.status) || 'todo',
        updatedAt: asText(task.updated),
      }));
    }
    const data = await this.request(
      `${this.baseUrl}/api/tapd_public/v1/tasks?workspace_id=${encodeURIComponent(this.projectKey)}&limit=100&${this.tapdAuth()}`,
    );
    const raw = data.Task || data.task;
    const tasks = Array.isArray(raw) ? (raw as Row[]) : [];
    return tasks.map((task) => ({
      remoteId: asText(task.id),
      remoteKey: asText(task.id),
      title: asText(task.name),
      description: asText(task.description),
      status: asText(task.status),
      updatedAt: asText(task.modified),
    }));
  }
}
