"use client";

import { Button, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  OUTCOME_OPTIONS,
  memoryApi,
  paramsSummary,
  targetText,
  type AgentEvent,
  type AgentOverview,
} from "./common";

const PAGE_SIZE = 20;

type Filters = { domain?: string; outcome?: string; channel?: string };

/**
 * 操作记录：本账号的意图事件流，可按业务域 / 结果 / 通道筛选、分页翻看。
 * 展开一行看参数摘要原文与未成功原因；口令一类凭据在后端已脱敏，这里只可能是「[已脱敏]」。
 */
export function EventPanel({ stats }: { stats: AgentOverview | null }) {
  const [rows, setRows] = useState<AgentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await memoryApi.events({ page, pageSize: PAGE_SIZE, ...filters });
    setRows(result.data?.list ?? []);
    setTotal(result.data?.total ?? 0);
    setError(result.message);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const domainOptions = (stats?.byDomain ?? []).map((item) => ({
    value: item.domain,
    label: `${item.label}（${item.count}）`,
  }));
  const channelOptions = (stats?.byChannel ?? []).map((item) => ({
    value: item.channel,
    label: item.label,
  }));
  const hasFilter = Boolean(filters.domain || filters.outcome || filters.channel);

  const columns: ColumnsType<AgentEvent> = [
    {
      title: "时间",
      dataIndex: "occurredAt",
      key: "occurredAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "业务域",
      dataIndex: "domainLabel",
      key: "domainLabel",
      width: 120,
    },
    { title: "动作", dataIndex: "actionLabel", key: "actionLabel", width: 140 },
    {
      title: "对象",
      key: "target",
      ellipsis: true,
      render: (_, row) => targetText(row),
    },
    {
      title: "参数摘要",
      key: "params",
      ellipsis: true,
      render: (_, row) => paramsSummary(row.params),
    },
    {
      title: "结果",
      dataIndex: "outcomeLabel",
      key: "outcomeLabel",
      width: 90,
      render: (value: string, row) => (
        <Tag color={row.outcome === "ok" ? "green" : undefined}>{value}</Tag>
      ),
    },
    { title: "通道", dataIndex: "channelLabel", key: "channelLabel", width: 80 },
  ];

  return (
    <Panel
      title="操作记录"
      extra={
        <Space size={8} wrap>
          {domainOptions.length > 1 ? (
            <Select
              allowClear
              placeholder="业务域"
              style={{ minWidth: 150 }}
              options={domainOptions}
              value={filters.domain}
              onChange={(value) => {
                setPage(1);
                setFilters((current) => ({ ...current, domain: value }));
              }}
            />
          ) : null}
          <Select
            allowClear
            placeholder="结果"
            style={{ minWidth: 110 }}
            options={OUTCOME_OPTIONS}
            value={filters.outcome}
            onChange={(value) => {
              setPage(1);
              setFilters((current) => ({ ...current, outcome: value }));
            }}
          />
          {channelOptions.length > 1 ? (
            <Select
              allowClear
              placeholder="通道"
              style={{ minWidth: 110 }}
              options={channelOptions}
              value={filters.channel}
              onChange={(value) => {
                setPage(1);
                setFilters((current) => ({ ...current, channel: value }));
              }}
            />
          ) : null}
          {hasFilter ? (
            <Button
              type="link"
              onClick={() => {
                setPage(1);
                setFilters({});
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </Space>
      }
    >
      {error ? (
        <Notice variant="error">{`操作记录加载失败：${error}`}</Notice>
      ) : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: <EmptyState text="还没有操作记录" /> }}
        expandable={{
          columnWidth: 40,
          rowExpandable: (row) =>
            Boolean(row.errorMessage) || Object.keys(row.params || {}).length > 0,
          expandedRowRender: (row) => (
            <div className="text-12" style={{ lineHeight: 1.8 }}>
              <div>{`参数：${JSON.stringify(row.params)}`}</div>
              {row.errorMessage ? (
                <div>{`未成功原因：${row.errorCode} ${row.errorMessage}`}</div>
              ) : null}
            </div>
          ),
        }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
      />
    </Panel>
  );
}
