"use client";

import { Button, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { gapsApi, type TimeAuditRow, type TimeAuditSummary } from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

/** B3#21 工时修改审计：逐次留痕 edit/delete/approve/reject 与修改前后差值，按人汇总。 */
export function GapsTimeAuditTab() {
  const [mode, setMode] = useState<"edits" | "summary">("edits");
  const [rows, setRows] = useState<TimeAuditRow[]>([]);
  const [summary, setSummary] = useState<TimeAuditSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadEdits = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.timeAuditEdits({
        query: { page, pageSize: 20, action: action || undefined },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      setSummary((await gapsApi.timeAuditSummary({ query: { days: 30 } })) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "edits") void loadEdits();
    else void loadSummary();
  }, [mode, loadEdits, loadSummary]);

  const diffOf = (row: TimeAuditRow) => {
    const before = JSON.stringify(row.before || {}, null, 2);
    const after = JSON.stringify(row.after || {}, null, 2);
    return `修改前：${before}\n修改后：${after}`;
  };

  const editColumns: ColumnsType<TimeAuditRow> = [
    {
      title: "操作",
      width: 110,
      render: (_, row) =>
        row.action === "DELETE" ? (
          <Tag color="red">{row.actionLabel || "删除"}</Tag>
        ) : (
          <Tag color="blue">{row.actionLabel || row.action}</Tag>
        ),
    },
    { title: "工时记录", width: 100, render: (_, row) => `#${row.timeLogId}` },
    { title: "操作人", dataIndex: "editorId", width: 160, ellipsis: true },
    { title: "事由", dataIndex: "reason", ellipsis: true },
    { title: "时间", width: 160, render: (_, row) => zhTime(row.createdAt) },
  ];

  const summaryColumns: ColumnsType<TimeAuditSummary> = [
    { title: "操作人", dataIndex: "editorId", ellipsis: true },
    { title: "修改次数", width: 110, render: (_, row) => `${row.edits} 次` },
    { title: "删除次数", width: 110, render: (_, row) => `${row.deletes} 次` },
    {
      title: "工时增减",
      width: 120,
      render: (_, row) => (
        <span style={{ color: row.minutesDelta >= 0 ? "#1a7f37" : "#c62828", fontWeight: 600 }}>
          {row.minutesDelta > 0 ? "+" : ""}
          {row.minutesDelta} 分钟
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="工时修改审计"
      titleExtra="每次修改 / 删除工时都留痕（前后值与事由）；近 30 天按操作人汇总，供审批与抽查"
      extra={
        <Button
          onClick={() => setMode(mode === "edits" ? "summary" : "edits")}
        >
          {mode === "edits" ? "查看汇总" : "查看明细"}
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {mode === "edits" ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Select
              allowClear
              placeholder="按操作筛选"
              style={{ width: 180 }}
              value={action || undefined}
              onChange={(value) => {
                setAction(value || "");
                setPage(1);
              }}
              options={[
                { value: "UPDATE", label: "修改" },
                { value: "DELETE", label: "删除" },
                { value: "APPROVE", label: "审批通过" },
                { value: "REJECT", label: "审批驳回" },
              ]}
            />
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={editColumns}
            dataSource={rows}
            scroll={{ x: 820 }}
            expandable={{
              expandedRowRender: (row) => (
                <pre className="text-12" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {diffOf(row)}
                </pre>
              ),
            }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
        </>
      ) : (
        <Table
          rowKey="editorId"
          size="small"
          loading={loading}
          columns={summaryColumns}
          dataSource={summary}
          pagination={false}
        />
      )}
    </Panel>
  );
}
