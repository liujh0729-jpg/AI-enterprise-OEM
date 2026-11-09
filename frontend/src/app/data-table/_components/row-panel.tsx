"use client";

import { App, Button, Input, Modal, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { OaLaunchButton } from "@/app/oa/_components/oa-launch-button";
import { fmtTime } from "@/lib/datetime";
import {
  cellText,
  fieldTypeLabel,
  tableApi,
  type DataTableField,
  type DataTableRow,
  type DataTableTable,
} from "./common";

const PAGE_SIZE = 50;
/** 表体撑到窗口底部（至少 320px）：只有几行或没有行时，页面下半屏也不会整片空着。 */
const TABLE_BODY_HEIGHT = "max(320px, calc(100vh - 560px))";

/** 输入值 → 提交值：数字/布尔/JSON 按列类型归一，空值不提交（后端存 null）。 */
function toCellValue(field: DataTableField, raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  if (field.fieldType === "boolean") return value;
  if (field.fieldType === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** 已存值 → 输入框文本。 */
function fromCellValue(field: DataTableField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.fieldType === "boolean")
    return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * 数据行：逐条添加、单条修改/删除（改删需密码），列顺序与列定义一致。
 * 行数据以列键为键，与机器通道写入的是同一批数据。
 * 四个动作各看自己的权限位：没有「访问」就不取行、没有「新增／修改／删除」就不渲染对应按钮。
 */
export function RowPanel({
  table,
  reloadKey,
  onChanged,
}: {
  table: DataTableTable;
  /** 列定义变化后由父级递增，触发重新取列与刷新行。 */
  reloadKey: number;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [rows, setRows] = useState<DataTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DataTableRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** 行读取失败的原因：清单保留上一次读到的内容，只在面板里说明一次，不反复弹提示。 */
  const [loadError, setLoadError] = useState("");

  const fields = [...table.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  const can = table.can;

  const load = useCallback(async () => {
    if (!can.read) return;
    setLoading(true);
    try {
      const result = await tableApi.rows(table.id, page, PAGE_SIZE);
      if (result.data) {
        setRows(result.data.list);
        setTotal(result.data.total);
        setLoadError("");
      } else {
        // 一次读取失败不能让已有清单变成「该表还没有数据」，保留上一次读到的行并说明原因
        setLoadError(result.message || "数据行读取失败");
      }
    } finally {
      setLoading(false);
    }
  }, [table.id, page, can.read]);

  useEffect(() => {
    void load();
    // reloadKey 由父级在表结构变化后自增，用于强制重读行
  }, [load, reloadKey]);

  const blank = () => {
    const next: Record<string, string> = {};
    fields.forEach((field) => {
      next[field.fieldKey] = "";
    });
    return next;
  };

  const openCreate = () => {
    setEditing(null);
    setValues(blank());
    setOpen(true);
  };

  const openEdit = (row: DataTableRow) => {
    const next: Record<string, string> = {};
    fields.forEach((field) => {
      next[field.fieldKey] = fromCellValue(field, row.data[field.fieldKey]);
    });
    setEditing(row);
    setValues(next);
    setOpen(true);
  };

  const buildPayload = () => {
    const data: Record<string, unknown> = {};
    fields.forEach((field) => {
      data[field.fieldKey] = toCellValue(field, values[field.fieldKey] || "");
    });
    return data;
  };

  const submit = async () => {
    const data = buildPayload();
    if (editing) {
      const target = editing;
      request({
        title: "修改数据行（需密码）",
        content: `确认修改第 ${target.id} 行？`,
        okText: "保存修改",
        onOk: async () => {
          await tableApi.updateRow(table.id, target.id, data);
          setOpen(false);
          setEditing(null);
          await Promise.all([load(), onChanged()]);
        },
      });
      return;
    }
    setBusy(true);
    try {
      await tableApi.createRow(table.id, data);
      setOpen(false);
      await Promise.all([load(), onChanged()]);
      message.success("已添加 1 行");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeRow = (row: DataTableRow) => {
    request({
      title: "删除数据行",
      content: `确认删除第 ${row.id} 行？删除后不可恢复。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await tableApi.deleteRow(table.id, row.id);
        await Promise.all([load(), onChanged()]);
      },
    });
  };

  const columns: ColumnsType<DataTableRow> = [
    ...fields.map((field) => ({
      title: `${field.name}（${fieldTypeLabel(field.fieldType)}）`,
      dataIndex: field.fieldKey,
      key: field.fieldKey,
      ellipsis: true,
      render: (_: unknown, row: DataTableRow) =>
        cellText(row.data[field.fieldKey]),
    })),
    {
      title: "录入时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, row: DataTableRow) => (
        <Space size={6} wrap>
          {can.update || can.delete ? (
            <Space.Compact>
              {can.update ? (
                <Button onClick={() => openEdit(row)}>
                  改
                </Button>
              ) : null}
              {can.delete ? (
                <Button danger onClick={() => removeRow(row)}>
                  删
                </Button>
              ) : null}
            </Space.Compact>
          ) : null}
          <OaLaunchButton target="DATA_TABLE_ROW" targetId={`${table.id}:${row.id}`} />
        </Space>
      ),
    },
  ];

  if (!fields.length) {
    return (
      <Panel title="数据行" extra={<span className="text-12 muted">先添加列</span>}>
        <EmptyState
          text={
            table.owner
              ? "该表还没有列，先在上方「列定义」添加列"
              : "该表还没有列，请联系表归属账号添加列"
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="数据行"
      titleBadge={`${can.read ? total : table.rowCount} 行`}
      extra={can.create ? <Button onClick={openCreate}>添加一行</Button> : null}
    >
      {can.read ? (
        <>
          {loadError ? (
            <Notice variant="warn">
              <Space size={8}>
                <span>
                  {`数据行没读取成功：${loadError}。下面显示的是上一次读到的内容。`}
                </span>
                <Button onClick={() => void load()}>
                  重试
                </Button>
              </Space>
            </Notice>
          ) : null}
          <Table<DataTableRow>
            className="data-table-rows"
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: "max-content", y: TABLE_BODY_HEIGHT }}
            locale={{
              emptyText: (
                <div
                  className="data-table-rows-empty"
                  style={{ minHeight: TABLE_BODY_HEIGHT }}
                >
                  暂无数据，点右上角「添加一行」
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
        </>
      ) : (
        <EmptyState text="本表只授予写入类权限，没有「访问」权时不显示已有行" />
      )}

      <Modal
        open={open}
        title={editing ? `修改第 ${editing.id} 行` : "添加数据行"}
        width={760}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
        styles={{ body: { maxHeight: "calc(100vh - 260px)", overflowY: "auto" } }}
      >
        <div className="data-table-form">
          {fields.map((field) => (
            <label
              key={field.id}
              className="data-table-form-item"
              style={
                field.fieldType === "json" ? { gridColumn: "1 / -1" } : undefined
              }
            >
              <span className="data-table-form-label">
                {field.name}
                <span className="text-12 muted"> · {fieldTypeLabel(field.fieldType)}</span>
                {field.required ? <b style={{ color: "var(--danger)" }}> *</b> : null}
              </span>
              {field.fieldType === "boolean" ? (
                <Select
                  value={values[field.fieldKey] || undefined}
                  placeholder="请选择"
                  allowClear
                  options={[
                    { value: "true", label: "是" },
                    { value: "false", label: "否" },
                  ]}
                  onChange={(value) =>
                    setValues((prev) => ({ ...prev, [field.fieldKey]: value || "" }))
                  }
                />
              ) : field.fieldType === "select" ? (
                <Select
                  value={values[field.fieldKey] || undefined}
                  placeholder="请选择"
                  allowClear
                  options={(field.options?.choices || []).map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  onChange={(value) =>
                    setValues((prev) => ({ ...prev, [field.fieldKey]: value || "" }))
                  }
                />
              ) : field.fieldType === "json" ? (
                <Input.TextArea
                  rows={3}
                  value={values[field.fieldKey]}
                  placeholder='如 {"key":"value"}'
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.fieldKey]: event.target.value,
                    }))
                  }
                />
              ) : (
                <Input
                  value={values[field.fieldKey]}
                  maxLength={field.fieldType === "number" ? 32 : 500}
                  placeholder={
                    field.fieldType === "date"
                      ? "如 2026-10-23"
                      : field.fieldType === "number"
                        ? "如 128.5"
                        : undefined
                  }
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.fieldKey]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}
