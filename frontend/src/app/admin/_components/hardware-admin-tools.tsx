"use client";

import {
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { App, Button, Popconfirm, Select, Skeleton, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  HW_TOOL_KINDS,
  HW_TOOL_KIND_LABELS,
  HW_TOOL_TRANSPORT_LABELS,
  type HwModel,
  type HwTool,
  type HwToolSaveBody,
} from "@enterprise/contracts";
import { hardwareAdminApi } from "@/api/hardware";
import { ToolEditorModal } from "@/app/hardware/_components/tool-editor-modal";
import { ToolTrialModal } from "@/app/hardware/_components/tool-trial-modal";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

/**
 * 后台「默认工具」页签：按型号维护平台级 DEFAULT 工具（API / MCP）。
 * 用户自建工具仅本人可见，不在这里列；这里改完用户侧 硬件MCP / 硬件API 即时可见。
 */
export function HardwareAdminTools({ models }: { models: HwModel[] }) {
  const { message } = App.useApp();
  const [modelFilter, setModelFilter] = useState("ALL");
  const [kindFilter, setKindFilter] = useState("ALL");
  const [tools, setTools] = useState<HwTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HwTool | null>(null);
  const [createModelId, setCreateModelId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [trialTool, setTrialTool] = useState<HwTool | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hardwareAdminApi.toolList({
        query: {
          modelId: modelFilter === "ALL" ? "" : modelFilter,
          kind: kindFilter === "ALL" ? "" : kindFilter,
        },
      });
      setTools((data?.tools ?? []).filter((item) => item.scope === "DEFAULT"));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "默认工具加载失败");
    } finally {
      setLoading(false);
    }
  }, [modelFilter, kindFilter, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelName = (id: number) => {
    const target = models.find((item) => item.id === id);
    return target ? `${target.name}（${target.code}）` : `#${id}`;
  };

  const openCreate = () => {
    if (modelFilter === "ALL") {
      message.warning("请先在上方选择具体型号，再新增该型号的默认工具");
      return;
    }
    setCreateModelId(Number(modelFilter));
    setEditing(null);
    setEditorOpen(true);
  };

  const submit = async (body: HwToolSaveBody) => {
    setSaving(true);
    try {
      if (editing) {
        await hardwareAdminApi.updateTool({ params: { id: String(editing.id) }, body });
      } else {
        await hardwareAdminApi.toolSave({ query: { modelId: String(createModelId) }, body });
      }
      message.success("默认工具已保存，用户侧即时可见");
      setEditorOpen(false);
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: HwTool, enabled: boolean) => {
    try {
      await hardwareAdminApi.updateTool({ params: { id: String(row.id) }, body: { enabled } });
      setTools((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const remove = async (row: HwTool) => {
    try {
      await hardwareAdminApi.removeTool({ params: { id: String(row.id) } });
      message.success("默认工具已删除");
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const columns: ColumnsType<HwTool> = [
    { title: "型号", dataIndex: "modelId", width: 200, render: (value: number) => modelName(value) },
    {
      title: "工具",
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12 muted mono">{row.toolName}</span>
        </Space>
      ),
    },
    {
      title: "种类",
      dataIndex: "kind",
      width: 80,
      render: (value: HwTool["kind"]) => <Tag>{HW_TOOL_KIND_LABELS[value]}</Tag>,
    },
    {
      title: "通道",
      dataIndex: "transport",
      width: 100,
      render: (value: HwTool["transport"]) => <Tag color="blue">{HW_TOOL_TRANSPORT_LABELS[value]}</Tag>,
    },
    {
      title: "写动作",
      dataIndex: "write",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="orange">写</Tag> : <Tag color="green">只读</Tag>),
    },
    { title: "排序", dataIndex: "sortOrder", width: 70 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (value: boolean, row) => (
        <Switch size="small" checked={value} onChange={(next) => void toggle(row, next)} />
      ),
    },
    {
      title: "操作",
      width: 150,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => {
              setEditing(row);
              setEditorOpen(true);
            }}
          />
          <Button
            size="small"
            icon={<ExperimentOutlined aria-hidden />}
            onClick={() => setTrialTool(row)}
          />
          <Popconfirm
            title={`删除默认工具「${row.name}」？用户侧将不再看到它`}
            onConfirm={() => void remove(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="型号默认工具"
      titleExtra={
        <span className="text-12 muted">工具编码进 MCP 工具名（hw__型号__编码）；型号默认工具是平台级数据，所有用户可见</span>
      }
      extra={
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={modelFilter}
            onChange={setModelFilter}
            options={[
              { value: "ALL", label: "全部型号" },
              ...models.map((item) => ({ value: String(item.id), label: `${item.name}（${item.code}）` })),
            ]}
          />
          <Select
            style={{ width: 120 }}
            value={kindFilter}
            onChange={setKindFilter}
            options={[
              { value: "ALL", label: "全部种类" },
              ...HW_TOOL_KINDS.map((item) => ({ value: item, label: HW_TOOL_KIND_LABELS[item] })),
            ]}
          />
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={openCreate}>
            新增默认工具
          </Button>
        </Space>
      }
    >
      <Notice variant="info">
        这里维护的是型号默认工具（平台级），保存后用户侧「硬件MCP / 硬件API」即时可见。用户自建工具仅本人可见可用，不在这里列。
        试调用本人该型号的设备当场触发；写动作的授权闸只约束 MCP / 对外 API / 站内 Agent，不影响本人试调。
      </Notice>
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {!loading && !tools.length ? (
        <EmptyState text="该筛选下还没有默认工具；先在上方选择具体型号，再点「新增默认工具」。" />
      ) : null}
      {!loading && tools.length ? (
        <Table
          style={{ marginTop: 12 }}
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={tools}
          columns={columns}
          scroll={{ x: 1080 }}
        />
      ) : null}

      <ToolEditorModal
        open={editorOpen}
        initial={editing}
        saving={saving}
        onClose={() => setEditorOpen(false)}
        onSubmit={submit}
      />
      <ToolTrialModal tool={trialTool} onClose={() => setTrialTool(null)} />
    </Panel>
  );
}