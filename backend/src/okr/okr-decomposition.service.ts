import {
  OKR_DECOMPOSITION_STATUS_LABELS,
  OKR_OPTION_LABELS,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aiJson } from '../ai/ai-gateway';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  dateStr,
  int,
  iso,
  jsonArray,
  jsonObject,
  num,
  progressOf,
  round,
} from './okr.helpers';
import type { OkrService } from './okr.service';
import { OkrBriefService, type BriefRow } from './okr-brief.service';
import { OkrTaskLinkageService } from './okr.task-linkage.service';
import {
  buildRulePayload,
  normalizePayload,
  OPTION_KEYS,
  splitPayload,
  type DecompositionPayload,
  type OptionKey,
} from './okr-decomposition.rules';
import { OkrContext, OkrMemberRow, OkrScopeService } from './okr.scope';

type DecompositionRow = {
  id: number;
  briefId: number;
  orgType: string;
  orgUserId: string;
  version: number;
  mode: string;
  optionKey: string;
  payload: unknown;
  status: string;
  committedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const STATUS_LABELS = OKR_DECOMPOSITION_STATUS_LABELS;
const TASK_DONE: Record<string, number> = {
  DONE: 100,
  REVIEW: 80,
  DOING: 50,
  TODO: 0,
  CANCELED: 0,
};

const dayDiff = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(Math.round((end - start) / 86_400_000) + 1, 1);
};

const clampDate = (value: string, start: string, end: string) => {
  if (!value) return end;
  if (value < start) return start;
  if (value > end) return end;
  return value;
};

/**
 * OKR 2.0 拆解：生成候选 → 容量/预算/工期模拟 → 人工确认落库 → 任务关联与考核预览。
 * AI 只产出候选；负责人白名单、金额来源、指标源闭集在 rules 层统一收敛。
 */
export class OkrDecompositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OkrScopeService,
    private readonly briefs: OkrBriefService,
    private readonly okr: OkrService,
    private readonly notifications: NotificationService,
    private readonly taskLinkage: OkrTaskLinkageService,
  ) {}

  private async decompositionOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrDecomposition.findFirst({
      where: { id, orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '拆解方案不存在');
    return row as DecompositionRow;
  }

  private view(row: DecompositionRow) {
    const { payload, simulation } = splitPayload(row.payload);
    return {
      id: row.id,
      briefId: row.briefId,
      version: row.version,
      mode: row.mode,
      optionKey: row.optionKey,
      optionLabel: OKR_OPTION_LABELS[row.optionKey] || row.optionKey,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      payload,
      simulation: simulation || null,
      committedAt: iso(row.committedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private async generationContext(ctx: OkrContext) {
    const [members, parties, rates] = await Promise.all([
      this.scope.members(ctx.ownerUserId),
      this.prisma.bizParty.findMany({
        where: { orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
        select: { id: true, name: true, kind: true, capabilities: true },
        take: 100,
      }),
      this.prisma.pjCostRate.findMany({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          principalType: 'STAFF',
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    ]);
    const rateByMember = new Map<string, number>();
    for (const row of rates) {
      if (!rateByMember.has(row.principalId)) {
        rateByMember.set(row.principalId, num(row.hourlyRate));
      }
    }
    return { members, parties, rateByMember };
  }

  private async askAi(
    ctx: OkrContext,
    brief: BriefRow,
    members: OkrMemberRow[],
    parties: Array<{
      id: number;
      name: string;
      kind: string;
      capabilities: unknown;
    }>,
    optionKeys: OptionKey[],
    start: string,
    end: string,
  ) {
    const memberList = members.map((item) => ({
      id: item.memberUserId,
      name: item.name,
      department: item.department,
      positions: item.positions.map((position) => position.name),
      capabilities: item.capabilities.slice(0, 200),
    }));
    const partyList = parties.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      capabilities: item.capabilities,
    }));
    const system = [
      '你是企业增长与项目管理顾问，负责把总体业务目标拆成可落地的 OKR 与项目任务。',
      '只输出一个 JSON 对象，不要输出解释文字。结构：',
      '{"options":[{"optionKey":"CONSERVATIVE|BALANCED|AGGRESSIVE","summary":"","confidence":"LOW|MEDIUM|HIGH","assumptions":[],"risks":[{"risk":"","impact":"","mitigation":""}],"objectives":[{"key":"o1","level":"COMPANY|DEPT|PERSONAL","title":"","description":"","ownerMemberUserId":"","weight":1,"krs":[{"key":"k1","title":"","metricType":"MANUAL|AUTO","baseline":0,"target":0,"unit":"","direction":"UP|DOWN","weight":1,"ownerMemberUserId":"","metricSource":{}}]}],"tasks":[{"key":"t1","objectiveKey":"o1","krKey":"k1","title":"","detail":"","deliverable":"","acceptance":[{"label":"","required":true,"evidence":""}],"rubric":[{"level":"PASS","label":"合格","description":""}],"weight":1,"estimateHours":0,"dueDate":"YYYY-MM-DD","priority":"LOW|MEDIUM|HIGH","ownerMemberUserId":"","dependencies":[],"externalPartyIds":[]}]}]}',
      '硬约束：',
      '1. 负责人只能从成员名单选择；账号负责人本人用空字符串。',
      '2. 金额、工时、费率只能使用目标书已给的数字，不得编造；缺失就留 0 并在 assumptions 说明。',
      '3. 每个目标 2–5 个 KR；每个 KR 1–6 个任务；任务必须含至少 2 条验收与 3 档 rubric。',
      '4. metricSource.source 只能使用：CRM_OPPORTUNITY, CRM_CONTRACT, CRM_PAYMENT, CRM_ORDER, SIGN_CONTRACT, DATA_TABLE, LOWCODE_ENTITY；无法自动取数用 MANUAL 与空对象。',
      `5. 任务截止日必须在 ${start} 到 ${end} 之间；外部合作只在 externalPartyIds 里使用名单中的主体。`,
      '6. 稳健方案目标更保守、给缓冲；进取方案更有挑战；平衡方案居中。',
    ].join('\n');
    const result = await aiJson(this.prisma, {
      userId: ctx.actorId,
      module: 'okr',
      operation: 'decomposition_generate',
      maxTokens: 7000,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            requestedOptions: optionKeys,
            window: { start, end },
            cycleId: brief.cycleId,
            brief: {
              title: brief.title,
              businessGoal: brief.businessGoal,
              scopeWhat: brief.scopeWhat,
              scopeTarget: brief.scopeTarget,
              deliverables: brief.deliverables,
              budgetAmount: num(brief.budgetAmount),
              budgetHours: num(brief.budgetHours),
              currency: brief.currency,
              labor: brief.labor,
              materials: brief.materials,
              equipment: brief.equipment,
              externalServices: brief.externalServices,
              constraints: brief.constraints,
            },
            members: memberList,
            parties: partyList,
          }),
        },
      ],
      validate: (raw) => (Array.isArray(raw['options']) ? raw : null),
    });
    if (!result) return null;
    const byOption = new Map<OptionKey, DecompositionPayload>();
    const partyIds = new Set(parties.map((item) => item.id));
    for (const entry of result.data['options'] as unknown[]) {
      const option = jsonObject(entry);
      const key = text(option['optionKey']).toUpperCase() as OptionKey;
      if (!OPTION_KEYS.includes(key)) continue;
      const normalized = normalizePayload(option, key, {
        members,
        partyIds,
        startDate: start,
        endDate: end,
        defaultSummary: `AI 方案（${OKR_OPTION_LABELS[key]}）`,
      });
      if (normalized) byOption.set(key, { ...normalized, mode: 'LLM' });
    }
    return byOption.size ? byOption : null;
  }

  async list(user: CurrentUser, briefId: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const brief = await this.briefs.row(ctx, this.briefIdOf(briefId));
    const rows = await this.prisma.okrDecomposition.findMany({
      where: { briefId: brief.id },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    return rows.map((row) => this.view(row as DecompositionRow));
  }

  async generate(
    user: CurrentUser,
    briefId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const brief = await this.briefs.row(ctx, this.briefIdOf(briefId));
    if (brief.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标书已关闭，不能继续拆解',
      );
    }
    if (brief.status === 'COMMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标书已落库；如需重新拆解，请另建目标书',
      );
    }
    const readiness = await this.briefs.readiness(ctx, brief);
    if (readiness.blockers.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `目标书还有未完成项：${readiness.blockers.join('；')}`,
      );
    }
    const requested = text(body['optionKey']).toUpperCase() as OptionKey;
    const optionKeys = OPTION_KEYS.includes(requested)
      ? [requested]
      : OPTION_KEYS;
    const { members, parties } = await this.generationContext(ctx);
    const start = text(brief.startDate) || dateStr(new Date());
    const end = text(brief.endDate) || start;
    let aiOptions: Map<OptionKey, DecompositionPayload> | null = null;
    if (!body['forceRule']) {
      aiOptions = await this.askAi(
        ctx,
        brief,
        members,
        parties,
        optionKeys,
        start,
        end,
      );
    }
    const actorNames = await this.scope.names([ctx.actorId]);
    const actorName = actorNames.get(ctx.actorId) || '本人';
    const last = await this.prisma.okrDecomposition.findFirst({
      where: { briefId: brief.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    let version = (last?.version || 0) + 1;
    const created: DecompositionRow[] = [];
    for (const optionKey of optionKeys) {
      const payload =
        aiOptions?.get(optionKey) ||
        buildRulePayload({ brief, members, optionKey, actorName });
      const saved = await this.prisma.okrDecomposition.create({
        data: {
          briefId: brief.id,
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          version,
          mode: payload.mode,
          optionKey,
          payload: toJsonInput(payload),
          status: 'DRAFT',
          createdBy: ctx.actorId,
        },
      });
      created.push(saved);
      version += 1;
    }
    if (brief.status !== 'READY' && brief.status !== 'CLARIFYING') {
      await this.prisma.okrGoalBrief.update({
        where: { id: brief.id },
        data: { status: 'READY' },
      });
    }
    return created.map((row) => this.view(row));
  }

  private simulatePayload(
    payload: DecompositionPayload,
    brief: BriefRow,
    members: OkrMemberRow[],
    rateByMember: Map<string, number>,
    ownerName: string,
  ) {
    const start = text(brief.startDate) || dateStr(new Date());
    const end = text(brief.endDate) || start;
    const days = dayDiff(start, end);
    const capacityHours = days * 8;
    const names = new Map(members.map((row) => [row.memberUserId, row.name]));
    names.set('', ownerName);
    const hoursByMember = new Map<string, number>();
    for (const task of payload.tasks) {
      hoursByMember.set(
        task.ownerMemberUserId,
        (hoursByMember.get(task.ownerMemberUserId) || 0) + task.estimateHours,
      );
    }
    const capacity = [...hoursByMember.entries()].map(
      ([memberUserId, hours]) => {
        const load = capacityHours
          ? round((hours / capacityHours) * 100, 1)
          : 0;
        return {
          memberUserId,
          name: names.get(memberUserId) || memberUserId || '账号负责人',
          hours: round(hours, 1),
          load,
          ok: load <= 100,
        };
      },
    );
    const internalCost = round(
      payload.tasks.reduce(
        (sum, task) =>
          sum +
          task.estimateHours * (rateByMember.get(task.ownerMemberUserId) || 0),
        0,
      ),
      2,
    );
    const briefExternalCost = jsonArray(brief.externalServices).reduce<number>(
      (sum, item) => sum + num(jsonObject(item)['budget']),
      0,
    );
    const externalCost = round(
      payload.cost.externalCost > 0
        ? payload.cost.externalCost
        : briefExternalCost,
      2,
    );
    const planned = round(internalCost + externalCost, 2);
    const budget = num(brief.budgetAmount);
    const remaining = round(budget - planned, 2);
    const checks: Array<{
      key: string;
      label: string;
      status: 'PASS' | 'WARN' | 'FAIL';
      detail: string;
    }> = [];
    const memberSet = new Set(members.map((row) => row.memberUserId));
    const badOwners = payload.tasks.filter(
      (task) =>
        task.ownerMemberUserId && !memberSet.has(task.ownerMemberUserId),
    );
    checks.push({
      key: 'owner',
      label: '负责人可承接',
      status: badOwners.length ? 'FAIL' : 'PASS',
      detail: badOwners.length
        ? `${badOwners.length} 个任务的负责人不在组织名册`
        : '全部任务负责人均在组织名册内',
    });
    const overload = capacity.filter((row) => row.load > 100);
    const near = capacity.filter((row) => row.load > 85 && row.load <= 100);
    checks.push({
      key: 'capacity',
      label: '人力容量',
      status: overload.length ? 'FAIL' : near.length ? 'WARN' : 'PASS',
      detail: overload.length
        ? `${overload.map((row) => `${row.name} ${row.load}%`).join('、')} 超出可用工时`
        : near.length
          ? `${near.map((row) => `${row.name} ${row.load}%`).join('、')} 接近满载`
          : `${capacityHours} 小时/人可用，负载正常`,
    });
    checks.push({
      key: 'budget',
      label: '预算',
      status:
        budget <= 0
          ? 'WARN'
          : planned > budget
            ? 'FAIL'
            : planned > budget * 0.9
              ? 'WARN'
              : 'PASS',
      detail:
        budget <= 0
          ? '目标书未填预算，成本只能给区间'
          : `计划 ${planned} / 预算 ${budget}，剩余 ${remaining}`,
    });
    const lastDue = payload.tasks.reduce(
      (max, task) => (task.dueDate > max ? task.dueDate : max),
      start,
    );
    const criticalDays = dayDiff(start, clampDate(lastDue, start, end));
    checks.push({
      key: 'timeline',
      label: '工期',
      status:
        lastDue > end ? 'FAIL' : criticalDays > days * 0.9 ? 'WARN' : 'PASS',
      detail: `任务最晚 ${lastDue}，目标书截止 ${end}（可用 ${days} 天）`,
    });
    const krs = payload.objectives.flatMap((objective) => objective.krs);
    const unmeasured = krs.filter((kr) => kr.target === kr.baseline);
    checks.push({
      key: 'measure',
      label: 'KR 可衡量',
      status: unmeasured.length ? 'WARN' : 'PASS',
      detail: unmeasured.length
        ? `${unmeasured.map((kr) => kr.title).join('、')} 的目标与基线相同`
        : '全部 KR 有可量化目标',
    });
    const uncovered = krs.filter(
      (kr) => !payload.tasks.some((task) => task.krKey === kr.key),
    );
    checks.push({
      key: 'coverage',
      label: '任务覆盖',
      status: uncovered.length ? 'FAIL' : 'PASS',
      detail: uncovered.length
        ? `${uncovered.map((kr) => kr.title).join('、')} 没有承接任务`
        : '每个 KR 至少有一个任务',
    });
    const rateConfigured = [...rateByMember.values()].some((rate) => rate > 0);
    checks.push({
      key: 'rate',
      label: '费率',
      status: rateConfigured ? 'PASS' : 'WARN',
      detail: rateConfigured
        ? '已按费率表计算内部人力成本'
        : '未配置人工费率，内部成本按 0 计，需补费率后再定预算',
    });
    const feasible = !checks.some((check) => check.status === 'FAIL');
    return {
      feasible,
      checks,
      capacity,
      budget: {
        planned,
        internal: internalCost,
        external: externalCost,
        remaining,
      },
      timeline: {
        startDate: start,
        endDate: end,
        criticalDays,
        deadlineDays: days,
      },
      notes: [
        ...payload.assumptions.slice(0, 3),
        ...payload.risks.map((risk) => risk.mitigation).slice(0, 2),
      ],
    };
  }

  async simulate(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const row = await this.decompositionOf(ctx, this.idOf(id));
    if (row.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.CONFLICT, '已确认的方案不能再模拟');
    }
    const brief = await this.briefs.row(ctx, row.briefId);
    const { payload } = splitPayload(row.payload);
    const { members, rateByMember } = await this.generationContext(ctx);
    const names = await this.scope.names([ctx.ownerUserId, ctx.actorId]);
    const ownerName = names.get(ctx.ownerUserId) || '账号负责人';
    const simulation = this.simulatePayload(
      payload,
      brief,
      members,
      rateByMember,
      ownerName,
    );
    const stored = toJsonInput({
      ...payload,
      simulation,
    });
    const saved = await this.prisma.okrDecomposition.update({
      where: { id: row.id },
      data: { payload: stored },
    });
    return this.view(saved);
  }

  async commit(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const row = await this.decompositionOf(ctx, this.idOf(id));
    if (row.status !== 'DRAFT') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该方案已处理，不能重复落库',
      );
    }
    const brief = await this.briefs.row(ctx, row.briefId);
    if (brief.status === 'COMMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标书已落库；如需重新拆解，请另建目标书',
      );
    }
    const readiness = await this.briefs.readiness(ctx, brief);
    if (readiness.blockers.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `目标书还有未完成项：${readiness.blockers.join('；')}`,
      );
    }
    const cycle = await this.prisma.okrCycle.findFirst({
      where: { id: brief.cycleId, orgUserId: ctx.ownerUserId },
    });
    if (!cycle) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标书关联的周期不存在',
      );
    }
    if (!['DRAFT', 'ACTIVE'].includes(cycle.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '周期已关闭，不能再落库目标',
      );
    }
    const { members, parties } = await this.generationContext(ctx);
    const { payload } = splitPayload(row.payload);
    const normalized = normalizePayload(payload, payload.optionKey, {
      members,
      partyIds: new Set(parties.map((item) => item.id)),
      startDate: text(brief.startDate),
      endDate: text(brief.endDate),
      defaultSummary: payload.summary,
    });
    if (!normalized) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '拆解方案内容为空，请重新生成',
      );
    }
    const memberNames = new Map(
      members.map((item) => [item.memberUserId, item.name]),
    );
    const existingProjectId = int(body['projectId']);
    const projectName =
      text(body['projectName']).trim().slice(0, 200) || brief.title;
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.okrDecomposition.findFirst({
          where: { id: row.id, status: 'DRAFT' },
        });
        if (!fresh) {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '该方案已处理，不能重复落库',
          );
        }
        let projectId = existingProjectId;
        if (projectId) {
          const project = await tx.pjProject.findFirst({
            where: {
              id: projectId,
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
            },
          });
          if (!project) {
            throw new BusinessException(ErrorCode.NOT_FOUND, '关联项目不存在');
          }
          await tx.pjProject.update({
            where: { id: project.id },
            data: {
              source: 'OKR',
              sourceRef: String(brief.id),
              briefId: brief.id,
              targetOutcome: project.targetOutcome || brief.scopeTarget,
              deliverables: toJsonInput(
                project.deliverables || brief.deliverables,
              ),
            },
          });
        } else {
          const project = await tx.pjProject.create({
            data: {
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
              name: projectName,
              description: brief.businessGoal.slice(0, 2000),
              source: 'OKR',
              sourceRef: String(brief.id),
              briefId: brief.id,
              targetOutcome: brief.scopeTarget,
              deliverables: (brief.deliverables as Prisma.InputJsonValue) || [],
              budgetBreakdown: {
                internal: normalized.cost.internalCost,
                external: normalized.cost.externalCost,
                laborHours: normalized.cost.laborHours,
              },
              ownerId: ctx.ownerUserId,
              status: 'ACTIVE',
              startDate: brief.startDate,
              endDate: brief.endDate,
              budgetAmount: num(brief.budgetAmount),
              budgetHours: num(brief.budgetHours),
              currency: brief.currency,
              createdBy: ctx.actorId,
            },
          });
          projectId = project.id;
        }
        let rootId = 0;
        const objectiveIdByKey = new Map<string, number>();
        for (const [index, node] of normalized.objectives.entries()) {
          const parentId = node.level === 'COMPANY' ? 0 : rootId;
          const saved = await tx.okrObjective.create({
            data: {
              ownerUserId: ctx.ownerUserId,
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
              briefId: brief.id,
              cycleId: brief.cycleId,
              parentId,
              level: node.level,
              title: node.title.slice(0, 200),
              description: node.description.slice(0, 2000),
              ownerMemberUserId:
                node.ownerMemberUserId === ctx.ownerUserId
                  ? ''
                  : node.ownerMemberUserId,
              weight: Math.min(Math.max(node.weight || 1, 0), 100),
              visibility: 'ORG',
              status: 'ACTIVE',
              source: 'AGENT',
            },
          });
          if (index === 0 || node.level === 'COMPANY')
            rootId = rootId || saved.id;
          objectiveIdByKey.set(node.key, saved.id);
        }
        const krByKey = new Map<
          string,
          { id: number; objectiveId: number; target: number; unit: string }
        >();
        for (const node of normalized.objectives) {
          const objectiveId = objectiveIdByKey.get(node.key)!;
          for (const kr of node.krs) {
            const saved = await tx.okrKeyResult.create({
              data: {
                ownerUserId: ctx.ownerUserId,
                orgType: ctx.orgType,
                orgUserId: ctx.ownerUserId,
                objectiveId,
                title: kr.title.slice(0, 200),
                metricType: kr.metricType,
                targetValue: kr.target,
                currentValue: kr.baseline,
                startValue: kr.baseline,
                unit: kr.unit.slice(0, 32),
                direction: kr.direction,
                weight: Math.min(Math.max(kr.weight || 1, 0), 100),
                ownerMemberUserId:
                  kr.ownerMemberUserId === ctx.ownerUserId
                    ? ''
                    : kr.ownerMemberUserId,
                metricSource: toJsonInput(kr.metricSource),
              },
            });
            krByKey.set(kr.key, {
              id: saved.id,
              objectiveId,
              target: kr.target,
              unit: kr.unit,
            });
          }
        }
        const taskIdByKey = new Map<string, number>();
        const taskRows: Array<{
          id: number;
          title: string;
          objectiveId: number;
          krId: number;
          ownerMemberUserId: string;
          key: string;
        }> = [];
        for (const [index, task] of normalized.tasks.entries()) {
          const kr = krByKey.get(task.krKey) || [...krByKey.values()][0];
          if (!kr) continue;
          const owner =
            task.ownerMemberUserId === ctx.ownerUserId
              ? ''
              : task.ownerMemberUserId;
          const saved = await tx.pjTask.create({
            data: {
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
              projectId: projectId,
              title: task.title.slice(0, 200),
              description: [
                task.detail,
                task.deliverable ? `交付物：${task.deliverable}` : '',
              ]
                .filter(Boolean)
                .join('\n')
                .slice(0, 4000),
              sourceType: 'OKR',
              sourceId: String(kr.id),
              acceptanceCriteria: task.acceptance,
              qualityRubric: { levels: task.rubric },
              assessmentWeight: Math.min(Math.max(task.weight || 1, 0), 100),
              type: 'TASK',
              priority: task.priority,
              status: 'TODO',
              assigneeType: owner ? 'STAFF' : 'NONE',
              assigneeId: owner,
              estimateHours: Math.max(task.estimateHours, 0),
              startDate: brief.startDate,
              dueDate: clampDate(task.dueDate, brief.startDate, brief.endDate),
              sortOrder: index,
              createdBy: ctx.actorId,
            },
          });
          taskIdByKey.set(task.key, saved.id);
          taskRows.push({
            id: saved.id,
            title: saved.title,
            objectiveId: kr.objectiveId,
            krId: kr.id,
            ownerMemberUserId: owner,
            key: task.key,
          });
        }
        for (const task of normalized.tasks) {
          const taskId = taskIdByKey.get(task.key);
          if (!taskId) continue;
          for (const dependency of task.dependencies) {
            const relatedTaskId = taskIdByKey.get(dependency);
            if (!relatedTaskId || relatedTaskId === taskId) continue;
            await tx.pjTaskRelation.upsert({
              where: {
                taskId_relatedTaskId_kind: {
                  taskId,
                  relatedTaskId,
                  kind: 'FS',
                },
              },
              create: {
                orgType: ctx.orgType,
                orgUserId: ctx.ownerUserId,
                taskId,
                relatedTaskId,
                kind: 'FS',
              },
              update: {},
            });
          }
        }
        const linkRows: Array<{
          id: number;
          objectiveId: number;
          krId: number;
          taskId: number;
          weight: unknown;
          targetValue: unknown;
          acceptance: unknown;
          ownerMemberUserId: string;
          createdAt: Date;
          updatedAt: Date;
        }> = [];
        for (const task of normalized.tasks) {
          const taskId = taskIdByKey.get(task.key);
          const kr = krByKey.get(task.krKey);
          if (!taskId || !kr) continue;
          const link = await tx.okrTaskLink.create({
            data: {
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
              objectiveId: kr.objectiveId,
              krId: kr.id,
              taskId,
              weight: Math.min(Math.max(task.weight || 1, 0), 100),
              targetValue: kr.target,
              acceptance: task.acceptance,
              ownerMemberUserId:
                task.ownerMemberUserId === ctx.ownerUserId
                  ? ''
                  : task.ownerMemberUserId,
            },
          });
          linkRows.push(link);
        }
        await this.createPersonalObjectives(
          tx,
          ctx,
          brief,
          normalized,
          taskRows,
          taskIdByKey,
        );
        for (const owner of new Set(
          taskRows.map((row) => row.ownerMemberUserId),
        )) {
          if (!owner) continue;
          await tx.pjProjectMember.upsert({
            where: {
              projectId_principalType_principalId: {
                projectId,
                principalType: 'STAFF',
                principalId: owner,
              },
            },
            create: {
              orgType: ctx.orgType,
              orgUserId: ctx.ownerUserId,
              projectId,
              principalType: 'STAFF',
              principalId: owner,
              role: 'MEMBER',
              allocationPct: 100,
            },
            update: {},
          });
        }
        await tx.okrDecomposition.updateMany({
          where: { briefId: brief.id, status: 'DRAFT', id: { not: row.id } },
          data: { status: 'REJECTED' },
        });
        await tx.okrDecomposition.update({
          where: { id: row.id },
          data: {
            status: 'CONFIRMED',
            committedAt: new Date(),
            payload: toJsonInput({ ...normalized }),
          },
        });
        await tx.okrGoalBrief.update({
          where: { id: brief.id },
          data: { status: 'COMMITTED' },
        });
        return {
          projectId,
          objectiveIds: [...objectiveIdByKey.values()],
          taskRows,
          linkRows,
          ownerIds: [
            ...new Set(
              taskRows.map((task) => task.ownerMemberUserId).filter(Boolean),
            ),
          ],
        };
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
    const objectiveItems = await this.okr.objectiveViewsByIds(
      ctx,
      snapshot.objectiveIds,
    );
    await this.notifications.notifyMany(
      snapshot.ownerIds.filter((owner) => owner !== ctx.actorId),
      {
        category: 'okr',
        title: `你有新的 OKR 承接任务：${brief.title}`,
        body: '任务已写入项目看板，请确认验收标准与截止时间。',
        link: '/project?tab=tasks',
        entityType: 'okr_task_commit',
        entityId: String(row.id),
      },
    );
    const taskTitles = new Map(
      snapshot.taskRows.map((task) => [task.id, task.title]),
    );
    return {
      decompositionId: row.id,
      projectId: snapshot.projectId,
      objectives: objectiveItems,
      tasks: snapshot.taskRows.map((task) => ({
        id: task.id,
        title: task.title,
        objectiveId: task.objectiveId,
        krId: task.krId,
        ownerMemberUserId: task.ownerMemberUserId,
        ownerName: memberNames.get(task.ownerMemberUserId) || '账号负责人',
      })),
      links: snapshot.linkRows.map((link) => ({
        id: link.id,
        objectiveId: link.objectiveId,
        krId: link.krId,
        taskId: link.taskId,
        taskTitle: taskTitles.get(link.taskId) || '',
        weight: num(link.weight),
        targetValue: num(link.targetValue),
        acceptance: Array.isArray(link.acceptance) ? link.acceptance : [],
        ownerMemberUserId: link.ownerMemberUserId,
        createdAt: iso(link.createdAt),
        updatedAt: iso(link.updatedAt),
      })),
    };
  }

  /** 每个承接任务的成员至少有一个可下钻的个人目标；已由方案给出 PERSONAL 目标的不重复创建。 */
  private async createPersonalObjectives(
    tx: Prisma.TransactionClient,
    ctx: OkrContext,
    brief: BriefRow,
    payload: DecompositionPayload,
    tasks: Array<{
      key: string;
      id: number;
      title: string;
      objectiveId: number;
      krId: number;
      ownerMemberUserId: string;
    }>,
    taskIdByKey: Map<string, number>,
  ) {
    const existingPersonal = new Set(
      payload.objectives
        .filter((node) => node.level === 'PERSONAL' && node.ownerMemberUserId)
        .map((node) => node.ownerMemberUserId),
    );
    const masterKrs = await tx.okrKeyResult.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        objectiveId: {
          in: [...new Set(tasks.map((task) => task.objectiveId))],
        },
      },
      select: {
        id: true,
        objectiveId: true,
        title: true,
        targetValue: true,
        startValue: true,
        unit: true,
        direction: true,
      },
    });
    const krRow = new Map(masterKrs.map((row) => [row.id, row]));
    const krTaskHours = new Map<number, number>();
    for (const task of payload.tasks) {
      const taskId = taskIdByKey.get(task.key);
      const row = tasks.find((item) => item.id === taskId);
      if (!row) continue;
      krTaskHours.set(
        row.krId,
        (krTaskHours.get(row.krId) || 0) + task.estimateHours,
      );
    }
    const byMember = new Map<string, Map<number, number>>();
    for (const task of tasks) {
      if (!task.ownerMemberUserId || task.ownerMemberUserId === ctx.ownerUserId)
        continue;
      const perKr =
        byMember.get(task.ownerMemberUserId) || new Map<number, number>();
      const definition = payload.tasks.find((item) => item.key === task.key);
      perKr.set(
        task.krId,
        (perKr.get(task.krId) || 0) + (definition?.estimateHours || 0),
      );
      byMember.set(task.ownerMemberUserId, perKr);
    }
    for (const [memberUserId, perKr] of byMember.entries()) {
      if (existingPersonal.has(memberUserId)) continue;
      const firstKr = krRow.get([...perKr.keys()][0]);
      if (!firstKr) continue;
      const name =
        (await this.scope.names([memberUserId])).get(memberUserId) ||
        memberUserId;
      const saved = await tx.okrObjective.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          briefId: brief.id,
          cycleId: brief.cycleId,
          parentId: firstKr.objectiveId,
          level: 'PERSONAL',
          title: `${name} · 承接 ${brief.title}`.slice(0, 200),
          description:
            '由 AI 拆解确认后按承接任务生成的个人目标，可下钻到任务与验收证据。',
          ownerMemberUserId: memberUserId,
          weight: 1,
          visibility: 'ORG',
          status: 'ACTIVE',
          source: 'AGENT',
        },
      });
      let created = 0;
      for (const [krId, hours] of perKr.entries()) {
        if (created >= 5) break;
        const master = krRow.get(krId);
        if (!master) continue;
        const total = krTaskHours.get(krId) || 0;
        const share = total > 0 ? hours / total : 1 / Math.max(perKr.size, 1);
        const start = num(master.startValue);
        const target = num(master.targetValue);
        const personalTarget =
          share >= 1 ? target : round(start + (target - start) * share, 2);
        await tx.okrKeyResult.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            orgType: ctx.orgType,
            orgUserId: ctx.ownerUserId,
            objectiveId: saved.id,
            title: master.title.slice(0, 200),
            metricType: 'MANUAL',
            targetValue: personalTarget,
            currentValue: start,
            startValue: start,
            unit: master.unit,
            direction: master.direction,
            weight: 1,
            ownerMemberUserId: memberUserId,
            metricSource: {},
          },
        });
        created += 1;
      }
    }
  }

  async taskLinkList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const objectiveId = int(query['objectiveId']);
    const krId = int(query['krId']);
    const taskId = int(query['taskId']);
    const rows = await this.prisma.okrTaskLink.findMany({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.ownerUserId,
        ...(objectiveId ? { objectiveId } : {}),
        ...(krId ? { krId } : {}),
        ...(taskId ? { taskId } : {}),
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    if (!rows.length) return [];
    const tasks = await this.prisma.pjTask.findMany({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.ownerUserId,
        id: { in: rows.map((row) => row.taskId) },
      },
      select: { id: true, title: true },
    });
    const titles = new Map(tasks.map((task) => [task.id, task.title]));
    return rows.map((row) => ({
      id: row.id,
      objectiveId: row.objectiveId,
      krId: row.krId,
      taskId: row.taskId,
      taskTitle: titles.get(row.taskId) || '',
      weight: num(row.weight),
      targetValue: num(row.targetValue),
      acceptance: Array.isArray(row.acceptance) ? row.acceptance : [],
      ownerMemberUserId: row.ownerMemberUserId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }));
  }

  async taskLinkSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const objectiveId = int(body['objectiveId']);
    const krId = int(body['krId']);
    const taskId = int(body['taskId']);
    const objective = await this.prisma.okrObjective.findFirst({
      where: { id: objectiveId, ownerUserId: ctx.ownerUserId },
    });
    if (!objective)
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    let kr = null;
    if (krId) {
      kr = await this.prisma.okrKeyResult.findFirst({
        where: { id: krId, ownerUserId: ctx.ownerUserId, objectiveId },
      });
      if (!kr)
        throw new BusinessException(ErrorCode.NOT_FOUND, 'KR 不属于该目标');
    }
    const task = await this.prisma.pjTask.findFirst({
      where: { id: taskId, orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
    });
    if (!task) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    const id = int(body['id']);
    const existing = id
      ? await this.prisma.okrTaskLink.findFirst({
          where: { id, orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务关联不存在');
    const duplicate = await this.prisma.okrTaskLink.findFirst({
      where: {
        krId,
        taskId,
        orgType: ctx.orgType,
        orgUserId: ctx.ownerUserId,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
    });
    if (duplicate) {
      throw new BusinessException(ErrorCode.CONFLICT, '该任务已关联此 KR');
    }
    const acceptance = Array.isArray(body['acceptance'])
      ? body['acceptance']
      : [];
    const data = {
      orgType: ctx.orgType,
      orgUserId: ctx.ownerUserId,
      objectiveId,
      krId,
      taskId,
      weight: Math.min(Math.max(num(body['weight'], 1), 0), 100),
      targetValue: num(body['targetValue'], num(kr?.targetValue)),
      acceptance: toJsonInput(acceptance),
      ownerMemberUserId: text(body['ownerMemberUserId']).trim().slice(0, 64),
    };
    const saved = existing
      ? await this.prisma.okrTaskLink.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.okrTaskLink.create({ data });
    if (saved.krId) {
      await this.taskLinkage.recomputeKr(ctx, saved.krId, String(saved.taskId));
    }
    return {
      id: saved.id,
      objectiveId: saved.objectiveId,
      krId: saved.krId,
      taskId: saved.taskId,
      taskTitle: task.title,
      weight: num(saved.weight),
      targetValue: num(saved.targetValue),
      acceptance: Array.isArray(saved.acceptance) ? saved.acceptance : [],
      ownerMemberUserId: saved.ownerMemberUserId,
      createdAt: iso(saved.createdAt),
      updatedAt: iso(saved.updatedAt),
    };
  }

  async taskLinkRemove(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const row = await this.prisma.okrTaskLink.findFirst({
      where: {
        id: this.idOf(id),
        orgType: ctx.orgType,
        orgUserId: ctx.ownerUserId,
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务关联不存在');
    await this.prisma.okrTaskLink.delete({ where: { id: row.id } });
    if (row.krId) {
      await this.taskLinkage.recomputeKr(ctx, row.krId);
    }
    return { id: row.id, removed: true };
  }

  async assessmentPreview(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const requestedMember = text(query['memberUserId']).trim();
    if (requestedMember && requestedMember !== ctx.actorId) {
      this.scope.assertManager(ctx);
    }
    const memberKey =
      requestedMember && requestedMember !== ctx.ownerUserId
        ? requestedMember
        : '';
    const cycleId = int(query['cycleId']) || 0;
    const cycle = cycleId
      ? await this.prisma.okrCycle.findFirst({
          where: { id: cycleId, orgUserId: ctx.ownerUserId },
          select: { id: true, title: true },
        })
      : await this.prisma.okrCycle.findFirst({
          where: { orgUserId: ctx.ownerUserId, status: 'ACTIVE' },
          orderBy: { id: 'desc' },
          select: { id: true, title: true },
        });
    const objectiveRows = await this.prisma.okrObjective.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(cycle ? { cycleId: cycle.id } : {}),
      },
      select: { id: true, title: true },
    });
    const objectiveIds = objectiveRows.map((row) => row.id);
    const links = objectiveIds.length
      ? await this.prisma.okrTaskLink.findMany({
          where: {
            orgType: ctx.orgType,
            orgUserId: ctx.ownerUserId,
            objectiveId: { in: objectiveIds },
            ownerMemberUserId: memberKey,
          },
          orderBy: { id: 'desc' },
          take: 200,
        })
      : [];
    const tasks = links.length
      ? await this.prisma.pjTask.findMany({
          where: {
            orgType: ctx.orgType,
            orgUserId: ctx.ownerUserId,
            id: { in: links.map((link) => link.taskId) },
          },
          select: {
            id: true,
            title: true,
            status: true,
            acceptanceCriteria: true,
            completedAt: true,
          },
        })
      : [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const krRows = links.length
      ? await this.prisma.okrKeyResult.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            id: {
              in: [...new Set(links.map((link) => link.krId))].filter(Boolean),
            },
          },
          select: {
            id: true,
            title: true,
            weight: true,
            direction: true,
            startValue: true,
            currentValue: true,
            targetValue: true,
          },
        })
      : [];
    const items = links.map((link) => {
      const task = taskById.get(link.taskId);
      const criteria = Array.isArray(task?.acceptanceCriteria)
        ? (task.acceptanceCriteria as Array<{
            label?: string;
            required?: boolean;
            evidence?: string;
          }>)
        : [];
      const required = criteria.filter((item) => item.required !== false);
      const done = task?.status === 'DONE' ? required.length : 0;
      const evidence = required
        .map((item) => text(item.evidence))
        .filter(Boolean);
      if (task?.completedAt) evidence.push(iso(task.completedAt));
      return {
        taskId: link.taskId,
        taskTitle: task?.title || '',
        objectiveId: link.objectiveId,
        krId: link.krId,
        weight: num(link.weight),
        status: task?.status || 'TODO',
        acceptanceTotal: required.length,
        acceptanceDone: done,
        evidence: [...new Set(evidence)],
      };
    });
    const taskScore = round(
      items.reduce(
        (sum, item) => sum + (TASK_DONE[item.status] ?? 0) * item.weight,
        0,
      ) / (items.reduce((sum, item) => sum + item.weight, 0) || 1),
      1,
    );
    const krScore = round(
      krRows.reduce(
        (sum, kr) =>
          sum +
          progressOf(
            kr.direction,
            num(kr.startValue),
            num(kr.currentValue),
            num(kr.targetValue),
          ) *
            num(kr.weight, 1),
        0,
      ) / (krRows.reduce((sum, kr) => sum + num(kr.weight, 1), 0) || 1),
      1,
    );
    const memberName = memberKey
      ? (await this.scope.names([memberKey])).get(memberKey) || memberKey
      : (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) ||
        '账号负责人';
    return {
      cycleId: cycle?.id || 0,
      memberUserId: memberKey,
      memberName,
      items,
      krScore,
      taskScore,
      okrScore: krRows.length
        ? round(krScore * 0.7 + taskScore * 0.3, 1)
        : taskScore,
      notes: [
        'KR 得分取 KR 当前进度；任务得分按任务状态折算（完成 100 / 待验收 80 / 进行中 50 / 未开始 0）。',
        '验收证据来自任务验收清单的证据要求与完成时间；逐项勾选将在任务详情中维护。',
        krRows.length
          ? ''
          : '本期还没有已关联任务的 KR，先到「AI 拆解」确认方案。',
      ].filter(Boolean),
    };
  }

  private briefIdOf(raw: string) {
    return this.idOf(raw, '目标书编号不合法');
  }

  private idOf(raw: string, message = '编号不合法') {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, message);
    }
    return Math.trunc(id);
  }
}
