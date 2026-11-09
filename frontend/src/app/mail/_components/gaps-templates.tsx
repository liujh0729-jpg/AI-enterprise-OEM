"use client";

import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { mailApi } from "@/api/mail";
import { gapsApi, type MailTemplate } from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

type Preview = { subject: string; html: string; text: string; missing: string[] };

/** B1#10 邮件模板体系：变量占位模板 + 预览（缺失变量提示）+ 用已接入邮箱发测试信。 */
export function GapsMailTemplatesTab() {
  const [rows, setRows] = useState<MailTemplate[]>([]);
  const [accounts, setAccounts] = useState<{ value: number; label: string }[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [active, setActive] = useState<MailTemplate | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await gapsApi.mailTemplates({ query: { q: keyword.trim() || undefined } })) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void mailApi
      .accounts()
      .then((data) =>
        setAccounts(
          (data || []).map((row) => ({
            value: row.id,
            label: `${row.displayName || row.address}（${row.address}）`,
          })),
        ),
      )
      .catch(() => setAccounts([]));
  }, []);

  const openEditor = (row?: MailTemplate) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        id: row.id,
        code: row.code,
        name: row.name,
        locale: row.locale,
        subject: row.subject,
        html: row.html,
        text: row.text,
        enabled: row.enabled,
        variables: row.variables,
      });
    }
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await gapsApi.saveMailTemplate({ body: values });
      message.success("邮件模板已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const openPreview = (row: MailTemplate) => {
    setActive(row);
    setVars(Object.fromEntries(row.variables.map((item) => [item.key, ""])));
    setPreview(null);
  };

  const renderPreview = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const result = await gapsApi.previewMailTemplate({
        body: {
          id: active.id,
          subject: active.subject,
          html: active.html,
          text: active.text,
          variables: vars,
        },
      });
      setPreview(result);
    } catch (err) {
      message.error(gapError(err));
    } finally {
      setBusy(false);
    }
  };

  const openSend = (row: MailTemplate) => {
    setActive(row);
    setVars(Object.fromEntries(row.variables.map((item) => [item.key, ""])));
    sendForm.resetFields();
    setSendOpen(true);
  };

  const send = async () => {
    if (!active) return;
    try {
      const values = await sendForm.validateFields();
      setBusy(true);
      const result = await gapsApi.sendTestMail({
        body: {
          id: active.id,
          mailboxId: values.mailboxId,
          to: values.to,
          variables: vars,
        },
      });
      message.success(`测试邮件已发送，已存入 ${result?.savedTo || "已发送邮件"}`);
      setSendOpen(false);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    } finally {
      setBusy(false);
    }
  };

  const variableInputs = active?.variables.length ? (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {active.variables.map((item) => (
        <div key={item.key}>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>
            {item.label || item.key}
            {item.required ? "（必填）" : ""} · {"{{" + item.key + "}}"}
          </div>
          <Input
            value={vars[item.key] ?? ""}
            onChange={(event) => setVars((prev) => ({ ...prev, [item.key]: event.target.value }))}
            placeholder={item.label || item.key}
          />
        </div>
      ))}
    </Space>
  ) : (
    <div className="text-12 muted">该模板没有变量，可直接预览或发送。</div>
  );

  const columns: ColumnsType<MailTemplate> = [
    { title: "模板名称", dataIndex: "name" },
    { title: "编码", dataIndex: "code", width: 160 },
    { title: "语言", dataIndex: "locale", width: 90 },
    { title: "主题", dataIndex: "subject", ellipsis: true },
    {
      title: "变量",
      width: 80,
      render: (_, row) => `${row.variables.length} 个`,
    },
    {
      title: "状态",
      width: 80,
      render: (_, row) => (row.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: "更新",
      width: 190,
      render: (_, row) => (
        <span className="text-12 muted">
          {row.updatedBy || "—"} · {zhTime(row.updatedAt)}
        </span>
      ),
    },
    {
      title: "操作",
      width: 230,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openPreview(row)}>
            预览
          </Button>
          <Button size="small" type="link" onClick={() => openSend(row)}>
            发测试
          </Button>
          <Button size="small" type="link" onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeMailTemplate({ body: { id: row.id } });
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
      title="邮件模板"
      titleExtra="模板变量用 {{key}} 占位；预览会列出缺失变量，发测试信走已接入邮箱并从发件箱留档"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="按名称 / 编码搜索"
            style={{ width: 200 }}
            onSearch={setKeyword}
          />
          <Button type="primary" onClick={() => openEditor()}>
            新建模板
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1100 }}
        pagination={false}
      />

      <Modal
        open={open}
        title={form.getFieldValue("id") ? "编辑邮件模板" : "新建邮件模板"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={860}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ locale: "zh-CN", enabled: true, variables: [] }}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写编码" }]} style={{ width: 220 }}>
              <Input maxLength={48} placeholder="quotation_send" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]} style={{ width: 260 }}>
              <Input maxLength={80} placeholder="报价单发送通知" />
            </Form.Item>
            <Form.Item name="locale" label="语言" style={{ width: 120 }}>
              <Input maxLength={16} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="subject" label="主题" rules={[{ required: true, message: "请填写主题" }]}>
            <Input maxLength={200} placeholder="报价单 {{quotationNo}} 已送达" />
          </Form.Item>
          <Form.Item name="html" label="HTML 正文">
            <Input.TextArea rows={8} maxLength={200000} />
          </Form.Item>
          <Form.Item name="text" label="纯文本正文">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
          <Form.List name="variables">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 6 }} wrap>
                    <Form.Item
                      name={[field.name, "key"]}
                      rules={[{ required: true, message: "变量名" }]}
                      style={{ width: 180, marginBottom: 0 }}
                    >
                      <Input placeholder="变量名，如 quotationNo" maxLength={48} />
                    </Form.Item>
                    <Form.Item name={[field.name, "label"]} style={{ width: 220, marginBottom: 0 }}>
                      <Input placeholder="显示名，如 报价单号" maxLength={64} />
                    </Form.Item>
                    <Form.Item name={[field.name, "required"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch checkedChildren="必填" unCheckedChildren="可选" />
                    </Form.Item>
                    <Button type="link" danger onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add({ key: "", label: "", required: false })}>
                  添加变量
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={Boolean(active) && !sendOpen}
        title={`模板预览 · ${active?.name || ""}`}
        onCancel={() => setActive(null)}
        width={760}
        footer={
          <Space>
            <Button onClick={() => setActive(null)}>关闭</Button>
            <Button type="primary" loading={busy} onClick={() => void renderPreview()}>
              渲染预览
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {variableInputs}
        {preview ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600 }}>{preview.subject}</div>
            {preview.missing.length ? (
              <Notice variant="warn">缺少变量：{preview.missing.join("、")}</Notice>
            ) : null}
            <iframe
              title="邮件模板预览"
              sandbox=""
              srcDoc={preview.html || `<pre>${preview.text}</pre>`}
              style={{
                width: "100%",
                height: 380,
                marginTop: 8,
                border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
                borderRadius: 6,
              }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={sendOpen}
        title={`发送测试邮件 · ${active?.name || ""}`}
        onCancel={() => setSendOpen(false)}
        onOk={() => void send()}
        confirmLoading={busy}
        width={620}
        destroyOnHidden
      >
        <Form form={sendForm} layout="vertical">
          <Form.Item name="mailboxId" label="发件邮箱" rules={[{ required: true, message: "请选择发件邮箱" }]}>
            <Select options={accounts} />
          </Form.Item>
          <Form.Item name="to" label="收件人" rules={[{ required: true, message: "请填写收件人" }]}>
            <Input maxLength={200} placeholder="name@example.com" />
          </Form.Item>
        </Form>
        <div style={{ fontWeight: 600, margin: "8px 0" }}>模板变量</div>
        {variableInputs}
      </Modal>
    </Panel>
  );
}
