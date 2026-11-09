import type { Prisma } from '../../generated/prisma';

export type Row = Record<string, unknown>;

export type PageQuery = { page: number; pageSize: number };

export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

export const today = () => new Date().toISOString().slice(0, 10);

export const OPEN_TASK_STATUSES = ['TODO', 'DOING', 'REVIEW'];
