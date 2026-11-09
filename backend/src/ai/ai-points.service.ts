import { DISTRIBUTION_PLATFORMS } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CrmScopeService } from '../crm/crm.scope';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { OaScopeService } from '../oa/oa.scope';
import type { OkrScopeService } from '../okr/okr.scope';
import type { PrismaService } from '../prisma/prisma.service';
import { aggregateResults, parseQuestions } from '../survey/survey.helpers';
import {
  AiAbilitiesService,
  aiLevelOf,
  cleanAiText,
  percent,
  type AiLevel,
} from './ai-abilities.service';

type Row = Record<string, unknown>;

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

const strList = (value: unknown, limit = 20): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => cleanAiText(item, 500).trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

const daysBetween = (from: Date, to = Date.now()) =>
  Math.floor((to - from.getTime()) / (24 * 3600 * 1000));

const stripTags = (value: unknown): string =>
  cleanAiText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const dateOnly = (value?: string | null) => (value ? value.slice(0, 10) : '');

const amountOf = (value: string) => {
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** 模型给的数值可能是 number 也可能带单位的字符串，统一收成有限数字，收不到返回 null。 */
const toNumber = (value: unknown): number | null => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[^\d.-]/g, ''))
        : NaN;
  return Number.isFinite(raw) ? raw : null;
};

type OaFieldInfo = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: { value: string; label: string }[];
};

type OaTemplateInfo = {
  id: number;
  name: string;
  description: string;
  fields: OaFieldInfo[];
};

const OA_MANUAL_TYPES = new Set(['user', 'attachment', 'ref', 'list']);

const oaFieldsOf = (value: unknown): OaFieldInfo[] =>
  (Array.isArray(value) ? value : [])
    .map((item): OaFieldInfo | null => {
      const row = asRecord(item);
      const key = cleanAiText(row.key, 40).trim();
      if (!key) return null;
      const options = (Array.isArray(row.options) ? row.options : [])
        .map((option) => {
          const opt = asRecord(option);
          return {
            value: cleanAiText(opt.value, 60).trim(),
            label: cleanAiText(opt.label, 60).trim(),
          };
        })
        .filter((option) => option.value);
      return {
        key,
        label: cleanAiText(row.label, 60).trim() || key,
        type: cleanAiText(row.type, 20).trim(),
        required: row.required === true,
        options,
      };
    })
    .filter((item): item is OaFieldInfo => item !== null);

/** 下拉/单选的取值只认配置里的 code（也接受 label）；无选项的文本类字段原样保留。 */
const oaOptionValue = (field: OaFieldInfo, value: string) => {
  const hit = field.options.find(
    (option) => option.value === value || option.label === value,
  );
  return hit ? hit.value : '';
};

/** 把模型给的字段值按字段类型收成合法的 formData，手工填不了的类型（成员/附件/明细）跳过。 */
const oaCoerceForm = (fields: OaFieldInfo[], raw: Row): Row => {
  const data: Row = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (value === undefined || value === null || value === '') continue;
    switch (field.type) {
      case 'number':
      case 'amount': {
        const num = toNumber(value);
        if (num !== null) data[field.key] = num;
        break;
      }
      case 'checkbox':
        data[field.key] =
          value === true || value === 'true' || value === 1 || value === '是';
        break;
      case 'multiSelect': {
        const list = (Array.isArray(value) ? value : [value])
          .map((item) => oaOptionValue(field, cleanAiText(item, 60).trim()))
          .filter(Boolean);
        if (list.length) data[field.key] = unique(list);
        break;
      }
      case 'select':
      case 'radio': {
        const text = cleanAiText(value, 60).trim();
        const normalized = field.options.length
          ? oaOptionValue(field, text)
          : text;
        if (normalized) data[field.key] = normalized;
        break;
      }
      case 'date':
      case 'datetime': {
        const text = cleanAiText(value, 40).trim();
        if (text) data[field.key] = dateOnly(text);
        break;
      }
      default:
        if (OA_MANUAL_TYPES.has(field.type)) break;
        data[field.key] = cleanAiText(value, 2000).trim();
    }
  }
  return data;
};

/** 草稿预览用的必填缺项提示（不评估字段的显隐条件，最终以提交校验为准）。 */
const oaMissingOf = (fields: OaFieldInfo[], formData: Row): string[] =>
  fields
    .filter((field) => {
      if (!field.required) return false;
      const value = formData[field.key];
      return value === undefined || value === null || value === '';
    })
    .map((field) => field.label);

/** 无模型兜底：按模板名与字段标签同描述的字符重合度挑最像的模板（中文无空格也能命中）。 */
const oaBestTemplate = (templates: OaTemplateInfo[], text: string) => {
  const chars = new Set([...text].filter((ch) => /[\p{L}\p{N}]/u.test(ch)));
  const overlap = (value: string) =>
    [...new Set([...value])].filter((ch) => chars.has(ch)).length;
  let best = templates[0];
  let bestScore = -1;
  for (const item of templates) {
    const score =
      overlap(item.name) * 2 +
      item.fields.reduce((sum, field) => sum + overlap(field.label), 0);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
};

/**
 * 各模块点状 AI（方案 §10 P2-B）：所有方法先按业务 scope 取数，
 * 再交给通用能力（摘要/抽取/分类/评分/RAG）；模型不可用时返回规则式结论，
 * 只做展示与建议，不自动写业务数据。
 */
export class AiPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilities: AiAbilitiesService,
    private readonly crmScope: CrmScopeService,
    private readonly okrScope: OkrScopeService,
    private readonly hrmScope: HrmScopeService,
    private readonly oaScope: OaScopeService,
  ) {}

  async crmLeadScore(user: CurrentUser, body: Row) {
    const ctx = await this.crmScope.requireMember(user);
    const id = Number(body.leadId);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId, deletedAt: null },
    });
    if (!lead) throw new BusinessException(ErrorCode.NOT_FOUND, '线索不存在');
    const [follows, plans] = await Promise.all([
      this.prisma.crmFollowRecord.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'LEAD',
          targetId: id,
        },
        orderBy: { id: 'desc' },
        take: 10,
      }),
      this.prisma.crmFollowPlan.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'LEAD',
          targetId: id,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
        },
      }),
    ]);
    const idleDays = lead.lastFollowAt ? daysBetween(lead.lastFollowAt) : -1;
    const text = [
      `线索：${lead.name}`,
      `联系人：${lead.contactName || '未填'}；电话：${lead.phone || '未填'}；邮箱：${lead.email || '未填'}；来源：${lead.source || '未填'}`,
      `阶段：${lead.stage}；负责人：${lead.ownerId || '未指派'}；备注：${stripTags(lead.remark) || '无'}`,
      `跟进记录 ${follows.length} 条；未完成跟进计划 ${plans} 条；距上次跟进：${idleDays < 0 ? '从未跟进' : `${idleDays} 天`}`,
      follows
        .slice(0, 5)
        .map(
          (row) =>
            `- ${dateOnly(row.createdAt.toISOString())} ${stripTags(row.content).slice(0, 200)}`,
        )
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n');
    const score = await this.abilities.score(user, {
      text,
      dimensions: [
        { key: 'profile', label: '基础信息完整度' },
        { key: 'stage', label: '意向阶段' },
        { key: 'engagement', label: '互动热度' },
        { key: 'plan', label: '跟进计划' },
      ],
      guide:
        '基础信息越完整、阶段越靠后、近期有跟进且有明确下一步的线索，评分越高。',
    });
    const missing = [
      !lead.contactName ? '联系人' : '',
      !lead.phone ? '电话' : '',
      !lead.email ? '邮箱' : '',
      !lead.source ? '来源' : '',
    ].filter(Boolean);
    const nextStep =
      lead.stage === 'SUCCESS'
        ? '线索已成交，转入客户维护与二次销售。'
        : lead.stage === 'FAIL'
          ? '线索已失败，记录失败原因后归档。'
          : idleDays < 0
            ? '还没有跟进记录，先做首次触达并登记跟进结果。'
            : idleDays >= 7
              ? `已 ${idleDays} 天没有跟进，今天安排一次电话或微信触达。`
              : plans
                ? '按已有跟进计划推进，完成后及时更新阶段。'
                : '补一条下一次跟进计划，明确时间与动作。';
    return {
      score: score.total,
      level: score.level,
      reasons: [
        ...score.dimensions.map((row) => `${row.label}：${row.reason}`),
        missing.length ? `还缺：${missing.join('、')}` : '关键联系信息完整。',
      ].slice(0, 6),
      advice: score.advice,
      nextStep,
      mode: score.mode,
      model: score.model,
    };
  }

  private async krContext(user: CurrentUser, krId: number) {
    const ctx = await this.okrScope.context(user);
    if (!ctx.isMember) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你还不是本账号的 OKR 成员',
      );
    }
    const kr = await this.prisma.okrKeyResult.findFirst({
      where: { id: krId, ownerUserId: ctx.ownerUserId },
    });
    if (!kr) throw new BusinessException(ErrorCode.NOT_FOUND, '关键结果不存在');
    const [objective, logs] = await Promise.all([
      this.prisma.okrObjective.findFirst({
        where: { id: kr.objectiveId, ownerUserId: ctx.ownerUserId },
      }),
      this.prisma.okrProgressLog.findMany({
        where: { ownerUserId: ctx.ownerUserId, krId: kr.id },
        orderBy: { id: 'desc' },
        take: 5,
      }),
    ]);
    return { ctx, kr, objective, logs };
  }

  async okrCheckKr(user: CurrentUser, body: Row) {
    const { kr, objective, logs } = await this.krContext(
      user,
      Number(body.krId),
    );
    const label = kr.unit
      ? `${Number(kr.targetValue)}${kr.unit}`
      : String(Number(kr.targetValue));
    const text = [
      `目标：${objective?.title || '未关联目标'}`,
      `关键结果：${kr.title}`,
      `目标值：${label}；当前值：${Number(kr.currentValue)}；方向：${kr.direction === 'DOWN' ? '越小越好' : '越大越好'}`,
      `负责人：${kr.ownerMemberUserId || '未指派'}；指标类型：${kr.metricType}`,
      `进度记录：${logs.length ? logs.map((row) => `${dateOnly(row.createdAt.toISOString())} ${stripTags(row.note)}`).join('；') : '无'}`,
    ].join('\n');
    const ruleIssues: string[] = [];
    if ([...kr.title].length < 8)
      ruleIssues.push('标题过短，读不出要达成的结果');
    if (!/\d/.test(kr.title) && !kr.unit)
      ruleIssues.push('没有可量化的数字或单位');
    if (!kr.ownerMemberUserId) ruleIssues.push('没有指定负责人');
    if (!logs.length) ruleIssues.push('没有任何进度记录，无法判断是否在推进');
    if (kr.metricType === 'MANUAL')
      ruleIssues.push('指标靠手工更新，建议接入自动数据源或明确更新频率');
    const ruleScore = Math.max(
      20,
      Math.min(
        95,
        92 - ruleIssues.length * 12 + (kr.metricType === 'AUTO' ? 6 : 0),
      ),
    );
    const llm = await this.abilities.askJson(
      user,
      '你是 OKR 教练。只输出 JSON：{"score":0-100,"issues":[""],"suggestions":[""],"improvedTitle":""}。评分只看这个关键结果是否清晰、可量化、有负责人、有进展证据；不要编造事实。',
      `资料：\n<<<\n${text}\n>>>`,
      800,
    );
    if (llm) {
      const issues = strList(llm.data.issues, 8);
      const suggestions = strList(llm.data.suggestions, 8);
      const improved = cleanAiText(llm.data.improvedTitle, 200).trim();
      if (issues.length || suggestions.length || improved) {
        const score = percent(llm.data.score, ruleScore);
        return {
          score,
          level: aiLevelOf(score),
          issues,
          suggestions,
          improvedTitle: improved || kr.title,
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    return {
      score: ruleScore,
      level: aiLevelOf(ruleScore),
      issues: ruleIssues,
      suggestions: ruleIssues.length
        ? [
            '把标题改写成「动词 + 指标 + 目标值 + 时间」的结果句',
            '补一位负责人，并约定每周更新一次进度',
            '如果指标可自动取数，改成自动指标并接上数据源',
          ]
        : ['保持当前写法，按节奏更新进度即可'],
      improvedTitle: `${kr.title}${kr.unit ? `（目标 ${label}）` : ''}`,
      mode: 'rule' as const,
      model: '',
    };
  }

  async okrProgressSummary(user: CurrentUser, body: Row) {
    const ctx = await this.okrScope.context(user);
    if (!ctx.isMember) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你还不是本账号的 OKR 成员',
      );
    }
    const requested = Number(body.cycleId) || 0;
    const cycle = requested
      ? await this.prisma.okrCycle.findFirst({
          where: { id: requested, ownerUserId: ctx.ownerUserId },
        })
      : (await this.prisma.okrCycle.findFirst({
          where: { ownerUserId: ctx.ownerUserId, status: 'ACTIVE' },
          orderBy: { startDate: 'desc' },
        })) ||
        (await this.prisma.okrCycle.findFirst({
          where: { ownerUserId: ctx.ownerUserId },
          orderBy: { startDate: 'desc' },
        }));
    if (!cycle)
      throw new BusinessException(ErrorCode.NOT_FOUND, '还没有 OKR 周期');
    const [objectives, krs, logs] = await Promise.all([
      this.prisma.okrObjective.findMany({
        where: { ownerUserId: ctx.ownerUserId, cycleId: cycle.id },
        orderBy: { id: 'asc' },
      }),
      this.prisma.okrKeyResult.findMany({
        where: { ownerUserId: ctx.ownerUserId },
      }),
      this.prisma.okrProgressLog.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          createdAt: { gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) },
        },
        orderBy: { id: 'desc' },
        take: 20,
      }),
    ]);
    const objectiveIds = new Set(objectives.map((row) => row.id));
    const cycleKrs = krs.filter((row) => objectiveIds.has(row.objectiveId));
    const avg = cycleKrs.length
      ? Math.round(
          (cycleKrs.reduce(
            (sum, row) =>
              sum + Number(row.currentValue) / (Number(row.targetValue) || 1),
            0,
          ) /
            cycleKrs.length) *
            100,
        )
      : 0;
    const expected = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          ((Date.now() - cycle.startDate.getTime()) /
            Math.max(1, cycle.endDate.getTime() - cycle.startDate.getTime())) *
            100,
        ),
      ),
    );
    const highlights = objectives
      .filter((row) => Number(row.progress) >= 70)
      .map(
        (row) => `${row.title}（进度 ${Math.round(Number(row.progress))}%）`,
      );
    const stale = cycleKrs.filter(
      (row) =>
        !logs.some((log) => log.krId === row.id) &&
        Number(row.currentValue) === 0,
    );
    const risks = [
      cycle.endDate.getTime() < Date.now() && cycle.status !== 'CLOSED'
        ? '周期已到结束日期但还没有关闭'
        : '',
      avg < expected - 10 ? `整体进度 ${avg}% 低于时间进度 ${expected}%` : '',
      stale.length ? `${stale.length} 个关键结果最近 14 天没有更新` : '',
    ].filter(Boolean);
    const text = [
      `周期：${cycle.title || `${cycle.year} ${cycle.kind} ${cycle.period}`}`,
      `起止：${dateOnly(cycle.startDate.toISOString())} ~ ${dateOnly(cycle.endDate.toISOString())}；状态：${cycle.status}`,
      `目标 ${objectives.length} 个，关键结果 ${cycleKrs.length} 个，平均进度 ${avg}%，时间进度约 ${expected}%`,
      objectives
        .map(
          (row) =>
            `- ${row.title}（进度 ${Math.round(Number(row.progress))}%）`,
        )
        .join('\n'),
      `最近 14 天进度记录 ${logs.length} 条`,
    ].join('\n');
    const summarized = await this.abilities.summarize(user, {
      text,
      maxChars: 400,
      instruction: '写成一段 OKR 进度总结，先讲整体，再讲亮点与风险。',
    });
    return {
      summary: summarized.summary,
      highlights: highlights.slice(0, 6),
      risks,
      nextSteps: [
        ...(avg < expected - 10
          ? ['优先处理进度落后最多的关键结果，明确本周动作。']
          : []),
        ...(stale.length ? ['给长期未更新的关键结果补一次进度记录。'] : []),
        ...(cycle.endDate.getTime() < Date.now() && cycle.status !== 'CLOSED'
          ? ['完成复盘并关闭当前周期。']
          : []),
      ].slice(0, 6),
      mode: summarized.mode,
      model: summarized.model,
    };
  }

  async projectStandup(user: CurrentUser, body: Row) {
    const org = await this.hrmScope.resolve(user);
    const days = Math.max(1, Math.min(30, Number(body.days) || 7));
    const id = Number(body.projectId);
    const project = await this.prisma.pjProject.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!project)
      throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const tasks = await this.prisma.pjTask.findMany({
      where: {
        projectId: id,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const todayStr = new Date().toISOString().slice(0, 10);
    const done = tasks
      .filter((row) => row.status === 'DONE')
      .map((row) => row.title)
      .slice(0, 8);
    const doing = tasks
      .filter((row) => row.status === 'DOING' || row.status === 'REVIEW')
      .map((row) => row.title)
      .slice(0, 8);
    const blocked = tasks
      .filter(
        (row) =>
          ['TODO', 'DOING', 'REVIEW'].includes(row.status) &&
          ((row.dueDate && row.dueDate < todayStr) ||
            ['HIGH', 'URGENT'].includes(row.priority)),
      )
      .map(
        (row) =>
          `${row.title}${row.dueDate && row.dueDate < todayStr ? `（已过期 ${row.dueDate}）` : '（高优先级）'}`,
      )
      .slice(0, 8);
    const next = tasks
      .filter((row) => row.status === 'TODO')
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
      .map(
        (row) => `${row.title}${row.dueDate ? `（截止 ${row.dueDate}）` : ''}`,
      )
      .slice(0, 8);
    const text = [
      `项目：${project.name}（${dateOnly(project.startDate)} ~ ${dateOnly(project.endDate)}）`,
      `最近 ${days} 天有更新的任务 ${tasks.length} 个`,
      `已完成：${done.join('；') || '无'}`,
      `进行中：${doing.join('；') || '无'}`,
      `风险/阻塞：${blocked.join('；') || '无'}`,
      `下一步：${next.join('；') || '无'}`,
    ].join('\n');
    const summarized = await this.abilities.summarize(user, {
      text,
      maxChars: 500,
      instruction: '写成项目站会/周报摘要，突出进展、阻塞和下一步。',
    });
    return {
      summary: summarized.summary,
      done,
      doing,
      blocked,
      next,
      mode: summarized.mode,
      model: summarized.model,
    };
  }

  async projectSplitTask(user: CurrentUser, body: Row) {
    const org = await this.hrmScope.resolve(user);
    const id = Number(body.taskId);
    const task = await this.prisma.pjTask.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!task) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    const max = Math.max(2, Math.min(12, Number(body.max) || 6));
    const acceptance = strList(task.acceptanceCriteria, 12);
    const llm = await this.abilities.askJson(
      user,
      `你是任务拆解助手。只输出 JSON：{"tasks":[{"title":"","description":"","estimateHours":0,"acceptance":[""]}]}，最多 ${max} 个子任务。每个子任务要可独立交付，不要重复父任务标题。`,
      `父任务：${task.title}\n说明：${stripTags(task.description) || '无'}\n验收项：${acceptance.join('；') || '无'}`,
      1200,
    );
    const rows = Array.isArray(llm?.data.tasks) ? llm.data.tasks : [];
    const parsed = rows
      .map((item) => asRecord(item))
      .map((item) => ({
        title: cleanAiText(item.title, 200).trim(),
        description: cleanAiText(item.description, 1000).trim(),
        estimateHours: Math.max(
          0,
          Math.min(200, Number(item.estimateHours) || 0),
        ),
        acceptance: strList(item.acceptance, 8),
      }))
      .filter((item) => item.title)
      .slice(0, max);
    if (parsed.length) {
      return {
        tasks: parsed,
        mode: 'llm' as const,
        model: llm?.model || '',
      };
    }
    const pieces = stripTags(task.description)
      .split(/\n+|；|;/)
      .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
      .filter((item) => item.length >= 4)
      .slice(0, max);
    const fallback = (pieces.length ? pieces : [task.title]).map(
      (piece, index) => ({
        title: pieces.length
          ? piece.slice(0, 80)
          : `${task.title} · 第 ${index + 1} 步`,
        description: pieces.length ? piece : task.title,
        estimateHours: 0,
        acceptance: acceptance.length
          ? acceptance.slice(0, 3)
          : ['完成后更新任务状态'],
      }),
    );
    return { tasks: fallback, mode: 'rule' as const, model: '' };
  }

  async surveyReport(user: CurrentUser, body: Row) {
    const id = Number(body.surveyId);
    const survey = await this.prisma.marketingSurvey.findFirst({
      where: { id, createdBy: user.userId },
    });
    if (!survey) throw new BusinessException(ErrorCode.NOT_FOUND, '问卷不存在');
    const questions = parseQuestions(survey.questions);
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId: survey.tableId },
      orderBy: { id: 'desc' },
      take: 500,
      select: { id: true, createdAt: true, data: true },
    });
    const aggregated = aggregateResults(
      questions,
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        data: row.data,
      })),
    );
    const stats = aggregated
      .map((item) => {
        if (item.options?.length) {
          return `${item.label}：${item.options
            .map((option) => `${option.label} ${option.count} 票`)
            .join('，')}`;
        }
        if (item.average !== null && item.average !== undefined) {
          return `${item.label}：平均 ${item.average}（最小 ${item.min}，最大 ${item.max}）`;
        }
        return `${item.label}：${item.answered} 人作答`;
      })
      .join('\n');
    const openQuestions = questions.filter(
      (question) =>
        question.type === 'short_text' || question.type === 'long_text',
    );
    const openSamples = openQuestions.map((question) => ({
      label: question.label,
      values: rows
        .map((row) => asRecord(row.data)[question.id])
        .filter(
          (value): value is string =>
            typeof value === 'string' && !!value.trim(),
        )
        .slice(0, 60),
    }));
    const text = [
      `问卷：${survey.title}（回收 ${rows.length} 份）`,
      stats,
      ...openSamples.map(
        (item) =>
          `${item.label}的开放回答：\n${item.values.slice(0, 20).join('\n')}`,
      ),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 15000);
    const llm = await this.abilities.askJson(
      user,
      '你是市场调研分析师。只输出 JSON：{"summary":"","findings":[""],"clusters":[{"label":"","count":0,"examples":[""]}],"suggestions":[""]}。clusters 只针对开放题回答做语义聚类；不要编造数据。',
      `资料：\n<<<\n${text}\n>>>`,
      1400,
    );
    if (llm) {
      const summary = cleanAiText(llm.data.summary, 1500).trim();
      const findings = strList(llm.data.findings, 10);
      const clusters = (
        Array.isArray(llm.data.clusters) ? llm.data.clusters : []
      )
        .map((item) => asRecord(item))
        .map((item) => ({
          label: cleanAiText(item.label, 80).trim(),
          count: Math.max(0, Math.round(Number(item.count) || 0)),
          examples: strList(item.examples, 3),
        }))
        .filter((item) => item.label)
        .slice(0, 10);
      if (summary || findings.length || clusters.length) {
        return {
          responses: rows.length,
          summary,
          findings,
          clusters,
          suggestions: strList(llm.data.suggestions, 8),
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    return {
      responses: rows.length,
      summary: `本次「${survey.title}」共回收 ${rows.length} 份答卷，覆盖 ${questions.length} 道题。`,
      findings: aggregated
        .map((item) => {
          const top = item.options?.length
            ? item.options.reduce((a, b) => (b.count > a.count ? b : a))
            : null;
          return top
            ? `${item.label}：「${top.label}」占比最高（${top.percent}%）`
            : '';
        })
        .filter(Boolean)
        .slice(0, 8),
      clusters: openSamples
        .filter((item) => item.values.length)
        .map((item) => ({
          label: item.label,
          count: item.values.length,
          examples: item.values.slice(0, 3),
        }))
        .slice(0, 6),
      suggestions: [
        '配置文本模型后可获得开放题的语义聚类与逐题洞察。',
        rows.length < 30
          ? '样本量偏小，结论仅作方向参考。'
          : '样本量已具备参考价值，可结合业务动作复盘。',
      ],
      mode: 'rule' as const,
      model: '',
    };
  }

  async distributionRewrite(user: CurrentUser, body: Row) {
    const contentId = Number(body.contentId) || 0;
    let title = cleanAiText(body.title, 200).trim();
    let text = cleanAiText(body.text, 20000).trim();
    if (contentId) {
      const row = await this.prisma.distributionContent.findFirst({
        where: { id: contentId, userId: user.userId },
      });
      if (!row)
        throw new BusinessException(ErrorCode.NOT_FOUND, '分发内容不存在');
      title = title || row.title;
      text = text || stripTags(row.content);
    }
    if (!text)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供要改写的内容');
    const codes = strList(body.platformCodes, 12);
    const platforms = DISTRIBUTION_PLATFORMS.filter((item) =>
      codes.includes(item.code),
    );
    if (!platforms.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择至少一个分发平台',
      );
    }
    const platformText = platforms
      .map(
        (item) =>
          `${item.code}（${item.name}，${item.mediaType === 'ARTICLE' ? '文章' : '图文'}）`,
      )
      .join('；');
    const llm = await this.abilities.askJson(
      user,
      '你是多平台内容运营。只输出 JSON：{"versions":[{"platformCode":"","title":"","content":"","tags":[""]}],"titles":[""],"tags":[""]}。每个平台都要按平台语气与长度改写，不编造事实，保留原文核心信息。',
      `平台：${platformText}\n原标题：${title || '无'}\n原文：\n<<<\n${text}\n>>>`,
      1800,
    );
    if (llm) {
      const rows = Array.isArray(llm.data.versions) ? llm.data.versions : [];
      const versions = rows
        .map((item) => asRecord(item))
        .map((item) => ({
          platformCode: cleanAiText(item.platformCode, 32).trim(),
          title: cleanAiText(item.title, 200).trim(),
          content: cleanAiText(item.content, 20000).trim(),
          tags: strList(item.tags, 10),
        }))
        .filter(
          (item) =>
            item.platformCode &&
            platforms.some((platform) => platform.code === item.platformCode),
        )
        .slice(0, platforms.length);
      if (versions.length) {
        return {
          versions,
          titles: strList(llm.data.titles, 8),
          tags: strList(llm.data.tags, 12),
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    const plain = stripTags(text);
    const titles = unique([
      title,
      title ? `${title}｜一文看懂` : '',
      title ? `${title}（附要点）` : '',
    ]).slice(0, 5);
    const tags = unique(
      (title || plain)
        .split(/[\s,，。.、；;：:!?！？/\\|()[\]{}"'“”‘’\-—_]+/)
        .filter((word) => word.length >= 2 && word.length <= 12)
        .slice(0, 8),
    ).slice(0, 8);
    const limit: Record<string, number> = {
      weibo: 2000,
      xiaohongshu: 1000,
      douyin: 600,
      kuaishou: 600,
      zhihu: 6000,
      toutiao: 6000,
      bilibili: 2000,
      wechat: 8000,
    };
    return {
      versions: platforms.map((platform) => ({
        platformCode: platform.code,
        title: title ? `${title}｜${platform.name}` : `${platform.name}内容`,
        content: plain.slice(0, limit[platform.code] || 2000),
        tags: tags.slice(0, platform.mediaType === 'ARTICLE' ? 8 : 5),
      })),
      titles,
      tags,
      mode: 'rule' as const,
      model: '',
    };
  }

  async mailboxAnalyze(user: CurrentUser, body: Row) {
    const subject = cleanAiText(body.subject, 300).trim();
    const from = cleanAiText(body.from, 200).trim();
    const text = cleanAiText(body.body, 30000).trim();
    if (!text)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供邮件正文');
    const llm = await this.abilities.askJson(
      user,
      '你是邮件助理。只输出 JSON：{"summary":"","category":"INVOICE|MEETING|COMPLAINT|RECRUIT|SUPPORT|COOPERATION|OTHER","categoryLabel":"","priority":"HIGH|MEDIUM|LOW","todos":[{"text":"","dueAt":"YYYY-MM-DD"}],"replyDraft":""}。只根据邮件内容，不编造。',
      `发件人：${from || '未知'}\n主题：${subject || '无'}\n正文：\n<<<\n${text}\n>>>`,
      1200,
    );
    if (llm) {
      const summary = cleanAiText(llm.data.summary, 1000).trim();
      if (summary) {
        const category =
          cleanAiText(llm.data.category, 40).trim().toUpperCase() || 'OTHER';
        const todos = (Array.isArray(llm.data.todos) ? llm.data.todos : [])
          .map((item) => asRecord(item))
          .map((item) => ({
            text: cleanAiText(item.text, 300).trim(),
            dueAt: cleanAiText(item.dueAt, 20).trim(),
          }))
          .filter((item) => item.text)
          .slice(0, 10);
        const priorityRaw = cleanAiText(llm.data.priority, 10)
          .trim()
          .toUpperCase();
        const priority: AiLevel = ['HIGH', 'MEDIUM', 'LOW'].includes(
          priorityRaw,
        )
          ? (priorityRaw as AiLevel)
          : 'MEDIUM';
        return {
          summary,
          category,
          categoryLabel:
            cleanAiText(llm.data.categoryLabel, 40).trim() || category,
          priority,
          todos,
          replyDraft: cleanAiText(llm.data.replyDraft, 4000).trim(),
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    const lower = `${subject} ${text}`.toLowerCase();
    const category = /发票|开票|付款|账单|invoice|payment/.test(lower)
      ? 'INVOICE'
      : /会议|meeting|日程|calendar/.test(lower)
        ? 'MEETING'
        : /投诉|不满|退款|complaint/.test(lower)
          ? 'COMPLAINT'
          : /面试|简历|招聘|interview|resume/.test(lower)
            ? 'RECRUIT'
            : /合作|报价|商务|cooperation/.test(lower)
              ? 'COOPERATION'
              : 'OTHER';
    const labels: Record<string, string> = {
      INVOICE: '财务票据',
      MEETING: '会议日程',
      COMPLAINT: '投诉反馈',
      RECRUIT: '招聘面试',
      COOPERATION: '商务合作',
      OTHER: '其他',
    };
    const priority: AiLevel = /紧急|尽快|asap|今天|立刻/.test(lower)
      ? 'HIGH'
      : /本周|截止|remind|提醒/.test(lower)
        ? 'MEDIUM'
        : 'LOW';
    const todoLines = text
      .split(/\n+|。|；|;/)
      .map((line) => line.trim())
      .filter((line) =>
        /请|需要|务必|安排|回复|提交|确认|截止|deadline/i.test(line),
      )
      .slice(0, 6)
      .map((line) => ({
        text: line.slice(0, 200),
        dueAt: (line.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/)?.[0] || '')
          .replace(/[年月]/g, '-')
          .replace(/日$/, ''),
      }));
    return {
      summary: text.replace(/\s+/g, ' ').slice(0, 300),
      category,
      categoryLabel: labels[category] || '其他',
      priority,
      todos: todoLines,
      replyDraft: subject
        ? `您好，\n\n已收到关于「${subject}」的邮件，我们会尽快处理并回复。\n\n如有补充信息，请直接回复本邮件。`
        : '',
      mode: 'rule' as const,
      model: '',
    };
  }

  async hrmAttrition(user: CurrentUser, body: Row) {
    const org = await this.hrmScope.resolve(user);
    if (!org.isAdmin && !org.isOwner) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有 HR 或组织管理员可以查看离职风险',
      );
    }
    const memberUserId = cleanAiText(body.memberUserId, 64).trim();
    const profile = await this.prisma.hrmEmployeeProfile.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        memberUserId,
      },
    });
    if (!profile)
      throw new BusinessException(ErrorCode.NOT_FOUND, '员工档案不存在');
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const logs = await this.prisma.hrmAttendanceLog.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        staffUserId: memberUserId,
        at: { gte: since },
      },
      select: { mark: true },
      take: 500,
    });
    const late = logs.filter((row) => row.mark !== 'NORMAL').length;
    const tenureDays = profile.joinedAt
      ? Math.max(0, daysBetween(new Date(profile.joinedAt)))
      : 0;
    const skills = Array.isArray(profile.skills) ? profile.skills.length : 0;
    const text = [
      `员工：${memberUserId}；状态：${profile.status}；部门：${profile.department || '未填'}`,
      `入职：${profile.joinedAt || '未填'}（约 ${tenureDays} 天）；用工类型：${profile.employmentType}`,
      `技能标签 ${skills} 个；备注：${cleanAiText(profile.note, 500) || '无'}`,
      `最近 90 天异常打卡 ${late} 次（样本 ${logs.length} 次）`,
      body.note ? `HR 补充：${cleanAiText(body.note, 2000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const score = await this.abilities.score(user, {
      text,
      dimensions: [
        { key: 'tenure', label: '在职稳定性' },
        { key: 'attendance', label: '出勤稳定性' },
        { key: 'engagement', label: '投入与成长' },
      ],
      guide:
        '离职风险评分越高表示风险越大：试用期或入职不足 90 天、近期异常打卡多、备注中出现消极信号时风险更高。',
    });
    return {
      score: score.total,
      level: score.level,
      reasons: score.dimensions.map((row) => `${row.label}：${row.reason}`),
      suggestions: [
        score.total >= 75
          ? '安排一次一对一面谈，确认近期状态与诉求。'
          : '保持常规沟通节奏，关注关键项目负荷。',
        late > 6 ? '核对异常打卡原因，区分制度问题与个人状态。' : '',
        profile.status === 'PROBATION'
          ? '试用期员工在转正前完成一次正式反馈。'
          : '',
      ].filter(Boolean),
      mode: score.mode,
      model: score.model,
    };
  }

  private static readonly LEGAL_RULES: Array<{
    keyword: string;
    level: AiLevel;
    risk: string;
    suggestion: string;
  }> = [
    {
      keyword: '自动续约',
      level: 'MEDIUM',
      risk: '自动续约条款可能导致合同在无意中延长',
      suggestion: '明确续约通知期与不续约的书面方式',
    },
    {
      keyword: '无限责任',
      level: 'HIGH',
      risk: '无限责任条款会让风险敞口不可控',
      suggestion: '改为以合同金额或可保范围为上限',
    },
    {
      keyword: '违约金',
      level: 'MEDIUM',
      risk: '违约金比例或触发条件可能过高',
      suggestion: '核对比例是否与实际损失匹配，并设置上限',
    },
    {
      keyword: '单方解除',
      level: 'HIGH',
      risk: '单方解除权可能只赋予一方',
      suggestion: '补充对等解除权与提前通知义务',
    },
    {
      keyword: '保密',
      level: 'LOW',
      risk: '保密范围与期限需要明确',
      suggestion: '写明保密信息范围、例外与存续期限',
    },
    {
      keyword: '赔偿',
      level: 'MEDIUM',
      risk: '赔偿范围可能包含间接损失',
      suggestion: '排除间接损失与利润损失，设置赔偿上限',
    },
    {
      keyword: '免责',
      level: 'MEDIUM',
      risk: '免责条款可能过度排除一方责任',
      suggestion: '保留故意或重大过失不得免责的底线',
    },
    {
      keyword: '管辖',
      level: 'LOW',
      risk: '争议管辖地可能对己方不便',
      suggestion: '优先约定己方所在地或仲裁机构',
    },
  ];

  async legalReview(user: CurrentUser, body: Row) {
    const text = cleanAiText(body.text, 30000).trim();
    if (!text)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请提供合同或条款文本',
      );
    const role = cleanAiText(body.role, 20).trim() || 'NEUTRAL';
    const llm = await this.abilities.askJson(
      user,
      '你是法务审阅助手。只输出 JSON：{"summary":"","risks":[{"clause":"","risk":"","level":"HIGH|MEDIUM|LOW","suggestion":""}]}。只提示风险与修改方向，不提供正式法律意见，不编造条款。',
      `审阅立场：${role}\n文本：\n<<<\n${text}\n>>>`,
      1500,
    );
    if (llm) {
      const risks = (Array.isArray(llm.data.risks) ? llm.data.risks : [])
        .map((item) => asRecord(item))
        .map((item) => {
          const levelRaw = cleanAiText(item.level, 10).trim().toUpperCase();
          return {
            clause: cleanAiText(item.clause, 500).trim(),
            risk: cleanAiText(item.risk, 500).trim(),
            level: (['HIGH', 'MEDIUM', 'LOW'].includes(levelRaw)
              ? levelRaw
              : 'MEDIUM') as AiLevel,
            suggestion: cleanAiText(item.suggestion, 500).trim(),
          };
        })
        .filter((item) => item.risk)
        .slice(0, 12);
      const summary = cleanAiText(llm.data.summary, 1500).trim();
      if (summary || risks.length) {
        return { summary, risks, mode: 'llm' as const, model: llm.model };
      }
    }
    const risks = AiPointsService.LEGAL_RULES.map((rule) => {
      const index = text.indexOf(rule.keyword);
      if (index < 0) return null;
      return {
        clause: text
          .slice(Math.max(0, index - 40), Math.min(text.length, index + 80))
          .replace(/\s+/g, ' ')
          .trim(),
        risk: rule.risk,
        level: rule.level,
        suggestion: rule.suggestion,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    return {
      summary: risks.length
        ? `共发现 ${risks.length} 个需要关注的条款要点，建议逐条核对后再签署。`
        : '没有命中常见风险关键词，仍建议由法务逐条审阅。',
      risks,
      mode: 'rule' as const,
      model: '',
    };
  }

  async overseasCheck(user: CurrentUser, body: Row) {
    const country = cleanAiText(body.country, 60).trim();
    const question = cleanAiText(body.question, 2000).trim();
    const extra = cleanAiText(body.text, 10000).trim();
    if (!country || !question) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写国家/地区与问题',
      );
    }
    const result = await this.abilities.ask(user, {
      question: `【${country}】${question}${extra ? `\n补充材料：${extra}` : ''}`,
      consumerType: 'OVERSEAS',
      consumerId: user.userId,
      topK: 6,
      maxChars: 4000,
    });
    return {
      answer: result.answer,
      citations: result.citations.map((item) => ({
        title: item.title,
        ref: item.ref,
        source: item.source,
      })),
      risks: [
        '主体与资质：确认当地准入、许可与经营范围',
        '税务：确认增值税/所得税申报与常设机构风险',
        '数据与隐私：确认数据跨境与本地化要求',
        '产品合规：确认标签、认证与广告用语限制',
      ],
      mode: result.mode,
      model: result.model,
    };
  }

  async invoiceExtract(user: CurrentUser, body: Row) {
    const text = cleanAiText(body.text, 30000).trim();
    if (!text)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供发票材料文本');
    const fields = [
      { key: 'invoiceNo', label: '发票号码' },
      { key: 'invoiceDate', label: '开票日期' },
      { key: 'buyer', label: '购买方' },
      { key: 'seller', label: '销售方' },
      { key: 'amount', label: '金额' },
      { key: 'tax', label: '税额' },
      { key: 'total', label: '价税合计' },
    ];
    const extracted = await this.abilities.extract(user, {
      text,
      fields,
      instruction: '金额只保留数字与小数点，日期统一为 YYYY-MM-DD。',
    });
    const amount = amountOf(extracted.values.amount || '');
    const tax = amountOf(extracted.values.tax || '');
    const total = amountOf(extracted.values.total || '');
    const warnings: string[] = [];
    if (amount && tax && total && Math.abs(amount + tax - total) > 0.01) {
      warnings.push(
        `金额与税额相加为 ${(amount + tax).toFixed(2)}，与价税合计 ${total.toFixed(2)} 不一致`,
      );
    }
    if (!extracted.values.invoiceNo) warnings.push('没有识别到发票号码');
    if (!extracted.values.invoiceDate) warnings.push('没有识别到开票日期');
    if (!total) warnings.push('没有识别到价税合计');
    return {
      values: extracted.values,
      warnings,
      mode: extracted.mode,
      model: extracted.model,
    };
  }

  async taxCheck(user: CurrentUser, body: Row) {
    const text = cleanAiText(body.text, 30000).trim();
    const region = cleanAiText(body.region, 60).trim();
    if (!text)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供财税材料文本');
    const llm = await this.abilities.askJson(
      user,
      '你是财税合规检查助手。只输出 JSON：{"summary":"","issues":[""],"suggestions":[""]}。只根据材料指出缺项与不一致，不给出正式税务意见，不编造。',
      `地区：${region || '未指定'}\n材料：\n<<<\n${text}\n>>>`,
      1000,
    );
    if (llm) {
      const issues = strList(llm.data.issues, 10);
      const suggestions = strList(llm.data.suggestions, 10);
      const summary = cleanAiText(llm.data.summary, 1200).trim();
      if (summary || issues.length) {
        return {
          summary,
          issues,
          suggestions,
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    const issues: string[] = [];
    if (!/纳税人识别号|统一社会信用代码/.test(text))
      issues.push('缺少纳税人识别号/统一社会信用代码');
    if (!/金额|价税合计/.test(text)) issues.push('缺少金额或价税合计');
    if (!/税率|征收率/.test(text)) issues.push('缺少税率/征收率');
    if (/免税|零税率/.test(text) && !/依据|备案|文件/.test(text)) {
      issues.push('出现免税/零税率表述，但没有看到依据或备案说明');
    }
    return {
      summary: issues.length
        ? `材料中发现 ${issues.length} 个需要补充或核对的事项。`
        : '没有发现明显的材料缺项，仍建议按当地口径复核。',
      issues,
      suggestions: issues.map((item) => `核对并补齐：${item}`),
      mode: 'rule' as const,
      model: '',
    };
  }

  async socialCompose(user: CurrentUser, body: Row) {
    const topic = cleanAiText(body.topic, 2000).trim();
    if (!topic)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主题');
    const platform = cleanAiText(body.platform, 40).trim() || '通用';
    const tone = cleanAiText(body.tone, 40).trim() || '自然';
    const intentText = cleanAiText(body.intentText, 5000).trim();
    const llm = await this.abilities.askJson(
      user,
      '你是社媒内容助手。只输出 JSON：{"title":"","content":"","tags":[""],"intent":"","intentLabel":""}。文案要贴合平台语气，不编造事实；intent 仅在给了私信内容时填写。',
      `平台：${platform}；语气：${tone}\n主题：${topic}\n${intentText ? `私信内容：${intentText}` : ''}`,
      1200,
    );
    if (llm) {
      const content = cleanAiText(llm.data.content, 5000).trim();
      if (content) {
        return {
          title: cleanAiText(llm.data.title, 200).trim(),
          content,
          tags: strList(llm.data.tags, 10),
          intent: cleanAiText(llm.data.intent, 40).trim(),
          intentLabel: cleanAiText(llm.data.intentLabel, 40).trim(),
          mode: 'llm' as const,
          model: llm.model,
        };
      }
    }
    const lower = intentText.toLowerCase();
    const intent = /合作|联名|商务/.test(lower)
      ? 'COOPERATION'
      : /价格|报价|多少钱|购买/.test(lower)
        ? 'PURCHASE'
        : /投诉|不满|差评|退款/.test(lower)
          ? 'COMPLAINT'
          : /招聘|简历|面试/.test(lower)
            ? 'RECRUIT'
            : intentText
              ? 'INQUIRY'
              : '';
    const intentLabels: Record<string, string> = {
      COOPERATION: '合作意向',
      PURCHASE: '购买咨询',
      COMPLAINT: '投诉反馈',
      RECRUIT: '招聘咨询',
      INQUIRY: '一般咨询',
    };
    const tags = unique(
      topic
        .split(/[\s,，。.、；;：:!?！？/\\|()[\]{}"'“”‘’\-—_]+/)
        .filter((word) => word.length >= 2 && word.length <= 12)
        .slice(0, 8),
    );
    return {
      title: topic.slice(0, 60),
      content: `${topic}\n\n${tone === '专业' ? '欢迎交流与指正。' : '欢迎留言交流。'}`,
      tags,
      intent,
      intentLabel: intentLabels[intent] || '',
      mode: 'rule' as const,
      model: '',
    };
  }

  /**
   * OA 自然语言发起流程：把一句话映射到某个已启用模板，并按模板字段预填草稿。
   * 只产出草稿（选模板 + 预填字段 + 建议标题 + 缺项提示），不落库、不提交；
   * 缺模型时按关键词匹配模板，字段留给用户手动补全。
   */
  async oaDraftApplication(user: CurrentUser, body: Row) {
    const ctx = await this.oaScope.context(user, body);
    const description = cleanAiText(body.text, 2000).trim();
    if (!description) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请用一句话描述你要申请的事项',
      );
    }
    const rows = await this.prisma.oaTemplate.findMany({
      where: { orgType: ctx.orgType, orgUserId: ctx.orgUserId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 40,
    });
    if (!rows.length) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该组织还没有启用的申请模板，请先在「模板与流程」里配置',
      );
    }
    const templates: OaTemplateInfo[] = rows.map((row) => ({
      id: row.id,
      name: cleanAiText(row.name, 40).trim(),
      description: cleanAiText(row.description, 200).trim(),
      fields: oaFieldsOf(row.fieldsSchema),
    }));
    const requested = Number(body.templateId) || 0;
    const preset = requested
      ? templates.find((item) => item.id === requested)
      : undefined;
    const candidates = preset ? [preset] : templates;
    const catalog = candidates
      .map((item) => {
        const fields = item.fields
          .slice(0, 20)
          .map((field) => {
            const meta = `${field.key}(${field.label}/${field.type}${field.required ? '/必填' : ''})`;
            const options = field.options.length
              ? ` 可选值：${field.options.map((option) => option.value).join('|')}`
              : '';
            return `${meta}${options}`;
          })
          .join('；');
        return `- 模板 ${item.id}「${item.name}」${item.description ? `（${item.description}）` : ''}${fields ? `\n  字段：${fields}` : ''}`;
      })
      .join('\n');
    const llm = await this.abilities.askJson(
      user,
      '你是 OA 单据起草助手。只输出 JSON：{"templateId":数字,"title":"","fields":{"字段key":值},"reason":""}。' +
        '从候选模板里选最贴合用户描述的一个；fields 只填能从描述中确定的字段，不确定就留空，不要编造；' +
        'select/radio 只能填给出的可选值 code。',
      `组织：${ctx.name}\n候选模板：\n${catalog}\n\n用户描述：${description}`,
      1200,
    );
    if (llm) {
      const chosen =
        candidates.find((item) => item.id === Number(llm.data.templateId)) ||
        preset ||
        candidates[0];
      const formData = oaCoerceForm(chosen.fields, asRecord(llm.data.fields));
      return {
        templateId: chosen.id,
        templateName: chosen.name,
        title:
          cleanAiText(llm.data.title, 200).trim() || description.slice(0, 60),
        formData,
        missing: oaMissingOf(chosen.fields, formData),
        reason: cleanAiText(llm.data.reason, 500).trim(),
        mode: 'llm' as const,
        model: llm.model,
      };
    }
    const fallback = preset || oaBestTemplate(candidates, description);
    return {
      templateId: fallback.id,
      templateName: fallback.name,
      title: description.slice(0, 60),
      formData: {},
      missing: oaMissingOf(fallback.fields, {}),
      reason:
        '未配置文本模型，已按关键词匹配到最合适的模板；请核对字段后补全内容。',
      mode: 'rule' as const,
      model: '',
    };
  }
}
