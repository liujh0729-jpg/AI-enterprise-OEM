import type {
  OaCondition,
  OaField,
  OaFlowNode,
  OaLinkageRule,
  OaListColumn,
} from '@enterprise/contracts';
import {
  ORG_BUSINESS_SCOPE_LABELS,
  oaFieldSchema,
} from '@enterprise/contracts';
import { text } from '../common/api';

export const num = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const int = (value: unknown, fallback = 0) =>
  Math.trunc(num(value, fallback));

export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : '';

export const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const jsonArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => text(item).trim()).filter(Boolean))];
  }
  const raw = text(value).trim();
  return raw ? raw.split(/[,，\s]+/).filter(Boolean) : [];
};

export const asString = (value: unknown, max = 200) =>
  text(value).trim().slice(0, max);

/** 字符串型 id（路径参数、目标记录 id）统一收窄，空值给 0 号语义由调用方处理。 */
export const asId = (value: unknown) => int(value, 0);

export const asFields = (value: unknown): OaField[] =>
  jsonArray(value)
    .map((item) => normalizeField(jsonObject(item)))
    .filter((item): item is OaField => Boolean(item));

export const asFlowNodes = (value: unknown): OaFlowNode[] =>
  jsonArray(value)
    .map((item) => normalizeNode(jsonObject(item)))
    .filter((item): item is OaFlowNode => Boolean(item));

export const asLinkageRules = (value: unknown): OaLinkageRule[] =>
  jsonArray(value)
    .map((item) => normalizeLinkage(jsonObject(item)))
    .filter((item): item is OaLinkageRule => Boolean(item));

const OPTION_TYPES = new Set([
  'select',
  'multiSelect',
  'radio',
  'checkbox',
  'list',
]);

const LIST_COLUMN_TYPES = new Set([
  'text',
  'number',
  'amount',
  'date',
  'select',
]);

const normalizeOptions = (value: unknown) =>
  jsonArray(value)
    .map((item) => {
      const row = jsonObject(item);
      const optionValue = asString(row.value, 60) || asString(row.label, 60);
      const label = asString(row.label, 60) || optionValue;
      return optionValue ? { label, value: optionValue } : null;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item))
    .slice(0, 100);

export const normalizeField = (
  row: Record<string, unknown>,
): OaField | null => {
  const key = asString(row.key, 40);
  if (!key) return null;
  const type = asString(row.type, 20) || 'text';
  const options = normalizeOptions(row.options);
  // 默认值来自表单设计器的 JSON，按契约收紧到 string | number | boolean | string[]
  const fieldDefault = oaFieldSchema.shape.default.safeParse(row.default);
  return {
    key,
    label: asString(row.label, 60) || key,
    type: type as OaField['type'],
    required: row.required === true,
    placeholder: asString(row.placeholder, 120),
    help: asString(row.help, 200),
    ...(fieldDefault.success && fieldDefault.data !== undefined
      ? { default: fieldDefault.data }
      : {}),
    options: OPTION_TYPES.has(type) ? options : [],
    visibleWhen: normalizeCondition(row.visibleWhen),
    refTarget: asString(row.refTarget, 32),
    columns:
      type === 'list'
        ? jsonArray(row.columns)
            .map((item) => {
              const column = jsonObject(item);
              const columnKey = asString(column.key, 40);
              if (!columnKey) return null;
              const columnType = asString(column.type, 20) || 'text';
              const safeType: OaListColumn['type'] = LIST_COLUMN_TYPES.has(
                columnType,
              )
                ? (columnType as OaListColumn['type'])
                : 'text';
              return {
                key: columnKey,
                label: asString(column.label, 60) || columnKey,
                type: safeType,
                required: column.required === true,
                options: normalizeOptions(column.options),
              };
            })
            .filter((item): item is OaField['columns'][number] => Boolean(item))
            .slice(0, 30)
        : [],
  };
};

export const normalizeAiPreReview = (
  value: unknown,
): OaFlowNode['aiPreReview'] => {
  const row = jsonObject(value);
  return {
    enabled: row.enabled === true,
    personaId: int(row.personaId, 0),
    principles: asString(row.principles, 2000),
    personaName: asString(row.personaName, 30),
    personaStyle: asString(row.personaStyle, 32),
    personaText: asString(row.personaText, 500),
  };
};

export const normalizeNode = (
  row: Record<string, unknown>,
): OaFlowNode | null => {
  const approverType = asString(row.approverType, 20) || 'MEMBER';
  const mode = asString(row.mode, 20) || 'ANY';
  return {
    name: asString(row.name, 60) || '审批',
    approverType: approverType as OaFlowNode['approverType'],
    userIds: asArray(row.userIds).slice(0, 50),
    roles: asArray(row.roles).slice(0, 20),
    department: asString(row.department, 64),
    positions: asArray(row.positions).slice(0, 20),
    aiPreReview: normalizeAiPreReview(row.aiPreReview),
    mode: mode as OaFlowNode['mode'],
    condition: normalizeCondition(row.condition),
    emptyAction: (asString(row.emptyAction, 20) ||
      'SKIP') as OaFlowNode['emptyAction'],
    ccUserIds: asArray(row.ccUserIds).slice(0, 50),
    remindAfterHours: Math.min(Math.max(int(row.remindAfterHours, 24), 0), 720),
  };
};

export const normalizeLinkage = (
  row: Record<string, unknown>,
): OaLinkageRule | null => {
  const action = asString(row.action, 20) || 'LOG';
  return {
    on: (asString(row.on, 20) || 'APPROVED') as OaLinkageRule['on'],
    target: asString(row.target, 32) || 'LINKED',
    action: action as OaLinkageRule['action'],
    params: jsonObject(row.params),
  };
};

/** 条件为空＝恒成立；字段名与算子做白名单收窄，避免脏快照影响推进。 */
export const normalizeCondition = (value: unknown): OaCondition | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const field = asString(row.field, 40);
  if (!field) return null;
  const op = asString(row.op, 12) || 'gte';
  const raw = row.value;
  return {
    field,
    op: op as OaCondition['op'],
    value: typeof raw === 'number' ? raw : asString(raw, 60),
  };
};

export const roleLabel = (code: string) =>
  text(ORG_BUSINESS_SCOPE_LABELS[code]) || code;

/** 主金额：顶层金额字段优先，其次取明细子表金额列合计。 */
export const amountOf = (
  formData: Record<string, unknown>,
  fields: OaField[],
) => {
  for (const field of fields) {
    if (field.type !== 'amount') continue;
    const direct = num(formData[field.key], NaN);
    if (Number.isFinite(direct) && direct !== 0) return round(direct);
  }
  let total = 0;
  for (const field of fields) {
    if (field.type !== 'list') continue;
    const rows = jsonArray(formData[field.key]);
    const amountKeys = field.columns
      .filter((column) => column.type === 'amount')
      .map((column) => column.key);
    for (const item of rows) {
      const row = jsonObject(item);
      for (const key of amountKeys) total += num(row[key]);
    }
  }
  return round(total);
};

/** 条件求值：只用 amount 与 select / radio 字段，不做任意表达式。 */
export const conditionHit = (
  condition: OaCondition | null | undefined,
  resolveValue: (field: string) => unknown,
  amount: number,
) => {
  if (!condition || !condition.field) return true;
  const left =
    condition.field === 'amount' ? amount : resolveValue(condition.field);
  const right = condition.value;
  const op = condition.op;
  if (op === 'contains') {
    return text(left).includes(text(right));
  }
  const leftNumber = num(left, NaN);
  const rightNumber = num(right, NaN);
  const bothNumeric =
    Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  if (bothNumeric) {
    switch (op) {
      case 'gt':
        return leftNumber > rightNumber;
      case 'gte':
        return leftNumber >= rightNumber;
      case 'lt':
        return leftNumber < rightNumber;
      case 'lte':
        return leftNumber <= rightNumber;
      case 'neq':
        return leftNumber !== rightNumber;
      default:
        return leftNumber === rightNumber;
    }
  }
  const leftText = text(left);
  const rightText = text(right);
  const order = leftText.localeCompare(rightText);
  switch (op) {
    case 'gt':
      return order > 0;
    case 'gte':
      return order >= 0;
    case 'lt':
      return order < 0;
    case 'lte':
      return order <= 0;
    case 'neq':
      return leftText !== rightText;
    default:
      return leftText === rightText;
  }
};

/**
 * ref 字段是否真的选到了对象：带目标 id 才算，空壳不算。
 * 与 `oa.linkage.ts` 的 `refsOfField` 同口径（对象取 id/targetId，数组取第一个有值的，裸字符串直接用）。
 */
export const refIdOf = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => refIdOf(item)).find((item) => item) || '';
  }
  const row = jsonObject(value);
  if (Object.keys(row).length) return text(row.id ?? row.targetId).trim();
  return text(value).trim();
};

/** 提交校验：只按可见字段判必填，草稿不校验。 */
export const missingRequired = (
  fields: OaField[],
  formData: Record<string, unknown>,
  amount: number,
) => {
  const missing: string[] = [];
  for (const field of fields) {
    const visible = conditionHit(
      field.visibleWhen,
      (name) => formData[name],
      amount,
    );
    if (!visible || !field.required) continue;
    const value = formData[field.key];
    if (
      field.type === 'list' ||
      field.type === 'multiSelect' ||
      field.type === 'attachment'
    ) {
      if (!jsonArray(value).length) missing.push(field.label);
      continue;
    }
    if (field.type === 'checkbox') {
      if (value !== true) missing.push(field.label);
      continue;
    }
    if (field.type === 'number' || field.type === 'amount') {
      if (!Number.isFinite(num(value, NaN))) missing.push(field.label);
      continue;
    }
    if (field.type === 'ref') {
      if (!refIdOf(value)) missing.push(field.label);
      continue;
    }
    if (!text(value).trim()) missing.push(field.label);
  }
  return missing;
};

export const csvCell = (value: unknown) => {
  const raw = text(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
};

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

/** 一次导出的行数上限，超出只导前 N 行并在末尾给截断说明。 */
export const EXPORT_LIMIT = 5000;

/**
 * 时间筛选边界：`YYYY-MM-DD` 按自然日取当日首/末刻（与 OKR 一样用 UTC 零点，
 * 避免东八区偏移把日期退一天）；带时间的原样解析，解析失败返回 null 表示不加这层过滤。
 */
export const dateEdge = (value: unknown, endOfDay: boolean) => {
  const raw = asString(value, 24).trim();
  if (!raw) return null;
  const parsed = new Date(
    raw.length === 10
      ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
      : raw,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const statusLabel = (labels: Record<string, string>, code: string) =>
  text(labels[code]) || code;
