"use client";

import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { ONBOARD_OWNER_ROLE_LABELS } from "@enterprise/contracts";
import { orgStaffApi } from "@/api/collab";
import {
  gapsApi,
  type OnboardingRun,
  type OnboardingTemplate,
} from "@/api/gaps";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { gapError, gapStatusTag, zhDay, zhTime } from "@/app/gaps/_components/gaps-common";

type Mode = "templates" | "runs";

type StaffOption = { value: string; label: string };

const ROLE_OPTIONS = Object.entries(ONBOARD_OWNER_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** B3#27 入职引导清单：模板（按角色分工的事项）→ 流程实例（逐条勾选，全完成自动收口）。 */
export function GapsOnboardingTab() {
  const [mode, setMode] = useState<Mode>("runs");
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [runs, setRuns] = useState<OnboardingRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateForm] = Form.useForm();
  const [startOpen, setStartOpen] = useState(false);
  const [startForm] = Form.useForm();
  const [detail, setDetail] = useState<OnboardingRun | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates((await gapsApi.onboardingTemplates()) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.onboardingRuns({
        query: { page, pageSize: 20, status: status || undefined },
      });
      setRuns(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    if (mode === "templates") void loadTemplates();
    else void loadRuns();
  }, [mode, loadTemplates, loadRuns]);

  useEffect(() => {
    void orgStaffApi
      .workspace()
      .then((data) => {
        setStaff(
          (data?.staff || [])
            .filter((row) => row.status !== "REMOVED")
            .map((row) => ({
              value: row.memberUserId,
              label: `${row.realName || row.memberUserId} · ${row.memberKindLabel || "职员"}${row.department ? `（${row.department}）` : ""}`,
            })),
        );
      })
      .catch(() => setStaff([]));
  }, []);

  const openTemplate = (row?: OnboardingTemplate) => {
    templateForm.resetFields();
    if (row) {
      templateForm.setFieldsValue({
        id: row.id,
        name: row.name,
        kind: row.kind,
        description: row.description,
        active: row.active,
        items: row.items.map((item) => ({
          title: item.title,
          description: item.description,
          ownerRole: item.ownerRole,
          dueDays: item.dueDays,
          sort: item.sort,
        })),
      });
    }
    setTemplateOpen(true);
  };

  const saveTemplate = async () => {
    try {
      const values = await templateForm.validateFields();
      await gapsApi.saveOnboardingTemplate({ body: values });
      message.success("入职模板已保存");
      setTemplateOpen(false);
      await loadTemplates();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const startRun = async () => {
    try {
      const values = await startForm.validateFields();
      await gapsApi.startOnboardingRun({
        body: {
          templateId: values.templateId,
          staffUserId: values.staffUserId,
          memberUserId: "",
          offerId: 0,
        },
      });
      message.success("入职流程已发起");
      setStartOpen(false);
      startForm.resetFields();
      setMode("runs");
      await loadRuns();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const openRun = async (row: OnboardingRun) => {
    try {
      setDetail(await gapsApi.onboardingRun({ params: { id: String(row.id) } }));
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const completeTask = async (taskId: number, nextStatus: "DONE" | "SKIPPED" | "TODO") => {
    if (!detail) return;
    try {
      const updated = await gapsApi.completeOnboardingTask({
        params: { taskId: String(taskId) },
        body: { status: nextStatus, note: "" },
      });
      setDetail(updated);
      await loadRuns();
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const templateColumns: ColumnsType<OnboardingTemplate> = [
    { title: "模板名称", dataIndex: "name" },
    { title: "类型", dataIndex: "kindLabel", width: 110 },
    {
      title: "引导事项",
      width: 100,
      render: (_, row) => `${row.items.length} 条`,
    },
    {
      title: "状态",
      width: 90,
      render: (_, row) => (row.active ? gapStatusTag("ACTIVE") : gapStatusTag("ARCHIVED")),
    },
    { title: "更新时间", width: 160, render: (_, row) => zhTime(row.updatedAt) },
    {
      title: "操作",
      width: 140,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openTemplate(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeOnboardingTemplate({ body: { id: row.id } });
                message.success("已删除");
                await loadTemplates();
              } catch (err) {
                message.error(gapError(err));
              }
            }}
          >
            删除
          </Button>
        </>
      ),
    },
  ];

  const runColumns: ColumnsType<OnboardingRun> = [
    {
      title: "入职成员",
      dataIndex: "staffUserId",
      render: (value: string) => staff.find((item) => item.value === value)?.label || value || "—",
    },
    { title: "模板", dataIndex: "templateName" },
    {
      title: "进度",
      width: 180,
      render: (_, row) => (
        <Progress
          percent={row.total ? Math.round((row.done / row.total) * 100) : 0}
          size="small"
          format={() => `${row.done}/${row.total}`}
        />
      ),
    },
    { title: "状态", width: 90, render: (_, row) => gapStatusTag(row.status) },
    { title: "开始时间", width: 160, render: (_, row) => zhTime(row.startedAt) },
    {
      title: "操作",
      width: 90,
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => void openRun(row)}>
          查看清单
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title="入职引导清单"
      titleExtra="Offer 接受时自动按「员工入职」模板开工；事项按角色分工，全部完成后自动收口"
      extra={
        <PillTabs
          items={[
            { key: "runs", label: "入职流程" },
            { key: "templates", label: "模板配置" },
          ]}
          value={mode}
          onChange={(key) => setMode(key as Mode)}
        />
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {mode === "templates" ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Button type="primary" onClick={() => openTemplate()}>
              新建模板
            </Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={templateColumns}
            dataSource={templates}
            pagination={false}
            scroll={{ x: 760 }}
          />
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="primary"
              onClick={() => {
                startForm.resetFields();
                setStartOpen(true);
              }}
            >
              发起入职流程
            </Button>
            <Select
              allowClear
              placeholder="按状态筛选"
              style={{ width: 160 }}
              value={status || undefined}
              onChange={(value) => {
                setStatus(value || "");
                setPage(1);
              }}
              options={[
                { value: "ACTIVE", label: "进行中" },
                { value: "DONE", label: "已完成" },
                { value: "CANCELED", label: "已取消" },
              ]}
            />
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={runColumns}
            dataSource={runs}
            scroll={{ x: 900 }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
        </>
      )}

      <Modal
        open={templateOpen}
        title={templateForm.getFieldValue("id") ? "编辑入职模板" : "新建入职模板"}
        onCancel={() => setTemplateOpen(false)}
        onOk={() => void saveTemplate()}
        width={720}
        destroyOnHidden
      >
        <Form
          form={templateForm}
          layout="vertical"
          initialValues={{ kind: "HIRE", active: true, items: [{ ownerRole: "HR", dueDays: 1 }] }}
        >
          <Form.Item name="id" hidden>
            <InputNumber />
          </Form.Item>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: "请填写模板名称" }]}>
            <Input maxLength={80} placeholder="如：正式员工入职" />
          </Form.Item>
          <Form.Item name="kind" label="类型">
            <Select
              options={[
                { value: "HIRE", label: "员工入职" },
                { value: "ADMIN", label: "管理员开通" },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ display: "flex", marginBottom: 6 }} wrap>
                    <Form.Item
                      name={[field.name, "title"]}
                      rules={[{ required: true, message: "请填写事项" }]}
                      style={{ width: 220, marginBottom: 0 }}
                    >
                      <Input placeholder="引导事项" maxLength={120} />
                    </Form.Item>
                    <Form.Item name={[field.name, "ownerRole"]} style={{ width: 120, marginBottom: 0 }}>
                      <Select options={ROLE_OPTIONS} />
                    </Form.Item>
                    <Form.Item name={[field.name, "dueDays"]} style={{ width: 110, marginBottom: 0 }}>
                      <InputNumber min={0} max={365} suffix="天" style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name={[field.name, "description"]} style={{ width: 240, marginBottom: 0 }}>
                      <Input placeholder="说明（可选）" maxLength={500} />
                    </Form.Item>
                    <Button type="link" danger onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add({ ownerRole: "HR", dueDays: 1 })}>
                  添加事项
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={startOpen}
        title="发起入职流程"
        onCancel={() => setStartOpen(false)}
        onOk={() => void startRun()}
        destroyOnHidden
      >
        <Form form={startForm} layout="vertical">
          <Form.Item name="templateId" label="入职模板" rules={[{ required: true, message: "请选择模板" }]}>
            <Select
              options={templates
                .filter((item) => item.active)
                .map((item) => ({ value: item.id, label: `${item.name}（${item.items.length} 条）` }))}
            />
          </Form.Item>
          <Form.Item name="staffUserId" label="入职成员" rules={[{ required: true, message: "请选择成员" }]}>
            <Select showSearch optionFilterProp="label" options={staff} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        size={560}
        title={`入职清单 · ${detail?.templateName || ""}`}
        onClose={() => setDetail(null)}
        destroyOnHidden
      >
        {detail ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Space wrap>
                {gapStatusTag(detail.status)}
                <span className="text-12 muted">
                  由 {staff.find((item) => item.value === detail.staffUserId)?.label || detail.staffUserId} 于{" "}
                  {zhDay(detail.startedAt)} 发起，已完成 {detail.done}/{detail.total}
                </span>
              </Space>
            </div>
            <List
              size="small"
              bordered
              dataSource={detail.tasks}
              renderItem={(task) => (
                <List.Item
                  actions={[
                    task.status === "TODO" ? (
                      <Button key="done" size="small" type="link" onClick={() => void completeTask(task.id, "DONE")}>
                        完成
                      </Button>
                    ) : (
                      <Button key="undo" size="small" type="link" onClick={() => void completeTask(task.id, "TODO")}>
                        撤销
                      </Button>
                    ),
                    task.status === "TODO" ? (
                      <Button key="skip" size="small" type="link" onClick={() => void completeTask(task.id, "SKIPPED")}>
                        跳过
                      </Button>
                    ) : null,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6} wrap>
                        <span>{task.title}</span>
                        <Tag>{task.ownerRoleLabel}</Tag>
                        {gapStatusTag(task.status)}
                      </Space>
                    }
                    description={
                      <span className="text-12 muted">
                        {task.description || "—"} · 截止 {zhDay(task.dueAt)}
                      </span>
                    }
                  />
                </List.Item>
              )}
            />
          </>
        ) : null}
      </Drawer>
    </Panel>
  );
}
