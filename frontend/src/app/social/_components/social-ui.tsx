"use client";

import { Avatar } from "antd";
import type { PersonBrief } from "@/api/social";

/**
 * 社交板块共用视觉件：头像占位（无图时按昵称取色 + 首字）、时间格式化。
 * 只服务于 `/social` 下各页签，不改变任何数据口径。
 */

const AVATAR_COLORS = ["#1677ff", "#7c3aed", "#0891b2", "#059669", "#d97706", "#db2777"];

/**
 * 简历条目类型字典：编辑页（下拉选项）与 HTML 打印版（分组标题与顺序）共用一份，
 * 免得两处各自维护后标签漂移。
 */
export const RESUME_KIND_OPTIONS = [
  { value: "WORK", label: "工作" },
  { value: "EDU", label: "教育" },
  { value: "PROJECT", label: "项目" },
  { value: "SKILL", label: "技能" },
  { value: "CERT", label: "证书" },
  { value: "HONOR", label: "荣誉" },
];
export const RESUME_KIND_LABELS: Record<string, string> = Object.fromEntries(
  RESUME_KIND_OPTIONS.map((kind) => [kind.value, kind.label]),
);
/** 打印版的分组顺序；字典里没有的类型排末尾，照原样显示。 */
export const RESUME_KIND_ORDER = RESUME_KIND_OPTIONS.map((kind) => kind.value);

function initialsOf(name: string) {
  const text = (name || "").trim();
  if (!text) return "?";
  return /^[\u4e00-\u9fa5]/.test(text) ? text.slice(-2) : text.slice(0, 2).toUpperCase();
}

function colorOf(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** 人像：有 avatar 用图片，否则使用昵称取的品牌色块（组名/人名都可）。 */
export function PersonAvatar({
  person,
  name,
  size = 40,
  shape = "circle",
}: {
  person?: PersonBrief | null;
  name?: string;
  size?: number;
  shape?: "circle" | "square";
}) {
  const label = person?.displayName || person?.username || name || "";
  const src = person?.avatar || undefined;
  return (
    <Avatar
      size={size}
      shape={shape}
      src={src}
      style={src ? undefined : { backgroundColor: colorOf(label || "?"), fontSize: Math.round(size * 0.38) }}
    >
      {src ? undefined : initialsOf(label)}
    </Avatar>
  );
}

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / 昨天 / n 天前 / 日期。 */
export function fmtRelative(iso: string) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

/** 完整时间（会话/楼层里的精确时间）。 */
export function fmtDateTime(iso: string) {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? "" : new Date(time).toLocaleString("zh-CN");
}

/** 年份区间：2020 - 2023 / 2020 - 至今。 */
export function fmtYears(startYear: number | null, endYear: number | null) {
  if (!startYear) return "";
  return `${startYear} - ${endYear || "至今"}`;
}