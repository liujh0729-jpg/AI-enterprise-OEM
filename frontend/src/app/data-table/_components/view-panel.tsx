"use client";

import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel, StatCard, StatGrid, TabStrip } from "@/components/ui/panel";
import {
  VIEW_TYPE_LABEL,
  cellText,
  fieldTypeLabel,
  tableApi,
  type DataTableView,
  type DataTableRow,
  type DataTableTable,
  type ViewType,
} from "./common";

const VIEW_ROW_LIMIT = 200;
const ALL_TAB = "all";

const AGG_LABEL: Record<string, string> = {
  sum: "求和",
  avg: "平均",
  count: "计数",
  min: "最小",
  max: "最大",
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 视图看板/汇总都是在客户端对已取到的行做呈现（后端问数才是全表口径）。 */
export function ViewPanel({
  table,
  reloadKey,
}: {
  table: DataTableTable;
  /** 行数据变化后由父级递增，触发重新取行。 */
  reloadKey: number;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [views, setViews] = useState<DataTableView[]>([]);
  const [rows, setRows] = useState<DataTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState<string>(ALL_TAB);
  const [loading, setLoading] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planText, setPlanText] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [draft, setDraft] = useState<{ name: string; type: ViewType; config: Record<string, unknown> } | null>(null);

  const fields = [...table.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  const load = useCallback(async () => {
    if (!table.can.read) return;
    setLoading(true);
    try {
      const [list, page] = await Promise.all([
        tableApi.views(table.id),
        tableApi.rows(table.id, 1, VIEW_ROW_LIMIT),
      ]);
      setViews(list.data ?? []);
      if (page.data) {
        setRows(page.data.list);
        setTotal(page.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [table.id, table.can.read]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const current = views.find((view) => String(view.id) === active) || null;

  const removeView = (view: DataTableView) => {
    request({
      title: "删除视图",
      content: `确认删除视图「${view.name}」？（不影响表内数据）`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await tableApi.removeView(table.id, view.id);
        if (String(view.id) === active) setActive(ALL_TAB);
        await load();
      },
    });
  };

  const runPlan = async () => {
    const text = planText.trim();
    if (!text) {
      message.warning("请用一句话描述想要的视图");
      return;
    }
    setPlanBusy(true);
    try {
      const plan = await tableApi.aiPlanView(table.id, text);
      setDraft({ name: plan.name, type: plan.type, config: plan.config });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setPlanBusy(true);
    try {
      const created = await tableApi.saveView(table.id, {
        name: draft.name,
        type: draft.type,
        config: draft.config,
      });
      setPlanOpen(false);
      setDraft(null);
      setPlanText("");
      await load();
      setActive(String(created.id));
      message.success(`已保存视图「${created.name}」`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  };

  const gridColumns: ColumnsType<DataTableRow> = fields.map((field) => ({
    title: (
      <span>
        {field.name}
        <span className="text-12 muted" style={{ marginLeft: 4 }}>
          {fieldTypeLabel(field.fieldType)}
        </span>
      </span>
    ),
    key: field.fieldKey,
    render: (_, row) => cellText(row.data[field.fieldKey]),
  }));

  const groupByKey =
    current?.type === "KANBAN" ? String(current.config.groupBy || "") : "";
  const groups = (() => {
    if (!groupByKey) return [];
    const buckets = new Map<string, DataTableRow[]>();
    rows.forEach((row) => {
      const label = cellText(row.data[groupByKey]);
      const list = buckets.get(label) || [];
      list.push(row);
      buckets.set(label, list);
    });
    return [...buckets.entries()];
  })();

  const metrics =
    current?.type === "DASHBOARD" && Array.isArray(current.config.metrics)
      ? (current.config.metrics as { key: string; agg: string }[])
      : [];

  const metricValue = (key: string, agg: string): string => {
    const values = rows.map((row) => num(row.data[key])).filter((v): v is number => v !== null);
    if (agg === "count") return String(rows.length);
    if (!values.length) return "—";
    const sum = values.reduce((acc, v) => acc + v, 0);
    if (agg === "avg") return (sum / values.length).toFixed(2);
    if (agg === "min") return String(Math.min(...values));
    if (agg === "max") return String(Math.max(...values));
    return String(sum);
  };

  const renderBody = () => {
    if (!rows.length) return <EmptyState text="该表还没有数据行" />;
    if (current?.type === "KANBAN" && groupByKey) {
      return (
        <div className="data-table-kanban">
          {groups.map(([label, groupRows]) => (
            <div key={label} className="data-table-kanban-col">
              <div className="data-table-kanban-head">
                {label}
                <span className="text-12 muted" style={{ marginLeft: 6 }}>
                  {groupRows.length}
                </span>
              </div>
              {groupRows.map((row) => (
                <div key={row.id} className="data-table-kanban-card">
                  <b>#{row.id}</b>
                  {fields
                    .filter((item) => item.fieldKey !== groupByKey)
                    .slice(0, 3)
                    .map((item) => (
                      <div key={item.fieldKey} className="text-12">
                        <span className="muted">{item.name}：</span>
                        {cellText(row.data[item.fieldKey])}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    if (current?.type === "DASHBOARD") {
      return (
        <StatGrid>
          {metrics.map((metric) => {
            const field = fields.find((item) => item.fieldKey === metric.key);
            return (
              <StatCard
                key={metric.key}
                label={`${field?.name || metric.key}（${AGG_LABEL[metric.agg] || metric.agg}）`}
                value={metricValue(metric.key, metric.agg)}
              />
            );
          })}
        </StatGrid>
      );
    }
    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={gridColumns}
        dataSource={rows}
      />
    );
  };

  const tabs = [
    { key: ALL_TAB, label: "全部数据", count: total },
    ...views.map((view) => ({ key: String(view.id), label: view.name })),
  ];

  return (
    <Panel
      title="视图"
      titleBadge={current ? `${current.name} · ${VIEW_TYPE_LABEL[current.type]}` : "网格 / 看板 / 汇总"}
      extra={
        <Space size={8}>
          {current ? (
            <Button danger icon={<DeleteOutlined />} onClick={() => removeView(current)}>
              删除视图
            </Button>
          ) : null}
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => {
              setDraft(null);
              setPlanText("");
              setPlanOpen(true);
            }}
          >
            AI 生成视图
          </Button>
        </Space>
      }
    >
      {views.length ? (
        <TabStrip items={tabs} value={active} onChange={setActive} />
      ) : (
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          还没有保存的视图，用「AI 生成视图」一句话生成看板 / 汇总 / 网格视图。
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {loading ? (
          <div className="text-12 muted">加载中…</div>
        ) : (
          <>
            <div className="text-12 muted" style={{ marginBottom: 8 }}>
              按最近 {Math.min(rows.length, VIEW_ROW_LIMIT)} 行呈现
            </div>
            {renderBody()}
          </>
        )}
      </div>

      <Modal
        open={planOpen}
        title="AI 生成视图"
        onCancel={() => setPlanOpen(false)}
        onOk={() => (draft ? void saveDraft() : void runPlan())}
        okText={draft ? "保存视图" : planBusy ? "生成中" : "生成视图"}
        cancelText={draft ? "重新描述" : "取消"}
        confirmLoading={planBusy}
        destroyOnHidden
      >
        <Input.TextArea
          rows={2}
          maxLength={500}
          value={planText}
          onChange={(event) => setPlanText(event.target.value)}
          placeholder="如：按行业分组的看板 / 各渠道金额汇总 / 全部明细网格"
        />
        {draft ? (
          <div style={{ marginTop: 12 }}>
            <Tag color="blue">{VIEW_TYPE_LABEL[draft.type]}</Tag>
            <b>{draft.name}</b>
            <div className="text-12 muted" style={{ marginTop: 4 }}>
              {draft.type === "KANBAN"
                ? `分组列：${draft.config.groupBy}`
                : draft.type === "DASHBOARD"
                  ? `指标：${(draft.config.metrics as { key: string; agg: string }[])
                      .map((metric) => `${metric.key} ${AGG_LABEL[metric.agg] || metric.agg}`)
                      .join("、")}`
                  : "全部字段明细网格"}
            </div>
          </div>
        ) : (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            <PlusOutlined /> 模型会按表内真实列键给出分组列 / 指标，不会编造列。
          </div>
        )}
      </Modal>
      {modal}
    </Panel>
  );
}
