"use client";

import { HistoryOutlined, StopOutlined } from "@ant-design/icons";
import { App, Button, Input, Select, Table, Tooltip } from "antd";
import { useState } from "react";
import type { WorkflowRun, WorkflowRunStep } from "@enterprise/contracts";
import {
  WORKFLOW_RUN_STATUS_LABELS,
  WORKFLOW_RUN_STATUSES,
} from "@enterprise/contracts";

type RunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
import { EmptyState, Notice } from "@/components/ui/panel";
import { workflowApi } from "@/api/workflow";
import { resolveStatus } from "@/lib/status";
import { useBusinessMutation, useBusinessQuery } from "@/query/business";

/** 运行状态可取消：终态不可再改。 */
const CANCELABLE = new Set(["PENDING", "RUNNING", "WAITING"]);

function zhTime(value: string | null) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

function durationText(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** 运行用量摘要：AI 调用 / token / 工具 / 浏览器动作 / 节点，都为 0 时显示占位。 */
function usageText(row: WorkflowRun): string {
  const usage = row.usage;
  if (!usage) return "—";
  const tokens = usage.tokenIn + usage.tokenOut;
  const parts = [
    usage.nodes ? `${usage.nodes} 节点` : "",
    usage.aiCalls ? `${usage.aiCalls} 次 AI` : "",
    tokens ? `${tokens} tokens` : "",
    usage.toolCalls ? `${usage.toolCalls} 次工具` : "",
    usage.browserActions ? `${usage.browserActions} 次浏览器` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function stepStatus(step: WorkflowRunStep) {
  const spec = resolveStatus("workflowRun", step.status);
  return (
    <span className={`badge badge-${spec.variant}`}>
      {WORKFLOW_RUN_STATUS_LABELS[step.status] || spec.label}
    </span>
  );
}

/**
 * 运行记录（只出正文）：并进「工作流」面板的「运行记录」子视图——按工作流 / 状态 / 业务关联分页，
 * 可见范围与工作流一致（本人 / 本主体共享 / 管理员），等待或运行中的可取消。
 * 面板外壳与「新建工作流」按钮由宿主（Agent 工作流页签）的 Panel 统一提供，本组件只出筛选行 + 表格。
 */
export function WorkflowRunsBody() {
  const { message, modal } = App.useApp();
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const [status, setStatus] = useState<RunStatus | "">("");
  const [sourceId, setSourceId] = useState("");
  const [cancelingId, setCancelingId] = useState<number | null>(null);

  const query = {
    page: paging.page,
    pageSize: paging.pageSize,
    ...(status ? { status } : {}),
    ...(sourceId.trim() ? { sourceId: sourceId.trim() } : {}),
  };
  const listQuery = useBusinessQuery("workflow-runs", "list", query, (signal) =>
    workflowApi.runList({ query }, { signal }),
  );
  const rows: WorkflowRun[] = listQuery.data?.list || [];
  const total = listQuery.data?.total || 0;

  const cancelMutation = useBusinessMutation(
    (input: { params: { runId: string } }) => workflowApi.runCancel(input),
    ["workflow-runs"],
  );

  const resetPage = () => setPaging((prev) => ({ ...prev, page: 1 }));

  const cancel = (row: WorkflowRun) => {
    modal.confirm({
      title: "取消运行",
      content: `运行 #${row.id}（${row.workflowName}）将停止推进；已完成的步骤保留。`,
      okText: "确认取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelingId(row.id);
        try {
          await cancelMutation.mutateAsync({ params: { runId: String(row.id) } });
          message.success("运行已取消");
        } finally {
          setCancelingId(null);
        }
      },
    });
  };

  return (
    <div className="table-wrap">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Select
            value={status}
            style={{ width: 130 }}
            onChange={(value) => {
              resetPage();
              setStatus(value);
            }}
            options={[
              { value: "", label: "全部状态" },
              ...WORKFLOW_RUN_STATUSES.map((value) => ({
                value,
                label: WORKFLOW_RUN_STATUS_LABELS[value],
              })),
            ]}
          />
          <Input.Search
            allowClear
            style={{ width: 220 }}
            placeholder="按业务主键反查（如单据号）"
            onSearch={(value) => {
              resetPage();
              setSourceId(value);
            }}
          />
        </div>
      </div>
      {listQuery.error && (
        <Notice variant="error">
          运行记录加载失败：{listQuery.error.message}
        </Notice>
      )}
        <Table<WorkflowRun>
          rowKey="id"
          loading={listQuery.isPending}
          dataSource={rows}
          pagination={{
            current: paging.page,
            pageSize: paging.pageSize,
            total,
            onChange: (page, pageSize) => setPaging({ page, pageSize }),
          }}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<HistoryOutlined aria-hidden />}
                text="还没有运行记录：在画布里试跑或发布后由触发器发起，这里按时间倒序留痕"
              />
            ),
          }}
          columns={[
            {
              title: "运行",
              width: 220,
              render: (_: unknown, row: WorkflowRun) => (
                <div>
                  <div style={{ fontWeight: 600 }}>#{row.id}</div>
                  <div
                    className="text-12 muted"
                    title={row.workflowName}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.workflowName} · v{row.version}
                  </div>
                </div>
              ),
            },
            {
              title: "触发方式",
              dataIndex: "triggerLabel",
              width: 100,
              render: (value: string, row: WorkflowRun) => (
                <span className="text-12">{value || row.trigger}</span>
              ),
            },
            {
              title: "状态",
              dataIndex: "statusLabel",
              width: 110,
              render: (_: unknown, row: WorkflowRun) => (
                <span
                  className={`badge badge-${resolveStatus("workflowRun", row.status).variant}`}
                >
                  {row.statusLabel ||
                    resolveStatus("workflowRun", row.status).label}
                </span>
              ),
            },
            {
              title: "关联业务",
              width: 170,
              render: (_: unknown, row: WorkflowRun) =>
                row.sourceType || row.sourceId ? (
                  <div className="text-12">
                    <div>{row.sourceType || "—"}</div>
                    <div className="muted">{row.sourceId || "—"}</div>
                  </div>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              title: "步骤 / 耗时",
              width: 130,
              render: (_: unknown, row: WorkflowRun) => (
                <div className="text-12">
                  <div>{row.steps.length} 步</div>
                  <div className="muted">
                    {durationText(row.startedAt, row.finishedAt)}
                  </div>
                </div>
              ),
            },
            {
              title: "用量 / 预算",
              width: 200,
              render: (_: unknown, row: WorkflowRun) => (
                <div className="text-12">
                  <div>{usageText(row)}</div>
                  {row.budgetStop && row.budgetStop !== "NONE" ? (
                    <span className="badge badge-orange" style={{ marginTop: 2 }}>
                      超预算 · {row.budgetStopLabel || row.budgetStop}
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              title: "开始时间",
              dataIndex: "startedAt",
              width: 150,
              render: (value: string | null) => (
                <span className="text-12">{zhTime(value)}</span>
              ),
            },
            {
              title: "操作",
              width: 100,
              render: (_: unknown, row: WorkflowRun) =>
                CANCELABLE.has(row.status) ? (
                  <Tooltip title="停止推进，已完成步骤保留">
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={cancelingId === row.id}
                      onClick={() => cancel(row)}
                    >
                      取消
                    </Button>
                  </Tooltip>
                ) : (
                  <span className="muted">—</span>
                ),
            },
          ]}
          expandable={{
            rowExpandable: (row) => row.steps.length > 0,
            expandedRowRender: (row) => (
              <Table<WorkflowRunStep>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={row.steps}
                columns={[
                  {
                    title: "节点",
                    dataIndex: "nodeId",
                    width: 200,
                    render: (value: string, step: WorkflowRunStep) => (
                      <div>
                        <span className="text-12">{value}</span>
                        <span className="text-12 muted"> · {step.nodeType}</span>
                      </div>
                    ),
                  },
                  {
                    title: "状态",
                    width: 100,
                    render: (_: unknown, step: WorkflowRunStep) =>
                      stepStatus(step),
                  },
                  {
                    title: "尝试",
                    dataIndex: "attempts",
                    width: 60,
                  },
                  {
                    title: "耗时",
                    width: 90,
                    render: (_: unknown, step: WorkflowRunStep) =>
                      step.durationMs < 1000
                        ? `${step.durationMs} ms`
                        : `${(step.durationMs / 1000).toFixed(1)} s`,
                  },
                  {
                    title: "错误",
                    dataIndex: "error",
                    render: (value: string) =>
                      value ? (
                        <span className="text-12" style={{ color: "var(--red)" }}>
                          {value}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      ),
                  },
                ]}
              />
            ),
          }}
        />
    </div>
  );
}
