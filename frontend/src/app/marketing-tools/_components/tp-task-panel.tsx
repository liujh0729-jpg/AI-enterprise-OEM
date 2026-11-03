"use client";

import { ExportOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { tpApi } from "@/api/tp";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  TP_CONSOLE_URL,
  TP_STATUS_COLOR,
  load,
  tpActionLabel,
  tpProductLabel,
  tpStatusLabel,
  type TpTask,
  type TpTaskDetail,
} from "./tp-common";
import { TpObjectView } from "./tp-ui";

/**
 * 企点任务台账：写类动作都落在这里（排队中/执行中/已完成/部分完成/失败），
 * 展开看逐批事件；失败或部分完成可以按台账里的名单与映射重跑一次。
 */

const PAGE_SIZE = 20;

/**
 * 写 CRM 的动作不出网、也不落企点任务号，重跑等于回页签重新预检，所以这一类不给重试按钮；
 * 仍在排队的任务不给重复提交（重复提交会二次消耗额度）。
 */
function retryDisabledReason(task: TpTask): string {
  if (task.status === "PENDING" || task.status === "RUNNING") {
    return "任务仍在执行中，等它结束再重试";
  }
  return "";
}

export function TpTaskPanel({
  products = [],
  onReloaded,
  tabs,
  title = "任务台账",
}: {
  /** 只看这几类产品的任务；空＝全部。 */
  products?: string[];
  onReloaded?: (count: number) => void;
  /** 卡片内的页签条：贴面板标题行最右。 */
  tabs?: ReactNode;
  /** 面板标题：三张企点卡都用各自的工具名。 */
  title?: string;
}) {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<TpTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<Record<number, TpTaskDetail>>({});
  const [retrying, setRetrying] = useState(0);

  const reload = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      const result = await load(
        tpApi.tasks({ query: { page: nextPage, pageSize: PAGE_SIZE } }),
      );
      if (result.data) {
        setTasks(
          products.length
            ? result.data.list.filter((item) => products.includes(item.product))
            : result.data.list,
        );
        setTotal(result.data.total);
        setError("");
        onReloaded?.(result.data.total);
      } else {
        setTasks([]);
        setTotal(0);
        setError(result.message || "企点任务台账读取失败");
      }
      setLoading(false);
    },
    [page, products, onReloaded],
  );

  useEffect(() => {
    void reload(page);
  }, [reload, page]);

  const openDetail = async (id: number) => {
    if (details[id]) return;
    const result = await load(tpApi.taskDetail({ params: { id: String(id) } }));
    if (result.data) {
      setDetails((prev) => ({ ...prev, [id]: result.data as TpTaskDetail }));
    } else {
      message.error(result.message || "任务详情读取失败");
    }
  };

  const retry = async (task: TpTask) => {
    setRetrying(task.id);
    const result = await load(tpApi.retryTask({ params: { id: String(task.id) } }));
    setRetrying(0);
    if (result.data) {
      message.success(`已重新提交，新任务号 ${result.data.id}`);
      setDetails({});
      await reload();
    } else {
      message.error(result.message || "重试失败");
    }
  };

  const columns: TableProps<TpTask>["columns"] = [
    { title: "任务号", dataIndex: "id", width: 80 },
    {
      title: "产品",
      dataIndex: "product",
      width: 120,
      render: (value: string) => tpProductLabel(value),
    },
    {
      title: "动作",
      dataIndex: "action",
      width: 190,
      render: (value: string) => tpActionLabel(value),
    },
    {
      title: "名单表",
      dataIndex: "tableName",
      width: 160,
      render: (value: string) => value || "未指定",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={TP_STATUS_COLOR[value] || "default"}>{tpStatusLabel(value)}</Tag>
      ),
    },
    {
      title: "行数",
      dataIndex: "totalRows",
      width: 160,
      render: (_: unknown, row) =>
        `${row.successRows}/${row.totalRows} 成功${
          row.failedRows ? ` · ${row.failedRows} 失败` : ""
        }${row.skippedRows ? ` · ${row.skippedRows} 跳过` : ""}`,
    },
    {
      title: "企点任务号",
      dataIndex: "upstreamTaskId",
      width: 160,
      render: (value: string) => value || "—",
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (_: unknown, row) => (
        <div>
          <div className="text-12">{row.createdAt}</div>
          <div className="text-12 muted">{row.finishedAt ? `完成 ${row.finishedAt}` : ""}</div>
        </div>
      ),
    },
    {
      title: "说明",
      dataIndex: "errorMessage",
      render: (value: string) => value || "—",
    },
    {
      title: "操作",
      width: 110,
      render: (_: unknown, row) =>
        row.action === "Tp_crmImport" ? (
          <span className="text-12 muted">回「导入 CRM」页签重跑</span>
        ) : (
          <Button
            loading={retrying === row.id}
            disabled={Boolean(retryDisabledReason(row))}
            title={retryDisabledReason(row) || undefined}
            onClick={() => void retry(row)}
          >
            重试
          </Button>
        ),
    },
  ];

  return (
    <Panel
      title={title}
      extra={tabs}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <span className="text-12 muted">
          批量动作按账号留台账；失败或部分完成可按原名单重跑。
        </span>
        <Space size={16} style={{ marginLeft: "auto" }}>
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined aria-hidden />}
            loading={loading}
            style={{ padding: 0 }}
            onClick={() => void reload()}
          >
            刷新
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined aria-hidden />}
            style={{ padding: 0 }}
            onClick={() =>
              window.open(TP_CONSOLE_URL, "_blank", "noopener,noreferrer")
            }
          >
            打开腾讯企点营销工作台
          </Button>
        </Space>
      </div>
      {error ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant="warn">{error}</Notice>
        </div>
      ) : null}
      {!loading && !tasks.length ? (
        <EmptyState text="还没有企点任务：批量动作执行后会在这里留下台账与逐批事件" />
      ) : (
        <div className="table-wrap">
          <Table<TpTask>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={tasks}
            columns={columns}
            scroll={{ x: "max-content" }}
            expandable={{
              onExpand: (expanded, row) => {
                if (expanded) void openDetail(row.id);
              },
              expandedRowRender: (row) => {
                const detail = details[row.id];
                if (!detail)
                  return (
                    <div className="text-12 muted">任务详情读取中…</div>
                  );
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {detail.errorMessage ? (
                      <Notice variant="warn">{detail.errorMessage}</Notice>
                    ) : null}
                    <TpObjectView value={{ 参数: detail.params, 列映射: detail.mapping }} />
                    {detail.events.length ? (
                      <div>
                        <div className="text-12 muted" style={{ marginBottom: 6 }}>
                          执行事件
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {detail.events.map((event) => (
                            <div
                              key={event.id}
                              style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                            >
                              <Tag
                                color={
                                  event.level === "error"
                                    ? "error"
                                    : event.level === "warn"
                                      ? "warning"
                                      : "default"
                                }
                              >
                                {event.level}
                              </Tag>
                              <span className="text-12">{event.message}</span>
                              <span className="text-12 muted">{event.createdAt}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-12 muted">这条任务没有事件</div>
                    )}
                  </div>
                );
              },
            }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: (next) => setPage(next),
            }}
          />
        </div>
      )}
    </Panel>
  );
}
