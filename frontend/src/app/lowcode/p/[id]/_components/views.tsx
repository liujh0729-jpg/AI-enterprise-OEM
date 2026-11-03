"use client";

import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import type {
  LowCodeEntityView,
  LowCodeFieldView,
  LowCodePageView,
} from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState, Notice, Panel, StatCard, StatGrid, TabStrip } from "@/components/ui/panel";
import { OaLaunchButton } from "@/app/oa/_components/oa-launch-button";
import {
  AiFillBar,
  FieldInputs,
  RowModal,
  choicesOf,
  errText,
  normalizeValues,
} from "./row-form";

type RowRecord = {
  id: number;
  data: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type RowsResult = {
  list: RowRecord[];
  total: number;
  columns: { key: string; name: string; type: string }[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  hiddenFields: string[];
  readonlyFields: string[];
};

function fmtDate(value: unknown) {
  const raw = String(value ?? "");
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function renderCellValue(type: string | undefined, value: unknown) {
  if (value === undefined || value === null || value === "") return <span className="muted">—</span>;
  if (type === "boolean") return value ? "是" : "否";
  if (type === "date") return fmtDate(value);
  if (type === "json") {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return <span title={text}>{text.slice(0, 60)}{text.length > 60 ? "…" : ""}</span>;
  }
  if (type === "url") {
    const href = String(value);
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {href}
      </a>
    );
  }
  if (type === "select") return <Tag>{String(value)}</Tag>;
  return String(value);
}

function useRows(
  projectId: number,
  entityId: number,
  query: { page?: number; pageSize?: number; keyword?: string; sort?: string; sortDir?: "asc" | "desc" },
) {
  const [data, setData] = useState<RowsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError("");
    void lowcodeApi
      .entityRows({
        params: { id: String(projectId), entityId: String(entityId) },
        query: {
          page: query.page || 1,
          pageSize: query.pageSize || 20,
          keyword: query.keyword || undefined,
          sort: query.sort || undefined,
          sortDir: query.sortDir,
        },
      })
      .then((result) => setData(result as RowsResult))
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setLoading(false));
  }, [projectId, entityId, query.page, query.pageSize, query.keyword, query.sort, query.sortDir, reloadKey]);

  return { data, loading, error, reload: () => setReloadKey((key) => key + 1) };
}

export function EntityListView({
  projectId,
  entity,
  page,
}: {
  projectId: number;
  entity: LowCodeEntityView;
  page: LowCodePageView;
}) {
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [sort, setSort] = useState(() => {
    if (page.config.sort && typeof page.config.sort === "object") {
      const s = page.config.sort as { fieldKey?: unknown; dir?: unknown };
      return { field: String(s.fieldKey || ""), dir: (s.dir === "desc" ? "desc" : "asc") as "asc" | "desc" };
    }
    return { field: "", dir: "asc" as const };
  });
  const { data, loading, error, reload } = useRows(projectId, entity.id, {
    page: pageNo,
    pageSize: 20,
    keyword: search,
    sort: sort.field,
    sortDir: sort.dir,
  });
  const [editing, setEditing] = useState<{ rowId?: number; initial?: Record<string, unknown> } | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const configuredColumns = useMemo(() => {
    const raw = page.config.columns;
    return Array.isArray(raw) ? raw.map((item) => String(item)) : [];
  }, [page.config.columns]);

  const visibleColumns = useMemo(() => {
    const columns = data?.columns || entity.fields.map((field) => ({
      key: field.fieldKey,
      name: field.name,
      type: field.fieldType,
    }));
    if (!configuredColumns.length) return columns;
    return columns.filter((column) => configuredColumns.includes(column.key));
  }, [data?.columns, entity.fields, configuredColumns]);

  const fieldsByKey = useMemo(
    () => new Map<string, LowCodeFieldView>(entity.fields.map((field) => [field.fieldKey, field])),
    [entity.fields],
  );

  const columns: ColumnsType<RowRecord> = [
    ...visibleColumns.map((column) => ({
      title: column.name,
      key: column.key,
      dataIndex: ["data", column.key],
      ellipsis: true,
      sorter: true,
      render: (_: unknown, row: RowRecord) =>
        renderCellValue(fieldsByKey.get(column.key)?.fieldType || column.type, row.data[column.key]),
    })),
    {
      title: "更新时间",
      key: "__updatedAt",
      width: 180,
      render: (_: unknown, row: RowRecord) => fmtDate(row.updatedAt),
    },
    {
      title: "操作",
      key: "__actions",
      width: 150,
      render: (_: unknown, row: RowRecord) => (
        <Space size={4}>
          {data?.canUpdate ? (
            <Button type="link" size="small" onClick={() => setEditing({ rowId: row.id, initial: row.data })}>
              编辑
            </Button>
          ) : null}
          {data?.canDelete ? (
            <Button
              type="link"
              size="small"
              danger
              onClick={() =>
                Modal.confirm({
                  title: `删除这条${entity.name}数据？`,
                  okText: "删除",
                  okButtonProps: { danger: true },
                  cancelText: "取消",
                  onOk: async () => {
                    try {
                      await lowcodeApi.deleteRow({
                        params: { id: String(projectId), entityId: String(entity.id), rowId: String(row.id) },
                      });
                      message.success("已删除");
                      reload();
                    } catch (error) {
                      message.error(errText(error));
                      throw error;
                    }
                  },
                })
              }
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const exportRows = async () => {
    try {
      const result = await lowcodeApi.exportRows({
        params: { id: String(projectId), entityId: String(entity.id) },
        body: { keyword: search, sort: sort.field, sortDir: sort.dir, filter: [] },
      });
      if (!result) throw new Error("导出失败");
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${result.rows} 行`);
    } catch (error) {
      message.error(errText(error));
    }
  };

  return (
    <Panel
      title={`${entity.name}列表`}
      extra={
        <div className="lowcode-toolbar">
          <Input.Search
            allowClear
            value={keyword}
            placeholder="搜索"
            style={{ width: 220 }}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => {
              setSearch(value);
              setPageNo(1);
            }}
          />
          <Button onClick={() => setAskOpen(true)}>AI 问数</Button>
          {data?.canExport ? <Button onClick={() => void exportRows()}>导出 CSV</Button> : null}
          {data?.canCreate ? (
            <Button type="primary" onClick={() => setEditing({})}>
              新增{entity.name}
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <Notice variant="error">
          {error}
          <Button type="link" onClick={reload}>
            重试
          </Button>
        </Notice>
      ) : null}
      <Table<RowRecord>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={data?.list || []}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <EmptyState text={`暂无${entity.name}数据。`} /> }}
        pagination={{
          current: pageNo,
          pageSize: 20,
          total: data?.total || 0,
          showSizeChanger: false,
          onChange: setPageNo,
        }}
        onChange={(_pagination, _filters, sorter) => {
          const item = Array.isArray(sorter) ? sorter[0] : sorter;
          if (!item?.order) {
            setSort({ field: "", dir: "asc" });
            return;
          }
          setSort({
            field: String(item.columnKey || ""),
            dir: item.order === "descend" ? "desc" : "asc",
          });
        }}
      />
      {editing ? (
        <RowModal
          open
          projectId={projectId}
          entity={entity}
          rowId={editing.rowId}
          initial={editing.initial}
          readonlyFields={data?.readonlyFields || []}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
      <AiAskModal open={askOpen} projectId={projectId} entity={entity} onClose={() => setAskOpen(false)} />
    </Panel>
  );
}

function AiAskModal({
  open,
  projectId,
  entity,
  onClose,
}: {
  open: boolean;
  projectId: number;
  entity: LowCodeEntityView;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    answer: string;
    columns: { key: string; name: string; type: string }[];
    rows: Record<string, unknown>[];
    total: number;
    truncated: boolean;
  } | null>(null);

  const ask = async () => {
    if (!question.trim()) {
      message.warning("请输入问题");
      return;
    }
    setLoading(true);
    try {
      const data = await lowcodeApi.aiAsk({
        params: { id: String(projectId) },
        body: { entityId: entity.id, question: question.trim() },
      });
      setResult(data as typeof result);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<Record<string, unknown>> = (result?.columns || []).map((column) => ({
    title: column.name,
    key: column.key,
    render: (_: unknown, row: Record<string, unknown>) => renderCellValue(column.type, row[column.key]),
  }));

  return (
    <Modal
      open={open}
      title={`向「${entity.name}」数据提问`}
      width={860}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Space.Compact style={{ width: "100%" }}>
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：上个月哪些客户还没回款？"
          onPressEnter={() => void ask()}
        />
        <Button type="primary" loading={loading} onClick={() => void ask()}>
          提问
        </Button>
      </Space.Compact>
      {result ? (
        <div style={{ marginTop: 14 }}>
          <Notice variant="info">{result.answer}</Notice>
          <Table<Record<string, unknown>>
            style={{ marginTop: 10 }}
            rowKey={(row, index) => String(row.id ?? index)}
            size="small"
            columns={columns}
            dataSource={result.rows}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "没有命中数据" }}
          />
          <div className="muted text-12" style={{ marginTop: 6 }}>
            共 {result.total} 行{result.truncated ? "（结果已截断）" : ""}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function EntityFormView({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = normalizeValues(entity.fields, values as Record<string, unknown>);
      await lowcodeApi.createRow({
        params: { id: String(projectId), entityId: String(entity.id) },
        body: { data: payload },
      });
      message.success(`已保存${entity.name}`);
      form.resetFields();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={`新增${entity.name}`}>
      <AiFillBar projectId={projectId} entity={entity} form={form} />
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <FieldInputs fields={entity.fields} />
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          提交
        </Button>
      </Form>
    </Panel>
  );
}

export function EntityDetailView({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const [keyword, setKeyword] = useState("");
  const { data, loading, reload } = useRows(projectId, entity.id, { page: 1, pageSize: 100, keyword });
  const [rowId, setRowId] = useState<number>();
  const [detail, setDetail] = useState<{
    data: Record<string, unknown>;
    canUpdate: boolean;
    canDelete: boolean;
    readonlyFields: string[];
    approval?: {
      instance: { status: string; title: string; applicantName: string; createdAt: string } | null;
      tasks: { id: number; nodeName: string; status: string; assigneeName: string; actedAt: string | null }[];
    };
  } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!rowId) {
      setDetail(null);
      return;
    }
    void lowcodeApi
      .entityRow({ params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) } })
      .then((row) => setDetail(row as typeof detail))
      .catch((error: unknown) => message.error(errText(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const loadApproval = async () => {
    if (!rowId) return;
    try {
      const result = await lowcodeApi.recordApproval({
        params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) },
      });
      setDetail((current) => (current ? { ...current, approval: result as never } : current));
    } catch {
      /* 没有审批实例时不打扰 */
    }
  };

  const selected = data?.list.find((row) => row.id === rowId);

  return (
    <Panel
      title={`${entity.name}详情`}
      extra={
        <div className="lowcode-toolbar">
          <Select
            showSearch
            allowClear
            loading={loading}
            placeholder="选择一条数据"
            style={{ width: 320 }}
            value={rowId}
            optionFilterProp="label"
            onChange={(value?: number) => setRowId(value)}
            options={(data?.list || []).map((row) => ({
              value: row.id,
              label: `#${row.id} ${String(row.data[entity.fields[0]?.fieldKey || ""] ?? "")}`.trim(),
            }))}
          />
          <Input.Search
            allowClear
            placeholder="按关键词缩小范围"
            style={{ width: 220 }}
            onSearch={setKeyword}
          />
          {detail?.canUpdate && selected ? <Button onClick={() => setEditing(true)}>编辑</Button> : null}
          {detail?.canUpdate && selected ? <Button onClick={() => void loadApproval()}>查看审批</Button> : null}
          {rowId ? (
            <OaLaunchButton
              target="LOWCODE_ROW"
              targetId={`${projectId}:${entity.id}:${rowId}`}
            />
          ) : null}
        </div>
      }
    >
      {!rowId ? (
        <EmptyState text="先选择一条数据查看详情。" />
      ) : detail ? (
        <>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="编号">#{rowId}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{fmtDate(selected?.updatedAt)}</Descriptions.Item>
            {entity.fields.map((field) => (
              <Descriptions.Item key={field.fieldKey} label={field.name}>
                {renderCellValue(field.fieldType, detail.data[field.fieldKey])}
              </Descriptions.Item>
            ))}
          </Descriptions>
          {detail.approval ? (
            <div style={{ marginTop: 16 }}>
              <Panel title="审批记录">
                {detail.approval.instance ? (
                  <div style={{ marginBottom: 8 }}>
                    当前状态：<Tag>{detail.approval.instance.status}</Tag>
                    发起人 {detail.approval.instance.applicantName}
                  </div>
                ) : null}
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={detail.approval.tasks}
                  columns={[
                    { title: "节点", dataIndex: "nodeName" },
                    { title: "审批人", dataIndex: "assigneeName" },
                    { title: "状态", dataIndex: "status", render: (value: string) => <Tag>{value}</Tag> },
                    { title: "处理时间", dataIndex: "actedAt", render: (value: string | null) => fmtDate(value) },
                  ]}
                />
              </Panel>
            </div>
          ) : null}
          {editing ? (
            <RowModal
              open
              projectId={projectId}
              entity={entity}
              rowId={rowId}
              readonlyFields={detail.readonlyFields}
              onClose={() => setEditing(false)}
              onSaved={() => {
                reload();
                setRowId(rowId);
                void lowcodeApi
                  .entityRow({ params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) } })
                  .then((row) => setDetail(row as typeof detail))
                  .catch(() => undefined);
              }}
            />
          ) : null}
        </>
      ) : (
        <EmptyState text="正在加载数据行…" />
      )}
    </Panel>
  );
}

export function EntityKanbanView({
  projectId,
  entity,
  page,
}: {
  projectId: number;
  entity: LowCodeEntityView;
  page: LowCodePageView;
}) {
  const groupKey = String(page.config.groupField || entity.kanbanField || "");
  const groupField = entity.fields.find((field) => field.fieldKey === groupKey);
  const { data, loading, reload } = useRows(projectId, entity.id, { page: 1, pageSize: 200 });
  const [moving, setMoving] = useState(false);

  const groups = useMemo(() => {
    const values = groupField ? choicesOf(groupField) : [];
    const seen = new Set<string>();
    const columns: { key: string; title: string }[] = [];
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value);
        columns.push({ key: value, title: value });
      }
    }
    for (const row of data?.list || []) {
      const value = String(row.data[groupKey] ?? "");
      if (value && !seen.has(value)) {
        seen.add(value);
        columns.push({ key: value, title: value });
      }
    }
    return columns;
  }, [data?.list, groupField, groupKey]);

  const move = async (rowId: number, value: string) => {
    setMoving(true);
    try {
      await lowcodeApi.updateRow({
        params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) },
        body: { data: { [groupKey]: value } },
      });
      reload();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setMoving(false);
    }
  };

  const previewFields = entity.fields.filter((field) => field.fieldKey !== groupKey).slice(0, 3);

  return (
    <Panel
      title={`${entity.name}看板`}
      titleExtra={groupField ? <span className="muted text-12">按「{groupField.name}」分组</span> : null}
    >
      {!groupKey ? (
        <Notice variant="warn">还没有看板分组字段，请到「设置 → 实体」里指定。</Notice>
      ) : loading && !data ? (
        <EmptyState text="正在加载看板…" />
      ) : (
        <div className="lowcode-kanban" style={{ opacity: moving ? 0.7 : 1 }}>
          {groups.map((group) => {
            const rows = (data?.list || []).filter((row) => String(row.data[groupKey] ?? "") === group.key);
            return (
              <div className="lowcode-kanban-col" key={group.key}>
                <div className="lowcode-kanban-head">
                  <span>{group.title}</span>
                  <Tag>{rows.length}</Tag>
                </div>
                {rows.map((row) => (
                  <div className="lowcode-kanban-card" key={row.id}>
                    {previewFields.map((field) => (
                      <div key={field.fieldKey} className="lowcode-kanban-line">
                        <span className="muted text-12">{field.name}</span>
                        <span>{renderCellValue(field.fieldType, row.data[field.fieldKey])}</span>
                      </div>
                    ))}
                    {data?.canUpdate ? (
                      <Select
                        size="small"
                        style={{ width: "100%", marginTop: 6 }}
                        value={group.key}
                        options={groups.map((item) => ({ value: item.key, label: item.title }))}
                        onChange={(value) => void move(row.id, value)}
                      />
                    ) : null}
                  </div>
                ))}
                {!rows.length ? <div className="lowcode-kanban-empty">暂无</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function ApprovalInboxView({ projectId }: { projectId: number }) {
  const [status, setStatus] = useState<"PENDING" | "DONE">("PENDING");
  const [tasks, setTasks] = useState<
    {
      id: number;
      entityId: number;
      rowId: number;
      nodeName: string;
      title: string;
      applicantName: string;
      assigneeName: string;
      status: string;
      comment: string;
      createdAt: string;
      actedAt: string | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [acting, setActing] = useState<{ taskId: number; action: "APPROVE" | "REJECT" } | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    setLoading(true);
    void lowcodeApi
      .approvalTasks({
        params: { id: String(projectId) },
        query: { status, page: 1, pageSize: 100 },
      })
      .then((result) => setTasks((result?.list || []) as typeof tasks))
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  }, [projectId, status, reloadKey]);

  const submitAct = async () => {
    if (!acting) return;
    try {
      await lowcodeApi.actApproval({
        params: { id: String(projectId) },
        body: { taskId: acting.taskId, action: acting.action, comment },
      });
      message.success(acting.action === "APPROVE" ? "已通过" : "已驳回");
      setActing(null);
      setComment("");
      setReloadKey((key) => key + 1);
    } catch (error) {
      message.error(errText(error));
    }
  };

  const columns: ColumnsType<(typeof tasks)[number]> = [
    { title: "单据", key: "title", render: (_: unknown, row) => row.title || `#${row.rowId}` },
    { title: "节点", dataIndex: "nodeName" },
    { title: "发起人", dataIndex: "applicantName" },
    { title: "提交时间", dataIndex: "createdAt", render: (value: string) => fmtDate(value) },
    ...(status === "PENDING"
      ? [
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row: (typeof tasks)[number]) => (
              <Space size={4}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setActing({ taskId: row.id, action: "APPROVE" });
                    setComment("");
                  }}
                >
                  通过
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => {
                    setActing({ taskId: row.id, action: "REJECT" });
                    setComment("");
                  }}
                >
                  驳回
                </Button>
              </Space>
            ),
          },
        ]
      : [
          {
            title: "结果",
            key: "result",
            render: (_: unknown, row: (typeof tasks)[number]) => <Tag>{row.status}</Tag>,
          },
          {
            title: "处理时间",
            dataIndex: "actedAt",
            render: (value: string | null) => fmtDate(value),
          },
        ]),
  ];

  return (
    <Panel
      title="审批待办"
      extra={<TabStrip items={[{ key: "PENDING", label: "待我处理" }, { key: "DONE", label: "我已处理" }]} value={status} onChange={(key) => setStatus(key as "PENDING" | "DONE")} />}
    >
      <Table<(typeof tasks)[number]>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={tasks}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <EmptyState text={status === "PENDING" ? "没有需要你处理的审批。" : "还没有处理过的审批。"} /> }}
      />
      <Modal
        open={Boolean(acting)}
        title={acting?.action === "APPROVE" ? "通过审批" : "驳回审批"}
        okText={acting?.action === "APPROVE" ? "通过" : "驳回"}
        okButtonProps={{ danger: acting?.action === "REJECT" }}
        cancelText="取消"
        onCancel={() => setActing(null)}
        onOk={() => void submitAct()}
        destroyOnHidden
      >
        <Input.TextArea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="审批意见（可选）" />
      </Modal>
    </Panel>
  );
}

export function DashboardView({
  entities,
}: {
  entities: LowCodeEntityView[];
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  useEffect(() => {
    const load = async () => {
      const next: Record<number, number> = {};
      for (const entity of entities) {
        try {
          const rows = await lowcodeApi.entityRows({
            params: { id: String(entity.projectId), entityId: String(entity.id) },
            query: { page: 1, pageSize: 1 },
          });
          next[entity.id] = rows ? rows.total : entity.rowCount || 0;
        } catch {
          next[entity.id] = entity.rowCount || 0;
        }
      }
      setCounts(next);
    };
    if (entities.length) void load();
  }, [entities]);

  return (
    <Panel title="数据看板">
      {!entities.length ? (
        <EmptyState text="还没有实体，先到「设置 → 实体」里建一张表。" />
      ) : (
        <>
          <StatGrid>
            {entities.map((entity) => (
              <StatCard key={entity.id} label={entity.name} value={counts[entity.id] ?? entity.rowCount ?? 0} hint="行数据" />
            ))}
          </StatGrid>
          <div style={{ marginTop: 16 }}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={entities}
              columns={[
                { title: "实体", dataIndex: "name" },
                { title: "字段数", key: "fields", render: (_: unknown, row: LowCodeEntityView) => row.fields.length },
                { title: "行数", key: "rows", render: (_: unknown, row: LowCodeEntityView) => counts[row.id] ?? row.rowCount ?? 0 },
              ]}
            />
          </div>
        </>
      )}
      <div className="muted text-12" style={{ marginTop: 10 }}>
        看板按实体统计实时行数；要自定义指标，可新建「自由画布」页面放指标卡。
      </div>
    </Panel>
  );
}
