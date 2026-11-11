import { AsyncLocalStorage } from 'node:async_hooks';
import {
  WORKFLOW_BUDGET_STOP_LABELS,
  WORKFLOW_SCOPE_LABELS,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_TRIGGERS,
  WORKFLOW_TRIGGER_LABELS,
  WORKFLOW_RUN_STATUS_LABELS,
  type WorkflowBudgets,
  type WorkflowGraph,
  type WorkflowNodeSpec,
  type WorkflowRow,
  type WorkflowUsage,
} from '@enterprise/contracts';
import type {
  Prisma,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from '../../generated/prisma';
import { pageParam, pageOf, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { fromJson, toJsonInput } from '../common/json-input';
import { Logger } from '../common/logger';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrgContextService } from '../gaps/org-context.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { compileGraph } from './workflow-graph';
import { buildWorkflowCatalog } from './workflow-catalog';
import {
  buildSystemPrompt,
  normalizeAiGraph,
  selectPromptNodes,
} from './workflow-ai-builder';
import {
  dueScheduleSlots,
  eventBindings,
  scheduleBindings,
  taskBindings,
  validateTriggers,
} from './workflow-triggers';
import type { WorkflowEngine } from './workflow-engine';
import type {
  WorkflowEventTrigger,
  WorkflowTaskTrigger,
} from './workflow.types';
import type { ConnectorToolSpec } from '../content/agent-connectors.service';
import type { HardwareMcpTool } from '../hardware/hardware.service';
import { aiJson } from '../ai/ai-gateway';
import type { ChatMessage } from '../geo/geo-llm.client';

type ManifestResource = {
  name: string;
  description?: string;
  enabled?: boolean;
  reviewStatus?: string;
};

/** 节点目录的四类来源：与「Agent 工具」面板读同一批服务，不另存一份目录。 */
export type WorkflowCatalogSources = {
  connectorTools: (user: CurrentUser) => Promise<ConnectorToolSpec[]>;
  hardwareTools: (user: CurrentUser) => Promise<HardwareMcpTool[]>;
  skills: (user: CurrentUser) => Promise<ManifestResource[]>;
  plugins: (user: CurrentUser) => Promise<ManifestResource[]>;
};

type OrgOption = {
  orgType: string;
  orgUserId: string;
  name: string;
  current: boolean;
};

type OrgKeys = {
  enterprise: string[];
  provider: string[];
  current: { orgType: string; orgUserId: string };
  /** 共享分组可选项：一个主体一个数据域，清单按主体拆开，不跨主体混合。 */
  options: OrgOption[];
};

/** 计数键：私有按人，共享按「分组:主体」，与前端页签一一对应。 */
function countKey(orgType: string, orgUserId: string) {
  return `${orgType === 'PROVIDER' ? 'provider' : 'org'}:${orgUserId}`;
}

const TRIGGER_VALUES: readonly string[] = WORKFLOW_TRIGGERS;
const TERMINAL_RUN_STATUSES = new Set(['DONE', 'FAILED', 'CANCELED']);

/** 流程互相触发的层数上限：动作节点发事件 → 事件起流程 → 该流程又发事件，超过即停。 */
const TRIGGER_DEPTH = new AsyncLocalStorage<number>();
const MAX_TRIGGER_DEPTH = 3;

/**
 * 工作流服务：图编排的 CRUD + 版本冻结 + 运行台账 + 可见性收口。
 * 节点目录从既有注册表派生（契约 + Agent manifest），不写第二份；
 * 共享＝只读可用，编辑权归创建人；发布为 Agent/MCP 工具要求 scope ≥ ORG 且已发布。
 */
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgContextService,
    private readonly engine: WorkflowEngine,
    private readonly sources: WorkflowCatalogSources,
    private readonly scope: HrmScopeService,
  ) {}

  // ---------------------------------------------------------------- 节点目录

  async catalog(user: CurrentUser) {
    const [connectorTools, hardwareTools, skills, plugins] = await Promise.all([
      this.sources.connectorTools(user).catch(() => []),
      this.sources.hardwareTools(user).catch(() => []),
      this.sources.skills(user).catch(() => []),
      this.sources.plugins(user).catch(() => []),
    ]);
    const nodes: WorkflowNodeSpec[] = buildWorkflowCatalog({
      connectorTools,
      hardwareTools,
      skills,
      plugins,
    });
    return { nodes };
  }

  /**
   * 用自然语言搭建工作流：多轮对话交给统一网关的文本模型，产出草案图后原地校验。
   * 只回草案不落库——用户确认后再走 create；节点目录与编辑器同源，模型只在目录里选 key。
   */
  async aiBuild(user: CurrentUser, body: Record<string, unknown>) {
    const messages = this.aiMessages(body.messages);
    if (!messages.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先描述你想让这个工作流做什么',
      );
    }
    const draft = body.graph === undefined ? null : this.readGraph(body.graph);
    const { nodes: specs } = await this.catalog(user);
    const query = [
      draft ? draft.nodes.map((node) => node.name).join(' ') : '',
      ...messages.map((item) => item.content),
    ].join('\n');
    const chat: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(selectPromptNodes(specs, query)),
      },
      {
        role: 'system',
        content: `当前草稿图（JSON；为空则从零开始，请在此基础上按用户的新要求改并返回完整新图）：${JSON.stringify(draft ?? { nodes: [], edges: [] })}`,
      },
      ...messages.map((item) => ({ role: item.role, content: item.content })),
    ];
    const result = await aiJson(this.prisma, {
      userId: user.userId,
      module: 'workflow',
      operation: 'ai_build',
      maxTokens: 8000,
      timeoutMs: 120000,
      messages: chat,
      validate: (raw) => (Array.isArray(raw.nodes) ? raw : null),
    });
    if (!result) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '还没有可用的文字模型：请先到「模型服务 → 模型设置」为「文本」选好渠道与模型',
      );
    }
    const built = normalizeAiGraph(result.data, specs);
    const name = text(result.data.name).trim().slice(0, 120);
    const description = text(result.data.description).trim().slice(0, 500);
    const reply =
      text(result.data.reply).trim() || this.aiFallbackReply(built, name);
    return {
      reply,
      name: name || 'AI 搭建的工作流',
      description,
      graph: built.graph,
      ready: built.ready,
      issues: built.issues,
      model: result.model,
      elapsedMs: result.elapsedMs,
    };
  }

  /** 只收合法的用户 / 助手消息：角色不在白名单按用户处理，空文本丢弃，只留最近 30 条。 */
  private aiMessages(
    raw: unknown,
  ): { role: 'user' | 'assistant'; content: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
      .map((item) => ({
        role:
          text(item.role) === 'assistant'
            ? ('assistant' as const)
            : ('user' as const),
        content: text(item.content).slice(0, 4000),
      }))
      .filter((item) => item.content.trim().length > 0)
      .slice(-30);
  }

  /** 模型没给 reply 时的兜底文案：把节点数与校验问题讲清楚，用户才知道下一步做什么。 */
  private aiFallbackReply(
    built: { graph: WorkflowGraph; issues: string[] },
    name: string,
  ): string {
    const head = name
      ? `已生成「${name}」（${built.graph.nodes.length} 个节点）。`
      : `已生成 ${built.graph.nodes.length} 个节点。`;
    return built.issues.length ? `${head}\n${built.issues.join('\n')}` : head;
  }

  /**
   * 可被 Agent / MCP 调用的工作流（wf__ 前缀）：本主体内已发布且已共享（scope ≥ ORG）。
   * 与 manifest 是同一口径，私有工作流不进目录。
   */
  async toolSpecs(user: CurrentUser) {
    const orgs = await this.orgKeys(user);
    const rows = await this.prisma.workflow.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { scope: 'ORG', orgUserId: { in: searchable(orgs.enterprise) } },
          { scope: 'PROVIDER', orgUserId: { in: searchable(orgs.provider) } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        scope: true,
        status: true,
      },
    });
    return rows.map((row) => ({
      name: `wf__${row.id}`,
      description: row.description || `${row.name}（已共享工作流）`,
      scope: row.scope,
      status: row.status,
    }));
  }

  // ---------------------------------------------------------------- 列表 / 详情

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const orgs = await this.orgKeys(user);
    const group = text(query.group);
    const requestedOrg = text(query.orgUserId).trim();
    const status = text(query.status);
    const keyword = text(query.keyword).trim();
    const orgId = this.shareOrgId('org', requestedOrg, orgs);
    const providerId = this.shareOrgId('provider', requestedOrg, orgs);
    const base: Prisma.WorkflowWhereInput[] = [];
    if (!group || group === 'mine') base.push({ ownerUserId: user.userId });
    if (!group || group === 'org') {
      base.push({ scope: 'ORG', orgUserId: orgId || NO_ORG });
    }
    if (!group || group === 'provider') {
      base.push({ scope: 'PROVIDER', orgUserId: providerId || NO_ORG });
    }
    const where: Prisma.WorkflowWhereInput = {
      ...(base.length ? { OR: base } : {}),
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: keyword } },
                  { description: { contains: keyword } },
                ],
              },
            ],
          }
        : {}),
    };
    const page = pageParam(
      query.page as string | number,
      query.pageSize as string | number,
    );
    const [total, rows] = await Promise.all([
      this.prisma.workflow.count({ where }),
      this.prisma.workflow.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: page.offset,
        take: page.pageSize,
      }),
    ]);
    const countTargets: { key: string; where: Prisma.WorkflowWhereInput }[] = [
      { key: 'mine', where: { ownerUserId: user.userId } },
    ];
    for (const option of orgs.options) {
      countTargets.push({
        key: countKey(option.orgType, option.orgUserId),
        where: {
          scope: option.orgType === 'PROVIDER' ? 'PROVIDER' : 'ORG',
          orgUserId: option.orgUserId,
        },
      });
    }
    const counted = await Promise.all(
      countTargets.map((target) =>
        this.prisma.workflow.count({ where: target.where }),
      ),
    );
    const counts: Record<string, number> = {};
    countTargets.forEach((target, index) => {
      counts[target.key] = counted[index];
    });
    const published = await this.publishedVersions(rows.map((row) => row.id));
    return {
      ...pageOf(
        rows.map((row) => this.toRow(row, user, published.get(row.id))),
        total,
        page.page,
        page.pageSize,
      ),
      counts,
      orgs: orgs.options,
    };
  }

  async detail(user: CurrentUser, id: string): Promise<WorkflowRow> {
    const row = await this.load(user, id);
    const published = await this.publishedVersions([row.id]);
    return this.toRow(row, user, published.get(row.id));
  }

  // ---------------------------------------------------------------- 新建 / 保存 / 删除

  async create(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<WorkflowRow> {
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写工作流名称');
    const scope = this.normalizeScope(text(body.scope) || 'PRIVATE');
    const orgs = await this.orgKeys(user);
    const graph = this.readGraph(body.graph);
    const org = this.orgForScope(scope, orgs, text(body.orgUserId).trim());
    const businessKey = this.normalizeBusinessKey(body.businessKey);
    await this.assertBusinessKeyFree(businessKey);
    const row = await this.prisma.workflow.create({
      data: {
        ownerUserId: user.userId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        name,
        description: text(body.description).slice(0, 500),
        businessKey: businessKey || null,
        scope,
        status: 'DRAFT',
        graph: toJsonInput(graph),
        budgets: toJsonInput(
          this.normalizeBudgets(body.budgets, this.budgetConfig({})),
        ),
        createdBy: user.userId,
      },
    });
    return this.toRow(row, user, undefined);
  }

  async save(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ): Promise<WorkflowRow> {
    const row = await this.load(user, id);
    this.assertEditable(row, user);
    const data: Prisma.WorkflowUpdateInput = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim().slice(0, 120);
      if (!name)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写工作流名称');
      data.name = name;
    }
    if (body.description !== undefined) {
      data.description = text(body.description).slice(0, 500);
    }
    if (body.businessKey !== undefined) {
      const businessKey = this.normalizeBusinessKey(body.businessKey);
      await this.assertBusinessKeyFree(businessKey, row.id);
      data.businessKey = businessKey || null;
    }
    if (body.scope !== undefined || body.orgUserId !== undefined) {
      const scope = this.normalizeScope(text(body.scope) || row.scope);
      const orgs = await this.orgKeys(user);
      const org = this.orgForScope(scope, orgs, text(body.orgUserId).trim());
      data.scope = scope;
      data.orgType = org.orgType;
      data.orgUserId = org.orgUserId;
    }
    let graphChanged = false;
    if (body.graph !== undefined) {
      const graph = this.readGraph(body.graph);
      const compiled = compileGraph(graph);
      if (!compiled.ok)
        throw new BusinessException(ErrorCode.BAD_REQUEST, compiled.message);
      const triggers = validateTriggers(graph);
      if (!triggers.ok)
        throw new BusinessException(ErrorCode.BAD_REQUEST, triggers.message);
      data.graph = toJsonInput(graph);
      graphChanged = true;
    }
    if (body.inputSchema !== undefined)
      data.inputSchema = toJsonInput(body.inputSchema);
    if (body.outputSchema !== undefined)
      data.outputSchema = toJsonInput(body.outputSchema);
    if (body.budgets !== undefined) {
      data.budgets = toJsonInput(
        this.normalizeBudgets(body.budgets, this.budgetConfig(row.budgets)),
      );
    }
    // 改图即回草稿并进版本号：已发布的快照（WorkflowVersion）不受影响，在途运行仍跑旧图。
    if (graphChanged && row.status === 'PUBLISHED') {
      data.status = 'DRAFT';
      data.version = { increment: 1 };
    }
    const updated = await this.prisma.workflow.update({
      where: { id: row.id },
      data,
    });
    const published = await this.publishedVersions([updated.id]);
    return this.toRow(updated, user, published.get(updated.id));
  }

  async remove(user: CurrentUser, id: string) {
    const row = await this.load(user, id);
    this.assertEditable(row, user);
    await this.prisma.workflow.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  async duplicate(user: CurrentUser, id: string): Promise<WorkflowRow> {
    const row = await this.load(user, id);
    const copy = await this.prisma.workflow.create({
      data: {
        ownerUserId: user.userId,
        orgType: row.orgType,
        orgUserId: row.orgUserId,
        name: `${row.name} 副本`.slice(0, 120),
        description: row.description,
        scope: 'PRIVATE',
        status: 'DRAFT',
        version: 1,
        graph: toJsonInput(fromJson<WorkflowGraph>(row.graph)),
        budgets: toJsonInput(this.budgetConfig(row.budgets)),
        inputSchema: toJsonInput(fromJson<unknown>(row.inputSchema)),
        outputSchema: toJsonInput(fromJson<unknown>(row.outputSchema)),
        createdBy: user.userId,
      },
    });
    return this.toRow(copy, user, undefined);
  }

  // ---------------------------------------------------------------- 发布 / 运行

  async publish(user: CurrentUser, id: string): Promise<WorkflowRow> {
    const row = await this.load(user, id);
    this.assertEditable(row, user);
    const graph = fromJson<WorkflowGraph>(row.graph);
    const compiled = compileGraph(graph);
    if (!compiled.ok)
      throw new BusinessException(ErrorCode.BAD_REQUEST, compiled.message);
    const triggers = validateTriggers(graph);
    if (!triggers.ok)
      throw new BusinessException(ErrorCode.BAD_REQUEST, triggers.message);
    await this.prisma.workflowVersion.upsert({
      where: {
        workflowId_version: { workflowId: row.id, version: row.version },
      },
      create: {
        workflowId: row.id,
        version: row.version,
        graph: toJsonInput(graph),
        inputSchema: toJsonInput(fromJson<unknown>(row.inputSchema)),
        publishedBy: user.userId,
      },
      update: {
        graph: toJsonInput(graph),
        inputSchema: toJsonInput(fromJson<unknown>(row.inputSchema)),
        publishedBy: user.userId,
        publishedAt: new Date(),
      },
    });
    const updated = await this.prisma.workflow.update({
      where: { id: row.id },
      // 发布即拥有稳定业务标识：外部单据/规则可用 wf.<id> 命中，改名改图都不影响。
      data: {
        status: 'PUBLISHED',
        businessKey: row.businessKey || `wf.${row.id}`,
      },
    });
    return this.toRow(updated, user, updated.version);
  }

  /** 按版本运行：返回 runId；执行在后台推进（长流程异步、等待节点挂起）。 */
  async run(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const row = await this.load(user, id);
    await this.assertRunnable(row, user);
    await this.freezeDraftVersion(row, user);
    const input = (body.input ?? {}) as Record<string, unknown>;
    const { run } = await this.createRun(row, user, {
      trigger: 'MANUAL',
      input,
    });
    // 后台推进：HTTP 立即返回 runId，Playground 用 runDetail / SSE 看步进。
    void this.engine.start(run.id, user).catch(() => undefined);
    return this.runRow(await this.loadRun(run.id), row);
  }

  /**
   * 统一触发入口（HTTP / 调度器 / 领域事件桥 / 任务事件桥都收口到这里）。
   * 外部 Webhook 触发不开放（决策 D2=C）：本接口只在登录态或进程内调用。
   * dedupeKey 命中既有运行时直接返回那条 runId，不重复起流程。
   */
  async invoke(
    user: CurrentUser,
    body: Record<string, unknown>,
  ): Promise<{ runId: number; duplicated: boolean }> {
    const workflowId = Number(body.workflowId ?? 0);
    const businessKey = text(body.businessKey).trim();
    let row: Workflow | null = null;
    if (Number.isInteger(workflowId) && workflowId > 0) {
      row = await this.load(user, String(workflowId));
    } else if (businessKey) {
      row = await this.loadByKey(user, businessKey);
    }
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请指定工作流编号或业务标识',
      );
    }
    await this.assertRunnable(row, user);
    await this.freezeDraftVersion(row, user);
    const trigger = text(body.trigger).trim().toUpperCase() || 'MANUAL';
    if (!TRIGGER_VALUES.includes(trigger)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '触发方式取值不合法');
    }
    const { run, duplicated } = await this.createRun(row, user, {
      trigger,
      input: (body.input ?? {}) as Record<string, unknown>,
      sourceType: text(body.sourceType).slice(0, 32),
      sourceId: text(body.sourceId).slice(0, 64),
      dedupeKey: text(body.dedupeKey).trim().slice(0, 191),
    });
    if (!duplicated) {
      void this.engine.start(run.id, user).catch(() => undefined);
    }
    return { runId: run.id, duplicated };
  }

  /**
   * 规则 / 内部调用：按账号身份触发（不新增绕过权限的通道），
   * 未发布、无权限、账号停用等失败直接抛出，交给规则执行台账记 FAILED。
   */
  async invokeByUser(
    userId: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const actor = await this.triggerActor(text(userId));
    if (!actor) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '触发账号不存在或已被停用',
      );
    }
    const workflowId = Number(body.workflowId ?? 0);
    const businessKey = text(body.businessKey).trim();
    let row: Workflow | null = null;
    if (Number.isInteger(workflowId) && workflowId > 0) {
      row = await this.load(actor, String(workflowId));
    } else if (businessKey) {
      row = await this.loadByKey(actor, businessKey);
    }
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请指定工作流编号或业务标识',
      );
    }
    await this.assertRunnable(row, actor);
    return (
      (await this.fire(actor, row.id, { ...body, workflowId: row.id })) > 0
    );
  }

  async runDetail(user: CurrentUser, runId: string) {
    const run = await this.loadRun(Number(runId));
    const workflow = await this.load(user, String(run.workflowId));
    return this.runRow(run, workflow);
  }

  /**
   * 运行记录：可见范围与工作流一致（本人 / 本主体共享 / 管理员），
   * 支持按工作流、运行状态与业务关联（单据类型 + 主键）过滤，供 `/workflow` 运行记录页签与排查。
   */
  async runList(user: CurrentUser, query: Record<string, unknown>) {
    const page = pageParam(
      query.page as string | number,
      query.pageSize as string | number,
    );
    const workflowId = Number(query.workflowId ?? 0);
    const status = text(query.status).trim();
    const sourceType = text(query.sourceType).trim().slice(0, 32);
    const sourceId = text(query.sourceId).trim().slice(0, 64);
    const where: Prisma.WorkflowRunWhereInput = {
      ...(Number.isInteger(workflowId) && workflowId > 0 ? { workflowId } : {}),
      ...(status ? { status } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(sourceId ? { sourceId } : {}),
    };
    if (Number.isInteger(workflowId) && workflowId > 0) {
      await this.load(user, String(workflowId));
    } else if (!user.isAdmin()) {
      const orgs = await this.orgKeys(user);
      const visible = await this.prisma.workflow.findMany({
        where: {
          OR: [
            { ownerUserId: user.userId },
            { scope: 'ORG', orgUserId: { in: searchable(orgs.enterprise) } },
            {
              scope: 'PROVIDER',
              orgUserId: { in: searchable(orgs.provider) },
            },
          ],
        },
        select: { id: true },
      });
      // 一条可见工作流都没有时给一个恒假条件，避免 where 退化成全表。
      where.workflowId = {
        in: visible.length ? visible.map((row) => row.id) : [0],
      };
    }
    const [total, runs] = await Promise.all([
      this.prisma.workflowRun.count({ where }),
      this.prisma.workflowRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.offset,
        take: page.pageSize,
      }),
    ]);
    if (!runs.length) return pageOf([], total, page.page, page.pageSize);
    const workflowIds = [...new Set(runs.map((run) => run.workflowId))];
    const [workflows, steps] = await Promise.all([
      this.prisma.workflow.findMany({
        where: { id: { in: workflowIds } },
        select: { id: true, name: true },
      }),
      this.prisma.workflowRunStep.findMany({
        where: { runId: { in: runs.map((run) => run.id) } },
        orderBy: { id: 'asc' },
      }),
    ]);
    const names = new Map(workflows.map((row) => [row.id, row.name]));
    const stepsOf = new Map<number, WorkflowRunStep[]>();
    for (const step of steps) {
      const bucket = stepsOf.get(step.runId);
      if (bucket) bucket.push(step);
      else stepsOf.set(step.runId, [step]);
    }
    const list = await Promise.all(
      runs.map((run) =>
        this.runRow(
          run,
          { name: names.get(run.workflowId) ?? `工作流 #${run.workflowId}` },
          stepsOf.get(run.id) ?? [],
        ),
      ),
    );
    return pageOf(list, total, page.page, page.pageSize);
  }

  /**
   * 取消运行：排队中 / 运行中由引擎在下一次节点边界停；等待人工则直接作废等待步骤并结束。
   * 只有运行发起人、工作流创建人或管理员可以取消。
   */
  async cancelRun(user: CurrentUser, runId: string) {
    const run = await this.loadRun(Number(runId));
    const workflow = await this.load(user, String(run.workflowId));
    if (
      run.actorId !== user.userId &&
      workflow.ownerUserId !== user.userId &&
      !user.isAdmin()
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有运行发起人、工作流创建人或管理员可以取消运行',
      );
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return this.runRow(run, workflow);
    }
    if (run.status === 'WAITING') {
      await this.prisma.workflowRunStep.updateMany({
        where: { runId: run.id, status: 'WAITING' },
        data: { status: 'CANCELED', finishedAt: new Date() },
      });
    }
    const updated = await this.prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'CANCELED', error: '已取消', finishedAt: new Date() },
    });
    this.engine.announce(run.id, 'CANCELED');
    return this.runRow(updated, workflow);
  }

  /**
   * Playground 实时步进：订阅引擎事件，每次都推一份完整运行快照。
   * 走到终态或「等待人工」即收流（等待可能很久，前端另有 runDetail 轮询兜底）。
   */
  async streamRun(
    user: CurrentUser,
    runId: string,
    emit: (event: string, data: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const id = Number(runId);
    const run = await this.loadRun(id);
    const workflow = await this.load(user, String(run.workflowId));
    const resting = new Set(['DONE', 'FAILED', 'CANCELED', 'WAITING']);
    let stop: () => void = () => undefined;
    let chain: Promise<void> = Promise.resolve();
    const finished = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const push = async () => {
      const latest = await this.loadRun(id);
      await emit('run', { run: this.runRow(latest, workflow) });
      if (resting.has(latest.status)) stop();
    };
    const schedule = () => {
      chain = chain.then(push).catch(() => undefined);
    };
    const off = this.engine.subscribe(id, schedule);
    try {
      schedule();
      await finished;
      await chain;
    } finally {
      off();
    }
  }

  /**
   * Agent / MCP 工具入口（wf__<id>）：以登录人身份按发布版本同步跑完，回结果文本。
   * 与 HTTP 触发共用一个引擎与运行台账，区别只是这里等结果。
   */
  async runAsTool(
    user: CurrentUser,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const id = Number(name.slice('wf__'.length));
    const row = await this.load(user, String(id));
    if (row.status !== 'PUBLISHED') {
      return { text: `工作流「${row.name}」尚未发布，无法作为工具调用` };
    }
    // 可见性已由 load 收口；再挡一层私有：私有不进 manifest，也不允许被外部工具命中。
    if (row.scope === 'PRIVATE') {
      return { text: `工作流「${row.name}」未共享，无法作为工具调用` };
    }
    const published = await this.publishedVersions([row.id]);
    if (!published.has(row.id)) {
      return { text: `工作流「${row.name}」缺少已发布版本，请重新发布` };
    }
    const input =
      args && typeof args.input === 'object' && args.input !== null
        ? (args.input as Record<string, unknown>)
        : (args ?? {});
    const { run } = await this.createRun(row, user, {
      trigger: 'AGENT',
      input,
    });
    await this.engine.start(run.id, user);
    const finished = await this.loadRun(run.id);
    if (finished.status === 'DONE') {
      const output = fromJson<unknown>(finished.output);
      const text =
        typeof output === 'string' ? output : JSON.stringify(output ?? {});
      return {
        text: `工作流「${row.name}」已执行完成：${text.slice(0, 1500)}`,
      };
    }
    if (finished.status === 'WAITING') {
      return {
        text: `工作流「${row.name}」已挂起，等待人工处理；相关待办已派发到「我的任务」（runId=${run.id}）`,
      };
    }
    if (finished.status === 'FAILED') {
      return {
        text: `工作流「${row.name}」执行失败：${finished.error || '未知错误'}（runId=${run.id}）`,
      };
    }
    return { text: `工作流「${row.name}」已提交，正在执行（runId=${run.id}）` };
  }

  // ---------------------------------------------------------------- 触发扫描（进程内）

  /**
   * 定时触发：调度器每分钟调一次，返回本轮真正起来的运行数。
   * 幂等锚＝工作流 + 分钟槽，重复 tick / 多实例同时 tick 都只起一次。
   */
  async runScheduled(now = new Date()): Promise<number> {
    const rows = await this.prisma.workflow.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { id: 'asc' },
    });
    let started = 0;
    for (const row of rows) {
      const graph = this.readGraph(fromJson<WorkflowGraph>(row.graph));
      const slots = dueScheduleSlots(scheduleBindings(graph), now);
      if (!slots.length) continue;
      const actor = await this.triggerActor(row.ownerUserId, {
        orgType: row.orgType,
        orgUserId: row.orgUserId,
      });
      if (!actor) continue;
      for (const slot of slots) {
        started += await this.fire(actor, row.id, {
          trigger: 'SCHEDULE',
          input: { scheduledAt: slot.key, cron: slot.binding.cron },
          sourceType: 'schedule',
          sourceId: String(row.id),
          dedupeKey: `wf:schedule:${row.id}:${slot.key}`,
        });
      }
    }
    return started;
  }

  /**
   * 领域事件桥：只命中事件所属主体的已发布工作流。
   * 幂等锚＝工作流 + 事件台账 id，同一事件重复投递只起一次。
   */
  async runOnEvent(input: WorkflowEventTrigger): Promise<number> {
    if (input.eventLogId <= 0) return 0;
    const rows = await this.prisma.workflow.findMany({
      where: {
        status: 'PUBLISHED',
        orgType: input.orgType,
        orgUserId: input.orgUserId,
      },
      orderBy: { id: 'asc' },
    });
    let started = 0;
    for (const row of rows) {
      const graph = this.readGraph(fromJson<WorkflowGraph>(row.graph));
      if (!eventBindings(graph).some((item) => item.event === input.event)) {
        continue;
      }
      const actor = await this.triggerActor(row.ownerUserId, {
        orgType: row.orgType,
        orgUserId: row.orgUserId,
      });
      if (!actor) continue;
      started += await this.fire(actor, row.id, {
        trigger: 'EVENT',
        input: {
          event: input.event,
          orgType: input.orgType,
          orgUserId: input.orgUserId,
          payload: input.payload,
        },
        sourceType: 'event',
        sourceId: String(input.eventLogId),
        dedupeKey: `wf:event:${row.id}:${input.eventLogId}`,
      });
    }
    return started;
  }

  /**
   * 任务事件桥：任务变化命中「同主体的流程」或「办理人自己的流程」。
   * 幂等锚＝工作流 + 任务 + 变化类型，同一次变化重复投递只起一次。
   */
  async runOnTaskEvent(input: WorkflowTaskTrigger): Promise<number> {
    const { task } = input;
    const orgMatched =
      task.orgType && task.orgUserId
        ? [{ orgType: task.orgType, orgUserId: task.orgUserId }]
        : [];
    const rows = await this.prisma.workflow.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [...orgMatched, { ownerUserId: task.assigneeUserId }],
      },
      orderBy: { id: 'asc' },
    });
    let started = 0;
    for (const row of rows) {
      const graph = this.readGraph(fromJson<WorkflowGraph>(row.graph));
      const hit = taskBindings(graph).some(
        (item) =>
          item.event === input.kind &&
          (!item.source || item.source === task.source),
      );
      if (!hit) continue;
      const actor = await this.triggerActor(row.ownerUserId, {
        orgType: row.orgType,
        orgUserId: row.orgUserId,
      });
      if (!actor) continue;
      started += await this.fire(actor, row.id, {
        trigger: 'TASK',
        input: { event: input.kind, task },
        sourceType: 'myTask',
        sourceId: String(task.id),
        dedupeKey: `wf:task:${row.id}:${task.id}:${input.kind}`,
      });
    }
    return started;
  }

  /** 触发一次运行：失败只告警不抛，避免一个坏流程拖死整轮扫描。返回是否真的新起了运行。 */
  private async fire(
    actor: CurrentUser,
    workflowId: number,
    body: Record<string, unknown>,
  ): Promise<number> {
    const depth = TRIGGER_DEPTH.getStore() ?? 0;
    if (depth >= MAX_TRIGGER_DEPTH) {
      this.logger.warn({
        operation: 'trigger',
        workflowId,
        message: `触发链已达 ${MAX_TRIGGER_DEPTH} 层，停止继续触发（防止流程互相触发成环）`,
      });
      return 0;
    }
    try {
      // 引擎是脱钩推进的，但 AsyncLocalStorage 会跟着 Promise 走，
      // 因此「流程动作 → 领域事件 → 另一个流程」这条链仍能数清层数。
      const result = await TRIGGER_DEPTH.run(depth + 1, () =>
        this.invoke(actor, { workflowId, ...body }),
      );
      return result.duplicated ? 0 : 1;
    } catch (failure) {
      this.logger.warn({
        operation: 'trigger',
        workflowId,
        trigger: text(body.trigger),
        error: failure instanceof Error ? failure.message : String(failure),
      });
      return 0;
    }
  }

  /**
   * 进程内触发的发起人＝工作流创建人，角色取账号目录里的真实角色，
   * 下游动作节点因此与本人手动运行走完全相同的权限判定。
   * 每次触发都按当前库表复核账号状态与组织在册资格：离职/停用即不再触发，
   * 不依赖异步清理成员关系或缓存。
   */
  private async triggerActor(
    ownerUserId: string,
    org?: { orgType: string; orgUserId: string },
  ): Promise<CurrentUser | null> {
    if (!ownerUserId) return null;
    const account = await this.prisma.userDirectory.findUnique({
      where: { userId: ownerUserId },
      select: { username: true, role: true, enabled: true },
    });
    if (!account || account.enabled === 0) return null;
    // 早于主体化的工作流没有 orgUserId（个人命名空间），此时只复核账号状态。
    const standing = await this.scope.isStanding(
      ownerUserId,
      org?.orgUserId ? org : undefined,
    );
    if (!standing) return null;
    return new CurrentUser(ownerUserId, account.username, account.role);
  }

  // ---------------------------------------------------------------- 内部助手

  /** 可运行性：非创建人只能跑已发布；已发布必须有版本快照。 */
  private async assertRunnable(row: Workflow, user: CurrentUser) {
    const owner = row.ownerUserId === user.userId;
    if (row.status !== 'PUBLISHED' && !owner) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '该工作流尚未发布，只有创建人可以试跑',
      );
    }
    if (row.status === 'PUBLISHED') {
      const published = await this.publishedVersions([row.id]);
      if (!published.has(row.id)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '已发布版本缺失，请重新发布',
        );
      }
    }
  }

  /** 草稿试跑：把当前图冻结到当前版本号，运行台账与发布运行同一份读取口径。 */
  private async freezeDraftVersion(row: Workflow, user: CurrentUser) {
    if (row.status === 'PUBLISHED' || row.ownerUserId !== user.userId) return;
    const graph = fromJson<WorkflowGraph>(row.graph);
    const compiled = compileGraph(graph);
    if (!compiled.ok)
      throw new BusinessException(ErrorCode.BAD_REQUEST, compiled.message);
    const triggers = validateTriggers(graph);
    if (!triggers.ok)
      throw new BusinessException(ErrorCode.BAD_REQUEST, triggers.message);
    await this.prisma.workflowVersion.upsert({
      where: {
        workflowId_version: { workflowId: row.id, version: row.version },
      },
      create: {
        workflowId: row.id,
        version: row.version,
        graph: toJsonInput(graph),
        inputSchema: toJsonInput(fromJson<unknown>(row.inputSchema)),
        publishedBy: user.userId,
      },
      update: {
        graph: toJsonInput(graph),
        inputSchema: toJsonInput(fromJson<unknown>(row.inputSchema)),
        publishedBy: user.userId,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * 运行台账落库：dedupeKey 是唯一索引，撞键即说明这次触发已经起过流程，
   * 直接把既有 runId 交回调用方（duplicated=true），不再启动引擎。
   */
  private async createRun(
    row: Workflow,
    user: CurrentUser,
    options: {
      trigger: string;
      input: Record<string, unknown>;
      sourceType?: string;
      sourceId?: string;
      dedupeKey?: string;
    },
  ): Promise<{ run: WorkflowRun; duplicated: boolean }> {
    const data = {
      workflowId: row.id,
      version: row.version,
      trigger: options.trigger,
      status: 'PENDING',
      input: toJsonInput(options.input),
      actorId: user.userId,
      sourceType: options.sourceType ?? '',
      sourceId: options.sourceId ?? '',
      dedupeKey: options.dedupeKey || null,
      // 预算快照：运行途中改流程预算不影响在途运行，本次按创建时这份判顶。
      budgets: toJsonInput(this.budgetConfig(row.budgets)),
    };
    try {
      return {
        run: await this.prisma.workflowRun.create({ data }),
        duplicated: false,
      };
    } catch (failure) {
      if ((failure as { code?: string }).code !== 'P2002' || !data.dedupeKey) {
        throw failure;
      }
      const existing = await this.prisma.workflowRun.findUnique({
        where: { dedupeKey: data.dedupeKey },
      });
      if (!existing) throw failure;
      return { run: existing, duplicated: true };
    }
  }

  private async loadByKey(user: CurrentUser, key: string): Promise<Workflow> {
    const row = await this.prisma.workflow.findUnique({
      where: { businessKey: key },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `没有业务标识为「${key}」的工作流`,
      );
    return this.load(user, String(row.id));
  }

  private normalizeBusinessKey(raw: unknown): string {
    const value = text(raw).trim().slice(0, 80);
    if (!value) return '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '业务标识只能用字母、数字、点、下划线与短横线，且以字母或数字开头',
      );
    }
    return value;
  }

  private async assertBusinessKeyFree(key: string, exceptId?: number) {
    if (!key) return;
    const taken = await this.prisma.workflow.findFirst({
      where: {
        businessKey: key,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `业务标识「${key}」已被工作流 #${taken.id} 占用`,
      );
    }
  }

  private async loadRun(id: number): Promise<WorkflowRun> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '运行记录不存在');
    }
    const row = await this.prisma.workflowRun.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '运行记录不存在');
    return row;
  }

  private async load(user: CurrentUser, id: string): Promise<Workflow> {
    const workflowId = Number(id);
    if (!Number.isInteger(workflowId) || workflowId <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '工作流不存在');
    }
    const row = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '工作流不存在');
    // 可见性：本人 / 本主体的 ORG 共享 / 本服务商机构的 PROVIDER 共享。
    if (row.ownerUserId === user.userId) return row;
    const orgs = await this.orgKeys(user);
    const visible =
      (row.scope === 'ORG' && orgs.enterprise.includes(row.orgUserId)) ||
      (row.scope === 'PROVIDER' && orgs.provider.includes(row.orgUserId)) ||
      user.isAdmin();
    if (!visible)
      throw new BusinessException(ErrorCode.FORBIDDEN, '无权访问该工作流');
    return row;
  }

  private assertEditable(row: Workflow, user: CurrentUser) {
    if (row.ownerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '共享工作流只读可用，只有创建人可以编辑',
      );
    }
  }

  private normalizeScope(raw: string): string {
    const scope = raw.trim().toUpperCase() || 'PRIVATE';
    if (!['PRIVATE', 'ORG', 'PROVIDER'].includes(scope)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '可见性取值不合法');
    }
    return scope;
  }

  /**
   * 共享到哪一个主体：用户显式选择的优先，但必须确属本人所在机构；未选时沿用当前主体。
   * 私有工作流不进共享清单，主体键只作归属记录。
   */
  private orgForScope(scope: string, orgs: OrgKeys, requested: string) {
    if (scope === 'PRIVATE') {
      return { orgType: 'ENTERPRISE', orgUserId: orgs.current.orgUserId };
    }
    const isProvider = scope === 'PROVIDER';
    const allowed = isProvider ? orgs.provider : orgs.enterprise;
    if (requested && !allowed.includes(requested)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        isProvider
          ? '你不属于该服务商机构，不能共享到它'
          : '你不属于该公司主体，不能共享到它',
      );
    }
    const orgUserId = this.shareOrgId(
      isProvider ? 'provider' : 'org',
      requested,
      orgs,
    );
    if (!orgUserId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        isProvider
          ? '你不属于任何服务商机构，不能设为服务商共享'
          : '你不属于任何公司主体，不能设为公司共享',
      );
    }
    return {
      orgType: isProvider ? 'PROVIDER' : 'ENTERPRISE',
      orgUserId,
    };
  }

  private readGraph(raw: unknown): WorkflowGraph {
    const graph = (raw ?? {}) as Partial<WorkflowGraph>;
    return {
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
    };
  }

  private async orgKeys(user: CurrentUser): Promise<OrgKeys> {
    const contexts = await this.orgs.contexts(user);
    const enterprise: string[] = [];
    const provider: string[] = [];
    const options: OrgOption[] = [];
    let current = { orgType: 'ENTERPRISE', orgUserId: user.userId };
    for (const context of contexts) {
      if (context.orgType === 'PROVIDER') provider.push(context.orgUserId);
      else enterprise.push(context.orgUserId);
      options.push({
        orgType: context.orgType,
        orgUserId: context.orgUserId,
        name: context.name || context.orgUserId,
        current: context.current,
      });
      if (context.current) {
        current = { orgType: context.orgType, orgUserId: context.orgUserId };
      }
    }
    if (!enterprise.length) {
      enterprise.push(user.userId);
      options.push({
        orgType: 'ENTERPRISE',
        orgUserId: user.userId,
        name: user.username || user.userId,
        current: true,
      });
    }
    return { enterprise, provider, current, options };
  }

  /**
   * 共享分组落到哪一个主体：请求指定的优先（必须是本人所属），否则取当前主体，再否则取第一个。
   * 任何情况下都只返回一个主体——不同主体的工作流数据域不同，不能混在一个清单里。
   */
  private shareOrgId(group: string, requested: string, orgs: OrgKeys): string {
    const allowed = group === 'provider' ? orgs.provider : orgs.enterprise;
    if (requested && allowed.includes(requested)) return requested;
    if (allowed.includes(orgs.current.orgUserId)) return orgs.current.orgUserId;
    return allowed[0] ?? '';
  }

  /** 已发布版本号：status 为 PUBLISHED 且版本快照存在时为 workflow.version。 */
  private async publishedVersions(ids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!ids.length) return out;
    const rows = await this.prisma.workflow.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED' },
      select: { id: true, version: true },
    });
    for (const row of rows) out.set(row.id, row.version);
    return out;
  }

  /** 预算配置读成定口径对象：缺省与非法值一律按 0（不限），不把脏数据带进运行。 */
  private budgetConfig(raw: unknown): WorkflowBudgets {
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const pick = (key: keyof WorkflowBudgets) => {
      const value = Math.floor(Number(source[key] ?? 0));
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return {
      maxAiCalls: pick('maxAiCalls'),
      maxTokens: pick('maxTokens'),
      maxToolCalls: pick('maxToolCalls'),
      maxBrowserActions: pick('maxBrowserActions'),
      maxNodes: pick('maxNodes'),
    };
  }

  /** 保存时的增量合并：只改传上来的项，没传的沿用当前配置。 */
  private normalizeBudgets(
    patch: unknown,
    current: WorkflowBudgets,
  ): WorkflowBudgets {
    const source =
      patch && typeof patch === 'object' && !Array.isArray(patch)
        ? (patch as Record<string, unknown>)
        : {};
    const next = { ...current };
    for (const key of Object.keys(next) as (keyof WorkflowBudgets)[]) {
      if (source[key] === undefined) continue;
      const value = Math.floor(Number(source[key] ?? 0));
      if (!Number.isFinite(value) || value < 0) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '执行预算必须是 0 或正整数（0 表示不限）',
        );
      }
      next[key] = value;
    }
    return next;
  }

  private usageOf(raw: unknown): WorkflowUsage {
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const num = (key: keyof WorkflowUsage) => {
      const value = Number(source[key] ?? 0);
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return {
      nodes: num('nodes'),
      aiCalls: num('aiCalls'),
      tokenIn: num('tokenIn'),
      tokenOut: num('tokenOut'),
      toolCalls: num('toolCalls'),
      browserActions: num('browserActions'),
    };
  }

  private toRow(
    row: Workflow,
    user: CurrentUser,
    publishedVersion: number | undefined,
  ): WorkflowRow {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      name: row.name,
      description: row.description,
      businessKey: row.businessKey ?? '',
      budgets: this.budgetConfig(row.budgets),
      scope: row.scope,
      scopeLabel: WORKFLOW_SCOPE_LABELS[row.scope] ?? row.scope,
      status: row.status,
      statusLabel: WORKFLOW_STATUS_LABELS[row.status] ?? row.status,
      version: row.version,
      publishedVersion: publishedVersion ?? null,
      graph: this.readGraph(fromJson<WorkflowGraph>(row.graph)),
      inputSchema: fromJson<Record<string, unknown>>(row.inputSchema) ?? {},
      outputSchema: fromJson<Record<string, unknown>>(row.outputSchema) ?? {},
      createdBy: row.createdBy,
      editable: row.ownerUserId === user.userId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async runRow(
    run: WorkflowRun,
    workflow: { name: string },
    steps?: WorkflowRunStep[],
  ) {
    const rows =
      steps ??
      (await this.prisma.workflowRunStep.findMany({
        where: { runId: run.id },
        orderBy: { id: 'asc' },
      }));
    return {
      id: run.id,
      workflowId: run.workflowId,
      workflowName: workflow.name,
      version: run.version,
      trigger: run.trigger,
      triggerLabel: WORKFLOW_TRIGGER_LABELS[run.trigger] ?? run.trigger,
      status: run.status,
      statusLabel: WORKFLOW_RUN_STATUS_LABELS[run.status] ?? run.status,
      input: fromJson<unknown>(run.input),
      output: fromJson<unknown>(run.output),
      actorId: run.actorId,
      error: run.error,
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      budgets: this.budgetConfig(run.budgets),
      usage: this.usageOf(run.usage),
      budgetStop: run.budgetStop,
      budgetStopLabel:
        WORKFLOW_BUDGET_STOP_LABELS[run.budgetStop] ?? run.budgetStop,
      steps: rows.map((step) => this.stepRow(step)),
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      createdAt: run.createdAt.toISOString(),
    };
  }

  private stepRow(step: WorkflowRunStep) {
    return {
      id: step.id,
      runId: step.runId,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      status: step.status,
      input: fromJson<unknown>(step.input),
      output: fromJson<unknown>(step.output),
      error: step.error,
      attempts: step.attempts,
      durationMs: step.durationMs,
      startedAt: step.startedAt ? step.startedAt.toISOString() : null,
      finishedAt: step.finishedAt ? step.finishedAt.toISOString() : null,
    };
  }
}

/** Prisma 的 `in` 不接受空数组（会退化成恒假/恒真），补一个不可能命中的哨兵。 */
const NO_ORG = '__none__';

function searchable(ids: string[]): string[] {
  return ids.length ? ids : [NO_ORG];
}
