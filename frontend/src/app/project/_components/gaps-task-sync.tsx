"use client";

import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  TASK_SYNC_PROVIDERS,
  TASK_SYNC_PROVIDER_LABELS,
} from "@enterprise/contracts";
import { projectApi } from "@/api/project";
import {
  gapsApi,
  type TaskSyncBinding,
  type TaskSyncLink,
  type TaskSyncRun,
} from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

const PROVIDER_OPTIONS = TASK_SYNC_PROVIDERS.map((value) => ({
  value,
  label: TASK_SYNC_PROVIDER_LABELS[value],
}));

/** B3#23 三方任务双向同步：Jira / Teambition / TAPD 与本地项目任务互相推送与拉取。 */
export function GapsTaskSyncTab() {
  const [rows, setRows] = useState<TaskSyncBinding[]>([]);
  const [projects, setProjects] = useState<{ value: number; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [runningId, setRunningId] = useState(0);
  const [records, setRecords] = useState<TaskSyncBinding | null>(null);
  const [runs, setRuns] = useState<TaskSyncRun[]>([]);
  const [links, setLinks] = useState<TaskSyncLink[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await gapsApi.taskSyncBindings({ query: {} })) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void projectApi
      .projects({ query: { page: 1, pageSize: 200 } })
      .then((data) =>
        setProjects(
          (data?.list || []).map((row) => ({ value: row.id, label: row.name })),
        ),
      )
      .catch(() => setProjects([]));
  }, [load]);

  const openForm = (row?: TaskSyncBinding) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        id: row.id,
        projectId: row.projectId,
        provider: row.provider,
        baseUrl: row.baseUrl,
        projectKey: row.projectKey,
        username: row.username,
        token: "",
        enabled: row.enabled,
      });
    }
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await gapsApi.saveTaskSyncBinding({ body: values });
      message.success("同步绑定已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const run = async (row: TaskSyncBinding) => {
    setRunningId(row.id);
    try {
      const result = await gapsApi.runTaskSync({
        params: { id: String(row.id) },
        body: { direction: "BOTH" },
      });
      message.success(
        `同步完成：推送 ${result?.pushed ?? 0}、拉取 ${result?.pulled ?? 0}、失败 ${result?.failed ?? 0}`,
      );
      await load();
    } catch (err) {
      message.error(gapError(err));
    } finally {
      setRunningId(0);
    }
  };

  const openRecords = async (row: TaskSyncBinding) => {
    setRecords(row);
    try {
      const [runData, linkData] = await Promise.all([
        gapsApi.taskSyncRuns({ params: { id: String(row.id) }, query: { page: 1, pageSize: 50 } }),
        gapsApi.taskSyncLinks({ params: { id: String(row.id) }, query: { page: 1, pageSize: 50 } }),
      ]);
      setRuns(runData?.list || []);
      setLinks(linkData?.list || []);
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<TaskSyncBinding> = [
    { title: "本地项目", dataIndex: "projectName" },
    { title: "平台", dataIndex: "providerLabel", width: 110 },
    { title: "地址", dataIndex: "baseUrl", ellipsis: true },
    { title: "项目键", dataIndex: "projectKey", width: 120 },
    {
      title: "凭据",
      width: 90,
      render: (_, row) => (row.hasToken ? <Tag color="green">已保存</Tag> : <Tag>未设置</Tag>),
    },
    {
      title: "状态",
      width: 80,
      render: (_, row) => (row.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: "关联任务", width: 90, render: (_, row) => `${row.links} 个` },
    {
      title: "最近同步",
      width: 150,
      render: (_, row) => (row.lastRunAt ? zhTime(row.lastRunAt) : "—"),
    },
    {
      title: "最近结果",
      dataIndex: "lastResult",
      ellipsis: true,
    },
    {
      title: "操作",
      width: 260,
      render: (_, row) => (
        <>
          <Button
            size="small"
            type="link"
            loading={runningId === row.id}
            onClick={() => void run(row)}
          >
            立即同步
          </Button>
          <Button size="small" type="link" onClick={() => void openRecords(row)}>
            记录
          </Button>
          <Button size="small" type="link" onClick={() => openForm(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeTaskSyncBinding({ body: { id: row.id } });
                message.success("已删除");
                await load();
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

  return (
    <Panel
      title="三方任务同步"
      titleExtra="Jira / Teambition / TAPD：本地任务推送为远端任务，远端状态回写本地；每次同步留运行记录"
      extra={
        <Button type="primary" onClick={() => openForm()}>
          新建绑定
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={false}
      />

      <Modal
        open={open}
        title={form.getFieldValue("id") ? "编辑同步绑定" : "新建同步绑定"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={620}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ provider: "JIRA", enabled: true }}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="projectId" label="本地项目" rules={[{ required: true, message: "请选择项目" }]}>
            <Select showSearch optionFilterProp="label" options={projects} />
          </Form.Item>
          <Form.Item name="provider" label="远端平台" rules={[{ required: true, message: "请选择平台" }]}>
            <Select options={PROVIDER_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="平台地址"
            rules={[{ required: true, message: "请填写平台地址" }]}
            extra="如 https://your-domain.atlassian.net；地址只允许 http/https 且会做内网地址拦截"
          >
            <Input maxLength={300} placeholder="https://…" />
          </Form.Item>
          <Form.Item name="projectKey" label="项目键 / 项目 ID" extra="Jira 填项目 Key；Teambition 填项目 ID；TAPD 可留空">
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="username" label="账号" extra="Jira 必填（邮箱或用户名）；TAPD 填 API 用户">
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item
            name="token"
            label="API Token"
            extra={form.getFieldValue("id") ? "留空表示沿用已保存的 Token（加密存储，不回显）" : "Jira 使用 API Token；TAPD 使用 API 密码"}
          >
            <Input.Password maxLength={500} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(records)}
        size={720}
        title={`同步记录 · ${records?.projectName || ""}`}
        onClose={() => setRecords(null)}
        destroyOnHidden
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>运行记录</div>
        <Table
          rowKey="id"
          size="small"
          dataSource={runs}
          pagination={false}
          columns={[
            { title: "时间", width: 150, render: (_, row) => zhTime(row.createdAt) },
            { title: "方向", dataIndex: "direction", width: 80 },
            { title: "推送", dataIndex: "pushed", width: 70 },
            { title: "拉取", dataIndex: "pulled", width: 70 },
            { title: "失败", dataIndex: "failed", width: 70 },
            { title: "说明", dataIndex: "message", ellipsis: true },
          ]}
        />
        <div style={{ fontWeight: 600, margin: "18px 0 8px" }}>任务映射</div>
        <Table
          rowKey="id"
          size="small"
          dataSource={links}
          pagination={false}
          columns={[
            { title: "本地任务", dataIndex: "taskTitle", ellipsis: true },
            { title: "远端 ID", dataIndex: "remoteId", width: 140 },
            { title: "远端键", dataIndex: "remoteKey", width: 120 },
            { title: "远端状态", dataIndex: "remoteStatus", width: 110 },
            { title: "同步时间", width: 150, render: (_, row) => zhTime(row.lastSyncedAt) },
          ]}
        />
      </Drawer>
    </Panel>
  );
}
