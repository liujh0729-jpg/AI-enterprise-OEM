"use client";

import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type {
  ContentAgentAssistantChannel,
  ContentAgentAssistantKind,
  ContentAgentAssistantKindSpec,
  ContentAgentAssistantMessage,
} from "@enterprise/contracts";
import { CONTENT_AGENT_ASSISTANT_KIND_SPECS } from "@enterprise/contracts";
import {
  App,
  Button,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";
import { fmtTime } from "@/lib/datetime";

/**
 * Agent 助理：把第三方消息通道接进来，别人在企微/飞书/钉钉/QQ 里发一句话，
 * 就当成一轮对话交给 Agent 跑，结果原路发回那个会话——等于远程指挥 Agent。
 * 「群机器人」「自定义群机器人」只能向外推送，收不到指令，卡片上标了「只推送」。
 * 个人微信没有官方开放接口（第三方「微信助理」靠模拟登录，会封号且违反平台规则），
 * 这里不接；微信生态走「微信客服」和「公众号服务号」，都支持双向。
 */

const SPEC_BY_KIND = new Map(
  CONTENT_AGENT_ASSISTANT_KIND_SPECS.map((spec) => [spec.kind, spec] as const),
);

const MESSAGE_STATUS_LABEL: Record<string, string> = {
  received: "已收到",
  running: "执行中",
  succeeded: "已回复",
  failed: "失败",
  ignored: "已忽略",
};

const MESSAGE_STATUS_COLOR: Record<string, string> = {
  received: "default",
  running: "processing",
  succeeded: "success",
  failed: "error",
  ignored: "warning",
};

type Editor = {
  open: boolean;
  /** null＝新建 */
  editing: ContentAgentAssistantChannel | null;
  kind: ContentAgentAssistantKind;
  name: string;
  config: Record<string, string>;
  channelId: number;
  model: string;
  allowedUsers: string;
  enabled: boolean;
};

const EMPTY_EDITOR: Editor = {
  open: false,
  editing: null,
  kind: "wecom_app",
  name: "",
  config: {},
  channelId: 0,
  model: "",
  allowedUsers: "",
  enabled: true,
};

function emptyConfig(spec: ContentAgentAssistantKindSpec | undefined) {
  const config: Record<string, string> = {};
  for (const field of spec?.fields ?? []) config[field.key] = "";
  return config;
}

export function AgentAssistantTab() {
  const { message } = App.useApp();
  // 回调地址的域名：各 IM 平台只认绝对地址，跟站点域名走
  const siteBase = useSiteBase();
  const [rows, setRows] = useState<ContentAgentAssistantChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState(0);
  const [testingRow, setTestingRow] = useState(0);

  const [channels, setChannels] = useState<
    { value: number; label: string; enabled: boolean }[]
  >([]);
  const [slot, setSlot] = useState({ channelId: 0, model: "" });
  const [editor, setEditor] = useState<Editor>(EMPTY_EDITOR);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [saving, setSaving] = useState(false);

  const [messagesFor, setMessagesFor] =
    useState<ContentAgentAssistantChannel | null>(null);
  const [messages, setMessages] = useState<ContentAgentAssistantMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await contentApi.assistantChannels();
      setRows(list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "助理通道读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 渠道清单与文本槽位：读不到只影响弹窗默认值，不挡清单
  useEffect(() => {
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        setChannels(
          settings.channels
            .filter((item) => item.id > 0)
            .map((item) => ({
              value: item.id,
              label: item.name,
              enabled: item.enabled,
            })),
        );
        const textSlot = settings.slots.find((item) => item.mediaType === "text");
        setSlot({
          channelId: textSlot?.channelId ?? 0,
          model: textSlot?.model || "",
        });
      } catch {
        // 读不到渠道时弹窗仍可填写，只是要先到「模型设置」里配渠道
      }
    })();
  }, []);

  const enabledChannels = channels.filter((item) => item.enabled);

  /** 按渠道取文本模型清单；已存的模型名即使不在清单里也保留。 */
  const loadModels = useCallback(
    async (channelId: number, preferred: string) => {
      setModelsLoading(true);
      setModelsError("");
      try {
        const result = await contentApi.models({ query: { channelId } });
        const list = (result?.models || [])
          .filter((item) => item.kind === "text")
          .map((item) => item.id);
        setModelOptions(list);
        setEditor((prev) =>
          prev.open ? { ...prev, model: preferred || list[0] || "" } : prev,
        );
      } catch (caught) {
        setModelOptions([]);
        setModelsError(
          (caught as Error).message || "模型清单读取失败，可手动填写模型名",
        );
        setEditor((prev) => (prev.open ? { ...prev, model: preferred } : prev));
      } finally {
        setModelsLoading(false);
      }
    },
    [],
  );

  const defaultChannelId = (() => {
    const first = enabledChannels[0]?.value;
    if (first) return first;
    return slot.channelId > 0 ? slot.channelId : 0;
  })();

  const openCreate = (spec: ContentAgentAssistantKindSpec) => {
    const channelId = defaultChannelId;
    const model = channelId === slot.channelId ? slot.model : "";
    setEditor({
      ...EMPTY_EDITOR,
      open: true,
      kind: spec.kind,
      name: spec.label,
      config: emptyConfig(spec),
      channelId,
      model,
    });
    void loadModels(channelId, model);
  };

  const openEdit = (row: ContentAgentAssistantChannel) => {
    const spec = SPEC_BY_KIND.get(row.kind);
    const config = emptyConfig(spec);
    for (const field of spec?.fields ?? []) {
      if (!field.secret) config[field.key] = row.config[field.key] || "";
    }
    setEditor({
      open: true,
      editing: row,
      kind: row.kind,
      name: row.name,
      config,
      channelId: row.channelId,
      model: row.model,
      allowedUsers: row.allowedUsers,
      enabled: row.enabled,
    });
    void loadModels(row.channelId, row.model);
  };

  const patchEditor = (patch: Partial<Editor>) =>
    setEditor((prev) => ({ ...prev, ...patch }));
  const patchConfig = (key: string, value: string) =>
    setEditor((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));

  const editorSpec = SPEC_BY_KIND.get(editor.kind);

  const channelOptions = (() => {
    const list = [...enabledChannels];
    if (
      editor.channelId > 0 &&
      !list.some((item) => item.value === editor.channelId)
    ) {
      list.unshift({
        value: editor.channelId,
        label: `渠道 #${editor.channelId}（已停用）`,
        enabled: false,
      });
    }
    return list.map((item) => ({ value: item.value, label: item.label }));
  })();

  const modelSelectOptions = (
    modelOptions.includes(editor.model) || !editor.model
      ? modelOptions
      : [editor.model, ...modelOptions]
  ).map((id) => ({ value: id, label: id }));

  const submit = async () => {
    const name = editor.name.trim();
    if (!name) {
      message.warning("请给这个助理通道起个名字");
      return;
    }
    for (const field of editorSpec?.fields ?? []) {
      if (!field.required) continue;
      if (editor.config[field.key]?.trim()) continue;
      // 编辑时敏感项留空＝沿用已保存的密文
      if (editor.editing?.secretKeys.includes(field.key)) continue;
      message.warning(`请填写「${field.label}」`);
      return;
    }
    if (!editor.channelId) {
      message.warning("请选择一个自定义模型渠道");
      return;
    }
    if (!editor.model.trim()) {
      message.warning("请选定这个助理执行用的模型");
      return;
    }
    setSaving(true);
    try {
      const body = {
        kind: editor.kind,
        name,
        config: editor.config,
        channelId: editor.channelId,
        model: editor.model.trim(),
        allowedUsers: editor.allowedUsers.trim(),
        enabled: editor.enabled,
      };
      if (editor.editing) {
        await contentApi.updateAssistantChannel({
          params: { id: String(editor.editing.id) },
          body,
        });
        message.success("助理通道已更新");
      } else {
        await contentApi.saveAssistantChannel({ body });
        message.success("助理通道已创建，把回调地址填到对应平台就能用了");
      }
      setEditor(EMPTY_EDITOR);
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: ContentAgentAssistantChannel, enabled: boolean) => {
    setToggling(row.id);
    try {
      const updated = await contentApi.updateAssistantChannel({
        params: { id: String(row.id) },
        body: { enabled },
      });
      if (updated) {
        setRows((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      message.success(enabled ? "已启用：收到消息就会执行" : "已停用：只记录消息不执行");
    } catch (caught) {
      message.error((caught as Error).message || "状态修改失败");
    } finally {
      setToggling(0);
    }
  };

  const test = async (row: ContentAgentAssistantChannel) => {
    setTestingRow(row.id);
    try {
      const result = await contentApi.testAssistantChannel(
        { params: { id: String(row.id) } },
        { timeoutMs: 60000 },
      );
      if (result?.ok) {
        message.success(result.message || "连接正常");
      } else {
        message.error(result?.message || "连接失败");
      }
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "测试连接失败");
    } finally {
      setTestingRow(0);
    }
  };

  const remove = async (row: ContentAgentAssistantChannel) => {
    try {
      await contentApi.removeAssistantChannel({
        params: { id: String(row.id) },
      });
      message.success("助理通道已删除");
      if (messagesFor?.id === row.id) setMessagesFor(null);
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const loadMessages = useCallback(async (channelId: number) => {
    setMessagesLoading(true);
    try {
      const list = await contentApi.assistantMessages({
        params: { id: String(channelId) },
      });
      setMessages(list || []);
      setMessagesError("");
    } catch (caught) {
      setMessagesError((caught as Error).message || "消息记录读取失败");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const openMessages = (row: ContentAgentAssistantChannel) => {
    setMessagesFor(row);
    setMessages([]);
    void loadMessages(row.id);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("回调地址已复制");
    } catch {
      message.warning("浏览器不允许复制，请手动选中复制");
    }
  };

  const webhookUrl = (path: string) => joinSiteUrl(siteBase, path);

  const columns: ColumnsType<ContentAgentAssistantChannel> = [
    {
      title: "通道",
      key: "name",
      width: 240,
      render: (_, row) => {
        const spec = SPEC_BY_KIND.get(row.kind);
        return (
          <div>
            <Space size={4} wrap>
              <b>{row.name}</b>
              <Tag>{row.kindLabel}</Tag>
              <Tag color={spec?.direction === "twoWay" ? "blue" : "default"}>
                {spec?.direction === "twoWay" ? "可收可回" : "只推送"}
              </Tag>
              {row.enabled ? null : <Tag>已停用</Tag>}
            </Space>
            {row.lastError ? (
              <Tooltip title={row.lastError}>
                <div
                  className="text-12"
                  style={{ marginTop: 2, color: "var(--danger)" }}
                >
                  <ExclamationCircleOutlined aria-hidden /> 最近一次失败：
                  {row.lastError.slice(0, 40)}
                  {row.lastError.length > 40 ? "…" : ""}
                </div>
              </Tooltip>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "回调地址",
      key: "webhook",
      width: 320,
      render: (_, row) => {
        const spec = SPEC_BY_KIND.get(row.kind);
        if (spec?.direction !== "twoWay") {
          return <span className="muted">只推送，无需回调</span>;
        }
        const url = webhookUrl(row.webhookPath);
        return (
          <div>
            <div className="mono text-12" style={{ wordBreak: "break-all" }}>
              {url}
            </div>
            <Button
              size="small"
              type="link"
              icon={<CopyOutlined aria-hidden />}
              onClick={() => void copy(url)}
            >
              复制
            </Button>
          </div>
        );
      },
    },
    {
      title: "执行模型",
      key: "model",
      width: 200,
      render: (_, row) => (
        <div>
          <div style={{ wordBreak: "break-all" }}>{row.model}</div>
          <div className="text-12 muted">
            {channels.find((item) => item.value === row.channelId)?.label ||
              `渠道 #${row.channelId}`}
          </div>
        </div>
      ),
    },
    {
      title: "允许的发送者",
      key: "allowedUsers",
      width: 160,
      render: (_, row) =>
        row.allowedUsers ? (
          <span className="text-12">{row.allowedUsers}</span>
        ) : (
          <span className="muted">不限制</span>
        ),
    },
    {
      title: "最近消息",
      key: "lastEventAt",
      width: 170,
      render: (_, row) =>
        row.lastEventAt ? (
          <div>
            <div>{fmtTime(row.lastEventAt)}</div>
            <div className="text-12 muted">累计 {row.eventCount} 条</div>
          </div>
        ) : (
          <span className="muted">还没收到消息</span>
        ),
    },
    {
      title: "启用",
      key: "enabled",
      width: 80,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.enabled}
          loading={toggling === row.id}
          onChange={(enabled) => void toggle(row, enabled)}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 300,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button
            icon={<ThunderboltOutlined aria-hidden />}
            loading={testingRow === row.id}
            onClick={() => void test(row)}
          >
            测试
          </Button>
          <Button
            icon={<MessageOutlined aria-hidden />}
            onClick={() => openMessages(row)}
          >
            消息记录
          </Button>
          <Button icon={<EditOutlined aria-hidden />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除这个助理通道？"
            description="删除后第三方平台再发消息会收不到回复；消息记录一并删除。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(row)}
          >
            <Button danger icon={<DeleteOutlined aria-hidden />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const messageColumns: ColumnsType<ContentAgentAssistantMessage> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "方向",
      dataIndex: "direction",
      key: "direction",
      width: 90,
      render: (value: string) => (
        <Tag color={value === "out" ? "blue" : "default"}>
          {value === "out" ? "回复" : "收到"}
        </Tag>
      ),
    },
    {
      title: "会话",
      dataIndex: "externalChatId",
      key: "externalChatId",
      width: 180,
      render: (value: string) => (
        <span className="mono text-12" style={{ wordBreak: "break-all" }}>
          {value}
        </span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={MESSAGE_STATUS_COLOR[value] || "default"}>
          {MESSAGE_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "内容",
      key: "content",
      width: 360,
      render: (_, row) => {
        const body = row.error || row.content;
        if (!body) return <span className="muted">—</span>;
        return (
          <Tooltip title={body}>
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: row.error ? "var(--danger)" : undefined,
              }}
            >
              {body}
            </div>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <>
      <div className="tool-group" style={{ marginBottom: 12 }}>
        {CONTENT_AGENT_ASSISTANT_KIND_SPECS.map((spec) => (
          <button
            key={spec.kind}
            type="button"
            className="tool-card"
            onClick={() => openCreate(spec)}
          >
            <span className="tool-name">
              {spec.label}
              {spec.direction === "pushOnly" ? "（只推送）" : ""}
            </span>
            <span className="tool-hint">{spec.description}</span>
            <span className="text-12 muted">
              {spec.direction === "twoWay" ? "可远程指挥 Agent" : "不能远程指挥"}
            </span>
          </button>
        ))}
      </div>

      <Panel
        title="助理通道"
        titleExtra={
          <span className="text-12 muted">
            第三方消息一到就交给 Agent 跑一轮，结果原路回复；解析成中文指令后按「允许的发送者」过滤
          </span>
        }
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => void load()}
          >
            刷新
          </Button>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {!loading && !rows.length ? (
          <EmptyState
            icon={<ApiOutlined style={{ fontSize: 40 }} aria-hidden />}
            text="还没有接助理：点上面任意一张卡片，填好凭据与回调地址后，在对应平台发一句话就能指挥 Agent"
          />
        ) : null}
        {!loading && rows.length ? (
          <Table<ContentAgentAssistantChannel>
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        ) : null}
      </Panel>

      <Modal
        open={editor.open}
        title={
          editor.editing
            ? `编辑助理通道 · ${editor.editing.name}`
            : `新建助理 · ${editorSpec?.label || ""}`
        }
        width={780}
        okText={editor.editing ? "保存修改" : "创建通道"}
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => {
          if (!saving) setEditor(EMPTY_EDITOR);
        }}
        destroyOnHidden
      >
        {editorSpec ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Notice variant="info">{editorSpec.setup}</Notice>
            {editorSpec.direction === "twoWay" ? (
              <div className="text-12 muted">
                回调地址：
                <span className="mono">
                  {editor.editing
                    ? webhookUrl(editor.editing.webhookPath)
                    : "保存后生成，回到列表里复制"}
                </span>
                <br />
                {editorSpec.callbackHint}
              </div>
            ) : (
              <div className="text-12 muted">
                这是只推送通道：Agent 的回复会发到这个群，但群里发的话不会被当成指令。
              </div>
            )}

            <div className="data-table-form">
              <label className="data-table-form-item">
                <span className="data-table-form-label">
                  通道名称<b style={{ color: "var(--danger)" }}> *</b>
                </span>
                <Input
                  value={editor.name}
                  maxLength={40}
                  placeholder="例如：客户群助理"
                  onChange={(event) => patchEditor({ name: event.target.value })}
                />
              </label>
              <label
                className="data-table-form-item"
                style={{ gridColumn: "1 / -1" }}
              >
                <span className="data-table-form-label">启用方式</span>
                <Radio.Group
                  value={editor.enabled ? "execute" : "record"}
                  onChange={(event) =>
                    patchEditor({ enabled: event.target.value === "execute" })
                  }
                  style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                >
                  <Radio value="execute">
                    收到消息就执行（交给 Agent 处理后原路回复）
                  </Radio>
                  <Radio value="record">
                    只记录不执行（消息留在记录里，不调用模型）
                  </Radio>
                </Radio.Group>
              </label>

              {(editorSpec.fields || []).map((field) => (
                <label className="data-table-form-item" key={field.key}>
                  <span className="data-table-form-label">
                    {field.label}
                    {field.required ? (
                      <b style={{ color: "var(--danger)" }}> *</b>
                    ) : null}
                  </span>
                  <Input
                    value={editor.config[field.key] || ""}
                    placeholder={
                      field.secret && editor.editing?.secretKeys.includes(field.key)
                        ? "已保存，留空保持不变"
                        : field.placeholder || ""
                    }
                    onChange={(event) =>
                      patchConfig(field.key, event.target.value)
                    }
                  />
                  {field.hint ? (
                    <span className="text-12 muted">{field.hint}</span>
                  ) : null}
                </label>
              ))}

              <label className="data-table-form-item">
                <span className="data-table-form-label">执行渠道</span>
                <Select
                  value={editor.channelId || undefined}
                  options={channelOptions}
                  placeholder={
                    channelOptions.length ? "选一个自定义模型渠道" : "还没有可用的自定义渠道"
                  }
                  onChange={(value) => {
                    patchEditor({ channelId: value, model: "" });
                    void loadModels(value, "");
                  }}
                />
              </label>
              <label className="data-table-form-item">
                <span className="data-table-form-label">执行模型</span>
                <Select
                  showSearch
                  loading={modelsLoading}
                  value={editor.model || undefined}
                  options={modelSelectOptions}
                  placeholder="这个渠道要固定选一个模型"
                  onChange={(value) => patchEditor({ model: value || "" })}
                />
              </label>

              <label
                className="data-table-form-item"
                style={{ gridColumn: "1 / -1" }}
              >
                <span className="data-table-form-label">允许的发送者</span>
                <Input
                  value={editor.allowedUsers}
                  maxLength={500}
                  placeholder="留空＝不限制；多个用逗号分隔"
                  onChange={(event) =>
                    patchEditor({ allowedUsers: event.target.value })
                  }
                />
                <span className="text-12 muted">
                  填第三方平台里的用户 ID（企业微信 UserID / 飞书 open_id / QQ
                  号 / 微信 openid），也可以填会话 ID；不在名单里的消息只记录不执行。
                </span>
              </label>
            </div>

            {modelsError ? (
              <div className="text-12 muted">{modelsError}</div>
            ) : null}
            {!channelOptions.length ? (
              <Notice variant="warn">
                还没有可用的自定义模型渠道：助理是无人值守执行，拿不到登录态，不能用「模型设置」里的内置渠道和默认槽位。请先到「开放集成 →
                模型设置」添加一个渠道，再回来绑这个助理。
              </Notice>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(messagesFor)}
        title={messagesFor ? `消息记录 · ${messagesFor.name}` : "消息记录"}
        size={900}
        onClose={() => setMessagesFor(null)}
        extra={
          messagesFor ? (
            <Button
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => void loadMessages(messagesFor.id)}
            >
              刷新
            </Button>
          ) : null
        }
      >
        {messagesError ? <Notice variant="error">{messagesError}</Notice> : null}
        {!messagesLoading && !messages.length ? (
          <EmptyState text="还没有消息：在这个通道对应的第三方平台上发一句话，这里会记录收到与回复" />
        ) : (
          <Table<ContentAgentAssistantMessage>
            size="small"
            rowKey="id"
            loading={messagesLoading}
            columns={messageColumns}
            dataSource={messages}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Drawer>
    </>
  );
}
