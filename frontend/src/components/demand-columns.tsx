"use client";

import type { TablePaginationConfig } from "antd";
import type { ColumnsType } from "antd/es/table";

/** 需求消息列表分页：各板块共用同一口径（10 条/页，可切换页大小）。 */
export const demandPagination: TablePaginationConfig = {
  pageSize: 10,
  pageSizeOptions: [10, 20, 50],
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
};

/**
 * 需求内容字段：口径 = AIworkin 需求模型（需求文档 §7.3 的结构化字段）。
 * 列表只展示最小集合（`demandColumns`），其余字段进「查看消息」弹窗明细（`demandDetails`）。
 */
export type DemandFields = {
  /** 本地需求单号（AIworkin 未接通时的过渡主键） */
  orderNo?: string;
  /** AIworkin 平台需求编号 platform_listing_id */
  listingId?: string;
  /** 一级类目 */
  category1?: string;
  /** 二级类目 */
  category2?: string;
  /** 板块内细项（如IT服务的 AI实施/软件开发）：并进「类目」列显示，不单开列 */
  subItem?: string;
  title?: string;
  description?: string;
  tags?: string;
  budget?: string;
  expectedOutcome?: string;
  mustHaves?: string;
  startAt?: string;
  deadline?: string;
  regionScope?: string;
  contactName?: string;
  contactPhone?: string;
  contactWechat?: string;
  contactEmail?: string;
  /** 执行方（承办服务商/职员）联系方式：系统按承办人档案自动带出 */
  providerContactName?: string;
  providerContactPhone?: string;
  emailSync?: boolean | number | string;
  createdAt?: string;
};

function text(value?: string) {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

function emailSyncLabel(value?: boolean | number | string) {
  return value === true || value === 1 || value === "1" || value === "true"
    ? "发送"
    : "不发送";
}

function contactLines(fields: DemandFields) {
  const lines = [
    fields.contactName,
    fields.contactPhone,
    fields.contactWechat,
    fields.contactEmail,
  ].filter((item) => String(item ?? "").trim());
  return lines.length ? lines.join(" / ") : "—";
}

/** 需求创建时间：全站同一渲染口径。 */
function timeText(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

/**
 * 需求列表列（最小集合，全板块一致）：需求编号 / 需求标题 / 类目 / 创建时间。
 * 各页只在其后追加「操作」列。
 */
export function demandColumns<T>(
  get: (row: T) => DemandFields,
): ColumnsType<T> {
  return [
    {
      title: "需求编号",
      width: 150,
      render: (_, row) => {
        const fields = get(row);
        return (
          <span className="mono">{text(fields.listingId || fields.orderNo)}</span>
        );
      },
    },
    {
      title: "需求标题",
      width: 220,
      ellipsis: true,
      render: (_, row) => text(get(row).title),
    },
    {
      title: "类目（一级 / 二级）",
      width: 170,
      render: (_, row) => {
        const fields = get(row);
        const parts = [
          fields.category1,
          fields.category2,
          fields.subItem,
        ].filter((item) => String(item ?? "").trim());
        return (
          <span className="text-12">{parts.length ? parts.join(" / ") : "—"}</span>
        );
      },
    },
    {
      title: "创建时间",
      width: 160,
      render: (_, row) => (
        <span className="text-12">{timeText(get(row).createdAt)}</span>
      ),
    },
  ];
}

/** 「查看消息」弹窗里的需求内容明细（列表收敛掉的字段全部在此可见）。 */
export function demandDetails(fields: DemandFields) {
  const providerContact = [
    fields.providerContactName,
    fields.providerContactPhone,
  ].filter((item) => String(item ?? "").trim());
  return [
    { label: "详细说明", value: text(fields.description) },
    { label: "标签", value: text(fields.tags) },
    { label: "预算", value: text(fields.budget) },
    { label: "期望结果", value: text(fields.expectedOutcome) },
    { label: "必须满足条件", value: text(fields.mustHaves) },
    { label: "期望开始时间", value: text(fields.startAt) },
    { label: "截止时间", value: text(fields.deadline) },
    { label: "地域范围", value: text(fields.regionScope) },
    {
      label: "联系方式（联系人/手机/微信/邮箱）",
      value: contactLines(fields),
    },
    {
      label: "执行方联系方式",
      value: providerContact.length ? providerContact.join(" · ") : "—",
    },
    { label: "邮箱同步", value: emailSyncLabel(fields.emailSync) },
  ];
}
