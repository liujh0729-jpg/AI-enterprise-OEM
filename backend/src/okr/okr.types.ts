/** OKR 领域类型与枚举常量（供 base 与各特性服务共享）。 */
export type CycleRow = {
  id: number;
  ownerUserId: string;
  kind: string;
  year: number;
  period: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  closedAt: Date | null;
  createdAt: Date;
};

export type ObjectiveRow = {
  id: number;
  ownerUserId: string;
  cycleId: number;
  parentId: number;
  level: string;
  title: string;
  description: string;
  ownerMemberUserId: string;
  assignerUserId: string;
  weight: unknown;
  progress: unknown;
  visibility: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

export type KrRow = {
  id: number;
  ownerUserId: string;
  objectiveId: number;
  title: string;
  metricType: string;
  targetValue: unknown;
  currentValue: unknown;
  startValue: unknown;
  unit: string;
  direction: string;
  weight: unknown;
  ownerMemberUserId: string;
  metricSource: unknown;
  lastRefreshedAt: Date | null;
  createdAt: Date;
};

export type PlanRow = {
  id: number;
  ownerUserId: string;
  memberUserId: string;
  objectiveId: number;
  krId: number;
  title: string;
  detail: string;
  kind: string;
  periodKey: string;
  startDate: Date | null;
  dueDate: Date | null;
  priority: string;
  status: string;
  progress: unknown;
  scheduleId: number;
  source: string;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReportRow = {
  id: number;
  ownerUserId: string;
  memberUserId: string;
  kind: string;
  periodKey: string;
  content: unknown;
  autoDraft: unknown;
  source: string;
  scheduleId: number;
  status: string;
  submittedAt: Date | null;
  managerComment: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScoreRow = {
  id: number;
  ownerUserId: string;
  cycleId: number;
  memberUserId: string;
  reviewerUserId: string;
  scores: unknown;
  total: unknown;
  comment: string;
  status: string;
  submittedAt: Date | null;
  updatedAt: Date;
};

export type ProgressRow = {
  id: number;
  krId: number;
  objectiveId: number;
  before: unknown;
  after: unknown;
  progress: unknown;
  note: string;
  source: string;
  authorId: string;
  refType: string;
  refId: string;
  createdAt: Date;
};

export const CYCLE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'REVIEW', 'CLOSED']);

export const LEVELS = new Set(['COMPANY', 'DEPT', 'PERSONAL']);

export const VISIBILITIES = new Set(['ORG', 'DEPT', 'SELF']);

export const OBJ_STATUSES = new Set(['DRAFT', 'ACTIVE', 'DONE', 'CANCELLED']);

export const METRIC_TYPES = new Set(['MANUAL', 'AUTO', 'ROLLUP']);

export const PLAN_KINDS = new Set(['WEEK', 'DAY', 'ADHOC']);

export const PLAN_STATUSES = new Set(['TODO', 'DOING', 'DONE', 'CANCELLED']);

export const REPORT_KINDS = new Set(['DAILY', 'WEEKLY']);

export const REPORT_SOURCES = new Set(['MANUAL', 'AGENT_AUTO', 'SYSTEM']);

export const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

export const AUTO_KR_TEMPLATES = [
  {
    title: '本期新增商机',
    metricType: 'AUTO',
    targetValue: 20,
    unit: '个',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_OPPORTUNITY',
      agg: 'COUNT',
      field: '',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期合同成交金额',
    metricType: 'AUTO',
    targetValue: 1_000_000,
    unit: '元',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_CONTRACT',
      agg: 'SUM',
      field: 'amount',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期回款金额',
    metricType: 'AUTO',
    targetValue: 800_000,
    unit: '元',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_PAYMENT',
      agg: 'SUM',
      field: 'planAmount',
      filters: [],
      dateField: 'planEndAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期新增订单',
    metricType: 'AUTO',
    targetValue: 30,
    unit: '单',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_ORDER',
      agg: 'COUNT',
      field: '',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '关键交付完成率',
    metricType: 'MANUAL',
    targetValue: 100,
    unit: '%',
    direction: 'UP',
    weight: 1,
  },
];
