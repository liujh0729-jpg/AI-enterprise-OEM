"use client";

import {
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  SERVICE_DESK_CHANNEL_SPECS,
  type ServiceDeskChannel,
  type ServiceDeskChannelKind,
  type ServiceDeskChannelKindSpec,
} from "@enterprise/contracts";
import { serviceDeskApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

type EditorState = {
  id: number;
  kind: ServiceDeskChannelKind;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  callbackPath: string;
  configured: string[];
};

const specOf = (kind: string) =>
  SERVICE_DESK_CHANNEL_SPECS.find((item) => item.kind === kind);

const DEFAULT_KIND: ServiceDeskChannelKind = "wecom_kf";

const { TextArea } = Input;

export function ChannelsPanel() {
  const [rows, setRows] = useState<ServiceDeskChannel[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  // 回调地址的域名：各渠道官方后台要填绝对地址，跟站点域名走
  const origin = useSiteBase();

  const load = async () => {
    try {
      setRows((await serviceDeskApi.channels()) || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const spec = useMemo(
    () => (editor ? specOf(editor.kind) : undefined),
    [editor],
  );

  const openNew = (kind: ServiceDeskChannelKind) => {
    const target = specOf(kind) as ServiceDeskChannelKindSpec;
    setEditor({
      id: 0,
      kind,
      name: target.label,
      config: target.samples ? { ...target.samples } : {},
      enabled: true,
      callbackPath: "",
      configured: [],
    });
  };

  const openEdit = (row: ServiceDeskChannel) => {
    setEditor({
      id: row.id,
      kind: row.kind as ServiceDeskChannelKind,
      name: row.name,
      config: { ...row.config },
      enabled: row.enabled,
      callbackPath: row.callbackPath,
      configured: row.configured,
    });
  };

  const save = async () => {
    if (!editor) return;
    const target = specOf(editor.kind);
    if (!target) return;
    if (!editor.name.trim()) {
      message.warning("请填写渠道名称");
      return;
    }
    const missing = target.fields.filter(
      (field) =>
        field.required &&
        !(editor.config[field.key]?.trim() || editor.configured.includes(field.key)),
    );
    if (missing.length) {
      message.warning(`请填写「${missing.map((field) => field.label).join("、")}」`);
      return;
    }
    const config: Record<string, string> = {};
    for (const field of target.fields) {
      const value = editor.config[field.key]?.trim();
      if (value) config[field.key] = value;
    }
    try {
      setSaving(true);
      await serviceDeskApi.saveChannel({
        body: {
          id: editor.id || undefined,
          kind: editor.kind,
          name: editor.name.trim(),
          config,
          enabled: editor.enabled,
        },
      });
      setEditor(null);
      message.success(
        editor.id
          ? "已保存"
          : editor.kind === "custom"
            ? "已接入，把回调地址配到你方平台即可开始收消息"
            : "已接入，把回调地址填到官方后台即可开始收消息",
      );
      void load();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: ServiceDeskChannel, enabled: boolean) => {
    try {
      await serviceDeskApi.saveChannel({
        body: {
          id: row.id,
          kind: row.kind as ServiceDeskChannelKind,
          name: row.name,
          config: {},
          enabled,
        },
      });
      void load();
    } catch (error) {
      message.error((error as Error).message || "操作失败");
    }
  };

  const test = async (row: ServiceDeskChannel) => {
    try {
      const result = await serviceDeskApi.testChannel({
        params: { id: String(row.id) },
      });
      if (result?.ok) message.success(result.message || "连接正常");
      else message.error(result?.message || "测试失败");
    } catch (error) {
      message.error((error as Error).message || "测试失败");
    }
  };

  const remove = async (row: ServiceDeskChannel) => {
    try {
      await serviceDeskApi.removeChannel({ params: { id: String(row.id) } });
      void load();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  return (
    <>
      <Panel
        title="渠道接入"
        extra={
          <Button type="primary" onClick={() => openNew(DEFAULT_KIND)}>
            接入新渠道
          </Button>
        }
      >
        <div className="muted" style={{ marginBottom: 12 }}>
          资质由你自己在官方开放平台申请，拿到凭据后填到这里即可对接。
          平台通道只接「官方 API + 双向收发」：群机器人这类只能推送的、以及第三方协议（OneBot
          等）都不接。自己的平台/内部系统走下面最后一个「自定义渠道」，入站映射和出站地址都由你配。
        </div>
        {rows.length ? (
          rows.map((row) => (
            <div className="sd-site-card" key={row.id}>
              <div className="sd-site-head">
                <strong>{row.name}</strong>
                <Tag>{row.kindLabel}</Tag>
                <Tag color={row.enabled ? "green" : undefined}>
                  {row.enabled ? "启用" : "停用"}
                </Tag>
                <span className="muted">
                  {row.lastEventAt
                    ? `最近接收：${fmtTime(row.lastEventAt)}`
                    : "尚未收到消息"}
                </span>
                <Space style={{ marginLeft: "auto" }}>
                  <Switch
                    checked={row.enabled}
                    onChange={(value) => void toggle(row, value)}
                  />
                  <Button onClick={() => void test(row)}>测试连接</Button>
                  <Button onClick={() => openEdit(row)}>编辑</Button>
                  <Popconfirm
                    title="删除后该渠道的会话和凭据都会失效"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void remove(row)}
                  >
                    <Button danger>删除</Button>
                  </Popconfirm>
                </Space>
              </div>
              <Typography.Paragraph copyable className="sd-code">
                {joinSiteUrl(origin, row.callbackPath)}
              </Typography.Paragraph>
              <div className="muted">
                {specOf(row.kind)?.callbackHint || "把这个回调地址填到官方后台。"}
              </div>
              {row.lastError ? (
                <div className="sd-channel-error">最近错误：{row.lastError}</div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="sd-empty">
            还没有接入渠道，从下面选一个平台开始配置
          </div>
        )}

        <h4 className="sd-form-title" style={{ marginTop: 18 }}>
          支持的平台（官方 API + 双向 / 自定义渠道）
        </h4>
        <div className="sd-channel-grid">
          {SERVICE_DESK_CHANNEL_SPECS.map((item) => (
            <div
              key={item.kind}
              className="sd-channel-card"
              role="button"
              tabIndex={0}
              onClick={() => openNew(item.kind)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openNew(item.kind);
                }
              }}
            >
              <strong>{item.label}</strong>
              <span className="muted">{item.description}</span>
              <span className="muted">{item.setup}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Modal
        open={Boolean(editor)}
        width={editor?.kind === "custom" ? 820 : 620}
        title={
          editor
            ? editor.id
              ? `编辑渠道：${spec?.label || ""}`
              : `接入渠道：${spec?.label || ""}`
            : ""
        }
        okText="保存"
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        onOk={() => void save()}
      >
        {editor && spec ? (
          <div className="sd-form">
            <div className="sd-form-grid">
              <label>
                渠道名称
                <Input
                  value={editor.name}
                  maxLength={80}
                  onChange={(event) =>
                    setEditor({ ...editor, name: event.target.value })
                  }
                  placeholder="例如：官网微信客服"
                />
              </label>
              <label>
                平台类型
                <Select
                  value={editor.kind}
                  disabled={Boolean(editor.id)}
                  options={SERVICE_DESK_CHANNEL_SPECS.map((item) => ({
                    value: item.kind,
                    label: item.label,
                  }))}
                  onChange={(value) => {
                    const next = specOf(value) as ServiceDeskChannelKindSpec;
                    setEditor({
                      ...editor,
                      kind: value,
                      name:
                        editor.name && editor.name !== spec.label
                          ? editor.name
                          : next.label,
                      config: next.samples ? { ...next.samples } : {},
                      configured: [],
                    });
                  }}
                />
              </label>
              {spec.fields.map((field) => {
                const filled = editor.configured.includes(field.key);
                const placeholder =
                  field.secret && filled
                    ? "已配置，留空沿用"
                    : field.placeholder || (field.required ? "必填" : "选填");
                const update = (value: string) =>
                  setEditor({
                    ...editor,
                    config: { ...editor.config, [field.key]: value },
                  });
                return (
                  <label
                    key={field.key}
                    className={field.multiline ? "sd-form-span-2" : undefined}
                  >
                    {`${field.label}${field.required ? " *" : ""}`}
                    {field.multiline ? (
                      <TextArea
                        autoSize={{ minRows: 4, maxRows: 14 }}
                        spellCheck={false}
                        value={editor.config[field.key] || ""}
                        placeholder={placeholder}
                        onChange={(event) => update(event.target.value)}
                      />
                    ) : (
                      <Input
                        type={field.secret ? "password" : "text"}
                        value={editor.config[field.key] || ""}
                        placeholder={placeholder}
                        onChange={(event) => update(event.target.value)}
                      />
                    )}
                    {field.hint ? (
                      <span className="muted">{field.hint}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <div>
              <div className="field-label">回调地址</div>
              {editor.callbackPath ? (
                <>
                  <Typography.Paragraph copyable className="sd-code">
                    {joinSiteUrl(origin, editor.callbackPath)}
                  </Typography.Paragraph>
                  <span className="muted">{spec.callbackHint}</span>
                </>
              ) : (
                <span className="muted">
                  保存后会生成这个渠道专属的回调地址，再填到官方后台。
                </span>
              )}
            </div>
            <div className="muted">{spec.setup}</div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
