import { randomBytes } from 'node:crypto';

import type { HrmOrg } from '../hrm/hrm.scope';

import { Logger } from '../common/logger';

import type { Prisma } from '../../generated/prisma';

export const logger = new Logger('MechanismService');

export type Row = Record<string, unknown>;

export type PageQuery = { page: number; pageSize: number };

export type MechanismListener = (
  org: HrmOrg,
  event: string,
  payload: Row,
  /** 事件台账 id：订阅方拿它做幂等锚，同一事件重复投递不会重复执行。 */
  meta?: { eventLogId: number },
) => Promise<void> | void;

export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export type Operator =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'exists';

export type Condition = {
  field: string;
  op: Operator;
  value: unknown;
};

export const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

export const csvCell = (v: unknown): string => {
  const cell = text(v);
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};

export const slug = () => randomBytes(8).toString('hex');

export function evalCondition(c: Condition, context: Row): boolean {
  const actual = context[c.field];
  const actualText = text(actual);
  const expected = c.value;
  switch (c.op) {
    case 'eq':
      return actualText === text(expected);
    case 'neq':
      return actualText !== text(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      return actualText.includes(text(expected));
    case 'in':
      return Array.isArray(expected)
        ? expected.map(String).includes(actualText)
        : false;
    case 'exists':
      return expected === false
        ? actual === undefined || actual === null
        : actual !== undefined && actual !== null;
    default:
      return false;
  }
}
