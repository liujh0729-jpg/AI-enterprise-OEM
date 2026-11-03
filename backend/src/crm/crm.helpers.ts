import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';

export const money = (value: unknown, fallback = '0') => {
  const raw = text(value, fallback).replace(/[,，\s¥￥]/g, '');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return new Prisma.Decimal(fallback);
  return new Prisma.Decimal(parsed.toFixed(2));
};

export const num = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const moneyStr = (value: unknown) =>
  value === null || value === undefined
    ? '0.00'
    : new Prisma.Decimal(value as never).toFixed(2);

export const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : '';
export const dateOrNull = (value: unknown) => {
  const raw = text(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};
export const bool = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback;
export const int = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
export const asArray = (value: unknown): string[] => {
  if (Array.isArray(value))
    return value.map((item) => text(item)).filter(Boolean);
  const raw = text(value).trim();
  return raw ? raw.split(/[,，\s]+/).filter(Boolean) : [];
};
export const jsonArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
export const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const normPhone = (value: unknown) =>
  text(value)
    .replace(/[^\d+]/g, '')
    .replace(/^\+?86/, '');
export const normEmail = (value: unknown) => text(value).trim().toLowerCase();
export const normName = (value: unknown) =>
  text(value)
    .trim()
    .toLowerCase()
    .replace(/[\s（）()·.]/g, '');

export const maskPhone = (value: string) =>
  value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : '***';
export const maskEmail = (value: string) => {
  const at = value.indexOf('@');
  return at > 0 ? `${value.slice(0, 1)}***${value.slice(at)}` : '***';
};

export const canSeePlain = (
  role: string,
  actorId: string,
  ownerId: string,
  kind: 'CONTACT' | 'FINANCE',
) => {
  if (role === 'ADMIN' || role === 'MANAGER') return true;
  if (role === 'FINANCE') return kind === 'FINANCE';
  if (role === 'SALES') return ownerId === actorId;
  return false;
};

export const csvEscape = (value: unknown) => {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
  // 防止 Excel 把 = + - @ 开头的内容当公式执行（CSV 注入）
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
) =>
  `\uFEFF${[
    columns.map((column) => csvEscape(column.label)).join(','),
    ...rows.map((row) =>
      columns.map((column) => csvEscape(row[column.key])).join(','),
    ),
  ].join('\r\n')}`;

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: '待提交',
  APPROVING: '审批中',
  APPROVED: '已通过',
  UNAPPROVED: '已驳回',
  REVOKED: '已撤回',
  '': '未提交',
};
export const statusLabel = (value: string) =>
  APPROVAL_STATUS_LABELS[value] ?? value;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: '负责人',
  MANAGER: '主管',
  SALES: '销售',
  FINANCE: '财务',
  READONLY: '只读',
  '': '未授权',
};
export const SCOPE_LABELS: Record<string, string> = {
  ALL: '本账号全部',
  DEPT: '本部门',
  SELF: '本人负责',
};
export const LEAD_STAGE_LABELS: Record<string, string> = {
  NEW: '新建',
  FOLLOWING: '跟进中',
  INTERESTED: '感兴趣',
  SUCCESS: '成功',
  FAIL: '失败',
};
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  PARTIAL: '部分完成',
  DONE: '已完成',
};
export const FOLLOW_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  CANCELLED: '已取消',
};
export const FORM_TYPE_LABELS: Record<string, string> = {
  LEAD: '线索',
  CUSTOMER: '客户',
  OPPORTUNITY: '商机',
  QUOTATION: '报价',
  CONTRACT: '销售合同',
  INVOICE: '发票',
  ORDER: '订单',
  CUSTOM: '自定义',
};
export const INVOICE_TYPE_LABELS: Record<string, string> = {
  SPECIAL: '增值税专用发票',
  NORMAL: '增值税普通发票',
};
export const COLLAB_TYPE_LABELS: Record<string, string> = {
  READ_ONLY: '只读',
  COLLABORATION: '协作',
};
export const RELATION_TYPE_LABELS: Record<string, string> = {
  GROUP: '集团',
  SUBSIDIARY: '子公司',
};
