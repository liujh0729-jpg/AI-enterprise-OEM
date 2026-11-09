"use client";

import {
  CheckOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { SCRM_SOP_ACTIONS } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  SOP_ACTION_LABELS,
  SOP_TASK_STATUS_COLOR,
  SOP_TASK_STATUS_LABELS,
  SOP_TRIGGER_LABELS,
  fmtDateTime,
  loadScrmStaff,
  scrmApi,
  sopActionLabel,
  sopTriggerLabel,
  tagOptions,
  type ScrmCode,
  type ScrmSop,
  type ScrmSopTask,
  type ScrmTagGroup,
} from "./scrm-common";

/**
 * SOP：加好友 / 打标签 / 入站关键词 / 定时 / 手动触发，动作可串多步。
 * 发送类动作不会直接发消息，而是生成员工待办（侧边栏处理），避免自动化冒犯客户。
 */

const TRIGGER_OPTIONS = Object.entries(SOP_TRIGGER_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const ACTION_OPTIONS = Object.entries(SOP_ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

type SopAction = ScrmSop["actions"][number];

export function ScrmSopsView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [sops, setSops] = useState<ScrmSop[]>([]);
  const [tasks, setTasks] = useState<ScrmSopTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState(10);
  const [taskStatus, setTaskStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [tagGroups, setTagGroups] = useState<ScrmTagGroup[]>([]);
  const [codes, setCodes] = useState<ScrmCode[]>([]);
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScrmSop | null>(null);
  const [completeTarget, setCompleteTarget] = useState<{ row: ScrmSopTask; done: boolean } | null>(null);
  const [completeForm] = Form.useForm();
  const [busy, setBusy] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSops((await scrmApi.sops()) ?? []);
    } catch (error) {
      message.error((error as Error).message || "SOP 读取失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const reloadTasks = useCallback(async () => {
    setTaskLoading(true);
    try {
      const result = await scrmApi.sopTasks({
        query: {
          page: taskPage,
          pageSize: taskPageSize,
          ...(taskStatus ? { status: taskStatus } : {}),
        },
      });
      setTasks(result?.list ?? []);
      setTaskTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "SOP 待办读取失败");
    } finally {
      setTaskLoading(false);
    }
  }, [taskPage, taskPageSize, taskStatus, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks, tick]);

  useEffect(() => {
    void scrmApi
      .tagGroups()
      .then((rows) => setTagGroups(rows ?? []))
      .catch(() => undefined);
    void scrmApi.codes({ query: { page: 1, pageSize: 100 } }).then((result) => setCodes(result?.list ?? [])).catch(() => undefined);
    void loadScrmStaff().then(setStaffOptions);
  }, []);

  const run = async (row: ScrmSop) => {
    setBusy(row.id);
    try {
      const result = await scrmApi.runSop({ body: { id: row.id } });
      message.success(result?.message || `已生成 ${result?.created ?? 0} 条待办`);
      void reloadTasks();
    } catch (error) {
      message.error((error as Error).message || "执行失败");
    } finally {
      setBusy(0);
    }
  };

  const completeTask = async () => {
    if (!completeTarget) return;
    const values = completeForm.getFieldsValue();
    setBusy(completeTarget.row.id);
    try {
      await scrmApi.completeSopTask({
        body: {
          id: completeTarget.row.id,
          status: completeTarget.done ? "DONE" : "SKIPPED",
          result: values.result ?? "",
        },
      });
      message.success(completeTarget.done ? "待办已完成" : "待办已跳过");
      setCompleteTarget(null);
      void reloadTasks();
    } catch (error) {
      message.error((error as Error).message || "操作失败");
    } finally {
      setBusy(0);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <ThunderboltOutlined aria-hidden /> 自动化 SOP
          </>
        }
        titleExtra="发送类动作只生成员工待办，不直接替员工发消息；关键词触发依赖入站词命中"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              新建 SOP
            </Button>
          </Space>
        }
      >
        <Table<ScrmSop>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={sops}
          scroll={{ x: 980 }}
          pagination={false}
          columns={[
            { title: "SOP", dataIndex: "name", render: (value: string, row) => (
              <Space orientation="vertical" size={0}>
                <span>{value}</span>
                <span className="text-12 muted">v{row.version}</span>
              </Space>
            ) },
            {
              title: "触发",
              dataIndex: "trigger",
              width: 160,
              render: (value: string) => <Tag>{sopTriggerLabel(value)}</Tag>,
            },
            {
              title: "动作",
              dataIndex: "actions",
              render: (value: SopAction[]) =>
                value?.length ? (
                  <Space size={2} wrap>
                    {value.map((action, index) => (
                      <Tag key={`${action.kind}-${index}`}>{sopActionLabel(action.kind)}</Tag>
                    ))}
                  </Space>
                ) : (
                  <span className="text-12 muted">未配置</span>
                ),
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (value: boolean) => (value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 220,
              render: (_: unknown, row) => (
                <Space size={4} wrap>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined aria-hidden />}
                    loading={busy === row.id}
                    onClick={() => void run(row)}
                  >
                    手动执行
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(row);
                      setFormOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这条 SOP？"
                    description="未处理的待办会被标记为跳过。"
                    onConfirm={() =>
                      void scrmApi
                        .removeSop({ body: { id: row.id } })
                        .then(() => {
                          message.success("已删除");
                          void reload();
                          void reloadTasks();
                        })
                        .catch((error: Error) => message.error(error.message || "删除失败"))
                    }
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有 SOP：从客户加好友、打标或入站关键词开始自动化" }}
        />
      </Panel>

      <Panel
        title="SOP 待办"
        titleExtra="员工侧边栏与这里共用同一份待办；完成/跳过都会写客户时间线"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 130 }}
              value={taskStatus || undefined}
              options={Object.entries(SOP_TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => {
                setTaskPage(1);
                setTaskStatus(value ?? "");
              }}
            />
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reloadTasks()} loading={taskLoading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<ScrmSopTask>
          rowKey="id"
          size="small"
          loading={taskLoading}
          dataSource={tasks}
          scroll={{ x: 940 }}
          pagination={{
            current: taskPage,
            pageSize: taskPageSize,
            total: taskTotal,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setTaskPage(nextPage);
              setTaskPageSize(nextSize);
            },
          }}
          columns={[
            { title: "SOP", dataIndex: "sopName" },
            {
              title: "客户",
              dataIndex: "contactName",
              render: (value: string, row) => value || `#${row.contactId}`,
            },
            {
              title: "负责人",
              dataIndex: "staffName",
              width: 150,
              render: (value: string, row) => value || row.staffUserId || "-",
            },
            { title: "到期", dataIndex: "dueAt", width: 170, render: (value: string) => (value ? fmtDateTime(value) : "-") },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => (
                <Tag color={SOP_TASK_STATUS_COLOR[value] || "default"}>
                  {SOP_TASK_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: "处理结果",
              dataIndex: "result",
              render: (value: string) => value || "-",
            },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined aria-hidden />}
                    disabled={row.status !== "PENDING"}
                    onClick={() => {
                      completeForm.resetFields();
                      setCompleteTarget({ row, done: true });
                    }}
                  >
                    完成
                  </Button>
                  <Button
                    size="small"
                    icon={<StopOutlined aria-hidden />}
                    disabled={row.status !== "PENDING"}
                    onClick={() => {
                      completeForm.resetFields();
                      setCompleteTarget({ row, done: false });
                    }}
                  >
                    跳过
                  </Button>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "没有待办：SOP 触发后会为负责人生成待办" }}
        />
      </Panel>

      <SopModal
        open={formOpen}
        row={editing}
        tagGroups={tagGroups}
        codes={codes}
        staffOptions={staffOptions}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <Modal
        title={completeTarget?.done ? "完成 SOP 待办" : "跳过 SOP 待办"}
        open={Boolean(completeTarget)}
        confirmLoading={busy === completeTarget?.row.id}
        okText={completeTarget?.done ? "完成" : "跳过"}
        okButtonProps={{ danger: !completeTarget?.done }}
        onOk={() => void completeTask()}
        onCancel={() => setCompleteTarget(null)}
      >
        <p className="text-12 muted">
          {completeTarget?.row.sopName} · {completeTarget?.row.contactName}
        </p>
        <Form form={completeForm} layout="vertical">
          <Form.Item name="result" label="处理说明（选填）">
            <Input.TextArea rows={3} maxLength={1000} placeholder="如：已发资料，客户约下周再聊" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function SopModal({
  open,
  row,
  tagGroups,
  codes,
  staffOptions,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmSop | null;
  tagGroups: ScrmTagGroup[];
  codes: ScrmCode[];
  staffOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const trigger = Form.useWatch("trigger", form);
  const tagOptionsValue = tagOptions(tagGroups);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const config = (row?.triggerConfig ?? {}) as Record<string, unknown>;
    form.setFieldsValue(
      row
        ? {
            name: row.name,
            trigger: row.trigger,
            enabled: row.enabled,
            tagIds: Array.isArray(config.tagIds) ? config.tagIds : [],
            staffUserIds: Array.isArray(config.staffUserIds) ? config.staffUserIds : [],
            codeIds: Array.isArray(config.codeIds) ? config.codeIds : [],
            keywords: Array.isArray(config.keywords) ? (config.keywords as string[]).join("\n") : "",
            hour: Number(config.hour ?? 9),
            weekdays: Array.isArray(config.weekdays) ? config.weekdays : [],
            addedFrom: config.addedFrom ? dayjs(String(config.addedFrom)) : undefined,
            actions: row.actions.map((action) => ({
              kind: action.kind,
              delayHours: Number((action.config as Record<string, unknown>)?.delayHours ?? 0),
              text: String((action.config as Record<string, unknown>)?.text ?? ""),
              tagIds: Array.isArray((action.config as Record<string, unknown>)?.tagIds)
                ? (action.config as Record<string, unknown>).tagIds
                : [],
            })),
          }
        : {
            name: "",
            trigger: "JOIN",
            enabled: true,
            tagIds: [],
            staffUserIds: [],
            codeIds: [],
            keywords: "",
            hour: 9,
            weekdays: [],
            addedFrom: undefined,
            actions: [{ kind: "WELCOME", delayHours: 0, text: "", tagIds: [] }],
          },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const triggerConfig: Record<string, unknown> = {};
    if (values.trigger === "TAG") triggerConfig.tagIds = values.tagIds ?? [];
    if (values.trigger === "KEYWORD") {
      triggerConfig.keywords = String(values.keywords || "")
        .split(/[\n,，]/)
        .map((word: string) => word.trim())
        .filter(Boolean);
    }
    if (values.trigger === "SCHEDULE") {
      triggerConfig.hour = Number(values.hour ?? 9);
      triggerConfig.weekdays = values.weekdays ?? [];
      triggerConfig.tagIds = values.tagIds ?? [];
    }
    if (values.trigger === "JOIN" || values.trigger === "MANUAL") {
      triggerConfig.codeIds = values.codeIds ?? [];
      triggerConfig.staffUserIds = values.staffUserIds ?? [];
      triggerConfig.tagIds = values.tagIds ?? [];
      triggerConfig.addedFrom = values.addedFrom ? dayjs(values.addedFrom).format("YYYY-MM-DD") : "";
    }
    setSaving(true);
    try {
      await scrmApi.saveSop({
        body: {
          id: row?.id ?? 0,
          name: values.name,
          trigger: values.trigger,
          triggerConfig,
          actions: (values.actions ?? []).map(
            (action: { kind: string; delayHours?: number; text?: string; tagIds?: number[] }) => ({
              kind: SCRM_SOP_ACTIONS.find((item) => item === action.kind) ?? "WELCOME",
              config: {
                delayHours: Number(action.delayHours ?? 0),
                ...(action.text ? { text: action.text } : {}),
                ...(action.kind === "TAG" ? { tagIds: action.tagIds ?? [] } : {}),
              },
            }),
          ),
          enabled: Boolean(values.enabled),
        },
      });
      message.success("SOP 已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑 SOP" : "新建 SOP"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={760}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="name" label="SOP 名称" rules={[{ required: true, message: "请填写名称" }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="trigger" label="触发方式">
            <Select options={TRIGGER_OPTIONS} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>

        {trigger === "TAG" ? (
          <Form.Item name="tagIds" label="命中的标签" tooltip="留空表示任意标签变化都触发">
            <Select mode="multiple" allowClear options={tagOptionsValue} />
          </Form.Item>
        ) : null}

        {trigger === "KEYWORD" ? (
          <Form.Item
            name="keywords"
            label="入站关键词"
            rules={[{ required: true, message: "请填写关键词" }]}
            tooltip="一行一个；入站消息命中任一关键词即触发"
          >
            <Input.TextArea rows={3} placeholder="如：价格\n加盟" />
          </Form.Item>
        ) : null}

        {trigger === "SCHEDULE" ? (
          <div className="form-2col">
            <Form.Item name="hour" label="每天几点执行" tooltip="0–23，按东八区">
              <InputNumber min={0} max={23} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="weekdays" label="哪几天">
              <Select mode="multiple" allowClear options={WEEKDAY_OPTIONS} placeholder="留空表示每天" />
            </Form.Item>
            <Form.Item name="tagIds" label="筛选标签">
              <Select mode="multiple" allowClear options={tagOptionsValue} placeholder="不限" />
            </Form.Item>
          </div>
        ) : null}

        {trigger === "JOIN" || trigger === "MANUAL" ? (
          <div className="form-2col">
            <Form.Item name="tagIds" label="筛选标签">
              <Select mode="multiple" allowClear options={tagOptionsValue} placeholder="不限" />
            </Form.Item>
            <Form.Item name="codeIds" label="筛选来源活码">
              <Select
                mode="multiple"
                allowClear
                options={codes.map((code) => ({ value: code.id, label: code.name }))}
                placeholder="不限"
              />
            </Form.Item>
            <Form.Item name="staffUserIds" label="筛选归属员工">
              <Select mode="multiple" allowClear options={staffOptions} placeholder="不限" />
            </Form.Item>
            <Form.Item name="addedFrom" label="添加时间起">
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </div>
        ) : null}

        <Form.List name="actions">
          {(items, { add, remove }) => (
            <div>
              <Space style={{ marginBottom: 8 }}>
                <span>动作（按顺序执行）</span>
                <Button
                  size="small"
                  icon={<PlusOutlined aria-hidden />}
                  onClick={() => add({ kind: "WELCOME", delayHours: 0, text: "", tagIds: [] })}
                >
                  添加动作
                </Button>
              </Space>
              {items.map((item) => (
                <Space key={item.key} align="baseline" wrap style={{ marginBottom: 8 }}>
                  <Form.Item name={[item.name, "kind"]} style={{ marginBottom: 0, minWidth: 140 }}>
                    <Select options={ACTION_OPTIONS} />
                  </Form.Item>
                  <Form.Item name={[item.name, "delayHours"]} label="延迟(小时)" style={{ marginBottom: 0 }}>
                    <InputNumber min={0} max={720} />
                  </Form.Item>
                  <Form.Item name={[item.name, "text"]} label="提示文案" style={{ marginBottom: 0, minWidth: 240 }}>
                    <Input maxLength={400} placeholder="员工待办里展示的话术提示（选填）" />
                  </Form.Item>
                  <Form.Item name={[item.name, "tagIds"]} label="标签" style={{ marginBottom: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ minWidth: 160 }}
                      options={tagOptionsValue}
                      placeholder="TAG 动作必填"
                    />
                  </Form.Item>
                  <Button type="text" danger icon={<StopOutlined aria-hidden />} onClick={() => remove(item.name)} />
                </Space>
              ))}
            </div>
          )}
        </Form.List>
        <Notice variant="info">
          欢迎语/素材/群发/待办类动作只生成员工待办，员工在企微侧边栏确认后完成；
          打标与提醒类动作会直接执行。定时 SOP 在每天指定小时由调度器执行一次。
        </Notice>
      </Form>
    </Modal>
  );
}
