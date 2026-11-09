import {
  OKR_BRIEF_STATUS_LABELS,
  OKR_METRIC_SOURCES,
} from '@enterprise/contracts';
import { toJsonInput } from '../common/json-input';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { aiJson } from '../ai/ai-gateway';
import {
  dateStr,
  int,
  iso,
  jsonArray,
  jsonObject,
  num,
  round,
} from './okr.helpers';
import { OkrContext, OkrMemberRow, OkrScopeService } from './okr.scope';

export type BriefRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  cycleId: number;
  title: string;
  businessGoal: string;
  scopeWhat: string;
  scopeTarget: string;
  deliverables: unknown;
  startDate: string;
  endDate: string;
  budgetAmount: unknown;
  budgetHours: unknown;
  currency: string;
  labor: unknown;
  materials: unknown;
  equipment: unknown;
  externalServices: unknown;
  constraints: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BriefReadiness = { blockers: string[]; warnings: string[] };

export type BriefDialogTurn = {
  id: number;
  role: string;
  content: string;
  structured: Record<string, unknown>;
  createdAt: Date;
};

type ClarityQuestion = {
  key: string;
  question: string;
  why: string;
  options: string[];
  defaultValue: string;
  required: boolean;
};

type ClarityRisk = { risk: string; impact: string; mitigation: string };

export type AskAiResult = {
  reply: string;
  questions: ClarityQuestion[];
  assumptions: string[];
  risks: ClarityRisk[];
  readyToDecompose: boolean;
};

const STATUSES = new Set([
  'DRAFT',
  'CLARIFYING',
  'READY',
  'COMMITTED',
  'CLOSED',
]);
const MESSAGE_TURN_LIMIT = 200;

const dayDiff = (from: string, to: string) => {
  if (!from || !to) return 0;
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
};

const numOr = (value: unknown) => round(num(value), 2);

/**
 * 目标书：总体业务目标 + 项目铁三角（范围/时间/成本）。
 * 前置检查只做「缺什么」提示：缺口不阻断分析，但阻断依赖该信息的确认落库。
 */
export function readinessOf(
  brief: BriefRow,
  memberCount: number,
): BriefReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!text(brief.businessGoal).trim()) blockers.push('请填写总体业务目标');
  if (!text(brief.scopeWhat).trim()) blockers.push('请填写范围：做什么');
  if (!text(brief.scopeTarget).trim())
    blockers.push('请填写范围：达到什么目标');
  if (!jsonArray(brief.deliverables).length)
    blockers.push('请至少登记一个交付物');
  if (!brief.cycleId) blockers.push('请选择目标周期');
  if (!text(brief.startDate) || !text(brief.endDate)) {
    blockers.push('请填写工期起止日期');
  } else if (brief.endDate < brief.startDate) {
    blockers.push('结束日期不能早于开始日期');
  }
  const days = dayDiff(text(brief.startDate), text(brief.endDate));
  if (days > 0 && days < 7) warnings.push('工期不足 7 天，拆解将按短周期收敛');
  if (!memberCount && !jsonArray(brief.labor).length) {
    warnings.push('组织成员与岗位尚未配置，负责人将默认由账号负责人承接');
  }
  const budget = num(brief.budgetAmount);
  if (budget <= 0 && !jsonArray(brief.labor).length) {
    warnings.push('未填预算与人力，成本只能按任务估时给区间');
  }
  const external = jsonArray(brief.externalServices).map(jsonObject);
  if (external.some((item) => !int(item['partyId']))) {
    warnings.push('存在未关联外部主体的外部服务，合作前需先登记主体');
  }
  return { blockers, warnings };
}

/** 自动推进状态：已确认落库/关闭的保持人工状态，其余按缺口推导。 */
export function nextStatus(
  current: string,
  readiness: BriefReadiness,
  requested?: string,
): string {
  if (current === 'CLOSED') return 'CLOSED';
  if (requested === 'CLOSED') return 'CLOSED';
  if (current === 'COMMITTED') return 'COMMITTED';
  if (readiness.blockers.length) {
    return current === 'CLARIFYING' || requested === 'CLARIFYING'
      ? 'CLARIFYING'
      : 'DRAFT';
  }
  return 'READY';
}

const jsonList = (value: unknown) => jsonArray(value).map(jsonObject);

export class OkrBriefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OkrScopeService,
  ) {}

  private async cycleOf(ctx: OkrContext, cycleId: number) {
    if (!cycleId) return null;
    return this.prisma.okrCycle.findFirst({
      where: { id: cycleId, orgUserId: ctx.ownerUserId },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
  }

  async row(ctx: OkrContext, id: number): Promise<BriefRow> {
    const row = await this.prisma.okrGoalBrief.findFirst({
      where: { id, orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '目标书不存在');
    return row;
  }

  private canManage(ctx: OkrContext, row: BriefRow) {
    return ctx.isOwner || ctx.isManager || row.createdBy === ctx.actorId;
  }

  private async memberCount(ctx: OkrContext) {
    return (await this.scope.members(ctx.ownerUserId)).length;
  }

  async readiness(ctx: OkrContext, row: BriefRow): Promise<BriefReadiness> {
    return readinessOf(row, await this.memberCount(ctx));
  }

  private view(row: BriefRow, readiness: BriefReadiness) {
    return {
      id: row.id,
      cycleId: row.cycleId,
      title: row.title,
      businessGoal: row.businessGoal,
      scopeWhat: row.scopeWhat,
      scopeTarget: row.scopeTarget,
      deliverables: jsonList(row.deliverables),
      startDate: row.startDate,
      endDate: row.endDate,
      budgetAmount: numOr(row.budgetAmount),
      budgetHours: numOr(row.budgetHours),
      currency: row.currency,
      labor: jsonList(row.labor),
      materials: jsonList(row.materials),
      equipment: jsonList(row.equipment),
      externalServices: jsonList(row.externalServices),
      constraints: row.constraints,
      status: row.status,
      statusLabel: OKR_BRIEF_STATUS_LABELS[row.status] || row.status,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      readiness,
    };
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const cycleId = int(query['cycleId']);
    const status = text(query['status']).trim().toUpperCase();
    const [rows, members] = await Promise.all([
      this.prisma.okrGoalBrief.findMany({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          ...(cycleId ? { cycleId } : {}),
          ...(STATUSES.has(status) ? { status } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      this.scope.members(ctx.ownerUserId),
    ]);
    return rows.map((row) => this.view(row, readinessOf(row, members.length)));
  }

  async get(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const row = await this.row(ctx, this.idOf(id));
    return this.view(row, await this.readiness(ctx, row));
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const id = int(body['id']);
    const existing = id ? await this.row(ctx, id) : null;
    if (existing && !this.canManage(ctx, existing)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己创建的目标书',
      );
    }
    const cycle = await this.cycleOf(ctx, int(body['cycleId']));
    if (int(body['cycleId']) && !cycle) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '目标周期不存在');
    }
    const title = text(body['title']).trim().slice(0, 200);
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写目标书标题');
    const members = await this.scope.members(ctx.ownerUserId);
    const memberIds = new Set([
      ctx.ownerUserId,
      ...members.map((row) => row.memberUserId),
    ]);
    const labor = jsonList(body['labor'])
      .map((item) => {
        const memberUserId = text(item['memberUserId']).trim();
        if (memberUserId && !memberIds.has(memberUserId)) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '人力中的成员不在本账号的职员名册里',
          );
        }
        return {
          role: text(item['role']).trim().slice(0, 64),
          headcount: Math.max(num(item['headcount'], 1), 0),
          hours: Math.max(num(item['hours']), 0),
          memberUserId,
        };
      })
      .slice(0, 50);
    const externalServices = jsonList(body['externalServices']).slice(0, 50);
    const partyIds = externalServices
      .map((item) => int(item['partyId']))
      .filter(Boolean);
    if (partyIds.length) {
      const found = await this.prisma.bizParty.count({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          id: { in: [...new Set(partyIds)] },
        },
      });
      if (found !== new Set(partyIds).size) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '外部服务关联的主体不存在，请先到外部资源池登记',
        );
      }
    }
    const deliverables = jsonList(body['deliverables'])
      .map((item) => ({
        name: text(item['name']).trim().slice(0, 120),
        description: text(item['description']).trim().slice(0, 500),
        acceptance: text(item['acceptance']).trim().slice(0, 500),
      }))
      .filter((item) => item.name)
      .slice(0, 50);
    const materials = jsonList(body['materials'])
      .map((item) => ({
        name: text(item['name']).trim().slice(0, 120),
        qty: Math.max(num(item['qty'], 1), 0),
        unitCost: Math.max(num(item['unitCost']), 0),
      }))
      .filter((item) => item.name)
      .slice(0, 50);
    const equipment = jsonList(body['equipment'])
      .map((item) => ({
        name: text(item['name']).trim().slice(0, 120),
        qty: Math.max(num(item['qty'], 1), 0),
        unitCost: Math.max(num(item['unitCost']), 0),
        days: Math.max(num(item['days']), 0),
      }))
      .filter((item) => item.name)
      .slice(0, 50);
    const data = {
      cycleId: int(body['cycleId']),
      title,
      businessGoal: text(body['businessGoal']).trim().slice(0, 5000),
      scopeWhat: text(body['scopeWhat']).trim().slice(0, 3000),
      scopeTarget: text(body['scopeTarget']).trim().slice(0, 3000),
      deliverables: toJsonInput(deliverables),
      startDate: text(body['startDate']).slice(0, 16),
      endDate: text(body['endDate']).slice(0, 16),
      budgetAmount: Math.max(num(body['budgetAmount']), 0),
      budgetHours: Math.max(num(body['budgetHours']), 0),
      currency: text(body['currency']).trim().slice(0, 8) || 'CNY',
      labor: toJsonInput(labor),
      materials: toJsonInput(materials),
      equipment: toJsonInput(equipment),
      externalServices: toJsonInput(externalServices),
      constraints: text(body['constraints']).trim().slice(0, 3000),
    };
    const draft: BriefRow = {
      ...(existing ||
        ({
          id: 0,
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          status: 'DRAFT',
          createdBy: ctx.actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as BriefRow)),
      ...data,
    };
    const readiness = readinessOf(draft, members.length);
    const requested = text(body['status']).trim().toUpperCase();
    const status = nextStatus(
      existing?.status || 'DRAFT',
      readiness,
      requested,
    );
    const saved = existing
      ? await this.prisma.okrGoalBrief.update({
          where: { id: existing.id },
          data: { ...data, status },
        })
      : await this.prisma.okrGoalBrief.create({
          data: {
            ...data,
            orgType: ctx.orgType,
            orgUserId: ctx.ownerUserId,
            status,
            createdBy: ctx.actorId,
          },
        });
    return this.view(saved, readiness);
  }

  async remove(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const row = await this.row(ctx, this.idOf(id));
    if (!this.canManage(ctx, row)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己创建的目标书',
      );
    }
    const committed = await this.prisma.okrDecomposition.count({
      where: { briefId: row.id, status: 'CONFIRMED' },
    });
    if (committed) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标书已落库，不能删除；如需结束请把状态改为「已关闭」',
      );
    }
    await this.prisma.$transaction([
      this.prisma.okrDialogTurn.deleteMany({ where: { briefId: row.id } }),
      this.prisma.okrDecomposition.deleteMany({ where: { briefId: row.id } }),
      this.prisma.okrGoalBrief.delete({ where: { id: row.id } }),
    ]);
    return { id: row.id, removed: true };
  }

  async dialogList(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const row = await this.row(ctx, this.idOf(id));
    const turns = await this.prisma.okrDialogTurn.findMany({
      where: { briefId: row.id },
      orderBy: { id: 'asc' },
      take: MESSAGE_TURN_LIMIT,
    });
    return turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      structured: jsonObject(turn.structured),
      createdAt: iso(turn.createdAt),
    }));
  }

  private ruleQuestions(
    brief: BriefRow,
    readiness: BriefReadiness,
    members: OkrMemberRow[],
  ) {
    const questions: Array<{
      key: string;
      question: string;
      why: string;
      options: string[];
      defaultValue: string;
      required: boolean;
    }> = [];
    const push = (
      key: string,
      question: string,
      why: string,
      options: string[] = [],
      required = false,
    ) =>
      questions.push({
        key,
        question,
        why,
        options,
        defaultValue: '',
        required,
      });
    if (!text(brief.businessGoal).trim()) {
      push(
        'businessGoal',
        '本期最想拿到的一个业务结果是什么？',
        '总体目标是整棵目标树的根，缺了它只能拆任务、拆不出目标',
        [],
        true,
      );
    }
    if (!text(brief.scopeTarget).trim()) {
      push(
        'scopeTarget',
        '这个结果用什么数字衡量？当前是多少、想到多少？',
        'KR 必须有可量化目标与基线，否则无法判断达成',
        ['营收/合同额', '客户数/线索数', '交付数量', '效率/成本'],
        true,
      );
    }
    if (!jsonArray(brief.deliverables).length) {
      push(
        'deliverables',
        '最终要交付哪些东西？每个交付物由谁验收、按什么标准？',
        '交付物直接决定任务与验收清单',
        [],
        true,
      );
    }
    if (!text(brief.startDate) || !text(brief.endDate)) {
      push(
        'timeline',
        '什么时候必须完成？中间有哪些硬节点？',
        '工期决定任务排期与关键路径',
        ['本月内', '本季度内', '半年内'],
        true,
      );
    }
    if (num(brief.budgetAmount) <= 0 && !jsonArray(brief.labor).length) {
      push(
        'budget',
        '预算与人力大概是什么量级？有没有外部供应商/个人参与？',
        '没有预算和人力，成本与容量只能给区间',
        [],
        false,
      );
    }
    if (!members.length) {
      push(
        'organization',
        '这件事由谁承接？需要哪些岗位或外部合作方？',
        '负责人必须在组织名册里，否则拆解结果无法落库',
        [],
        true,
      );
    }
    if (readiness.warnings.length && questions.length < 5) {
      push(
        'constraints',
        '还有哪些不能动的约束（合规、档期、既有承诺）？',
        '约束会影响方案取舍',
        [],
        false,
      );
    }
    return questions.slice(0, 5);
  }

  private async orgSnapshot(ctx: OkrContext, members: OkrMemberRow[]) {
    const [parties, projects, pipeline] = await Promise.all([
      this.prisma.bizParty.findMany({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          status: 'ACTIVE',
        },
        select: { name: true, kind: true, capabilities: true, rateCard: true },
        take: 30,
      }),
      this.prisma.pjProject.findMany({
        where: {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          status: { in: ['PLANNING', 'ACTIVE', 'ACCEPTING'] },
        },
        select: { name: true, status: true, endDate: true, budgetAmount: true },
        take: 10,
      }),
      this.prisma.crmOpportunity
        .groupBy({
          by: ['stageId'],
          where: { orgType: ctx.orgType, orgUserId: ctx.ownerUserId },
          _count: { _all: true },
          _sum: { amount: true },
        })
        .catch(() => []),
    ]);
    return {
      members: members.map((item) => ({
        id: item.memberUserId,
        name: item.name,
        department: item.department,
        positions: item.positions.map((position) => position.name),
        capabilities: item.capabilities.slice(0, 200),
      })),
      parties: parties.map((item) => ({
        name: item.name,
        kind: item.kind,
        capabilities: jsonArray(item.capabilities).slice(0, 8),
        rateCard: jsonObject(item.rateCard),
      })),
      projects: projects.map((item) => ({
        name: item.name,
        status: item.status,
        endDate: item.endDate,
        budgetAmount: num(item.budgetAmount),
      })),
      pipeline: pipeline.map((item) => ({
        stageId: item.stageId,
        count: item._count?._all ?? 0,
        amount: num(item._sum?.amount),
      })),
    };
  }

  private async askAi(
    ctx: OkrContext,
    brief: BriefRow,
    members: OkrMemberRow[],
    message: string,
    answers: Record<string, string>,
    turns: BriefDialogTurn[],
  ): Promise<AskAiResult | null> {
    const snapshot = await this.orgSnapshot(ctx, members);
    const system = [
      '你是企业增长与项目管理顾问，负责把总体业务目标拆成可落地的 OKR。',
      '只输出 JSON，不要输出解释性文字。JSON 结构：',
      '{"reply":"给用户看的一句话结论","questions":[{"key":"","question":"","why":"","options":[],"defaultValue":"","required":false}],"assumptions":[],"risks":[{"risk":"","impact":"","mitigation":""}],"readyToDecompose":false}',
      '要求：每轮最多 5 个问题；问题要短、可回答；没有把握的数值不要编，写进 assumptions。',
      `负责人只能来自组织名单：${
        snapshot.members
          .map(
            (row) =>
              `${row.name}(${row.id})${row.positions.length ? `/${row.positions.join('、')}` : ''}`,
          )
          .join('；') || '（名单为空）'
      }`,
      `可用自动指标源：${OKR_METRIC_SOURCES.join(', ')}。`,
    ].join('\n');
    const briefText = {
      title: brief.title,
      businessGoal: brief.businessGoal,
      scopeWhat: brief.scopeWhat,
      scopeTarget: brief.scopeTarget,
      deliverables: jsonList(brief.deliverables),
      startDate: brief.startDate,
      endDate: brief.endDate,
      budgetAmount: num(brief.budgetAmount),
      budgetHours: num(brief.budgetHours),
      labor: jsonList(brief.labor),
      externalServices: jsonList(brief.externalServices),
      constraints: brief.constraints,
      readiness: await this.readiness(ctx, brief),
      org: snapshot,
    };
    const history = turns.slice(-6).map((turn) => ({
      role:
        turn.role === 'ASSISTANT' ? ('assistant' as const) : ('user' as const),
      content: turn.content.slice(0, 800),
    }));
    const result = await aiJson(this.prisma, {
      userId: ctx.actorId,
      module: 'okr',
      operation: 'brief_dialog',
      messages: [
        { role: 'system', content: system },
        ...history,
        {
          role: 'user',
          content: `目标书：${JSON.stringify(briefText)}\n用户本轮补充：${message || '（无文字，仅回答问题）'}\n结构化回答：${JSON.stringify(answers)}`,
        },
      ],
      validate: (raw) => {
        const questions = jsonArray(raw['questions']).map(jsonObject);
        return {
          reply: text(raw['reply']).slice(0, 2000),
          questions: questions
            .map((item) => ({
              key: text(item['key']).trim().slice(0, 32) || 'question',
              question: text(item['question']).trim().slice(0, 300),
              why: text(item['why']).trim().slice(0, 300),
              options: jsonArray(item['options'])
                .map((option) => text(option).slice(0, 40))
                .slice(0, 6),
              defaultValue: text(item['defaultValue']).slice(0, 100),
              required: Boolean(item['required']),
            }))
            .filter((item) => item.question)
            .slice(0, 5),
          assumptions: jsonArray(raw['assumptions'])
            .map((item) => text(item).slice(0, 300))
            .filter(Boolean)
            .slice(0, 8),
          risks: jsonArray(raw['risks'])
            .map((item) => {
              const row = jsonObject(item);
              return {
                risk: text(row['risk']).slice(0, 200),
                impact: text(row['impact']).slice(0, 200),
                mitigation: text(row['mitigation']).slice(0, 200),
              };
            })
            .filter((item) => item.risk)
            .slice(0, 6),
          readyToDecompose: Boolean(raw['readyToDecompose']),
        };
      },
    });
    return result?.data || null;
  }

  async dialogSend(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const brief = await this.row(ctx, this.idOf(id));
    if (!this.canManage(ctx, brief)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能推进自己创建的目标书',
      );
    }
    if (brief.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标书已关闭，不能继续对话',
      );
    }
    const message = text(body['message']).trim().slice(0, 3000);
    const answers = jsonObject(body['answers']);
    const members = await this.scope.members(ctx.ownerUserId);
    const readiness = readinessOf(brief, members.length);
    if (message || Object.keys(answers).length) {
      const lines = Object.entries(answers)
        .map(([key, value]) => `${key}：${text(value).slice(0, 500)}`)
        .filter((line) => !line.endsWith('：'));
      await this.prisma.okrDialogTurn.create({
        data: {
          briefId: brief.id,
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          role: 'USER',
          content: [message, ...lines]
            .filter(Boolean)
            .join('\n')
            .slice(0, 4000),
          structured: toJsonInput(answers),
        },
      });
    }
    const turns = await this.prisma.okrDialogTurn.findMany({
      where: { briefId: brief.id },
      orderBy: { id: 'asc' },
      take: MESSAGE_TURN_LIMIT,
    });
    const ai = await this.askAi(
      ctx,
      brief,
      members,
      message,
      answers as Record<string, string>,
      turns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        content: turn.content,
        structured: jsonObject(turn.structured),
        createdAt: turn.createdAt,
      })),
    );
    const mode = ai ? 'LLM' : 'RULE';
    const questions =
      ai?.questions || this.ruleQuestions(brief, readiness, members);
    const assumptions =
      ai?.assumptions ||
      [
        readiness.warnings[0] || '',
        '规则模式：拆解只依据目标书已填写内容，未读取外部数据',
      ].filter(Boolean);
    const risks = ai?.risks || this.ruleRisks(brief, readiness);
    const readyToDecompose =
      readiness.blockers.length === 0 && (ai?.readyToDecompose ?? true);
    const content =
      ai?.reply ||
      (questions.length
        ? `还差 ${questions.length} 个关键信息才能拆得更准，先回答下面几个问题。`
        : '目标书信息已齐全，可以生成拆解方案了。');
    const structured = {
      questions,
      assumptions,
      risks,
      readyToDecompose,
      mode,
    };
    await this.prisma.okrDialogTurn.create({
      data: {
        briefId: brief.id,
        orgType: ctx.orgType,
        orgUserId: ctx.ownerUserId,
        role: 'ASSISTANT',
        content,
        structured: structured,
      },
    });
    const status = nextStatus(brief.status, readiness, 'CLARIFYING');
    if (status !== brief.status) {
      await this.prisma.okrGoalBrief.update({
        where: { id: brief.id },
        data: { status },
      });
    }
    const after = await this.prisma.okrDialogTurn.findMany({
      where: { briefId: brief.id },
      orderBy: { id: 'asc' },
      take: MESSAGE_TURN_LIMIT,
    });
    return {
      turns: after.map((turn) => ({
        id: turn.id,
        role: turn.role,
        content: turn.content,
        structured: jsonObject(turn.structured),
        createdAt: iso(turn.createdAt),
      })),
      questions,
      assumptions,
      risks,
      readyToDecompose,
      mode,
    };
  }

  private ruleRisks(brief: BriefRow, readiness: BriefReadiness) {
    const risks: Array<{ risk: string; impact: string; mitigation: string }> =
      [];
    if (dayDiff(brief.startDate, brief.endDate) > 0) {
      const days = dayDiff(brief.startDate, brief.endDate);
      if (days < 30) {
        risks.push({
          risk: '工期偏短',
          impact: '交付与验收集中在短时间内，容易出现质量折损',
          mitigation: '先锁关键交付物，非关键项分期交付',
        });
      }
    }
    if (num(brief.budgetAmount) <= 0) {
      risks.push({
        risk: '预算未定',
        impact: '成本不可控，外部合作无法定价',
        mitigation: '补预算或先用人力工时估算上限',
      });
    }
    if (readiness.warnings.some((item) => item.includes('外部主体'))) {
      risks.push({
        risk: '外部合作方未锁定',
        impact: '采购与交付周期不可控',
        mitigation: '先完成主体准入与报价，再排关键路径',
      });
    }
    return risks.slice(0, 5);
  }

  private idOf(raw: string) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '目标书编号不合法');
    }
    return Math.trunc(id);
  }

  /** 供拆解服务复用：目标书日期落到具体日期字符串。 */
  static windowOf(brief: BriefRow) {
    return {
      startDate: text(brief.startDate) || dateStr(new Date()),
      endDate: text(brief.endDate) || text(brief.startDate),
    };
  }
}
