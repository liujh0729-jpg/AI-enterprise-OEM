import { OKR_METRIC_SOURCES, OKR_OPTION_LABELS } from '@enterprise/contracts';
import { text } from '../common/api';
import { jsonArray, jsonObject, num, round } from './okr.helpers';
import type { BriefRow } from './okr-brief.service';
import type { OkrMemberRow } from './okr.scope';

export type OptionKey = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export type KrNode = {
  key: string;
  title: string;
  metricType: string;
  baseline: number;
  target: number;
  unit: string;
  direction: 'UP' | 'DOWN';
  weight: number;
  ownerMemberUserId: string;
  ownerName: string;
  metricSource: Record<string, unknown>;
  quality: { ok: boolean; issues: string[] };
};

export type ObjectiveNode = {
  key: string;
  level: 'COMPANY' | 'DEPT' | 'PERSONAL';
  title: string;
  description: string;
  ownerMemberUserId: string;
  ownerName: string;
  weight: number;
  krs: KrNode[];
};

export type TaskNode = {
  key: string;
  objectiveKey: string;
  krKey: string;
  title: string;
  detail: string;
  deliverable: string;
  acceptance: Array<{
    key: string;
    label: string;
    required: boolean;
    evidence: string;
  }>;
  rubric: Array<{ level: string; label: string; description: string }>;
  weight: number;
  estimateHours: number;
  dueDate: string;
  priority: string;
  ownerMemberUserId: string;
  ownerName: string;
  dependencies: string[];
  externalPartyIds: number[];
};

export type DecompositionPayload = {
  summary: string;
  mode: 'LLM' | 'RULE';
  optionKey: OptionKey;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  assumptions: string[];
  risks: Array<{ risk: string; impact: string; mitigation: string }>;
  objectives: ObjectiveNode[];
  tasks: TaskNode[];
  cost: {
    budgetAmount: number;
    internalCost: number;
    externalCost: number;
    laborHours: number;
  };
  /** 模拟结果由 simulate 回写到 payload，读取时剥离。 */
  simulation?: unknown;
};

export const OPTION_KEYS: OptionKey[] = [
  'CONSERVATIVE',
  'BALANCED',
  'AGGRESSIVE',
];

const METRIC_SOURCE_SET = new Set<string>(OKR_METRIC_SOURCES);
const LEVELS = new Set(['COMPANY', 'DEPT', 'PERSONAL']);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

export const DEFAULT_ACCEPTANCE = () => [
  {
    key: 'submitted',
    label: '交付物已提交',
    required: true,
    evidence: '文件、链接或成果截图',
  },
  {
    key: 'accepted',
    label: '验收人确认通过',
    required: true,
    evidence: '客户/负责人书面确认',
  },
];

export const DEFAULT_RUBRIC = () => [
  { level: 'PASS', label: '合格', description: '交付物齐全、验收项全部满足' },
  {
    level: 'GOOD',
    label: '良好',
    description: '在合格基础上提前或超出预期交付',
  },
  {
    level: 'EXCELLENT',
    label: '优秀',
    description: '形成可复用的方法、模板或额外业务结果',
  },
];

const dayDiff = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(Math.round((end - start) / 86_400_000) + 1, 1);
};

const shiftDate = (start: string, offsetDays: number) => {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** 只从用户输入里取数：没有数字就留空，绝不替用户编目标值。 */
export function extractGoalNumber(brief: BriefRow) {
  const raw = `${text(brief.scopeTarget)} ${text(brief.businessGoal)}`;
  const match = /(\d+(?:\.\d+)?)\s*(万元|万|%|元|个|单|家|人|天|小时)/.exec(
    raw,
  );
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unitRaw = match[2];
  const unit = unitRaw === '万元' || unitRaw === '万' ? '元' : unitRaw;
  const value = unitRaw === '万元' || unitRaw === '万' ? base * 10_000 : base;
  return { value: round(value, 2), unit };
}

const salesLike = (brief: BriefRow) =>
  /销售|合同|签约|订单|回款|营收|收入|成交|续费/.test(
    `${text(brief.businessGoal)} ${text(brief.scopeTarget)}`,
  );

const scaleTarget = (baseline: number, target: number, factor: number) =>
  round(baseline + (target - baseline) * factor, 2);

const pickOwner = (
  index: number,
  brief: BriefRow,
  members: OkrMemberRow[],
): { id: string; name: string } => {
  const labor = jsonArray(brief.labor).map(jsonObject);
  for (const row of labor) {
    const memberUserId = text(row['memberUserId']).trim();
    if (
      memberUserId &&
      members.some((item) => item.memberUserId === memberUserId)
    ) {
      const member = members.find(
        (item) => item.memberUserId === memberUserId,
      )!;
      return { id: memberUserId, name: member.name };
    }
  }
  if (!members.length) return { id: '', name: '' };
  const member = members[index % members.length];
  return { id: member.memberUserId, name: member.name };
};

const optionHint = (key: OptionKey) =>
  key === 'CONSERVATIVE'
    ? '目标更稳、给交付留缓冲'
    : key === 'AGGRESSIVE'
      ? '目标更有挑战、压缩缓冲'
      : '目标与资源平衡';

/**
 * 规则拆解：没有模型/模型失败时使用，明确标注 RULE，不伪装成 AI。
 * 只依据目标书已填内容 + 组织名册，不读取外部数据。
 */
export function buildRulePayload(input: {
  brief: BriefRow;
  members: OkrMemberRow[];
  optionKey: OptionKey;
  actorName: string;
}): DecompositionPayload {
  const { brief, members, optionKey } = input;
  const start = text(brief.startDate) || new Date().toISOString().slice(0, 10);
  const end = text(brief.endDate) || start;
  const days = dayDiff(start, end);
  const factor =
    optionKey === 'CONSERVATIVE' ? 0.8 : optionKey === 'AGGRESSIVE' ? 1.2 : 1;
  const hourFactor =
    optionKey === 'CONSERVATIVE' ? 1.15 : optionKey === 'AGGRESSIVE' ? 0.9 : 1;
  const goal = extractGoalNumber(brief);
  const sales = salesLike(brief);
  const deliverables = jsonArray(brief.deliverables)
    .map(jsonObject)
    .map((row) => ({
      name: text(row['name']).trim(),
      description: text(row['description']).trim(),
      acceptance: text(row['acceptance']).trim(),
    }))
    .filter((row) => row.name)
    .slice(0, 6);
  const owner = pickOwner(0, brief, members);
  const objectiveKey = 'o1';
  const mainTitle = (
    text(brief.scopeTarget) ||
    text(brief.businessGoal) ||
    brief.title
  ).slice(0, 200);

  const krs: KrNode[] = [];
  const pushKr = (node: Omit<KrNode, 'quality'>) => {
    const issues: string[] = [];
    if (node.target === node.baseline)
      issues.push('目标值与基线相同，需补充目标');
    if (!node.unit) issues.push('缺少单位');
    if (!node.title) issues.push('缺少 KR 标题');
    krs.push({ ...node, quality: { ok: issues.length === 0, issues } });
  };
  if (goal) {
    pushKr({
      key: 'k1',
      title: `${text(brief.businessGoal) || brief.title}`.slice(0, 80),
      metricType: 'MANUAL',
      baseline: 0,
      target: scaleTarget(0, goal.value, factor),
      unit: goal.unit,
      direction: 'UP',
      weight: 2,
      ownerMemberUserId: owner.id,
      ownerName: owner.name,
      metricSource: {},
    });
  }
  pushKr({
    key: goal ? 'k2' : 'k1',
    title: '交付物验收通过率',
    metricType: 'MANUAL',
    baseline: 0,
    target: 100,
    unit: '%',
    direction: 'UP',
    weight: 2,
    ownerMemberUserId: owner.id,
    ownerName: owner.name,
    metricSource: {},
  });
  pushKr({
    key: goal ? 'k3' : 'k2',
    title: '关键任务按期完成率',
    metricType: 'MANUAL',
    baseline: 0,
    target: optionKey === 'AGGRESSIVE' ? 98 : 95,
    unit: '%',
    direction: 'UP',
    weight: 1,
    ownerMemberUserId: owner.id,
    ownerName: owner.name,
    metricSource: {},
  });
  if (goal && sales) {
    const source = /订单/.test(text(brief.businessGoal))
      ? 'CRM_ORDER'
      : /回款/.test(text(brief.businessGoal))
        ? 'CRM_PAYMENT'
        : 'CRM_CONTRACT';
    pushKr({
      key: `k${krs.length + 1}`,
      title: '销售类自动指标达成',
      metricType: 'AUTO',
      baseline: 0,
      target: scaleTarget(0, goal.value, factor),
      unit: goal.unit,
      direction: 'UP',
      weight: 1,
      ownerMemberUserId: owner.id,
      ownerName: owner.name,
      metricSource: {
        source,
        agg:
          source === 'CRM_CONTRACT' ||
          source === 'CRM_ORDER' ||
          source === 'CRM_PAYMENT'
            ? 'SUM'
            : 'COUNT',
        field:
          source === 'CRM_CONTRACT'
            ? 'amount'
            : source === 'CRM_ORDER'
              ? 'amount'
              : 'planAmount',
        filters: [],
        dateField: source === 'CRM_PAYMENT' ? 'planEndAt' : 'createdAt',
        dateRange: 'CYCLE',
        scope: 'ACCOUNT',
      },
    });
  }
  const objective: ObjectiveNode = {
    key: objectiveKey,
    level: 'COMPANY',
    title: mainTitle,
    description: text(brief.businessGoal).slice(0, 2000),
    ownerMemberUserId: owner.id,
    ownerName: owner.name,
    weight: 1,
    krs: krs.slice(0, 5),
  };
  const deliveryKr = objective.krs.find((kr) => kr.title.includes('交付物'))!;
  const timelineKr = objective.krs.find((kr) => kr.title.includes('按期'))!;
  const external = jsonArray(brief.externalServices)
    .map(jsonObject)
    .slice(0, 2);
  const rows: Array<{
    name: string;
    acceptance: string;
    externalPartyId?: number;
  }> = deliverables.length
    ? deliverables.map((row) => ({
        name: row.name,
        acceptance: row.acceptance,
      }))
    : [{ name: brief.title, acceptance: '' }];
  const tasks: TaskNode[] = rows.map((row, index) => {
    const taskOwner = pickOwner(index, brief, members);
    return {
      key: `t${index + 1}`,
      objectiveKey,
      krKey: deliveryKr.key,
      title: `交付：${row.name}`.slice(0, 200),
      detail: `按目标书交付「${row.name}」，完成后提交验收证据。`,
      deliverable: row.name,
      acceptance: row.acceptance
        ? [
            {
              key: 'custom',
              label: row.acceptance.slice(0, 120),
              required: true,
              evidence: '验收记录',
            },
            ...DEFAULT_ACCEPTANCE(),
          ]
        : DEFAULT_ACCEPTANCE(),
      rubric: DEFAULT_RUBRIC(),
      weight: 1,
      estimateHours: round(
        Math.max(
          num(brief.budgetHours) / Math.max(rows.length + external.length, 1),
          num(brief.budgetHours) ? 0 : 8,
        ) * hourFactor,
        1,
      ),
      dueDate: shiftDate(
        start,
        Math.round((days * (index + 1)) / (rows.length + 1)),
      ),
      priority: index === 0 ? 'HIGH' : 'MEDIUM',
      ownerMemberUserId: taskOwner.id,
      ownerName: taskOwner.name,
      dependencies: index > 0 ? [`t${index}`] : [],
      externalPartyIds: [],
    };
  });
  const cadence: TaskNode = {
    key: `t${tasks.length + 1}`,
    objectiveKey,
    krKey: timelineKr.key,
    title: '建立周节奏与风险复盘',
    detail: '每周对齐进度、风险与偏差，输出下一步动作；结束时做一次复盘。',
    deliverable: '周报与复盘记录',
    acceptance: [
      ...DEFAULT_ACCEPTANCE(),
      {
        key: 'weekly',
        label: '每周有进度与风险记录',
        required: true,
        evidence: '周报链接',
      },
    ],
    rubric: DEFAULT_RUBRIC(),
    weight: 1,
    estimateHours: round(4 * hourFactor, 1),
    dueDate: end,
    priority: 'MEDIUM',
    ownerMemberUserId: owner.id,
    ownerName: owner.name,
    dependencies: [],
    externalPartyIds: [],
  };
  tasks.push(cadence);
  for (const [index, row] of external.entries()) {
    const scope = text(row['scope']).trim() || '外部协作交付';
    const partyId = num(row['partyId']);
    const taskOwner = pickOwner(index + 1, brief, members);
    tasks.push({
      key: `t${tasks.length + 1}`,
      objectiveKey,
      krKey: deliveryKr.key,
      title: `外部协作：${scope}`.slice(0, 200),
      detail: '外部方按约定范围交付，内部负责人跟踪准入、合同与验收。',
      deliverable: scope,
      acceptance: DEFAULT_ACCEPTANCE(),
      rubric: DEFAULT_RUBRIC(),
      weight: 1,
      estimateHours: round(8 * hourFactor, 1),
      dueDate: end,
      priority: 'HIGH',
      ownerMemberUserId: taskOwner.id,
      ownerName: taskOwner.name,
      dependencies: [],
      externalPartyIds: partyId ? [partyId] : [],
    });
  }
  const laborHours = round(
    tasks.reduce((sum, task) => sum + task.estimateHours, 0),
    1,
  );
  const externalCost = external.reduce(
    (sum, row) => sum + num(row['budget']),
    0,
  );
  const assumptions = [
    '规则模式：只依据目标书已填内容与组织名册，未读取 CRM 管道、供应商报价或历史交付',
    goal
      ? '目标值取自目标书文本中的数字，请确认基线与口径'
      : '目标书未给出可量化目标值，KR 需人工补目标',
    num(brief.budgetHours) > 0
      ? `任务估时按目标书总工时 ${num(brief.budgetHours)} 小时拆分`
      : '未填总工时，任务按经验估时，需人工校准',
  ];
  const risks: Array<{ risk: string; impact: string; mitigation: string }> = [];
  if (days < 14) {
    risks.push({
      risk: '工期很短',
      impact: '关键路径没有缓冲，任何延误都会冲击交付',
      mitigation: '缩减非关键交付，先保验收口径',
    });
  }
  if (!members.length) {
    risks.push({
      risk: '组织名册为空',
      impact: '负责人只能落在账号本身，个人 OKR 无法下钻',
      mitigation: '先在「职员与代理人」补齐成员与岗位',
    });
  }
  if (num(brief.budgetAmount) <= 0) {
    risks.push({
      risk: '预算未定',
      impact: '成本与外部合作无法定价',
      mitigation: '补预算或先按人力工时估算上限',
    });
  }
  return {
    summary: `规则方案（${OKR_OPTION_LABELS[optionKey] || optionKey}）：${optionHint(optionKey)}；生成 ${objective.krs.length} 个 KR、${tasks.length} 个任务。`,
    mode: 'RULE',
    optionKey,
    confidence: members.length && goal ? 'MEDIUM' : 'LOW',
    assumptions,
    risks,
    objectives: [objective],
    tasks: tasks.slice(0, 20),
    cost: {
      budgetAmount: round(num(brief.budgetAmount), 2),
      internalCost: 0,
      externalCost: round(externalCost, 2),
      laborHours,
    },
  };
}

const cleanString = (value: unknown, limit = 200) =>
  text(value).trim().slice(0, limit);

const validDate = (value: unknown, fallback: string) => {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
};

/** 防幻觉：负责人/外部主体白名单、日期收敛、验收与 rubric 兜底、指标源闭集校验。 */
export function normalizePayload(
  raw: unknown,
  optionKey: OptionKey,
  context: {
    members: OkrMemberRow[];
    partyIds: Set<number>;
    startDate: string;
    endDate: string;
    defaultSummary: string;
  },
): DecompositionPayload | null {
  const root = jsonObject(raw);
  const memberSet = new Set(context.members.map((row) => row.memberUserId));
  const nameOf = new Map(
    context.members.map((row) => [row.memberUserId, row.name]),
  );
  const clampDate = (value: unknown) => {
    const date = validDate(value, context.endDate);
    if (date < context.startDate) return context.startDate;
    if (date > context.endDate) return context.endDate;
    return date;
  };
  const owners = (value: unknown) => {
    const id = cleanString(value, 64);
    if (!id || id === '__owner__') return { id: '', name: '' };
    if (!memberSet.has(id)) return { id: '', name: '' };
    return { id, name: nameOf.get(id) || '' };
  };
  const objectives: ObjectiveNode[] = [];
  for (const [index, item] of jsonArray(root['objectives']).entries()) {
    const row = jsonObject(item);
    const title = cleanString(row['title'], 200);
    if (!title) continue;
    const owner = owners(row['ownerMemberUserId']);
    const levelRaw = cleanString(row['level'], 16).toUpperCase();
    const krs: KrNode[] = [];
    for (const [krIndex, krItem] of jsonArray(row['krs'])
      .slice(0, 5)
      .entries()) {
      const kr = jsonObject(krItem);
      const krTitle = cleanString(kr['title'], 200);
      if (!krTitle) continue;
      const baseline = num(kr['baseline']);
      const target = num(kr['target'], baseline);
      const source = jsonObject(kr['metricSource']);
      const sourceName = cleanString(source['source'], 32).toUpperCase();
      const metricSource = METRIC_SOURCE_SET.has(sourceName) ? source : {};
      const metricTypeRaw = cleanString(kr['metricType'], 16).toUpperCase();
      const metricType = metricSource.source
        ? 'AUTO'
        : ['MANUAL', 'AUTO', 'ROLLUP'].includes(metricTypeRaw)
          ? metricTypeRaw === 'AUTO'
            ? 'MANUAL'
            : metricTypeRaw
          : 'MANUAL';
      const krOwner = owners(kr['ownerMemberUserId']);
      const unit = cleanString(kr['unit'], 32);
      const issues: string[] = [];
      if (target === baseline) issues.push('目标值与基线相同');
      if (!unit) issues.push('缺少单位');
      if (!metricSource.source && metricTypeRaw === 'AUTO') {
        issues.push('指标源未注册，已降级为手动');
      }
      krs.push({
        key: cleanString(kr['key'], 32) || `k${krIndex + 1}`,
        title: krTitle,
        metricType,
        baseline,
        target,
        unit,
        direction:
          cleanString(kr['direction'], 8).toUpperCase() === 'DOWN'
            ? 'DOWN'
            : 'UP',
        weight: Math.min(Math.max(num(kr['weight'], 1), 0), 100),
        ownerMemberUserId: krOwner.id,
        ownerName: krOwner.name,
        metricSource,
        quality: { ok: issues.length === 0, issues },
      });
    }
    if (!krs.length) continue;
    objectives.push({
      key: cleanString(row['key'], 32) || `o${index + 1}`,
      level: LEVELS.has(levelRaw)
        ? (levelRaw as ObjectiveNode['level'])
        : 'COMPANY',
      title,
      description: cleanString(row['description'], 2000),
      ownerMemberUserId: owner.id,
      ownerName: owner.name,
      weight: Math.min(Math.max(num(row['weight'], 1), 0), 100),
      krs,
    });
  }
  if (!objectives.length) return null;
  const objectiveKeys = new Set(objectives.map((row) => row.key));
  const krIndex = new Map<string, { objectiveKey: string; key: string }>();
  for (const objective of objectives) {
    for (const kr of objective.krs) {
      krIndex.set(kr.key, { objectiveKey: objective.key, key: kr.key });
    }
  }
  const tasks: TaskNode[] = [];
  for (const [index, item] of jsonArray(root['tasks']).slice(0, 60).entries()) {
    const row = jsonObject(item);
    const title = cleanString(row['title'], 200);
    if (!title) continue;
    const objectiveKeyRaw = cleanString(row['objectiveKey'], 32);
    const objectiveKey = objectiveKeys.has(objectiveKeyRaw)
      ? objectiveKeyRaw
      : objectives[0].key;
    const krKeyRaw = cleanString(row['krKey'], 32);
    const krKey = krIndex.has(krKeyRaw)
      ? krKeyRaw
      : objectives.find((objective) => objective.key === objectiveKey)!.krs[0]
          .key;
    const owner = owners(row['ownerMemberUserId']);
    const acceptance = jsonArray(row['acceptance'])
      .map((entry, position) => {
        const cell = jsonObject(entry);
        const label = cleanString(cell['label'], 120);
        return label
          ? {
              key: cleanString(cell['key'], 32) || `c${position + 1}`,
              label,
              required: cell['required'] !== false,
              evidence: cleanString(cell['evidence'], 120),
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .slice(0, 10);
    const rubric = jsonArray(row['rubric'])
      .map((entry) => {
        const cell = jsonObject(entry);
        const label = cleanString(cell['label'], 40);
        return label
          ? {
              level: cleanString(cell['level'], 16) || 'PASS',
              label,
              description: cleanString(cell['description'], 200),
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .slice(0, 4);
    const priorityRaw = cleanString(row['priority'], 16).toUpperCase();
    tasks.push({
      key: cleanString(row['key'], 32) || `t${index + 1}`,
      objectiveKey,
      krKey,
      title,
      detail: cleanString(row['detail'], 2000),
      deliverable: cleanString(row['deliverable'], 200),
      acceptance: acceptance.length ? acceptance : DEFAULT_ACCEPTANCE(),
      rubric: rubric.length ? rubric : DEFAULT_RUBRIC(),
      weight: Math.min(Math.max(num(row['weight'], 1), 0), 100),
      estimateHours: Math.max(num(row['estimateHours']), 0),
      dueDate: clampDate(row['dueDate']),
      priority: PRIORITIES.has(priorityRaw) ? priorityRaw : 'MEDIUM',
      ownerMemberUserId: owner.id,
      ownerName: owner.name,
      dependencies: jsonArray(row['dependencies'])
        .map((entry) => cleanString(entry, 32))
        .filter(Boolean)
        .slice(0, 10),
      externalPartyIds: jsonArray(row['externalPartyIds'])
        .map((entry) => num(entry))
        .filter((entry) => context.partyIds.has(entry))
        .slice(0, 5),
    });
  }
  if (!tasks.length) return null;
  const taskKeys = new Set(tasks.map((row) => row.key));
  for (const task of tasks) {
    task.dependencies = task.dependencies.filter(
      (key) => taskKeys.has(key) && key !== task.key,
    );
  }
  // 每个 KR 至少一个任务，否则无法下钻与回填。
  for (const objective of objectives) {
    for (const kr of objective.krs) {
      if (tasks.some((task) => task.krKey === kr.key)) continue;
      tasks.push({
        key: `auto_${kr.key}`,
        objectiveKey: objective.key,
        krKey: kr.key,
        title: `推进 KR：${kr.title}`.slice(0, 200),
        detail: '模型未给出该 KR 的任务，确认前请补齐具体动作。',
        deliverable: kr.title,
        acceptance: DEFAULT_ACCEPTANCE(),
        rubric: DEFAULT_RUBRIC(),
        weight: 1,
        estimateHours: 0,
        dueDate: context.endDate,
        priority: 'MEDIUM',
        ownerMemberUserId: kr.ownerMemberUserId,
        ownerName: kr.ownerName,
        dependencies: [],
        externalPartyIds: [],
      });
    }
  }
  const costRow = jsonObject(root['cost']);
  const modeRaw = cleanString(root['mode'], 8).toUpperCase();
  const confidenceRaw = cleanString(root['confidence'], 8).toUpperCase();
  return {
    summary: cleanString(root['summary'], 1000) || context.defaultSummary,
    mode: modeRaw === 'LLM' ? 'LLM' : 'RULE',
    optionKey,
    confidence: ['LOW', 'MEDIUM', 'HIGH'].includes(confidenceRaw)
      ? (confidenceRaw as 'LOW' | 'MEDIUM' | 'HIGH')
      : 'MEDIUM',
    assumptions: jsonArray(root['assumptions'])
      .map((entry) => cleanString(entry, 300))
      .filter(Boolean)
      .slice(0, 10),
    risks: jsonArray(root['risks'])
      .map((entry) => {
        const row = jsonObject(entry);
        return {
          risk: cleanString(row['risk'], 200),
          impact: cleanString(row['impact'], 200),
          mitigation: cleanString(row['mitigation'], 200),
        };
      })
      .filter((entry) => entry.risk)
      .slice(0, 8),
    objectives,
    tasks: tasks.slice(0, 60),
    cost: {
      budgetAmount: Math.max(num(costRow['budgetAmount']), 0),
      internalCost: Math.max(num(costRow['internalCost']), 0),
      externalCost: Math.max(num(costRow['externalCost']), 0),
      laborHours: Math.max(num(costRow['laborHours']), 0),
    },
  };
}

export function splitPayload(raw: unknown) {
  const row = jsonObject(raw);
  const simulation = row['simulation'];
  const payload = { ...row };
  delete payload['simulation'];
  return {
    payload: payload as DecompositionPayload,
    simulation: simulation ? (simulation as Record<string, unknown>) : null,
  };
}
