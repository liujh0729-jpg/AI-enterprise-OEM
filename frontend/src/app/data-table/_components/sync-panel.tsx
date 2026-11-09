"use client";

import {
  ApiOutlined,
  CopyOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  tableApi,
  type DataTableTable,
  type FeishuField,
  type FeishuRunStats,
  type FeishuSync,
  type FeishuSyncLog,
  type FeishuTable,
} from "./common";

const DIRECTION_OPTIONS = [
  { value: "both", label: "双向同步（两侧都改）" },
  { value: "pull", label: "飞书 → 本系统" },
  { value: "push", label: "本系统 → 飞书" },
];

const TRIGGER_LABEL: Record<string, string> = {
  manual: "手动同步",
  push: "本地变更推送",
  webhook: "飞书事件回调",
};

type SyncForm = {
  direction: "pull" | "push" | "both";
  app_id: string;
  app_secret: string;
  app_token: string;
  feishu_table_id: string;
  verification_token: string;
  encrypt_key: string;
};

const EMPTY_FORM: SyncForm = {
  direction: "both",
  app_id: "",
  app_secret: "",
  app_token: "",
  feishu_table_id: "",
  verification_token: "",
  encrypt_key: "",
};

function formValuesOf(sync: FeishuSync | null): SyncForm {
  return sync
    ? {
        direction: sync.direction,
        app_id: sync.appId,
        app_secret: "",
        app_token: sync.appToken,
        feishu_table_id: sync.feishuTableId,
        verification_token: sync.verificationToken,
        encrypt_key: "",
      }
    : EMPTY_FORM;
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function statsText(stats: Record<string, unknown>) {
  const parts = [
    ["拉取", stats.pulled],
    ["推送", stats.pushed],
    ["新增", stats.created],
    ["更新", stats.updated],
    ["删除", stats.deleted],
  ]
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => `${label} ${String(value)}`);
  return parts.length ? parts.join(" · ") : "无变化";
}

/**
 * 飞书多维表格同步：把这张表按「飞书→本系统 / 本系统→飞书 / 双向」同步。
 * 绑定归表归属账号；App Secret 与 Encrypt Key 只提交不回显（已存的留空即不修改）。
 * 飞书侧实时性靠应用事件的 bitable.record.changed 回调，回调地址按绑定生成。
 */
export function SyncPanel({
  table,
  onChanged,
}: {
  table: DataTableTable;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  // 回调地址的域名：飞书后台要填绝对地址，跟站点域名走
  const siteBase = useSiteBase();
  const [list, setList] = useState<FeishuSync[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeishuSync | null>(null);
  const [form] = Form.useForm<SyncForm>();
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [tables, setTables] = useState<FeishuTable[]>([]);
  const [fields, setFields] = useState<FeishuField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [logsOf, setLogsOf] = useState<FeishuSync | null>(null);
  const [logs, setLogs] = useState<FeishuSyncLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const localFields = useMemo(
    () => [...table.fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [table.fields],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const result = await tableApi.feishuSyncs(table.id);
    setList(result.data || []);
    setLoading(false);
    if (result.message) message.error(result.message);
  }, [table.id, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setTables([]);
    setFields([]);
    setMapping({});
    setOpen(true);
  };

  const openEdit = (sync: FeishuSync) => {
    setEditing(sync);
    setTables([]);
    setFields([]);
    setMapping(
      Object.fromEntries(
        sync.fieldMapping.map((item) => [item.localKey, item.feishuName]),
      ),
    );
    setOpen(true);
  };

  /** 读飞书侧的数据表与列；编辑时可以不重填 App Secret（后端用已存密文）。 */
  const preview = async (needFields: boolean) => {
    const values = form.getFieldsValue();
    if (!values.app_id?.trim() || !values.app_token?.trim()) {
      message.warning("请先填写 App ID 与 app_token");
      return;
    }
    setPreviewBusy(true);
    try {
      const result = await tableApi.previewFeishuSync(table.id, {
        sync_id: editing?.id,
        app_id: values.app_id.trim(),
        app_secret: values.app_secret?.trim() || undefined,
        app_token: values.app_token.trim(),
        feishu_table_id: values.feishu_table_id?.trim() || undefined,
      });
      setTables(result.tables);
      setFields(result.fields);
      if (!values.feishu_table_id && result.tables.length === 1) {
        form.setFieldValue("feishu_table_id", result.tables[0].tableId);
      }
      if (needFields) {
        if (!result.fields.length) {
          message.warning("请选择一个飞书数据表后再读取列");
        } else {
          const names = new Set(result.fields.map((field) => field.fieldName));
          setMapping((current) => {
            const next: Record<string, string> = {};
            for (const field of localFields) {
              const chosen =
                current[field.fieldKey] &&
                names.has(current[field.fieldKey])
                  ? current[field.fieldKey]
                  : names.has(field.name)
                    ? field.name
                    : "";
              if (chosen) next[field.fieldKey] = chosen;
            }
            return next;
          });
        }
      }
      message.success(`已读取 ${result.tables.length} 张飞书数据表`);
    } catch (error) {
      message.error((error as Error).message || "读取飞书表格失败");
    } finally {
      setPreviewBusy(false);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const fieldMapping = Object.entries(mapping)
      .filter(([, feishuName]) => Boolean(feishuName))
      .map(([localKey, feishuName]) => ({
        local_key: localKey,
        feishu_name: feishuName,
      }));
    if (!fieldMapping.length) {
      message.warning("请先读取飞书列并至少配对一列");
      return;
    }
    const body = {
      direction: values.direction,
      app_id: values.app_id.trim(),
      app_secret: values.app_secret?.trim() || undefined,
      app_token: values.app_token.trim(),
      feishu_table_id: values.feishu_table_id?.trim(),
      verification_token: values.verification_token?.trim() || "",
      encrypt_key: values.encrypt_key?.trim() || undefined,
      field_mapping: fieldMapping,
    };
    const run = async () => {
      setBusy(true);
      try {
        if (editing) {
          await tableApi.updateFeishuSync(table.id, editing.id, body);
          message.success("同步设置已保存");
        } else {
          await tableApi.createFeishuSync(table.id, body);
          message.success("已绑定飞书表格");
        }
        setOpen(false);
        form.resetFields();
        await Promise.all([load(), onChanged()]);
      } catch (error) {
        message.error((error as Error).message || "保存失败");
      } finally {
        setBusy(false);
      }
    };
    if (editing) {
      request({
        title: "修改飞书同步（需密码）",
        content: `确认保存「${table.name}」的飞书同步设置？改完后按新方向与映射生效。`,
        okText: "保存修改",
        onOk: run,
      });
      return;
    }
    await run();
  };

  const runNow = async (sync: FeishuSync) => {
    setBusy(true);
    try {
      const stats = (await tableApi.runFeishuSync(
        table.id,
        sync.id,
      )) as FeishuRunStats;
      message.success(
        `同步完成：拉取 ${stats.pulled} · 推送 ${stats.pushed} · 新增 ${stats.created} · 更新 ${stats.updated} · 删除 ${stats.deleted}`,
      );
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      message.error((error as Error).message || "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const test = async (sync: FeishuSync) => {
    try {
      const result = await tableApi.testFeishuSync(table.id, sync.id);
      message.success(`连接正常，飞书表有 ${result.fieldCount} 列`);
    } catch (error) {
      message.error((error as Error).message || "连接失败");
    }
  };

  const toggle = (sync: FeishuSync, active: boolean) => {
    const next = async () => {
      await tableApi.updateFeishuSync(table.id, sync.id, {
        status: active ? "active" : "paused",
      });
      message.success(active ? "已启用" : "已暂停");
      await load();
    };
    request({
      title: active ? "启用飞书同步（需密码）" : "暂停飞书同步（需密码）",
      content: active
        ? "启用后本地行变更与飞书事件都会实时同步。"
        : "暂停后不再接收本地变更与飞书事件，已绑定的行对应关系保留。",
      okText: active ? "启用" : "暂停",
      onOk: next,
    });
  };

  const remove = (sync: FeishuSync) => {
    request({
      title: "解除飞书同步",
      content: `确认解除与飞书表「${sync.feishuTableId}」的同步？两侧数据都不会被删除，只停掉后续同步。`,
      danger: true,
      okText: "确认解除",
      onOk: async () => {
        await tableApi.removeFeishuSync(table.id, sync.id);
        message.success("已解除绑定");
        await load();
      },
    });
  };

  const openLogs = async (sync: FeishuSync) => {
    setLogsOf(sync);
    setLogs([]);
    setLogsLoading(true);
    const result = await tableApi.feishuSyncLogs(table.id, sync.id);
    setLogs(result.data || []);
    setLogsLoading(false);
    if (result.message) message.error(result.message);
  };

  const copyWebhook = async (sync: FeishuSync) => {
    const url = joinSiteUrl(siteBase, sync.webhookPath);
    try {
      await copyText(url);
      message.success("回调地址已复制，粘贴到飞书应用的「事件订阅」里");
    } catch {
      message.warning(`请手动复制回调地址：${url}`);
    }
  };

  const columns: ColumnsType<FeishuSync> = [
    {
      title: "方向",
      dataIndex: "directionLabel",
      width: 160,
      render: (_, sync) => (
        <Space size={4} wrap>
          <Tag color={sync.direction === "both" ? "blue" : "default"}>
            {sync.directionLabel}
          </Tag>
          <Tag color={sync.status === "active" ? "green" : "default"}>
            {sync.status === "active" ? "已启用" : "已暂停"}
          </Tag>
        </Space>
      ),
    },
    {
      title: "飞书表格",
      dataIndex: "appToken",
      render: (_, sync) => (
        <div>
          <div className="text-12 mono">{sync.appToken}</div>
          <div className="text-12 muted">table_id：{sync.feishuTableId}</div>
          <div className="text-12 muted">
            映射 {sync.fieldMapping.length} 列
            {sync.hasEncryptKey ? " · 事件加密" : ""}
          </div>
        </div>
      ),
    },
    {
      title: "回调地址",
      dataIndex: "webhookPath",
      width: 150,
      render: (_, sync) =>
        sync.direction === "push" ? (
          <span className="text-12 muted">仅本系统 → 飞书，无需回调</span>
        ) : (
          <Button icon={<CopyOutlined />} onClick={() => void copyWebhook(sync)}>
            复制
          </Button>
        ),
    },
    {
      title: "最近同步",
      dataIndex: "lastSyncAt",
      width: 190,
      render: (value: string | null, sync) => (
        <div>
          <div className="text-12">
            {value ? new Date(value).toLocaleString("zh-CN") : "尚未同步"}
          </div>
          {sync.lastError ? (
            <div className="text-12" style={{ color: "var(--danger)" }}>
              {sync.lastError}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 330,
      render: (_, sync) => (
        <Space size={4} wrap>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            disabled={busy}
            onClick={() => void runNow(sync)}
          >
            立即同步
          </Button>
          <Button onClick={() => void test(sync)}>
            测试连接
          </Button>
          <Button onClick={() => void openLogs(sync)}>
            日志
          </Button>
          <Button onClick={() => openEdit(sync)}>
            编辑
          </Button>
          <Button onClick={() => toggle(sync, sync.status !== "active")}>
            {sync.status === "active" ? "暂停" : "启用"}
          </Button>
          <Button danger onClick={() => remove(sync)}>
            解除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="飞书多维表格同步"
      titleExtra={
        <span className="text-12 muted">
          按列把这张表与飞书多维表格双向打通，飞书侧改动通过应用事件实时回写
        </span>
      }
      extra={
        <Button icon={<PlusOutlined />} onClick={openCreate}>
          绑定飞书表格
        </Button>
      }
    >
      <Notice>
        绑定前请先在飞书开放平台创建企业自建应用，开通「查看、评论、编辑和管理多维表格」
        权限，并把回调地址加到应用的「事件订阅」；订阅
        <code> bitable.record.changed </code>事件。App Secret 与 Encrypt Key
        只保存密文，保存后不回显。
      </Notice>
      <div style={{ marginTop: 12 }}>
        {list.length ? (
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={list}
            pagination={false}
          />
        ) : (
          <EmptyState
            icon={<ApiOutlined />}
            text="还没有绑定飞书表格：点右上角「绑定飞书表格」开始配置"
          />
        )}
      </div>

      <Modal
        open={open}
        title={editing ? "编辑飞书同步" : "绑定飞书表格"}
        width={880}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onOk={() => void submit()}
        okText={editing ? "保存修改" : "保存绑定"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form
          key={editing?.id ?? "new"}
          form={form}
          layout="vertical"
          initialValues={formValuesOf(editing)}
        >
          <Space size={12} style={{ display: "flex" }} align="start">
            <Form.Item
              name="app_id"
              label="飞书应用 App ID"
              rules={[{ required: true, message: "请填写 App ID" }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="cli_xxxxxxxx" />
            </Form.Item>
            <Form.Item
              name="app_secret"
              label="App Secret"
              rules={
                editing
                  ? []
                  : [{ required: true, message: "请填写 App Secret" }]
              }
              style={{ flex: 1 }}
              extra={
                editing ? "已保存，留空表示不修改" : "仅保存密文，保存后不回显"
              }
            >
              <Input.Password placeholder={editing ? "留空不修改" : "应用凭证"} />
            </Form.Item>
          </Space>
          <Form.Item
            name="app_token"
            label="多维表格 app_token"
            rules={[{ required: true, message: "请填写 app_token" }]}
            extra="飞书多维表格链接里 /base/ 后面那一串"
          >
            <Input placeholder="bascnxxxxxxxx" />
          </Form.Item>

          <Space size={12} align="end" style={{ display: "flex" }}>
            <Form.Item
              name="feishu_table_id"
              label="飞书数据表"
              rules={[{ required: true, message: "请选择飞书数据表" }]}
              style={{ flex: 1 }}
            >
              <Select
                placeholder="先点右侧读取，再选择数据表"
                options={tables.map((item) => ({
                  value: item.tableId,
                  label: item.name,
                }))}
                onChange={() => void preview(true)}
              />
            </Form.Item>
            <Form.Item label=" " style={{ marginBottom: 24 }}>
              <Button
                loading={previewBusy}
                onClick={() => void preview(Boolean(form.getFieldValue("feishu_table_id")))}
              >
                读取飞书数据表
              </Button>
            </Form.Item>
          </Space>

          <Form.Item
            name="direction"
            label="同步方向"
            rules={[{ required: true }]}
            extra="双向模式按两侧最后修改时间取较新的一方；首次绑定不猜同一行，两侧已有数据会各算一条。"
          >
            <Select options={DIRECTION_OPTIONS} />
          </Form.Item>

          <Form.Item
            label="字段映射"
            extra="按本地列选择飞书字段；不映射的列不参与同步。"
          >
            {fields.length ? (
              <Table
                rowKey="fieldKey"
                size="small"
                pagination={false}
                dataSource={localFields}
                columns={[
                  {
                    title: "本系统列",
                    dataIndex: "name",
                    render: (_, field) => (
                      <span>
                        {field.name}
                        <span className="text-12 muted"> · {field.fieldKey}</span>
                      </span>
                    ),
                  },
                  {
                    title: "飞书字段",
                    key: "feishu",
                    render: (_, field) => (
                      <Select
                        allowClear
                        placeholder="不映射"
                        style={{ width: "100%" }}
                        value={mapping[field.fieldKey]}
                        options={fields.map((item) => ({
                          value: item.fieldName,
                          label: item.fieldName,
                        }))}
                        onChange={(value) =>
                          setMapping((current) => ({
                            ...current,
                            [field.fieldKey]: value || "",
                          }))
                        }
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <div className="text-12 muted">
                先填写 app_token 并「读取飞书数据表」，选择数据表后这里会列出可配对的列。
              </div>
            )}
          </Form.Item>

          <Space size={12} style={{ display: "flex" }} align="start">
            <Form.Item
              name="verification_token"
              label="事件 Verification Token（可选）"
              style={{ flex: 1 }}
              extra="填写后回调会核对报文里的 token，防止伪造推送。"
            >
              <Input placeholder="飞书事件订阅里的 Verification Token" />
            </Form.Item>
            <Form.Item
              name="encrypt_key"
              label="事件 Encrypt Key（可选）"
              style={{ flex: 1 }}
              extra={
                editing && editing.hasEncryptKey
                  ? "已保存，留空表示不修改"
                  : "飞书开启事件加密时填写，仅保存密文"
              }
            >
              <Input.Password placeholder={editing ? "留空不修改" : "未开启加密可留空"} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={Boolean(logsOf)}
        title={`同步日志 · ${logsOf?.directionLabel || ""}`}
        width={720}
        footer={null}
        onCancel={() => setLogsOf(null)}
        destroyOnHidden
      >
        <Table
          rowKey="id"
          size="small"
          loading={logsLoading}
          pagination={false}
          dataSource={logs}
          locale={{ emptyText: "还没有同步记录" }}
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 170,
              render: (value: string) =>
                new Date(value).toLocaleString("zh-CN"),
            },
            {
              title: "触发",
              dataIndex: "trigger",
              width: 110,
              render: (value: string) => TRIGGER_LABEL[value] || value,
            },
            {
              title: "结果",
              dataIndex: "status",
              width: 80,
              render: (value: string) => (
                <Tag color={value === "success" ? "green" : "red"}>
                  {value === "success" ? "成功" : "失败"}
                </Tag>
              ),
            },
            {
              title: "明细",
              key: "stats",
              render: (_, log) => (
                <span className="text-12">
                  {statsText(log.stats)}
                  {log.message ? ` · ${log.message}` : ""}
                </span>
              ),
            },
          ]}
        />
      </Modal>
      {modal}
    </Panel>
  );
}
